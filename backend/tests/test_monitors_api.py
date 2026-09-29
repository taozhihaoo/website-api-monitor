import httpx
import pytest

import app.monitoring.engine as engine_module
from app.config import get_settings
from app.models.check import MonitorCheck
from tests.utils import register_and_login


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


def create_monitor(client, headers, **kw):
    return client.post("/api/monitors", json=monitor_payload(**kw), headers=headers)


@pytest.fixture()
def auth(client):
    return register_and_login(client, email="owner@example.com")


@pytest.fixture()
def auth_b(client):
    return register_and_login(client, email="other@example.com")


class TestCreate:
    def test_create_requires_auth(self, client):
        resp = client.post("/api/monitors", json=monitor_payload())
        assert resp.status_code == 401

    def test_create_success(self, client, auth):
        resp = create_monitor(client, auth)
        assert resp.status_code == 201
        body = resp.json()
        assert body["name"] == "Example API"
        assert body["enabled"] is True
        assert body["interval_seconds"] == 300
        assert body["next_check_at"] is not None
        assert body["last_status"] is None
        assert body["ssl_status"] == "not_applicable"

    def test_create_defaults(self, client, auth):
        resp = client.post(
            "/api/monitors",
            json={"name": "m", "target_url": "https://api.example.com/"},
            headers=auth,
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["type"] == "http"
        assert body["expected_status"] == 200
        assert body["interval_seconds"] == 300

    def test_create_invalid_url_scheme(self, client, auth):
        resp = create_monitor(client, auth, target_url="ftp://example.com/x")
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] == "invalid_url"

    @pytest.mark.parametrize(
        "url",
        [
            "http://localhost/",
            "http://127.0.0.1/",
            "http://169.254.169.254/",
            "http://192.168.1.1/",
            "http://[::1]/",
            "file:///etc/passwd",
        ],
    )
    def test_create_blocks_ssrf_targets(self, client, auth, url):
        resp = create_monitor(client, auth, target_url=url)
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] == "invalid_url"

    def test_create_unresolvable_host(self, client, auth):
        resp = create_monitor(client, auth, target_url="http://unresolvable.example.com/")
        assert resp.status_code == 400

    def test_create_keyword_type_requires_keyword(self, client, auth):
        resp = create_monitor(client, auth, type="keyword")
        assert resp.status_code == 422

    def test_create_api_json_requires_json_path(self, client, auth):
        resp = create_monitor(client, auth, type="api_json")
        assert resp.status_code == 422

    def test_create_ssl_type_requires_https(self, client, auth):
        resp = create_monitor(client, auth, type="ssl", target_url="http://api.example.com/")
        assert resp.status_code == 422

    def test_create_interval_bounds(self, client, auth):
        resp = create_monitor(client, auth, interval_seconds=1)
        assert resp.status_code == 422
        resp = create_monitor(client, auth, interval_seconds=100000)
        assert resp.status_code == 422

    def test_create_timeout_bounds(self, client, auth):
        resp = create_monitor(client, auth, timeout_seconds=60)
        assert resp.status_code == 422

    def test_create_monitor_limit(self, client, auth, monkeypatch):
        monkeypatch.setattr(get_settings(), "max_monitors_per_user", 2)
        assert create_monitor(client, auth).status_code == 201
        assert create_monitor(client, auth, name="m2").status_code == 201
        resp = create_monitor(client, auth, name="m3")
        assert resp.status_code == 409
        assert resp.json()["error"]["code"] == "monitor_limit_reached"


class TestListAndOwnership:
    def test_list_returns_own_monitors(self, client, auth):
        create_monitor(client, auth, name="one")
        create_monitor(client, auth, name="two")
        resp = client.get("/api/monitors", headers=auth)
        assert resp.status_code == 200
        names = [m["name"] for m in resp.json()]
        assert names == ["one", "two"]

    def test_list_requires_auth(self, client):
        assert client.get("/api/monitors").status_code == 401

    def test_user_isolation_on_get(self, client, auth, auth_b):
        created = create_monitor(client, auth).json()
        resp = client.get(f"/api/monitors/{created['id']}", headers=auth_b)
        assert resp.status_code == 404

    def test_user_isolation_on_list(self, client, auth, auth_b):
        create_monitor(client, auth)
        resp = client.get("/api/monitors", headers=auth_b)
        assert resp.status_code == 200
        assert resp.json() == []

    def test_unknown_monitor_is_404(self, client, auth):
        resp = client.get("/api/monitors/9999", headers=auth)
        assert resp.status_code == 404

    def test_user_isolation_on_update(self, client, auth, auth_b):
        created = create_monitor(client, auth).json()
        resp = client.put(
            f"/api/monitors/{created['id']}", json={"name": "hijack"}, headers=auth_b
        )
        assert resp.status_code == 404

    def test_user_isolation_on_delete(self, client, auth, auth_b):
        created = create_monitor(client, auth).json()
        resp = client.delete(f"/api/monitors/{created['id']}", headers=auth_b)
        assert resp.status_code == 404

    def test_user_isolation_on_check(self, client, auth, auth_b):
        created = create_monitor(client, auth).json()
        resp = client.post(f"/api/monitors/{created['id']}/check", headers=auth_b)
        assert resp.status_code == 404


class TestUpdateAndDelete:
    def test_update_fields(self, client, auth):
        created = create_monitor(client, auth).json()
        resp = client.put(
            f"/api/monitors/{created['id']}",
            json={"name": "Renamed", "interval_seconds": 60, "keyword_mode": "not_contains"},
            headers=auth,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] == "Renamed"
        assert body["interval_seconds"] == 60
        assert body["keyword_mode"] == "not_contains"
        assert body["expected_status"] == 200  # untouched

    def test_update_invalid_interval(self, client, auth):
        created = create_monitor(client, auth).json()
        resp = client.put(
            f"/api/monitors/{created['id']}", json={"interval_seconds": 5}, headers=auth
        )
        assert resp.status_code == 422

    def test_update_bad_url_rejected(self, client, auth):
        created = create_monitor(client, auth).json()
        resp = client.put(
            f"/api/monitors/{created['id']}",
            json={"target_url": "http://127.0.0.1/"},
            headers=auth,
        )
        assert resp.status_code == 400

    def test_update_cannot_break_keyword_type(self, client, auth):
        created = create_monitor(client, auth, type="keyword", keyword="hi").json()
        resp = client.put(
            f"/api/monitors/{created['id']}", json={"keyword": None}, headers=auth
        )
        assert resp.status_code == 422

    def test_delete(self, client, auth, db_session):
        created = create_monitor(client, auth).json()
        db_session.add(MonitorCheck(monitor_id=created["id"], status="up"))
        db_session.commit()
        resp = client.delete(f"/api/monitors/{created['id']}", headers=auth)
        assert resp.status_code == 204
        assert client.get(f"/api/monitors/{created['id']}", headers=auth).status_code == 404
        assert db_session.query(MonitorCheck).count() == 0  # cascade


class TestEnableDisable:
    def test_disable_and_enable(self, client, auth):
        created = create_monitor(client, auth).json()
        mid = created["id"]

        resp = client.post(f"/api/monitors/{mid}/disable", headers=auth)
        assert resp.status_code == 200
        assert resp.json()["enabled"] is False

        resp = client.post(f"/api/monitors/{mid}/enable", headers=auth)
        assert resp.status_code == 200
        assert resp.json()["enabled"] is True
        assert resp.json()["next_check_at"] is not None


class TestCheckNow:
    def _fake_engine_checker(self, monkeypatch, handler):
        real = engine_module.HTTPChecker
        monkeypatch.setattr(
            engine_module,
            "HTTPChecker",
            lambda: real(transport=httpx.MockTransport(handler), sleep_fn=lambda s: None),
        )

    def test_check_now_success(self, client, auth, monkeypatch, db_session):
        created = create_monitor(client, auth).json()
        self._fake_engine_checker(
            monkeypatch, lambda request: httpx.Response(200, text="pong")
        )
        resp = client.post(f"/api/monitors/{created['id']}/check", headers=auth)
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "up"
        assert body["http_status"] == 200
        assert body["latency_ms"] >= 0

        row = db_session.query(MonitorCheck).one()
        assert row.status == "up"
        assert row.monitor_id == created["id"]

        updated = client.get(f"/api/monitors/{created['id']}", headers=auth).json()
        assert updated["last_status"] == "up"
        assert updated["last_latency_ms"] == body["latency_ms"]

    def test_check_now_failure_recorded(self, client, auth, monkeypatch):
        created = create_monitor(client, auth).json()
        self._fake_engine_checker(monkeypatch, lambda request: httpx.Response(503))
        resp = client.post(f"/api/monitors/{created['id']}/check", headers=auth)
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "down"
        assert body["error_type"] == "status_mismatch"

    def test_check_now_unauthenticated(self, client):
        assert client.post("/api/monitors/1/check").status_code == 401
