"""Check Engine: runs a check and persists the result.

Pipeline per check:

  checker → CheckOutcome → monitor_checks row
          → monitor denormalized state (last_status, next_check_at, SSL cache)
          → incident state machine (open / extend / close)
          → notifications on transitions only (down / recovered / ssl events)

A crashing checker must never raise out of here — it becomes a DOWN check.
Notification delivery failures must never flip a check result either.
"""

import logging
from datetime import timedelta

from sqlalchemy.orm import Session

from app.models.base import utcnow
from app.models.check import ERROR_TYPE_INTERNAL, MonitorCheck
from app.models.monitor import Monitor
from app.monitoring.checker import CheckOutcome, HTTPChecker
from app.notifications import NotificationService, compute_ssl_alert_state
from app.services.incident_service import record_result

logger = logging.getLogger("sitewatch.engine")


def run_check(
    db: Session,
    monitor: Monitor,
    checker: HTTPChecker | None = None,
    notifier: NotificationService | None = None,
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

    # --- incident state machine ------------------------------------------------
    incident, opened, resolved = record_result(db, monitor, row)

    # --- SSL alert state machine (dedup: notify only on state transitions) ----
    new_ssl_state = compute_ssl_alert_state(
        outcome.ssl_days_remaining, monitor.ssl_warning_days
    )
    ssl_transition: str | None = None
    if new_ssl_state is not None and new_ssl_state != (monitor.ssl_alert_state or ""):
        previous = monitor.ssl_alert_state or ""
        monitor.ssl_alert_state = new_ssl_state
        if new_ssl_state in ("warning", "expired") and previous != new_ssl_state:
            ssl_transition = new_ssl_state

    db.flush()  # assign ids before notifications reference them

    if opened or resolved or ssl_transition:
        notifier = notifier or NotificationService()
        user = monitor.user
        try:
            if opened:
                notifier.on_incident_opened(db, user, monitor, incident)
            if resolved:
                notifier.on_incident_resolved(db, user, monitor, incident)
            if ssl_transition:
                notifier.on_ssl_state_change(db, user, monitor, new_ssl_state)
        except Exception:  # noqa: BLE001 — delivery must not flip a check result
            logger.exception(
                "Notification dispatch failed for monitor %s", monitor.id
            )

    db.commit()
    db.refresh(row)
    return row
