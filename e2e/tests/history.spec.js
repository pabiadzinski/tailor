import { expect, test } from "@playwright/test";

test("searches the whole history beyond the loaded lines", async ({ page }) => {
  await page.goto("/#e2e-bulk-1");
  const counter = page.locator("#counter");
  const banner = page.locator("#banner");
  await expect(counter).toHaveText("500 lines");

  const filter = page.locator("#filter");
  await filter.fill("needle");
  await filter.press("Enter");
  await expect(page.locator("#hits")).toHaveText("1/1");

  await filter.press("Alt+Enter");
  await expect(banner).toContainText("5 matches in all history");
  await expect(counter).toHaveText("5 lines");
  await expect(page.locator("#c-state")).toHaveText("history");
  await expect(page.locator("#rows .row mark")).toHaveCount(5);

  await page.locator("#back-live").click();
  await expect(banner).toBeHidden();
  await expect(counter).toHaveText("500 lines");
  await expect(page.locator("#c-state")).toHaveText("live");
});

test("searches the history of a whole project", async ({ page }) => {
  await page.goto("/#@e2e");
  await page.locator("#filter").fill("/^\\[E\\]|job failed/");
  await page.locator("#t-history").click();
  await expect(page.locator("#banner")).toContainText("2 matches");
  const sources = await page.locator("#rows .row .src").allTextContents();
  expect(sources.sort()).toEqual(["json-1", "text-1"]);
});
