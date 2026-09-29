"""Incident state machine.

Rules:
- UP   → DOWN : open a new incident
- DOWN → DOWN : keep the current incident, increment failure_count
- DOWN → UP   : close the incident (resolved_at, duration)
- UP   → UP   : nothing

One open incident per monitor at any time.
"""

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


def active_incident(db: Session, monitor_id: int) -> Incident | None:
    return db.scalar(
        select(Incident)
        .where(Incident.monitor_id == monitor_id, Incident.is_resolved.is_(False))
        .order_by(Incident.id.desc())
        .limit(1)
    )


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

    incident = active_incident(db, monitor.id)
    if incident is not None:
        incident.is_resolved = True
        incident.resolved_at = now
        incident.duration_seconds = max(
            0, int((incident.resolved_at - incident.started_at).total_seconds())
        )
        return incident, False, True
    return None, False, False
