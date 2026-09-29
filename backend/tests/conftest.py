import os

# Test environment must be configured before any app import.
os.environ.setdefault("SCHEDULER_ENABLED", "false")
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("DB_ECHO", "false")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import app.models  # noqa: E402, F401  (registers all models on Base.metadata)
from app.database import get_db  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models.base import Base  # noqa: E402


@pytest.fixture()
def db_engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture()
def db_session(db_engine):
    session = sessionmaker(bind=db_engine, expire_on_commit=False, future=True)()
    yield session
    session.close()


@pytest.fixture()
def client(db_engine):
    factory = sessionmaker(bind=db_engine, expire_on_commit=False, future=True)

    def override_get_db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app = create_app()
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


PUBLIC_IP = "93.184.216.34"


@pytest.fixture(autouse=True)
def fake_dns(monkeypatch):
    """Keep the whole suite offline: every hostname resolves to a public IP.

    Individual tests can re-patch socket.getaddrinfo for specific scenarios.
    """
    import socket as socket_module

    def fake_getaddrinfo(host, *args, **kwargs):
        if host.startswith("unresolvable"):
            raise socket_module.gaierror(
                socket_module.EAI_NONAME, "Name or service not known"
            )
        return [(socket_module.AF_INET, socket_module.SOCK_STREAM, 6, "", (PUBLIC_IP, 0))]

    monkeypatch.setattr(socket_module, "getaddrinfo", fake_getaddrinfo)
