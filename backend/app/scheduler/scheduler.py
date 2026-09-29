"""Single-process scheduler.

Design (see docs/DESIGN.md section F):

- one daemon thread scans the ``monitors`` table every SCHEDULER_SCAN_INTERVAL;
- every enabled monitor with ``next_check_at <= now`` is dispatched to a bounded
  ThreadPoolExecutor (MAX_CONCURRENT_CHECKS);
- ``next_check_at`` is advanced *at dispatch time* so the next scan never
  double-dispatches, even if the check takes longer than the scan interval;
- a per-monitor in-flight set guards against overlap;
- restart recovery is implicit: ``next_check_at`` lives in the database, so
  overdue monitors are immediately due after a restart;
- one monitor failing never blocks the others;
- a daily retention pass prunes old check history.

This is intentionally single-instance: run exactly one backend process against
one database (documented in README → Limitations).
"""

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings
from app.models.base import utcnow
from app.models.monitor import Monitor
from app.monitoring.engine import run_check
from app.services.retention_service import delete_old_checks

logger = logging.getLogger("sitewatch.scheduler")


def due_monitor_ids(db: Session, now: datetime, exclude: set[int] | None = None) -> list[int]:
    query = select(Monitor.id).where(
        Monitor.enabled.is_(True),
        Monitor.next_check_at.is_not(None),
        Monitor.next_check_at <= now,
    )
    if exclude:
        query = query.where(Monitor.id.not_in(exclude))
    return list(db.scalars(query).all())


class Scheduler:
    def __init__(
        self,
        session_factory: sessionmaker,
        scan_interval: float | None = None,
        max_workers: int | None = None,
        checker_factory=None,
        sleep_fn=time.sleep,
    ):
        settings = get_settings()
        self.session_factory = session_factory
        self.scan_interval = scan_interval or settings.scheduler_scan_interval_seconds
        self.checker_factory = checker_factory
        self._sleep = sleep_fn
        self._running: set[int] = set()
        self._running_lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._pool = ThreadPoolExecutor(
            max_workers=max_workers or settings.max_concurrent_checks,
            thread_name_prefix="sitewatch-check",
        )
        self._last_retention_day: str | None = None

    # -- lifecycle ------------------------------------------------------------

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._loop, name="sitewatch-scheduler", daemon=True
        )
        self._thread.start()
        logger.info("Scheduler started (scan every %.0fs)", self.scan_interval)

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=10)
            self._thread = None
        self._pool.shutdown(wait=False, cancel_futures=True)
        logger.info("Scheduler stopped")

    # -- loop -------------------------------------------------------------------

    def _loop(self) -> None:
        while not self._stop_event.is_set():
            started = time.monotonic()
            try:
                self.scan_once()
            except Exception:  # noqa: BLE001 — the loop must survive anything
                logger.exception("Scheduler scan failed")
            elapsed = time.monotonic() - started
            self._stop_event.wait(max(0.0, self.scan_interval - elapsed))

    def scan_once(self) -> int:
        """Dispatch all due monitors once. Returns the number dispatched."""
        now = utcnow()
        dispatched = 0
        with self.session_factory() as db:
            exclude = set(self._running)
            for monitor_id in due_monitor_ids(db, now, exclude=exclude):
                monitor = db.get(Monitor, monitor_id)
                if monitor is None or not monitor.enabled:
                    continue
                # Reserve now: the next scan will not pick this monitor again
                # even while the check is still running.
                monitor.next_check_at = now + timedelta(seconds=monitor.interval_seconds)
                db.commit()
                with self._running_lock:
                    self._running.add(monitor_id)
                try:
                    self._pool.submit(self._run_one, monitor_id)
                    dispatched += 1
                except RuntimeError:  # pool shutting down
                    with self._running_lock:
                        self._running.discard(monitor_id)
        self._maybe_retention()
        return dispatched

    def _run_one(self, monitor_id: int) -> None:
        try:
            with self.session_factory() as db:
                monitor = db.get(Monitor, monitor_id)
                if monitor is None or not monitor.enabled:
                    return
                checker = self.checker_factory() if self.checker_factory else None
                run_check(db, monitor, checker)
        except Exception:  # noqa: BLE001 — isolate single-monitor failures
            logger.exception("Scheduled check failed for monitor %s", monitor_id)
        finally:
            with self._running_lock:
                self._running.discard(monitor_id)

    def _maybe_retention(self) -> None:
        today = datetime.now(UTC).strftime("%Y-%m-%d")
        if self._last_retention_day == today:
            return
        self._last_retention_day = today
        retention_days = get_settings().retention_days
        if retention_days <= 0:
            return
        try:
            with self.session_factory() as db:
                deleted = delete_old_checks(db, retention_days)
            if deleted:
                logger.info("Retention: deleted %d checks older than %dd", deleted, retention_days)
        except Exception:  # noqa: BLE001
            logger.exception("Retention pass failed")

    @property
    def running_monitor_ids(self) -> set[int]:
        with self._running_lock:
            return set(self._running)


_scheduler: Scheduler | None = None


def start_scheduler() -> Scheduler:
    global _scheduler
    if _scheduler is None:
        from app.database import SessionLocal

        _scheduler = Scheduler(SessionLocal)
    if _scheduler._thread is None or not _scheduler._thread.is_alive():
        _scheduler.start()
    return _scheduler


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.stop()
        _scheduler = None


def get_scheduler() -> Scheduler | None:
    return _scheduler
