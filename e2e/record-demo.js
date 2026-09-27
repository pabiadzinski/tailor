// Records demo/demo.gif against the demo stack: `make record` (needs ffmpeg and gifsicle).
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const PORT = 18098;
const size = { width: 1280, height: 760 };

const server = spawn("cargo", ["run", "-q"], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), TAILR_CONFIG: "demo/tailr.toml" },
  stdio: "inherit",
});
try {
  await waitForServer(`http://127.0.0.1:${PORT}/`);
  const video = await record();
  const gif = join(root, "demo/demo.gif");
  const filters =
    "fps=8,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];" +
    "[b][p]paletteuse=dither=none:diff_mode=rectangle";
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", "0.8", "-i", video, "-vf", filters, gif], { stdio: "inherit" });
  execFileSync("gifsicle", ["-O3", "--lossy=20", "--colors", "96", "-b", gif], { stdio: "inherit" });
  console.log(`wrote ${gif}`);
} finally {
  server.kill();
}

async function record() {
  const dir = mkdtempSync(join(tmpdir(), "tailr-demo-"));
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: size, colorScheme: "dark", recordVideo: { dir, size } });
  await context.addInitScript(showCursor);
  // Show only the demo project, not whatever else runs on this machine.
  await context.route("**/api/containers", async (route) => {
    const response = await route.fetch();
    const containers = (await response.json()).filter((c) => c.project === "demo");
    await route.fulfill({ response, json: containers });
  });
  const page = await context.newPage();
  const pause = (ms) => page.waitForTimeout(ms);

  const moveTo = async (locator) => {
    const box = await locator.boundingBox();
    await page.mouse.move(box.x + Math.min(box.width / 2, 60), box.y + box.height / 2, { steps: 25 });
    await pause(250);
  };
  const click = async (locator) => {
    await moveTo(locator);
    await page.mouse.down();
    await page.mouse.up();
  };
  // A row in the middle of the screen; scrolling up first stops follow so it stays put.
  const rowInView = async (selector) => {
    await page.mouse.move(700, 400, { steps: 15 });
    await page.mouse.wheel(0, -300);
    await pause(600);
    const rows = await page.locator(selector).all();
    for (const row of rows) {
      const box = await row.boundingBox();
      if (box && box.y > 250 && box.y < 600) return row;
    }
    return rows.at(-1);
  };

  await page.goto(`http://127.0.0.1:${PORT}/`);
  await pause(1200);

  await click(page.locator("#list .item", { hasText: "worker-1" }));
  await pause(2000);

  const json = await rowInView("#rows .row.json");
  await click(json.locator(".msg"));
  await pause(1800);
  await click(json.locator(".msg"));
  await pause(600);

  const filter = page.locator("#filter");
  await click(filter);
  await filter.pressSequentially("failed", { delay: 90 });
  await pause(500);
  await filter.press("Enter");
  await pause(900);
  await filter.press("Enter");
  await pause(900);
  await filter.press("Escape");
  await click(page.locator("#jump"));
  await pause(800);

  await click(page.locator("#list .group", { hasText: "demo" }));
  await pause(2400);

  const trace = await rowInView("#rows .row .trace");
  await click(trace);
  await pause(2600);
  await click(page.locator("#back-live"));
  await pause(1000);

  await click(filter);
  await filter.pressSequentially("deadlock", { delay: 90 });
  await pause(400);
  await filter.press("Alt+Enter");
  await pause(2400);
  await click(page.locator("#back-live"));
  await pause(1000);

  await context.close();
  await browser.close();
  return join(dir, readdirSync(dir)[0]);
}

async function waitForServer(url) {
  for (let i = 0; i < 600; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not start`);
}

function showCursor() {
  addEventListener("DOMContentLoaded", () => {
    const dot = document.createElement("div");
    dot.style.cssText =
      "position:fixed;z-index:99999;left:-40px;top:-40px;width:18px;height:18px;border-radius:50%;" +
      "background:rgba(255,255,255,.3);border:2px solid #fff;pointer-events:none;transform:translate(-50%,-50%)";
    document.body.appendChild(dot);
    addEventListener("mousemove", (e) => { dot.style.left = e.clientX + "px"; dot.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", () => { dot.style.transform = "translate(-50%,-50%) scale(.7)"; }, true);
    addEventListener("mouseup", () => { dot.style.transform = "translate(-50%,-50%)"; }, true);
  });
}
