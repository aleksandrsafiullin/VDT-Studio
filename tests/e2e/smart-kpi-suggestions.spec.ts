import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { calculateGraph } from "../../packages/vdt-core/src/formula/calculate";
import { calculateScenarioGraph } from "../../packages/vdt-core/src/scenario/scenario";
import { createSmartBrowserFixture, openSmartPanel, positionSmartRailAtEdge, readSmartBrowserProject, waitForSmartAddition } from "./smart-kpi-fixture";

test.describe("Smart KPI same-hover integration", () => {
  test.beforeAll(async () => { await mkdir("output/smart-kpi-formula-mixed", { recursive: true }); });
  test("@chromium same hover keeps all actions, pointer access, native keyboard focus and canvas geometry", async ({ page }) => {
    test.setTimeout(150_000);
    const fixture = await createSmartBrowserFixture(page, "formula");
    try {
      const panel = await openSmartPanel(page); await expect(panel.getByLabel("QA component A", { exact: true })).toBeEnabled();
      const root = page.locator('.react-flow__node[data-id="measured_output"]'), rail = root.getByTestId("node-incoming-actions");
      await expect(root.locator('.react-flow__handle.source')).toBeVisible();
      for (const id of ["node-add-manual-incoming-kpi", "node-smart-kpi-suggestions", "node-add-file-incoming-kpis"]) await expect(rail.getByTestId(id)).toBeVisible();
      const before = await readSmartBrowserProject(page), transform = await page.locator(".react-flow__viewport").getAttribute("style");
      const anchor = (await rail.boundingBox())!, bounds = (await panel.boundingBox())!;
      await page.mouse.move(anchor.x + anchor.width / 2, anchor.y + anchor.height / 2);
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 30, { steps: 12 });
      await expect(panel).toBeVisible(); await panel.getByLabel("QA component A", { exact: true }).focus(); await page.keyboard.press("Space");
      await expect(panel.getByLabel("QA component A", { exact: true })).not.toBeChecked(); await expect(panel.getByTestId("smart-kpi-add-selected")).toBeDisabled();
      await page.keyboard.press("Space"); await expect(panel.getByLabel("QA component A", { exact: true })).toBeChecked(); await expect(panel.getByTestId("smart-kpi-add-selected")).toBeEnabled();
      await page.mouse.wheel(0, 300); expect(await page.locator(".react-flow__viewport").getAttribute("style")).toBe(transform);
      await expect(page.locator('.react-flow__connection')).toHaveCount(0);
      expect((await readSmartBrowserProject(page)).graph.nodes.map(node => node.position)).toEqual(before.graph.nodes.map(node => node.position));
      expect((await readSmartBrowserProject(page)).graph.edges).toEqual(before.graph.edges);
      await page.keyboard.press("Escape"); await expect(panel).toHaveCount(0);
      await expect(rail.getByTestId("node-smart-kpi-suggestions")).toBeFocused();
      await page.keyboard.press("Enter"); await expect(panel).toBeVisible(); await page.keyboard.press("Tab"); await expect(panel.getByRole("button", { name: "Close Smart suggestions" })).toBeFocused();
      await page.keyboard.press("Shift+Tab"); await expect(rail.getByTestId("node-smart-kpi-suggestions")).toBeFocused();
      await page.getByTestId("auto-distribute-layout").click(); await expect(panel).toHaveCount(0);
      await page.screenshot({ path: "output/smart-kpi-formula-mixed/hover-keyboard.png", fullPage: true });
    } finally { await fixture.cleanup(); }
  });

  test("@chromium frozen selection is stable and semantic edit disables Add until explicit refresh", async ({ page }) => {
    test.setTimeout(150_000); const fixture = await createSmartBrowserFixture(page, "formula");
    try {
      await page.getByRole("button", { name: "Select Measured useful output", exact: true }).click();
      const panel = await openSmartPanel(page); const availability = panel.getByLabel("QA component A", { exact: true }); await availability.uncheck();
      const bounds = (await panel.boundingBox())!; await page.mouse.move(bounds.x + 20, bounds.y + 20);
      await page.getByTestId("right-panel").getByLabel("Name", { exact: true }).fill("Changed QA semantic target");
      await expect(panel).toContainText("The KPI changed"); await expect(availability).not.toBeChecked(); await expect(panel.getByTestId("smart-kpi-add-selected")).toBeDisabled();
      await panel.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect(availability).not.toBeChecked();
      await panel.getByRole("button", { name: "Review latest", exact: true }).click(); await expect(panel).toHaveAccessibleName("Suggested KPIs for Changed QA semantic target");
      await expect(panel.getByLabel("QA component A", { exact: true })).toBeChecked();
    } finally { await fixture.cleanup(); }
  });

  test("@chromium formula Add saves once through real revisions, derives the target, retains source/scenario, reloads and Undo creates a revision", async ({ page }) => {
    test.setTimeout(180_000); const fixture = await createSmartBrowserFixture(page, "formula");
    try {
      const panel = await openSmartPanel(page); await expect(panel.getByTestId("smart-kpi-add-selected")).toBeEnabled();
      await panel.getByRole("checkbox", { name: "Use estimates", exact: true }).uncheck();
      await panel.getByRole("textbox", { name: "Value for QA component A", exact: true }).fill("40");
      await expect(panel.getByTestId("incoming-kpi-balance")).toContainText("100 → 100");
      await expect(panel.getByTestId("smart-kpi-add-selected")).toBeEnabled();
      const before = await readSmartBrowserProject(page), initialLoad = await (await page.request.get(`/api/vdt/vdts/${fixture.vdtId}`, { timeout: 60_000 })).json();
      const requests: unknown[] = []; page.on("request", request => { if (new URL(request.url()).pathname === `/api/vdt/vdts/${fixture.vdtId}/revisions` && request.method() === "POST") requests.push(request.postDataJSON()); });
      await panel.getByTestId("smart-kpi-add-selected").click(); await waitForSmartAddition(page);
      const after = await readSmartBrowserProject(page); expect(after.graph.nodes).toHaveLength(before.graph.nodes.length + 2); expect(requests).toHaveLength(1);
      expect(calculateGraph(after).rootValue).toBe(100);
      const targetBefore = before.graph.nodes.find(node => node.id === fixture.targetNodeId)!;
      const targetAfter = after.graph.nodes.find(node => node.id === fixture.targetNodeId)!;
      expect(targetAfter).toMatchObject({ type: "calculated", baselineValue: targetBefore.baselineValue, dataMapping: targetBefore.dataMapping });
      await expect(page.getByTestId("node-calculated-indicator")).toContainText("Calculated");
      expect(calculateScenarioGraph(after, after.scenarios[0]!).rootValue).toBe(calculateScenarioGraph(before, before.scenarios[0]!).rootValue);
      expect(after.graph.nodes.find(node => node.name === "QA component A")).toMatchObject({ baselineValue: 40, valueStatus: "user_provided_value" });
      expect(after.graph.nodes.find(node => node.name === "QA component B")).toMatchObject({ baselineValue: 60, valueStatus: "calculated" });
      const saved = await (await page.request.get(`/api/vdt/vdts/${fixture.vdtId}`, { timeout: 60_000 })).json(); expect(saved.revisions).toHaveLength(initialLoad.revisions.length + 1); expect(saved.activeProject.graph.nodes).toHaveLength(after.graph.nodes.length);
      await page.reload(); await expect(page.getByTestId("vdt-canvas")).toBeVisible();
      const reopened = await readSmartBrowserProject(page); expect(reopened.graph.nodes).toHaveLength(after.graph.nodes.length);
      expect(reopened.versions.at(-1)?.name).toBe("Before incoming KPIs");
      const notice = await waitForSmartAddition(page);
      await notice.getByTestId("smart-kpi-undo").click(); await expect(notice).toHaveCount(0);
      const undone = await (await page.request.get(`/api/vdt/vdts/${fixture.vdtId}`, { timeout: 60_000 })).json(); expect(undone.revisions).toHaveLength(initialLoad.revisions.length + 2); expect(undone.activeProject.graph.nodes).toHaveLength(before.graph.nodes.length);
      await page.reload(); await expect(page.getByTestId("vdt-canvas")).toBeVisible(); expect((await readSmartBrowserProject(page)).graph.nodes).toHaveLength(before.graph.nodes.length);
    } finally { await fixture.cleanup(); }
  });

  test("@chromium lost save response survives reload and explicit Reconcile replays the committed immutable revision once", async ({ page }) => {
    test.setTimeout(180_000); const fixture = await createSmartBrowserFixture(page);
    const requests: unknown[] = []; let releaseReplay = () => {};
    const replayGate = new Promise<void>(resolve => { releaseReplay = resolve; });
    let markReplayStarted = () => {};
    const replayStarted = new Promise<void>(resolve => { markReplayStarted = resolve; });
    try {
      const initial = await (await page.request.get(`/api/vdt/vdts/${fixture.vdtId}`, { timeout: 60_000 })).json();
      await page.route(`**/api/vdt/vdts/${fixture.vdtId}/revisions`, async route => {
        if (route.request().method() !== "POST") { await route.continue(); return; }
        requests.push(route.request().postDataJSON());
        if (requests.length === 1) {
          // The real endpoint commits to SQLite. Only its HTTP reply is lost.
          const committed = await route.fetch(); expect(committed.ok(), await committed.text()).toBeTruthy();
          await route.abort("connectionfailed");
        } else {
          markReplayStarted(); await replayGate; await route.continue();
        }
      });
      let panel = await openSmartPanel(page); await expect(panel.getByTestId("smart-kpi-add-selected")).toBeEnabled();
      await panel.getByTestId("smart-kpi-add-selected").click(); await expect(panel.getByTestId("smart-kpi-reconcile")).toBeEnabled();
      const committed = await (await page.request.get(`/api/vdt/vdts/${fixture.vdtId}`, { timeout: 60_000 })).json();
      expect(committed.revisions).toHaveLength(initial.revisions.length + 1);
      const initialCount = fixture.project.graph.nodes.length;
      expect(committed.activeProject.graph.nodes).toHaveLength(initialCount + 2);
      expect((await readSmartBrowserProject(page)).graph.nodes).toHaveLength(initialCount);
      await page.reload(); await expect(page.getByTestId("vdt-canvas")).toBeVisible(); panel = await openSmartPanel(page);
      const reconcile = panel.getByTestId("smart-kpi-reconcile"); await expect(reconcile).toBeEnabled();
      await expect(panel.locator('[data-testid="smart-kpi-add-selected"]:not(:disabled)')).toHaveCount(0);
      await reconcile.click(); await replayStarted; await expect(reconcile).toBeDisabled(); await page.keyboard.press("Enter"); expect(requests).toHaveLength(2);
      releaseReplay(); const notice = await waitForSmartAddition(page);
      expect(requests[1]).toEqual(requests[0]); expect((await readSmartBrowserProject(page)).graph.nodes).toHaveLength(initialCount + 2);
      const reconciled = await (await page.request.get(`/api/vdt/vdts/${fixture.vdtId}`, { timeout: 60_000 })).json(); expect(reconciled.revisions).toHaveLength(initial.revisions.length + 1);
      await notice.getByTestId("smart-kpi-undo").click(); await expect(notice).toHaveCount(0);
      const undone = await (await page.request.get(`/api/vdt/vdts/${fixture.vdtId}`, { timeout: 60_000 })).json(); expect(undone.revisions).toHaveLength(initial.revisions.length + 2); expect(undone.activeProject.graph.nodes).toHaveLength(initialCount);
    } finally { releaseReplay(); await fixture.cleanup(); }
  });

  test("@chromium audited formula is the visible default with editable factors and honest missing data", async ({ page }) => {
    test.setTimeout(180_000); const fixture = await createSmartBrowserFixture(page, "recipe");
    try {
      const panel = await openSmartPanel(page); await expect(panel.getByTestId("smart-kpi-add-selected")).toBeEnabled();
      await expect(panel.getByRole("radio", { name: "Add as context" })).toHaveCount(0);
      for (const name of ["Working time", "Productivity"]) {
        await expect(panel.getByRole("checkbox", { name, exact: true })).toBeChecked(); await expect(panel.getByRole("checkbox", { name, exact: true })).toBeEnabled();
      }
      const before = await readSmartBrowserProject(page);
      await expect(panel.getByTestId("incoming-kpi-readable-formula")).toContainText("Working time");
      await expect(panel.getByTestId("incoming-kpi-readable-formula")).toContainText("Productivity");
      await panel.getByRole("checkbox", { name: "Use estimates", exact: true }).uncheck();
      await expect(panel.getByTestId("smart-kpi-add-selected")).toBeDisabled();
      await panel.getByRole("textbox", { name: "Value for Working time", exact: true }).fill("20");
      await expect(panel.getByRole("textbox", { name: "Value for Productivity", exact: true })).toHaveAttribute("placeholder", "5");
      await expect(panel.getByTestId("smart-kpi-add-selected")).toBeEnabled();
      await panel.getByTestId("smart-kpi-add-selected").click(); const notice = await waitForSmartAddition(page);
      const after = await readSmartBrowserProject(page);
      expect(after.graph.nodes.find(node => node.id === fixture.targetNodeId)?.formula).toBeTruthy();
      expect(calculateGraph(after).rootValue).toBe(100);
      expect(after.graph.nodes.find(node => node.name === "Productivity")).toMatchObject({ baselineValue: 5, valueStatus: "calculated" });
      await notice.getByTestId("smart-kpi-undo").click(); await expect(notice).toHaveCount(0);
      expect(calculateGraph(await readSmartBrowserProject(page)).rootValue).toBe(calculateGraph(before).rootValue);
    } finally { await fixture.cleanup(); }
  });

  test("@chromium explicit Suggested activation reveals the canvas preview from min/default/max zoom and on touch", async ({ page, browser, baseURL }) => {
    test.setTimeout(180_000); const fixture = await createSmartBrowserFixture(page);
    try {
      for (const zoom of [0.68, 0.34, 1.5]) {
        if (zoom !== .68) {
          const zoomControl = page.getByRole("button", { name: zoom === .34 ? "Zoom Out" : "Zoom In", exact: true });
          for (let i = 0; i < 12 && await zoomControl.isEnabled(); i++) await zoomControl.click({ timeout: 10_000 });
          await expect.poll(async () => page.locator(".react-flow__viewport").evaluate(element => Number((element as HTMLElement).style.transform.match(/scale\(([^)]+)\)/)?.[1]))).toBe(zoom);
        }
        await positionSmartRailAtEdge(page);
        await page.locator('.react-flow__node[data-id="measured_output"]').getByTestId("node-smart-kpi-suggestions").click();
        const panel = page.getByTestId("smart-kpi-panel");
        await expect(panel.getByTestId("smart-kpi-add-selected")).toBeInViewport();
        await expect(panel.getByTestId("smart-kpi-add-selected")).toBeEnabled();
        await expect(panel).toBeInViewport({ ratio: .98 });
        await page.screenshot({ path: `output/smart-kpi-formula-mixed/zoom-${zoom}.png`, fullPage: true }); await page.keyboard.press("Escape");
      }
    } finally { await fixture.cleanup(); }
    const touch = await browser.newContext({ baseURL: baseURL!, viewport: { width: 760, height: 950 }, hasTouch: true, isMobile: true });
    const touchPage = await touch.newPage(), mobile = await createSmartBrowserFixture(touchPage);
    try {
      const trigger = touchPage.locator('.react-flow__node[data-id="measured_output"]').getByTestId("node-smart-kpi-suggestions");
      await trigger.tap(); await expect(touchPage.getByTestId("smart-kpi-panel")).toBeVisible(); await expect(touchPage.getByTestId("smart-kpi-add-selected")).toBeEnabled();
      await expect(touchPage.getByTestId("smart-kpi-panel")).toBeInViewport({ ratio: .98 });
      await touchPage.screenshot({ path: "output/smart-kpi-formula-mixed/touch.png", fullPage: true });
    } finally { await mobile.cleanup(); await touch.close(); }
  });

  test("@chromium private-cache storage failure falls back to memory without blocking editing", async ({ page }) => {
    test.setTimeout(150_000);
    let releasePreparation = () => {};
    const rootPreparationGate = new Promise<void>(resolve => { releasePreparation = resolve; });
    await page.addInitScript(() => {
      const open = indexedDB.open.bind(indexedDB);
      indexedDB.open = (name, version) => { if (name === "vdt-smart-kpi-cache") throw new DOMException("QA private-cache policy", "SecurityError"); return open(name, version); };
    });
    const fixture = await createSmartBrowserFixture(page, "formula", 1, { rootPreparationGate });
    try {
      await expect.poll(() => fixture.calls.filter(context => context.targetNodeId === fixture.targetNodeId).length).toBe(1);
      const started = await page.evaluate(() => performance.now()); let panel = await openSmartPanel(page);
      await expect(panel).toHaveAttribute("data-state", "preparing");
      await expect(panel.getByTestId("smart-kpi-preparation-notice")).toContainText("Preparing suggestions");
      await expect(panel.locator('[data-testid="smart-kpi-add-selected"]:enabled')).toHaveCount(0);
      const statusVisibleMs = await page.evaluate(() => performance.now()) - started, released = await page.evaluate(() => performance.now());
      releasePreparation(); await expect(panel.getByTestId("smart-kpi-add-selected")).toBeEnabled();
      await writeFile("output/smart-kpi-formula-mixed/cold-preparation-fixture.json", JSON.stringify({ statusVisibleMs,
        controlsAfterReleaseMs: await page.evaluate(() => performance.now()) - released, preparation: "Controlled API fixture held before its first root response; no external model invocation or cold model latency claim.",
        browser: `Installed Google Chrome ${page.context().browser()?.version()}`, appMode: "development_web" }, null, 2));
      await page.keyboard.press("Escape");
      const count = fixture.calls.filter(context => context.targetNodeId === fixture.targetNodeId).length;
      panel = await openSmartPanel(page); await expect(panel.getByTestId("smart-kpi-add-selected")).toBeEnabled(); expect(fixture.calls.filter(context => context.targetNodeId === fixture.targetNodeId)).toHaveLength(count);
      await page.keyboard.press("Escape"); await page.reload(); panel = await openSmartPanel(page); await expect(panel.getByTestId("smart-kpi-add-selected")).toBeEnabled();
      expect(fixture.calls.filter(context => context.targetNodeId === fixture.targetNodeId).length).toBeGreaterThan(count);
      await page.keyboard.press("Escape"); const before = (await readSmartBrowserProject(page)).graph.nodes.length;
      await page.locator('.react-flow__node[data-id="measured_output"]').getByTestId("node-add-manual-incoming-kpi").click({ force: true });
      panel = page.getByTestId("smart-kpi-panel");
      await expect(panel.getByRole("textbox", { name: "KPI name", exact: true })).toBeFocused();
      expect((await readSmartBrowserProject(page)).graph.nodes).toHaveLength(before);
      await panel.getByRole("textbox", { name: "KPI name", exact: true }).fill("Own private KPI");
      await panel.getByRole("textbox", { name: "KPI unit", exact: true }).fill("t/month");
      await panel.getByRole("button", { name: "Insert Own private KPI (t/month)", exact: true }).click();
      await expect(panel.getByTestId("smart-kpi-add-selected")).toBeEnabled(); await panel.getByTestId("smart-kpi-add-selected").click();
      await expect.poll(async () => (await readSmartBrowserProject(page)).graph.nodes.length).toBe(before + 1);
    } finally { releasePreparation(); await fixture.cleanup(); }
  });
});
