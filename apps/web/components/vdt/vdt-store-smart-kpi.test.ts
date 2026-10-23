import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildKpiSuggestionContext, buildRecipeKpiSuggestions, calculateGraph, calculateScenarioGraph, cloneProject, compileKpiSuggestion, createSmartKpiMeasuredFixture, createVersionSnapshot, kpiCanonicalJson,
  KPI_SUGGESTION_RECIPES, incomingKpiProposalFormula, type IncomingKpiBatchInput, type KpiSuggestionSet } from "@vdt-studio/vdt-core";
import { createHash } from "node:crypto";
import { createIncomingGraphFixture, manualInput, manualKey, modelProposal } from "../../../../packages/vdt-core/src/suggestions/incoming-contract.fixtures";
import { validateSmartKpiOperation, type SmartKpiOperationV1 } from "@/lib/smart-kpi-transaction";
import { persistedExecutionSettings } from "@/lib/execution-mode-catalog";
import { VdtStorageRequestError, type StoredProjectSummary } from "@/lib/vdt-storage-client";
import { resolveSmartKpiScope } from "@/lib/smart-kpi-scope";
import { getSmartKpiLibraryProposal } from "@/lib/smart-kpi-decisions";
import { apiKeyScope, connectApiKeyPersistence } from "@/lib/api-key-persistence";
import { applyGatewayPreset, DEFAULT_EXECUTION_SETTINGS } from "@/lib/execution-mode-catalog";

const save = vi.fn(), fetchState = vi.fn(), create = vi.fn(), load = vi.fn();
const selectedExecution = vi.fn();
vi.mock("@/lib/smart-kpi-client", async original => ({ ...await original<typeof import("@/lib/smart-kpi-client")>(), createSmartKpiPreparedSelection: (...args: unknown[]) => selectedExecution(...args) }));
vi.mock("@/lib/vdt-storage-client", async original => ({ ...await original<typeof import("@/lib/vdt-storage-client")>(),
  saveStoredVdtRevision: (...args: unknown[]) => save(...args), fetchStoredVdtRevisionState: (...args: unknown[]) => fetchState(...args), createStoredVdt: (...args: unknown[]) => create(...args), loadStoredVdt: (...args: unknown[]) => load(...args) }));
const memory = new Map<string, string>();
let quota: ((value: string) => boolean) | undefined;
vi.stubGlobal("localStorage", { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => {
  if (key === "vdt-studio-state" && quota?.(value)) throw new DOMException("Synthetic quota", "QuotaExceededError"); memory.set(key, value);
}, removeItem: (key: string) => memory.delete(key) });
const { useVdtStudioStore: store } = await import("./vdt-store");
const notify = vi.fn();
function summary(generation = 1): StoredProjectSummary {
  return { project: { id: "owner", name: "Owner", createdAt: "2026-10-19T00:00:00Z", updatedAt: "2026-10-19T00:00:00Z" },
    runtimeState: { schemaVersion: "project_runtime_state.v1", projectId: "owner", runtimeGeneration: "v1", generationVersion: 1, migrationState: "shadow_ready", writeState: "enabled", updatedAt: "2026-10-19T00:00:00Z" },
    counts: { vdts: 1, revisions: generation, conversations: 0, agentRuns: 0, mutationProposals: 0, comparisons: 0 }, vdts: [{ vdt: { id: "stored", projectId: "owner", name: "VDT", rootKpi: "Output", timePeriod: "monthly", status: "draft", createdAt: "2026-10-19T00:00:00Z", updatedAt: "2026-10-19T00:00:00Z" },
      revisionCount: generation, head: { schemaVersion: "vdt_revision_head.v2", projectId: "owner", vdtId: "stored", activeRevisionId: `r${generation}`, activeContentIdentity: { scheme: "vdt_revision_payload_hash.v1", hash: `sha256:${"a".repeat(64)}` }, pendingRevisionId: null, commitGeneration: generation } }] };
}
function saved(generation = 2) { const s = summary(generation); return { summary: s, vdt: s.vdts[0]!.vdt, head: s.vdts[0]!.head, runtimeState: s.runtimeState,
  revision: { id: `r${generation}`, vdtId: "stored", revisionNo: generation, source: "user", createdAt: "2026-10-19T00:00:00Z" } }; }
async function prepared() {
  const state = store.getState(), scope = resolveSmartKpiScope(state);
  const context = await buildKpiSuggestionContext(state.project, { ...scope, targetNodeId: state.project.rootNodeId });
  const recipe = KPI_SUGGESTION_RECIPES.recipes.find(r => r.id === "production.time_rate")!;
  const proposal = buildRecipeKpiSuggestions(context, [{ binding: { id: "explicit_qa", recipeId: recipe.id, recipeHash: recipe.recipeHash, skillHash: recipe.skillHash,
    targetRole: recipe.targetRole, contextHash: context.contextHash, basis: "selected_skill", sourceRef: "qa-explicit-selected-role", rationale: "Explicit fixture role selection." } }], { proposalId: `fixture_${crypto.randomUUID()}`, now: new Date().toISOString() })!;
  return { schemaVersion: "incoming_kpi_apply.v2" as const, context, proposal, draft: { schemaVersion: "incoming_kpi_draft.v2" as const, targetNodeId: context.targetNodeId, contextHash: context.contextHash, revision: 0, source: { kind: "proposal" as const, proposalId: proposal.proposalId, groupId: proposal.groups[0]!.id }, childKeys: proposal.groups[0]!.children.map(c => c.key), manualChildren: [], existingFactors: [], formula: incomingKpiProposalFormula(proposal, proposal.groups[0]!.id)!, formulaAuthorship: "recipe" as const, inputValues: { p_1: "8" } } };
}
beforeEach(() => {
  quota = undefined;
  memory.clear(); save.mockReset(); fetchState.mockReset(); create.mockReset(); load.mockReset(); notify.mockReset();
  selectedExecution.mockReset();
  save.mockResolvedValue(saved()); fetchState.mockResolvedValue(saved());
  const project = createSmartKpiMeasuredFixture(0); project.graph.nodes[0]!.assumptions = ["Time period: monthly"];
  store.setState({ project, projectRevision: 10, selectedNodeId: project.rootNodeId, activeScenarioId: project.scenarios[0]!.id,
    workspace: { activePanel: "vdt", activeProjectId: "owner", activeVdtId: "stored", projectSummaries: [summary()], isLoading: false, isMutating: false },
    isGenerating: false, generateActivity: undefined, agentRun: undefined, activeAgentRunId: undefined, agentPendingQuestions: undefined, agentConnectionStatus: "idle", agentChatHistory: [],
    smartKpiOperation: undefined, smartKpiUndo: undefined, smartKpiRebaseRequired: undefined, smartKpiConflictOperation: undefined, smartKpiFencedRunIds: [], smartKpiMutation: { status: "idle", canUndo: false }, sendManualProjectChange: notify });
});

describe("Smart immutable user transaction", () => {
  it("pins illustrative estimates through lost acknowledgement/reload without changing the measured parent", async () => {
    const project = createIncomingGraphFixture("measured"); store.setState({ project, selectedNodeId: "target", activeScenarioId: "" });
    const input = manualInput(await store.getState().buildIncomingKpiContext("target"));
    const second = `m_${"2".repeat(32)}` as const;
    input.draft.manualChildren[0]!.unit = "km";
    input.draft.manualChildren.push({ key: second, selected: true, name: "Illustrative trips", unit: "trip" });
    input.draft.formula = `${manualKey} / ${second}`; input.draft.estimateMissingValues = true;
    save.mockRejectedValueOnce(new Error("lost estimated acknowledgement"));
    expect(await store.getState().applySmartKpiSuggestion(input)).toMatchObject({ ok: false });
    const operation = store.getState().smartKpiOperation!;
    expect(validateSmartKpiOperation(operation)).toBe(true);
    const body = JSON.stringify(save.mock.calls[0]![1]);
    const corrupted = structuredClone(operation);
    corrupted.candidate!.graph.nodes.find(node => node.id === corrupted.addedNodeIds[0])!.valueStatus = "user_provided_value";
    corrupted.input!.project = cloneProject(corrupted.candidate!);
    expect(validateSmartKpiOperation(corrupted)).toBe(false);
    await store.persist.rehydrate(); expect(await store.getState().reconcilePendingSmartKpiCommit()).toBe(true);
    expect(JSON.stringify(save.mock.calls[1]![1])).toBe(body);
    expect(calculateGraph(store.getState().project).values.target).toBe(4);
    for (const node of store.getState().project.graph.nodes.filter(node => operation.addedNodeIds.includes(node.id)))
      expect(node).toMatchObject({ valueStatus: "default_assumption", valueSource: { sourceTier: "assumption", acceptedByUserInDialog: true } });
  });
  it("builds and previews manual/mixed drafts locally, then commits one calculated parent with source retained", async () => {
    const project = createIncomingGraphFixture("measured"); store.setState({ project, selectedNodeId: "target", activeScenarioId: "" });
    const context = await store.getState().buildIncomingKpiContext("target"), input = manualInput(context);
    const before = kpiCanonicalJson(store.getState().project);
    expect(await store.getState().previewIncomingKpiBatch(input)).toMatchObject({ valid: true, newNodeCount: 1, parentType: "calculated" });
    expect(selectedExecution).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled(); expect(kpiCanonicalJson(store.getState().project)).toBe(before);
    expect(await store.getState().applySmartKpiSuggestion(input)).toMatchObject({ ok: true, addedNodeIds: [expect.stringMatching(/_m_/)] });
    expect(selectedExecution).not.toHaveBeenCalled(); expect(save).toHaveBeenCalledOnce();
    const parent = store.getState().project.graph.nodes.find(node => node.id === "target")!;
    expect(parent).toMatchObject({ type: "calculated", baselineValue: 4, valueSource: { sourceTier: "file" } }); expect(parent.formula).toContain(manualKey);
  });
  it("retains partial-model lineage and one resolved alias map across ambiguous v2 replay", async () => {
    const project = createIncomingGraphFixture("measured"); store.setState({ project, selectedNodeId: "target", activeScenarioId: "" });
    const input = manualInput(await store.getState().buildIncomingKpiContext("target")), proposal = modelProposal(input.context);
    proposal.createdAt = new Date().toISOString(); proposal.expiresAt = new Date(Date.now() + 60_000).toISOString(); input.proposal = proposal;
    input.draft.source = { kind: "proposal", proposalId: proposal.proposalId, groupId: "components" }; input.draft.childKeys = ["second"];
    input.draft.formulaAuthorship = "user_edited"; input.draft.formula = `p_2 + ${manualKey}`;
    input.draft.inputValues = { p_2: "1" };
    selectedExecution.mockResolvedValue({ execution: proposal.origin.kind === "model" ? proposal.origin.execution : undefined, revalidate: async () => true });
    save.mockRejectedValueOnce(new Error("lost mixed acknowledgement")); expect(await store.getState().applySmartKpiSuggestion(input)).toMatchObject({ ok: false });
    const operation = store.getState().smartKpiOperation!; expect(operation.schemaVersion).toBe("smart_kpi_operation.v2");
    expect(operation).toMatchObject({ draft: input.draft, lineage: { kind: "model", formulaAuthorship: "user_edited" }, resolved: { aliases: [{ alias: "p_2" }, { alias: manualKey }] } });
    const request = JSON.stringify(save.mock.calls[0]![1]); await store.persist.rehydrate(); expect(await store.getState().reconcilePendingSmartKpiCommit()).toBe(true);
    expect(JSON.stringify(save.mock.calls[1]![1])).toBe(request); expect(store.getState().project.graph.nodes.some(node => node.name === "First component")).toBe(false);
    expect(store.getState().project.graph.nodes.filter(node => node.id.startsWith(`${operation.id}_`))).toHaveLength(2);
    expect(store.getState().project.graph.nodes.find(node => node.id.endsWith(manualKey))).toMatchObject({ aiGenerated: false, status: "accepted", baselineValue: 3, valueStatus: "calculated" });
  });
  it("replays a pinned historical v1 committing receipt without applying the new validator or formula policy", async () => {
    const state = store.getState(), input = await prepared(), id = "smart_aaaaaaaa_bbbb_cccc_dddd_eeeeeeeeeeee";
    const selection = { groupId: input.proposal.groups[0]!.id, childKeys: input.draft.childKeys, mode: "contextual" as const };
    const compiled = await compileKpiSuggestion(state.project, input.context, input.proposal, selection, { operationId: id, now: new Date().toISOString() });
    const checkpointed = createVersionSnapshot(state.project, { name: "Historical v1 checkpoint", taskType: "suggest_incoming_kpis" });
    const candidate = { ...compiled.preview, versions: checkpointed.versions };
    const historicalProposal = JSON.parse(JSON.stringify(input.proposal)) as KpiSuggestionSet;
    Object.assign(historicalProposal, { validatorVersion: "smart-kpi-validator.v1" });
    const operation: SmartKpiOperationV1 = { schemaVersion: "smart_kpi_operation.v1", id, kind: "add", phase: "committing", workspaceId: "owner", vdtId: "stored",
      projectId: state.project.id, projectRevision: state.projectRevision, before: cloneProject(state.project), beforeJson: kpiCanonicalJson(state.project), settings: kpiCanonicalJson(persistedExecutionSettings(state.executionSettings)),
      previousNodeId: state.selectedNodeId, previousScenarioId: state.activeScenarioId, context: input.context, proposal: historicalProposal, selection,
      authority: { head: { schemaVersion: "vdt_revision_cas.v1", activeRevisionId: "r1", activeContentIdentity: summary().vdts[0]!.head.activeContentIdentity, commitGeneration: 1 },
        runtime: { schemaVersion: "project_runtime_cas.v1", runtimeGeneration: "v1", generationVersion: 1 } }, candidate,
      addedNodeIds: compiled.newNodeIds, checkpointVersionId: checkpointed.versions.at(-1)!.id };
    operation.input = { idempotencyKey: `smart-add:stored:${id}`, expectedHead: operation.authority!.head, expectedRuntime: operation.authority!.runtime, project: cloneProject(candidate), summary: "Historical immutable v1 request" };
    const original = JSON.stringify(operation.input), digest = createHash("sha256").update(original).digest("hex");
    expect(validateSmartKpiOperation(operation)).toBe(true); store.setState({ smartKpiOperation: operation }); await store.persist.rehydrate();
    expect(await store.getState().reconcilePendingSmartKpiCommit()).toBe(true);
    expect(JSON.stringify(save.mock.calls[0]![1])).toBe(original); expect(createHash("sha256").update(JSON.stringify(save.mock.calls[0]![1])).digest("hex")).toBe(digest);
    expect(store.getState().project.graph.nodes[0]!.formula).toBeUndefined(); expect(calculateGraph(store.getState().project).rootValue).toBe(0);
  });
  it("rejects a corrupted retained v2 alias/formula receipt before any replay", async () => {
    save.mockRejectedValueOnce(new Error("lost acknowledgement")); expect(await store.getState().applySmartKpiSuggestion(await prepared())).toMatchObject({ ok: false });
    const raw = JSON.parse(memory.get("vdt-studio-state")!); raw.state.smartKpiOperation.resolved.aliases[0].nodeId = "different_receipt_node";
    memory.set("vdt-studio-state", JSON.stringify(raw)); await store.persist.rehydrate();
    expect(await store.getState().reconcilePendingSmartKpiCommit()).toBe(false); expect(save).toHaveBeenCalledOnce(); expect(store.getState().smartKpiConflictOperation).toBeDefined();
  });
  it("rejects a changed numeric candidate even when the retained request copies the same corrupted value", async () => {
    save.mockRejectedValueOnce(new Error("lost numeric acknowledgement"));
    expect(await store.getState().applySmartKpiSuggestion(await prepared())).toMatchObject({ ok: false });
    const raw = JSON.parse(memory.get("vdt-studio-state")!);
    const operation = raw.state.smartKpiOperation;
    operation.candidate.graph.nodes.find((node: { id: string }) => node.id === operation.addedNodeIds[0]).baselineValue = 999;
    operation.input.project = structuredClone(operation.candidate);
    memory.set("vdt-studio-state", JSON.stringify(raw)); await store.persist.rehydrate();
    expect(await store.getState().reconcilePendingSmartKpiCommit()).toBe(false);
    expect(save).toHaveBeenCalledOnce(); expect(store.getState().project.graph.nodes).toHaveLength(1);
  });
  it("replays an already committing historical v2 unknown-value body without adding current numeric policy", async () => {
    save.mockRejectedValueOnce(new Error("lost historical v2 acknowledgement"));
    await store.getState().applySmartKpiSuggestion(await prepared());
    const operation = structuredClone(store.getState().smartKpiOperation!);
    if (operation.schemaVersion !== "smart_kpi_operation.v2" || operation.phase !== "committing") throw new Error("Missing v2 receipt");
    delete operation.resolved.values; delete operation.draft.inputValues;
    for (const node of operation.candidate.graph.nodes.filter(node => operation.addedNodeIds.includes(node.id))) {
      delete node.baselineValue; delete node.valueSource; node.valueStatus = "unknown";
    }
    operation.input!.project = cloneProject(operation.candidate);
    const body = JSON.stringify(operation.input);
    expect(validateSmartKpiOperation(operation)).toBe(true);
    store.setState({ smartKpiOperation: operation }); await store.persist.rehydrate();
    expect(await store.getState().reconcilePendingSmartKpiCommit()).toBe(true);
    expect(JSON.stringify(save.mock.calls[1]![1])).toBe(body);
  });
  it("replays an exact shared source ID/unit despite a different proposed display label", async () => {
    const project = createIncomingGraphFixture("shared_speed"); store.setState({ project, selectedNodeId: "target", activeScenarioId: "" });
    const input = manualInput(await store.getState().buildIncomingKpiContext("target")), proposal = modelProposal(input.context);
    proposal.createdAt = new Date().toISOString(); proposal.expiresAt = new Date(Date.now() + 60_000).toISOString();
    proposal.groups[0] = { id: "distance_time", title: "Distance / time", selectionMode: "all", requiredKeys: ["distance", "measured_time"], formula: "distance / measured_time", limitations: [], children: [
      { key: "distance", conceptKey: "shared_measured_distance", name: "Путь за рейс", unit: "km/trip", existingNodeId: "distance" },
      { key: "measured_time", conceptKey: "new_measured_time", name: "Independent measured moving time", unit: "h/trip" }
    ] };
    input.proposal = proposal; input.draft.source = { kind: "proposal", proposalId: proposal.proposalId, groupId: "distance_time" };
    input.draft.childKeys = ["distance", "measured_time"]; input.draft.manualChildren = []; input.draft.formula = "p_1 / p_2"; input.draft.formulaAuthorship = "model";
    selectedExecution.mockResolvedValue({ execution: proposal.origin.kind === "model" ? proposal.origin.execution : undefined, revalidate: async () => true });
    save.mockRejectedValueOnce(new Error("lost shared acknowledgement")); expect(await store.getState().applySmartKpiSuggestion(input)).toMatchObject({ ok: false });
    const first = JSON.stringify(save.mock.calls[0]![1]); expect(validateSmartKpiOperation(store.getState().smartKpiOperation!)).toBe(true);
    await store.persist.rehydrate(); expect(await store.getState().reconcilePendingSmartKpiCommit()).toBe(true); expect(JSON.stringify(save.mock.calls[1]![1])).toBe(first);
    expect(store.getState().project.graph.nodes.find(node => node.id === "distance")?.name).toBe(project.graph.nodes.find(node => node.id === "distance")!.name);
    expect(store.getState().project.graph.nodes.filter(node => node.id === "distance")).toHaveLength(1);
  });
  it("retains measured zero source, applies the formula, and Undo appends a new CAS revision", async () => {
    const input = await prepared(), before = store.getState().project, baseline = calculateGraph(before).rootValue, scenario = calculateScenarioGraph(before, before.scenarios[0]!).rootValue;
    expect(await store.getState().applySmartKpiSuggestion(input)).toMatchObject({ ok: true, durability: "stored", addedNodeIds: expect.any(Array) });
    const applied = store.getState(); expect(save).toHaveBeenCalledTimes(1); expect(applied.project.graph.nodes).toHaveLength(3);
    expect(baseline).toBe(0); expect(scenario).toBeDefined(); expect(calculateGraph(applied.project).rootValue).toBe(0); expect(calculateScenarioGraph(applied.project, applied.project.scenarios[0]!).rootValue).toBe(scenario); expect(applied.project.graph.nodes[0]!.baselineValue).toBe(0);
    expect(applied.project.graph.nodes[0]!.dataMapping).toEqual(before.graph.nodes[0]!.dataMapping); expect(applied.smartKpiMutation.canUndo).toBe(true);
    save.mockResolvedValueOnce(saved(3)); fetchState.mockResolvedValueOnce(saved(3));
    expect(await applied.undoSmartKpiSuggestion()).toBe(true);
    expect(save.mock.calls[1]![1]).toMatchObject({ idempotencyKey: expect.stringMatching(/^smart-undo:/), expectedHead: { activeRevisionId: "r2", commitGeneration: 2 } });
    expect(store.getState().project.graph).toEqual(before.graph); expect(store.getState().project.versions).toHaveLength(1); expect(store.getState().smartKpiMutation.canUndo).toBe(false);
    expect(notify).toHaveBeenCalledTimes(2);
  });
  it("reserves synchronously and guards graph/navigation/agent starts while one save is pending", async () => {
    const input = await prepared(); let acknowledge!: (value: ReturnType<typeof saved>) => void;
    save.mockImplementationOnce(() => new Promise(resolve => { acknowledge = resolve; }));
    const pending = store.getState().applySmartKpiSuggestion(input), unchanged = store.getState().project;
    const duplicate = store.getState().applySmartKpiSuggestion(input);
    store.getState().addManualIncomingKpi(unchanged.rootNodeId); store.getState().updateNodeBaselineValue(unchanged.rootNodeId, 900);
    expect(await store.getState().startAgentRun("forbidden during pending Smart")).toBe(false); expect(await store.getState().selectWorkspaceVdt("another")).toBe(false);
    expect(store.getState().project).toBe(unchanged); expect(await duplicate).toMatchObject({ ok: false });
    await vi.waitFor(() => expect(acknowledge).toBeTypeOf("function")); acknowledge(saved()); await expect(pending).resolves.toMatchObject({ ok: true }); expect(save).toHaveBeenCalledTimes(1);
  });
  it("replays the same candidate/checkpoint/layout/key/CAS after a lost response and reload", async () => {
    const input = await prepared(); save.mockRejectedValueOnce(new Error("ack lost"));
    expect(await store.getState().applySmartKpiSuggestion(input)).toMatchObject({ ok: false });
    const first = structuredClone(save.mock.calls[0]![1]), count = store.getState().project.graph.nodes.length;
    expect(store.getState().smartKpiMutation.status).toBe("reconciling");
    await store.persist.rehydrate(); expect(store.getState().smartKpiOperation?.input).toEqual(first);
    expect(await store.getState().reconcilePendingSmartKpiCommit()).toBe(true);
    expect(save.mock.calls[1]![1]).toEqual(first); expect(store.getState().project.graph.nodes).toHaveLength(count + 2); expect(store.getState().project.versions).toHaveLength(1);
  });
  it("reconciles an ordinary ambiguous save first and captures its acknowledged head", async () => {
    const input = await prepared(), state = store.getState();
    const ordinary = { vdtId: "stored", projectRevision: state.projectRevision, input: { idempotencyKey: "ordinary_immutable", project: structuredClone(state.project),
      summary: "prior save", expectedHead: { schemaVersion: "vdt_revision_cas.v1" as const, activeRevisionId: "r1", activeContentIdentity: summary().vdts[0]!.head.activeContentIdentity, commitGeneration: 1 },
      expectedRuntime: { schemaVersion: "project_runtime_cas.v1" as const, runtimeGeneration: "v1" as const, generationVersion: 1 } } };
    store.setState({ workspace: { ...state.workspace, pendingRevisionCommit: ordinary } }); save.mockResolvedValueOnce(saved(2)).mockResolvedValueOnce(saved(3)); fetchState.mockResolvedValueOnce(saved(3));
    expect(await store.getState().applySmartKpiSuggestion(input)).toMatchObject({ ok: true });
    expect(save.mock.calls[0]![1]).toEqual(ordinary.input); expect(save.mock.calls[1]![1].expectedHead.activeRevisionId).toBe("r2"); expect(store.getState().workspace.pendingRevisionCommit).toBeUndefined();
  });
  it("keeps the draft/selection on conflict and never retries on a refreshed head", async () => {
    const input = await prepared(), before = store.getState().project;
    save.mockRejectedValueOnce(new VdtStorageRequestError("conflict", 409, "REVISION_CONFLICT", false)); fetchState.mockResolvedValueOnce(saved(7));
    expect(await store.getState().applySmartKpiSuggestion(input)).toMatchObject({ ok: false });
    expect(store.getState().project).toBe(before); expect(store.getState().smartKpiMutation.status).toBe("conflict"); expect(store.getState().workspace.projectSummaries[0]!.vdts[0]!.head.commitGeneration).toBe(7);
    expect(await store.getState().reconcilePendingSmartKpiCommit()).toBe(true); expect(save).toHaveBeenCalledTimes(1);
  });
  it("publishes a late acknowledgement only to owning metadata after a value/layout/scope edit", async () => {
    const input = await prepared(); let acknowledge!: (value: ReturnType<typeof saved>) => void;
    save.mockImplementationOnce(() => new Promise(resolve => { acknowledge = resolve; })); const pending = store.getState().applySmartKpiSuggestion(input);
    await vi.waitFor(() => expect(acknowledge).toBeTypeOf("function"));
    const other = createSmartKpiMeasuredFixture(999); other.id = "another_snapshot";
    store.setState({ project: other, workspace: { ...store.getState().workspace, activeVdtId: "another_vdt" } });
    acknowledge(saved()); await expect(pending).resolves.toMatchObject({ ok: false }); expect(store.getState().project).toBe(other); expect(notify).not.toHaveBeenCalled();
    expect(store.getState().workspace.projectSummaries[0]!.vdts[0]!.head.commitGeneration).toBe(2);
  });
  it("disables Undo after any interfering numeric/layout/scenario/head edit while retaining Versions", async () => {
    await store.getState().applySmartKpiSuggestion(await prepared()); const checkpoint = store.getState().smartKpiUndo!.checkpointVersionId;
    store.getState().updateNodeBaselineValue(store.getState().project.rootNodeId, 8);
    expect(store.getState().smartKpiMutation.canUndo).toBe(false); expect(await store.getState().undoSmartKpiSuggestion()).toBe(false);
    expect(store.getState().project.versions.some(v => v.id === checkpoint)).toBe(true);
  });
  it("uses a true draft path without storage and makes accepted child roles immediately available in Library", async () => {
    store.setState({ workspace: { ...store.getState().workspace, activeVdtId: undefined } });
    const input = await prepared(); const result = await store.getState().applySmartKpiSuggestion(input);
    expect(result).toMatchObject({ ok: true, durability: "draft" }); expect(save).not.toHaveBeenCalled();
    const project = store.getState().project, child = result.addedNodeIds.find(id => id.endsWith("_p_1"))!;
    const context = await buildKpiSuggestionContext(project, { ...resolveSmartKpiScope(store.getState()), targetNodeId: child });
    const first = getSmartKpiLibraryProposal(context), second = getSmartKpiLibraryProposal(context);
    expect(first?.groups[0]!.recipeBinding).toMatchObject({ recipeId: "production.time_losses", basis: "accepted_smart" });
    expect(second).toEqual(first); expect(first?.origin.kind).toBe("recipe");
    expect(await store.getState().undoSmartKpiSuggestion()).toBe(true); expect(store.getState().project.graph.nodes).toHaveLength(1);
  });
  it("blocks pending/recovering agents and stored VDTs whose summary is missing", async () => {
    const input = await prepared(); store.setState({ isGenerating: true });
    expect(await store.getState().applySmartKpiSuggestion(input)).toMatchObject({ ok: false });
    store.setState({ isGenerating: false, workspace: { ...store.getState().workspace, projectSummaries: [] } });
    expect(await store.getState().applySmartKpiSuggestion(input)).toMatchObject({ ok: false, durability: "stored" }); expect(save).not.toHaveBeenCalled();
  });
  it("fails a quota-blocked reservation before any stored request and releases its own lock", async () => {
    const input = await prepared(); quota = () => true;
    await expect(store.getState().applySmartKpiSuggestion(input)).resolves.toMatchObject({ ok: false, reason: expect.stringContaining("storage") });
    expect(save).not.toHaveBeenCalled(); expect(store.getState().smartKpiOperation).toBeUndefined(); expect(store.getState().smartKpiMutation.status).toBe("failed");
  });
  it("confirms the exact committing journal before POST and never sends a nonpersisted candidate", async () => {
    const input = await prepared(); quota = value => JSON.parse(value).state.smartKpiOperation?.phase === "committing";
    expect(await store.getState().applySmartKpiSuggestion(input)).toMatchObject({ ok: false }); expect(save).not.toHaveBeenCalled();
    expect(store.getState().smartKpiOperation).toBeUndefined(); expect(store.getState().project.graph.nodes).toHaveLength(1);
  });
  it("keeps an acknowledged stored publication known when later browser persistence fails", async () => {
    const input = await prepared(); quota = value => JSON.parse(value).state.project.graph.nodes.length > 1;
    await expect(store.getState().applySmartKpiSuggestion(input)).resolves.toMatchObject({ ok: true, durability: "stored" });
    expect(store.getState().project.graph.nodes).toHaveLength(3); expect(store.getState().smartKpiMutation.status).toBe("succeeded");
    expect(store.getState().smartKpiMutation.message).toContain("Browser storage"); expect(store.getState().smartKpiOperation).toBeUndefined();
    expect(JSON.parse(memory.get("vdt-studio-state")!).state.smartKpiOperation.input).toEqual(save.mock.calls[0]![1]);
  });
  it("returns successful in-memory draft publication plus a reload warning on quota failure", async () => {
    store.setState({ workspace: { ...store.getState().workspace, activeVdtId: undefined } }); const input = await prepared();
    quota = value => JSON.parse(value).state.project.graph.nodes.length > 1;
    await expect(store.getState().applySmartKpiSuggestion(input)).resolves.toMatchObject({ ok: true, durability: "draft" });
    expect(store.getState().smartKpiMutation.message).toContain("in memory"); expect(store.getState().smartKpiMutation.canUndo).toBe(true);
  });
  it("distinguishes definite policy failure from an uncertain nonretryable503 commit outcome", async () => {
    const input = await prepared(); save.mockRejectedValueOnce(new VdtStorageRequestError("Denied", 403, "HOSTED_REVISION_WRITES_DISABLED", false));
    expect(await store.getState().applySmartKpiSuggestion(input)).toMatchObject({ ok: false }); expect(store.getState().smartKpiMutation).toMatchObject({ status: "failed", message: "Denied" });
    expect(fetchState).not.toHaveBeenCalled();
    save.mockRejectedValueOnce(new VdtStorageRequestError("Recovery required", 503, "AMBIGUOUS_REVISION_RECOVERY", false));
    expect(await store.getState().applySmartKpiSuggestion(input)).toMatchObject({ ok: false }); expect(store.getState().smartKpiMutation.status).toBe("reconciling"); expect(store.getState().smartKpiOperation?.input).toEqual(save.mock.calls[1]![1]);
  });
  it("does not turn a known acknowledgement into unknown when the runtime becomes read-only", async () => {
    const input = await prepared(); let acknowledge!: (value: ReturnType<typeof saved>) => void;
    save.mockImplementationOnce(() => new Promise(resolve => { acknowledge = resolve; })); const pending = store.getState().applySmartKpiSuggestion(input);
    await vi.waitFor(() => expect(acknowledge).toBeTypeOf("function"));
    const readOnly = summary(); readOnly.runtimeState.writeState = "disabled";
    store.setState({ workspace: { ...store.getState().workspace, projectSummaries: [readOnly] } });
    acknowledge(saved()); await expect(pending).resolves.toMatchObject({ ok: false });
    expect(store.getState().smartKpiOperation).toBeUndefined(); expect(store.getState().smartKpiMutation.status).toBe("conflict");
  });
  it("keeps pre-Smart chats inspectable and continues through a fresh current-graph admission", async () => {
    const state = store.getState(), old = { runId: "paused_A", status: "recovery_required", project: structuredClone(state.project), events: [], request: { mode: "continue_project" } };
    const activity = { runId: "paused_A", status: "recovery_required", runtimeAgentRun: old } as never;
    store.setState({ agentChatHistory: [{ runId: "paused_A", vdtId: "stored", title: "Paused A", status: "recovery_required", startedAt: "2026-10-19T00:00:00Z", updatedAt: "2026-10-19T00:00:00Z", messageCount: 1, activity }] });
    expect(await store.getState().applySmartKpiSuggestion(await prepared())).toMatchObject({ ok: true }); const current = store.getState().project;
    store.getState().applyAgentGraphPatch(old as never); expect(store.getState().project).toBe(current);
    expect(store.getState().openAgentChat("paused_A")).toBe(true); expect(store.getState().isGenerating).toBe(false);
    const original = store.getState().startAgentRun; let submittedProject: unknown;
    const start = vi.fn(async () => { submittedProject = store.getState().project; return true; }); store.setState({ startAgentRun: start });
    await store.getState().continueAgentRun(); expect(start).toHaveBeenCalledWith(undefined, { mode: "continue_project", includeCurrentProject: true }); expect(submittedProject).toBe(current);
    store.getState().applyAgentGraphPatch(old as never); expect(store.getState().project).toBe(current); store.setState({ startAgentRun: original });
  });
  it("retains a recovered inconsistent candidate/input journal and never replays or publishes it", async () => {
    const input = await prepared(); save.mockRejectedValueOnce(new Error("lost ack"));
    expect(await store.getState().applySmartKpiSuggestion(input)).toMatchObject({ ok: false });
    const raw = JSON.parse(memory.get("vdt-studio-state")!); raw.state.smartKpiOperation.candidate.graph.nodes[0].baselineValue = 999;
    memory.set("vdt-studio-state", JSON.stringify(raw)); await store.persist.rehydrate();
    expect(await store.getState().reconcilePendingSmartKpiCommit()).toBe(false); expect(save).toHaveBeenCalledTimes(1);
    expect(store.getState().project.graph.nodes[0]!.baselineValue).toBe(0); expect(store.getState().smartKpiOperation?.candidate?.graph.nodes[0]!.baselineValue).toBe(999);
    expect(store.getState().smartKpiMutation.message).toContain("inconsistent");
  });
  it("retains the exact journal through lost acknowledgement and retryable409 before successful replay", async () => {
    const input = await prepared(); save.mockRejectedValueOnce(new Error("lost acknowledgement"))
      .mockRejectedValueOnce(new VdtStorageRequestError("Attempt remains active", 409, "REVISION_IN_PROGRESS", true));
    expect(await store.getState().applySmartKpiSuggestion(input)).toMatchObject({ ok: false }); const immutable = structuredClone(save.mock.calls[0]![1]);
    expect(await store.getState().reconcilePendingSmartKpiCommit()).toBe(false); expect(store.getState().smartKpiOperation?.input).toEqual(immutable);
    expect(store.getState().smartKpiMutation.status).toBe("reconciling"); expect(await store.getState().reconcilePendingSmartKpiCommit()).toBe(true);
    expect(save.mock.calls[1]![1]).toEqual(immutable); expect(save.mock.calls[2]![1]).toEqual(immutable); expect(store.getState().project.graph.nodes).toHaveLength(3);
  });
  it("cannot Add or automatically save a conflicted stale draft on the refreshed head until an actual stored reload", async () => {
    const input = await prepared(), before = store.getState().project;
    save.mockRejectedValueOnce(new VdtStorageRequestError("Conflict", 409, "REVISION_CONFLICT", false)); fetchState.mockResolvedValueOnce(saved(7));
    expect(await store.getState().applySmartKpiSuggestion(input)).toMatchObject({ ok: false });
    expect(await store.getState().applySmartKpiSuggestion(input)).toMatchObject({ ok: false, reason: expect.stringContaining("Reload") });
    expect(await store.getState().saveActiveWorkspaceVdt()).toBe(false); expect(save).toHaveBeenCalledTimes(1); expect(store.getState().project).toBe(before);
    const loaded = createSmartKpiMeasuredFixture(777); loaded.graph.nodes[0]!.assumptions = ["Time period: monthly"];
    load.mockResolvedValueOnce({ activeProject: loaded, summary: summary(7), vdt: summary(7).vdts[0]!.vdt });
    expect(await store.getState().selectWorkspaceVdt("stored")).toBe(true); expect(load).toHaveBeenCalledTimes(1); expect(save).toHaveBeenCalledTimes(1);
    expect(store.getState().project.graph.nodes[0]!.baselineValue).toBe(777); expect(store.getState().smartKpiRebaseRequired).toBeUndefined(); expect(store.getState().smartKpiConflictOperation?.before).toEqual(before);
  });
  it("passively restores only the retained vault scope during model-write replay without changing its epoch or body", async () => {
    const execution = { mode: "api" as const, backendId: "openai_compatible", modelId: "selected", bindingVersion: "stable-binding", credentialEpoch: "stable-vault-epoch" };
    const settings = { ...applyGatewayPreset({ ...DEFAULT_EXECUTION_SETTINGS, executionMode: "byok" }, "openai-default"), model: "selected", apiKey: "synthetic-restored-key" };
    store.setState({ executionSettings: settings }); const scope = apiKeyScope(settings)!;
    selectedExecution.mockImplementation(async current => {
      if (current.apiKey !== settings.apiKey) throw new Error("Credential was not restored");
      return { execution, revalidate: async () => true };
    });
    const input = await prepared(); input.proposal.origin = { kind: "model", requestId: "synthetic-model-request", execution };
    save.mockRejectedValueOnce(new Error("lost ack")); expect(await store.getState().applySmartKpiSuggestion(input)).toMatchObject({ ok: false });
    const immutable = structuredClone(save.mock.calls[0]![1]); await store.persist.rehydrate(); expect(store.getState().executionSettings.apiKey).toBeUndefined();
    store.getState().setExecutionSettingsField("apiKey", "interactive-blocked"); expect(store.getState().executionSettings.apiKey).toBeUndefined();
    store.getState().restoreApiKeyFromVault("wrong-destination", settings.apiKey!); expect(store.getState().executionSettings.apiKey).toBeUndefined();
    const write = vi.fn(), persistence = connectApiKeyPersistence({ getSettings: () => store.getState().executionSettings,
      setApiKey: (value, restoredScope) => store.getState().restoreApiKeyFromVault(restoredScope!, value),
      subscribe: listener => store.subscribe((state, previous) => { if (state.executionSettings !== previous.executionSettings) listener(state.executionSettings); })
    }, { read: async currentScope => currentScope === scope ? settings.apiKey : undefined, write, remove: vi.fn() }, () => {});
    await persistence.settled(); persistence.dispose(); expect(store.getState().executionSettings.apiKey).toBe(settings.apiKey); expect(write).not.toHaveBeenCalled();
    expect(await store.getState().reconcilePendingSmartKpiCommit()).toBe(true); expect(save.mock.calls[1]![1]).toEqual(immutable);
    expect(store.getState().smartKpiMutation.status).toBe("succeeded"); expect(store.getState().project.graph.nodes).toHaveLength(3);
    expect(JSON.stringify(JSON.parse(memory.get("vdt-studio-state")!))).not.toContain(settings.apiKey);
  });
  it("does not publish a pending model candidate after a real credential epoch change", async () => {
    const execution = { mode: "api" as const, backendId: "selected", modelId: "model", bindingVersion: "v1", credentialEpoch: "old-epoch" };
    const input = await prepared(); input.proposal.origin = { kind: "model", requestId: "epoch-fixture", execution };
    selectedExecution.mockResolvedValue({ execution, revalidate: async () => true }); save.mockRejectedValueOnce(new Error("lost ack"));
    expect(await store.getState().applySmartKpiSuggestion(input)).toMatchObject({ ok: false });
    selectedExecution.mockResolvedValueOnce({ execution: { ...execution, credentialEpoch: "replacement-epoch" }, revalidate: async () => true });
    expect(await store.getState().reconcilePendingSmartKpiCommit()).toBe(false); expect(store.getState().project.graph.nodes).toHaveLength(1);
    expect(store.getState().smartKpiMutation.status).toBe("conflict"); expect(store.getState().smartKpiOperation).toBeUndefined();
  });
  it("permits explicit vault revocation during a pending write without publishing its model candidate", async () => {
    const key = "synthetic-revocable-key", execution = { mode: "api" as const, backendId: "openai_compatible", modelId: "selected", bindingVersion: "stable-binding", credentialEpoch: "retained-epoch" };
    const settings = { ...applyGatewayPreset({ ...DEFAULT_EXECUTION_SETTINGS, executionMode: "byok" }, "openai-default"), model: "selected", apiKey: key };
    store.setState({ executionSettings: settings });
    let vaultRecord: { key: string; epoch: string } | undefined = { key, epoch: execution.credentialEpoch };
    const remove = vi.fn(async () => { vaultRecord = undefined; });
    const persistence = connectApiKeyPersistence({ getSettings: () => store.getState().executionSettings,
      setApiKey: (value, scope) => store.getState().restoreApiKeyFromVault(scope!, value),
      subscribe: listener => store.subscribe((state, previous) => { if (state.executionSettings !== previous.executionSettings) listener(state.executionSettings); })
    }, { read: async () => vaultRecord?.key, write: async (_scope, value) => { if (!vaultRecord || vaultRecord.key !== value) throw new Error("Unexpected credential replacement"); }, remove }, () => {});
    await persistence.settled();
    selectedExecution.mockImplementation(async current => {
      if (!vaultRecord || current.apiKey !== vaultRecord.key) throw new Error("Credential revoked");
      return { execution: { ...execution, credentialEpoch: vaultRecord.epoch }, revalidate: async () => Boolean(vaultRecord) };
    });
    const input = await prepared(); input.proposal.origin = { kind: "model", requestId: "revocation-fixture", execution };
    let acknowledge!: (value: ReturnType<typeof saved>) => void; save.mockImplementationOnce(() => new Promise(resolve => { acknowledge = resolve; }));
    const before = store.getState().project, pending = store.getState().applySmartKpiSuggestion(input);
    await vi.waitFor(() => expect(acknowledge).toBeTypeOf("function"));
    await persistence.remove(); expect(remove).toHaveBeenCalledOnce(); expect(vaultRecord).toBeUndefined(); expect(store.getState().executionSettings.apiKey).toBe("");
    store.getState().setExecutionSettingsField("model", "guarded-change"); expect(store.getState().executionSettings.model).toBe("selected");
    acknowledge(saved()); await expect(pending).resolves.toMatchObject({ ok: false }); persistence.dispose();
    expect(store.getState().project).toBe(before); expect(store.getState().workspace.projectSummaries[0]!.vdts[0]!.head.commitGeneration).toBe(2);
    expect(store.getState().smartKpiOperation).toBeUndefined(); expect(store.getState().smartKpiMutation.status).toBe("conflict"); expect(notify).not.toHaveBeenCalled();
  });
});
