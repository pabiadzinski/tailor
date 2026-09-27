import { expect, test } from "@playwright/test";

test("groups containers by project and selects one", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#list .group", { hasText: "e2e" })).toBeVisible();

  await page.locator("#list .item", { hasText: "json-1" }).click();

  await expect(page).toHaveURL(/#e2e-json-1$/);
  await expect(page.locator("#list .item.active")).toContainText("json-1");
  await expect(page.locator("#c-name")).toHaveText("e2e-json-1");
  await expect(page.locator("#c-state")).toHaveText("live");
  await expect(page.locator("#counter")).toHaveText("31 lines");
});
