from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UTCDateTime, utcnow


class Incident(Base):
    __tablename__ = "incidents"

    id: Mapped[int] = mapped_column(primary_key=True)
    monitor_id: Mapped[int] = mapped_column(ForeignKey("monitors.id"), index=True)

    started_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), default=None)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, default=None)
    failure_count: Mapped[int] = mapped_column(Integer, default=0)
    cause: Mapped[str | None] = mapped_column(String(500), default=None)
    is_resolved: Mapped[bool] = mapped_column(Boolean, default=False, index=True)

    monitor = relationship("Monitor", back_populates="incidents")
