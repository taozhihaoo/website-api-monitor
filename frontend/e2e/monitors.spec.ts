import { expect, test } from "@playwright/test";
import {
  checkNowAndWaitForHistory,
  createMonitorViaUi,
  registerViaUi,
  uniqueName,
} from "./helpers";

test.describe("monitors", () => {
  test("create form validates required fields", async ({ page }) => {
    await registerViaUi(page, `e2e-${Date.now()}@example.com`);
    await page.goto("/monitors");
    await page.getByRole("button", { name: "+ New monitor" }).click();
    await page.getByRole("button", { name: "Create monitor" }).click();

    await expect(page.getByText("Name is required.")).toBeVisible();
    await expect(page.getByText("URL is required.")).toBeVisible();
    // dialog stays open, nothing was created
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("creates a monitor and shows it in the list", async ({ page }) => {
    await registerViaUi(page, `e2e-${Date.now()}@example.com`);
    const name = uniqueName("E2E Example");
    await createMonitorViaUi(page, { name, url: "https://example.com/" });

    await expect(page).toHaveURL("/monitors");
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row.getByText("https://example.com/")).toBeVisible();
  });

  test("rejects private loopback URLs in the form", async ({ page }) => {
    await registerViaUi(page, `e2e-${Date.now()}@example.com`);
    await page.goto("/monitors");
    await page.getByRole("button", { name: "+ New monitor" }).click();
    await page.getByLabel("Name").fill("Local evil");
    await page.getByLabel("URL", { exact: true }).fill("http://127.0.0.1:8080/");
    await page.getByRole("button", { name: "Create monitor" }).click();

    await expect(
      page.getByText("Private/loopback addresses are not allowed."),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("runs a manual check and shows it in history", async ({ page }) => {
    await registerViaUi(page, `e2e-${Date.now()}@example.com`);
    const name = uniqueName("E2E Check");
    await createMonitorViaUi(page, { name, url: "https://example.com/" });
    await checkNowAndWaitForHistory(page, name);

    // detail page stats updated from the check result
    await expect(page.getByText("Last check").or(page.getByText(/ago|never/)).first()).toBeVisible();
  });

  test("shows an error banner for a nonexistent monitor (no white screen)", async ({ page }) => {
    await registerViaUi(page, `e2e-${Date.now()}@example.com`);
    await page.goto("/monitors/999999");

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });
});
