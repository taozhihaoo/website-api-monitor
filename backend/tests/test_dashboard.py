from app.models.base import utcnow
from app.models.check import MonitorCheck
from app.services.dashboard_service import dashboard_summary
from tests.factories import make_monitor
from tests.utils import create_user


def seed_monitor(db_session, **overrides):
    user = create_user(db_session)
    monitor = make_monitor(user_id=user.id, id=None, **overrides)
    db_session.add(monitor)
    db_session.commit()
    return monitor


def seed_check(db_session, monitor_id, status, minutes_ago=0):
    from datetime import timedelta

    db_session.add(
        MonitorCheck(
            monitor_id=monitor_id,
            status=status,
            checked_at=utcnow() - timedelta(minutes=minutes_ago),
        )
    )
    db_session.commit()


class TestDashboardSummary:
    def test_empty(self, db_session):
        user = create_user(db_session)
        summary = dashboard_summary(db_session, user.id)
        assert summary["total_monitors"] == 0
        assert summary["uptime_24h"] is None
        assert summary["active_incidents"] == 0

    def test_counts(self, db_session):
        user = create_user(db_session)
        up_m = make_monitor(user_id=user.id, id=None, last_status="up")
        down_m = make_monitor(user_id=user.id, id=None, last_status="down")
        paused_m = make_monitor(user_id=user.id, id=None, last_status="up", enabled=False)
        pending_m = make_monitor(user_id=user.id, id=None, last_status=None)
        db_session.add_all([up_m, down_m, paused_m, pending_m])
        db_session.commit()

        seed_check(db_session, up_m.id, "up")
        seed_check(db_session, down_m.id, "up")
        seed_check(db_session, down_m.id, "down")

        summary = dashboard_summary(db_session, user.id)
        assert summary["total_monitors"] == 4
        assert summary["up"] == 1
        assert summary["down"] == 1
        assert summary["paused"] == 1
        assert summary["pending"] == 1
        # overall uptime: 2 up of 3 checks across monitors (paused excluded from checks anyway)
        assert summary["uptime_24h"] == round(2 / 3 * 100, 2)

    def test_user_isolation(self, db_session):
        user_a = create_user(db_session, email="a@example.com")
        user_b = create_user(db_session, email="b@example.com")
        monitor_a = make_monitor(user_id=user_a.id, id=None, last_status="up")
        db_session.add(monitor_a)
        db_session.commit()
        summary_b = dashboard_summary(db_session, user_b.id)
        assert summary_b["total_monitors"] == 0

    def test_active_incidents_counted(self, db_session):
        from app.models.incident import Incident

        user = create_user(db_session)
        monitor = make_monitor(user_id=user.id, id=None, last_status="down")
        db_session.add(monitor)
        db_session.commit()
        db_session.add(Incident(monitor_id=monitor.id, failure_count=1, is_resolved=False))
        db_session.commit()
        summary = dashboard_summary(db_session, user.id)
        assert summary["active_incidents"] == 1


class TestDashboardEndpoint:
    def test_summary_endpoint(self, client, db_session):
        from tests.utils import register_and_login

        headers = register_and_login(client)
        client.post(
            "/api/monitors",
            json={"name": "m", "target_url": "https://api.example.com/"},
            headers=headers,
        )
        resp = client.get("/api/dashboard/summary", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["total_monitors"] == 1
        assert body["pending"] == 1
        assert "generated_at" in body

    def test_summary_requires_auth(self, client):
        assert client.get("/api/dashboard/summary").status_code == 401
