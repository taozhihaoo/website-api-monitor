"""Seed demo data.

Usage (from backend/):

    python -m app.seed            # APP_ENV != production only
    APP_ENV=development python -m app.seed

Creates a demo account and four monitors demonstrating every check type:

    1. https://example.com               HTTP 200 + keyword "Example Domain" + SSL
    2. https://httpbin.org/status/200    HTTP 200 (up)
    3. https://httpbin.org/status/503    expects 200 → permanently DOWN (demo of failure)
    4. https://jsonplaceholder.typicode.com/todos/1   JSON check: completed == false

The demo password comes from the DEMO_PASSWORD env var; when unset, a random
password is generated and printed once. Seed data is refused in production mode.
"""

import logging
import secrets
import sys

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Monitor, User
from app.services.auth_service import hash_password

logger = logging.getLogger("sitewatch.seed")

DEMO_EMAIL = "demo@sitewatch.local"

DEMO_MONITORS = [
    dict(
        name="Example.com (HTTP + keyword + SSL)",
        type="http",
        target_url="https://example.com/",
        interval_seconds=300,
        timeout_seconds=10,
        expected_status=200,
        keyword="Example Domain",
        keyword_mode="contains",
        ssl_check_enabled=True,
        ssl_warning_days=30,
    ),
    dict(
        name="httpbin 200 (healthy)",
        type="http",
        target_url="https://httpbin.org/status/200",
        interval_seconds=300,
        timeout_seconds=10,
        expected_status=200,
    ),
    dict(
        name="httpbin 503 (always down — demo)",
        type="http",
        target_url="https://httpbin.org/status/503",
        interval_seconds=600,
        timeout_seconds=10,
        expected_status=200,  # mismatch on purpose → DOWN, opens an incident
    ),
    dict(
        name="JSONPlaceholder todo (JSON health)",
        type="api_json",
        target_url="https://jsonplaceholder.typicode.com/todos/1",
        interval_seconds=600,
        timeout_seconds=10,
        expected_status=200,
        json_path="completed",
        json_expected_value="false",
        ssl_check_enabled=True,
    ),
]


def seed_demo_data(db: Session, password: str | None = None) -> tuple[User, list[Monitor], str]:
    """Create (or reuse) the demo account + monitors. Returns (user, monitors, password).

    Idempotent: existing demo monitors (by name) are left untouched.
    """
    settings = get_settings()
    password = password or settings.demo_password or secrets.token_urlsafe(12)

    user = db.scalar(select(User).where(User.email == DEMO_EMAIL))
    if user is None:
        user = User(email=DEMO_EMAIL, password_hash=hash_password(password))
        db.add(user)
        db.flush()
    generated = not (password == settings.demo_password and settings.demo_password)

    monitors: list[Monitor] = []
    for spec in DEMO_MONITORS:
        existing = db.scalar(
            select(Monitor).where(Monitor.user_id == user.id, Monitor.name == spec["name"])
        )
        if existing is not None:
            monitors.append(existing)
            continue
        monitor = Monitor(user_id=user.id, enabled=True, **spec)
        db.add(monitor)
        monitors.append(monitor)
    db.commit()

    logger.info("Seeded demo user %s with %d monitors", DEMO_EMAIL, len(monitors))
    return user, monitors, password if generated else ""


def main() -> int:
    settings = get_settings()
    if settings.is_production:
        print("Refusing to seed demo data with APP_ENV=production.", file=sys.stderr)
        return 1

    from app.database import SessionLocal

    with SessionLocal() as db:
        _, monitors, generated_password = seed_demo_data(db)

    print(f"Demo account : {DEMO_EMAIL}")
    if generated_password:
        print(f"Demo password: {generated_password}")
        print("(shown once — or set DEMO_PASSWORD to choose your own)")
    else:
        print("Demo password: (from DEMO_PASSWORD env)")
    print(f"Monitors     : {len(monitors)} seeded")
    print("Log in through the UI and the scheduler will pick the monitors up shortly.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
