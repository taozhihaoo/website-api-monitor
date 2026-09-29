
from datetime import timedelta

from app.models.base import utcnow
from app.models.check import MonitorCheck
from app.models.incident import Incident
from app.monitoring.checker import CheckOutcome
from app.monitoring.engine import run_check
from app.services.incident_service import record_result
from tests.factories import make_monitor
from tests.utils import create_user


def _checked_monitor(db_session, **kw):
    user = create_user(db_session)
    monitor = make_monitor(user_id=user.id, id=None, **kw)
    db_session.add(monitor)
    db_session.commit()
    return monitor


def _check(db_session, monitor, status):
    row = MonitorCheck(
        monitor_id=monitor.id, checked_at=utcnow(), status=status, error_type=None
    )
    db_session.add(row)
    db_session.commit()
    return row


class TestIncidentStateMachine:
    def test_up_to_down_opens_incident(self, db_session):
        monitor = _checked_monitor(db_session)
        incident, opened, resolved = record_result(
            db_session, monitor, _check(db_session, monitor, "down")
        )
        assert opened and not resolved
        assert incident.failure_count == 1
        assert incident.is_resolved is False
        assert incident.started_at is not None

    def test_down_to_down_extends_same_incident(self, db_session):
        monitor = _checked_monitor(db_session)
        first, _, _ = record_result(db_session, monitor, _check(db_session, monitor, "down"))
        second, opened, _ = record_result(db_session, monitor, _check(db_session, monitor, "down"))
        assert not opened
        assert second.id == first.id
        assert second.failure_count == 2

    def test_down_to_up_closes_incident(self, db_session):
        monitor = _checked_monitor(db_session)
        incident, _, _ = record_result(db_session, monitor, _check(db_session, monitor, "down"))
        resolved_incident, opened, resolved = record_result(
            db_session, monitor, _check(db_session, monitor, "up")
        )
        assert not opened and resolved
        assert resolved_incident.id == incident.id
        assert resolved_incident.is_resolved is True
        assert resolved_incident.resolved_at is not None
        assert resolved_incident.duration_seconds >= 0

    def test_up_up_creates_nothing(self, db_session):
        monitor = _checked_monitor(db_session)
        incident, opened, resolved = record_result(
            db_session, monitor, _check(db_session, monitor, "up")
        )
        assert incident is None and not opened and not resolved

    def test_new_incident_after_recovery(self, db_session):
        monitor = _checked_monitor(db_session)
        first, _, _ = record_result(db_session, monitor, _check(db_session, monitor, "down"))
        record_result(db_session, monitor, _check(db_session, monitor, "up"))
        second, opened, _ = record_result(db_session, monitor, _check(db_session, monitor, "down"))
        assert opened
        assert second.id != first.id

    def test_cause_from_error_message(self, db_session):
        monitor = _checked_monitor(db_session)
        row = MonitorCheck(
            monitor_id=monitor.id,
            checked_at=utcnow(),
            status="down",
            error_type="timeout",
            error_message="Request timed out",
        )
        db_session.add(row)
        db_session.commit()
        incident, _, _ = record_result(db_session, monitor, row)
        assert incident.cause == "Request timed out"


class TestEngineIncidentIntegration:
    def test_check_cycle_creates_and_resolves_incident(self, db_session):
        monitor = _checked_monitor(db_session)
        down = _Fixed(CheckOutcome(status="down", error_message="500 error"))
        run_check(db_session, monitor, down)
        run_check(db_session, monitor, down)
        incident = db_session.query(Incident).one()
        assert incident.failure_count == 2
        assert incident.cause == "500 error"
        assert monitor.last_status == "down"

        run_check(db_session, monitor, _Fixed(CheckOutcome(status="up")))
        incident = db_session.query(Incident).one()
        assert incident.is_resolved is True
        assert incident.duration_seconds is not None
        assert monitor.last_status == "up"


class TestIncidentEndpoints:
    def test_monitor_incidents_endpoint(self, client, db_session):
        from tests.utils import register_and_login

        user = create_user(db_session)
        monitor = make_monitor(user_id=user.id, id=None, last_status="down")
        db_session.add(monitor)
        db_session.commit()
        db_session.add(
            Incident(
                monitor_id=monitor.id,
                failure_count=3,
                cause="HTTP 503",
                started_at=utcnow() - timedelta(minutes=10),
            )
        )
        db_session.add(
            Incident(
                monitor_id=monitor.id,
                failure_count=1,
                is_resolved=True,
                started_at=utcnow() - timedelta(minutes=5),
                resolved_at=utcnow(),
                duration_seconds=120,
            )
        )
        db_session.commit()

        headers = register_and_login(client, email=user.email)
        resp = client.get(f"/api/monitors/{monitor.id}/incidents", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 2
        # newest first: the resolved incident started 5 minutes ago
        assert body["items"][0]["is_resolved"] is True
        assert body["items"][0]["duration_seconds"] == 120
        assert body["items"][1]["is_resolved"] is False
        assert body["items"][1]["failure_count"] == 3

    def test_incidents_list_with_active_filter(self, client, db_session):
        from tests.utils import register_and_login

        user = create_user(db_session)
        m1 = make_monitor(user_id=user.id, id=None, name="m1")
        m2 = make_monitor(user_id=user.id, id=None, name="m2")
        db_session.add_all([m1, m2])
        db_session.commit()
        db_session.add(Incident(monitor_id=m1.id, failure_count=1))
        db_session.add(Incident(monitor_id=m2.id, failure_count=1, is_resolved=True))
        db_session.commit()

        headers = register_and_login(client, email=user.email)
        body = client.get("/api/incidents?active=true", headers=headers).json()
        assert body["total"] == 1
        assert body["items"][0]["monitor_name"] == "m1"

        body = client.get("/api/incidents", headers=headers).json()
        assert body["total"] == 2

    def test_incidents_isolated_per_user(self, client, db_session):
        from tests.utils import register_and_login

        user = create_user(db_session, email="inc-a@example.com")
        other = create_user(db_session, email="inc-b@example.com")
        monitor = make_monitor(user_id=user.id, id=None)
        db_session.add(monitor)
        db_session.commit()
        db_session.add(Incident(monitor_id=monitor.id, failure_count=1))
        db_session.commit()

        headers = register_and_login(client, email=other.email)
        assert client.get("/api/incidents", headers=headers).json()["total"] == 0

    def test_incidents_require_auth(self, client):
        assert client.get("/api/incidents").status_code == 401


class _Fixed:
    def __init__(self, outcome):
        self.outcome = outcome

    def check(self, monitor):
        return self.outcome
