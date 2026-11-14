"""Regression tests for the second correctness pass.

Each test names the concrete failure mode it guards against. All tests are
offline (no network, no SMTP, no external services).
"""
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

import app.notifications.service as notifications_module
from app.config import Settings
from app.models.base import Base, utcnow
from app.models.incident import Incident
from app.monitoring.ssl_checker import days_until
from app.monitoring.url_guard import UrlValidationError, validate_public_http_url
from app.notifications.service import STATUS_FAILED, STATUS_SENT, EmailChannel
from app.scheduler.scheduler import Scheduler
from app.schemas.monitor import MonitorUpdate
from app.services.monitor_service import set_enabled, update_monitor
from tests.factories import make_monitor
from tests.utils import create_user, register_and_login, unique_email


def monitor_payload(**kw):
    payload = {
        "name": "Example API",
        "type": "http",
        "target_url": "https://api.example.com/health",
    }
    payload.update(kw)
    return payload


class TestDatabaseUrlAssembly:
    def test_password_with_url_delimiters_is_encoded(self):
        # docker-compose used to interpolate the raw password into a URL;
        # "p@ssword" parsed as host "ssword@postgres" and the stack never
        # became healthy.
        settings = Settings(
            database_url=None,
            postgres_host="postgres",
            postgres_port=5432,
            postgres_user="sitewatch",
            postgres_password="p@ss:w0rd#1",
            postgres_db="sitewatch",
        )
        parsed = make_url(settings.resolved_database_url)
        assert parsed.password == "p@ss:w0rd#1"
        assert parsed.host == "postgres"
        assert parsed.database == "sitewatch"

    def test_explicit_database_url_wins(self):
        settings = Settings(
            database_url="sqlite:///./explicit.db",
            postgres_host="postgres",
            postgres_user="u",
            postgres_password="p",
            postgres_db="d",
        )
        assert settings.resolved_database_url == "sqlite:///./explicit.db"

    def test_defaults_to_sqlite(self):
        settings = Settings(database_url=None)
        assert settings.resolved_database_url == "sqlite:///./sitewatch.db"


class TestUpdateNormalisation:
    def test_blank_optional_fields_become_none(self, db_session):
        # PUT {"keyword": "   "} on an http monitor used to enable a keyword
        # rule that could never match, keeping the monitor permanently DOWN.
        payload = MonitorUpdate(
            keyword="   ", json_path="\t", json_expected_value="  ", name="  Example  "
        )
        assert payload.keyword is None
        assert payload.json_path is None
        assert payload.json_expected_value is None
        assert payload.name == "Example"

        user = create_user(db_session)
        monitor = make_monitor(user_id=user.id, id=None)
        db_session.add(monitor)
        db_session.commit()
        update_monitor(db_session, monitor, MonitorUpdate(keyword="   "))
        assert monitor.keyword is None

    def test_blank_name_is_rejected(self):
        with pytest.raises(ValueError):
            MonitorUpdate(name="   ")


class TestPauseClosesIncidents:
    def _monitor_with_incident(self, db_session):
        user = create_user(db_session)
        monitor = make_monitor(user_id=user.id, id=None)
        db_session.add(monitor)
        db_session.flush()
        incident = Incident(
            monitor_id=monitor.id,
            started_at=utcnow() - timedelta(minutes=5),
            failure_count=2,
            cause="down",
        )
        db_session.add(incident)
        db_session.commit()
        return monitor, incident

    def test_disable_endpoint_closes_open_incident(self, db_session):
        monitor, incident = self._monitor_with_incident(db_session)
        set_enabled(db_session, monitor, False)

        assert incident.is_resolved is True
        assert incident.resolved_at is not None
        assert incident.duration_seconds is not None and incident.duration_seconds >= 300
        open_rows = db_session.scalars(
            select(Incident).where(Incident.is_resolved.is_(False))
        ).all()
        assert open_rows == []

    def test_put_enabled_false_closes_open_incident(self, db_session):
        monitor, incident = self._monitor_with_incident(db_session)
        update_monitor(db_session, monitor, MonitorUpdate(enabled=False))
        assert incident.is_resolved is True
        assert incident.duration_seconds is not None

    def test_active_incidents_dashboard_count_drops_after_pause(self, client, db_session):
        headers = register_and_login(client, email=unique_email("pause"))
        created = client.post("/api/monitors", json=monitor_payload(), headers=headers)
        assert created.status_code == 201
        monitor_id = created.json()["id"]
        db_session.add(
            Incident(monitor_id=monitor_id, started_at=utcnow(), failure_count=1, cause="down")
        )
        db_session.commit()

        assert client.get("/api/dashboard/summary", headers=headers).json()["active_incidents"] == 1
        resp = client.post(f"/api/monitors/{monitor_id}/disable", headers=headers)
        assert resp.status_code == 200
        assert client.get("/api/dashboard/summary", headers=headers).json()["active_incidents"] == 0


class TestEmailHardening:
    def test_newline_in_subject_is_sanitised_and_auditable(self, monkeypatch):
        sent = []

        class FakeSMTP:
            def __init__(self, host, port, timeout=None):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def starttls(self):
                pass

            def login(self, u, p):
                pass

            def send_message(self, message):
                sent.append(message["Subject"])

        monkeypatch.setattr(notifications_module.smtplib, "SMTP", FakeSMTP)
        settings = Settings(
            smtp_host="smtp.example.com",
            smtp_from="alerts@example.com",
            smtp_to="admin@example.com",
        )
        status, detail = EmailChannel(settings).send(
            "[SiteWatch] monitor_down: bad\nname", "{}"
        )
        assert status == STATUS_SENT and detail is None
        assert "\n" not in sent[0] and "bad" in sent[0]

    def test_smtp_failure_returns_failed_instead_of_raising(self, monkeypatch):
        def boom(*args, **kwargs):
            raise OSError("connection refused")

        monkeypatch.setattr(notifications_module.smtplib, "SMTP", boom)
        settings = Settings(
            smtp_host="smtp.example.com",
            smtp_from="alerts@example.com",
            smtp_to="admin@example.com",
        )
        status, detail = EmailChannel(settings).send("subject", "{}")
        assert status == STATUS_FAILED and "connection refused" in (detail or "")


class TestSslEndpointGuard:
    def test_refresh_rejected_when_ssl_checking_is_disabled(self, client, monkeypatch):
        fake_checker = lambda: pytest.fail("must not open a socket")  # noqa: E731
        monkeypatch.setattr("app.api.routes.ssl.SSLChecker", fake_checker)
        headers = register_and_login(client, email=unique_email("sslguard"))
        created = client.post(
            "/api/monitors",
            json=monitor_payload(target_url="https://api.example.com/", ssl_check_enabled=False),
            headers=headers,
        )
        resp = client.get(f"/api/ssl/{created.json()['id']}?refresh=true", headers=headers)
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] == "ssl_check_disabled"


class TestSslDaysRemaining:
    def test_exact_whole_days_are_not_undercounted(self):
        now = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
        assert days_until(now + timedelta(days=30), now=now) == 30
        assert days_until(now + timedelta(days=90), now=now) == 90

    def test_partial_and_expired_days(self):
        now = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
        assert days_until(now + timedelta(hours=1), now=now) == 1
        assert days_until(now + timedelta(days=1, hours=2), now=now) == 2
        assert days_until(now - timedelta(hours=1), now=now) == -1
        assert days_until(now - timedelta(days=2), now=now) == -2


class TestUrlControlCharacters:
    @pytest.mark.parametrize(
        "url",
        [
            "http://127.0.0.1\t.example.com/",
            "https://example.com/a\r\nb",
            "https://example.com/\x00",
        ],
    )
    def test_control_characters_rejected_at_creation(self, url):
        with pytest.raises(UrlValidationError):
            validate_public_http_url(url)


class TestSchedulerBounds:
    @pytest.fixture()
    def file_factory(self, tmp_path):
        engine = create_engine(
            f"sqlite:///{tmp_path / 'bounds.db'}",
            connect_args={"check_same_thread": False},
            future=True,
        )
        Base.metadata.create_all(engine)
        yield sessionmaker(bind=engine, expire_on_commit=False, future=True)
        engine.dispose()

    def test_dispatch_is_bounded_by_pool_size(self, file_factory):
        with file_factory() as db:
            user = create_user(db)
            for i in range(6):
                db.add(
                    make_monitor(
                        user_id=user.id,
                        id=None,
                        name=f"m{i}",
                        next_check_at=utcnow() - timedelta(seconds=5),
                    )
                )
            db.commit()
        scheduler = Scheduler(
            file_factory,
            scan_interval=10.0,
            max_workers=2,
            sleep_fn=lambda _: None,
            checker_factory=lambda: type(
                "Noop", (), {"check": lambda self, m: None}
            )(),
        )
        assert scheduler.scan_once() == 2
        scheduler._pool.shutdown(wait=True)

    def test_stop_clears_reserved_ids(self, file_factory):
        scheduler = Scheduler(
            file_factory,
            scan_interval=10.0,
            max_workers=2,
            sleep_fn=lambda _: None,
        )
        scheduler._running.update({101, 102})
        scheduler.stop()
        assert scheduler.running_monitor_ids == set()
