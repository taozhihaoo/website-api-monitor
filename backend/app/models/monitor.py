from datetime import datetime

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UTCDateTime, utcnow

# --- check / monitor status vocabulary -------------------------------------
STATUS_UP = "up"
STATUS_DOWN = "down"
CHECK_STATUSES = (STATUS_UP, STATUS_DOWN)

MONITOR_TYPE_HTTP = "http"
MONITOR_TYPE_KEYWORD = "keyword"
MONITOR_TYPE_API_JSON = "api_json"
MONITOR_TYPE_SSL = "ssl"
MONITOR_TYPES = (
    MONITOR_TYPE_HTTP,
    MONITOR_TYPE_KEYWORD,
    MONITOR_TYPE_API_JSON,
    MONITOR_TYPE_SSL,
)

KEYWORD_MODE_CONTAINS = "contains"
KEYWORD_MODE_NOT_CONTAINS = "not_contains"
KEYWORD_MODES = (KEYWORD_MODE_CONTAINS, KEYWORD_MODE_NOT_CONTAINS)

RESULT_PASS = "pass"
RESULT_FAIL = "fail"
CHECK_RESULTS = (RESULT_PASS, RESULT_FAIL)

SSL_STATUS_VALID = "valid"
SSL_STATUS_EXPIRING_SOON = "expiring_soon"
SSL_STATUS_EXPIRED = "expired"
SSL_STATUS_NOT_APPLICABLE = "not_applicable"
SSL_STATUS_UNKNOWN = "unknown"
SSL_STATUSES = (
    SSL_STATUS_VALID,
    SSL_STATUS_EXPIRING_SOON,
    SSL_STATUS_EXPIRED,
    SSL_STATUS_NOT_APPLICABLE,
    SSL_STATUS_UNKNOWN,
)

# monitor-level alert state machine for SSL notifications
SSL_ALERT_NONE = ""
SSL_ALERT_OK = "ok"
SSL_ALERT_WARNING = "warning"
SSL_ALERT_EXPIRED = "expired"
SSL_ALERT_STATES = (SSL_ALERT_OK, SSL_ALERT_WARNING, SSL_ALERT_EXPIRED)


class Monitor(Base):
    __tablename__ = "monitors"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    enabled: Mapped[bool] = mapped_column(default=True)

    type: Mapped[str] = mapped_column(String(20), default=MONITOR_TYPE_HTTP)
    target_url: Mapped[str] = mapped_column(String(2048))

    interval_seconds: Mapped[int] = mapped_column(default=300)
    timeout_seconds: Mapped[int] = mapped_column(default=10)
    expected_status: Mapped[int] = mapped_column(default=200)

    keyword: Mapped[str | None] = mapped_column(String(500), default=None)
    keyword_mode: Mapped[str] = mapped_column(String(20), default=KEYWORD_MODE_CONTAINS)
    json_path: Mapped[str | None] = mapped_column(String(500), default=None)
    json_expected_value: Mapped[str | None] = mapped_column(String(500), default=None)

    ssl_check_enabled: Mapped[bool] = mapped_column(default=False)
    ssl_warning_days: Mapped[int] = mapped_column(default=30)

    # denormalized current state (kept in sync by the check engine)
    last_status: Mapped[str | None] = mapped_column(String(10), default=None)
    last_checked_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), default=None)
    next_check_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), default=None, index=True)

    # ssl cache for dashboard + alert dedup
    ssl_expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), default=None)
    ssl_days_remaining: Mapped[int | None] = mapped_column(default=None)
    ssl_last_checked_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), default=None)
    ssl_alert_state: Mapped[str | None] = mapped_column(String(20), default=SSL_ALERT_NONE)

    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), default=utcnow, onupdate=utcnow
    )

    user = relationship("User", back_populates="monitors")
    checks = relationship(
        "MonitorCheck",
        back_populates="monitor",
        cascade="all, delete-orphan",
        order_by="MonitorCheck.checked_at.desc()",
    )
    incidents = relationship(
        "Incident", back_populates="monitor", cascade="all, delete-orphan"
    )
    notifications = relationship(
        "Notification", back_populates="monitor", cascade="all, delete-orphan"
    )
