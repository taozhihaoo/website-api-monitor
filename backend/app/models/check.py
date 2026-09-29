from datetime import datetime

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UTCDateTime, utcnow
from app.models.monitor import SSL_STATUS_NOT_APPLICABLE

ERROR_TYPE_TIMEOUT = "timeout"
ERROR_TYPE_CONNECTION = "connection_error"
ERROR_TYPE_DNS = "dns_error"
ERROR_TYPE_TLS = "tls_error"
ERROR_TYPE_STATUS_MISMATCH = "status_mismatch"
ERROR_TYPE_KEYWORD = "keyword_failed"
ERROR_TYPE_JSON = "json_failed"
ERROR_TYPE_JSON_PARSE = "json_parse_failed"
ERROR_TYPE_SSL_EXPIRED = "ssl_expired"
ERROR_TYPE_RESPONSE_TOO_LARGE = "response_too_large"
ERROR_TYPE_INTERNAL = "internal_error"


class MonitorCheck(Base):
    __tablename__ = "monitor_checks"

    id: Mapped[int] = mapped_column(primary_key=True)
    monitor_id: Mapped[int] = mapped_column(ForeignKey("monitors.id"), index=True)
    checked_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, index=True)

    status: Mapped[str] = mapped_column(String(10))  # up | down
    http_status: Mapped[int | None] = mapped_column(Integer, default=None)
    latency_ms: Mapped[int | None] = mapped_column(Integer, default=None)
    error_type: Mapped[str | None] = mapped_column(String(40), default=None)
    error_message: Mapped[str | None] = mapped_column(Text, default=None)

    keyword_result: Mapped[str | None] = mapped_column(String(10), default=None)
    json_result: Mapped[str | None] = mapped_column(String(10), default=None)

    ssl_days_remaining: Mapped[int | None] = mapped_column(Integer, default=None)
    ssl_status: Mapped[str] = mapped_column(String(20), default=SSL_STATUS_NOT_APPLICABLE)

    monitor = relationship("Monitor", back_populates="checks")
