import { vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";

import { AuthProvider } from "../src/auth/AuthContext";
import { api, ApiError, clearToken } from "./mocks/api-client";

export { api, ApiError, clearToken };

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

export function renderWithProviders(ui: ReactElement, route = "/") {
  const queryClient = makeQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

/** Reset only the api method mocks (keep token helpers intact). */
export function resetApiMocks() {
  clearToken();
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.put).mockReset();
  vi.mocked(api.delete).mockReset();
}

/** Route api.get() calls to canned responses keyed by path prefix. */
export function mockGet(routes: Record<string, unknown>) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    const key = Object.keys(routes).find((prefix) => path.startsWith(prefix));
    if (key !== undefined) {
      const value = routes[key];
      if (value instanceof Error) {
        throw value;
      }
      return typeof value === "function" ? value(path) : structuredClone(value);
    }
    throw new ApiError(404, "not_found", `No mock for ${path}`);
  });
}

/** Simulate a logged-in user whose /api/auth/me resolves to a user. */
export function mockLoggedIn(
  user: { id: number; email: string } = { id: 1, email: "test@example.com" },
) {
  mockGet({
    "/api/auth/me": user,
  });
}
