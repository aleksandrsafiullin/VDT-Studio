import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { calculateGraph } from "../../packages/vdt-core/src/formula/calculate";
import { calculateScenarioGraph } from "../../packages/vdt-core/src/scenario/scenario";
import { createSmartBrowserFixture, openSmartPanel, readSmartBrowserProject } from "./smart-kpi-fixture";

const artifacts = process.env.VDT_SMART_E2E_ARTIFACTS ?? "output/smart-kpi-formula-mixed";
test.beforeAll(async () => { await mkdir(artifacts, { recursive: true }); });

for (const unknownTargetValue of [false, true]) test(`@chromium illustrative estimates preserve the ${unknownTargetValue ? "estimated" : "measured"} reference through real Add reload and Undo`, async ({ page }) => {
  test.setTimeout(180_000);
  const fixture = await createSmartBrowserFixture(page, "ratio", 1, { haulageTarget: true, unknownTargetValue });
  try {
    let panel = await openSmartPanel(page, fixture.targetNodeId);
    await expect(panel.getByRole("checkbox", { name: "Use estimates", exact: true })).toBeChecked();
    const before = await readSmartBrowserProject(page);
    const reference = unknownTargetValue ? 0.2 : 4;
    if (unknownTargetValue) {
      await panel.getByRole("textbox", { name: "Current KPI value", exact: true }).fill(String(reference));
      await panel.getByRole("checkbox", { name: "Reference is an estimate", exact: true }).check();
    }
    const amount = panel.getByRole("textbox", { name: "Value for Total measured distance", exact: true });
    const trips = panel.getByRole("textbox", { name: "Value for Measured trips", exact: true });
    await expect(amount).toHaveAttribute("placeholder", String(reference * 1000));
    await expect(trips).toHaveAttribute("placeholder", "1000");
    await expect(amount).toHaveAttribute("data-value-source", "estimate");
    await expect(trips).toHaveAttribute("title", "Illustrative estimate, not measured data.");
    await expect(panel.getByTestId("incoming-kpi-estimates")).toContainText("illustrative values");
    await expect(panel.getByTestId("incoming-kpi-balance")).toContainText(`${reference} → ${reference}`);
    await expect(panel.getByTestId("smart-kpi-add-selected")).toBeEnabled();
    expect((await readSmartBrowserProject(page)).graph).toEqual(before.graph);
    await page.screenshot({ path: `${artifacts}/estimates-ready-${unknownTargetValue ? "estimated" : "measured"}-reference.png`, fullPage: true });
    await panel.getByTestId("smart-kpi-add-selected").click();
    await expect(panel.getByTestId("smart-kpi-feedback")).toContainText("2 KPIs added and saved");
    const applied = await readSmartBrowserProject(page);
    expect(calculateGraph(applied).values[fixture.targetNodeId]).toBe(reference);
    for (const name of ["Total measured distance", "Measured trips"]) expect(applied.graph.nodes.find(node => node.name === name)).toMatchObject({
      valueStatus: "default_assumption", valueSource: { sourceTier: "assumption", note: expect.stringContaining("Not measured data") }
    });
    for (const name of ["Total measured distance", "Measured trips"]) {
      const node = applied.graph.nodes.find(node => node.name === name)!;
      await expect(page.locator(`.react-flow__node[data-id="${node.id}"]`)).toContainText("≈");
    }
    expect(applied.graph.nodes.find(node => node.id === fixture.targetNodeId)?.valueSource?.sourceTier).toBe(unknownTargetValue ? "assumption" : before.graph.nodes.find(node => node.id === fixture.targetNodeId)?.valueSource?.sourceTier);
    await page.reload(); await expect(page.getByTestId("vdt-canvas")).toBeVisible();
    expect(calculateGraph(await readSmartBrowserProject(page)).values[fixture.targetNodeId]).toBe(reference);
    panel = await openSmartPanel(page, fixture.targetNodeId);
    await panel.getByTestId("smart-kpi-undo").click(); await expect(panel.getByTestId("smart-kpi-feedback")).toContainText("undone");
    expect((await readSmartBrowserProject(page)).graph).toEqual(before.graph);
  } finally { await fixture.cleanup(); }
});

for (const unknownTargetValue of [false, true]) test(`@chromium numeric ratio preserves the ${unknownTargetValue ? "explicitly supplied" : "measured"} parent and blocks mismatches`, async ({ page }) => {
  test.setTimeout(180_000);
  const fixture = await createSmartBrowserFixture(page, "ratio", 1, { haulageTarget: true, unknownTargetValue });
  try {
    const panel = await openSmartPanel(page, fixture.targetNodeId), add = panel.getByTestId("smart-kpi-add-selected");
    await expect(panel.getByRole("textbox", { name: "Value for Measured trips", exact: true })).toBeVisible();
    await fixture.waitForPreparationIdle();
    await panel.getByRole("checkbox", { name: "Use estimates", exact: true }).uncheck();
    const before = await readSmartBrowserProject(page), calls = fixture.calls.length;
    await expect(add).toBeDisabled();
    if (unknownTargetValue) {
      await expect(panel).toContainText("Enter the current KPI value");
      await panel.getByRole("textbox", { name: "Current KPI value", exact: true }).fill("4");
    }
    const total = panel.getByRole("textbox", { name: "Value for Total measured distance", exact: true });
    const trips = panel.getByRole("textbox", { name: "Value for Measured trips", exact: true });
    await trips.fill("0"); await expect(add).toBeDisabled();
    await trips.fill("25"); await expect(add).toBeEnabled();
    await expect(total).toHaveAttribute("placeholder", "100");
    await expect(panel.getByTestId("incoming-kpi-balance")).toContainText("4 → 4");
    await total.fill("120"); await expect(add).toBeDisabled();
    await expect(panel).toContainText("The formula gives 4.8");
    expect((await readSmartBrowserProject(page)).graph).toEqual(before.graph);
    expect(fixture.calls).toHaveLength(calls);
    await total.fill(""); await expect(add).toBeEnabled();
    await page.screenshot({ path: `${artifacts}/values-ready-${unknownTargetValue ? "entered" : "measured"}.png`, fullPage: true });
    const writes: unknown[] = [];
    page.on("request", request => { if (new URL(request.url()).pathname === `/api/vdt/vdts/${fixture.vdtId}/revisions` && request.method() === "POST") writes.push(request.postDataJSON()); });
    await add.click(); await expect(panel.getByTestId("smart-kpi-feedback")).toContainText("2 KPIs added and saved");
    expect(writes).toHaveLength(1);
    const applied = await readSmartBrowserProject(page);
    expect(calculateGraph(applied).values[fixture.targetNodeId]).toBe(4);
    expect(applied.graph.nodes.find(node => node.name === "Total measured distance")).toMatchObject({ baselineValue: 100, valueStatus: "calculated", valueSource: { sourceTier: "derived" } });
    expect(applied.graph.nodes.find(node => node.name === "Measured trips")).toMatchObject({ baselineValue: 25, valueStatus: "user_provided_value" });
    await page.reload(); await expect(page.getByTestId("vdt-canvas")).toBeVisible();
    expect(calculateGraph(await readSmartBrowserProject(page)).values[fixture.targetNodeId]).toBe(4);
  } finally { await fixture.cleanup(); }
});

test("@chromium minimal Smart repairs a historical input type with real Add, reload and Undo", async ({ page }) => {
  test.setTimeout(180_000);
  const fixture = await createSmartBrowserFixture(page, "formula", 1, { haulageTarget: true, staleInputType: true });
  try {
    let panel = await openSmartPanel(page, fixture.targetNodeId);
    await panel.getByRole("checkbox", { name: "Use estimates", exact: true }).uncheck();
    await expect(panel.getByTestId("smart-kpi-add-selected")).toBeDisabled();
    await panel.getByRole("textbox", { name: "Value for QA component A", exact: true }).fill("1");
    await expect(panel.getByTestId("smart-kpi-add-selected")).toBeEnabled();
    await expect(panel.getByRole("textbox", { name: "Value for QA component B", exact: true })).toHaveAttribute("placeholder", "3");
    await expect(panel.getByTestId("incoming-kpi-balance")).toContainText("4 → 4");
    await expect(panel.getByTestId("incoming-kpi-edit")).not.toHaveAttribute("open");
    await expect(panel.getByTestId("incoming-kpi-own-row")).not.toBeVisible();
    await expect(panel.getByRole("group", { name: "Formula operators", exact: true })).not.toBeVisible();
    await expect(panel.getByRole("group", { name: "Insert KPI reference", exact: true })).not.toBeVisible();
    await expect(panel.getByText("Prepared", { exact: true })).toHaveCount(0);
    await expect(panel.getByRole("radio")).toHaveCount(0);
    expect((await panel.boundingBox())!.height).toBeLessThan(400);
    const before = await readSmartBrowserProject(page), initial = await (await page.request.get(`/api/vdt/vdts/${fixture.vdtId}`)).json();
    const originalInput = before.graph.nodes.find(node => node.id === "waste_empty_km_trip")!;
    await page.screenshot({ path: `${artifacts}/minimal-smart-ready.png`, fullPage: true });
    await panel.getByTestId("smart-kpi-add-selected").click();
    await expect(panel.getByTestId("smart-kpi-feedback")).toContainText("2 KPIs added and saved");
    const applied = await readSmartBrowserProject(page), repaired = applied.graph.nodes.find(node => node.id === originalInput.id)!;
    expect(calculateGraph(applied).values[fixture.targetNodeId]).toBe(4);
    expect(applied.graph.nodes.find(node => node.name === "QA component A")).toMatchObject({ baselineValue: 1, valueStatus: "user_provided_value" });
    expect(applied.graph.nodes.find(node => node.name === "QA component B")).toMatchObject({ baselineValue: 3, valueStatus: "calculated", valueSource: { sourceTier: "derived" } });
    expect(repaired).toMatchObject({ id: originalInput.id, name: originalInput.name, type: "input", baselineValue: originalInput.baselineValue,
      unit: originalInput.unit, valueStatus: originalInput.valueStatus, dataMapping: originalInput.dataMapping });
    expect(applied.graph.edges.filter(edge => edge.sourceNodeId === originalInput.id)).toEqual(before.graph.edges.filter(edge => edge.sourceNodeId === originalInput.id));
    const saved = await (await page.request.get(`/api/vdt/vdts/${fixture.vdtId}`)).json();
    expect(saved.revisions).toHaveLength(initial.revisions.length + 1);
    expect(saved.activeProject.graph.nodes.find((node: { id: string }) => node.id === originalInput.id).type).toBe("input");
    await page.reload(); await expect(page.getByTestId("vdt-canvas")).toBeVisible();
    expect((await readSmartBrowserProject(page)).graph.nodes.find(node => node.id === originalInput.id)?.type).toBe("input");
    panel = await openSmartPanel(page, fixture.targetNodeId);
    await panel.getByTestId("smart-kpi-undo").click(); await expect(panel.getByTestId("smart-kpi-feedback")).toContainText("undone");
    expect((await readSmartBrowserProject(page)).graph).toEqual(before.graph);
    const undone = await (await page.request.get(`/api/vdt/vdts/${fixture.vdtId}`)).json();
    expect(undone.revisions).toHaveLength(initial.revisions.length + 2);
  } finally { await fixture.cleanup(); }
});

test("@chromium mixed partial proposal and own KPI apply one visible formula, persist, reopen and Undo", async ({ page }) => {
  test.setTimeout(180_000);
  const fixture = await createSmartBrowserFixture(page, "formula", 1, { haulageTarget: true });
  try {
    const target = page.locator(`.react-flow__node[data-id="${fixture.targetNodeId}"]`);
    await target.getByRole("button", { name: "Select Measured moving distance", exact: true }).click();
    const panel = await openSmartPanel(page, fixture.targetNodeId);
    await panel.getByRole("checkbox", { name: "Use estimates", exact: true }).uncheck();
    await panel.getByRole("textbox", { name: "Value for QA component A", exact: true }).fill("1");
    await expect(panel.getByTestId("smart-kpi-add-selected")).toBeEnabled();
    await expect(panel.getByTestId("incoming-kpi-readable-formula")).toContainText("QA component A");
    await expect(panel.getByTestId("incoming-kpi-readable-formula")).toContainText("QA component B");
    const original = await readSmartBrowserProject(page), initial = await (await page.request.get(`/api/vdt/vdts/${fixture.vdtId}`, { timeout: 60_000 })).json();
    const preparationCount = fixture.calls.length;
    await panel.getByRole("checkbox", { name: "QA component A", exact: true }).uncheck();
    await expect(panel.getByTestId("smart-kpi-add-selected")).toBeDisabled();
    await panel.getByText("Edit", { exact: true }).click();
    await panel.getByTestId("incoming-kpi-own-row").click();
    await panel.getByRole("textbox", { name: "KPI name", exact: true }).fill("Own moving distance");
    await panel.getByRole("textbox", { name: "KPI unit", exact: true }).fill("km/trip");
    expect((await panel.getByRole("textbox", { name: "KPI name", exact: true }).boundingBox())!.width).toBeGreaterThanOrEqual(150);
    const unitWidth = (await panel.getByRole("textbox", { name: "KPI unit", exact: true }).boundingBox())!.width;
    expect(unitWidth).toBeGreaterThanOrEqual(70); expect(unitWidth).toBeLessThanOrEqual(90);
    const ownKey = await panel.getByRole("textbox", { name: "KPI name", exact: true }).getAttribute("data-manual-name");
    expect(ownKey).toMatch(/^m_[a-f0-9]{32}$/);
    await panel.getByTestId("incoming-kpi-formula-input").fill(`p_2 + ${ownKey}`);
    await panel.getByRole("textbox", { name: "Value for QA component B", exact: true }).fill("1");
    await expect(panel.getByTestId("smart-kpi-add-selected")).toBeEnabled();
    await panel.getByRole("textbox", { name: "KPI name", exact: true }).fill("Own distance renamed");
    await expect(panel.getByTestId("incoming-kpi-formula-input")).toHaveValue(`p_2 + ${ownKey}`);
    await expect(panel.getByTestId("incoming-kpi-readable-formula")).toContainText("Own distance renamed");
    expect((await readSmartBrowserProject(page)).graph).toEqual(original.graph);
    expect(fixture.calls).toHaveLength(preparationCount);
    await page.screenshot({ path: `${artifacts}/mixed-draft-readable.png`, fullPage: true });
    const writes: unknown[] = [];
    page.on("request", request => { if (new URL(request.url()).pathname === `/api/vdt/vdts/${fixture.vdtId}/revisions` && request.method() === "POST") writes.push(request.postDataJSON()); });
    await panel.getByTestId("smart-kpi-add-selected").click();
    await expect(panel.getByTestId("smart-kpi-feedback")).toContainText("2 KPIs added and saved");
    expect(writes).toHaveLength(1);
    const applied = await readSmartBrowserProject(page), parent = applied.graph.nodes.find(node => node.id === fixture.targetNodeId)!;
    expect(parent.type).toBe("calculated"); expect(parent.formula).toBeTruthy(); expect(parent.baselineValue).toBe(4);
    expect(parent.dataMapping).toEqual(original.graph.nodes.find(node => node.id === fixture.targetNodeId)!.dataMapping);
    expect(applied.graph.nodes.some(node => node.name === "QA component A")).toBe(false);
    expect(applied.graph.nodes.filter(node => ["QA component B", "Own distance renamed"].includes(node.name))).toHaveLength(2);
    expect(applied.graph.nodes.find(node => node.name === "Own distance renamed")).toMatchObject({ status: "accepted", aiGenerated: false, baselineValue: 3, valueStatus: "calculated" });
    expect(calculateGraph(applied).values[parent.id]).toBe(4);
    expect(calculateScenarioGraph(applied, applied.scenarios[0]!).rootValue).toBe(10);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("right-panel").getByRole("combobox", { name: "Type", exact: true })).toHaveValue("calculated");
    await expect(page.getByTestId("node-source-value")).toHaveValue("4"); await expect(page.getByTestId("node-source-value")).toHaveAttribute("readonly", "");
    await expect(target).toContainText("4");
    await page.screenshot({ path: `${artifacts}/calculated-balanced-source-retained.png`, fullPage: true });
    const stored = await (await page.request.get(`/api/vdt/vdts/${fixture.vdtId}`, { timeout: 60_000 })).json();
    expect(stored.revisions).toHaveLength(initial.revisions.length + 1);
    expect(stored.activeProject.graph.nodes.find((node: { id: string }) => node.id === parent.id).formula).toBe(parent.formula);
    await page.reload(); await expect(page.getByTestId("vdt-canvas")).toBeVisible();
    expect((await readSmartBrowserProject(page)).graph.nodes).toHaveLength(original.graph.nodes.length + 2);
    const reopened = await openSmartPanel(page, fixture.targetNodeId);
    let releaseUndo = () => {}, reportUndoCommitted = () => {};
    const heldUndo = new Promise<void>(resolve => { releaseUndo = resolve; });
    const undoCommitted = new Promise<void>(resolve => { reportUndoCommitted = resolve; });
    const revisionPath = `/api/vdt/vdts/${fixture.vdtId}/revisions`;
    await page.route(`**${revisionPath}`, async route => {
      if (route.request().method() !== "POST") { await route.continue(); return; }
      const response = await route.fetch(); reportUndoCommitted();
      await heldUndo; await route.fulfill({ response });
    });
    try {
      await reopened.getByTestId("smart-kpi-undo").click(); await undoCommitted;
      await expect(reopened).toBeFocused();
      await page.mouse.move(12, 12);
      // Cross the 200ms pointer-close deadline while the real save reply is held.
      await page.waitForTimeout(250);
      await expect(reopened).toBeVisible(); await expect(reopened).toBeFocused();
    } finally { releaseUndo(); }
    await expect(reopened.getByTestId("smart-kpi-feedback")).toContainText("undone");
    await expect(reopened).toBeFocused();
    await page.mouse.click(12, 12); await expect(reopened).toHaveCount(0);
    const undone = await (await page.request.get(`/api/vdt/vdts/${fixture.vdtId}`, { timeout: 60_000 })).json();
    expect(undone.revisions).toHaveLength(initial.revisions.length + 2);
    expect(undone.activeProject.graph.nodes).toHaveLength(original.graph.nodes.length);
    expect(undone.activeProject.graph.nodes.find((node: { id: string }) => node.id === fixture.targetNodeId)).toMatchObject({ type: "input", baselineValue: 4 });
  } finally { await fixture.cleanup(); }
});

test("@chromium manual-only editor preserves the baseline with zero model execution and permits later edits", async ({ page }) => {
  test.setTimeout(180_000);
  const fixture = await createSmartBrowserFixture(page, "formula", 1, { configureExecution: false, haulageTarget: true });
  try {
    const target = page.locator(`.react-flow__node[data-id="${fixture.targetNodeId}"]`);
    await target.getByRole("button", { name: "Select Measured moving distance", exact: true }).click();
    const before = await readSmartBrowserProject(page);
    await target.getByTestId("node-add-manual-incoming-kpi").click({ force: true });
    const panel = page.getByTestId("smart-kpi-panel"), name = panel.getByRole("textbox", { name: "KPI name", exact: true });
    await expect(name).toBeFocused(); await name.fill("Own measured distance");
    await panel.getByRole("textbox", { name: "KPI unit", exact: true }).fill("km/trip");
    await panel.getByRole("button", { name: "Insert Own measured distance (km/trip)", exact: true }).click();
    await expect(panel.getByTestId("incoming-kpi-readable-formula")).toContainText("Own measured distance");
    await expect(panel.getByTestId("smart-kpi-add-selected")).toBeEnabled();
    expect((await readSmartBrowserProject(page)).graph).toEqual(before.graph);
    expect(fixture.calls).toHaveLength(0);
    await page.screenshot({ path: `${artifacts}/manual-no-model.png`, fullPage: true });
    await panel.getByTestId("smart-kpi-add-selected").click(); await expect(panel.getByTestId("smart-kpi-feedback")).toContainText("1 KPI added and saved");
    const applied = await readSmartBrowserProject(page);
    expect(applied.graph.nodes.find(node => node.name === "Own measured distance")).toMatchObject({ status: "accepted", aiGenerated: false, baselineValue: 4, valueStatus: "calculated" });
    expect(applied.graph.nodes.find(node => node.id === fixture.targetNodeId)).toMatchObject({ type: "calculated", baselineValue: 4 });
    expect(calculateGraph(applied).values[fixture.targetNodeId]).toBe(4);
    await page.keyboard.press("Escape"); await page.getByRole("button", { name: "Fit View", exact: true }).click();
    await page.getByRole("button", { name: "Select Own measured distance", exact: true }).click();
    await page.getByTestId("right-panel").getByLabel("Baseline value", { exact: true }).fill("7");
    await expect.poll(async () => calculateGraph(await readSmartBrowserProject(page)).values[fixture.targetNodeId]).toBe(7);
    await expect(target).toContainText("7");
    expect(fixture.calls).toHaveLength(0);
    await page.screenshot({ path: `${artifacts}/calculated-after-entered-input.png`, fullPage: true });
  } finally { await fixture.cleanup(); }
});

test("@chromium formula editor preserves invalid raw text and caret replacement without canvas events", async ({ page }) => {
  test.setTimeout(150_000);
  const fixture = await createSmartBrowserFixture(page);
  try {
    const panel = await openSmartPanel(page);
    await panel.getByRole("checkbox", { name: "Use estimates", exact: true }).uncheck();
    await panel.getByRole("textbox", { name: "Value for QA component A", exact: true }).fill("25");
    await expect(panel.getByTestId("smart-kpi-add-selected")).toBeEnabled();
    await panel.getByText("Edit", { exact: true }).click();
    const field = panel.getByTestId("incoming-kpi-formula-input");
    const transform = await page.locator(".react-flow__viewport").getAttribute("style"), before = await readSmartBrowserProject(page), calls = fixture.calls.length;
    await field.fill("p_1 + (@"); await field.press("End"); await field.pressSequentially("#");
    await expect(field).toHaveValue("p_1 + (@#"); await expect(panel.getByTestId("smart-kpi-add-selected")).toBeDisabled();
    await field.fill("p_1 + p_2"); await field.press("ControlOrMeta+A"); await field.press("ArrowLeft");
    await field.press("Shift+ArrowRight"); await field.press("Shift+ArrowRight"); await field.press("Shift+ArrowRight");
    expect(await field.evaluate(element => ({ start: (element as HTMLTextAreaElement).selectionStart, end: (element as HTMLTextAreaElement).selectionEnd }))).toEqual({ start: 0, end: 3 });
    await panel.getByRole("button", { name: "Insert QA component B (t/month)", exact: true }).click();
    await expect(field).toHaveValue("p_2 + p_2"); await expect(field).toBeFocused();
    await field.press("!"); await expect(field).toHaveValue("p_2! + p_2");
    await page.keyboard.press("Space"); await page.keyboard.press("ArrowLeft");
    expect(await page.locator(".react-flow__viewport").getAttribute("style")).toBe(transform);
    expect((await readSmartBrowserProject(page)).graph).toEqual(before.graph);
    expect(fixture.calls).toHaveLength(calls);
    await expect(page.locator('.react-flow__connection')).toHaveCount(0);
    await page.keyboard.press("Escape"); await expect(panel).toHaveCount(0);
  } finally { await fixture.cleanup(); }
});

test("@chromium historical context-only proposals remain readable and cannot silently create a derived sum", async ({ page }) => {
  test.setTimeout(150_000);
  const fixture = await createSmartBrowserFixture(page, "contextual");
  try {
    const before = await readSmartBrowserProject(page), panel = await openSmartPanel(page);
    await expect(panel.getByRole("checkbox", { name: "QA availability", exact: true })).toBeVisible();
    await expect(panel.getByTestId("smart-kpi-add-selected")).toBeDisabled();
    await panel.getByText("Edit", { exact: true }).click();
    await expect(panel.getByTestId("incoming-kpi-formula-input")).toHaveValue("");
    expect((await readSmartBrowserProject(page)).graph).toEqual(before.graph);
    expect(before.graph.nodes[0]!.baselineValue).toBe(100);
  } finally { await fixture.cleanup(); }
});
