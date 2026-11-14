"""Incident state machine.

Rules:
- UP   → DOWN : open a new incident
- DOWN → DOWN : keep the current incident, increment failure_count
- DOWN → UP   : close the incident (resolved_at, duration)
- UP   → UP   : nothing

One open incident per monitor at any time.
"""

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.base import utcnow
from app.models.check import MonitorCheck
from app.models.incident import Incident
from app.models.monitor import STATUS_DOWN, Monitor


def _describe_cause(check: MonitorCheck) -> str:
    if check.error_message:
        return check.error_message[:500]
    if check.http_status is not None:
        return f"HTTP {check.http_status}"
    return "check failed"


def open_incidents(db: Session, monitor_id: int) -> list[Incident]:
    """All unresolved incidents for a monitor (normally exactly one).

    Returns a list so recovery can close *every* open incident. A concurrent
    check could previously create two open incidents and leave one permanently
    unresolved (zombie), inflating dashboard counts forever.
    """
    return list(
        db.scalars(
            select(Incident)
            .where(Incident.monitor_id == monitor_id, Incident.is_resolved.is_(False))
            .order_by(Incident.id.desc())
        ).all()
    )


def active_incident(db: Session, monitor_id: int) -> Incident | None:
    incidents = open_incidents(db, monitor_id)
    return incidents[0] if incidents else None


def resolve_open_incidents(
    db: Session, monitor_id: int, at: datetime | None = None
) -> list[Incident]:
    """Close every open incident for a monitor without sending a notification.

    Used when a monitor is paused or deleted from scheduling: a paused monitor
    is never checked again, so its incident would otherwise stay open forever
    (inflating the dashboard's active count and later counting the whole pause
    as downtime). Returns the incidents that were closed.
    """
    incidents = open_incidents(db, monitor_id)
    if not incidents:
        return []
    now = at or utcnow()
    for incident in incidents:
        incident.is_resolved = True
        incident.resolved_at = now
        incident.duration_seconds = max(
            0, int((now - incident.started_at).total_seconds())
        )
    return incidents


def record_result(
    db: Session, monitor: Monitor, check: MonitorCheck
) -> tuple[Incident | None, bool, bool]:
    """Apply the state machine for one check result.

    Returns (incident, opened, resolved). The incident is added to the session
    but not committed — the engine flushes/commits.
    """
    now = check.checked_at or utcnow()

    if check.status == STATUS_DOWN:
        incident = active_incident(db, monitor.id)
        if incident is None:
            incident = Incident(
                monitor_id=monitor.id,
                started_at=now,
                failure_count=1,
                cause=_describe_cause(check),
                is_resolved=False,
            )
            db.add(incident)
            return incident, True, False
        incident.failure_count += 1
        return incident, False, False

    incidents = resolve_open_incidents(db, monitor.id, at=now)
    if not incidents:
        return None, False, False
    # Report the newest incident for the recovery notification.
    return incidents[0], False, True
