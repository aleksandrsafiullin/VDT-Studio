import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { kpiCanonicalJson } from "@vdt-studio/vdt-core";
import { createIncomingGraphFixture } from "../../../../packages/vdt-core/src/suggestions/incoming-contract.fixtures";
import type { VdtAgentRunSnapshot } from "@/lib/agent-client";
import { smartKpiBlockedReason } from "@/lib/smart-kpi-transaction";

const { cancel, getRun, subscribe, disconnect } = vi.hoisted(() => ({
  cancel: vi.fn(), getRun: vi.fn(), subscribe: vi.fn(), disconnect: vi.fn()
}));
vi.mock("@/lib/agent-client", async original => ({
  ...await original<typeof import("@/lib/agent-client")>(),
  createAgentClient: () => ({ cancel, getRun, subscribe })
}));
const originalFetch = globalThis.fetch;
const memory = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => memory.set(key, value),
  removeItem: (key: string) => memory.delete(key)
});
const { useVdtStudioStore: store } = await import("./vdt-store");
const timestamp = "2026-10-21T10:00:00.000Z";
function snapshot(status: "needs_user_input" | "cancelled"): VdtAgentRunSnapshot {
  return {
    runId: "paused_agent", status, phase: "asking_clarifying_questions",
    request: { mode: "deepen_node", input: { rootKpi: "Output" }, providerId: "mock", options: {} },
    project: createIncomingGraphFixture("measured"), selectedSkills: [], events: [], chatMessages: [],
    publicStatus: { phase: "waiting_user", message: "Waiting for your answer.", updatedAt: timestamp },
    visibleContext: { threadId: "paused_agent", visibleTitle: "Output", brief: { rootKpi: "Output" }, visibleMessages: [] },
    pendingQuestions: [{ id: "basis", question: "Which basis?", reason: "Required.", required: true }],
    executionSummary: {
      schemaVersion: 2, executionProfile: "model_agent", engineId: "in-product-model-agent", engineAdapterId: "http-structured-test-v1",
      backendId: "mock", modelId: "fixture", protocolVersion: "structured-turn-v1", cliVersion: null,
      toolIsolation: "permission_only", qualificationStatus: "unverified", capabilityEvidenceHash: null,
      capabilityProfileHash: `sha256:${"a".repeat(64)}`, toolCatalogHash: `sha256:${"b".repeat(64)}`,
      sessionStatus: "checkpointed", recoveryStatus: "ready", sessionEpoch: 1, externalSessionBound: false,
      lastCheckpointId: "fixture-checkpoint", pendingOperation: null, finishState: null, boundAt: timestamp, updatedAt: timestamp
    },
    createdAt: timestamp, updatedAt: timestamp
  };
}
beforeEach(() => {
  memory.clear(); cancel.mockReset().mockResolvedValue(undefined);
  getRun.mockReset().mockResolvedValue(snapshot("cancelled"));
  disconnect.mockReset(); subscribe.mockReset().mockReturnValue(disconnect);
  const project = createIncomingGraphFixture("measured");
  store.setState({ project, projectRevision: 1, selectedNodeId: "target", activeScenarioId: "",
    workspace: { activePanel: "vdt", activeProjectId: "owner", activeVdtId: undefined, projectSummaries: [], isLoading: false, isMutating: false },
    smartKpiOperation: undefined, smartKpiRebaseRequired: undefined, smartKpiFencedRunIds: [], smartKpiMutation: { status: "idle", canUndo: false },
    pendingIncomingKpiRestart: undefined, agentChatHistory: [], agentRun: undefined, generateActivity: undefined,
    activeAgentRunId: undefined, agentPendingQuestions: undefined, aiError: undefined, agentError: undefined, isGenerating: false
  });
  store.getState().applyAgentGraphPatch(snapshot("needs_user_input"));
  store.getState().connectAgentEvents("paused_agent");
});
afterEach(() => { store.getState().startNewAgentChat(); });

describe("ordinary Cancel and Smart availability", () => {
  it("keeps compatibility-agent Cancel usable without requiring a Supervisor cleanup receipt", async () => {
    const run = store.getState().agentRun!;
    store.setState({ agentRun: { ...run, executionSummary: { ...run.executionSummary!, engineAdapterId: "http-compatibility-v1" } } });
    await store.getState().cancelAgentRun();
    expect(cancel).toHaveBeenCalledWith("paused_agent", undefined);
    expect(store.getState().generateActivity?.status).toBe("cancelled");
    expect(store.getState().pendingIncomingKpiRestart).toBeUndefined();
  });

  it("allows retry after a server failure, confirms cleanup, preserves graph edits and unblocks Smart", async () => {
    cancel.mockRejectedValueOnce(new Error("Agent cancellation failed. Retry Cancel."));
    store.getState().cancelGenerate();
    await vi.waitFor(() => expect(store.getState().agentError).toContain("Retry Cancel"));
    expect(store.getState().generateActivity).toMatchObject({ status: "needs_user_input", cancelRequested: false, canCancel: true });
    expect(disconnect).not.toHaveBeenCalled();
    expect(smartKpiBlockedReason(store.getState())).toMatch(/cleanup|active agent/);
    expect(store.getState().pendingIncomingKpiRestart).toMatchObject({ runId: "paused_agent" });

    store.getState().updateNodeBaselineValue("target", 99);
    const before = kpiCanonicalJson(store.getState().project), revision = store.getState().projectRevision;
    await store.getState().cancelAgentRun();
    expect(cancel).toHaveBeenLastCalledWith("paused_agent", { awaitTerminal: true });
    expect(store.getState().generateActivity).toMatchObject({ status: "cancelled", cancelRequested: false, canCancel: false });
    expect(store.getState().agentPendingQuestions).toBeUndefined();
    expect(store.getState().isGenerating).toBe(false);
    expect(store.getState().activeAgentRunId).toBeUndefined();
    expect(store.getState().pendingIncomingKpiRestart).toBeUndefined();
    expect(store.getState().smartKpiFencedRunIds).toContain("paused_agent");
    expect(store.getState().aiError).toBeUndefined();
    expect(smartKpiBlockedReason(store.getState())).toBeUndefined();
    expect(kpiCanonicalJson(store.getState().project)).toBe(before);
    expect(store.getState().projectRevision).toBe(revision);
    store.getState().applyAgentGraphPatch(snapshot("needs_user_input"));
    expect(smartKpiBlockedReason(store.getState())).toBeUndefined();
  });

  it("replays a confirmed interrupted stop after the terminal read fails and the browser reloads", async () => {
    const paused = snapshot("needs_user_input");
    const interrupted = {
      ...paused, status: "recovery_required" as const, pendingQuestions: undefined,
      executionSummary: { ...paused.executionSummary!, sessionStatus: "recovery_required" as const, recoveryStatus: "recovery_required" as const }
    };
    store.getState().applyAgentGraphPatch(interrupted);
    expect(store.getState().generateActivity).toMatchObject({ status: "recovery_required", canCancel: true });
    expect(store.getState().agentPendingQuestions).toBeUndefined();
    getRun.mockRejectedValueOnce(new Error("Network disconnected after the stop committed."));
    await store.getState().cancelAgentRun();
    expect(store.getState().pendingIncomingKpiRestart).toMatchObject({ terminalCleanupConfirmed: true });
    await store.persist.rehydrate();
    expect(smartKpiBlockedReason(store.getState())).toMatch(/cleanup/);
    await store.getState().cancelAgentRun();
    expect(cancel).toHaveBeenCalledOnce();
    expect(store.getState().pendingIncomingKpiRestart).toBeUndefined();
    expect(smartKpiBlockedReason(store.getState())).toBeUndefined();
  });

  it.each(["clean", "dirty", "late edit"] as const)("keeps the original scoped when opening a saved copy from a %s draft", async variant => {
    const interrupted = { ...snapshot("needs_user_input"), status: "recovery_required" as const };
    store.getState().applyAgentGraphPatch(interrupted);
    const source = store.getState();
    const owner = { id: "owner", name: "Owner" };
    const vdt = { id: "copy", projectId: "owner", name: "Saved copy" };
    const head = { schemaVersion: "vdt_revision_head.v2" as const, vdtId: "copy", projectId: "owner", activeRevisionId: "copy_revision",
      activeContentIdentity: null, pendingRevisionId: null, commitGeneration: 1 };
    const runtimeState = { schemaVersion: "project_runtime_state.v1", projectId: "owner", runtimeGeneration: "v1", generationVersion: 1,
      migrationState: "not_started", writeState: "enabled", updatedAt: timestamp };
    store.setState({
      workspace: { ...source.workspace, activeVdtId: "original",
        draftRevisionBase: { projectId: "owner", vdtId: "original", expectedHead: { schemaVersion: "vdt_revision_cas.v1",
          activeRevisionId: "original_revision", activeContentIdentity: null, commitGeneration: 1 },
          expectedRuntime: { schemaVersion: "project_runtime_cas.v1", runtimeGeneration: "v1", generationVersion: 1 } }
      },
      pendingIncomingKpiRestart: { runId: interrupted.runId, workspaceId: "owner", vdtId: "original" }
    });
    if (variant === "dirty") store.getState().updateNodeBaselineValue("target", 99);
    const mockFetch = vi.fn()
      .mockImplementationOnce(async () => {
        if (variant === "late edit") store.getState().updateNodeBaselineValue("target", 99);
        return Response.json({ ok: true, vdtId: "copy" });
      })
      .mockResolvedValueOnce(Response.json({ ok: true, schemaVersion: "vdt_load_response.v1", vdt, head, runtimeState,
        summary: { project: owner, vdts: [{ vdt, head }], runtimeState }, revisions: [], activeProject: source.project }));
    vi.stubGlobal("fetch", mockFetch);
    try {
      await store.getState().continueFromSavedCopy();
      if (variant !== "clean") {
        expect(store.getState().workspace.activeVdtId).toBe("original");
        expect(kpiCanonicalJson(store.getState().project)).not.toBe(kpiCanonicalJson(source.project));
        expect(store.getState().pendingIncomingKpiRestart?.runId).toBe(interrupted.runId);
        expect(mockFetch.mock.calls.every(([url, init]) => String(url).includes("saved-copy") || !init?.method)).toBe(true);
        return;
      }
      expect(store.getState().workspace.activeVdtId).toBe("copy");
      expect(store.getState().pendingIncomingKpiRestart).toBeUndefined();
      expect(store.getState().savedCopyStopMarkers?.original?.runId).toBe(interrupted.runId);
      await store.persist.rehydrate();
      store.getState().applyAgentGraphPatch(interrupted);
      expect(store.getState().agentRun).toBeUndefined();
      expect(store.getState().savedCopyStopMarkers?.original?.runId).toBe(interrupted.runId);
      expect(smartKpiBlockedReason(store.getState())).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.stubGlobal("fetch", originalFetch);
      store.setState({ savedCopyStopMarkers: undefined });
    }
  });

  it("keeps cancelled SSE and reload from bypassing unconfirmed cleanup, while restoring Cancel for retry", async () => {
    let reject!: (error: Error) => void;
    cancel.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    store.getState().cancelGenerate();
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    store.getState().applyAgentGraphPatch(snapshot("cancelled"));
    expect(store.getState().generateActivity?.status).toBe("needs_user_input");
    await store.persist.rehydrate();
    expect(store.getState().generateActivity).toMatchObject({ cancelRequested: false, canCancel: true });
    expect(smartKpiBlockedReason(store.getState())).toMatch(/cleanup/);
    reject(new Error("Cleanup not confirmed."));
    await vi.waitFor(() => expect(store.getState().agentError).toBe("Cleanup not confirmed."));
  });

  it.each(["success", "failure"])("ignores a late cancellation %s after changing the active VDT and run", async outcome => {
    let resolve!: () => void, reject!: (error: Error) => void;
    cancel.mockImplementationOnce(() => new Promise<void>((done, fail) => { resolve = done; reject = fail; }));
    const pending = store.getState().cancelAgentRun();
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    store.setState({ workspace: { ...store.getState().workspace, activeProjectId: "other_owner" },
      activeAgentRunId: "other_run", agentRun: { ...snapshot("needs_user_input"), runId: "other_run" },
      aiError: "other view", agentError: "other view", agentConnectionStatus: "connected" });
    if (outcome === "success") resolve(); else reject(new Error("Old run failure."));
    await pending;
    expect(getRun).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
    expect(store.getState()).toMatchObject({ activeAgentRunId: "other_run", aiError: "other view", agentError: "other view", agentConnectionStatus: "connected" });
  });
});
