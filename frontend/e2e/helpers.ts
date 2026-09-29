import { expect, type Page } from "@playwright/test";

export const DEFAULT_PASSWORD = "e2e-safe-password-1";

export function uniqueEmail(): string {
  // Uniqueness isolates users inside a shared run database; assertions
  // never depend on the random part, only on exact strings we track.
  return `e2e-${Date.now()}-${Math.floor(Math.random() * 10_000)}@example.com`;
}

export function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}`;
}

/** Register through the real UI and wait for the dashboard. */
export async function registerViaUi(page: Page, email: string): Promise<void> {
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(DEFAULT_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

export interface MonitorOptions {
  name: string;
  url: string;
  /** expected_status — use 599 to guarantee a DOWN (status mismatch). */
  expectedStatus?: string;
}

/** Create a monitor through the real form from the Monitors page. */
export async function createMonitorViaUi(
  page: Page,
  options: MonitorOptions,
): Promise<void> {
  await page.goto("/monitors");
  await page.getByRole("button", { name: "+ New monitor" }).click();
  await page.getByLabel("Name").fill(options.name);
  await page.getByLabel("URL", { exact: true }).fill(options.url);
  if (options.expectedStatus) {
    await page.getByLabel("Expected status").fill(options.expectedStatus);
  }
  await page.getByRole("button", { name: "Create monitor" }).click();
  // modal closes and the new monitor row appears in the table
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const row = page.getByRole("row").filter({ hasText: options.name });
  await expect(row).toHaveCount(1);
}

/**
 * Open the monitor detail page and run "Check now", then wait until a data
 * row exists in the history table (header row = 1, so > 1 means data arrived).
 * The check outcome depends on the live network, so any recorded status
 * (UP or DOWN) validates the pipeline. The poll budget covers the backend's
 * bounded retry window (2 retries with exponential backoff).
 */
export async function checkNowAndWaitForHistory(page: Page, monitorName: string): Promise<void> {
  await page.goto("/monitors");
  await page.getByRole("link", { name: monitorName }).click();
  await expect(page.getByRole("heading", { name: monitorName })).toBeVisible();

  await page.getByRole("button", { name: "Check now" }).click();
  await expect
    .poll(async () => page.locator("table").last().getByRole("row").count(), {
      timeout: 45_000,
    })
    .toBeGreaterThan(1);
}
