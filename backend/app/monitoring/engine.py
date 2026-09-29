"""Check Engine: runs a check and persists the result.

Persistence owns the monitor's denormalized state (last_status, next_check_at,
SSL cache). Incident transitions and notifications hook in after persistence.
A crashing checker must never raise out of here — it becomes a DOWN check.
"""

import logging
from datetime import timedelta

from sqlalchemy.orm import Session

from app.models.base import utcnow
from app.models.check import ERROR_TYPE_INTERNAL, MonitorCheck
from app.models.monitor import Monitor
from app.monitoring.checker import CheckOutcome, HTTPChecker

logger = logging.getLogger("sitewatch.engine")


def run_check(
    db: Session, monitor: Monitor, checker: HTTPChecker | None = None
) -> MonitorCheck:
    try:
        outcome = (checker or HTTPChecker()).check(monitor)
    except Exception as exc:  # noqa: BLE001 — monitoring bugs must not kill the loop
        logger.exception("Checker crashed for monitor %s", monitor.id)
        outcome = CheckOutcome(
            status="down",
            error_type=ERROR_TYPE_INTERNAL,
            error_message=str(exc)[:500],
        )

    now = utcnow()
    row = MonitorCheck(
        monitor_id=monitor.id,
        checked_at=now,
        status=outcome.status,
        http_status=outcome.http_status,
        latency_ms=outcome.latency_ms,
        error_type=outcome.error_type,
        error_message=outcome.error_message,
        keyword_result=outcome.keyword_result,
        json_result=outcome.json_result,
        ssl_days_remaining=outcome.ssl_days_remaining,
        ssl_status=outcome.ssl_status,
    )
    db.add(row)

    monitor.last_status = outcome.status
    monitor.last_checked_at = now
    monitor.next_check_at = now + timedelta(seconds=monitor.interval_seconds)

    if outcome.ssl_expires_at is not None or outcome.ssl_days_remaining is not None:
        monitor.ssl_expires_at = outcome.ssl_expires_at
        monitor.ssl_days_remaining = outcome.ssl_days_remaining
        monitor.ssl_last_checked_at = now

    db.commit()
    db.refresh(row)
    return row
