"""Central application configuration.

Every deployment-specific value comes from environment variables (optionally a
local .env file, gitignored). No secrets are ever hardcoded.
"""

from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

INSECURE_DEFAULT_SECRET = "insecure-dev-secret-change-me-0123456789"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "SiteWatch"
    version: str = "1.0.0"
    app_env: str = "development"  # development | production

    # --- security ---
    secret_key: str = INSECURE_DEFAULT_SECRET
    access_token_expire_minutes: int = 60 * 24 * 7  # 7 days

    # --- storage ---
    database_url: str = "sqlite:///./sitewatch.db"
    db_echo: bool = False

    # --- http ---
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # --- scheduler / engine ---
    scheduler_enabled: bool = True
    scheduler_scan_interval_seconds: float = 10.0
    max_concurrent_checks: int = 10
    max_monitors_per_user: int = 50
    max_response_bytes: int = 2_000_000
    check_max_retries: int = 2
    check_retry_backoff_seconds: float = 1.0
    default_timeout_seconds: int = 10
    max_timeout_seconds: int = 30
    min_interval_seconds: int = 60
    max_interval_seconds: int = 86400
    retention_days: int = 30
    user_agent: str = "SiteWatch/1.0 (self-hosted uptime monitoring)"

    # --- notifications ---
    webhook_timeout_seconds: int = 10
    webhook_allow_private_ips: bool = False
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_use_tls: bool = True
    smtp_from: str | None = None
    smtp_to: str | None = None

    # --- demo seed ---
    demo_password: str | None = None

    @property
    def smtp_enabled(self) -> bool:
        return bool(self.smtp_host and self.smtp_from and self.smtp_to)

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @model_validator(mode="after")
    def _production_requires_secret(self) -> "Settings":
        if self.is_production and self.secret_key == INSECURE_DEFAULT_SECRET:
            raise ValueError("SECRET_KEY must be set via environment when APP_ENV=production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
