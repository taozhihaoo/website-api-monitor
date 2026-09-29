
from datetime import UTC

from app.models.base import utcnow
from app.monitoring.checker import CheckOutcome
from app.monitoring.engine import run_check
from tests.factories import make_monitor
from tests.utils import create_user


class RecordingChecker:
    def __init__(self, outcome: CheckOutcome):
        self.outcome = outcome
        self.checked = None

    def check(self, monitor):
        self.checked = monitor
        return self.outcome


class CrashingChecker:
    def check(self, monitor):
        raise RuntimeError("boom")


def _db_monitor(db_session):
    user = create_user(db_session)
    monitor = make_monitor(user_id=user.id, id=None)
    db_session.add(monitor)
    db_session.commit()
    return monitor


class TestEngine:
    def test_successful_check_persists_and_updates_monitor(self, db_session):
        monitor = _db_monitor(db_session)
        outcome = CheckOutcome(status="up", http_status=200, latency_ms=42)
        row = run_check(db_session, monitor, RecordingChecker(outcome))

        assert row.id is not None
        assert row.status == "up"
        assert row.latency_ms == 42
        assert monitor.last_status == "up"
        assert monitor.last_checked_at is not None
        assert monitor.next_check_at is not None
        assert monitor.next_check_at > utcnow()  # advanced by interval
        assert (monitor.next_check_at - monitor.last_checked_at).total_seconds() == 300

    def test_ssl_cache_updated(self, db_session):
        from datetime import datetime, timedelta

        monitor = _db_monitor(db_session)
        expires = datetime.now(UTC) + timedelta(days=45)
        outcome = CheckOutcome(
            status="up", ssl_status="valid", ssl_days_remaining=45, ssl_expires_at=expires
        )
        run_check(db_session, monitor, RecordingChecker(outcome))
        assert monitor.ssl_days_remaining == 45
        assert monitor.ssl_expires_at is not None
        assert monitor.ssl_last_checked_at is not None

    def test_crashing_checker_becomes_internal_error_down(self, db_session):
        monitor = _db_monitor(db_session)
        row = run_check(db_session, monitor, CrashingChecker())
        assert row.status == "down"
        assert row.error_type == "internal_error"
        assert monitor.last_status == "down"

    def test_checked_at_is_utc_now(self, db_session):
        monitor = _db_monitor(db_session)
        before = utcnow()
        row = run_check(db_session, monitor, RecordingChecker(CheckOutcome(status="up")))
        assert row.checked_at >= before
        assert row.checked_at.tzinfo is not None
