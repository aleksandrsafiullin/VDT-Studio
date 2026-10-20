import { defineConfig } from "@playwright/test";
import mixed from "./smart-kpi-mixed-playwright.config";

const chrome = mixed.projects?.[0]?.use;

// One owned server session: timing first, then affected functional regressions.
// A fresh worker isolates the timing browser from full functional trace capture.
export default defineConfig({
  ...mixed,
  workers: 1,
  projects: [
    { name: "installed-chrome-timing", testMatch: "smart-kpi-suggestions.spec.ts", grep: /warm Library controls 200 nodes normal/,
      use: { ...chrome, trace: { mode: "retain-on-failure", snapshots: false, screenshots: false, sources: false } } },
    { name: "installed-chrome-functional", grep: /mixed partial proposal and own KPI|manual-only editor needs zero model|formula Add saves once/,
      use: { ...chrome, trace: "retain-on-failure" } }
  ]
});
