import { expect, test } from "@playwright/test";

test("shows the shortcuts help", async ({ page }) => {
  await page.goto("/#e2e-text-1");
  const help = page.locator("#help");
  await page.keyboard.press("?");
  await expect(help).toBeVisible();
  await expect(help).toContainText("Previous / next error");
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();
  await page.locator("#t-help").click();
  await expect(help).toBeVisible();
});

test("switches levels and view options from the keyboard", async ({ page }) => {
  await page.goto("/#e2e-text-1");
  const counter = page.locator("#counter");
  await expect(counter).toHaveText("5 lines");

  await page.keyboard.press("1");
  await expect(counter).toHaveText("2 / 5 lines");
  await page.keyboard.press("2");
  await expect(counter).toHaveText("1 / 5 lines");
  await page.keyboard.press("0");
  await expect(counter).toHaveText("5 lines");

  const wrapped = await page.evaluate(() => document.body.classList.contains("wrap"));
  await page.keyboard.press("w");
  expect(await page.evaluate(() => document.body.classList.contains("wrap"))).toBe(!wrapped);
  await page.keyboard.press("w");
});

test("navigates the list and leaves history with Escape", async ({ page }) => {
  await page.goto("/#e2e-bulk-1");
  await expect(page.locator("#counter")).toHaveText("500 lines");
  await page.keyboard.press("g");
  await expect(page.locator("#jump")).toBeVisible();
  await page.keyboard.press("G");
  await expect(page.locator("#jump")).toBeHidden();

  await page.locator("#filter").fill("needle");
  await page.locator("#filter").press("Alt+Enter");
  await expect(page.locator("#banner")).toBeVisible();
  await page.locator("#filter").blur();
  await page.keyboard.press("n");
  await expect(page.locator("#rows .row.cur")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#banner")).toBeHidden();
  await expect(page.locator("#c-state")).toHaveText("live");
});
