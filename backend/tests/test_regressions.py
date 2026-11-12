"""Regression tests for bugs fixed in the UI/quality pass.

Every test here maps to a concrete defect that the pre-existing suite did not
cover; see the docstrings for the failure mode being guarded against.
"""
from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

import app.scheduler.scheduler as scheduler_module
from app.models.base import utcnow
from app.models.check import MonitorCheck
from app.models.incident import Incident
from app.models.monitor import Monitor
from app.models.notification import STATUS_FAILED
from app.monitoring.url_guard import validate_public_http_url
from app.notifications.service import WebhookChannel
from app.scheduler.scheduler import Scheduler
from app.schemas.monitor import MonitorUpdate
from app.seed import DEMO_MONITORS, seed_demo_data
from app.services.incident_service import record_result
from app.services.monitor_service import update_monitor
from tests.factories import make_monitor
from tests.utils import create_user, register_and_login, unique_email


def monitor_payload(**kw):
    payload = {
        "name": "Example API",
        "type": "http",
        "target_url": "https://api.example.com/health",
        "interval_seconds": 300,
        "timeout_seconds": 10,
        "expected_status": 200,
    }
    payload.update(kw)
    return payload


@pytest.fixture()
def auth(client):
    return register_and_login(client, email=unique_email("regression"))


class TestSeedScheduling:
    def test_seeded_monitors_are_immediately_due(self, db_session):
        # next_check_at = NULL means the scheduler never dispatches the demo
        # monitors, so the whole demo dataset stays empty forever.
        _, monitors, _ = seed_demo_data(db_session, password="demo-pass-123")
        assert len(monitors) == len(DEMO_MONITORS)
        assert all(m.next_check_at is not None for m in monitors)

    def test_reseed_repairs_legacy_null_next_check_at(self, db_session):
        seed_demo_data(db_session, password="demo-pass-123")
        name = DEMO_MONITORS[0]["name"]
        legacy = db_session.scalar(select(Monitor).where(Monitor.name == name))
        legacy.next_check_at = None
        db_session.commit()

        seed_demo_data(db_session, password="demo-pass-123")
        db_session.refresh(legacy)
        assert legacy.next_check_at is not None


class TestUrlGuardHardening:
    @pytest.mark.parametrize(
        "url",
        [
            "http://[invalid/",       # malformed IPv6 literal
            "http://[::1",            # unclosed bracket
            "https://example.com:abc/",   # non-numeric port
            "https://example.com:99999/",  # out-of-range port
        ],
    )
    def test_malformed_host_or_port_is_a_400_not_a_500(self, client, auth, url):
        # urlsplit().hostname/.port raise ValueError; without the guard those
        # escaped as unhandled 500s (and crashed the SSL checker).
        resp = client.post("/api/monitors", json=monitor_payload(target_url=url), headers=auth)
        assert resp.status_code == 400, resp.text
        assert resp.json()["error"]["code"] == "invalid_url"

    def test_guard_returns_stripped_url(self):
        assert validate_public_http_url("  https://example.com/  ") == "https://example.com/"

    def test_webhook_send_survives_invalid_url(self):
        # httpx.InvalidURL is not an httpx.HTTPError: it used to escape and
        # skip the notification audit row entirely.
        status, detail = WebhookChannel("https://example.com:abc/").send({"event": "test"})
        assert status == STATUS_FAILED
        assert detail

    def test_private_target_is_rejected_by_ssl_only_checker(self):
        from app.monitoring.checker import HTTPChecker
        from tests.factories import FakeSSLChecker

        checker = HTTPChecker(ssl_checker=FakeSSLChecker(days_remaining=90))
        monitor = make_monitor(type="ssl", target_url="https://127.0.0.1/")
        outcome = checker.check(monitor)
        assert outcome.status == "down"
        assert checker._ssl_checker.calls == []  # no socket was opened


class TestNotificationSettings:
    def test_blank_webhook_is_stored_as_null(self, client, auth):
        resp = client.put(
            "/api/me/notifications", json={"webhook_url": "   "}, headers=auth
        )
        assert resp.status_code == 200
        assert resp.json()["webhook_url"] is None

    def test_webhook_url_is_stripped(self, client, auth):
        resp = client.put(
            "/api/me/notifications",
            json={"webhook_url": "  https://hooks.example.com/sitewatch  "},
            headers=auth,
        )
        assert resp.status_code == 200
        assert resp.json()["webhook_url"] == "https://hooks.example.com/sitewatch"

    def test_me_exposes_real_smtp_state(self, client, auth):
        resp = client.get("/api/auth/me", headers=auth)
        assert resp.status_code == 200
        assert isinstance(resp.json()["smtp_enabled"], bool)


class TestIncidentRecovery:
    def test_recovery_closes_every_open_incident(self, db_session):
        # Two concurrent checks could create two open incidents; the old code
        # resolved only the newest one, leaving a permanent zombie incident.
        user = create_user(db_session)
        monitor = make_monitor(user_id=user.id, id=None)
        db_session.add(monitor)
        db_session.flush()
        now = datetime.now(UTC)
        for _ in range(2):
            db_session.add(
                Incident(monitor_id=monitor.id, started_at=now, failure_count=1)
            )
        db_session.flush()

        up_check = MonitorCheck(
            monitor_id=monitor.id, checked_at=utcnow(), status="up"
        )
        incident, opened, resolved = record_result(db_session, monitor, up_check)
        assert opened is False and resolved is True and incident is not None
        open_rows = db_session.scalars(
            select(Incident).where(Incident.is_resolved.is_(False))
        ).all()
        assert open_rows == []


class TestMonitorUpdate:
    def test_changing_target_clears_stale_ssl_cache_and_alert_state(self, db_session):
        user = create_user(db_session)
        monitor = make_monitor(user_id=user.id, id=None, ssl_days_remaining=12)
        monitor.ssl_expires_at = utcnow()
        monitor.ssl_alert_state = "warning"
        db_session.add(monitor)
        db_session.commit()

        update_monitor(
            db_session, monitor, MonitorUpdate(target_url="https://other.example.com/")
        )
        assert monitor.ssl_days_remaining is None
        assert monitor.ssl_expires_at is None
        assert monitor.ssl_alert_state == ""


class TestSchedulerResilience:
    def test_restart_rebuilds_the_worker_pool(self, db_engine):
        factory = sessionmaker(bind=db_engine, expire_on_commit=False, future=True)
        scheduler = Scheduler(factory, scan_interval=10.0, max_workers=2)
        first_pool = scheduler._pool
        scheduler.start()
        scheduler.stop()
        assert scheduler._pool_shutdown is True
        scheduler.start()
        assert scheduler._pool is not first_pool
        assert scheduler._pool_shutdown is False
        scheduler.stop()

    def test_failed_retention_is_retried_on_the_next_scan(self, db_engine, monkeypatch):
        factory = sessionmaker(bind=db_engine, expire_on_commit=False, future=True)
        scheduler = Scheduler(factory, scan_interval=10.0, max_workers=2)

        def boom(db, days):
            raise RuntimeError("transient database error")

        monkeypatch.setattr(scheduler_module, "delete_old_checks", boom)
        scheduler._maybe_retention()
        assert scheduler._last_retention_day is None

        monkeypatch.setattr(scheduler_module, "delete_old_checks", lambda db, days: 0)
        scheduler._maybe_retention()
        assert scheduler._last_retention_day is not None
