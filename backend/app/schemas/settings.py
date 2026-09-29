from datetime import datetime

from pydantic import BaseModel, Field


class SslInfoResponse(BaseModel):
    monitor_id: int
    scheme: str
    ssl_status: str
    expires_at: datetime | None = None
    days_remaining: int | None = None
    last_checked_at: datetime | None = None
    warning_threshold_days: int


class NotificationSettingsUpdate(BaseModel):
    webhook_url: str | None = Field(default=None, max_length=2048)


class NotificationTestResponse(BaseModel):
    status: str
    detail: str | None = None
