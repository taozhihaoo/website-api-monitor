"""Manual check execution service (thin wrapper over the engine)."""

from sqlalchemy.orm import Session

from app.models.check import MonitorCheck
from app.models.monitor import Monitor
from app.monitoring.engine import run_check


def run_manual_check(db: Session, monitor: Monitor) -> MonitorCheck:
    """Run one check immediately, outside the scheduler, and persist it."""
    return run_check(db, monitor)
