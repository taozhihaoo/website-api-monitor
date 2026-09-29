"""Dashboard aggregation for one user."""

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.incident import Incident
from app.models.monitor import STATUS_DOWN, STATUS_UP, Monitor
from app.services.uptime_service import overall_uptime


def dashboard_summary(db: Session, user_id: int) -> dict:
    monitors = db.scalars(select(Monitor).where(Monitor.user_id == user_id)).all()
    up = sum(1 for m in monitors if m.enabled and m.last_status == STATUS_UP)
    down = sum(1 for m in monitors if m.enabled and m.last_status == STATUS_DOWN)
    paused = sum(1 for m in monitors if not m.enabled)
    pending = len(monitors) - up - down - paused

    monitor_ids = [m.id for m in monitors]
    active_incidents = 0
    if monitor_ids:
        active_incidents = len(
            db.scalars(
                select(Incident.id).where(
                    Incident.monitor_id.in_(monitor_ids),
                    Incident.is_resolved.is_(False),
                )
            ).all()
        )

    return {
        "total_monitors": len(monitors),
        "up": up,
        "down": down,
        "paused": paused,
        "pending": pending,
        "uptime_24h": overall_uptime(db, user_id, timedelta(hours=24)),
        "active_incidents": active_incidents,
    }
