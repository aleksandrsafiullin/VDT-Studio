import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { expect, type Page } from "@playwright/test";
import { getExcelWorkbookCells, type VdtProject } from "../../packages/vdt-core/src/index";
import { selectCanvasKpi, test } from "./workspace-fixture";

const XLSX = createRequire(path.resolve("packages/data-harness/package.json"))("xlsx") as {
  read(data: Buffer, options: { type: "buffer" }): { Sheets: Record<string, Record<string, { v?: unknown; f?: string }>> };
};

function card(page: Page, id: string) {
  return page.locator(`.react-flow__node[data-id="${id}"]`).getByRole("button", { name: /^Select / });
}

async function select(page: Page, name: string) {
  await selectCanvasKpi(page, name);
  await page.getByRole("tab", { name: "properties", exact: true }).click();
}

async function enable(page: Page, name = "Unplanned Downtime", target = 100_000) {
  await select(page, name);
  await page.getByTestId("node-goal-seek-toggle").check();
  await page.getByTestId("goal-seek-target-value").fill(String(target));
}

async function expectSolved(page: Page, expected: number) {
  await expect.poll(async () => Number(await page.getByTestId("node-back-calculated-value").inputValue()))
    .toBeCloseTo(expected, 8);
  await expect(page.getByTestId("node-back-calculated-value")).toHaveAttribute("readonly", "");
}

async function readProject(page: Page): Promise<VdtProject> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("vdt-studio-state")!).state.project as VdtProject);
}

async function openScenario(page: Page) {
  await page.getByTestId("open-scenario-modal").click();
  await expect(page.getByTestId("main-scenario-checkbox")).toBeFocused();
}

test.describe("Back-calculated Baseline", { tag: "@chromium" }, () => {
  test.beforeEach(async ({ page, productionWorkspace }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await page.route("**/api/ai/detect-clis**", route => route.fulfill({ json: { agents: [], modelsByAgent: {} } }));
    await page.goto(`/projects/${productionWorkspace.projectId}?vdt=${productionWorkspace.vdtId}`);
    await expect(page.getByTestId("vdt-canvas")).toBeVisible();
    await page.getByRole("button", { name: "Collapse setup panel", exact: true }).click();
    await page.getByRole("button", { name: "Fit View", exact: true }).click();
  });

  test("recalculates measurements, changes output target, validates drafts and restores the source", async ({ page }, testInfo) => {
    await select(page, "Production Volume");
    await expect(page.getByTestId("node-goal-seek-toggle")).toBeDisabled();
    await enable(page);
    await expectSolved(page, 720 - 40 - 100_000 / (220 * 0.96));
    await expect(card(page, "unplanned_downtime").getByTestId("node-goal-seek-badge")).toHaveText("Back-calculated");
    await expect(card(page, "unplanned_downtime")).toContainText("206.52");
    await expect(page.getByTestId("editor-top-bar")).toContainText("100,000");
    await page.screenshot({ path: testInfo.outputPath("calibrated-baseline.png") });

    await select(page, "Planned Downtime");
    await expect(page.getByTestId("node-goal-seek-toggle")).toBeDisabled();
    await expect(page.getByTestId("goal-seek-settings")).toContainText("already uses back-calculation");
    await page.getByTestId("node-baseline-value").fill("60");
    await select(page, "Unplanned Downtime");
    await expectSolved(page, 720 - 60 - 100_000 / (220 * 0.96));
    await expect(page.getByTestId("editor-top-bar")).toContainText("100,000");

    await page.getByTestId("goal-seek-target-value").fill("");
    await expect(page.getByTestId("goal-seek-target-value")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByTestId("goal-seek-settings").getByRole("alert")).toContainText("saved target is still 100,000");
    await expectSolved(page, 720 - 60 - 100_000 / (220 * 0.96));
    await page.getByTestId("goal-seek-target-value").fill("100000");
    await page.getByTestId("goal-seek-target").selectOption("effective_working_time");
    await page.getByTestId("goal-seek-target-value").fill("500");
    await expectSolved(page, 160);
    await expect(page.getByTestId("goal-seek-settings")).toContainText("Actual output (hours/month)");
    await expect(page.getByTestId("editor-top-bar")).toContainText("105,600");
    await page.getByTestId("goal-seek-target-value").fill("0");
    await expectSolved(page, 660);
    await page.getByTestId("goal-seek-target-value").fill("700");
    await expectSolved(page, -40);
    await expect(page.getByTestId("goal-seek-settings")).toContainText("Baseline is negative");
    await page.getByTestId("node-goal-seek-toggle").uncheck();
    await expect(page.getByTestId("node-baseline-value")).toHaveValue("80");
    await expect(card(page, "unplanned_downtime").getByTestId("node-goal-seek-badge")).toHaveCount(0);
    await expect(page.getByTestId("editor-top-bar")).toContainText("122,496");
  });

  test("applies scenario changes after Baseline solving and respects the scenario lock", async ({ page }, testInfo) => {
    await enable(page);
    const solved = 720 - 40 - 100_000 / (220 * 0.96);
    await openScenario(page);
    // Remove the example's balancing override before testing an independent driver.
    await page.getByTestId("scenario-override-card-unplanned_downtime").getByRole("spinbutton").fill("");
    await page.getByTestId("scenario-override-card-planned_downtime").getByRole("spinbutton").fill("20");
    await expect(page.getByTestId("scenario-totals-metrics")).toContainText("104,224");
    await page.screenshot({ path: testInfo.outputPath("scenario-improvement.png") });
    await page.getByTestId("scenario-modal-close").click();
    await expectSolved(page, solved);
    await expect(page.getByTestId("editor-top-bar")).toContainText("100,000");
    await expect(card(page, "production_volume").getByTestId("node-main-scenario-value")).toHaveText("104,224");

    await openScenario(page);
    const balancingOverride = page.getByTestId("scenario-override-card-unplanned_downtime").getByRole("spinbutton");
    // Focus expands the formatted Base into its exact editable value. Replace
    // that value using the same selection and keyboard sequence as a user.
    await balancingOverride.focus();
    await expect(balancingOverride).toBeFocused();
    await expect.poll(async () => Number(await balancingOverride.inputValue())).toBeCloseTo(solved, 8);
    await balancingOverride.press("ControlOrMeta+A");
    await balancingOverride.press("0");
    await expect.poll(async () => (await readProject(page)).scenarios[0]!.overrides)
      .toContainEqual({ nodeId: "unplanned_downtime", value: 0 });
    await expect(page.getByTestId("scenario-totals-metrics")).toContainText("147,840");
    await page.getByTestId("scenario-modal-close").click();
    await page.getByTestId("node-fixed-in-scenario-toggle").check();
    await expect(card(page, "production_volume").getByTestId("node-main-scenario-value")).toHaveText("104,224");
    await expectSolved(page, solved);
    await openScenario(page);
    await expect(page.getByTestId("scenario-override-card-unplanned_downtime")).toHaveCount(0);
  });

  test("shows unsolvable calibration without a stale value and recovers after repair", async ({ page }, testInfo) => {
    await enable(page);
    await select(page, "Nominal Rate");
    await page.getByTestId("node-baseline-value").fill("0");
    await select(page, "Unplanned Downtime");
    await expect(page.getByTestId("node-back-calculated-value")).toHaveValue("");
    await expect(page.getByTestId("goal-seek-settings").getByRole("alert")).toContainText("No unique finite solution");
    await expect(card(page, "unplanned_downtime").getByTestId("node-goal-seek-badge")).toHaveText("Back-calculation · review");
    await page.screenshot({ path: testInfo.outputPath("no-solution.png") });
    await select(page, "Nominal Rate");
    await page.getByTestId("node-baseline-value").fill("220");
    await select(page, "Unplanned Downtime");
    await expectSolved(page, 720 - 40 - 100_000 / (220 * 0.96));
    await expect(page.getByTestId("goal-seek-settings").getByRole("alert")).toHaveCount(0);
  });

  test("recalculates after adding and changing a branch through the manual editor", async ({ page }) => {
    await enable(page);
    await page.getByRole("button", { name: "Add incoming KPI manually for Effective Working Time", exact: true }).click();
    const panel = page.getByTestId("smart-kpi-panel");
    await panel.getByRole("textbox", { name: "KPI name", exact: true }).fill("New measured loss");
    await panel.getByRole("textbox", { name: "KPI unit", exact: true }).fill("hours/month");
    const alias = await panel.getByRole("textbox", { name: "KPI name", exact: true }).getAttribute("data-manual-name");
    expect(alias).toBeTruthy();
    const formula = panel.getByTestId("incoming-kpi-formula-input");
    await formula.fill(`(${await formula.inputValue()}) - ${alias}`);
    await panel.getByRole("textbox", { name: "Value for New measured loss", exact: true }).fill("0");
    await panel.getByRole("button", { name: "Add & calculate", exact: true }).click();
    await expect(page.getByRole("button", { name: "Select New measured loss", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close Smart suggestions", exact: true }).click();
    await select(page, "New measured loss");
    await page.getByTestId("node-baseline-value").fill("15");
    await select(page, "Unplanned Downtime");
    await expectSolved(page, 720 - 40 - 15 - 100_000 / (220 * 0.96));
    await expect(page.getByTestId("editor-top-bar")).toContainText("100,000");
  });

  test("restores calibration with a version, persists it in a fresh browser and downloads Excel", async ({ page, browser, productionWorkspace }, testInfo) => {
    await enable(page);
    await page.getByTestId("version-history-button").click();
    const versions = page.getByTestId("version-history-panel");
    await versions.getByRole("button", { name: "Save version", exact: true }).click();
    await versions.getByRole("textbox", { name: "New version name", exact: true }).fill("Calibrated actuals");
    await versions.getByRole("button", { name: "Save", exact: true }).click();
    await expect(versions.getByRole("heading", { name: "Calibrated actuals", exact: true })).toBeVisible();
    await versions.getByRole("button", { name: "Close versions", exact: true }).click();
    await page.getByTestId("goal-seek-target-value").fill("90000");
    await page.getByTestId("version-history-button").click();
    await expect(versions.getByTestId("version-changes-table")).toContainText("Back-calculation settings changed");
    await versions.getByRole("button", { name: "Restore this version", exact: true }).click();
    await versions.getByTestId("confirm-version-restore").click();
    await versions.getByRole("button", { name: "Close versions", exact: true }).click();
    await select(page, "Unplanned Downtime");
    await expect(page.getByTestId("goal-seek-target-value")).toHaveValue("100000");
    await page.getByTestId("back-to-project-workspace").click();
    await expect(page.getByTestId(`project-vdt-card-${productionWorkspace.vdtId}`)).toBeVisible();

    const fresh = await browser.newContext({ baseURL: new URL(page.url()).origin, viewport: { width: 1600, height: 1100 }, acceptDownloads: true });
    try {
      const reopened = await fresh.newPage();
      await reopened.route("**/api/ai/detect-clis**", route => route.fulfill({ json: { agents: [], modelsByAgent: {} } }));
      await reopened.goto(`/projects/${productionWorkspace.projectId}?vdt=${productionWorkspace.vdtId}`);
      await expect(reopened.getByTestId("vdt-canvas")).toBeVisible();
      await select(reopened, "Unplanned Downtime");
      await expect(reopened.getByTestId("goal-seek-target-value")).toHaveValue("100000");
      await expectSolved(reopened, 720 - 40 - 100_000 / (220 * 0.96));
      const project = await readProject(reopened);
      expect(project.graph.nodes.find(node => node.id === "unplanned_downtime")?.baselineValue).toBe(80);
      expect(project.versions.some(version => version.name === "Calibrated actuals")).toBe(true);
      fs.writeFileSync(testInfo.outputPath("persisted-project.json"), JSON.stringify(project, null, 2));

      const downloadPromise = reopened.waitForEvent("download");
      await reopened.getByTestId("export-excel").click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
      const filename = testInfo.outputPath("back-calculated.xlsx");
      await download.saveAs(filename);
      const book = XLSX.read(fs.readFileSync(filename), { type: "buffer" });
      const cells = getExcelWorkbookCells(project);
      expect(book.Sheets.VDT![cells.tree.production_volume!.baselineCell]!.v).toBeCloseTo(100_000, 7);
      const inverse = book.Sheets.VDT![cells.tree.unplanned_downtime!.baselineCell]!;
      expect(inverse.v).toBeCloseTo(720 - 40 - 100_000 / (220 * 0.96), 8);
      expect(inverse.f).toContain("'Source'!$B$3");
      expect(inverse.f).not.toContain("100000");
      expect(book.Sheets.Source![cells.backCalculation!.targetValueCell]!.v).toBe(100_000);
      expect(book.Sheets.Source!.A3!.v).toBe("Back-calculation target");
      expect(inverse.f).not.toContain(cells.tree.production_volume!.baselineCell);
      expect(book.Sheets.Source![cells.source.unplanned_downtime!.valueCell]!.v).toBe(80);
      expect(book.Sheets["_Scenario Calc"]![`B${cells.scenario.calculation.nodeRows.unplanned_downtime}`]!.f)
        .toContain(`'VDT'!${cells.tree.unplanned_downtime!.baselineCell}`);
      await reopened.screenshot({ path: testInfo.outputPath("persisted-baseline.png") });
    } finally {
      await fresh.close();
    }
  });
});
