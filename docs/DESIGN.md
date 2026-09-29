# SiteWatch — Design Document

Website & API Monitoring Platform. A lightweight self-hosted monitoring platform for
websites and APIs, with scheduled checks, uptime history, SSL monitoring, alerts, and a
web dashboard.

This document is the pre-implementation design (sections A–J of the project brief).
The implementation follows it; where the brief allowed a choice, the decision is stated
explicitly and marked **[DECISION]**.

---

## A. Technology Selection (技术选型)

| Layer | Choice | Why |
|---|---|---|
| Language | Python 3.11+ (verified on 3.13) | Required stack |
| Web framework | FastAPI + Pydantic v2 | Required; typed request/response validation |
| ORM / DB | SQLAlchemy 2.x (sync) + Alembic | Required; sync keeps tests and scheduler simple |
| Database | PostgreSQL (prod) / SQLite (tests, local demo) | Required for prod; SQLite keeps unit tests dependency-free |
| HTTP client | httpx (sync), `MockTransport` for tests | Required |
| Scheduler | **Custom lightweight dispatcher** (daemon thread + `ThreadPoolExecutor`) — **[DECISION]** | APScheduler's cron-job model fights dynamic per-monitor intervals (create/pause/resume at runtime). A single scan loop over `next_check_at` is ~100 lines, restart-safe, and trivially testable. This satisfies "APscheduler **或其他轻量 scheduler**". |
| Auth | PyJWT (HS256 bearer tokens) + bcrypt password hashing | Simple, standard; no OAuth/RBAC per brief |
| SSL parsing | `cryptography` (X.509 `not_valid_after`) | Standard, maintained |
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS v4 | Required stack |
| Frontend data/state | TanStack Query + react-router-dom | Loading/error/retry states built in; no Redux overkill |
| Charts | Recharts (latency trend) + custom SVG/CSS bars (uptime strip) | Standard; the uptime bar is trivial CSS |
| Frontend tests | Vitest + Testing Library + jsdom | Light, fast, no browser needed |
| E2E | Playwright (small smoke flow) | Optional per brief; added if environment allows browser download |
| Infra | Docker + docker-compose (backend, frontend/nginx, postgres) | Required |
| Lint | Ruff (backend), `tsc` + Vite build (frontend) | Required |
| CI | GitHub Actions: pytest on 3.11/3.13 with Postgres service; npm build + tests | Required |

Explicitly excluded (per brief): Redis, Celery, Kafka, RabbitMQ, Kubernetes, Terraform,
microservices, AI frameworks.

---

## B. System Architecture (系统架构)

Single deployable unit per tier; single-process backend.

```
                ┌───────────────────────────────────────────────┐
                │                  Backend (FastAPI)            │
 Browser ──────▶│  ┌──────────┐   ┌──────────────────────────┐  │
 (React SPA)    │  │ REST API │──▶│ Service layer            │  │
                │  │ (routes) │   │ (auth, monitors, checks, │  │
  nginx ─/api──▶│  └──────────┘   │ incidents, uptime, notif)│  │
  static files  │                 └───────────┬──────────────┘  │
                │  ┌──────────────┐           │                 │
                │  │ Scheduler    │──▶ Check Engine               │
                │  │ (scan loop + │   │HTTPChecker / SSLChecker  │
                │  │ thread pool) │   │KeywordRule / JSONRule    │
                │  └──────────────┘   └───────┬──────┬──────────┘
                │                             │      │
                │            ┌────────────────┘      │ notifications
                │            ▼                       ▼
                │      Incident service      Webhook / SMTP
                │            │
                └────────────┼──────────────────────────────┘
                             ▼
                     PostgreSQL (SQLAlchemy 2.x + Alembic)
```

Key points:

- **Check execution is separated from scheduling.** The scheduler only decides *when*
  (`next_check_at <= now`); the Check Engine executes a check; services persist results.
- **No business logic in FastAPI routes.** Routes parse/validate HTTP concerns and
  delegate to `app/services/*`.
- Single process, single instance. The scheduler is an in-process daemon thread with a
  bounded worker pool (`MAX_CONCURRENT_CHECKS`, default 10). **Not** suitable for
  multi-replica deployment (documented in README Limitations).
- On startup, the scheduler recovers automatically: any enabled monitor whose
  `next_check_at` is in the past is immediately due. No persistent job state needed.

## C. Data Model (数据模型)

Five tables (all timestamps stored as UTC; `UTCDateTime` TypeDecorator keeps SQLite and
PostgreSQL consistent):

**users**
| column | type | notes |
|---|---|---|
| id | int PK | |
| email | str unique, indexed | validated `EmailStr` at API layer |
| password_hash | str | bcrypt, never plaintext |
| webhook_url | str nullable | user-level webhook channel, settable via UI |
| created_at | datetime | |

**monitors**
| column | type | notes |
|---|---|---|
| id, user_id (FK users, indexed), name, enabled (bool, default true) | | |
| type | enum `http` \| `keyword` \| `api_json` \| `ssl` | primary check type |
| target_url | str | validated at creation (scheme, SSRF guard) |
| interval_seconds | int | 60–86400, default 300 |
| timeout_seconds | int | 1–30, default 10 |
| expected_status | int | default 200 |
| keyword | str nullable, keyword_mode enum `contains`\|`not_contains` | used when set (or type=`keyword`) |
| json_path, json_expected_value | str nullable | dot notation, safe extractor |
| ssl_check_enabled | bool default false | sidecar SSL info for https monitors |
| ssl_warning_days | int default 30 | |
| last_status | enum `up`\|`down`\|null | denormalized current status |
| last_checked_at, next_check_at | datetime | scheduler cursor; survives restarts |
| ssl_expires_at, ssl_days_remaining, ssl_last_checked, ssl_alert_state | | SSL cache for dashboard/API (`ssl_alert_state`: `ok`\|`warning`\|`expired`\|null) |
| created_at, updated_at | | |

**monitor_checks** (history, retention-pruned)
| column | notes |
|---|---|
| id, monitor_id (FK, indexed), checked_at (indexed) | |
| status | `up` \| `down` |
| http_status | int nullable |
| latency_ms | int nullable |
| error_type | `timeout`\|`connection_error`\|`dns_error`\|`tls_error`\|`status_mismatch`\|`keyword_failed`\|`json_failed`\|`ssl_expired`\|`internal_error`\|null |
| error_message | str nullable |
| keyword_result | `pass`\|`fail`\|null |
| json_result | `pass`\|`fail`\|null |
| ssl_days_remaining, ssl_status (`valid`\|`expiring_soon`\|`expired`\|`not_applicable`\|`unknown`) | |

**incidents**
| column | notes |
|---|---|
| id, monitor_id (FK, indexed) | |
| started_at, resolved_at (nullable), duration_seconds (nullable) | |
| failure_count | incremented per DOWN check while open |
| cause | first failure summary (status code / error type) |
| is_resolved | bool, indexed (partial "active" lookups) |

**notifications** (audit trail of every alert attempt)
| column | notes |
|---|---|
| id, user_id, monitor_id, incident_id nullable | |
| channel | `webhook` \| `email` |
| event | `monitor_down` \| `recovered` \| `ssl_expiring` \| `ssl_expired` |
| status | `sent` \| `failed` \| `skipped` |
| detail | error/message |

Status rule **[DECISION]**: HTTP status mismatch, timeout/connection/DNS/TLS errors,
keyword failure, JSON parse/path/value failure, and expired certificate (type=`ssl`)
all produce **`down`**. There is no separate DEGRADED state — content-level failures
are downtime (documented in README).

## D. API Design (API 设计)

All responses JSON, timestamps ISO-8601 UTC (`Z`). Errors use one envelope:

```json
{ "error": { "code": "not_found", "message": "Monitor not found" } }
```

Auth: `Authorization: Bearer <JWT>`; 401 unauthenticated, 403 not-owner (existence is
not leaked — other users' monitors return 404), 422 request validation (same envelope),
500 generic (no traceback, no DB details).

| Method & path | Purpose |
|---|---|
| GET /health | liveness (no auth): `{status:"ok", version}` |
| POST /api/auth/register | create account → 201 `{id,email}` |
| POST /api/auth/login | `{email,password}` → `{access_token,token_type}` |
| GET /api/auth/me | current user |
| PUT /api/me/notifications | set `webhook_url` |
| POST /api/me/notifications/test | send test event to configured webhook |
| GET /api/monitors | list own monitors (+ current status/latency/uptime24h/ssl) |
| POST /api/monitors | create (enforces `MAX_MONITORS_PER_USER`) → 201 |
| GET /api/monitors/{id} | detail incl. latency stats + uptime + ssl |
| PUT /api/monitors/{id} | update config; `interval_seconds`/`timeout_seconds` bounded |
| DELETE /api/monitors/{id} | delete (cascades checks/incidents) → 204 |
| POST /api/monitors/{id}/check | run one check now, return result |
| POST /api/monitors/{id}/enable / disable | set enabled; disable stops scheduling |
| GET /api/monitors/{id}/checks | paginated history `?limit=&offset=&hours=1\|24\|168\|720` |
| GET /api/monitors/{id}/uptime | `?window=1h\|24h\|7d\|30d` → `{total_checks, up_checks, uptime_percentage}` |
| GET /api/monitors/{id}/incidents | incidents of one monitor |
| GET /api/incidents | all own incidents `?active=true&limit=&offset=` |
| GET /api/dashboard/summary | totals, up/down/paused, 24h uptime, active incidents |
| GET /api/ssl/{monitor_id} | SSL info: valid / expiring_soon / expired / not_applicable |

Pagination: `limit` (default 50, max 200) + `offset`. Only actual stored checks count
toward uptime (no projection into the future).

## E. Frontend Pages (前端页面)

Dark, data-dense dashboard theme (Tailwind). No marketing landing page.

| Page | Contents |
|---|---|
| Login / Register | forms with inline validation + server error banner |
| Dashboard | stat cards (total / up / down / paused / 24h uptime / active incidents), monitor table (status dot, latency, 20-check uptime strip, SSL badge), recent incidents |
| Monitors | table + create/edit modal (all fields per type), actions: check now, enable/disable, delete |
| Monitor Detail | status header, latency chart (24h, Recharts), uptime bar strip, latency min/avg/max, check history table (paginated, window selector 1h/24h/7d/30d), incidents, SSL card, config card |
| Incidents | active + resolved list |
| Settings | account info, webhook URL + "send test", SMTP status (env-provided, read-only indicator) |

Every page handles loading, empty, success, validation error, server error, and
offline/retry states (TanStack Query retries + explicit error UI). No white screens.

## F. Scheduler / Worker (调度设计)

```
Startup (lifespan, SCHEDULER_ENABLED=true):
  thread = daemon "sitewatch-scheduler"

Loop (every SCHEDULER_SCAN_INTERVAL=10s):
  1. now = utcnow()
  2. due = SELECT monitors WHERE enabled AND next_check_at <= now   (own session)
  3. for each due monitor (bounded by running-set + pool size):
       - set next_check_at = now + interval_seconds (commit immediately → no re-dispatch)
       - submit run_check(monitor_id) to ThreadPoolExecutor(MAX_CONCURRENT_CHECKS)
  4. running-set + lock prevents the same monitor overlapping itself
  5. once per day: retention job deletes checks older than RETENTION_DAYS
```

Properties (each covered by tests):

- **No duplicates**: `next_check_at` advanced at dispatch time inside the scan
  transaction; per-monitor in-flight set.
- **Disabled monitors** are never picked up; enable resets `next_check_at = now`.
- **Isolation**: one monitor's check failure is caught and logged; the loop continues.
- **Restart recovery**: `next_check_at` is persisted; after restart overdue monitors run
  immediately. No external state.
- Manual "check now" uses the same Check Engine, bypassing the interval.
- Single-instance only (README Limitations).

## G. Monitoring Engine (监控引擎)

```
run_check(monitor_id):
  Monitor ──▶ HTTPChecker.check()  (httpx, injected transport for tests)
                │ GET with User-Agent "SiteWatch/<version>",
                │ timeout, max 2 retries w/ exponential backoff (transport errors only),
                │ max 5 redirects (re-validated against SSRF guard at each hop),
                │ response body capped (MAX_RESPONSE_BYTES=2MB)
                ├─▶ KeywordRule   (contains / not_contains)
                ├─▶ JSONRule      (safe dot-path extraction, JSON-equality compare)
                └─▶ SSLChecker    (TLS handshake, X.509 not_valid_after via cryptography)
  = CheckOutcome {status, http_status, latency_ms, error_type, error_message,
                  keyword_result, json_result, ssl_*}
  ──▶ persistence (monitor_checks row; monitor last_status/last_checked_at/ssl cache)
  ──▶ IncidentService  (UP→DOWN open, DOWN→DOWN extend, DOWN→UP close)
  ──▶ NotificationService (dedup: alert on incident open/recovery only,
                           ssl alert on ssl_alert_state transition only)
```

- `type=ssl` monitors do TLS-only checks (no body assertions); expired cert → `down`.
- For `http://` targets SSL status is `not_applicable`.
- SSL expiry never flips an HTTP monitor to down; it drives the separate
  `ssl_expiring`/`ssl_expired` alert stream.

**Alert dedup [DECISION]**: exactly one `monitor_down` alert per incident, one
`recovered` on resolution, one `ssl_expiring` when the cert first enters the warning
window, one `ssl_expired` when it lapses — no per-check repeats.

## H. Testing Strategy (测试策略)

- Backend: pytest, **no real internet**. All HTTP via `httpx.MockTransport`;
  SSL via a fake cert provider; scheduler logic tested without threads
  (`scan_due_monitors()` is a pure function over a session); DB via SQLite in-memory/file
  (same SQLAlchemy models); API via FastAPI `TestClient` (integration: route→service→DB).
  Coverage targets: auth, hashing, JWT, monitor CRUD + validation, SSRF/URL guard,
  checkers (success/timeout/retry/status-mismatch/keyword/JSON), SSL, incident
  transitions, notification dedup, uptime math, retention, pagination, ownership
  isolation. Target ≥100 meaningful tests.
- Frontend: Vitest + Testing Library (login validation, monitor list, create form
  validation, API error state, dashboard loading/empty). Optional Playwright smoke.
- CI (GitHub Actions): backend matrix Python 3.11 & 3.13 with a Postgres service
  (proves PostgreSQL compatibility), ruff; frontend `npm ci && build && vitest`.
  No secrets required.

## I. Docker Deployment (Docker 部署方案)

- `backend/Dockerfile`: python:3.13-slim, non-root user, deps via pip; container command
  `alembic upgrade head && uvicorn app.main:app` (schema only via Alembic — never
  created in startup code). Healthcheck hits `/health`.
- `frontend/Dockerfile`: node build stage → nginx:alpine serving the SPA; nginx proxies
  `/api` and `/health` to the backend service (so one origin, no CORS in prod).
- `docker-compose.yml`: postgres:16 (named volume, `pg_isready` healthcheck), backend
  (depends_on healthy), frontend (publishes 8080). All secrets via environment /
  `.env` (gitignored); `.env.example` documents every variable. `SECRET_KEY` must be set
  in production (backend refuses to boot with the dev default when `APP_ENV=production`).
- **[Known limitation, honest reporting]** Docker is not installed in the development
  environment used to build this project (`docker: command not found`), so
  `docker compose up` could not be executed here; images/config follow standard practice
  and CI covers the application tests.

## J. MVP vs Non-MVP

**MVP (all implemented here):** auth (email+password, JWT), monitor CRUD with SSRF-validated
URLs, four check types (HTTP status, keyword, API JSON, SSL cert), scheduler with
intervals 60–86400s, check history + retention, uptime stats, incidents, webhook +
email notifications with dedup, dashboard/monitors/detail/incidents/settings pages,
REST API, tests, CI, Docker config, seed/demo data.

**Non-MVP (explicitly out of scope):** multi-user teams/RBAC, OAuth, distributed
schedulers, Prometheus/Grafana export, push notifications, DNS/blackbox exporters,
browser/transaction monitoring, multi-replica HA.

---

## Open decisions resolved (and why)

1. **Keyword/JSON failure → DOWN** (not a separate DEGRADED state). One clear rule.
2. **Sync SQLAlchemy + sync httpx + thread-pool scheduler.** At this scale (≤ hundreds
   of monitors) threads are simpler and fully sufficient; async would add complexity
   without benefit and would force `pytest-asyncio` everywhere.
3. **Custom scan-loop scheduler** instead of APScheduler (dynamic per-monitor intervals,
   restart recovery, pause/resume for free). See section F.
4. **SQLite for unit tests, PostgreSQL for prod/CI.** Models/migrations are portable;
   CI runs the suite against real Postgres 16.
5. **Ownership isolation returns 404** (not 403) to avoid resource enumeration.
