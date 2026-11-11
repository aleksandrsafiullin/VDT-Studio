import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { AgentRunStore, agentStartRequestSchema, createDefaultToolRegistry, type VdtAgentStartRequest } from "@vdt-studio/vdt-agent-runtime";
import { VdtBuilderSession } from "@vdt-studio/vdt-core";
import { openVdtDatabase } from "@vdt-studio/storage";
import { createSqliteAgentRunPersistence } from "@/app/api/agent/runs/persistence";
import { createStorageWriteActor } from "@/app/api/vdt/storage-write-adapter";
import { GET as load } from "@/app/api/vdt/vdts/[vdtId]/route";
import { GET as revisions, POST as commit } from "@/app/api/vdt/vdts/[vdtId]/revisions/route";
import { smartKpiBlockedReason } from "@/lib/smart-kpi-transaction";
import { revisionCasFromHead, runtimeCasFromState, saveStoredVdtRevision } from "@/lib/vdt-storage-client";
import { navigateAfterWorkspaceSave } from "./workspace-navigation";
import { useVdtStudioStore as store } from "./vdt-store";

it.each([
  { terminal: "succeeded", editedDuringRun: false },
  { terminal: "cancelled", editedDuringRun: false },
  { terminal: "cancelled", editedDuringRun: true }
] as const)("keeps the editor revision safe after a $terminal run (local edit during run: $editedDuringRun)", async ({ terminal, editedDuringRun }) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "vdt-agent-revision-"));
  vi.stubEnv("VDT_DATA_DIR", dataDir);
  vi.stubEnv("VDT_APP_MODE", "development_web");
  const browserStorage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => browserStorage.get(key) ?? null,
    setItem: (key: string, value: string) => browserStorage.set(key, value),
    removeItem: (key: string) => browserStorage.delete(key)
  });
  store.setState(store.getInitialState(), true);
  const storage = openVdtDatabase(process.cwd(), { dataDir });
  try {
    const projectId = "agent_revision_qa";
    const vdtId = "stored_qa_vdt";
    storage.createProject({ id: projectId, name: "Agent revision QA" });
    const runtime = storage.getProjectRuntimeState(projectId)!;
    const builder = new VdtBuilderSession();
    builder.createDraft({ projectTitle: "Output", rootKpi: "Output", unit: "items" });
    builder.addDriver({ parentNodeId: "output", nodeId: "manual_driver", name: "Manual driver", unit: "items", baselineValue: 1 });
    const initial = builder.getProject();
    storage.createVdtWithInitialSnapshot({
      actor: createStorageWriteActor(projectId),
      command: {
        schemaVersion: "create_vdt_with_initial_snapshot.v1",
        projectId,
        expectedRuntimeGeneration: runtime.runtimeGeneration,
        expectedGenerationVersion: runtime.generationVersion,
        idempotencyKey: "create-agent-revision-fixture",
        vdt: { requestedVdtId: vdtId, name: "Output", rootKpi: "Output", unit: "items", timePeriod: null, status: "draft", metadata: null },
        revisionIntent: { source: "user", summary: null, validation: null, calculation: null }
      },
      project: initial
    });

    const runs = new AgentRunStore({ persistence: createSqliteAgentRunPersistence(storage) });
    const bindingId = "synthetic_model_binding";
    const params = { params: Promise.resolve({ vdtId }) };
    let lastRunId = "";
    let startRequest: VdtAgentStartRequest | undefined;
    vi.stubGlobal("EventSource", class {
      addEventListener(type: string, listener: () => void) {
        if (type === "open") listener();
      }
      close() {}
    });
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const request = new Request(`http://localhost:3000${url}`, init);
      if (url === `/api/vdt/vdts/${vdtId}`) return load(request, params);
      if (url === `/api/vdt/vdts/${vdtId}/revisions`) {
        return init?.method === "POST" ? commit(request, params) : revisions(request, params);
      }
      if (url === "/api/agent/runs" && init?.method === "POST") {
        startRequest = { ...agentStartRequestSchema.parse(await request.json()), providerId: "model_agent" } as VdtAgentStartRequest;
        lastRunId = runs.createRun(startRequest).runId;
        runs.updateRun(lastRunId, {
          status: "running",
          draftProject: startRequest.input.project,
          executionSummary: {
            schemaVersion: 2, executionProfile: "model_agent", engineId: "in-product-model-agent",
            engineAdapterId: "http-structured-test-v1", backendId: "openai_compatible",
            modelId: "fixture-model", protocolVersion: "structured-turn-v1", cliVersion: null,
            toolIsolation: "permission_only", qualificationStatus: "unverified", capabilityEvidenceHash: null,
            capabilityProfileHash: `sha256:${"a".repeat(64)}`, toolCatalogHash: `sha256:${"b".repeat(64)}`,
            sessionStatus: "checkpointed", recoveryStatus: "ready", sessionEpoch: 1, externalSessionBound: false,
            lastCheckpointId: null, pendingOperation: null, finishState: null, boundAt: initial.createdAt, updatedAt: initial.createdAt
          }
        });
        return Response.json({ ok: true, runId: lastRunId, snapshot: runs.getSnapshot(lastRunId) });
      }
      if (url === `/api/agent/runs/${lastRunId}/cancel`) {
        expect(await request.json()).toEqual({ awaitTerminal: true });
        runs.updateRun(lastRunId, { status: "cancelled", phase: "reporting" });
        return Response.json({ ok: true, terminalCleanupConfirmed: true });
      }
      if (url === `/api/agent/runs/${lastRunId}` || url === `/api/agent/runs/${lastRunId}/messages`) {
        return Response.json({ ok: true, snapshot: runs.getSnapshot(lastRunId) });
      }
      if (url === "/api/agent/runs") {
        return Response.json({
          ok: true, schemaVersion: 1, defaultBindingId: bindingId,
          bindings: [{ bindingId, executionProfile: "model_agent", backendId: "openai_compatible", modelId: "fixture-model" }]
        });
      }
      throw new Error(`Unexpected request ${url}`);
    });

    expect(await store.getState().selectWorkspaceVdt(vdtId)).toBe(true);
    const stale = store.getState();
    const staleBase = stale.workspace.draftRevisionBase!;
    expect(await store.getState().startAgentRun("Add a driver", { executionBindingId: bindingId })).toBe(true);
    expect(startRequest?.workspace?.expectedRevision?.expectedActiveRevisionId).toBe(staleBase.expectedHead.activeRevisionId);
    const agentBuilder = new VdtBuilderSession({ project: startRequest!.input.project });
    const tools = createDefaultToolRegistry();
    const context = {
      runId: lastRunId, store: runs, builder: agentBuilder,
      emit: (event: Parameters<typeof runs.appendEvent>[1]) => runs.appendEvent(lastRunId, event),
      getRun: () => runs.getSnapshot(lastRunId),
      updateRun: (patch: Parameters<typeof runs.updateRun>[1]) => runs.updateRun(lastRunId, patch),
      signal: runs.getState(lastRunId).abortController.signal
    };
    expect(await tools.run("vdt.add_driver", { parentNodeId: "output", nodeId: "agent_driver", name: "Agent driver", unit: "items" }, context)).toMatchObject({ ok: true });
    expect(await tools.run("vdt.layout", {}, context)).toMatchObject({ ok: true });
    const agentProject = agentBuilder.getProject();
    const agentHead = storage.getVdtRevisionHead(vdtId)!;
    expect(storage.listVdtRevisions(vdtId)).toHaveLength(2);
    const beforeReceipt = store.getState();
    expect(beforeReceipt.workspace.draftRevisionBase?.expectedHead).toEqual(staleBase.expectedHead);
    if (editedDuringRun) {
      store.getState().updateNode("manual_driver", { description: "Manual edit during agent run" });
    }
    const beforeStop = store.getState().project;
    if (terminal === "cancelled") {
      await store.getState().cancelAgentRun();
      expect(store.getState().generateActivity?.status).toBe("cancelled");
      expect(store.getState().pendingIncomingKpiRestart).toBeUndefined();
    } else {
      runs.updateRun(lastRunId, { status: terminal, project: agentProject, draftProject: agentProject });
      runs.updatePublicStatus(lastRunId, { phase: "ready", message: "Completed." });
      runs.appendEvent(lastRunId, { type: "run_completed", title: "Complete", message: "Completed." });
      store.getState().applyAgentGraphPatch(runs.getSnapshot(lastRunId));
    }
    const completed = runs.getSnapshot(lastRunId);
    expect(completed.workspaceRevision?.head).toEqual(agentHead);
    const afterReceipt = store.getState();
    if (editedDuringRun) {
      expect(afterReceipt.project).toBe(beforeStop);
      expect(afterReceipt.workspace.draftRevisionBase).toBe(beforeReceipt.workspace.draftRevisionBase);
      const navigate = vi.fn();
      expect(await navigateAfterWorkspaceSave(`/projects/${projectId}`, afterReceipt, navigate)).toBe(false);
      expect(navigate).not.toHaveBeenCalled();
      expect(store.getState().project).toBe(beforeStop);
      expect(storage.getVdtRevisionHead(vdtId)).toEqual(agentHead);
      return;
    }
    expect(afterReceipt.project).toEqual(agentProject);
    const owner = afterReceipt.workspace.projectSummaries.find((summary) => summary.project.id === projectId)!;
    const listed = owner.vdts.find((entry) => entry.vdt.id === vdtId)!;
    expect(afterReceipt.workspace.draftRevisionBase?.expectedHead).toEqual(revisionCasFromHead(agentHead));
    expect(revisionCasFromHead(listed.head)).toEqual(afterReceipt.workspace.draftRevisionBase?.expectedHead);
    expect(runtimeCasFromState(owner.runtimeState)).toEqual(afterReceipt.workspace.draftRevisionBase?.expectedRuntime);
    expect(smartKpiBlockedReason(afterReceipt)).toBeUndefined();

    if (terminal === "cancelled") {
      const navigate = vi.fn();
      expect(await navigateAfterWorkspaceSave(`/projects/${projectId}`, afterReceipt, navigate)).toBe(true);
      expect(navigate).toHaveBeenCalledWith(`/projects/${projectId}`);
      const saved = storage.listVdtRevisions(vdtId).at(-1)!;
      expect(saved.parentRevisionId).toBe(agentHead.activeRevisionId);
      expect(storage.readVdtRevision(saved).graph).toEqual(agentProject.graph);
      expect(await store.getState().selectWorkspaceVdt(vdtId, { discardLocalEdits: true })).toBe(true);
      expect(store.getState().project.graph).toEqual(agentProject.graph);
      return;
    }

    store.getState().updateNode("agent_driver", { description: "Manually edited after agent" });
    const editedProject = store.getState().project;
    store.getState().applyAgentGraphPatch(completed);
    expect(store.getState().project).toBe(editedProject);
    const navigate = vi.fn();
    expect(await navigateAfterWorkspaceSave(`/projects/${projectId}`, store.getState(), navigate)).toBe(true);
    expect(navigate).toHaveBeenCalledWith(`/projects/${projectId}`);
    expect(await store.getState().selectWorkspaceVdt(vdtId, { discardLocalEdits: true })).toBe(true);
    expect(store.getState().project.graph.nodes.find((node) => node.id === "agent_driver")?.description).toBe("Manually edited after agent");
    const restarted = new AgentRunStore({ persistence: createSqliteAgentRunPersistence(storage) });
    const historical = restarted.getSnapshot(completed.runId);
    expect(historical.status).toBe(terminal);
    expect(historical.workspaceRevision).toBeUndefined();

    // A delayed receipt cannot displace a newer cached head, even when this
    // editor still owns its untouched original run draft.
    const summariesAfterManualSave = store.getState().workspace.projectSummaries;
    store.setState({ ...beforeReceipt, workspace: { ...beforeReceipt.workspace, projectSummaries: summariesAfterManualSave } });
    store.getState().applyAgentGraphPatch(completed);
    expect(store.getState().workspace.projectSummaries).toBe(summariesAfterManualSave);
    expect(store.getState().workspace.draftRevisionBase).toBe(beforeReceipt.workspace.draftRevisionBase);
    expect(store.getState().project).toBe(beforeReceipt.project);

    // A separate editor with the old base still cannot advance its CAS.
    store.setState({ project: stale.project, workspace: stale.workspace });
    store.getState().updateNode("manual_driver", { description: "Unsaved stale-tab edit" });
    expect(await store.getState().saveActiveWorkspaceVdt()).toBe(false);
    expect(store.getState().project.graph.nodes.find((node) => node.id === "manual_driver")?.description).toBe("Unsaved stale-tab edit");
    expect(storage.listVdtRevisions(vdtId)).toHaveLength(3);

    // The server also refuses stale starts, including old clients that omit CAS.
    expect(() => runs.createRun(startRequest!)).toThrowError(expect.objectContaining({ code: "REVISION_CONFLICT" }));
    const { expectedRevision: _expectedRevision, ...legacyWorkspace } = startRequest!.workspace!;
    const legacyRun = runs.createRun({ ...startRequest!, workspace: legacyWorkspace });
    expect(() => runs.updateRun(legacyRun.runId, { draftProject: initial })).toThrowError(expect.objectContaining({ code: "REVISION_CONFLICT" }));

    // A newly started continuation pins revision 3 before another editor deletes a KPI.
    expect(await store.getState().selectWorkspaceVdt(vdtId, { discardLocalEdits: true })).toBe(true);
    expect(await store.getState().startAgentRun("Continue the tree", { executionBindingId: bindingId })).toBe(true);
    const beforeDelete = store.getState().project;
    const deletionBase = store.getState().workspace.draftRevisionBase!;
    const deleted = {
      ...beforeDelete,
      graph: {
        nodes: beforeDelete.graph.nodes.filter((node) => node.id !== "manual_driver"),
        edges: beforeDelete.graph.edges.filter((edge) => edge.targetNodeId !== "manual_driver")
      }
    };
    await saveStoredVdtRevision(vdtId, {
      expectedHead: deletionBase.expectedHead,
      expectedRuntime: runtimeCasFromState(runtime),
      idempotencyKey: "other-tab-deletion", summary: "Manual deletion", project: deleted
    });
    const lateBuilder = new VdtBuilderSession({ project: beforeDelete });
    await expect(tools.run("vdt.add_driver", { parentNodeId: "output", nodeId: "late_driver", name: "Late driver", unit: "items" }, {
      ...context, runId: lastRunId, builder: lateBuilder
    })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    runs.updateRun(lastRunId, { status: "recovery_required" });
    const reopened = new AgentRunStore({ persistence: createSqliteAgentRunPersistence(storage) });
    expect(reopened.getSnapshot(lastRunId)).toMatchObject({ status: "recovery_required", workspaceRevision: undefined });
    const history = storage.listVdtRevisions(vdtId);
    expect(history).toHaveLength(4);
    expect(storage.readVdtRevision(history.at(-1)!).graph).toEqual(deleted.graph);
  } finally {
    store.getState().startNewAgentChat();
    storage.close();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await rm(dataDir, { recursive: true, force: true });
  }
});
