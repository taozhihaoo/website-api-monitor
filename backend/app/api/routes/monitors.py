from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.database import get_db
from app.models.base import utcnow
from app.models.check import MonitorCheck
from app.models.incident import Incident
from app.models.monitor import Monitor
from app.models.user import User
from app.schemas.incident import IncidentListResponse, IncidentResponse
from app.schemas.monitor import (
    CheckHistoryResponse,
    CheckResponse,
    LatencyStats,
    MonitorCreate,
    MonitorResponse,
    MonitorUpdate,
    UptimeResponse,
)
from app.services import check_service, monitor_service, uptime_service

router = APIRouter(prefix="/api/monitors", tags=["monitors"])


@router.get("", response_model=list[MonitorResponse])
def list_monitors(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[MonitorResponse]:
    monitors = db.scalars(
        select(Monitor).where(Monitor.user_id == user.id).order_by(Monitor.id)
    ).all()
    return monitor_service.list_responses(db, list(monitors))


@router.post("", status_code=201, response_model=MonitorResponse)
def create_monitor(
    payload: MonitorCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MonitorResponse:
    monitor = monitor_service.create_monitor(db, user.id, payload)
    return monitor_service.to_response(db, monitor)


@router.get("/{monitor_id}", response_model=MonitorResponse)
def get_monitor(
    monitor_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MonitorResponse:
    monitor = monitor_service.get_owned_monitor(db, user.id, monitor_id)
    response = monitor_service.to_response(db, monitor)
    stats = uptime_service.latency_stats(db, monitor.id, timedelta(hours=24))
    response.latency_stats = LatencyStats(**stats) if stats else None
    return response


@router.put("/{monitor_id}", response_model=MonitorResponse)
def update_monitor(
    monitor_id: int,
    payload: MonitorUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MonitorResponse:
    monitor = monitor_service.get_owned_monitor(db, user.id, monitor_id)
    monitor = monitor_service.update_monitor(db, monitor, payload)
    return monitor_service.to_response(db, monitor)


@router.delete("/{monitor_id}", status_code=204)
def delete_monitor(
    monitor_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    monitor = monitor_service.get_owned_monitor(db, user.id, monitor_id)
    db.delete(monitor)
    db.commit()


@router.post("/{monitor_id}/check", response_model=CheckResponse)
def check_now(
    monitor_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CheckResponse:
    monitor = monitor_service.get_owned_monitor(db, user.id, monitor_id)
    return check_service.run_manual_check(db, monitor)


@router.post("/{monitor_id}/enable", response_model=MonitorResponse)
def enable_monitor(
    monitor_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MonitorResponse:
    monitor = monitor_service.set_enabled(
        db, monitor_service.get_owned_monitor(db, user.id, monitor_id), True
    )
    return monitor_service.to_response(db, monitor)


@router.post("/{monitor_id}/disable", response_model=MonitorResponse)
def disable_monitor(
    monitor_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MonitorResponse:
    monitor = monitor_service.set_enabled(
        db, monitor_service.get_owned_monitor(db, user.id, monitor_id), False
    )
    return monitor_service.to_response(db, monitor)


@router.get("/{monitor_id}/checks", response_model=CheckHistoryResponse)
def list_checks(
    monitor_id: int,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    hours: int = Query(default=24, ge=1, le=720),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CheckHistoryResponse:
    monitor = monitor_service.get_owned_monitor(db, user.id, monitor_id)
    cutoff = utcnow() - timedelta(hours=hours)
    conditions = (
        MonitorCheck.monitor_id == monitor.id,
        MonitorCheck.checked_at >= cutoff,
    )
    total = db.scalar(
        select(func.count(MonitorCheck.id)).where(*conditions)
    ) or 0
    items = db.scalars(
        select(MonitorCheck)
        .where(*conditions)
        .order_by(MonitorCheck.checked_at.desc(), MonitorCheck.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return CheckHistoryResponse(items=items, total=total, limit=limit, offset=offset)


@router.get("/{monitor_id}/uptime", response_model=UptimeResponse)
def monitor_uptime(
    monitor_id: int,
    window: str = Query(default="24h"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UptimeResponse:
    monitor = monitor_service.get_owned_monitor(db, user.id, monitor_id)
    stats = uptime_service.uptime_stats(db, monitor.id, uptime_service.parse_window(window))
    return UptimeResponse(monitor_id=monitor.id, window=window, **stats)


@router.get("/{monitor_id}/incidents", response_model=IncidentListResponse)
def monitor_incidents(
    monitor_id: int,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> IncidentListResponse:
    monitor = monitor_service.get_owned_monitor(db, user.id, monitor_id)
    total = db.scalar(
        select(func.count(Incident.id)).where(Incident.monitor_id == monitor.id)
    ) or 0
    incidents = db.scalars(
        select(Incident)
        .where(Incident.monitor_id == monitor.id)
        .order_by(Incident.started_at.desc(), Incident.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return IncidentListResponse(
        items=[
            IncidentResponse(
                id=i.id,
                monitor_id=i.monitor_id,
                monitor_name=monitor.name,
                started_at=i.started_at,
                resolved_at=i.resolved_at,
                duration_seconds=i.duration_seconds,
                failure_count=i.failure_count,
                cause=i.cause,
                is_resolved=i.is_resolved,
            )
            for i in incidents
        ],
        total=total,
        limit=limit,
        offset=offset,
    )
