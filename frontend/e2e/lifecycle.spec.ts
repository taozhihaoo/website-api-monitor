import { expect, test } from "@playwright/test";
import {
  checkNowAndWaitForHistory,
  createMonitorViaUi,
  registerViaUi,
  uniqueName,
} from "./helpers";

test.describe("monitor lifecycle", () => {
  test("down check opens an incident; disable pauses; delete removes", async ({ page }) => {
    await registerViaUi(page, `e2e-${Date.now()}@example.com`);

    // expected_status 599 against a 200 endpoint ⇒ guaranteed DOWN
    // (status mismatch if the network works, a transport error otherwise).
    const name = uniqueName("E2E Down");
    await createMonitorViaUi(page, {
      name,
      url: "https://example.com/",
      expectedStatus: "599",
    });

    // run the check and land on the detail page
    await checkNowAndWaitForHistory(page, name);
    await expect(page.getByText("DOWN", { exact: true }).first()).toBeVisible();

    // incident page lists the open incident for this monitor
    await page.getByRole("link", { name: "Incidents" }).click();
    const incidentRow = page.getByRole("row").filter({ hasText: name });
    await expect(incidentRow).toBeVisible();
    await expect(incidentRow.getByText("ongoing")).toBeVisible();

    // disable the monitor: status becomes PAUSED on the monitors page
    await page.goto("/monitors");
    await page
      .getByRole("row")
      .filter({ hasText: name })
      .getByRole("button", { name: "Pause" })
      .click();
    await expect(
      page.getByRole("row").filter({ hasText: name }).getByText("PAUSED"),
    ).toBeVisible();

    // delete with the two-click confirmation
    const row = page.getByRole("row").filter({ hasText: name });
    await row.getByRole("button", { name: "Delete" }).click();
    await row.getByRole("button", { name: "Confirm delete?" }).click();
    await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(0);
  });

  test("recovery closes the incident and records its duration", async ({ page }) => {
    await registerViaUi(page, `e2e-${Date.now()}@example.com`);

    const name = uniqueName("E2E Recover");
    await createMonitorViaUi(page, {
      name,
      url: "https://example.com/",
      expectedStatus: "599",
    });
    await checkNowAndWaitForHistory(page, name);
    await expect(page.getByText("DOWN").first()).toBeVisible();

    // fix the configuration from the monitors list: expected status back to 200
    await page.goto("/monitors");
    await page
      .getByRole("row")
      .filter({ hasText: name })
      .getByRole("button", { name: "Edit" })
      .click();
    await page.getByLabel("Expected status").fill("200");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // check again from the detail page: monitor recovers (a second data row
    // appears; the header status badge flips to UP)
    await page.getByRole("link", { name }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await page.getByRole("button", { name: "Check now" }).click();
    await expect
      .poll(async () => page.locator("table").last().getByRole("row").count(), {
        timeout: 45_000,
      })
      .toBeGreaterThan(2);
    await expect(page.getByText("UP", { exact: true }).first()).toBeVisible();

    await page.getByRole("link", { name: "Incidents" }).click();
    const incidentRow = page.getByRole("row").filter({ hasText: name });
    await expect(incidentRow).toBeVisible();
    // resolved: no longer "ongoing", duration recorded
    await expect(incidentRow.getByText("ongoing")).toHaveCount(0);
    await expect(incidentRow.getByText(/\d+s|\d+m/)).toBeVisible();
  });
});
