from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.errors import ApiError
from app.database import get_db
from app.models.user import User
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse, UserResponse
from app.services import auth_service

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Constant-cost comparison for unknown accounts: without it the login response
# time reveals whether an email is registered (bcrypt is ~100x slower than a
# failed SELECT). Generated once per process, never used for a real account.
_DUMMY_HASH = auth_service.hash_password("sitewatch-dummy-timing-password")


def _user_response(user: User) -> UserResponse:
    from app.config import get_settings

    return UserResponse(
        id=user.id,
        email=user.email,
        webhook_url=user.webhook_url,
        created_at=user.created_at,
        smtp_enabled=get_settings().smtp_enabled,
    )


@router.post("/register", status_code=201, response_model=UserResponse)
def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> UserResponse:
    email = payload.email.strip().lower()
    existing = db.scalar(select(User).where(User.email == email))
    if existing is not None:
        raise ApiError(409, "email_taken", "An account with this email already exists")
    user = User(email=email, password_hash=auth_service.hash_password(payload.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        # Concurrent registrations with the same email hit the unique index;
        # report the documented 409 instead of bubbling up as a 500.
        db.rollback()
        raise ApiError(409, "email_taken", "An account with this email already exists") from exc
    db.refresh(user)
    return _user_response(user)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    email = payload.email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    # Same error AND same work for unknown email and wrong password:
    # no account enumeration via response body or timing.
    hash_to_check = user.password_hash if user is not None else _DUMMY_HASH
    password_ok = auth_service.verify_password(payload.password, hash_to_check)
    if user is None or not password_ok:
        raise ApiError(401, "invalid_credentials", "Invalid email or password")
    token = auth_service.create_access_token(user.id)
    return TokenResponse(access_token=token)


@router.get("/me", response_model=UserResponse)
def me(user: User = Depends(get_current_user)) -> UserResponse:
    return _user_response(user)
