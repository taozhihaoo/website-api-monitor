import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/api/client", async () => await import("./mocks/api-client"));
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { api, ApiError, mockGet, mockLoggedIn, resetApiMocks, renderWithProviders } from "./test-utils";
import { MonitorsPage } from "../src/pages/MonitorsPage";

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
  last_checked_at: "2026-09-30T00:00:00Z",
  next_check_at: "2026-09-30T00:05:00Z",
  ssl_status: "not_applicable",
  ssl_expires_at: null,
  ssl_days_remaining: null,
  ssl_last_checked_at: null,
  last_latency_ms: 210,
  uptime_24h: 99.9,
  created_at: "2026-09-30T00:00:00Z",
  updated_at: "2026-09-30T00:00:00Z",
};

beforeEach(() => {
  resetApiMocks();
});

describe("MonitorsPage", () => {
  it("renders the monitor table", async () => {
    mockLoggedIn();
    mockGet({ "/api/monitors": [MONITOR] });
    renderWithProviders(<MonitorsPage />, "/monitors");
    expect(await screen.findByText("Marketing site")).toBeInTheDocument();
    expect(screen.getByText("https://example.com")).toBeInTheDocument();
    expect(screen.getByText("210 ms")).toBeInTheDocument();
  });

  it("shows the empty state", async () => {
    mockLoggedIn();
    mockGet({ "/api/monitors": [] });
    renderWithProviders(<MonitorsPage />, "/monitors");
    expect(await screen.findByText(/no monitors yet/i)).toBeInTheDocument();
  });

  it("shows an error banner when loading fails", async () => {
    mockLoggedIn();
    vi.mocked(api.get).mockRejectedValue(new ApiError(500, "internal_error", "boom"));
    renderWithProviders(<MonitorsPage />, "/monitors");
    expect(await screen.findByRole("alert")).toHaveTextContent(/boom/i);
  });

  it("validates required fields in the create form", async () => {
    const user = userEvent.setup();
    mockLoggedIn();
    mockGet({ "/api/monitors": [] });
    renderWithProviders(<MonitorsPage />, "/monitors");
    await user.click(await screen.findByRole("button", { name: /new monitor/i }));
    await user.click(screen.getByRole("button", { name: /create monitor/i }));
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
    expect(screen.getByText(/url is required/i)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("requires a keyword when the type is keyword", async () => {
    const user = userEvent.setup();
    mockLoggedIn();
    mockGet({ "/api/monitors": [] });
    renderWithProviders(<MonitorsPage />, "/monitors");
    await user.click(await screen.findByRole("button", { name: /new monitor/i }));

    await user.type(screen.getByLabelText(/name/i), "Blog keyword");
    await user.type(screen.getByLabelText(/url/i), "https://blog.example.com");
    await user.selectOptions(screen.getByLabelText(/type/i), "keyword");
    await user.click(screen.getByRole("button", { name: /create monitor/i }));

    expect(
      await screen.findByText(/keyword is required for keyword monitors/i),
    ).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("rejects private URLs client-side", async () => {
    const user = userEvent.setup();
    mockLoggedIn();
    mockGet({ "/api/monitors": [] });
    renderWithProviders(<MonitorsPage />, "/monitors");
    await user.click(await screen.findByRole("button", { name: /new monitor/i }));

    await user.type(screen.getByLabelText(/name/i), "Local");
    await user.type(screen.getByLabelText(/url/i), "http://127.0.0.1:8080/");
    await user.click(screen.getByRole("button", { name: /create monitor/i }));

    expect(
      await screen.findByText(/private\/loopback addresses are not allowed/i),
    ).toBeInTheDocument();
  });

  it("submits a valid create payload", async () => {
    const user = userEvent.setup();
    mockLoggedIn();
    mockGet({ "/api/monitors": [] });
    vi.mocked(api.post).mockResolvedValue(MONITOR);
    renderWithProviders(<MonitorsPage />, "/monitors");
    await user.click(await screen.findByRole("button", { name: /new monitor/i }));

    await user.type(screen.getByLabelText(/name/i), "Marketing site");
    await user.type(screen.getByLabelText(/url/i), "https://example.com");
    await user.click(screen.getByRole("button", { name: /create monitor/i }));

    await vi.waitFor(() => {
      expect(api.post).toHaveBeenCalledWith("/api/monitors", expect.objectContaining({
        name: "Marketing site",
        target_url: "https://example.com",
        type: "http",
      }));
    });
  });

  it("pauses and resumes a monitor", async () => {
    const user = userEvent.setup();
    mockLoggedIn();
    mockGet({ "/api/monitors": [MONITOR] });
    vi.mocked(api.post).mockResolvedValue({ ...MONITOR, enabled: false });
    renderWithProviders(<MonitorsPage />, "/monitors");

    await user.click(await screen.findByRole("button", { name: /^pause$/i }));
    await vi.waitFor(() => {
      expect(api.post).toHaveBeenCalledWith("/api/monitors/1/disable");
    });
  });
});
