"""Monitor business logic. Routes never touch the database directly."""

from datetime import timedelta

from sqlalchemy import case, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.errors import ApiError
from app.config import get_settings
from app.models.base import utcnow
from app.models.check import MonitorCheck
from app.models.monitor import (
    MONITOR_TYPE_API_JSON,
    MONITOR_TYPE_KEYWORD,
    MONITOR_TYPE_SSL,
    SSL_ALERT_NONE,
    STATUS_UP,
    Monitor,
)
from app.models.user import User
from app.monitoring.url_guard import validate_public_http_url
from app.schemas.monitor import MonitorCreate, MonitorResponse, MonitorUpdate
from app.services.incident_service import resolve_open_incidents


def not_found() -> ApiError:
    # New instance per raise — a shared exception object retains traceback
    # frames (and their request locals) for the whole process lifetime.
    return ApiError(404, "not_found", "Monitor not found")


def get_owned_monitor(db: Session, user_id: int, monitor_id: int) -> Monitor:
    monitor = db.get(Monitor, monitor_id)
    if monitor is None or monitor.user_id != user_id:
        # 404 (not 403) so ids of other users' monitors are not enumerable.
        raise not_found()
    return monitor


def create_monitor(db: Session, user_id: int, payload: MonitorCreate) -> Monitor:
    # Use the guard's normalized return value; it strips surrounding whitespace.
    target_url = validate_public_http_url(payload.target_url)

    # Serialise per-user creation so the quota check cannot be raced by two
    # concurrent requests. PostgreSQL honours FOR UPDATE; SQLite ignores it
    # (tests are single-threaded), which is fine for local development.
    db.get(User, user_id, with_for_update=True)
    count = (
        db.scalar(select(func.count(Monitor.id)).where(Monitor.user_id == user_id)) or 0
    )
    if count >= get_settings().max_monitors_per_user:
        raise ApiError(
            409,
            "monitor_limit_reached",
            f"Monitor limit reached ({get_settings().max_monitors_per_user})",
        )

    monitor = Monitor(
        user_id=user_id,
        name=payload.name.strip(),
        type=payload.type,
        target_url=target_url,
        enabled=payload.enabled,
        interval_seconds=payload.interval_seconds,
        timeout_seconds=payload.timeout_seconds,
        expected_status=payload.expected_status,
        keyword=payload.keyword,
        keyword_mode=payload.keyword_mode,
        json_path=payload.json_path,
        json_expected_value=payload.json_expected_value,
        ssl_check_enabled=payload.ssl_check_enabled,
        ssl_warning_days=payload.ssl_warning_days,
        next_check_at=utcnow(),  # due immediately after creation
    )
    db.add(monitor)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ApiError(409, "conflict", "Monitor could not be created") from exc
    db.refresh(monitor)
    return monitor


def update_monitor(
    db: Session, monitor: Monitor, payload: MonitorUpdate
) -> Monitor:
    data = payload.model_dump(exclude_unset=True)

    if "target_url" in data:
        data["target_url"] = validate_public_http_url(data["target_url"])

    merged_type = data.get("type", monitor.type)
    merged_keyword = data.get("keyword", monitor.keyword)
    merged_json_path = data.get("json_path", monitor.json_path)
    merged_url = data.get("target_url", monitor.target_url)
    if merged_type == MONITOR_TYPE_KEYWORD and not (merged_keyword and merged_keyword.strip()):
        raise ApiError(422, "validation_error", "keyword is required when type is 'keyword'")
    if merged_type == MONITOR_TYPE_API_JSON and not (
        merged_json_path and merged_json_path.strip()
    ):
        raise ApiError(422, "validation_error", "json_path is required when type is 'api_json'")
    if merged_type == MONITOR_TYPE_SSL and not merged_url.strip().lower().startswith("https://"):
        raise ApiError(422, "validation_error", "SSL monitors require an https:// URL")

    # A different target (or turning the SSL sidecar off) invalidates the
    # cached certificate and the alert-dedup state; otherwise the dashboard
    # shows the old host's expiry and a genuine expiring/expired alert can be
    # swallowed by the "state did not change" dedup rule.
    url_changed = "target_url" in data and data["target_url"] != monitor.target_url
    ssl_disabled = data.get("ssl_check_enabled") is False
    if url_changed or ssl_disabled or ("type" in data and data["type"] != monitor.type):
        monitor.ssl_expires_at = None
        monitor.ssl_days_remaining = None
        monitor.ssl_last_checked_at = None
        monitor.ssl_alert_state = SSL_ALERT_NONE

    # PUT {"enabled": false} bypasses set_enabled(); close open incidents here
    # too, otherwise a DOWN monitor paused through the generic update endpoint
    # keeps a permanently open incident.
    if data.get("enabled") is False and monitor.enabled:
        resolve_open_incidents(db, monitor.id)

    for field, value in data.items():
        setattr(monitor, field, value)

    # Re-check soon after a config change, then resume the normal cadence.
    monitor.next_check_at = utcnow()
    db.commit()
    db.refresh(monitor)
    return monitor


def set_enabled(db: Session, monitor: Monitor, enabled: bool) -> Monitor:
    monitor.enabled = enabled
    if enabled:
        monitor.next_check_at = utcnow()
    else:
        # A disabled monitor is never checked again. Close its incident now so
        # the dashboard does not count it as active forever and a later
        # re-enable starts a fresh incident instead of inheriting the pause.
        resolve_open_incidents(db, monitor.id)
    db.commit()
    db.refresh(monitor)
    return monitor


def latest_check(db: Session, monitor_id: int) -> MonitorCheck | None:
    return db.scalar(
        select(MonitorCheck)
        .where(MonitorCheck.monitor_id == monitor_id)
        .order_by(MonitorCheck.checked_at.desc(), MonitorCheck.id.desc())
        .limit(1)
    )


_MONITOR_FIELDS = (
    "id", "name", "type", "target_url", "enabled",
    "interval_seconds", "timeout_seconds", "expected_status",
    "keyword", "keyword_mode", "json_path", "json_expected_value",
    "ssl_check_enabled", "ssl_warning_days",
    "last_status", "last_checked_at", "next_check_at",
    "ssl_expires_at", "ssl_days_remaining", "ssl_last_checked_at",
    "created_at", "updated_at",
)


def _ssl_display_status(monitor: Monitor) -> str:
    from app.monitoring.checker import classify_ssl_status

    if monitor.ssl_days_remaining is None and monitor.ssl_expires_at is None:
        if monitor.target_url.lower().startswith("https://") and (
            monitor.ssl_check_enabled or monitor.type == MONITOR_TYPE_SSL
        ):
            return "unknown"
        return "not_applicable"
    return classify_ssl_status(monitor.ssl_days_remaining, monitor.ssl_warning_days)


def _build_response(
    monitor: Monitor, latest: MonitorCheck | None, uptime_24h: float | None
) -> MonitorResponse:
    return MonitorResponse(
        **{c: getattr(monitor, c) for c in _MONITOR_FIELDS},
        ssl_status=_ssl_display_status(monitor),
        last_latency_ms=latest.latency_ms if latest else None,
        uptime_24h=uptime_24h,
    )


def to_response(db: Session, monitor: Monitor) -> MonitorResponse:
    from app.services.uptime_service import uptime_stats

    latest = latest_check(db, monitor.id)
    uptime = uptime_stats(db, monitor.id, timedelta(hours=24))["uptime_percentage"]
    return _build_response(monitor, latest, uptime)


def list_responses(db: Session, monitors: list[Monitor]) -> list[MonitorResponse]:
    """Batched variant of to_response for list endpoints (two queries total,
    regardless of monitor count — avoids the N+1 of per-monitor lookups)."""
    if not monitors:
        return []
    ids = [m.id for m in monitors]

    latest_ids = select(func.max(MonitorCheck.id)).where(
        MonitorCheck.monitor_id.in_(ids)
    ).group_by(MonitorCheck.monitor_id)
    latest_rows = db.scalars(select(MonitorCheck).where(MonitorCheck.id.in_(latest_ids))).all()
    latest_by_monitor = {row.monitor_id: row for row in latest_rows}

    cutoff = utcnow() - timedelta(hours=24)
    uptime_rows = db.execute(
        select(
            MonitorCheck.monitor_id,
            func.count(MonitorCheck.id),
            func.sum(case((MonitorCheck.status == STATUS_UP, 1), else_=0)),
        )
        .where(MonitorCheck.monitor_id.in_(ids), MonitorCheck.checked_at >= cutoff)
        .group_by(MonitorCheck.monitor_id)
    ).all()
    uptime_by_monitor = {
        monitor_id: round((up or 0) / total * 100, 2) if total else None
        for monitor_id, total, up in uptime_rows
    }

    return [
        _build_response(m, latest_by_monitor.get(m.id), uptime_by_monitor.get(m.id))
        for m in monitors
    ]
