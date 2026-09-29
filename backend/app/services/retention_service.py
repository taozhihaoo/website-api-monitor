"""Simple retention: prune check history older than RETENTION_DAYS."""

from datetime import timedelta

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.models.base import utcnow
from app.models.check import MonitorCheck


def delete_old_checks(db: Session, retention_days: int, now=None) -> int:
    if retention_days <= 0:
        return 0
    cutoff = (now or utcnow()) - timedelta(days=retention_days)
    result = db.execute(
        delete(MonitorCheck).where(MonitorCheck.checked_at < cutoff)
    )
    db.commit()
    return result.rowcount or 0
