import { expect, test } from "@playwright/test";

const TRACE = "4bf92f3577b34da6";

test("opens a trace across containers by clicking its id", async ({ page }) => {
  await page.goto("/#e2e-orders-1");
  await page.locator("#rows .row .trace", { hasText: TRACE }).click();

  await expect(page).toHaveURL(new RegExp(`#trace=${TRACE}$`));
  await expect(page.locator("#banner")).toContainText(`Trace ${TRACE}: 2 lines in 2 containers`);
  await expect(page.locator("#rows .row .src")).toHaveText(["orders-1", "payments-1"]);
  await expect(page.locator("#c-state")).toHaveText("trace");

  await page.locator("#back-live").click();
  await expect(page).toHaveURL(/#e2e-orders-1$/);
  await expect(page.locator("#c-state")).toHaveText("live");
});

test("opens a trace from the trace field", async ({ page }) => {
  await page.goto("/");
  await page.locator("#trace").fill(TRACE);
  await page.locator("#trace").press("Enter");

  await expect(page.locator("#counter")).toHaveText("2 lines");
  await expect(page.locator("#rows .row .msg", { hasText: "payment captured" }).locator(".trace")).toHaveText(TRACE);

  await page.locator("#back-live").click();
  await expect(page.locator("#placeholder")).toBeVisible();
});
