from datetime import timedelta

import pytest

from app.models.base import utcnow
from app.models.check import MonitorCheck
from app.services.uptime_service import latency_stats, parse_window, uptime_stats
from tests.utils import create_user


def seed_monitor(db_session):
    user = create_user(db_session)
    from tests.factories import make_monitor

    monitor = make_monitor(user_id=user.id, id=None)
    db_session.add(monitor)
    db_session.commit()
    return monitor


def seed_check(db_session, monitor_id, status, minutes_ago=0, latency_ms=None):
    db_session.add(
        MonitorCheck(
            monitor_id=monitor_id,
            status=status,
            latency_ms=latency_ms,
            checked_at=utcnow() - timedelta(minutes=minutes_ago),
        )
    )
    db_session.commit()


class TestUptimeStats:
    def test_all_up(self, db_session):
        m = seed_monitor(db_session)
        seed_check(db_session, m.id, "up", minutes_ago=10)
        seed_check(db_session, m.id, "up", minutes_ago=5)
        stats = uptime_stats(db_session, m.id, timedelta(hours=24))
        assert stats == {"total_checks": 2, "up_checks": 2, "uptime_percentage": 100.0}

    def test_mixed(self, db_session):
        m = seed_monitor(db_session)
        seed_check(db_session, m.id, "up", minutes_ago=10)
        seed_check(db_session, m.id, "down", minutes_ago=5)
        seed_check(db_session, m.id, "down", minutes_ago=1)
        stats = uptime_stats(db_session, m.id, timedelta(hours=24))
        assert stats["total_checks"] == 3
        assert stats["up_checks"] == 1
        assert stats["uptime_percentage"] == round(1 / 3 * 100, 2)

    def test_window_excludes_old_checks(self, db_session):
        m = seed_monitor(db_session)
        seed_check(db_session, m.id, "down", minutes_ago=25 * 60)  # 25h old
        seed_check(db_session, m.id, "up", minutes_ago=60)
        stats = uptime_stats(db_session, m.id, timedelta(hours=24))
        assert stats["total_checks"] == 1
        assert stats["uptime_percentage"] == 100.0

    def test_no_checks(self, db_session):
        m = seed_monitor(db_session)
        stats = uptime_stats(db_session, m.id, timedelta(hours=24))
        assert stats == {"total_checks": 0, "up_checks": 0, "uptime_percentage": None}


class TestLatencyStats:
    def test_avg_min_max(self, db_session):
        m = seed_monitor(db_session)
        seed_check(db_session, m.id, "up", minutes_ago=10, latency_ms=100)
        seed_check(db_session, m.id, "up", minutes_ago=5, latency_ms=300)
        seed_check(db_session, m.id, "down", minutes_ago=1, latency_ms=200)
        stats = latency_stats(db_session, m.id, timedelta(hours=24))
        assert stats == {"avg_ms": 200, "min_ms": 100, "max_ms": 300, "count": 3}

    def test_null_latency_excluded(self, db_session):
        m = seed_monitor(db_session)
        seed_check(db_session, m.id, "down", minutes_ago=5, latency_ms=None)
        assert latency_stats(db_session, m.id, timedelta(hours=24)) is None

    def test_window_filter(self, db_session):
        m = seed_monitor(db_session)
        seed_check(db_session, m.id, "up", minutes_ago=2 * 60, latency_ms=999)
        seed_check(db_session, m.id, "up", minutes_ago=30, latency_ms=100)
        stats = latency_stats(db_session, m.id, timedelta(hours=1))
        assert stats["avg_ms"] == 100 and stats["count"] == 1


class TestParseWindow:
    def test_known_windows(self):
        assert parse_window("1h") == timedelta(hours=1)
        assert parse_window("24h") == timedelta(hours=24)
        assert parse_window("7d") == timedelta(days=7)
        assert parse_window("30d") == timedelta(days=30)

    def test_unknown_window_raises(self):
        from app.api.errors import ApiError

        with pytest.raises(ApiError) as exc:
            parse_window("2h")
        assert exc.value.status_code == 400


class TestUptimeEndpoints:
    def test_uptime_endpoint(self, client):
        from tests.utils import register_and_login

        headers = register_and_login(client)
        m = client.post(
            "/api/monitors",
            json={"name": "m", "target_url": "https://api.example.com/"},
            headers=headers,
        ).json()
        resp = client.get(f"/api/monitors/{m['id']}/uptime?window=24h", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["window"] == "24h"
        assert body["uptime_percentage"] is None
        assert body["total_checks"] == 0

    def test_uptime_invalid_window(self, client):
        from tests.utils import register_and_login

        headers = register_and_login(client)
        m = client.post(
            "/api/monitors",
            json={"name": "m", "target_url": "https://api.example.com/"},
            headers=headers,
        ).json()
        resp = client.get(f"/api/monitors/{m['id']}/uptime?window=2h", headers=headers)
        assert resp.status_code == 400

    def test_checks_pagination_and_filter(self, client, db_session):
        from tests.utils import register_and_login

        headers = register_and_login(client)
        m = client.post(
            "/api/monitors",
            json={"name": "m", "target_url": "https://api.example.com/"},
            headers=headers,
        ).json()
        for i in range(5):
            seed_check(db_session, m["id"], "up", minutes_ago=i * 10, latency_ms=100 + i)
        resp = client.get(f"/api/monitors/{m['id']}/checks?limit=2&offset=0", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 5
        assert len(body["items"]) == 2
        # newest first: i=0 was seeded 0 minutes ago with latency 100
        assert body["items"][0]["latency_ms"] == 100

        resp = client.get(f"/api/monitors/{m['id']}/checks?offset=4&limit=2", headers=headers)
        assert len(resp.json()["items"]) == 1

        resp = client.get(f"/api/monitors/{m['id']}/checks?hours=1", headers=headers)
        # all five checks (0..40 minutes ago) are inside the 1h window
        assert resp.json()["total"] == 5

    def test_checks_ownership(self, client, db_session):
        from tests.utils import register_and_login

        headers_a = register_and_login(client, email="a@example.com")
        headers_b = register_and_login(client, email="b@example.com")
        m = client.post(
            "/api/monitors",
            json={"name": "m", "target_url": "https://api.example.com/"},
            headers=headers_a,
        ).json()
        resp = client.get(f"/api/monitors/{m['id']}/checks", headers=headers_b)
        assert resp.status_code == 404

    def test_detail_includes_latency_stats(self, client, db_session):
        from tests.utils import register_and_login

        headers = register_and_login(client)
        m = client.post(
            "/api/monitors",
            json={"name": "m", "target_url": "https://api.example.com/"},
            headers=headers,
        ).json()
        seed_check(db_session, m["id"], "up", minutes_ago=5, latency_ms=123)
        detail = client.get(f"/api/monitors/{m['id']}", headers=headers).json()
        assert detail["latency_stats"]["avg_ms"] == 123
        assert detail["uptime_24h"] == 100.0
