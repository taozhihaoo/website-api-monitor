"""Factories for building model instances in tests."""

from datetime import UTC, datetime, timedelta

from app.models.base import utcnow
from app.models.monitor import Monitor
from app.monitoring.ssl_checker import SSLInfo


def make_monitor(**overrides) -> Monitor:
    defaults = dict(
        id=1,
        user_id=1,
        name="Test Monitor",
        type="http",
        target_url="https://api.example.com/",
        enabled=True,
        interval_seconds=300,
        timeout_seconds=5,
        expected_status=200,
        keyword_mode="contains",
        ssl_warning_days=30,
        next_check_at=utcnow(),
    )
    defaults.update(overrides)
    return Monitor(**defaults)


class FakeSSLChecker:
    """Stands in for SSLChecker without any network activity."""

    def __init__(self, days_remaining: int = 90, error: Exception | None = None):
        self.days_remaining = days_remaining
        self.error = error
        self.calls: list[tuple[str, int]] = []

    def fetch_certificate(self, host: str, port: int = 443, timeout: float = 10.0):
        self.calls.append((host, port))
        if self.error is not None:
            raise self.error
        expires_at = datetime.now(UTC) + timedelta(days=self.days_remaining)
        return SSLInfo(expires_at=expires_at, days_remaining=self.days_remaining, subject="CN=fake")
