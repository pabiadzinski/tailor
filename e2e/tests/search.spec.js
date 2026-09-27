import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/#e2e-bulk-1");
  await page.selectOption("#tail", "10000");
  await expect(page.locator("#counter")).toHaveText("5000 lines");
});

test("keeps the DOM small and jumps back to latest", async ({ page }) => {
  expect(await page.locator("#rows .row").count()).toBeLessThan(300);

  await page.locator("#logs").evaluate((el) => (el.scrollTop = 0));
  await expect(page.locator("#rows .row .msg", { hasText: /^line 1$/ })).toBeVisible();
  await expect(page.locator("#jump")).toBeVisible();

  await page.locator("#jump").click();
  await expect(page.locator("#rows .row", { hasText: "line 5000 needle" })).toBeVisible();
  await expect(page.locator("#jump")).toBeHidden();
});

test("search highlights and navigates without filtering", async ({ page }) => {
  const filter = page.locator("#filter");
  const hits = page.locator("#hits");
  const current = page.locator("#rows .row.cur");

  await filter.fill("needle");
  await filter.press("Enter");
  await expect(hits).toHaveText("5/5");
  await expect(current).toContainText("line 5000 needle");
  await expect(page.locator("#counter")).toHaveText("5000 lines");

  await filter.press("Enter");
  await expect(hits).toHaveText("1/5");
  await expect(current).toContainText("line 1000 needle");
  await expect(current.locator("mark")).toHaveText("needle");

  await filter.press("Shift+Enter");
  await expect(hits).toHaveText("5/5");

  await page.locator("#t-filter").click();
  await expect(page.locator("#counter")).toHaveText("5 / 5000 lines");
  await page.locator("#t-filter").click();
  await expect(page.locator("#counter")).toHaveText("5000 lines");

  await filter.press("Escape");
  await expect(hits).toHaveText("");
  await expect(page.locator("#rows mark")).toHaveCount(0);
});
