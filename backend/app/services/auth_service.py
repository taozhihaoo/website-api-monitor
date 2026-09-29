import bcrypt
import jwt
from datetime import datetime, timedelta, timezone

from app.config import get_settings

_ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(
    user_id: int, expires_delta: timedelta | None = None, secret_key: str | None = None
) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    delta = expires_delta or timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": str(user_id), "iat": now, "exp": now + delta}
    return jwt.encode(
        payload, secret_key or settings.secret_key, algorithm=_ALGORITHM
    )


def decode_access_token(token: str, secret_key: str | None = None) -> int | None:
    """Return the user id encoded in the token, or None if invalid/expired."""
    try:
        payload = jwt.decode(
            token, secret_key or get_settings().secret_key, algorithms=[_ALGORITHM]
        )
        return int(payload["sub"])
    except (jwt.PyJWTError, KeyError, TypeError, ValueError):
        return None
