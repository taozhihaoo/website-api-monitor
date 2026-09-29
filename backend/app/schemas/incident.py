from datetime import datetime

from pydantic import BaseModel


class IncidentResponse(BaseModel):
    id: int
    monitor_id: int
    monitor_name: str | None = None
    started_at: datetime
    resolved_at: datetime | None
    duration_seconds: int | None
    failure_count: int
    cause: str | None
    is_resolved: bool


class IncidentListResponse(BaseModel):
    items: list[IncidentResponse]
    total: int
    limit: int
    offset: int
