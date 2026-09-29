from datetime import UTC, timedelta

from tests.utils import register_and_login


def create_monitor(client, headers, target_url="https://api.example.com/", **kw):
    payload = {"name": "m", "target_url": target_url}
    payload.update(kw)
    resp = client.post("/api/monitors", json=payload, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestSslEndpoint:
    def test_http_monitor_not_applicable(self, client):
        headers = register_and_login(client)
        m = create_monitor(client, headers, "http://api.example.com/")
        resp = client.get(f"/api/ssl/{m['id']}", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["ssl_status"] == "not_applicable"
        assert body["scheme"] == "http"

    def test_https_unknown_before_first_check(self, client):
        headers = register_and_login(client)
        m = create_monitor(client, headers, ssl_check_enabled=True)
        resp = client.get(f"/api/ssl/{m['id']}", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["ssl_status"] == "unknown"
        assert body["scheme"] == "https"
        assert body["warning_threshold_days"] == 30

    def test_cached_ssl_data_after_check(self, client, db_session):
        from app.monitoring.checker import CheckOutcome
        from app.monitoring.engine import run_check
        from tests.factories import make_monitor
        from tests.utils import create_user

        user = create_user(db_session)
        monitor = make_monitor(user_id=user.id, id=None, ssl_check_enabled=True)
        db_session.add(monitor)
        db_session.commit()
        from datetime import datetime

        expires = datetime.now(UTC) + timedelta(days=90)
        run_check(
            db_session,
            monitor,
            _FixedChecker(
                CheckOutcome(
                    status="up",
                    ssl_status="valid",
                    ssl_days_remaining=90,
                    ssl_expires_at=expires,
                )
            ),
        )

        headers = register_and_login(client, email=user.email)
        resp = client.get(f"/api/ssl/{monitor.id}", headers=headers)
        body = resp.json()
        assert body["ssl_status"] == "valid"
        assert body["days_remaining"] == 90
        assert body["expires_at"] is not None
        assert body["last_checked_at"] is not None

    def test_refresh_uses_live_certificate(self, client, monkeypatch):
        from tests.factories import FakeSSLChecker

        fake = FakeSSLChecker(days_remaining=17)
        monkeypatch.setattr("app.api.routes.ssl.SSLChecker", lambda: fake)
        headers = register_and_login(client)
        m = create_monitor(client, headers, ssl_check_enabled=True, ssl_warning_days=30)
        resp = client.get(f"/api/ssl/{m['id']}?refresh=true", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["ssl_status"] == "expiring_soon"
        assert body["days_remaining"] == 17

    def test_refresh_failure_is_502(self, client, monkeypatch):
        from app.monitoring.ssl_checker import SSLCheckError
        from tests.factories import FakeSSLChecker

        monkeypatch.setattr(
            "app.api.routes.ssl.SSLChecker",
            lambda: FakeSSLChecker(error=SSLCheckError("timeout", "slow")),
        )
        headers = register_and_login(client)
        m = create_monitor(client, headers, ssl_check_enabled=True)
        resp = client.get(f"/api/ssl/{m['id']}?refresh=true", headers=headers)
        assert resp.status_code == 502
        assert resp.json()["error"]["code"] == "ssl_check_failed"

    def test_ownership(self, client):
        headers_a = register_and_login(client, email="a@example.com")
        headers_b = register_and_login(client, email="b@example.com")
        m = create_monitor(client, headers_a)
        resp = client.get(f"/api/ssl/{m['id']}", headers=headers_b)
        assert resp.status_code == 404

    def test_requires_auth(self, client):
        assert client.get("/api/ssl/1").status_code == 401


class _FixedChecker:
    def __init__(self, outcome):
        self.outcome = outcome

    def check(self, monitor):
        return self.outcome
