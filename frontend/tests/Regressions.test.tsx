import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/api/client", async () => await import("./mocks/api-client"));
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";

import { api, mockGet, mockLoggedIn, renderWithProviders, resetApiMocks } from "./test-utils";
import { queryKeys, WINDOW_HOURS } from "../src/api/hooks";
import { MonitorsPage } from "../src/pages/MonitorsPage";
import { MonitorDetailPage } from "../src/pages/MonitorDetailPage";

const MONITOR = {
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
  last_checked_at: "2026-11-12T10:00:00Z",
  next_check_at: "2026-11-12T10:05:00Z",
  ssl_status: "not_applicable",
  ssl_expires_at: null,
  ssl_days_remaining: null,
  ssl_last_checked_at: null,
  last_latency_ms: 210,
  uptime_24h: 99.9,
  latency_stats: null,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
};

beforeEach(() => {
  resetApiMocks();
  window.localStorage.clear();
});

describe("query cache correctness", () => {
  it("does not share a cache entry between different history limits", () => {
    // Dashboard requests 30 checks, detail requests 100 for the same monitor
    // and window — they must not overwrite each other.
    expect(queryKeys.checks(1, 24, 30)).not.toEqual(queryKeys.checks(1, 24, 100));
  });

  it("maps every detail window to the matching API hours value", () => {
    expect(WINDOW_HOURS).toEqual({ "1h": 1, "24h": 24, "7d": 168, "30d": 720 });
  });
});

describe("custom interval in the monitor form", () => {
  it("reveals the custom input and submits its value", async () => {
    const user = userEvent.setup();
    mockLoggedIn();
    mockGet({ "/api/monitors": [] });
    vi.mocked(api.post).mockResolvedValue(MONITOR);

    renderWithProviders(<MonitorsPage />, "/monitors");
    await user.click(await screen.findByRole("button", { name: /new monitor/i }));
    await user.type(screen.getByLabelText(/name/i), "Custom cadence");
    await user.type(screen.getByLabelText(/url/i), "https://example.com");

    expect(screen.queryByLabelText("Custom interval in seconds")).toBeNull();
    await user.selectOptions(screen.getByLabelText(/check interval/i), "");
    const input = screen.getByLabelText("Custom interval in seconds");
    expect(input).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, "900");
    await user.click(screen.getByRole("button", { name: /create monitor/i }));

    await vi.waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/api/monitors",
        expect.objectContaining({ interval_seconds: 900 }),
      );
    });
  });
});

describe("check history window", () => {
  it("refetches history for the selected window instead of always 24h", async () => {
    const user = userEvent.setup();
    mockLoggedIn();
    // mockGet matches by prefix in insertion order — longest paths first.
    mockGet({
      "/api/monitors/1/checks": { items: [], total: 0, limit: 100, offset: 0 },
      "/api/monitors/1/uptime": {
        monitor_id: 1,
        window: "24h",
        total_checks: 0,
        up_checks: 0,
        uptime_percentage: null,
      },
      "/api/monitors/1/incidents": { items: [], total: 0, limit: 20, offset: 0 },
      "/api/ssl/1": {
        monitor_id: 1,
        scheme: "https",
        ssl_status: "not_applicable",
        warning_threshold_days: 30,
      },
      "/api/monitors/1": MONITOR,
    });

    renderWithProviders(
      <Routes>
        <Route path="/monitors/:id" element={<MonitorDetailPage />} />
      </Routes>,
      "/monitors/1",
    );
    await screen.findByRole("heading", { name: "Marketing site" });
    expect(
      vi.mocked(api.get).mock.calls.some(([path]) => path.includes("hours=24")),
    ).toBe(true);

    await user.click(screen.getByRole("button", { name: "7d" }));
    await vi.waitFor(() => {
      expect(
        vi.mocked(api.get).mock.calls.some(([path]) => path.includes("hours=168")),
      ).toBe(true);
    });
  });
});
