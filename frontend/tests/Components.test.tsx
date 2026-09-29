import { describe, expect, it, vi } from "vitest";
vi.mock("../src/api/client", async () => await import("./mocks/api-client"));
import { screen } from "@testing-library/react";

import { renderWithProviders } from "./test-utils";
import { UptimeStrip } from "../src/components/UptimeStrip";
import { StatusBadge } from "../src/components/StatusBadge";
import {
  formatDuration,
  formatInterval,
  formatMs,
  formatPercent,
} from "../src/utils/format";
import type { Check } from "../src/api/types";

function check(id: number, status: "up" | "down"): Check {
  return {
    id,
    monitor_id: 1,
    checked_at: "2026-09-30T00:00:00Z",
    status,
    http_status: 200,
    latency_ms: 100,
    error_type: null,
    error_message: null,
    keyword_result: null,
    json_result: null,
    ssl_days_remaining: null,
    ssl_status: "not_applicable",
  };
}

describe("UptimeStrip", () => {
  it("pads the strip to a fixed width and colors real checks", () => {
    const checks = [check(1, "up"), check(2, "down"), check(3, "up")];
    const { container } = renderWithProviders(<UptimeStrip checks={checks} />);
    const bars = container.querySelectorAll("[role='img'] > div");
    expect(bars.length).toBe(20); // strip is padded to a fixed width
    expect(container.querySelectorAll(".bg-emerald-500").length).toBe(2);
    expect(container.querySelectorAll(".bg-red-500").length).toBe(1);
  });

  it("renders nothing meaningful without data", () => {
    const { container } = renderWithProviders(<UptimeStrip checks={undefined} />);
    expect(container.querySelectorAll(".bg-emerald-500").length).toBe(0);
  });
});

describe("StatusBadge", () => {
  it("maps states to labels", () => {
    renderWithProviders(
      <div>
        <StatusBadge status="up" />
        <StatusBadge status="down" />
        <StatusBadge status={null} />
        <StatusBadge status="expiring_soon" />
      </div>,
    );
    expect(screen.getByText("UP")).toBeInTheDocument();
    expect(screen.getByText("DOWN")).toBeInTheDocument();
    expect(screen.getByText("PENDING")).toBeInTheDocument();
    expect(screen.getByText("SSL EXPIRING")).toBeInTheDocument();
  });
});

describe("format helpers", () => {
  it("formats milliseconds", () => {
    expect(formatMs(null)).toBe("—");
    expect(formatMs(250)).toBe("250 ms");
    expect(formatMs(1500)).toBe("1.50 s");
  });

  it("formats percentages", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(100)).toBe("100%");
    expect(formatPercent(98.5)).toBe("98.5%");
  });

  it("formats durations", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(130)).toBe("2m 10s");
    expect(formatDuration(7200)).toBe("2h");
  });

  it("formats intervals", () => {
    expect(formatInterval(60)).toBe("1m");
    expect(formatInterval(3600)).toBe("1h");
    expect(formatInterval(90)).toBe("90s");
  });
});
