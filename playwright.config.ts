import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 2,
  timeout: 45_000,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL: "http://127.0.0.1:3100",
    acceptDownloads: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  reporter: [
    ["list"],
    ["html", { outputFolder: "output/playwright/report", open: "never" }],
    ["json", { outputFile: "output/playwright/results.json" }]
  ],
  webServer: {
    command: "node scripts/start-e2e-web.mjs",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 },
    timeout: 120_000
  },
  projects: [
    {
      name: "chromium",
      // Apply the existing engine/viewport restrictions before creating fixtures.
      grepInvert: /@(mobile-chrome|webkit)\b/,
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "mobile-chrome",
      grepInvert: /@(chromium|webkit)\b/,
      use: { ...devices["Pixel 5"] }
    },
    {
      name: "webkit",
      grepInvert: /@(chromium|mobile-chrome)\b/,
      use: { ...devices["Desktop Safari"] }
    }
  ]
});
