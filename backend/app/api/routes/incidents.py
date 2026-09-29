from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.database import get_db
from app.models.incident import Incident
from app.models.monitor import Monitor
from app.models.user import User
from app.schemas.incident import IncidentListResponse, IncidentResponse

router = APIRouter(prefix="/api/incidents", tags=["incidents"])


def _to_response(incident: Incident, monitor_name: str | None = None) -> IncidentResponse:
    return IncidentResponse(
        id=incident.id,
        monitor_id=incident.monitor_id,
        monitor_name=monitor_name,
        started_at=incident.started_at,
        resolved_at=incident.resolved_at,
        duration_seconds=incident.duration_seconds,
        failure_count=incident.failure_count,
        cause=incident.cause,
        is_resolved=incident.is_resolved,
    )


def _incidents_for_user(db: Session, user_id: int):
    return (
        select(Incident, Monitor.name)
        .join(Monitor, Monitor.id == Incident.monitor_id)
        .where(Monitor.user_id == user_id)
    )


@router.get("", response_model=IncidentListResponse)
def list_incidents(
    active: bool | None = Query(default=None),
    monitor_id: int | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> IncidentListResponse:
    query = _incidents_for_user(db, user.id)
    if active is not None:
        query = query.where(Incident.is_resolved.is_(not active))
    if monitor_id is not None:
        query = query.where(Incident.monitor_id == monitor_id)

    total = db.scalar(
        select(func.count()).select_from(query.subquery())
    ) or 0
    rows = db.execute(
        query.order_by(Incident.started_at.desc(), Incident.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return IncidentListResponse(
        items=[_to_response(incident, name) for incident, name in rows],
        total=total,
        limit=limit,
        offset=offset,
    )
