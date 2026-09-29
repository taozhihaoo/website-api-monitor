from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.database import get_db
from app.models.monitor import Monitor
from app.models.user import User
from app.schemas.monitor import CheckResponse, MonitorCreate, MonitorResponse, MonitorUpdate
from app.services import check_service, monitor_service

router = APIRouter(prefix="/api/monitors", tags=["monitors"])


@router.get("", response_model=list[MonitorResponse])
def list_monitors(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[MonitorResponse]:
    monitors = db.scalars(
        select(Monitor).where(Monitor.user_id == user.id).order_by(Monitor.id)
    ).all()
    return [monitor_service.to_response(db, m) for m in monitors]


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
    return monitor_service.to_response(db, monitor)


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
