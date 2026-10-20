import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyChangeSet, kpiCanonicalJson, type VdtChangeSet } from "@vdt-studio/vdt-core";
import { createIncomingGraphFixture } from "../../../../packages/vdt-core/src/suggestions/incoming-contract.fixtures";
import { validateAndMapDeepenNode } from "@vdt-studio/ai-harness/browser";
const { cancel, getRun } = vi.hoisted(() => ({ cancel: vi.fn(), getRun: vi.fn() }));
vi.mock("@/lib/agent-client", async original => ({ ...await original<typeof import("@/lib/agent-client")>(), createAgentClient: () => ({ cancel, getRun }) }));
const memory = new Map<string, string>(); let quota = false;
vi.stubGlobal("localStorage", { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { if (quota) throw new DOMException("Synthetic quota", "QuotaExceededError"); memory.set(key, value); }, removeItem: (key: string) => memory.delete(key) });
const { useVdtStudioStore: store } = await import("./vdt-store");
const realStart = store.getState().startAgentRun;
const start = vi.fn();
const snapshot = (status: string, project = store.getState().project) => ({ runId: "structured_old", status, phase: "reporting", request: { mode: "continue_project", input: { rootKpi: "Output", project }, providerId: "mock", options: {} }, project,
  selectedSkills: [], events: [], chatMessages: [], publicStatus: { phase: "ready", message: "Stopped", updatedAt: "2026-10-20T00:00:00Z" }, visibleContext: { threadId: "structured_old", visibleTitle: "Output", brief: { rootKpi: "Output" }, visibleMessages: [] },
  executionSummary: { schemaVersion: 2, executionProfile: "model_agent", pendingOperation: null }, createdAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z" }) as unknown as NonNullable<ReturnType<typeof store.getState>["agentRun"]>;
beforeEach(() => {
  quota = false; memory.clear(); cancel.mockReset().mockResolvedValue(undefined); getRun.mockReset().mockImplementation(async () => snapshot("cancelled")); start.mockReset().mockResolvedValue(true);
  const project = createIncomingGraphFixture("measured");
  store.setState({ project, projectRevision: 1, selectedNodeId: "target", activeScenarioId: "", workspace: { activePanel: "vdt", activeProjectId: "owner", activeVdtId: undefined, projectSummaries: [], isLoading: false, isMutating: false },
    smartKpiOperation: undefined, smartKpiUndo: undefined, smartKpiRebaseRequired: undefined, smartKpiFencedRunIds: [], smartKpiMutation: { status: "idle", canUndo: false }, pendingIncomingKpiRestart: undefined,
    pendingChangeSet: undefined, pendingFileImport: undefined, changeSetSelection: new Set(), isGenerating: false, generateActivity: undefined, agentChatHistory: [], agentPendingQuestions: undefined,
    activeAgentRunId: "structured_old", agentRun: snapshot("running", project), agentConnectionStatus: "connected", startAgentRun: start, sendManualProjectChange: vi.fn() });
});
describe("bounded incoming entry boundaries", () => {
  it.each(["running", "needs_user_input"])("stops a structured %s controller before admitting a fresh selected-target run", async status => {
    store.setState({ agentRun: snapshot(status) });
    start.mockImplementation(async (_instruction, options) => { expect(options).toEqual({ mode: "deepen_node", selectedNodeId: "target", includeCurrentProject: true }); store.setState({ activeAgentRunId: "fresh_selected" }); return true; });
    expect(await store.getState().requestIncomingKpisWithAi("target")).toBe(true);
    expect(cancel).toHaveBeenCalledWith("structured_old", { awaitTerminal: true }); expect(getRun).toHaveBeenCalledOnce(); expect(start).toHaveBeenCalledOnce();
    expect(store.getState().pendingIncomingKpiRestart).toBeUndefined(); expect(store.getState().agentChatHistory.some(row => row.runId === "structured_old")).toBe(true);
    const current = kpiCanonicalJson(store.getState().project); store.getState().applyAgentGraphPatch(snapshot("running", createIncomingGraphFixture("shared_speed")));
    expect(kpiCanonicalJson(store.getState().project)).toBe(current);
  });
  it("retains an unconfirmed stop across cancelled SSE/reload and blocks another mutator", async () => {
    cancel.mockRejectedValue(new Error("Cleanup pending")); expect(await store.getState().requestIncomingKpisWithAi("target")).toBe(false);
    store.getState().applyAgentGraphPatch(snapshot("cancelled")); await store.persist.rehydrate();
    expect(store.getState().pendingIncomingKpiRestart).toMatchObject({ runId: "structured_old" });
    expect(await realStart(undefined, { mode: "deepen_node", selectedNodeId: "target", includeCurrentProject: true })).toBe(false);
    expect(await store.getState().requestIncomingKpisWithAi("target")).toBe(false); expect(start).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledTimes(2);
  });
  it("persists the stop marker before any cancellation and fails safely on quota", async () => {
    quota = true; expect(await store.getState().requestIncomingKpisWithAi("target")).toBe(false); expect(cancel).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
  });
  it("preserves an intervening user graph edit and retries only from that current graph", async () => {
    let stopped!: () => void; cancel.mockImplementationOnce(() => new Promise<void>(resolve => { stopped = resolve; }));
    const old = structuredClone(store.getState().project), pending = store.getState().requestIncomingKpisWithAi("target");
    await vi.waitFor(() => expect(stopped).toBeTypeOf("function")); store.getState().updateNodeBaselineValue("target", 99);
    store.getState().applyAgentGraphPatch(snapshot("cancelled", old)); stopped(); expect(await pending).toBe(false); expect(start).not.toHaveBeenCalled();
    expect(store.getState().project.graph.nodes.find(node => node.id === "target")?.baselineValue).toBe(99);
    getRun.mockResolvedValue(snapshot("cancelled", old)); expect(await store.getState().requestIncomingKpisWithAi("target")).toBe(true);
    expect(cancel).toHaveBeenCalledOnce(); expect(store.getState().project.graph.nodes.find(node => node.id === "target")?.baselineValue).toBe(99);
  });
  it.each(["owner", "generation"])("does not publish a late cancellation into a changed %s", async changed => {
    let stopped!: () => void; cancel.mockImplementationOnce(() => new Promise<void>(resolve => { stopped = resolve; }));
    const pending = store.getState().requestIncomingKpisWithAi("target");
    await vi.waitFor(() => expect(stopped).toBeTypeOf("function"));
    store.setState({ ...(changed === "owner" ? { workspace: { ...store.getState().workspace, activeProjectId: "other_owner", activeVdtId: "other_vdt" } } : {}),
      activeAgentRunId: "other_running", agentRun: { ...snapshot("running"), runId: "other_running" }, isGenerating: true, aiError: "other view", agentError: "other view" });
    const before = { marker: store.getState().pendingIncomingKpiRestart, workspace: store.getState().workspace, run: store.getState().agentRun };
    stopped(); expect(await pending).toBe(false);
    expect(getRun).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
    expect(store.getState()).toMatchObject({ pendingIncomingKpiRestart: before.marker, workspace: before.workspace, agentRun: before.run, activeAgentRunId: "other_running", isGenerating: true, aiError: "other view", agentError: "other view" });
    expect(store.getState().pendingIncomingKpiRestart?.terminalCleanupConfirmed).toBeUndefined();
  });
  it("retains unknown A cleanup across a B restart request and return to A", async () => {
    cancel.mockRejectedValueOnce(new Error("Cleanup pending")); expect(await store.getState().requestIncomingKpisWithAi("target")).toBe(false);
    const markerA = store.getState().pendingIncomingKpiRestart;
    store.setState({ workspace: { ...store.getState().workspace, activeProjectId: "owner_B" }, activeAgentRunId: "structured_B", agentRun: { ...snapshot("running"), runId: "structured_B" } });
    expect(await store.getState().requestIncomingKpisWithAi("target")).toBe(false);
    expect(store.getState().pendingIncomingKpiRestart).toEqual(markerA); expect(cancel).toHaveBeenCalledOnce(); expect(start).not.toHaveBeenCalled();
    expect(store.getState().aiError).toMatch(/original VDT/);
    store.setState({ workspace: { ...store.getState().workspace, activeProjectId: "owner" }, activeAgentRunId: "structured_old", agentRun: snapshot("cancelled") });
    expect(await store.getState().requestIncomingKpisWithAi("target")).toBe(true);
    expect(cancel).toHaveBeenNthCalledWith(2, "structured_old", { awaitTerminal: true }); expect(start).toHaveBeenCalledOnce();
  });
  it("retires only a positively confirmed foreign stop and fences its old callback", async () => {
    store.setState({ pendingIncomingKpiRestart: { runId: "confirmed_A", workspaceId: "owner_A", vdtId: null, terminalCleanupConfirmed: true } });
    expect(await store.getState().requestIncomingKpisWithAi("target")).toBe(true);
    expect(store.getState().smartKpiFencedRunIds).toContain("confirmed_A");
    const before = kpiCanonicalJson(store.getState().project);
    store.getState().applyAgentGraphPatch({ ...snapshot("cancelled", createIncomingGraphFixture("shared_speed")), runId: "confirmed_A" });
    expect(kpiCanonicalJson(store.getState().project)).toBe(before);
  });
  it("rejects a historical mapped child-only pending task without mutating graph/checkpoint", () => {
    const changes: VdtChangeSet = { id: "historical_child_only", taskType: "deepen_node", backendId: "fixture", createdAt: "2026-10-19T00:00:00Z", additions: [{ id: "add_child", nodeId: "child", parentNodeId: "target", relation: "formula_dependency", name: "Old child", type: "input", unit: "km/trip" }], updates: [], edgeChanges: [], deletions: [], assumptions: [], questions: [], warnings: [] };
    const before = kpiCanonicalJson(store.getState().project); store.setState({ pendingChangeSet: changes, changeSetSelection: new Set(["add_child"]) }); store.getState().applyPendingChangeSet();
    expect(kpiCanonicalJson(store.getState().project)).toBe(before); expect(store.getState().pendingChangeSet).toEqual(changes); expect(store.getState().aiActionError).toMatch(/parent formula/);
  });
  it("applies a current v2 mapped formula/type/plan once and rejects an unrelated root-plan rewrite", () => {
    const project = store.getState().project, raw = { schemaVersion: "deepen_node.v2", targetNodeId: "target", targetFormula: "child", retainedNodeIds: [], nodes: [{ id: "child", name: "New measured distance", type: "input", unit: "km/trip", description: "Unknown measured input", aiConfidence: 0.8, aiRationale: "Explicit formula input" }], edges: [{ id: "edge_new_child", sourceNodeId: "target", targetNodeId: "child", relation: "formula_dependency" }], assumptions: [], questionsForUser: [], warnings: [] };
    const { changeSet } = validateAndMapDeepenNode(project, raw, "target", "fixture"), selected = new Set([...changeSet.additions, ...changeSet.updates, ...changeSet.edgeChanges].map(row => row.id));
    const corrupted = structuredClone(changeSet); corrupted.updates.find(row => row.patch.decompositionPlan)!.patch.decompositionPlan!.goal = "Unowned replacement";
    store.setState({ pendingChangeSet: corrupted, changeSetSelection: selected }); store.getState().applyPendingChangeSet(); expect(store.getState().project).toBe(project);
    store.setState({ pendingChangeSet: changeSet, changeSetSelection: selected }); store.getState().applyPendingChangeSet();
    expect(store.getState().project.graph.nodes.find(node => node.id === "target")).toMatchObject({ type: "calculated", formula: "child", baselineValue: 4 }); expect(store.getState().project.versions).toHaveLength(1);
  });
});
