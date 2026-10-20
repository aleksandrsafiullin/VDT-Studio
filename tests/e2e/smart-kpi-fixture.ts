import { randomUUID } from "node:crypto";
import { expect, type Page, type Request } from "@playwright/test";
import { createSmartKpiMeasuredFixture } from "../../packages/vdt-core/src/suggestions/fixtures";
import type { KpiSuggestionContext } from "../../packages/vdt-core/src/suggestions/types";
import type { KpiSuggestionModelOutput } from "../../packages/vdt-core/src/suggestions/model-output";
import type { VdtProject } from "../../packages/vdt-core/src/types";

export type SmartFixtureKind = "recipe" | "formula" | "contextual" | "independent";
export type SmartPreparationPhase = "startup" | "warmup" | "measurement" | "after-measurement";
export interface SmartPreparationRequest {
  targetNodeId: string; phase: SmartPreparationPhase; requestStartTime: number; observedAt: number; finishedAt?: number;
}
export interface SmartBrowserFixture {
  projectId: string; vdtId: string; targetNodeId: string; project: VdtProject; calls: KpiSuggestionContext[];
  preparationRequests: SmartPreparationRequest[]; setPreparationPhase(phase: SmartPreparationPhase): void;
  waitForPreparationIdle(): Promise<{ waitMs: number; quietMs: number; requestsAtEntry: number; requestsAtExit: number }>;
  cleanup(): Promise<void>;
}
export async function createSmartBrowserFixture(page: Page, kind: SmartFixtureKind = "formula", nodeCount = 1,
  options: { rootPreparationGate?: Promise<void>; configureExecution?: boolean; haulageTarget?: boolean } = {}): Promise<SmartBrowserFixture> {
  const suffix = randomUUID().replaceAll("-", ""), projectId = `project_smart_ui_${suffix}`, vdtId = `vdt_smart_ui_${suffix}`;
  const project = createSmartKpiMeasuredFixture(100); project.id = `legacy_graph_smart_${suffix}`;
  project.graph.nodes[0]!.assumptions = ["Time period: monthly"]; project.graph.nodes[0]!.position = { x: 0, y: 0 };
  let targetNodeId = project.rootNodeId;
  if (options.haulageTarget) {
    const root = project.graph.nodes[0]!;
    targetNodeId = "haulage_distance";
    project.graph.nodes.push({ ...root, id: targetNodeId, name: "Measured moving distance", type: "input", unit: "km/trip", baselineValue: 4,
      position: { x: 520, y: 0 }, dataMapping: { ...root.dataMapping!, unit: "km/trip" } });
    root.name = "Haulage distance output"; root.unit = "km/trip"; root.formula = targetNodeId;
    project.graph.edges.push({ id: "haulage_factor_edge", sourceNodeId: root.id, targetNodeId, relation: "formula_dependency", aiGenerated: false });
    project.scenarios[0]!.overrides = [{ nodeId: targetNodeId, value: 10 }];
  }
  for (let i = 1; i < nodeCount; i++) {
    project.graph.nodes.push({ id: `existing_${i}`, name: `Existing QA context ${i}`, type: "input", unit: "fraction", status: "accepted", valueStatus: "unknown", aiGenerated: false,
      position: { x: 600 + (i % 8) * 320, y: Math.floor(i / 8) * 180 }, createdAt: project.createdAt, updatedAt: project.updatedAt });
    project.graph.edges.push({ id: `existing_edge_${i}`, sourceNodeId: project.rootNodeId, targetNodeId: `existing_${i}`, relation: "contextual_influence", aiGenerated: false });
  }
  const calls: KpiSuggestionContext[] = [];
  const preparationRequests: SmartPreparationRequest[] = [];
  let phase: SmartPreparationPhase = "startup";
  const pending = new Set<Request>(), requests = new WeakMap<Request, SmartPreparationRequest>();
  const finished = (request: Request) => {
    const observation = requests.get(request);
    if (observation) { observation.requestStartTime = request.timing().startTime; observation.finishedAt = Date.now(); pending.delete(request); }
  };
  page.on("requestfinished", finished); page.on("requestfailed", finished);
  await page.route("**/api/ai/detect-clis**", route => route.fulfill({ json: { agents: [], modelsByAgent: {} } }));
  await page.route("**/api/ai/suggestions/cancel", route => route.fulfill({ json: { ok: true, requestId: route.request().postDataJSON().requestId, status: "cancelled", cleanupConfirmed: true } }));
  // Only read-only preparation is faked. VDT create/load/revision/Undo routes stay real.
  await page.route("**/api/ai/suggestions", async route => {
    const body = route.request().postDataJSON() as { input: { context: KpiSuggestionContext }; providerId: string; providerConfig: { model: string } };
    const request = route.request();
    const observation = { targetNodeId: body.input.context.targetNodeId, phase, requestStartTime: request.timing().startTime, observedAt: Date.now() };
    preparationRequests.push(observation); requests.set(request, observation); pending.add(request);
    expect(body.providerId).toBe("openai_compatible"); expect(body.providerConfig.model).toBeTruthy(); calls.push(body.input.context);
    const root = body.input.context.targetNodeId === targetNodeId;
    if (root && options.rootPreparationGate) await options.rootPreparationGate;
    const output: KpiSuggestionModelOutput = root ? { status: "ready", rationale: "Explicit fictitious QA semantic decision for this context.", limitations: ["Fictitious QA proposal; all new values remain unknown."], groups: [{
      id: "qa_alternative", title: kind === "recipe" ? "Productive time × productivity" : kind === "formula" ? "Measured components" : "Explanatory inputs", selectionMode: kind === "independent" || kind === "contextual" ? "independent" : "all",
      children: kind === "recipe" ? [
        { key: "working_time", conceptKey: "effective_working_time", name: "Working time", unit: "h/month", description: null, existingNodeId: null },
        { key: "productivity", conceptKey: "average_productivity", name: "Productivity", unit: "t/h", description: null, existingNodeId: null }
      ] : kind === "formula" ? [
        { key: "component_a", conceptKey: "qa_component_a", name: "QA component A", unit: body.input.context.target.unit!, description: null, existingNodeId: null },
        { key: "component_b", conceptKey: "qa_component_b", name: "QA component B", unit: body.input.context.target.unit!, description: null, existingNodeId: null }
      ] : [
        { key: "qa_availability", conceptKey: "qa_availability", name: "QA availability", unit: "fraction", description: null, existingNodeId: null },
        { key: "qa_supply", conceptKey: "qa_supply", name: "QA supply stability", unit: "fraction", description: null, existingNodeId: null }
      ], requiredKeys: kind === "independent" || kind === "contextual" ? [] : kind === "recipe" ? ["working_time", "productivity"] : ["component_a", "component_b"],
      recipeId: kind === "recipe" ? "production.time_rate" : null, formula: kind === "recipe" ? "working_time * productivity" : kind === "formula" ? "component_a + component_b" : null, limitations: []
    }] } : { status: "empty", rationale: "This QA target has no prepared immediate layer.", limitations: [], groups: [] };
    await route.fulfill({ json: { ok: true, result: output } });
  });
  const created = await page.request.post("/api/vdt/projects", { data: { id: projectId, name: "Disposable Smart KPI browser QA", industry: "QA" }, timeout: 120_000 });
  expect(created.ok(), await created.text()).toBeTruthy(); const { summary: { runtimeState } } = await created.json();
  const cleanup = async () => { const deleted = await page.request.delete(`/api/vdt/projects/${projectId}`, { timeout: 120_000, maxRetries: 2 }); expect([200, 404]).toContain(deleted.status());
    page.off("requestfinished", finished); page.off("requestfailed", finished); };
  try {
    const saved = await page.request.post(`/api/vdt/projects/${projectId}/vdts`, { timeout: 120_000, data: {
      schemaVersion: "create_vdt_with_initial_http_request.v1", idempotencyKey: `create:${vdtId}`, expectedRuntime: { schemaVersion: "project_runtime_cas.v1", runtimeGeneration: runtimeState.runtimeGeneration, generationVersion: runtimeState.generationVersion },
      vdt: { requestedVdtId: vdtId, name: project.name, rootKpi: project.graph.nodes[0]!.name, unit: project.graph.nodes[0]!.unit!, timePeriod: "monthly", status: "draft", metadata: null }, project
    } });
    expect(saved.ok(), await saved.text()).toBeTruthy();
    await page.goto(`/projects/${projectId}`, { timeout: 120_000 });
    await page.getByRole("button", { name: `Open ${project.name}`, exact: true }).click({ timeout: 45_000 });
    // Selecting the store precedes Next's query navigation. A transient editor
    // is not proof that a subsequent reload will address this VDT.
    await expect.poll(() => new URL(page.url()).searchParams.get("vdt"), { timeout: 120_000 }).toBe(vdtId);
    await expect(page.getByTestId("vdt-canvas")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(`.react-flow__node[data-id="${project.rootNodeId}"]`).getByTestId("node-incoming-actions")).toBeVisible();
    // Configure through the existing real Settings flow; real encrypted vault/CAS
    // persistence establishes the epoch used by the production Smart factory.
    if (options.configureExecution !== false) {
    await page.getByTestId("settings-button").click(); await page.getByTestId("execution-mode-tab-byok").click();
    await page.getByTestId("byok-protocol-openai").click(); await page.getByTestId("byok-gateway-none").click();
    if (await page.getByTestId("byok-model-select").count()) await page.getByTestId("byok-model-select").selectOption("__custom__");
    await page.getByTestId("byok-model-custom").fill("smart-kpi-fixture-model");
    await page.getByTestId("byok-api-key").fill("sk-smart-kpi-fictitious-no-provider");
    await expect(page.getByTestId("byok-api-key-storage-status")).toHaveAttribute("data-status", "saved");
    await page.getByRole("button", { name: "Close settings", exact: true }).click();
    }
    return { projectId, vdtId, targetNodeId, project, calls, preparationRequests, setPreparationPhase: next => { phase = next; },
      waitForPreparationIdle: async () => {
        const started = Date.now(), quietMs = 1000, requestsAtEntry = preparationRequests.length;
        let quietSince = started, lastCount = requestsAtEntry;
        await expect.poll(() => {
          if (pending.size || lastCount !== preparationRequests.length) { quietSince = Date.now(); lastCount = preparationRequests.length; return false; }
          return Date.now() - quietSince >= quietMs;
        }, { timeout: 20_000, intervals: [50] }).toBe(true);
        return { waitMs: Date.now() - started, quietMs, requestsAtEntry, requestsAtExit: preparationRequests.length };
      }, cleanup };
  } catch (error) { await cleanup(); throw error; }
}

export async function openSmartPanel(page: Page, rootId = "measured_output") {
  const rail = page.locator(`.react-flow__node[data-id="${rootId}"]`).getByTestId("node-incoming-actions");
  await page.mouse.move(12, 12); await rail.hover({ timeout: 10_000 }); const panel = page.getByTestId("smart-kpi-panel"); await expect(panel).toBeVisible(); return panel;
}
export async function readSmartBrowserProject(page: Page): Promise<VdtProject> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("vdt-studio-state")!).state.project as VdtProject);
}

/** Real blank-pane drags position the target beside the top/right canvas edge. */
export async function positionSmartRailAtEdge(page: Page) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const drag = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLElement>('[data-testid="vdt-canvas"]')!.getBoundingClientRect();
      const rail = document.querySelector<HTMLElement>('.react-flow__node[data-id="measured_output"] [data-testid="node-incoming-actions"]')!.getBoundingClientRect();
      const dx = canvas.right - 12 - rail.right, dy = canvas.top + 16 - rail.top;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return null;
      const candidates: { x: number; y: number; endX: number; endY: number; score: number }[] = [];
      for (const fractionX of [.05, .25, .5, .75, .95]) for (const fractionY of [.08, .35, .65, .92]) {
        const x = canvas.left + canvas.width * fractionX, y = canvas.top + canvas.height * fractionY, hit = document.elementFromPoint(x, y);
        if (!hit?.closest(".react-flow__pane") || hit.closest(".react-flow__node, .react-flow__panel")) continue;
        const endX = Math.max(canvas.left + 8, Math.min(canvas.right - 8, x + dx));
        const endY = Math.max(canvas.top + 8, Math.min(canvas.bottom - 8, y + dy));
        candidates.push({ x, y, endX, endY, score: Math.abs(endX - x) + Math.abs(endY - y) });
      }
      return candidates.sort((a, b) => b.score - a.score)[0] ?? { x: 0, y: 0, endX: 0, endY: 0, score: 0 };
    });
    if (!drag) return;
    expect(drag.score, "A real blank canvas drag must be available").toBeGreaterThan(2);
    await page.mouse.move(drag.x, drag.y); await page.mouse.down(); await page.mouse.move(drag.endX, drag.endY, { steps: 8 }); await page.mouse.up();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  }
  throw new Error("The target rail could not be positioned at the actual canvas edge with bounded real panning.");
}
