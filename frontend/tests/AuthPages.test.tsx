import { describe, expect, it, vi, beforeEach } from "vitest";
vi.mock("../src/api/client", async () => await import("./mocks/api-client"));
import userEvent from "@testing-library/user-event";
import { screen } from "@testing-library/react";

import { api, ApiError, resetApiMocks, renderWithProviders } from "./test-utils";
import { LoginPage, RegisterPage } from "../src/pages/AuthPages";

beforeEach(() => {
  resetApiMocks();
});

describe("LoginPage", () => {
  it("renders the login form", () => {
    renderWithProviders(<LoginPage />, "/login");
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /log in/i })).toBeInTheDocument();
  });

  it("shows validation errors for invalid input", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />, "/login");
    await user.click(screen.getByRole("button", { name: /log in/i }));
    expect(await screen.findByText(/enter a valid email address/i)).toBeInTheDocument();
    expect(screen.getByText(/password must be at least 8 characters/i)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("shows the server error on wrong credentials", async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockRejectedValue(
      new ApiError(401, "invalid_credentials", "Invalid email or password"),
    );
    renderWithProviders(<LoginPage />, "/login");
    await user.type(screen.getByLabelText(/email/i), "user@example.com");
    await user.type(screen.getByLabelText(/password/i), "wrong-password");
    await user.click(screen.getByRole("button", { name: /log in/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid email or password/i);
  });

  it("submits credentials on success", async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue({ access_token: "tok" });
    vi.mocked(api.get).mockResolvedValue({
      id: 1,
      email: "user@example.com",
      webhook_url: null,
      created_at: "2026-01-01T00:00:00Z",
    });
    renderWithProviders(<LoginPage />, "/login");
    await user.type(screen.getByLabelText(/email/i), "user@example.com");
    await user.type(screen.getByLabelText(/password/i), "password-123");
    await user.click(screen.getByRole("button", { name: /log in/i }));
    await vi.waitFor(() => {
      expect(api.post).toHaveBeenCalledWith("/api/auth/login", {
        email: "user@example.com",
        password: "password-123",
      });
    });
  });
});

describe("RegisterPage", () => {
  it("validates the password length client-side", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RegisterPage />, "/register");
    await user.type(screen.getByLabelText(/email/i), "new@example.com");
    await user.type(screen.getByLabelText(/password/i), "short");
    await user.click(screen.getByRole("button", { name: /create account/i }));
    expect(
      await screen.findByText(/password must be at least 8 characters/i),
    ).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("shows a friendly error when the email is taken", async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockRejectedValue(
      new ApiError(409, "email_taken", "An account with this email already exists"),
    );
    renderWithProviders(<RegisterPage />, "/register");
    await user.type(screen.getByLabelText(/email/i), "taken@example.com");
    await user.type(screen.getByLabelText(/password/i), "password-123");
    await user.click(screen.getByRole("button", { name: /create account/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/already exists/i);
  });

  it("links to the login page", () => {
    renderWithProviders(<RegisterPage />, "/register");
    expect(screen.getByRole("link", { name: /log in/i })).toHaveAttribute("href", "/login");
  });
});
