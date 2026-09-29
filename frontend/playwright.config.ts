import { defineConfig } from "@playwright/test";
import { sep } from "node:path";

const backendPort = 8123;
// E2E runs the real stack: uvicorn backend + vite frontend + a database.
// The database engine is SQLite by default (same SQLAlchemy models and
// migrations as PostgreSQL); CI covers PostgreSQL via the pytest job.
// Override the interpreter when the backend deps live in a venv, e.g.:
//   E2E_PYTHON=".venv/Scripts/python" npm run e2e
// (slashes are normalized so the same value works on cmd.exe and POSIX shells)
const python = (process.env.E2E_PYTHON || "python").replaceAll("/", sep);

// Fresh database for every run: tests must be repeatable from zero.
const backendSetup = [
  `${python} -c "import os; os.path.exists('e2e.db') and os.remove('e2e.db')"`,
  `${python} -m alembic upgrade head`,
  `${python} -m uvicorn app.main:app --port ${backendPort}`,
].join(" && ");

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000, // live-network checks can take up to ~45s with bounded retries
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: backendSetup,
      cwd: "../backend",
      url: `http://127.0.0.1:${backendPort}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        ...process.env,
        DATABASE_URL: "sqlite:///./e2e.db",
        SECRET_KEY: "e2e-only-secret-key-0123456789abcdef",
        APP_ENV: "development",
        SCHEDULER_ENABLED: "false", // manual checks keep the suite deterministic
        PYTHONUNBUFFERED: "1",
      },
    },
    {
      command: "npm run dev",
      cwd: ".",
      url: "http://localhost:5173/",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        ...process.env,
        BACKEND_ORIGIN: `http://127.0.0.1:${backendPort}`,
      },
    },
  ],
});
