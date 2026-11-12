import { expect, test } from "@playwright/test";

import { registerViaUi } from "./helpers";

test.describe("language switch", () => {
  test("switches the whole UI to Chinese, persists, and switches back", async ({ page }) => {
    await registerViaUi(page, `e2e-${Date.now()}@example.com`);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    await page.getByRole("button", { name: "简体中文" }).click();
    await expect(page.getByRole("heading", { name: "仪表盘" })).toBeVisible();
    await expect(page.getByRole("link", { name: "监控项" })).toBeVisible();
    await expect(page.getByRole("link", { name: "故障记录" })).toBeVisible();
    await expect(page.getByRole("link", { name: "+ 新建监控" })).toBeVisible();

    // Preference survives a full reload.
    await page.reload();
    await expect(page.getByRole("heading", { name: "仪表盘" })).toBeVisible();

    await page.getByRole("button", { name: "English" }).click();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Monitors" })).toBeVisible();
  });
});
