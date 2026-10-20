import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildKpiSuggestionContext, buildRecipeKpiSuggestions, fingerprintKpiProject,
  KPI_SUGGESTION_RECIPES as catalog, KPI_SUGGESTION_SCHEMA, KPI_SUGGESTION_VALIDATOR,
  type KpiSuggestionContext, type KpiSuggestionExecutionIdentity, type KpiSuggestionSet
} from "@vdt-studio/vdt-core";
import { createSmartKpiMeasuredFixture } from "../../../packages/vdt-core/src/suggestions/fixtures";
import { SmartKpiCache } from "./smart-kpi-cache";
import { confirmSmartKpiTerminalCleanup, SmartKpiScheduler, type SmartKpiPreparationResult, type SmartKpiWorkspace } from "./smart-kpi-scheduler";

const now = Date.parse("2026-10-19T00:00:00.000Z");
const execution: KpiSuggestionExecutionIdentity = { mode: "api", backendId: "fixture", modelId: "fixture-model", bindingVersion: "v1", credentialEpoch: "epoch1" };
let workspaceSequence = 0;
const schedulers: SmartKpiScheduler[] = [];
afterEach(() => { for (const scheduler of schedulers.splice(0)) scheduler.dispose(); });
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function workspace(children = 0): SmartKpiWorkspace {
  const project = createSmartKpiMeasuredFixture();
  for (let i = 0; i < children; i++) {
    project.graph.nodes.push({ id: `child_${i}`, name: `Fixture ${i}`, unit: "fraction", type: "input", status: "accepted", aiGenerated: false, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() });
    project.graph.edges.push({ id: `edge_${i}`, sourceNodeId: project.rootNodeId, targetNodeId: `child_${i}`, relation: "contextual_influence", aiGenerated: false });
  }
  return { workspaceId: `scheduler_fixture_${++workspaceSequence}`, project, vdtId: "saved_vdt", period: { key: "2026-10", grain: "month" }, execution };
}
function proposal(context: KpiSuggestionContext, exec = execution, id = "proposal"): KpiSuggestionSet {
  return { schemaVersion: KPI_SUGGESTION_SCHEMA, validatorVersion: KPI_SUGGESTION_VALIDATOR, catalogVersion: catalog.version,
    proposalId: id, targetNodeId: context.targetNodeId, contextHash: context.contextHash,
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 86400_000).toISOString(),
    origin: { kind: "model", requestId: "request_fixture", execution: exec }, rationale: "QA independent explanatory child.", limitations: [],
    groups: [{ id: "context", title: "Explanatory inputs", selectionMode: "independent", requiredKeys: [], limitations: [],
      children: [{ key: "availability", conceptKey: "availability", name: "Availability", unit: "fraction" }] }] };
}
function local(context: KpiSuggestionContext): KpiSuggestionSet | undefined {
  const recipe = catalog.recipes.find(r => r.id === "production.time_rate")!;
  return buildRecipeKpiSuggestions(context, [{ binding: { id: "decision", recipeId: recipe.id, recipeHash: recipe.recipeHash, skillHash: recipe.skillHash,
    targetRole: recipe.targetRole, contextHash: context.contextHash, basis: "selected_skill", sourceRef: "qa_selection", rationale: "QA explicit applicability." } }], { now: new Date(now).toISOString(), proposalId: "local_recipe" });
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject };
}
function controlled() {
  const calls: Array<{ context: KpiSuggestionContext; execution: KpiSuggestionExecutionIdentity; signal: AbortSignal; result: ReturnType<typeof deferred<SmartKpiPreparationResult>> }> = [];
  let concurrent = 0, maxConcurrent = 0;
  const prepare = vi.fn(async (input: { context: KpiSuggestionContext; execution: KpiSuggestionExecutionIdentity; signal: AbortSignal }) => {
    concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent); const result = deferred<SmartKpiPreparationResult>(); calls.push({ ...input, result });
    try { return await result.promise; } finally { concurrent--; }
  });
  return { calls, prepare, maxConcurrent: () => maxConcurrent, resolve: (i: number, id = `proposal_${i}`) => { const call = calls[i]!; call.result.resolve(proposal(call.context, call.execution, id)); } };
}
function create(options: ConstructorParameters<typeof SmartKpiScheduler>[0]): SmartKpiScheduler {
  const scheduler = new SmartKpiScheduler({ cache: new SmartKpiCache({ storage: null, now: () => now }), now: () => now, ...options }); schedulers.push(scheduler); return scheduler;
}

describe("Smart KPI bounded scheduling", () => {
  it("deduplicates full keys and runs hover, selected, new-child then visible with exactly one callback at a time", async () => {
    const w = workspace(4), transport = controlled(), s = create({ prepare: transport.prepare }); await s.setWorkspace(w); s.setFullAgentActive(true);
    await s.request("child_0", { priority: "visible" }); await s.request("child_1", { priority: "new_child" });
    await s.request("child_2", { priority: "selected" }); await s.request("child_3", { priority: "hover" }); await s.request("child_3");
    expect(s.diagnostics()).toMatchObject({ queued: 4, deduplicated: 1, started: 0 });
    s.setFullAgentActive(false); await tick();
    for (const [index, id] of ["child_3", "child_2", "child_1", "child_0"].entries()) {
      expect(transport.calls[index]?.context.targetNodeId).toBe(id); transport.resolve(index); await tick();
    }
    await s.whenSettled(); expect(transport.maxConcurrent()).toBe(1); expect(s.diagnostics().completed).toBe(4);
  });

  it("caps the queue at twelve, promotes an active hover and never refills beyond eight speculative requests", async () => {
    const w = workspace(20), prepare = vi.fn(async ({ context, execution: exec }) => proposal(context, exec)), s = create({ prepare });
    await s.setWorkspace(w); s.setFullAgentActive(true);
    for (let i = 0; i < 18; i++) await s.request(`child_${i}`, { priority: "visible" });
    expect(s.diagnostics().queued).toBe(12); await s.request("child_19", { priority: "hover" }); expect(s.diagnostics().queued).toBe(12);
    s.setFullAgentActive(false); await s.whenSettled(); expect(prepare).toHaveBeenCalledTimes(8);
    expect(prepare.mock.calls[0]![0].context.targetNodeId).toBe("child_19");
    for (let i = 0; i < 18; i++) await s.request(`child_${i}`);
    await s.whenSettled(); expect(prepare).toHaveBeenCalledTimes(8);
    await s.retry("child_18"); await s.whenSettled(); expect(prepare).toHaveBeenCalledTimes(9); expect(s.diagnostics().speculativeAttempts).toBe(8);
  });

  it("prewarms selected plus at most six visible targets and only six immediate children after an add", async () => {
    const w = workspace(10);
    w.project.graph.nodes.push({ ...w.project.graph.nodes[1]!, id: "grandchild", name: "Grandchild" });
    w.project.graph.edges.push({ id: "grandchild_edge", sourceNodeId: "child_0", targetNodeId: "grandchild", relation: "contextual_influence", aiGenerated: false });
    const prepare = vi.fn(async ({ context, execution: exec }) => proposal(context, exec)), s = create({ prepare });
    await s.setWorkspace(w); s.setFullAgentActive(true);
    await s.prewarm(w.project.rootNodeId, Array.from({ length: 10 }, (_, i) => `child_${i}`)); expect(s.diagnostics().queued).toBe(7);
    s.setFullAgentActive(false); await s.whenSettled(); expect(prepare).toHaveBeenCalledTimes(7);
    const other = create({ prepare }); await other.setWorkspace({ ...w, workspaceId: `${w.workspaceId}_children` });
    await other.prepareImmediateChildren(w.project.rootNodeId); await other.whenSettled();
    // Independent context hashes can resolve in a different order; the direct
    // child set and its cap are the guarantee for equal-priority preparation.
    expect(prepare.mock.calls.slice(7).map(call => call[0].context.targetNodeId).sort()).toEqual(["child_0", "child_1", "child_2", "child_3", "child_4", "child_5"]);
    expect(prepare.mock.calls.some(call => call[0].context.targetNodeId === "grandchild")).toBe(false);
  });

  it("pauses all nonexplicit queued work including old hovers while hidden, and yields to a full agent", async () => {
    let hidden = true, notify = () => {};
    const visibility = { isHidden: () => hidden, subscribe: (listener: () => void) => { notify = listener; return () => {}; } };
    const w = workspace(1), prepare = vi.fn(async ({ context, execution: exec }) => proposal(context, exec)), s = create({ prepare, visibility });
    await s.setWorkspace(w); await s.request(w.project.rootNodeId); await s.request("child_0", { priority: "visible" }); await s.whenSettled(); expect(prepare).not.toHaveBeenCalled();
    hidden = false; s.setFullAgentActive(true); notify(); await s.whenSettled(); expect(prepare).not.toHaveBeenCalled();
    s.setFullAgentActive(false); await s.whenSettled(); expect(prepare).toHaveBeenCalledTimes(2);
    hidden = true; await s.retry(w.project.rootNodeId); await s.whenSettled(); expect(prepare).toHaveBeenCalledTimes(3);
  });

  it("shares context/fingerprint work across hover and numeric/layout/scenario updates without another model request", async () => {
    const w = workspace(), fingerprint = vi.fn(fingerprintKpiProject), buildContext = vi.fn(buildKpiSuggestionContext);
    const prepare = vi.fn(async ({ context, execution: exec }) => proposal(context, exec)), s = create({ prepare, fingerprint, buildContext });
    await s.setWorkspace({ ...w, semanticGeneration: "semantics_1" }); await s.request(w.project.rootNodeId); await s.whenSettled();
    for (let i = 0; i < 15; i++) await s.request(w.project.rootNodeId);
    const numeric = structuredClone(w); numeric.project.graph.nodes[0]!.baselineValue = 0; numeric.project.graph.nodes[0]!.position = { x: 100, y: 100 }; numeric.project.scenarios[0]!.overrides[0]!.value = 0;
    await s.setWorkspace({ ...numeric, semanticGeneration: "semantics_1" }); await s.request(w.project.rootNodeId); await s.whenSettled();
    expect(fingerprint).toHaveBeenCalledTimes(1); expect(buildContext).toHaveBeenCalledTimes(1); expect(buildContext.mock.calls[0]![1].graphFingerprint).toMatch(/^sha256:/);
    expect(prepare).toHaveBeenCalledTimes(1);
    numeric.project.businessContext = "Different QA business boundary.";
    await s.setWorkspace({ ...numeric, semanticGeneration: "semantics_2" }); await s.request(w.project.rootNodeId); await s.whenSettled();
    expect(fingerprint).toHaveBeenCalledTimes(2); expect(prepare).toHaveBeenCalledTimes(2);
  });

  it("does not spend model work when a new numeric snapshot hashes to the same semantic identity", async () => {
    const w = workspace(), prepare = vi.fn(async ({ context, execution: exec }) => proposal(context, exec)), s = create({ prepare });
    await s.setWorkspace(w); await s.request(w.project.rootNodeId); await s.whenSettled();
    const numeric = structuredClone(w); numeric.project.graph.nodes[0]!.baselineValue = 1;
    await s.setWorkspace(numeric); await s.request(w.project.rootNodeId); await s.whenSettled(); expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("uses validated warm memory/reloaded cache and explicit local bindings without invoking transport", async () => {
    const w = workspace(), prepare = vi.fn(async () => undefined), cache = new SmartKpiCache({ storage: null, now: () => now });
    const context = await buildKpiSuggestionContext(w.project, { workspaceId: w.workspaceId, vdtId: w.vdtId, targetNodeId: w.project.rootNodeId, period: w.period });
    await cache.put({ context, execution }, proposal(context));
    const s = create({ cache, prepare }); await s.setWorkspace(w); await s.request(w.project.rootNodeId); expect(s.getSnapshot(w.project.rootNodeId).state).toMatchObject({ status: "ready", source: "cache" });
    const { execution: _execution, ...withoutExecution } = w;
    const recipe = create({ prepare, library: local }); await recipe.setWorkspace({ ...withoutExecution, workspaceId: `${w.workspaceId}_recipe` });
    await recipe.request(w.project.rootNodeId); expect(recipe.getSnapshot(w.project.rootNodeId).state).toMatchObject({ status: "ready", source: "library" }); expect(prepare).not.toHaveBeenCalled();
  });

  it("holds the lane until terminal cancellation acknowledgement and rejects stale project completion", async () => {
    const w = workspace(), transport = controlled(), s = create({ prepare: transport.prepare }); await s.setWorkspace(w); await s.request(w.project.rootNodeId); await tick();
    const replacement = structuredClone(w); replacement.project.id = "replacement_project";
    await s.setWorkspace(replacement); expect(transport.calls[0]!.signal.aborted).toBe(true);
    await s.request(w.project.rootNodeId); await tick(); expect(transport.calls).toHaveLength(1);
    transport.resolve(0); await tick(); expect(transport.calls).toHaveLength(2); expect(s.getSnapshot(w.project.rootNodeId).canApply).toBe(false);
    transport.resolve(1); await s.whenSettled(); expect(s.getSnapshot(w.project.rootNodeId).state).toMatchObject({ status: "ready", proposal: { proposalId: "proposal_1" } });
    expect(s.diagnostics().stale).toBe(1); expect(transport.maxConcurrent()).toBe(1);
  });

  it("rejects out-of-order project-context initialization instead of reviving an older project", async () => {
    const first = workspace(), second = { ...first, project: { ...first.project, id: "newer_project" } };
    const oldHash = await fingerprintKpiProject(first.project), newHash = await fingerprintKpiProject(second.project);
    const oldGate = deferred<string>(), newGate = deferred<string>(), prepare = vi.fn(async ({ context, execution: exec }) => proposal(context, exec));
    const s = create({ prepare, fingerprint: p => p.id === first.project.id ? oldGate.promise : newGate.promise });
    const initializeOld = s.setWorkspace(first), initializeNew = s.setWorkspace(second); newGate.resolve(newHash); await initializeNew;
    await s.request(second.project.rootNodeId); await s.whenSettled(); oldGate.resolve(oldHash); await initializeOld;
    await s.request(second.project.rootNodeId); await s.whenSettled(); expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0]![0].context.projectId).toBe("newer_project"); expect(s.getSnapshot(second.project.rootNodeId).canApply).toBe(true);
  });

  it("cancels deleted targets, and stale outputs never enter the ready cache", async () => {
    const w = workspace(2), transport = controlled(), cache = new SmartKpiCache({ storage: null, now: () => now }), s = create({ cache, prepare: transport.prepare });
    await s.setWorkspace(w); await s.request("child_0"); await tick(); const old = transport.calls[0]!;
    const changed = structuredClone(w); changed.project.graph.nodes = changed.project.graph.nodes.filter(n => n.id !== "child_0"); changed.project.graph.edges = changed.project.graph.edges.filter(e => e.targetNodeId !== "child_0");
    await s.setWorkspace(changed); await s.request("child_1"); expect(old.signal.aborted).toBe(true);
    transport.resolve(0); await tick(); expect(cache.peek({ context: old.context, execution })).toBeUndefined();
    transport.resolve(1); await s.whenSettled(); expect(s.getSnapshot("child_0").state.status).toBe("stale"); expect(s.getSnapshot("child_1").canApply).toBe(true);
  });

  it("quarantines unknown cleanup across disposal/recreation and ignores retry/cooldown until host confirmation", async () => {
    const w = workspace(), transport = controlled(), old = create({ prepare: transport.prepare }); await old.setWorkspace(w); await old.request(w.project.rootNodeId); await tick(); old.dispose();
    const fresh = create({ prepare: transport.prepare }); await fresh.setWorkspace(w); await fresh.request(w.project.rootNodeId); await tick(); expect(transport.calls).toHaveLength(1);
    transport.calls[0]!.result.reject(Object.assign(new Error("unknown child cleanup"), { code: "CLEANUP_UNCONFIRMED" })); await tick();
    expect(fresh.diagnostics().blocked).toBe(true); expect(fresh.getSnapshot(w.project.rootNodeId).state.status).toBe("blocked");
    await fresh.retry(w.project.rootNodeId); await tick(); expect(transport.calls).toHaveLength(1);
    confirmSmartKpiTerminalCleanup({ workspaceId: w.workspaceId, execution, terminalCleanupConfirmedByHost: true });
    await fresh.retry(w.project.rootNodeId); await tick(); expect(transport.calls).toHaveLength(2);
    transport.resolve(1); await fresh.whenSettled(); expect(fresh.getSnapshot(w.project.rootNodeId).canApply).toBe(true);
  });

  it("permits an actual explicit execution replacement while keeping the unresolved old execution quarantined", async () => {
    const w = workspace(), transport = controlled(), s = create({ prepare: transport.prepare }); await s.setWorkspace(w); await s.request(w.project.rootNodeId); await tick();
    transport.calls[0]!.result.reject(Object.assign(new Error("unknown cleanup"), { code: "CLEANUP_UNCONFIRMED" })); await s.whenSettled();
    await s.setWorkspace({ ...w, execution: { ...execution, backendId: "replacement_backend" } }); await s.request(w.project.rootNodeId); await tick(); expect(transport.calls).toHaveLength(2);
    transport.resolve(1); await s.whenSettled(); await s.setWorkspace(w); await s.request(w.project.rootNodeId); expect(s.getSnapshot(w.project.rootNodeId).state.status).toBe("blocked");
    confirmSmartKpiTerminalCleanup({ workspaceId: w.workspaceId, execution, terminalCleanupConfirmedByHost: true });
  });

  it("keeps frozen proposal and checked selection stable, marks context stale, and refreshes only explicitly", async () => {
    const w = workspace(), prepare = vi.fn(async ({ context, execution: exec }) => proposal(context, exec, `proposal_${prepare.mock.calls.length}`)), s = create({ prepare });
    await s.setWorkspace(w); await s.request(w.project.rootNodeId); await s.whenSettled(); s.freezeDisplay(w.project.rootNodeId);
    const selection = { groupId: "context", childKeys: ["availability"], mode: "contextual" as const }; expect(s.setSelection(w.project.rootNodeId, selection)).toBe(true);
    await s.retry(w.project.rootNodeId); await s.whenSettled();
    expect(s.getSnapshot(w.project.rootNodeId)).toMatchObject({ proposal: { proposalId: "proposal_1" }, selection, refreshAvailable: true, canApply: true });
    s.refreshDisplay(w.project.rootNodeId); expect(s.getSnapshot(w.project.rootNodeId)).toMatchObject({ proposal: { proposalId: "proposal_2" }, refreshAvailable: false }); expect(s.getSnapshot(w.project.rootNodeId).selection).toBeUndefined();
    const semantic = structuredClone(w); semantic.project.graph.nodes[0]!.name = "Different semantic metric"; await s.setWorkspace(semantic);
    expect(s.getSnapshot(w.project.rootNodeId)).toMatchObject({ stale: true, canApply: false, proposal: { proposalId: "proposal_2" } }); expect(s.setSelection(w.project.rootNodeId, selection)).toBe(false);
    await s.request(w.project.rootNodeId); await s.whenSettled(); expect(s.getSnapshot(w.project.rootNodeId).stale).toBe(true);
    s.refreshDisplay(w.project.rootNodeId); expect(s.getSnapshot(w.project.rootNodeId)).toMatchObject({ stale: false, canApply: true, proposal: { proposalId: "proposal_3" } });
  });

  it("disables a frozen ready list after TTL expiry or controller disposal", async () => {
    let clock = now; const w = workspace(), s = create({ now: () => clock, prepare: async ({ context, execution: exec }) => proposal(context, exec) });
    await s.setWorkspace(w); await s.request(w.project.rootNodeId); await s.whenSettled(); s.freezeDisplay(w.project.rootNodeId);
    clock += 86400_000; expect(s.getSnapshot(w.project.rootNodeId)).toMatchObject({ stale: true, canApply: false });
    const other = create({ prepare: async ({ context, execution: exec }) => proposal(context, exec) }); await other.setWorkspace(w);
    await other.request(w.project.rootNodeId); await other.whenSettled(); expect(other.getSnapshot(w.project.rootNodeId).canApply).toBe(true);
    other.dispose(); expect(other.getSnapshot(w.project.rootNodeId).canApply).toBe(false);
  });

  it.each(["scope", "dispose"])("rejects an asynchronously delayed local cache hit after %s change", async change => {
    const w = workspace(), gate = deferred<boolean>(), cache = new SmartKpiCache({ storage: null, now: () => now });
    vi.spyOn(cache, "put").mockImplementationOnce(async () => gate.promise);
    const s = create({ cache, prepare: async () => undefined, library: local }); await s.setWorkspace(w);
    const request = s.request(w.project.rootNodeId); await tick();
    if (change === "scope") { const changed = structuredClone(w); changed.project.id = "replacement"; await s.setWorkspace(changed); }
    else s.dispose();
    gate.resolve(true); await request; expect(s.getSnapshot(w.project.rootNodeId).canApply).toBe(false); expect(s.getSnapshot(w.project.rootNodeId).state.status).not.toBe("ready");
  });

  it("exposes honest timeout/empty/unavailable/failed states and only explicit retry spends another attempt", async () => {
    let clock = now; const w = workspace(), prepare = vi.fn(async () => { throw Object.assign(new Error("transport timeout after cleanup"), { code: "TIMEOUT" }); });
    const s = create({ cache: new SmartKpiCache({ storage: null, now: () => clock }), now: () => clock, prepare }); await s.setWorkspace(w); await s.request(w.project.rootNodeId); await s.whenSettled();
    expect(s.getSnapshot(w.project.rootNodeId).state.status).toBe("timeout"); await s.request(w.project.rootNodeId); expect(prepare).toHaveBeenCalledTimes(1);
    clock += 30_001; await s.request(w.project.rootNodeId); await s.whenSettled(); expect(prepare).toHaveBeenCalledTimes(1);
    await s.retry(w.project.rootNodeId); await s.whenSettled(); expect(prepare).toHaveBeenCalledTimes(2);
    for (const [result, status] of [[undefined, "empty"], [{ status: "unavailable", reason: "Selected adapter unavailable" }, "unavailable"], [{ status: "ready", proposal: { groups: [] } }, "failed"]] as const) {
      const target = workspace(), other = create({ prepare: async () => result }); await other.setWorkspace(target); await other.request(target.project.rootNodeId); await other.whenSettled(); expect(other.getSnapshot(target.project.rootNodeId).state.status).toBe(status);
    }
  });

  it("keeps a genuine model-empty explanation and limitations visible through a cooldown hit", async () => {
    const w = workspace(), reason = "The measured travel speed has no defensible additional direct inputs in this supplied context.";
    const limitations = ["No road-gradient or road-condition measurements were supplied."];
    const prepare = vi.fn(async () => ({ status: "empty" as const, reason, limitations })), s = create({ prepare });
    await s.setWorkspace(w); await s.request(w.project.rootNodeId); await s.whenSettled();
    expect(s.getSnapshot(w.project.rootNodeId)).toMatchObject({ state: { status: "empty", reason, limitations }, canApply: false });
    limitations[0] = "mutated after preparation";
    await s.request(w.project.rootNodeId); expect(prepare).toHaveBeenCalledTimes(1);
    expect(s.getSnapshot(w.project.rootNodeId).state).toMatchObject({ status: "empty", reason, limitations: ["No road-gradient or road-condition measurements were supplied."] });
    await s.retry(w.project.rootNodeId); await s.whenSettled(); expect(prepare).toHaveBeenCalledTimes(2);
  });

  it.each([
    { limitations: Array(7).fill("too many") }, { limitations: [" "] }, { limitations: ["x".repeat(301)] }, { limitations: [4] },
    { limitations: [], rawResponse: "untrusted extra field" }
  ])("rejects malformed negative metadata rather than presenting a model-empty success: %j", async metadata => {
    const w = workspace(), s = create({ prepare: async () => ({ status: "empty", reason: "No suitable child inputs.", ...metadata } as unknown as SmartKpiPreparationResult) });
    await s.setWorkspace(w); await s.request(w.project.rootNodeId); await s.whenSettled();
    expect(s.getSnapshot(w.project.rootNodeId).state.status).toBe("failed"); expect(s.diagnostics().failed).toBe(1);
    expect(s.getSnapshot(w.project.rootNodeId).canApply).toBe(false);
  });

  it("stops/disposes without prematurely releasing owned running work or starting queued jobs", async () => {
    const w = workspace(2), transport = controlled(), s = create({ prepare: transport.prepare }); await s.setWorkspace(w);
    await s.request("child_0"); await s.request("child_1"); await tick(); s.stop(); expect(transport.calls[0]!.signal.aborted).toBe(true); expect(s.diagnostics().queued).toBe(0);
    transport.calls[0]!.result.reject(Object.assign(new Error("terminal cancellation"), { code: "CANCELLED" })); await s.whenSettled(); expect(transport.calls).toHaveLength(1);
    await s.retry("child_1"); await tick(); expect(transport.calls).toHaveLength(1); s.resume(); await tick(); expect(transport.calls).toHaveLength(2);
    s.dispose(); expect(transport.calls[1]!.signal.aborted).toBe(true); transport.resolve(1); await s.whenSettled(); expect(s.getSnapshot("child_1").canApply).toBe(false);
  });
});
