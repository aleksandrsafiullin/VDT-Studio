import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, platform, totalmem } from "node:os";
import { expect, test } from "@playwright/test";
import { calculateGraph } from "../../packages/vdt-core/src/formula/calculate";
import { calculateScenarioGraph } from "../../packages/vdt-core/src/scenario/scenario";
import { createSmartBrowserFixture, openSmartPanel, positionSmartRailAtEdge, readSmartBrowserProject } from "./smart-kpi-fixture";

const warmPosition = process.env.VDT_SMART_E2E_EDGE === "1" ? "zoomed-edge" : "normal";

test.describe("Smart KPI same-hover integration", () => {
  test.beforeAll(async () => { await mkdir("output/smart-kpi-formula-mixed", { recursive: true }); });
  test("@chromium same hover keeps all actions, pointer bridge, native keyboard focus and canvas geometry", async ({ page }) => {
    test.setTimeout(150_000);
    const fixture = await createSmartBrowserFixture(page, "formula");
    try {
      const panel = await openSmartPanel(page); await expect(panel.getByLabel("QA component A", { exact: true })).toBeEnabled();
      const root = page.locator('.react-flow__node[data-id="measured_output"]'), rail = root.getByTestId("node-incoming-actions");
      await expect(root.locator('.react-flow__handle.source')).toBeVisible();
      for (const id of ["node-add-manual-incoming-kpi", "node-add-ai-incoming-kpis", "node-add-file-incoming-kpis"]) await expect(rail.getByTestId(id)).toBeVisible();
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
      const panel = await openSmartPanel(page); const availability = panel.getByLabel("QA component A", { exact: true }); await availability.uncheck();
      const bounds = (await panel.boundingBox())!; await page.mouse.move(bounds.x + 20, bounds.y + 20);
      await page.getByTestId("right-panel").getByLabel("Name", { exact: true }).fill("Changed QA semantic target");
      await expect(panel).toContainText("The KPI changed"); await expect(availability).not.toBeChecked(); await expect(panel.getByTestId("smart-kpi-add-selected")).toBeDisabled();
      await panel.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect(availability).not.toBeChecked();
      await panel.getByRole("button", { name: "Review latest", exact: true }).click(); await expect(panel).toContainText("Changed QA semantic target");
      await expect(panel.getByLabel("QA component A", { exact: true })).toBeChecked();
    } finally { await fixture.cleanup(); }
  });

  test("@chromium formula Add saves once through real revisions, derives the root, retains source/scenario, reloads and Undo creates a revision", async ({ page }) => {
    test.setTimeout(180_000); const fixture = await createSmartBrowserFixture(page, "formula");
    try {
      const panel = await openSmartPanel(page); await expect(panel.getByTestId("smart-kpi-add-selected")).toBeEnabled();
      const before = await readSmartBrowserProject(page), initialLoad = await (await page.request.get(`/api/vdt/vdts/${fixture.vdtId}`, { timeout: 60_000 })).json();
      const requests: unknown[] = []; page.on("request", request => { if (new URL(request.url()).pathname === `/api/vdt/vdts/${fixture.vdtId}/revisions` && request.method() === "POST") requests.push(request.postDataJSON()); });
      await panel.getByTestId("smart-kpi-add-selected").click(); await expect(panel.getByTestId("smart-kpi-feedback")).toContainText("2 KPIs added and saved", { timeout: 30_000 });
      const after = await readSmartBrowserProject(page); expect(after.graph.nodes).toHaveLength(before.graph.nodes.length + 2); expect(requests).toHaveLength(1);
      expect(calculateGraph(after).rootValue).toBeUndefined();
      expect(after.graph.nodes[0]!.type).toBe("root_kpi");
      expect(after.graph.nodes[0]!.baselineValue).toBe(before.graph.nodes[0]!.baselineValue);
      await expect(page.getByTestId("node-calculated-indicator")).toContainText("Calculated");
      expect(calculateScenarioGraph(after, after.scenarios[0]!).rootValue).toBe(calculateScenarioGraph(before, before.scenarios[0]!).rootValue);
      expect(after.graph.nodes[0]!.dataMapping).toEqual(before.graph.nodes[0]!.dataMapping); expect(after.graph.nodes.slice(-2).every(node => node.baselineValue === undefined && node.value === undefined && node.valueStatus === "unknown")).toBe(true);
      const saved = await (await page.request.get(`/api/vdt/vdts/${fixture.vdtId}`, { timeout: 60_000 })).json(); expect(saved.revisions).toHaveLength(initialLoad.revisions.length + 1); expect(saved.activeProject.graph.nodes).toHaveLength(after.graph.nodes.length);
      await page.reload(); await expect(page.getByTestId("vdt-canvas")).toBeVisible();
      const reopened = await readSmartBrowserProject(page); expect(reopened.graph.nodes).toHaveLength(after.graph.nodes.length);
      expect(reopened.versions.at(-1)?.name).toBe("Before incoming KPIs");
      const reopenedPanel = await openSmartPanel(page); await expect(reopenedPanel.getByTestId("smart-kpi-undo")).toBeEnabled();
      await reopenedPanel.getByTestId("smart-kpi-undo").click(); await expect(reopenedPanel.getByTestId("smart-kpi-feedback")).toContainText("undone");
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
      expect(committed.revisions).toHaveLength(initial.revisions.length + 1); expect(committed.activeProject.graph.nodes).toHaveLength(3);
      expect((await readSmartBrowserProject(page)).graph.nodes).toHaveLength(1);
      await page.reload(); await expect(page.getByTestId("vdt-canvas")).toBeVisible(); panel = await openSmartPanel(page);
      const reconcile = panel.getByTestId("smart-kpi-reconcile"); await expect(reconcile).toBeEnabled();
      await expect(panel.locator('[data-testid="smart-kpi-add-selected"]:not(:disabled)')).toHaveCount(0);
      await reconcile.click(); await replayStarted; await expect(reconcile).toBeDisabled(); await page.keyboard.press("Enter"); expect(requests).toHaveLength(2);
      releaseReplay(); await expect(panel.getByTestId("smart-kpi-undo")).toBeEnabled();
      expect(requests[1]).toEqual(requests[0]); expect((await readSmartBrowserProject(page)).graph.nodes).toHaveLength(3);
      const reconciled = await (await page.request.get(`/api/vdt/vdts/${fixture.vdtId}`, { timeout: 60_000 })).json(); expect(reconciled.revisions).toHaveLength(initial.revisions.length + 1);
      await panel.getByTestId("smart-kpi-undo").click(); await expect(panel.getByTestId("smart-kpi-feedback")).toContainText("undone");
      const undone = await (await page.request.get(`/api/vdt/vdts/${fixture.vdtId}`, { timeout: 60_000 })).json(); expect(undone.revisions).toHaveLength(initial.revisions.length + 2); expect(undone.activeProject.graph.nodes).toHaveLength(1);
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
      await expect(panel).toContainText("Result appears after input values.");
      await panel.getByTestId("smart-kpi-add-selected").click(); await expect(panel.getByTestId("smart-kpi-feedback")).toContainText("2 KPIs added and saved");
      const after = await readSmartBrowserProject(page); expect(after.graph.nodes[0]!.formula).toBeTruthy(); expect(calculateGraph(after).rootValue).toBeUndefined();
      expect(after.graph.nodes.slice(-2).every(node => node.baselineValue === undefined && node.value === undefined && node.valueStatus === "unknown")).toBe(true);
      await panel.getByTestId("smart-kpi-undo").click(); await expect(panel.getByTestId("smart-kpi-feedback")).toContainText("undone");
      expect(calculateGraph(await readSmartBrowserProject(page)).rootValue).toBe(calculateGraph(before).rootValue);
    } finally { await fixture.cleanup(); }
  });

  test("@chromium portal stays within viewport at min/default/max zoom and a touch trigger opens it", async ({ page, browser }) => {
    test.setTimeout(180_000); const fixture = await createSmartBrowserFixture(page);
    try {
      for (const zoom of [0.68, 0.34, 1.5]) {
        if (zoom !== .68) {
          const zoomControl = page.getByRole("button", { name: zoom === .34 ? "Zoom Out" : "Zoom In", exact: true });
          for (let i = 0; i < 12 && await zoomControl.isEnabled(); i++) await zoomControl.click({ timeout: 10_000 });
          // A one-node fit at maximum zoom centers this target while retaining
          // the real configured 1.5 limit, instead of hovering an offscreen rail.
          if (zoom === 1.5) await page.getByRole("button", { name: "Fit View", exact: true }).click();
          await expect.poll(async () => page.locator(".react-flow__viewport").evaluate(element => Number((element as HTMLElement).style.transform.match(/scale\(([^)]+)\)/)?.[1]))).toBe(zoom);
        }
        await positionSmartRailAtEdge(page);
        const panel = await openSmartPanel(page); await expect(panel.getByTestId("smart-kpi-add-selected")).toBeEnabled();
        const rect = (await panel.boundingBox())!, viewport = page.viewportSize()!;
        expect(rect.x).toBeGreaterThanOrEqual(8); expect(rect.y).toBeGreaterThanOrEqual(8); expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width - 8); expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height - 8);
        await page.screenshot({ path: `output/smart-kpi-formula-mixed/zoom-${zoom}.png`, fullPage: true }); await page.keyboard.press("Escape");
      }
    } finally { await fixture.cleanup(); }
    const touch = await browser.newContext({ baseURL: "http://127.0.0.1:3100", viewport: { width: 760, height: 950 }, hasTouch: true, isMobile: true });
    const touchPage = await touch.newPage(), mobile = await createSmartBrowserFixture(touchPage);
    try {
      const trigger = touchPage.locator('.react-flow__node[data-id="measured_output"]').getByTestId("node-smart-kpi-suggestions");
      await trigger.tap(); await expect(touchPage.getByTestId("smart-kpi-panel")).toBeVisible(); await expect(touchPage.getByTestId("smart-kpi-add-selected")).toBeEnabled();
      const rect = (await touchPage.getByTestId("smart-kpi-panel").boundingBox())!; expect(rect.x).toBeGreaterThanOrEqual(8); expect(rect.x + rect.width).toBeLessThanOrEqual(752);
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
      await expect.poll(() => fixture.calls.filter(context => context.targetNodeId === fixture.project.rootNodeId).length).toBe(1);
      const started = await page.evaluate(() => performance.now()); let panel = await openSmartPanel(page);
      await expect(panel).toHaveAttribute("data-state", "preparing"); await expect(panel.getByTestId("smart-kpi-add-selected")).toBeDisabled();
      await expect(panel.getByTestId("incoming-kpi-own-row")).toBeEnabled();
      const statusVisibleMs = await page.evaluate(() => performance.now()) - started, released = await page.evaluate(() => performance.now());
      releasePreparation(); await expect(panel.getByTestId("smart-kpi-add-selected")).toBeEnabled();
      await writeFile("output/smart-kpi-formula-mixed/cold-preparation-fixture.json", JSON.stringify({ statusVisibleMs,
        controlsAfterReleaseMs: await page.evaluate(() => performance.now()) - released, preparation: "Controlled API fixture held before its first root response; no external model invocation or cold model latency claim.",
        browser: `Installed Google Chrome ${page.context().browser()?.version()}`, appMode: "development_web" }, null, 2));
      await page.keyboard.press("Escape");
      const count = fixture.calls.filter(context => context.targetNodeId === fixture.project.rootNodeId).length;
      panel = await openSmartPanel(page); await expect(panel.getByTestId("smart-kpi-add-selected")).toBeEnabled(); expect(fixture.calls.filter(context => context.targetNodeId === fixture.project.rootNodeId)).toHaveLength(count);
      await page.keyboard.press("Escape"); await page.reload(); panel = await openSmartPanel(page); await expect(panel.getByTestId("smart-kpi-add-selected")).toBeEnabled();
      expect(fixture.calls.filter(context => context.targetNodeId === fixture.project.rootNodeId).length).toBeGreaterThan(count);
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

  for (const nodeCount of [1, 200]) for (const source of ["recipe", "formula"] as const) {
    test(`@chromium warm ${source === "recipe" ? "Library" : "persisted cache"} controls ${nodeCount} nodes ${warmPosition} p95 within 1 second`, async ({ page }) => {
      test.setTimeout(300_000); const fixture = await createSmartBrowserFixture(page, source, nodeCount);
      try {
        const coldStatusStarted = Date.now();
        const coldStatus = await page.request.get("/api/agent/research/status", { timeout: 120_000 });
        const startupReadOnlyStatus = { path: "/api/agent/research/status", status: coldStatus.status(), waitMs: Date.now() - coldStatusStarted,
          measurement: "Read-only dev-route readiness before warmup and thirty timed activations" };
        expect(coldStatus.ok()).toBe(true);
        fixture.setPreparationPhase("warmup");
        let panel = await openSmartPanel(page); await expect(panel.getByTestId("smart-kpi-add-selected")).toBeEnabled(); await page.keyboard.press("Escape");
        await page.reload(); await expect(page.getByTestId("vdt-canvas")).toBeVisible();
        panel = await openSmartPanel(page);
        let warmupRefreshes = 0, stableSince: number | undefined;
        const startupTransitions: string[] = [];
        await expect.poll(async () => {
          if (await panel.getAttribute("data-state") === "stale") {
            const selected = await panel.locator('input[type="checkbox"]').evaluateAll(inputs => inputs.map(input => ({ name: (input as HTMLInputElement).ariaLabel, checked: (input as HTMLInputElement).checked })));
            await expect(panel.getByTestId("smart-kpi-add-selected")).toBeDisabled();
            expect(selected.every(input => input.checked), "The displayed required factor selection stays frozen during startup admission").toBe(true);
            startupTransitions.push("Initial passive vault/backend admission changed none→admitted execution; the frozen list stayed visible and Add was disabled until explicit warmup Refresh.");
            expect(++warmupRefreshes).toBeLessThanOrEqual(2);
            await panel.getByRole("button", { name: "Refresh", exact: true }).click(); stableSince = undefined; return false;
          }
          if (!await panel.getByTestId("smart-kpi-add-selected").isEnabled()) { stableSince = undefined; return false; }
          stableSince ??= Date.now(); return Date.now() - stableSince >= 650;
        }, { timeout: 10_000, intervals: [50] }).toBe(true);
        await expect(panel).toContainText(source === "recipe" ? "Library" : "Prepared"); await page.keyboard.press("Escape");
        if (warmPosition === "zoomed-edge") {
          const zoomIn = page.getByRole("button", { name: "Zoom In", exact: true });
          for (let i = 0; i < 12 && await zoomIn.isEnabled(); i++) await zoomIn.click();
          await positionSmartRailAtEdge(page);
        }
        await expect(page.getByTestId("smart-kpi-panel")).toHaveCount(0);
        const startupQuiescence = await fixture.waitForPreparationIdle();
        const allCallsBefore = fixture.calls.length;
        const callsBefore = fixture.calls.filter(context => context.targetNodeId === fixture.project.rootNodeId).length, samples: number[] = [];
        const artifact = `output/smart-kpi-formula-mixed/warm-${source}-${nodeCount}${warmPosition === "normal" ? "" : "-zoomed-edge"}`;
        const machine = { platform: platform(), arch: arch(), cpu: cpus()[0]?.model, totalMemoryGiB: totalmem() / 2 ** 30 };
        const neutralResets: { sample: number; atEpochMs: number; nodeAtPointer: string | null; panelTarget: string | null; elementTag: string | null; elementTestId: string | null }[] = [];
        fixture.setPreparationPhase("measurement");
        const measurementStartEpochMs = await page.evaluate(() => performance.timeOrigin + performance.now());
        let evidence: { p95: number | undefined; qualified: boolean } | undefined;
        try {
        for (let i = 0; i < 30; i++) {
          await page.mouse.move(12, 12);
          const reset = await page.evaluate(() => {
            const element = document.elementFromPoint(12, 12);
            return { atEpochMs: performance.timeOrigin + performance.now(), nodeAtPointer: element?.closest(".react-flow__node")?.getAttribute("data-id") ?? null,
              panelTarget: document.querySelector('[data-testid="smart-kpi-panel"]')?.getAttribute("data-target-node-id") ?? null,
              elementTag: element?.tagName ?? null, elementTestId: element?.getAttribute("data-testid") ?? null };
          });
          neutralResets.push({ sample: i + 1, ...reset });
          expect(reset.nodeAtPointer, "The neutral reset must not hover a different cold KPI").toBeNull();
          expect(reset.panelTarget, "The previous panel must be closed before a fresh activation").toBeNull();
          await page.evaluate(() => {
            const measurement = new Promise<number>((resolve, reject) => {
            const activationDeadline = setTimeout(() => reject(new Error("The real pointerenter activation was not observed within ten seconds.")), 10_000);
            const rail = document.querySelector<HTMLElement>('.react-flow__node[data-id="measured_output"] [data-testid="node-incoming-actions"]')!;
            rail.addEventListener("pointerenter", () => {
              clearTimeout(activationDeadline);
              const started = performance.now();
              const deadline = setTimeout(() => reject(new Error("The real hover activation did not produce usable controls within five seconds.")), 5000);
              const check = () => {
                const button = document.querySelector<HTMLButtonElement>('[data-testid="smart-kpi-add-selected"]'), panel = document.querySelector<HTMLElement>('[data-testid="smart-kpi-panel"]');
                if (button && !button.disabled && button.getBoundingClientRect().width > 0 && panel && getComputedStyle(panel).visibility === "visible") { clearTimeout(deadline); resolve(performance.now() - started); }
                else if (performance.now() - started > 5000) resolve(5000); else requestAnimationFrame(check);
              }; requestAnimationFrame(check);
            }, { once: true });
            });
            measurement.catch(() => {}); Object.assign(window, { smartActivationMeasurement: measurement });
          });
          await page.locator('.react-flow__node[data-id="measured_output"]').getByTestId("node-incoming-actions").hover();
          await expect(page.getByTestId("smart-kpi-add-selected")).toBeVisible(); await expect(page.getByTestId("smart-kpi-add-selected")).toBeEnabled();
          samples.push(await page.evaluate(() => Reflect.get(window, "smartActivationMeasurement") as Promise<number>)); await page.keyboard.press("Escape"); await expect(page.getByTestId("smart-kpi-panel")).toHaveCount(0);
        }
        } finally {
          let browserEndClockAvailable = true;
          const measurementEndEpochMs = await page.evaluate(() => performance.timeOrigin + performance.now()).catch(() => { browserEndClockAvailable = false; return Date.now(); });
          fixture.setPreparationPhase("after-measurement");
          const afterMeasurementQuiescence = await fixture.waitForPreparationIdle().catch(() => undefined);
          const sorted = [...samples].sort((a, b) => a - b), p95 = sorted[Math.ceil(sorted.length * .95) - 1];
          const rootCallsAfter = fixture.calls.filter(context => context.targetNodeId === fixture.project.rootNodeId).length, allCallsAfter = fixture.calls.length;
          const requestsStartedInWindow = fixture.preparationRequests.filter(request => request.requestStartTime >= measurementStartEpochMs && request.requestStartTime <= measurementEndEpochMs);
          const unknownStartsObservedInWindow = fixture.preparationRequests.filter(request => request.requestStartTime <= 0 && request.observedAt >= measurementStartEpochMs && request.observedAt <= measurementEndEpochMs);
          const record = { qualified: browserEndClockAvailable && samples.length === 30 && p95 !== undefined && p95 <= 1000 && rootCallsAfter === callsBefore && allCallsAfter === allCallsBefore
              && !requestsStartedInWindow.length && !unknownStartsObservedInWindow.length,
            run: process.env.VDT_SMART_E2E_RUN, source: source === "recipe" ? "Library from real model-selected decision recorder" : "IndexedDB persisted model proposal",
            nodeCount, position: warmPosition, requestedSamples: 30, samples, p50: sorted[Math.ceil(sorted.length * .5) - 1], p95, worst: sorted.at(-1),
            warmupRefreshes, startupTransitions, startupReadyStabilityMs: 650, startupReadOnlyStatus, startupQuiescence, afterMeasurementQuiescence,
            measurementStartEpochMs, measurementEndEpochMs, browserEndClockAvailable, boundaryClock: "browser performance.timeOrigin + performance.now; epoch milliseconds",
            requests: fixture.preparationRequests, requestsStartedInWindow, unknownStartsObservedInWindow, neutralResets,
            counters: { rootBefore: callsBefore, rootAfter: rootCallsAfter, allBefore: allCallsBefore, allAfter: allCallsAfter },
            rootProviderCallsDuringMeasurement: rootCallsAfter - callsBefore, allProviderCallsDuringMeasurement: allCallsAfter - allCallsBefore,
            machine, browser: `Installed Google Chrome ${page.context().browser()?.version()}`, appMode: "development_web",
            traceMode: "Actions-only trace; explicit safe fixture request recorder supplies request evidence. No inference from empty trace.network.",
            measurement: "Browser performance.now from real pointerenter to visible enabled Add control, sampled on animation frames", caseTimeoutMs: 300_000, warmControlWatchdogMs: 5_000,
            configuredProvider: "API preparation fixture; no external model invocation" };
          evidence = record;
          await mkdir("output/smart-kpi-formula-mixed", { recursive: true });
          // Always retain complete samples and counters before any final assertions.
          await writeFile(`${artifact}.${process.env.VDT_SMART_E2E_RUN ?? Date.now()}.json`, JSON.stringify(record, null, 2));
          if (record.qualified) await writeFile(`${artifact}.json`, JSON.stringify(record, null, 2));
        }
        expect(fixture.calls.filter(context => context.targetNodeId === fixture.project.rootNodeId).length).toBe(callsBefore);
        expect(fixture.calls.length).toBe(allCallsBefore);
        expect(evidence?.p95).toBeLessThanOrEqual(1000); expect(evidence?.qualified).toBe(true);
        await openSmartPanel(page); await page.screenshot({ path: `${artifact}.png`, fullPage: true });
      } finally { await fixture.cleanup(); }
    });
  }
});
