import { defineConfig } from "@playwright/test";
import mixed from "./smart-kpi-mixed-playwright.config";

const chrome = mixed.projects?.[0]?.use;

// One owned server session: timing first, then affected functional regressions.
// A fresh worker isolates the timing browser from full functional trace capture.
export default defineConfig({
  ...mixed,
  workers: 1,
  projects: [
    { name: "installed-chrome-timing", testMatch: "smart-kpi-warm-cache.spec.ts", grep: /warm recipe-backed cache controls 200 nodes normal/,
      use: chrome },
    { name: "installed-chrome-functional", grep: /mixed partial proposal and own KPI|manual-only editor preserves the baseline|formula Add saves once/,
      use: { ...chrome, trace: "retain-on-failure" } }
  ]
});
