import { expect, type Page } from "@playwright/test";
import { cloneProject, createVersionSnapshot, productionVolumeProject } from "../../packages/vdt-core/src/index";
import { test } from "./workspace-fixture";

const originalFormula = "effective_working_time * average_productivity";
const indicator = (page: Page) => page.getByTestId("graph-validation-status");
async function selectRoot(page: Page) {
  await page.getByRole("button", { name: "Select Production Volume", exact: true }).click();
  await page.getByRole("tab", { name: "properties", exact: true }).click();
}
async function editFormula(page: Page, formula: string) {
  await page.getByTestId("formula-edit-as-text").click();
  await page.getByTestId("formula-editor").locator("textarea").fill(formula);
}

test.describe("F-05 model validation", { tag: "@chromium" }, () => {
  test.beforeEach(async ({ page, productionWorkspace }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await page.route("**/api/ai/detect-clis**", route => route.fulfill({ json: { agents: [], modelsByAgent: {} } }));
    await page.goto(`/projects/${productionWorkspace.projectId}?vdt=${productionWorkspace.vdtId}`);
    await expect(page.getByTestId("vdt-canvas")).toBeVisible();
    await page.getByRole("button", { name: "Collapse setup panel", exact: true }).click();
    await page.getByRole("button", { name: "Fit View", exact: true }).click();
  });

  test("flags a dimensional mismatch, retains the invalid draft and repairs it in a fresh browser", async ({ page, browser, productionWorkspace }, testInfo) => {
    await expect(indicator(page)).toHaveAttribute("data-valid", "true");
    await selectRoot(page);
    await page.getByRole("textbox", { name: "Unit", exact: true }).fill("USD");
    await expect(indicator(page)).toHaveAttribute("data-valid", "false");
    await page.setViewportSize({ width: 950, height: 1100 });
    await expect(indicator(page)).toBeVisible();
    await page.setViewportSize({ width: 1600, height: 1100 });
    await page.getByRole("button", { name: "Review model issues", exact: true }).click();
    const warnings = page.getByTestId("right-panel");
    await expect(warnings.getByRole("tab", { name: "warnings", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(warnings.getByRole("alert")).toContainText("output unit");
    await expect(warnings.getByRole("alert")).toContainText("USD");
    await page.screenshot({ path: testInfo.outputPath("unit-mismatch.png") });
    await page.getByTestId("back-to-project-workspace").click();
    await expect(page.getByTestId(`project-vdt-card-${productionWorkspace.vdtId}`)).toBeVisible();

    const fresh = await browser.newContext({ baseURL: new URL(page.url()).origin, viewport: { width: 1600, height: 1100 } });
    try {
      const reopened = await fresh.newPage();
      await reopened.route("**/api/ai/detect-clis**", route => route.fulfill({ json: { agents: [], modelsByAgent: {} } }));
      await reopened.goto(`/projects/${productionWorkspace.projectId}?vdt=${productionWorkspace.vdtId}`);
      await expect(reopened.getByTestId("vdt-canvas")).toBeVisible();
      await expect(indicator(reopened)).toHaveAttribute("data-valid", "false");
      await selectRoot(reopened);
      await expect(reopened.getByRole("textbox", { name: "Unit", exact: true })).toHaveValue("USD");
      await reopened.getByRole("textbox", { name: "Unit", exact: true }).fill("tonnes/month");
      await expect(indicator(reopened)).toHaveAttribute("data-valid", "true");
      await expect(indicator(reopened)).toHaveAttribute("aria-label", "Model graph valid");
      await reopened.screenshot({ path: testInfo.outputPath("unit-repaired.png") });
    } finally { await fresh.close(); }
  });

  test("rejects the wrong root type and a root without a formula or value", async ({ page }, testInfo) => {
    await selectRoot(page);
    await page.getByRole("combobox", { name: "Type", exact: true }).selectOption("input");
    await expect(indicator(page)).toHaveAttribute("data-valid", "false");
    await page.getByRole("button", { name: "Review model issues", exact: true }).click();
    await expect(page.getByTestId("right-panel").getByRole("alert")).toContainText("must have type Root KPI");
    await page.getByRole("tab", { name: "properties", exact: true }).click();
    await page.getByRole("combobox", { name: "Type", exact: true }).selectOption("root_kpi");
    await expect(indicator(page)).toHaveAttribute("data-valid", "true");
    await editFormula(page, "");
    await expect(indicator(page)).toHaveAttribute("data-valid", "false");
    await page.getByRole("button", { name: "Review model issues", exact: true }).click();
    await expect(page.getByTestId("right-panel")).toContainText("needs a formula or a finite Baseline value");
    await page.screenshot({ path: testInfo.outputPath("root-not-ready.png") });
    await page.getByRole("tab", { name: "properties", exact: true }).click();
    await editFormula(page, originalFormula);
    await expect(indicator(page)).toHaveAttribute("data-valid", "true");
  });

  test("reports a hidden formula dependency and clears the issue after formula repair", async ({ page }, testInfo) => {
    await selectRoot(page);
    await editFormula(page, "effective_working_time * nominal_rate");
    await expect(indicator(page)).toHaveAttribute("data-valid", "false");
    await page.getByRole("button", { name: "Review model issues", exact: true }).click();
    const warnings = page.getByTestId("right-panel");
    await expect(warnings).toContainText("Nominal Rate");
    await expect(warnings).toContainText("without a mathematical link");
    await expect(warnings).toContainText("not used by its formula");
    await page.screenshot({ path: testInfo.outputPath("formula-link-mismatch.png") });
    await page.getByRole("tab", { name: "properties", exact: true }).click();
    await editFormula(page, originalFormula);
    await expect(indicator(page)).toHaveAttribute("data-valid", "true");
  });

  test.describe("stored visual cycle", () => {
    const cyclic = createVersionSnapshot(cloneProject(productionVolumeProject), { name: "Valid topology" });
    cyclic.graph.edges.push({ id: "f05_visual_back", sourceNodeId: "calendar_time", targetNodeId: cyclic.rootNodeId, relation: "contextual_influence", aiGenerated: false });
    test.use({ productionModel: cyclic });

    test("loads a repairable cycle and restores a valid version through the interface", async ({ page }, testInfo) => {
      await expect(indicator(page)).toHaveAttribute("data-valid", "false");
      await page.getByRole("button", { name: "Review model issues", exact: true }).click();
      await expect(page.getByTestId("right-panel")).toContainText("Visual links contain a cycle");
      await page.screenshot({ path: testInfo.outputPath("visual-cycle.png") });
      await page.getByTestId("version-history-button").click();
      const versions = page.getByTestId("version-history-panel");
      await expect(versions.getByRole("heading", { name: "Valid topology", exact: true })).toBeVisible();
      await versions.getByRole("button", { name: "Restore this version", exact: true }).click();
      await versions.getByTestId("confirm-version-restore").click();
      await versions.getByRole("button", { name: "Close versions", exact: true }).click();
      await expect(indicator(page)).toHaveAttribute("data-valid", "true");
      await page.screenshot({ path: testInfo.outputPath("visual-cycle-repaired.png") });
      await page.reload();
      await expect(indicator(page)).toHaveAttribute("data-valid", "true");
      await expect(page.getByTestId("editor-top-bar")).toContainText("126,720");
    });
  });
});
