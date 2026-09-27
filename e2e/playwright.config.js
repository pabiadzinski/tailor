import { defineConfig } from "@playwright/test";

const PORT = 18099;

export default defineConfig({
  testDir: "tests",
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  globalSetup: "./global-setup.js",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "retain-on-failure",
  },
  webServer: {
    command: "cargo run",
    cwd: "..",
    env: { ...process.env, PORT: String(PORT), TAILR_CONFIG: "e2e/tailr.toml" },
    url: `http://127.0.0.1:${PORT}`,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
  },
});
