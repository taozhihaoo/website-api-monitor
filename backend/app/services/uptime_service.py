"""Uptime and latency statistics.

Only checks that actually exist and fall inside the window are counted — no
projections into the future.
"""

from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.errors import ApiError
from app.models.base import utcnow
from app.models.check import MonitorCheck
from app.models.monitor import STATUS_UP, Monitor

UPTIME_WINDOWS = {
    "1h": timedelta(hours=1),
    "24h": timedelta(hours=24),
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
}


def parse_window(window: str) -> timedelta:
    try:
        return UPTIME_WINDOWS[window]
    except KeyError:
        raise ApiError(  # noqa: B904 — service-style error, not a traceback leak
            400, "invalid_window", "window must be one of: 1h, 24h, 7d, 30d"
        )


def uptime_stats(
    db: Session, monitor_id: int, window: timedelta, now=None
) -> dict:
    now = now or utcnow()
    cutoff = now - window
    base = select(func.count(MonitorCheck.id)).where(
        MonitorCheck.monitor_id == monitor_id,
        MonitorCheck.checked_at >= cutoff,
    )
    total = db.scalar(base) or 0
    up = db.scalar(
        base.where(MonitorCheck.status == STATUS_UP)
    ) or 0
    percentage = round(up / total * 100, 2) if total else None
    return {
        "total_checks": total,
        "up_checks": up,
        "uptime_percentage": percentage,
    }


def overall_uptime(db: Session, user_id: int, window: timedelta, now=None) -> float | None:
    """Uptime across every monitor owned by the user within the window."""
    now = now or utcnow()
    cutoff = now - window
    joined = (
        select(func.count(MonitorCheck.id))
        .join(Monitor, Monitor.id == MonitorCheck.monitor_id)
        .where(Monitor.user_id == user_id, MonitorCheck.checked_at >= cutoff)
    )
    total = db.scalar(joined) or 0
    if not total:
        return None
    up = db.scalar(joined.where(MonitorCheck.status == STATUS_UP)) or 0
    return round(up / total * 100, 2)


def latency_stats(
    db: Session, monitor_id: int, window: timedelta, now=None
) -> dict | None:
    now = now or utcnow()
    cutoff = now - window
    base = select(
        func.count(MonitorCheck.id),
        func.avg(MonitorCheck.latency_ms),
        func.min(MonitorCheck.latency_ms),
        func.max(MonitorCheck.latency_ms),
    ).where(
        MonitorCheck.monitor_id == monitor_id,
        MonitorCheck.checked_at >= cutoff,
        MonitorCheck.latency_ms.is_not(None),
    )
    count, avg, minimum, maximum = db.execute(base).one()
    if not count:
        return None
    return {
        "avg_ms": int(round(avg)),
        "min_ms": int(minimum),
        "max_ms": int(maximum),
        "count": int(count),
    }
