import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import base from "../../playwright.config";

const repository = path.resolve(__dirname, "../..");
const run = process.env.VDT_F05_E2E_RUN ?? new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(repository, "output/playwright", `f05-${run}`);

export default defineConfig({
  ...base,
  testDir: __dirname,
  testMatch: ["model-validation.spec.ts", "back-calculation.spec.ts", "versions.spec.ts"],
  workers: 1,
  timeout: 120_000,
  expect: { ...base.expect, timeout: 30_000 },
  use: { ...base.use, actionTimeout: 30_000, navigationTimeout: 120_000 },
  outputDir: path.join(output, "test-results"),
  reporter: [["list"], ["json", { outputFile: path.join(output, "e2e-results.json") }]],
  webServer: { ...base.webServer, command: "node tests/e2e/start-smart-kpi-web.mjs", cwd: repository, reuseExistingServer: false },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chrome" } }]
});
