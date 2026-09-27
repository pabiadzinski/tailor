import { expect, test } from "@playwright/test";

test("marks errors next to the scrollbar and jumps to them", async ({ page }) => {
  await page.goto("/#e2e-bulk-1");
  await page.selectOption("#tail", "10000");
  await expect(page.locator("#counter")).toHaveText("5000 lines");

  const tick = page.locator("#marks i.error");
  await expect(tick).toHaveCount(1);
  await tick.click();
  await expect(page.locator("#rows .row", { hasText: "line 2500 ERROR boom" })).toBeInViewport();
  await expect(page.locator("#jump")).toBeVisible();
});

test("shows recent error counts in the sidebar", async ({ page }) => {
  await page.goto("/");
  const badge = (name) => page.locator("#list .item", { hasText: name }).locator(".badge");
  await expect(badge("json-1")).toHaveText("1");
  await expect(badge("text-1")).toHaveText("2");
  await expect(badge("orders-1")).toHaveCount(0);

  await page.locator("#clear-errors").click();
  await expect(badge("json-1")).toHaveCount(0);
  await expect(badge("text-1")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#list .item", { hasText: "json-1" })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(badge("json-1")).toHaveCount(0);
  await expect(badge("text-1")).toHaveCount(0);
});

test("opens a container filtered to errors from its badge", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("errorsClearedAt"));
  await page.reload();
  const badge = (name) => page.locator("#list .item", { hasText: name }).locator(".badge");
  await badge("text-1").click();
  await expect(page).toHaveURL(/#e2e-text-1$/);
  await expect(page.locator('#levels [data-level="error"]')).toHaveClass(/on/);
  await expect(page.locator("#counter")).toHaveText("2 / 5 lines");
});

test("jumps between errors with the error chip and keys", async ({ page }) => {
  await page.goto("/#e2e-text-1");
  const chip = page.locator("#t-errors");
  const current = page.locator("#rows .row.cur .msg");
  await expect(chip).toHaveText("2");
  const [first, last] = await page.locator("#rows .row.err .msg").allTextContents();

  await chip.click();
  await expect(current).toHaveText(last);
  await page.keyboard.press("e");
  await expect(current).toHaveText(first);
  await page.keyboard.press("e");
  await expect(current).toHaveText(last);
  await chip.click({ modifiers: ["Shift"] });
  await expect(current).toHaveText(first);
});
