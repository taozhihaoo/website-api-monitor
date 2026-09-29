from datetime import datetime

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UTCDateTime, utcnow

CHANNEL_WEBHOOK = "webhook"
CHANNEL_EMAIL = "email"
CHANNELS = (CHANNEL_WEBHOOK, CHANNEL_EMAIL)

EVENT_MONITOR_DOWN = "monitor_down"
EVENT_RECOVERED = "recovered"
EVENT_SSL_EXPIRING = "ssl_expiring"
EVENT_SSL_EXPIRED = "ssl_expired"

STATUS_SENT = "sent"
STATUS_FAILED = "failed"
STATUS_SKIPPED = "skipped"


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    monitor_id: Mapped[int | None] = mapped_column(
        ForeignKey("monitors.id"), default=None, index=True
    )
    incident_id: Mapped[int | None] = mapped_column(default=None)

    channel: Mapped[str] = mapped_column(String(20))
    event: Mapped[str] = mapped_column(String(30))
    status: Mapped[str] = mapped_column(String(20))
    detail: Mapped[str | None] = mapped_column(Text, default=None)

    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)

    user = relationship("User", back_populates="notifications")
    monitor = relationship("Monitor", back_populates="notifications")
