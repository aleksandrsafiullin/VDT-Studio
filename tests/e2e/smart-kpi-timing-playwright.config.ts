import { defineConfig } from "@playwright/test";
import mixed from "./smart-kpi-mixed-playwright.config";

// Run only the timing spec, which owns the trace settings for its measurements.
export default defineConfig({
  ...mixed,
  testMatch: "smart-kpi-warm-cache.spec.ts"
});
