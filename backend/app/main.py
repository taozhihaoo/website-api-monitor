from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.errors import install_error_handlers
from app.api.routes import auth, dashboard, incidents, monitors, ssl
from app.api.routes import settings as settings_routes
from app.config import get_settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    if settings.scheduler_enabled:
        # Imported lazily so tooling/tests can import app without the scheduler.
        from app.scheduler.scheduler import start_scheduler, stop_scheduler

        start_scheduler()
    yield
    if settings.scheduler_enabled:
        from app.scheduler.scheduler import stop_scheduler

        stop_scheduler()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version=settings.version,
        description="Lightweight self-hosted website & API monitoring.",
        lifespan=lifespan,
    )
    origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )
    install_error_handlers(app)
    app.include_router(auth.router)
    app.include_router(monitors.router)
    app.include_router(dashboard.router)
    app.include_router(incidents.router)
    app.include_router(ssl.router)
    app.include_router(settings_routes.router)

    @app.get("/health", tags=["health"])
    def health() -> dict:
        return {"status": "ok", "version": settings.version}

    return app


app = create_app()
