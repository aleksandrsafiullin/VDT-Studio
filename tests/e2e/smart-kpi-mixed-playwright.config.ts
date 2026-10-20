import path from "node:path";
import { defineConfig } from "@playwright/test";
import smart from "./smart-kpi-playwright.config";

const repository = path.resolve(__dirname, "../..");
const run = process.env.VDT_SMART_E2E_RUN!;
export default defineConfig({
  ...smart,
  testMatch: ["smart-kpi-suggestions.spec.ts", "smart-kpi-mixed.spec.ts"],
  outputDir: path.join(repository, `output/smart-kpi-formula-mixed/${run}/test-results`),
  reporter: [["list"], ["json", { outputFile: path.join(repository, `output/smart-kpi-formula-mixed/${run}/results.json`) }]]
});
