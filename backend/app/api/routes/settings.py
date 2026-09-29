"""User-level settings: webhook notification channel."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.errors import ApiError
from app.config import get_settings
from app.database import get_db
from app.models.user import User
from app.monitoring.url_guard import validate_webhook_url
from app.notifications import NotificationService
from app.schemas.auth import UserResponse
from app.schemas.settings import NotificationSettingsUpdate, NotificationTestResponse

router = APIRouter(prefix="/api/me", tags=["settings"])


@router.put("/notifications", response_model=UserResponse)
def update_notification_settings(
    payload: NotificationSettingsUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    if payload.webhook_url:
        validate_webhook_url(
            payload.webhook_url,
            allow_private=get_settings().webhook_allow_private_ips,
        )
    user.webhook_url = payload.webhook_url
    db.commit()
    db.refresh(user)
    return user


@router.post("/notifications/test", response_model=NotificationTestResponse)
def test_notifications(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NotificationTestResponse:
    if not user.webhook_url:
        raise ApiError(400, "webhook_not_configured", "Set a webhook URL first")
    status_, detail = NotificationService().send_test(db, user)
    db.commit()
    return NotificationTestResponse(status=status_, detail=detail)
