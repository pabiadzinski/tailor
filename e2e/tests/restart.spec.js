import { expect, test } from "@playwright/test";
import { compose, docker } from "./docker.js";

const separator = (page, text) => page.locator("#rows .row.sep", { hasText: text });

test.beforeEach(() => {
  compose("up -d --force-recreate --wait restarter");
});

test("keeps history when a container restarts or is recreated", async ({ page }) => {
  await page.goto("/#e2e-restarter-1");
  const counter = page.locator("#counter");
  await expect(counter).toHaveText("3 lines");

  docker("restart -t 0 e2e-restarter-1");
  await expect(separator(page, "container restarted")).toBeVisible();
  await expect(counter).toHaveText("7 lines");

  compose("up -d --force-recreate --wait restarter");
  await expect(separator(page, "container recreated")).toBeVisible();
  await expect(counter).toHaveText("11 lines");
  await expect(page.locator("#c-state")).toHaveText("live");
});

test("marks which container restarted in a merged view", async ({ page }) => {
  await page.goto("/#e2e-restarter-1,e2e-text-1");
  const counter = page.locator("#counter");
  await expect(counter).toHaveText("8 lines");

  docker("restart -t 0 e2e-restarter-1");
  await expect(separator(page, "restarter-1 restarted")).toBeVisible();
  await expect(counter).toHaveText("12 lines");
});
