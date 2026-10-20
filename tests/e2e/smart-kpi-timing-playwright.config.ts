import { defineConfig } from "@playwright/test";
import mixed from "./smart-kpi-mixed-playwright.config";

// Timing only: retain actions without repeatedly snapshotting all two hundred
// cards. The fixture records safe request metadata; functional traces stay full.
export default defineConfig({
  ...mixed,
  testMatch: "smart-kpi-suggestions.spec.ts",
  grep: /warm /,
  use: { ...mixed.use, trace: { mode: "retain-on-failure", snapshots: false, screenshots: false, sources: false } }
});
