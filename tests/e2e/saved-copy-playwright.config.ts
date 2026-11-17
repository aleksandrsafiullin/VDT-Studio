import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const owned = process.env.VDT_E2E_SAVED_COPY_ROOT;
if (!owned) throw new Error("Start this suite with the saved-copy E2E runner.");

const browser = process.env.VDT_E2E_SAVED_COPY_BROWSER ?? "chromium";
if (browser !== "chromium" && browser !== "chrome") throw new Error("Use chromium or chrome for the saved-copy browser.");

export default defineConfig({
  testDir: ".",
  testMatch: "saved-copy-recovery.spec.ts",
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: path.join(__dirname, "../../output/playwright/saved-copy", path.basename(owned)),
  reporter: [["list"]],
  use: { ...devices["Desktop Chrome"], channel: browser, baseURL: "http://127.0.0.1:3100",
    acceptDownloads: true, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: "node scripts/start-e2e-web.mjs",
    cwd: path.join(__dirname, "../.."),
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 },
    timeout: 120_000
  }
});
