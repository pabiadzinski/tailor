import { expect, test } from "@playwright/test";

test("shows a whole compose project merged by time", async ({ page }) => {
  await page.goto("/");
  await page.locator("#list .group", { hasText: "e2e" }).click();

  await expect(page).toHaveURL(/#@e2e$/);
  await expect(page.locator("#c-name")).toHaveText("e2e");
  await expect(page.locator("#counter")).toHaveText("543 lines");
  await expect(page.locator("#list .group.active")).toHaveText("e2e");

  await page.locator("#filter").fill("custom failure");
  await page.locator("#filter").press("Enter");
  await expect(page.locator("#rows .row.cur .src")).toHaveText("text-1");
  const color = (el) => el.evaluate((e) => [...e.classList].find((c) => /^c\d$/.test(c)));
  const sidebarName = page.locator("#list .item", { hasText: "text-1" }).locator(".name");
  expect(await color(page.locator("#rows .row.cur .src"))).toBe(await color(sidebarName));
  await page.locator("#filter").press("Escape");

  await page.locator("#jump").click();
  const times = await page.locator("#rows .row .ts").evaluateAll((els) => els.map((e) => e.title));
  expect(times.length).toBeGreaterThan(10);
  expect(times).toEqual([...times].sort());
});

test("combines chosen containers with a modifier click", async ({ page }) => {
  await page.goto("/#e2e-json-1");
  await expect(page.locator("#counter")).toHaveText("31 lines");

  await page.locator("#list .item", { hasText: "text-1" }).click({ modifiers: ["ControlOrMeta"] });
  await expect(page).toHaveURL(/#e2e-json-1,e2e-text-1$/);
  await expect(page.locator("#c-name")).toHaveText("2 containers");
  await expect(page.locator("#counter")).toHaveText("36 lines");
  await expect(page.locator("#list .item.active")).toHaveCount(2);

  await page.locator("#list .item", { hasText: "json-1" }).click({ modifiers: ["ControlOrMeta"] });
  await expect(page).toHaveURL(/#e2e-text-1$/);
  await expect(page.locator("#counter")).toHaveText("5 lines");
});
