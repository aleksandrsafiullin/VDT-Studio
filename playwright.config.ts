import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
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
  reporter: [["list"]],
  webServer: {
    command:
      "VDT_ALLOW_MOCK_PROVIDER=true NEXT_PUBLIC_VDT_ENABLE_STANDALONE_RUNNER=true pnpm --filter @vdt-studio/web dev --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: true,
    timeout: 120_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] }
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] }
    }
  ]
});
