"""SSL certificate information API."""

from urllib.parse import urlsplit

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.errors import ApiError
from app.database import get_db
from app.models.base import utcnow
from app.models.user import User
from app.monitoring.checker import classify_ssl_status
from app.monitoring.ssl_checker import SSLChecker, SSLCheckError
from app.schemas.settings import SslInfoResponse
from app.services.monitor_service import get_owned_monitor

router = APIRouter(prefix="/api/ssl", tags=["ssl"])


@router.get("/{monitor_id}", response_model=SslInfoResponse)
def ssl_info(
    monitor_id: int,
    refresh: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SslInfoResponse:
    monitor = get_owned_monitor(db, user.id, monitor_id)
    scheme = "https" if monitor.target_url.lower().startswith("https://") else "http"

    if scheme != "https":
        return SslInfoResponse(
            monitor_id=monitor.id,
            scheme=scheme,
            ssl_status="not_applicable",
            warning_threshold_days=monitor.ssl_warning_days,
        )

    if refresh:
        parts = urlsplit(monitor.target_url)
        try:
            info = SSLChecker().fetch_certificate(
                parts.hostname, parts.port or 443, timeout=monitor.timeout_seconds
            )
        except SSLCheckError as exc:
            raise ApiError(502, "ssl_check_failed", str(exc))  # noqa: B904
        monitor.ssl_expires_at = info.expires_at
        monitor.ssl_days_remaining = info.days_remaining
        monitor.ssl_last_checked_at = utcnow()
        db.commit()

    status_ = classify_ssl_status(monitor.ssl_days_remaining, monitor.ssl_warning_days)

    return SslInfoResponse(
        monitor_id=monitor.id,
        scheme=scheme,
        ssl_status=status_,
        expires_at=monitor.ssl_expires_at,
        days_remaining=monitor.ssl_days_remaining,
        last_checked_at=monitor.ssl_last_checked_at,
        warning_threshold_days=monitor.ssl_warning_days,
    )
