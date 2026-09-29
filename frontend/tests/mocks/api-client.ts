// Shared vi.mock factory for the API client.
// Each test file registers it with:
//   vi.mock("../src/api/client", async () => await import("./mocks/api-client"));

import { vi } from "vitest";

const state = { token: null as string | null };

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const api = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
};

export function getToken() {
  return state.token;
}

export function setToken(token: string) {
  state.token = token;
}

export function clearToken() {
  state.token = null;
}
