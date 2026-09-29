from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.monitor import KEYWORD_MODES, MONITOR_TYPES

HttpUrlStr = str  # validated by the SSRF guard in the service layer


class MonitorCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    type: str = Field(default="http")
    target_url: HttpUrlStr = Field(min_length=1, max_length=2048)
    enabled: bool = True

    interval_seconds: int = Field(default=300, ge=60, le=86400)
    timeout_seconds: int = Field(default=10, ge=1, le=30)
    expected_status: int = Field(default=200, ge=100, le=599)

    keyword: str | None = Field(default=None, max_length=500)
    keyword_mode: str = Field(default="contains")
    json_path: str | None = Field(default=None, max_length=500)
    json_expected_value: str | None = Field(default=None, max_length=500)

    ssl_check_enabled: bool = False
    ssl_warning_days: int = Field(default=30, ge=1, le=365)

    @model_validator(mode="after")
    def _validate_type_specific(self) -> "MonitorCreate":
        if self.type not in MONITOR_TYPES:
            raise ValueError(f"type must be one of: {', '.join(MONITOR_TYPES)}")
        if self.keyword_mode not in KEYWORD_MODES:
            raise ValueError(f"keyword_mode must be one of: {', '.join(KEYWORD_MODES)}")
        if self.type == "keyword" and not (self.keyword and self.keyword.strip()):
            raise ValueError("keyword is required when type is 'keyword'")
        if self.type == "api_json" and not (self.json_path and self.json_path.strip()):
            raise ValueError("json_path is required when type is 'api_json'")
        if self.type == "ssl" and not self.target_url.strip().lower().startswith("https://"):
            raise ValueError("SSL monitors require an https:// URL")
        if self.keyword is not None:
            self.keyword = self.keyword.strip() or None
        if self.json_path is not None:
            self.json_path = self.json_path.strip() or None
        if self.json_expected_value is not None:
            self.json_expected_value = self.json_expected_value.strip() or None
        return self


class MonitorUpdate(BaseModel):
    """Partial update: only provided fields are applied; result is re-validated."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    type: str | None = Field(default=None)
    target_url: HttpUrlStr | None = Field(default=None, min_length=1, max_length=2048)
    enabled: bool | None = None

    interval_seconds: int | None = Field(default=None, ge=60, le=86400)
    timeout_seconds: int | None = Field(default=None, ge=1, le=30)
    expected_status: int | None = Field(default=None, ge=100, le=599)

    keyword: str | None = Field(default=None, max_length=500)
    keyword_mode: str | None = Field(default=None)
    json_path: str | None = Field(default=None, max_length=500)
    json_expected_value: str | None = Field(default=None, max_length=500)

    ssl_check_enabled: bool | None = None
    ssl_warning_days: int | None = Field(default=None, ge=1, le=365)

    @model_validator(mode="after")
    def _validate_enums(self) -> "MonitorUpdate":
        if self.type is not None and self.type not in MONITOR_TYPES:
            raise ValueError(f"type must be one of: {', '.join(MONITOR_TYPES)}")
        if self.keyword_mode is not None and self.keyword_mode not in KEYWORD_MODES:
            raise ValueError(f"keyword_mode must be one of: {', '.join(KEYWORD_MODES)}")
        return self


class MonitorResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    type: str
    target_url: str
    enabled: bool

    interval_seconds: int
    timeout_seconds: int
    expected_status: int

    keyword: str | None
    keyword_mode: str
    json_path: str | None
    json_expected_value: str | None

    ssl_check_enabled: bool
    ssl_warning_days: int

    last_status: str | None
    last_checked_at: datetime | None
    next_check_at: datetime | None

    ssl_status: str = "not_applicable"
    ssl_expires_at: datetime | None = None
    ssl_days_remaining: int | None = None
    ssl_last_checked_at: datetime | None = None

    last_latency_ms: int | None = None
    uptime_24h: float | None = None

    created_at: datetime
    updated_at: datetime


class CheckResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    monitor_id: int
    checked_at: datetime
    status: str
    http_status: int | None
    latency_ms: int | None
    error_type: str | None
    error_message: str | None
    keyword_result: str | None
    json_result: str | None
    ssl_days_remaining: int | None
    ssl_status: str
