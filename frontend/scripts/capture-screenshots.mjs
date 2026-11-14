/**
 * Regenerate the README screenshots from the real running UI.
 *
 *   cd frontend && npm run screenshots
 *
 * Starts a local Vite dev server, injects a deterministic demo dataset through
 * Playwright request interception (no backend / no external network needed),
 * and captures the same screens in English and Simplified Chinese. The UI
 * language comes from the app's own locale switch (localStorage), so the
 * screenshots show the actual product, not a mock-up.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { createServer } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(here, "..");
const repoRoot = path.resolve(frontendDir, "..");
const outputRoot = path.join(repoRoot, "docs", "screenshots");
const PORT = 5174;
const BASE = `http://127.0.0.1:${PORT}`;

const now = Date.now();
const iso = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();

const DATA = {
  en: {
    dir: "en",
    user: { id: 1, email: "live@example.com", webhook_url: "https://hooks.example.com/sitewatch", created_at: iso(60 * 24 * 12), smtp_enabled: false },
    names: [
      "example.com",
      "httpbin 200 (healthy)",
      "httpbin 503 (recovered to 200)",
      "JSONPlaceholder API",
      "slow endpoint (timeout demo)",
      "keyword failure demo",
      "json mismatch demo",
    ],
    causes: [
      "Expected HTTP 200, got 503",
      "Request timed out after 10s",
      "Keyword 'Example Domain' not found in response body",
      "JSON value at 'completed' does not match expected value",
      "Connection refused",
    ],
  },
  zh: {
    dir: "zh",
    user: { id: 1, email: "live@example.com", webhook_url: "https://hooks.example.com/sitewatch", created_at: iso(60 * 24 * 12), smtp_enabled: false },
    names: [
      "示例站点 example.com",
      "httpbin 200（正常）",
      "httpbin 503（已恢复 200）",
      "JSONPlaceholder 接口",
      "慢接口（超时演示）",
      "关键字匹配失败演示",
      "JSON 断言失败演示",
    ],
    // Server-side `cause` strings are produced by the checkers and are NOT
    // translated by the UI. Keep them identical to the English dataset so the
    // Chinese screenshots show the real product, not an invented translation.
    causes: [
      "Expected HTTP 200, got 503",
      "Request timed out after 10s",
      "Keyword 'Example Domain' not found in response body",
      "JSON value at 'completed' does not match expected value",
      "Connection refused",
    ],
  },
};

function monitorsFor(locale) {
  const d = DATA[locale];
  const base = {
    ids: [1, 2, 3, 4, 5, 6, 7],
    urls: [
      "https://example.com/",
      "https://httpbin.org/status/200",
      "https://httpbin.org/status/503",
      "https://jsonplaceholder.typicode.com/todos/1",
      "https://httpbin.org/delay/20",
      "https://example.com/",
      "https://jsonplaceholder.typicode.com/todos/1",
    ],
    latency: [142, 231, 187, 312, 11_860, 244, 243],
    uptime: [100, 100, 62.5, 100, 0, 0, 0],
    status: ["up", "up", "up", "up", "down", "down", "down"],
    types: ["http", "http", "http", "api_json", "http", "keyword", "api_json"],
    checkedAgo: [0.5, 0.6, 0.7, 0.9, 4, 4, 4],
  };
  return base.ids.map((id, i) => ({
    id,
    name: d.names[i],
    type: base.types[i],
    target_url: base.urls[i],
    enabled: true,
    interval_seconds: [300, 300, 600, 600, 300, 300, 600][i],
    timeout_seconds: 10,
    expected_status: 200,
    keyword: base.types[i] === "keyword" ? "Example Domain" : null,
    keyword_mode: "contains",
    json_path: base.types[i] === "api_json" ? "completed" : null,
    json_expected_value: base.types[i] === "api_json" ? "false" : null,
    ssl_check_enabled: i === 0,
    ssl_warning_days: 30,
    last_status: base.status[i],
    last_checked_at: iso(base.checkedAgo[i]),
    next_check_at: iso(-5),
    ssl_status: i === 0 ? "valid" : "not_applicable",
    ssl_expires_at: i === 0 ? iso(-87 * 24 * 60) : null,
    ssl_days_remaining: i === 0 ? 87 : null,
    ssl_last_checked_at: i === 0 ? iso(0.5) : null,
    last_latency_ms: base.latency[i],
    uptime_24h: base.uptime[i],
    latency_stats:
      i === 0
        ? { avg_ms: 168, min_ms: 121, max_ms: 402, count: 96 }
        : null,
    created_at: iso(60 * 24 * 12),
    updated_at: iso(1),
  }));
}

function checksFor(monitorId, count = 40) {
  return Array.from({ length: count }, (_, i) => {
    const down = monitorId >= 5 && i < 6;
    return {
      id: monitorId * 1000 + (count - i),
      monitor_id: monitorId,
      checked_at: iso(i * 3 + 0.5),
      status: down ? "down" : "up",
      http_status: down ? 503 : 200,
      latency_ms: 120 + ((i * 37 + monitorId * 13) % 180),
      error_type: down ? "status_mismatch" : null,
      error_message: down ? "Expected HTTP 200, got 503" : null,
      keyword_result: null,
      json_result: null,
      ssl_days_remaining: monitorId === 1 ? 87 : null,
      ssl_status: monitorId === 1 ? "valid" : "not_applicable",
    };
  });
}

function incidentsFor(locale) {
  const d = DATA[locale];
  return [
    { id: 9, monitor_id: 5, monitor_name: d.names[4], started_at: iso(48), resolved_at: null, duration_seconds: null, failure_count: 6, cause: d.causes[1], is_resolved: false },
    { id: 8, monitor_id: 6, monitor_name: d.names[5], started_at: iso(46), resolved_at: null, duration_seconds: null, failure_count: 4, cause: d.causes[2], is_resolved: false },
    { id: 7, monitor_id: 7, monitor_name: d.names[6], started_at: iso(44), resolved_at: null, duration_seconds: null, failure_count: 3, cause: d.causes[3], is_resolved: false },
    { id: 6, monitor_id: 3, monitor_name: d.names[2], started_at: iso(180), resolved_at: iso(160), duration_seconds: 1200, failure_count: 2, cause: d.causes[0], is_resolved: true },
    { id: 5, monitor_id: 1, monitor_name: d.names[0], started_at: iso(60 * 26), resolved_at: iso(60 * 25), duration_seconds: 3600, failure_count: 1, cause: d.causes[4], is_resolved: true },
  ];
}

function buildResponses(locale) {
  const monitors = monitorsFor(locale);
  const incidents = incidentsFor(locale);
  const d = DATA[locale];
  const summary = {
    total_monitors: 7,
    up: 4,
    down: 3,
    paused: 0,
    pending: 0,
    uptime_24h: 73.33,
    active_incidents: 3,
    generated_at: iso(0),
  };
  const routes = {
    "/api/auth/me": d.user,
    "/api/dashboard/summary": summary,
    "/api/monitors": monitors,
    "/api/incidents": { items: incidents, total: incidents.length, limit: 100, offset: 0 },
  };
  monitors.forEach((m) => {
    routes[`/api/monitors/${m.id}`] = m;
    routes[`/api/monitors/${m.id}/checks`] = {
      items: checksFor(m.id),
      total: 40,
      limit: 100,
      offset: 0,
    };
    routes[`/api/monitors/${m.id}/incidents`] = {
      items: incidents.filter((i) => i.monitor_id === m.id),
      total: incidents.filter((i) => i.monitor_id === m.id).length,
      limit: 20,
      offset: 0,
    };
    routes[`/api/monitors/${m.id}/uptime`] = {
      monitor_id: m.id,
      window: "24h",
      total_checks: 96,
      up_checks: m.uptime_24h === 100 ? 96 : m.uptime_24h === 0 ? 0 : 60,
      uptime_percentage: m.uptime_24h,
    };
    routes[`/api/ssl/${m.id}`] = {
      monitor_id: m.id,
      scheme: "https",
      ssl_status: m.ssl_status,
      expires_at: m.ssl_expires_at,
      days_remaining: m.ssl_days_remaining,
      last_checked_at: m.ssl_last_checked_at,
      warning_threshold_days: 30,
    };
  });
  return routes;
}

async function installMocks(context, routes) {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    // Never touch Vite's module/HMR requests — returning JSON for a module
    // script makes the browser refuse it on MIME-type checks.
    if (url.origin !== BASE || !url.pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((prefix) => url.pathname.startsWith(prefix));
    let body = key ? routes[key] : { items: [], total: 0, limit: 100, offset: 0 };
    // Honour the same query params the real API uses, so a future screenshot
    // of a filtered incidents page or a different uptime window is accurate.
    if (url.pathname === "/api/incidents" && url.searchParams.has("active")) {
      const wantActive = url.searchParams.get("active") === "true";
      const items = body.items.filter((i) => i.is_resolved === !wantActive);
      body = { ...body, items, total: items.length };
    }
    if (url.pathname.endsWith("/uptime") && url.searchParams.has("window")) {
      body = { ...body, window: url.searchParams.get("window") };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

async function shoot(page, localeDir, name, selector) {
  try {
    await page.waitForSelector(selector, { state: "visible", timeout: 15_000 });
  } catch (error) {
    const text = await page.locator("body").innerText().catch(() => "<no body>");
    console.error(`  ✗ ${name}: selector ${selector} not found. Body text:\n${text.slice(0, 1200)}`);
    throw error;
  }
  // Let fonts / charts / animations settle before capturing.
  await page.waitForTimeout(450);
  const file = path.join(outputRoot, localeDir, `${name}.png`);
  await page.screenshot({ path: file, animations: "disabled" });
  console.log(`  ✓ ${path.relative(repoRoot, file)}`);
}

async function captureLocale(browser, locale) {
  const d = DATA[locale];
  const routes = buildResponses(locale);
  await mkdir(path.join(outputRoot, d.dir), { recursive: true });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: locale === "zh" ? "zh-CN" : "en-US",
  });
  await context.addInitScript(
    ({ value }) => {
      localStorage.setItem("sitewatch_locale", value);
      localStorage.setItem("sitewatch_token", "screenshot-demo-token");
    },
    { value: locale },
  );
  await installMocks(context, routes);
  // A UI exception must never produce a screenshot that looks healthy: collect
  // everything and fail the whole run at the end instead.
  const pageErrors = [];
  const watch = (target) => {
    target.on("pageerror", (error) => pageErrors.push(`[pageerror] ${error.message}`));
    target.on("console", (message) => {
      if (message.type() === "error") pageErrors.push(`[console] ${message.text()}`);
    });
  };
  const page = await context.newPage();
  watch(page);

  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await shoot(page, d.dir, "dashboard", "h1");

  await page.goto(`${BASE}/monitors`, { waitUntil: "networkidle" });
  await shoot(page, d.dir, "monitors", "h1");

  await page.goto(`${BASE}/monitors/1`, { waitUntil: "networkidle" });
  await shoot(page, d.dir, "monitor-detail", "h1");

  await page.goto(`${BASE}/incidents`, { waitUntil: "networkidle" });
  await shoot(page, d.dir, "incidents", "h1");

  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await shoot(page, d.dir, "settings", "h1");

  await page.goto(`${BASE}/monitors`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: locale === "zh" ? "+ 新建监控" : "+ New monitor" }).click();
  await shoot(page, d.dir, "create-monitor", "[role=dialog]");

  await context.close();

  // Login screen is anonymous: no token, otherwise the router redirects home.
  const authContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: locale === "zh" ? "zh-CN" : "en-US",
  });
  await authContext.addInitScript(
    ({ value }) => localStorage.setItem("sitewatch_locale", value),
    { value: locale },
  );
  await installMocks(authContext, routes);
  const loginPage = await authContext.newPage();
  watch(loginPage);
  await loginPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await shoot(loginPage, d.dir, "login", "h1");
  await authContext.close();

  if (pageErrors.length) {
    throw new Error(`UI errors while capturing ${locale}:\n${pageErrors.join("\n")}`);
  }
}

async function main() {
  await mkdir(outputRoot, { recursive: true });
  const server = await createServer({
    root: frontendDir,
    server: { host: "127.0.0.1", port: PORT, strictPort: true },
    logLevel: "error",
  });
  await server.listen();

  const browser = await chromium.launch({ headless: true });
  try {
    for (const locale of ["en", "zh"]) {
      console.log(`Capturing ${locale === "en" ? "English" : "Chinese"} UI…`);
      await captureLocale(browser, locale);
    }
  } finally {
    await browser.close();
    await server.close();
  }

  const manifest = {
    generated_at: new Date().toISOString(),
    note: "Captured from the running Vite UI with a deterministic demo dataset. Regenerate with: cd frontend && npm run screenshots",
    locales: ["en", "zh"],
    screens: ["dashboard", "monitors", "monitor-detail", "incidents", "settings", "create-monitor", "login"],
  };
  await writeFile(path.join(outputRoot, "screenshots.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
