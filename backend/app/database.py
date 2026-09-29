from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import get_settings


def _engine_kwargs(url: str) -> dict:
    if url.startswith("sqlite"):
        # FastAPI runs sync routes in a threadpool; allow the cross-thread connection.
        return {"connect_args": {"check_same_thread": False}}
    return {"pool_pre_ping": True, "pool_size": 5, "max_overflow": 10}


_settings = get_settings()
engine = create_engine(
    _settings.database_url,
    echo=_settings.db_echo,
    future=True,
    **_engine_kwargs(_settings.database_url),
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
