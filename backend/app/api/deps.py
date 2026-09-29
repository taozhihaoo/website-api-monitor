from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.api.errors import ApiError
from app.database import get_db
from app.models.user import User
from app.services import auth_service

_bearer = HTTPBearer(auto_error=False)

UNAUTHORIZED = ApiError(401, "unauthorized", "Authentication required")


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None or not credentials.credentials:
        raise UNAUTHORIZED
    user_id = auth_service.decode_access_token(credentials.credentials)
    if user_id is None:
        raise ApiError(401, "unauthorized", "Invalid or expired token")
    user = db.get(User, user_id)
    if user is None:
        raise ApiError(401, "unauthorized", "Invalid or expired token")
    return user
