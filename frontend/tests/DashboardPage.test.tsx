import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/api/client", async () => await import("./mocks/api-client"));
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { api, ApiError, mockGet, mockLoggedIn, resetApiMocks, renderWithProviders } from "./test-utils";
import { DashboardPage } from "../src/pages/DashboardPage";

const SUMMARY = {
  total_monitors: 3,
  up: 2,
  down: 1,
  paused: 0,
  pending: 0,
  uptime_24h: 98.5,
  active_incidents: 1,
  generated_at: "2026-09-30T00:00:00Z",
};

const MONITORS = [
  {
    id: 1,
    name: "Marketing site",
    type: "http",
    target_url: "https://example.com",
    enabled: true,
    interval_seconds: 300,
    timeout_seconds: 10,
    expected_status: 200,
    keyword: null,
    keyword_mode: "contains",
    json_path: null,
    json_expected_value: null,
    ssl_check_enabled: false,
    ssl_warning_days: 30,
    last_status: "up",
    last_checked_at: "2026-09-30T00:00:00Z",
    next_check_at: "2026-09-30T00:05:00Z",
    ssl_status: "not_applicable",
    ssl_expires_at: null,
    ssl_days_remaining: null,
    ssl_last_checked_at: null,
    last_latency_ms: 123,
    uptime_24h: 100,
    created_at: "2026-09-30T00:00:00Z",
    updated_at: "2026-09-30T00:00:00Z",
  },
  {
    id: 2,
    name: "Payment API",
    type: "api_json",
    target_url: "https://api.example.com/health",
    enabled: true,
    interval_seconds: 60,
    timeout_seconds: 5,
    expected_status: 200,
    keyword: null,
    keyword_mode: "contains",
    json_path: "status",
    json_expected_value: "ok",
    ssl_check_enabled: true,
    ssl_warning_days: 30,
    last_status: "down",
    last_checked_at: "2026-09-30T00:00:00Z",
    next_check_at: "2026-09-30T00:01:00Z",
    ssl_status: "expiring_soon",
    ssl_expires_at: "2026-10-15T00:00:00Z",
    ssl_days_remaining: 15,
    ssl_last_checked_at: "2026-09-30T00:00:00Z",
    last_latency_ms: null,
    uptime_24h: 92.31,
    created_at: "2026-09-30T00:00:00Z",
    updated_at: "2026-09-30T00:00:00Z",
  },
];

beforeEach(() => {
  resetApiMocks();
});

describe("DashboardPage", () => {
  it("renders summary stats and monitor rows", async () => {
    mockLoggedIn();
    mockGet({
      "/api/dashboard/summary": SUMMARY,
      "/api/monitors": MONITORS,
      "/api/monitors/1/checks": { items: [], total: 0, limit: 30, offset: 0 },
      "/api/monitors/2/checks": { items: [], total: 0, limit: 30, offset: 0 },
      "/api/incidents": { items: [], total: 0, limit: 100, offset: 0 },
    });
    renderWithProviders(<DashboardPage />, "/");

    expect(await screen.findByText("Marketing site")).toBeInTheDocument();
    expect(screen.getByText("Payment API")).toBeInTheDocument();
    expect(screen.getByText("98.5%")).toBeInTheDocument();
    expect(screen.getByText("123 ms")).toBeInTheDocument();
  });

  it("shows the empty state when there are no monitors", async () => {
    mockLoggedIn();
    mockGet({
      "/api/dashboard/summary": { ...SUMMARY, total_monitors: 0, up: 0, down: 0 },
      "/api/monitors": [],
      "/api/incidents": { items: [], total: 0, limit: 100, offset: 0 },
    });
    renderWithProviders(<DashboardPage />, "/");
    expect(await screen.findByText(/no monitors yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /create a monitor/i })).toBeInTheDocument();
  });

  it("shows an error banner with retry when the API fails", async () => {
    mockLoggedIn();
    vi.mocked(api.get).mockRejectedValue(new ApiError(0, "network_error", "offline"));
    renderWithProviders(<DashboardPage />, "/");
    expect(await screen.findByRole("alert")).toHaveTextContent(/offline/i);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});

describe("StatusBadge", () => {
  it("renders each state label", async () => {
    mockLoggedIn();
    mockGet({
      "/api/dashboard/summary": SUMMARY,
      "/api/monitors": MONITORS,
      "/api/incidents": { items: [], total: 0, limit: 100, offset: 0 },
    });
    renderWithProviders(<DashboardPage />, "/");
    await screen.findByText("Marketing site");
    expect(screen.getAllByText("UP").length).toBeGreaterThan(0);
    expect(screen.getAllByText("DOWN").length).toBeGreaterThan(0);
  });
});

describe("Incidents section", () => {
  it("renders recent incidents with monitor links", async () => {
    mockLoggedIn();
    mockGet({
      "/api/dashboard/summary": SUMMARY,
      "/api/monitors": MONITORS,
      "/api/incidents": {
        items: [
          {
            id: 9,
            monitor_id: 2,
            monitor_name: "Payment API",
            started_at: "2026-09-29T23:00:00Z",
            resolved_at: null,
            duration_seconds: null,
            failure_count: 3,
            cause: "Expected HTTP 200, got 503",
            is_resolved: false,
          },
        ],
        total: 1,
        limit: 100,
        offset: 0,
      },
    });
    renderWithProviders(<DashboardPage />, "/");
    expect(await screen.findByText(/expected http 200, got 503/i)).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: "Payment API" });
    expect(links[0]).toHaveAttribute("href", "/monitors/2");
  });
});

describe("userEvent smoke", () => {
  it("retry button calls refetch", async () => {
    mockLoggedIn();
    let fail = true;
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.startsWith("/api/auth/me")) {
        return { id: 1, email: "t@example.com", webhook_url: null, created_at: "" };
      }
      if (fail) {
        throw new ApiError(500, "internal_error", "boom");
      }
      if (path.startsWith("/api/dashboard/summary")) {
        return SUMMARY;
      }
      if (path.includes("/checks")) {
        return { items: [], total: 0, limit: 30, offset: 0 };
      }
      if (path.startsWith("/api/monitors")) {
        return MONITORS;
      }
      if (path.startsWith("/api/incidents")) {
        return { items: [], total: 0, limit: 100, offset: 0 };
      }
      throw new ApiError(404, "not_found", `no mock for ${path}`);
    });
    renderWithProviders(<DashboardPage />, "/");
    const retry = await screen.findByRole("button", { name: /retry/i });
    fail = false;
    await userEvent.click(retry);
    // retry re-runs the summary query; the summary recovers while the
    // independent monitors query keeps its own (separate) error banner.
    expect(await screen.findByText("98.5%")).toBeInTheDocument();
  });
});
