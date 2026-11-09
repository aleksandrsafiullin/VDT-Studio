import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, platform, totalmem } from "node:os";
import { expect, test } from "@playwright/test";
import { createSmartBrowserFixture, openSmartPanel, positionSmartRailAtEdge } from "./smart-kpi-fixture";

// Keep canvas snapshots out of timed renders while retaining action traces.
test.use({ trace: { mode: "retain-on-failure", snapshots: false, screenshots: false, sources: false } });

const warmPosition = process.env.VDT_SMART_E2E_EDGE === "1" ? "zoomed-edge" : "normal";

test.describe("Smart KPI warm cache timing", () => {
  for (const nodeCount of [2, 200]) for (const source of ["recipe", "formula"] as const) {
    test(`@chromium warm ${source === "recipe" ? "recipe-backed" : "model formula"} cache controls ${nodeCount} nodes ${warmPosition} p95 within 1 second`, async ({ page }) => {
      test.setTimeout(300_000); const fixture = await createSmartBrowserFixture(page, source, nodeCount);
      try {
        const coldStatusStarted = Date.now();
        const coldStatus = await page.request.get("/api/agent/research/status", { timeout: 120_000, maxRetries: 1 });
        const startupReadOnlyStatus = { path: "/api/agent/research/status", status: coldStatus.status(), waitMs: Date.now() - coldStatusStarted,
          measurement: "Read-only route readiness before warmup and thirty timed activations" };
        expect(coldStatus.ok()).toBe(true);
        fixture.setPreparationPhase("warmup");
        let panel = await openSmartPanel(page); await expect(panel.getByTestId("smart-kpi-add-selected")).toBeEnabled(); await page.keyboard.press("Escape");
        const targetRequests = () => fixture.calls.filter(context => context.targetNodeId === fixture.targetNodeId);
        expect(targetRequests().at(-1)?.selectedSkill).toBeDefined();
        const beforeReload = targetRequests().length;
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
        await expect(panel).toHaveAttribute("data-state", "ready"); await page.keyboard.press("Escape");
        const targetRequestsDuringReload = targetRequests().length - beforeReload;
        if (warmPosition === "zoomed-edge") {
          const zoomIn = page.getByRole("button", { name: "Zoom In", exact: true });
          for (let i = 0; i < 12 && await zoomIn.isEnabled(); i++) await zoomIn.click();
          await positionSmartRailAtEdge(page);
        }
        await expect(page.getByTestId("smart-kpi-panel")).toHaveCount(0);
        const startupQuiescence = await fixture.waitForPreparationIdle();
        const allCallsBefore = fixture.calls.length;
        const callsBefore = fixture.calls.filter(context => context.targetNodeId === fixture.targetNodeId).length, samples: number[] = [];
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
          const rootCallsAfter = fixture.calls.filter(context => context.targetNodeId === fixture.targetNodeId).length, allCallsAfter = fixture.calls.length;
          const requestsStartedInWindow = fixture.preparationRequests.filter(request => request.requestStartTime >= measurementStartEpochMs && request.requestStartTime <= measurementEndEpochMs);
          const unknownStartsObservedInWindow = fixture.preparationRequests.filter(request => request.requestStartTime <= 0 && request.observedAt >= measurementStartEpochMs && request.observedAt <= measurementEndEpochMs);
          const record = { qualified: browserEndClockAvailable && samples.length === 30 && p95 !== undefined && p95 <= 1000 && rootCallsAfter === callsBefore && allCallsAfter === allCallsBefore
              && !requestsStartedInWindow.length && !unknownStartsObservedInWindow.length,
            run: process.env.VDT_SMART_E2E_RUN, source: source === "recipe" ? "Warm recipe-backed model proposal" : "Warm model formula proposal",
            nodeCount, position: warmPosition, requestedSamples: 30, samples, p50: sorted[Math.ceil(sorted.length * .5) - 1], p95, worst: sorted.at(-1),
            warmupRefreshes, startupTransitions, targetRequestsDuringReload, startupReadyStabilityMs: 650, startupReadOnlyStatus, startupQuiescence, afterMeasurementQuiescence,
            measurementStartEpochMs, measurementEndEpochMs, browserEndClockAvailable, boundaryClock: "browser performance.timeOrigin + performance.now; epoch milliseconds",
            requests: fixture.preparationRequests, requestsStartedInWindow, unknownStartsObservedInWindow, neutralResets,
            counters: { rootBefore: callsBefore, rootAfter: rootCallsAfter, allBefore: allCallsBefore, allAfter: allCallsAfter },
            rootProviderCallsDuringMeasurement: rootCallsAfter - callsBefore, allProviderCallsDuringMeasurement: allCallsAfter - allCallsBefore,
            machine, browser: `${page.context().browser()?.browserType().name()} ${page.context().browser()?.version()}`, appMode: "development_web",
            traceMode: "Actions-only trace; explicit safe fixture request recorder supplies request evidence. No inference from empty trace.network.",
            measurement: "Browser performance.now from real pointerenter to visible enabled Add control, sampled on animation frames", caseTimeoutMs: 300_000, warmControlWatchdogMs: 5_000,
            configuredProvider: "API preparation fixture; no external model invocation" };
          evidence = record;
          await mkdir("output/smart-kpi-formula-mixed", { recursive: true });
          // Always retain complete samples and counters before any final assertions.
          await writeFile(`${artifact}.${process.env.VDT_SMART_E2E_RUN ?? Date.now()}.json`, JSON.stringify(record, null, 2));
          if (record.qualified) await writeFile(`${artifact}.json`, JSON.stringify(record, null, 2));
        }
        expect(fixture.calls.filter(context => context.targetNodeId === fixture.targetNodeId).length).toBe(callsBefore);
        expect(fixture.calls.length).toBe(allCallsBefore);
        expect(evidence?.p95).toBeLessThanOrEqual(1000); expect(evidence?.qualified).toBe(true);
        await openSmartPanel(page); await page.screenshot({ path: `${artifact}.png`, fullPage: true });
      } finally { await fixture.cleanup(); }
    });
  }
});
