"""Monitor business logic. Routes never touch the database directly."""

from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.errors import ApiError
from app.config import get_settings
from app.models.base import utcnow
from app.models.check import MonitorCheck
from app.models.monitor import (
    MONITOR_TYPE_API_JSON,
    MONITOR_TYPE_KEYWORD,
    MONITOR_TYPE_SSL,
    Monitor,
)
from app.monitoring.url_guard import validate_public_http_url
from app.schemas.monitor import MonitorCreate, MonitorResponse, MonitorUpdate

NOT_FOUND = ApiError(404, "not_found", "Monitor not found")


def get_owned_monitor(db: Session, user_id: int, monitor_id: int) -> Monitor:
    monitor = db.get(Monitor, monitor_id)
    if monitor is None or monitor.user_id != user_id:
        # 404 (not 403) so ids of other users' monitors are not enumerable.
        raise NOT_FOUND
    return monitor


def create_monitor(db: Session, user_id: int, payload: MonitorCreate) -> Monitor:
    validate_public_http_url(payload.target_url)

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
        target_url=payload.target_url.strip(),
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
    db.commit()
    db.refresh(monitor)
    return monitor


def update_monitor(
    db: Session, monitor: Monitor, payload: MonitorUpdate
) -> Monitor:
    data = payload.model_dump(exclude_unset=True)

    if "target_url" in data:
        validate_public_http_url(data["target_url"])

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


def to_response(db: Session, monitor: Monitor) -> MonitorResponse:
    latest = latest_check(db, monitor.id)
    from app.monitoring.checker import classify_ssl_status
    from app.services.uptime_service import uptime_stats

    if monitor.ssl_days_remaining is None and monitor.ssl_expires_at is None:
        if monitor.target_url.lower().startswith("https://") and (
            monitor.ssl_check_enabled or monitor.type == MONITOR_TYPE_SSL
        ):
            ssl_status = "unknown"
        else:
            ssl_status = "not_applicable"
    else:
        ssl_status = classify_ssl_status(monitor.ssl_days_remaining, monitor.ssl_warning_days)

    return MonitorResponse(
        **{
            c: getattr(monitor, c)
            for c in (
                "id", "name", "type", "target_url", "enabled",
                "interval_seconds", "timeout_seconds", "expected_status",
                "keyword", "keyword_mode", "json_path", "json_expected_value",
                "ssl_check_enabled", "ssl_warning_days",
                "last_status", "last_checked_at", "next_check_at",
                "ssl_expires_at", "ssl_days_remaining", "ssl_last_checked_at",
                "created_at", "updated_at",
            )
        },
        ssl_status=ssl_status,
        last_latency_ms=latest.latency_ms if latest else None,
        uptime_24h=uptime_stats(db, monitor.id, timedelta(hours=24))["uptime_percentage"],
    )
