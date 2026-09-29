"""Shared helpers for API tests."""

import itertools

from sqlalchemy.orm import Session

from app.models.user import User

DEFAULT_PASSWORD = "correct-horse-1"

_email_counter = itertools.count(1)


def unique_email(prefix: str = "dbuser") -> str:
    return f"{prefix}-{next(_email_counter)}@example.com"


def register_and_login(
    client, email: str = "user1@example.com", password: str = DEFAULT_PASSWORD
) -> dict[str, str]:
    client.post("/api/auth/register", json={"email": email, "password": password})
    resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def create_user(db: Session, email: str | None = None) -> User:
    from app.services.auth_service import hash_password

    user = User(
        email=email or unique_email(), password_hash=hash_password(DEFAULT_PASSWORD)
    )
    db.add(user)
    db.commit()
    return user
