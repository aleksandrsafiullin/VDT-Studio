import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import base from "../../playwright.config";

// Use the already installed browser; do not download/replace shared browser caches.
const repository = path.resolve(__dirname, "../..");
const run = process.env.VDT_SMART_E2E_RUN ?? new Date().toISOString().replace(/[:.]/g, "-");
process.env.VDT_SMART_E2E_RUN = run;
export default defineConfig({
  ...base,
  testDir: __dirname,
  testMatch: "smart-kpi-suggestions.spec.ts",
  workers: 1,
  use: { ...base.use, actionTimeout: 10_000, navigationTimeout: 120_000 },
  outputDir: path.join(repository, `output/smart-kpi-suggestions/${run}/test-results`),
  reporter: [["list"], ["json", { outputFile: path.join(repository, `output/smart-kpi-suggestions/${run}/results.json`) }]],
  webServer: { ...base.webServer, command: "node tests/e2e/start-smart-kpi-web.mjs", cwd: repository, url: "http://127.0.0.1:3100", reuseExistingServer: false },
  projects: [{ name: "installed-chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } }]
});
