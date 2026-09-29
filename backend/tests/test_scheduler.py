from datetime import timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.base import Base, utcnow
from app.models.check import MonitorCheck
from app.models.monitor import Monitor
from app.scheduler.scheduler import Scheduler, due_monitor_ids
from tests.factories import make_monitor
from tests.utils import create_user


@pytest.fixture()
def factory(tmp_path):
    """File-based SQLite so scheduler worker threads get their own connections
    (the in-memory StaticPool engine is single-connection, not thread-safe)."""
    engine = create_engine(
        f"sqlite:///{tmp_path / 'sched.db'}",
        connect_args={"check_same_thread": False},
        future=True,
    )
    Base.metadata.create_all(engine)
    yield sessionmaker(bind=engine, expire_on_commit=False, future=True)
    engine.dispose()


def seed_monitor(factory, **overrides) -> int:
    with factory() as db:
        user = create_user(db)
        monitor = make_monitor(user_id=user.id, id=None, **overrides)
        db.add(monitor)
        db.commit()
        return monitor.id


def get_monitor(factory, monitor_id):
    with factory() as db:
        monitor = db.get(Monitor, monitor_id)
        if monitor is None:
            return None
        db.expunge(monitor)
        return monitor


class RecordingChecker:
    def __init__(self, outcome_status="up"):
        self.status = outcome_status
        self.checked_ids = []

    def __call__(self):
        return self

    def check(self, monitor):
        self.checked_ids.append(monitor.id)
        from app.monitoring.checker import CheckOutcome

        return CheckOutcome(status=self.status, http_status=200, latency_ms=10)


class ExplodingChecker:
    def __call__(self):
        return self

    def check(self, monitor):
        raise RuntimeError("checker exploded")


def make_scheduler(factory, **kw):
    defaults = dict(
        session_factory=factory,
        scan_interval=10.0,
        max_workers=4,
        sleep_fn=lambda s: None,
    )
    defaults.update(kw)
    return Scheduler(**defaults)


class TestDueMonitorIds:
    def test_only_enabled_and_due(self, factory):
        with factory() as db:
            due_enabled = seed_monitor(factory, next_check_at=utcnow() - timedelta(seconds=5))
            seed_monitor(factory, next_check_at=utcnow() + timedelta(minutes=5))
            seed_monitor(
                factory, enabled=False, next_check_at=utcnow() - timedelta(seconds=5)
            )
            seed_monitor(factory, next_check_at=None)
            ids = due_monitor_ids(db, utcnow())
        assert ids == [due_enabled]

    def test_exclude_running(self, factory):
        with factory() as db:
            m = seed_monitor(factory, next_check_at=utcnow() - timedelta(seconds=5))
            ids = due_monitor_ids(db, utcnow(), exclude={m})
        assert ids == []


class TestScanOnce:
    def test_due_monitor_is_checked(self, factory):
        monitor_id = seed_monitor(factory, next_check_at=utcnow() - timedelta(seconds=5))
        checker = RecordingChecker()
        scheduler = make_scheduler(factory, checker_factory=checker)
        assert scheduler.scan_once() == 1
        assert checker.checked_ids == [monitor_id]
        assert scheduler.scan_once() == 0  # next_check_at advanced

    def test_disabled_monitor_not_checked(self, factory):
        seed_monitor(factory, enabled=False, next_check_at=utcnow() - timedelta(seconds=5))
        checker = RecordingChecker()
        scheduler = make_scheduler(factory, checker_factory=checker)
        assert scheduler.scan_once() == 0
        assert checker.checked_ids == []

    def test_worker_persists_check_and_advances_schedule(self, factory):
        monitor_id = seed_monitor(factory, next_check_at=utcnow() - timedelta(seconds=5))
        scheduler = make_scheduler(factory, checker_factory=RecordingChecker())
        scheduler.scan_once()
        scheduler._pool.shutdown(wait=True)

        monitor = get_monitor(factory, monitor_id)
        assert monitor.last_status == "up"
        assert monitor.next_check_at is not None and monitor.next_check_at > utcnow()
        with factory() as db:
            rows = db.query(MonitorCheck).filter_by(monitor_id=monitor_id).all()
        assert len(rows) == 1 and rows[0].status == "up"

    def test_check_failure_isolated(self, factory):
        """An exploding checker must not prevent dispatch or break the scan."""
        monitor_id = seed_monitor(factory, next_check_at=utcnow() - timedelta(seconds=5))
        scheduler = make_scheduler(factory, checker_factory=ExplodingChecker())
        assert scheduler.scan_once() == 1  # must not raise
        scheduler._pool.shutdown(wait=True)

        monitor = get_monitor(factory, monitor_id)
        assert monitor.last_status == "down"  # engine recorded internal_error

    def test_running_set_prevents_overlap(self, factory):
        monitor_id = seed_monitor(factory, next_check_at=utcnow() - timedelta(seconds=5))
        scheduler = make_scheduler(factory, checker_factory=RecordingChecker())
        scheduler._running.add(monitor_id)
        assert scheduler.scan_once() == 0

    def test_retention_runs(self, factory):
        from datetime import timedelta as td

        monitor_id = seed_monitor(factory, next_check_at=None)
        with factory() as db:
            db.add(
                MonitorCheck(
                    monitor_id=monitor_id,
                    status="up",
                    checked_at=utcnow() - td(days=60),
                )
            )
            db.commit()
        scheduler = make_scheduler(factory, checker_factory=RecordingChecker())
        scheduler._maybe_retention()
        with factory() as db:
            assert db.query(MonitorCheck).count() == 0  # default retention 30d

    def test_scheduler_thread_start_stop(self, factory):
        scheduler = make_scheduler(factory, scan_interval=0.05)
        scheduler.start()
        assert scheduler._thread is not None and scheduler._thread.is_alive()
        scheduler.start()  # idempotent
        scheduler.stop()
        assert scheduler._thread is None
