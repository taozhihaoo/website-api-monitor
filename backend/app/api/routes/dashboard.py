from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.database import get_db
from app.models.base import utcnow
from app.models.user import User
from app.services.dashboard_service import dashboard_summary


class DashboardSummaryResponse(BaseModel):
    total_monitors: int
    up: int
    down: int
    paused: int
    pending: int
    uptime_24h: float | None
    active_incidents: int
    generated_at: datetime


router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/summary", response_model=DashboardSummaryResponse)
def summary(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> DashboardSummaryResponse:
    data = dashboard_summary(db, user.id)
    return DashboardSummaryResponse(**data, generated_at=utcnow())
