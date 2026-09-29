# --- build stage -------------------------------------------------------------
FROM python:3.13-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /build
COPY pyproject.toml ./
COPY app ./app
RUN pip install --prefix=/install .

# --- runtime stage -----------------------------------------------------------
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# non-root user
RUN groupadd --system sitewatch && useradd --system --gid sitewatch --create-home sitewatch

WORKDIR /app
COPY --from=builder /install /usr/local
COPY --chown=sitewatch:sitewatch app ./app
COPY --chown=sitewatch:sitewatch alembic ./alembic
COPY --chown=sitewatch:sitewatch alembic.ini ./

USER sitewatch

EXPOSE 8000

# Migrations run as part of the container command (see docker-compose.yml):
#   alembic upgrade head && uvicorn app.main:app
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"

CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
