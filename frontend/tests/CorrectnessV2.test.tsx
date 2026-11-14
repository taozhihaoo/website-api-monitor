import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/api/client", async () => await import("./mocks/api-client"));

import { isPrivateTarget, validateMonitorForm } from "../src/components/MonitorFormModal";
import type { FormState } from "../src/components/MonitorFormModal";
import { IncidentsPage } from "../src/pages/IncidentsPage";
import {
  formatDuration,
  formatInterval,
  formatRelative,
} from "../src/utils/format";
import { mockGet, renderWithProviders, resetApiMocks } from "./test-utils";

const baseForm: FormState = {
  name: "Example",
  type: "http",
  target_url: "https://example.com/",
  interval_seconds: 300,
  custom_interval: "",
  customMode: false,
  timeout_seconds: 10,
  expected_status: 200,
  keyword: "",
  keyword_mode: "contains",
  json_path: "",
  json_expected_value: "",
  ssl_check_enabled: false,
  ssl_warning_days: 30,
};

describe("formatRelative", () => {
  it("renders future timestamps as a countdown, not '0s ago'", () => {
    const future = new Date(Date.now() + 5 * 60_000).toISOString();
    expect(formatRelative(future, "en")).toMatch(/in 5m|in 4m/);
    expect(formatRelative(future, "zh")).toMatch(/分钟后/);
  });

  it("floors elapsed time instead of rounding up a unit early", () => {
    expect(formatRelative(new Date(Date.now() - 90_000).toISOString())).toBe("1m ago");
    expect(formatRelative(new Date(Date.now() - 90 * 60_000).toISOString())).toBe("1h ago");
  });

  it("handles missing and invalid values", () => {
    expect(formatRelative(null)).toBe("never");
    expect(formatRelative("not-a-date")).toBe("never");
  });
});

describe("other formatters", () => {
  it("floors fractional durations and guards zero intervals", () => {
    expect(formatDuration(59.8)).toBe("59s");
    expect(formatDuration(null)).toBe("—");
    expect(formatInterval(0)).toBe("—");
    expect(formatInterval(90)).toBe("90s");
  });
});

describe("isPrivateTarget", () => {
  it("rejects loopback, RFC1918, CGNAT and metadata addresses", () => {
    for (const url of [
      "http://127.0.0.1:8080/",
      "http://localhost/",
      "http://10.1.2.3/",
      "http://172.20.1.1/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://100.100.1.1/",
      "http://[::1]/",
      "http://[::ffff:10.0.0.1]/",
    ]) {
      expect(isPrivateTarget(url), url).toBe(true);
    }
  });

  it("does not false-positive on public domains that merely start with digits", () => {
    for (const url of [
      "https://10.example.com/health",
      "https://localhost.evil.com/",
      "https://example.com/",
      "https://93.184.216.34/",
    ]) {
      expect(isPrivateTarget(url), url).toBe(false);
    }
  });
});

describe("validateMonitorForm", () => {
  it("does not block submit on an invisible SSL threshold", () => {
    const state = { ...baseForm, ssl_warning_days: 0 };
    expect(validateMonitorForm(state).ssl_warning_days).toBeUndefined();
  });

  it("still validates the SSL threshold while its input is visible", () => {
    const state = { ...baseForm, ssl_check_enabled: true, ssl_warning_days: 0 };
    expect(validateMonitorForm(state).ssl_warning_days).toBeDefined();
  });

  it("rejects non-integer numeric values", () => {
    expect(validateMonitorForm({ ...baseForm, timeout_seconds: 2.5 }).timeout_seconds).toBeDefined();
    expect(validateMonitorForm({ ...baseForm, expected_status: 200.5 }).expected_status).toBeDefined();
    expect(
      validateMonitorForm({ ...baseForm, customMode: true, custom_interval: "90.5" })
        .interval_seconds,
    ).toBeDefined();
  });

  it("accepts a valid form", () => {
    expect(validateMonitorForm(baseForm)).toEqual({});
  });
});

describe("IncidentsPage filter", () => {
  beforeEach(() => {
    resetApiMocks();
  });

  it("requests only ongoing incidents when resolved rows are hidden", async () => {
    const paths: string[] = [];
    mockGet({
      "/api/incidents": (path: string) => {
        paths.push(path);
        return { items: [], total: 0, limit: 100, offset: 0 };
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<IncidentsPage />, "/incidents");

    await screen.findByText(/no incidents/i);
    expect(paths[0]).toContain("/api/incidents?limit=100");

    await user.click(screen.getByRole("checkbox"));
    await waitFor(() => {
      expect(paths.some((p) => p.includes("active=true"))).toBe(true);
    });
    expect(paths.some((p) => p.includes("active=false"))).toBe(false);
  });
});
