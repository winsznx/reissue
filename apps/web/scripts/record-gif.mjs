// Records the README animation from a real run: a curated scenario is started through the API,
// the open case page is filmed while the scripted revision lands, and ffmpeg turns it into a GIF.
//   node scripts/record-gif.mjs  (Workbench on :3210, API on :4210, WORKBENCH_ACCESS_CODE set)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { chromium } from "@playwright/test";

const WEB = process.env.WEB_URL ?? "http://localhost:3210";
const CODE = process.env.WORKBENCH_ACCESS_CODE;
const OUT = resolve(process.argv[2] ?? "../../docs/media/reissue-loop.gif");
if (!CODE) throw new Error("WORKBENCH_ACCESS_CODE is required");

const videoDir = mkdtempSync(join(tmpdir(), "reissue-gif-"));
const browser = await chromium.launch();
const signIn = await browser.newContext();
const signInPage = await signIn.newPage();
await signInPage.goto(`${WEB}/sign-in`, { waitUntil: "networkidle" });
await signInPage.evaluate(async (code) => {
  await fetch("/api/v1/auth/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessCode: code, name: "Dana" }) });
}, CODE);
const storageState = await signIn.storageState();
await signIn.close();
const context = await browser.newContext({ storageState, viewport: { width: 1280, height: 800 }, recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } }, colorScheme: "light" });
const page = await context.newPage();
const api = (path, body) =>
  page.evaluate(
    async ([p, b]) => {
      const r = await fetch(`/api${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b ?? {}) });
      return r.json();
    },
    [path, body],
  );

await page.goto(`${WEB}/shipments`, { waitUntil: "networkidle" });
const run = await api("/v1/demo/scenarios/quantity-correction/start");
await page.goto(`${WEB}/shipments/${run.caseCode}`);
await page.locator("[data-testid=case-state]:visible", { hasText: /Waiting on supplier/i }).first().waitFor({ timeout: 60_000 });
await page.waitForTimeout(1500);
await page.getByText(/Quantity mismatch/i).first().click();
await page.waitForTimeout(2500);
await api(`/v1/demo/runs/${run.runId}/next`);
await page.locator("[data-testid=case-state]:visible", { hasText: /Ready for broker review/i }).first().waitFor({ timeout: 60_000 });
await page.waitForTimeout(3000);
await context.close();
await browser.close();

const video = join(videoDir, readdirSync(videoDir).find((f) => f.endsWith(".webm")));
const palette = join(videoDir, "palette.png");
const filters = "fps=8,scale=960:-1:flags=lanczos";
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-vf", `${filters},palettegen=stats_mode=diff`, palette]);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-i", palette, "-lavfi", `${filters} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=4`, OUT]);
console.log(`wrote ${OUT} for ${run.caseCode}`);
