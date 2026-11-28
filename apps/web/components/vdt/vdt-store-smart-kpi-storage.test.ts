import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildKpiSuggestionContext, buildRecipeKpiSuggestions, calculateGraph, createSmartKpiMeasuredFixture, KPI_SUGGESTION_RECIPES, incomingKpiProposalFormula } from "@vdt-studio/vdt-core";
import { POST as createProject } from "@/app/api/vdt/projects/route";
import { POST as createVdt } from "@/app/api/vdt/projects/[projectId]/vdts/route";
import { GET as revisions, POST as commit } from "@/app/api/vdt/vdts/[vdtId]/revisions/route";
import { runtimeCasFromState, workspaceDraftBase, type StoredProjectSummary } from "@/lib/vdt-storage-client";
import { EditorHandoffController, editorHandoffView } from "@/lib/editor-handoff-controller";
import { matchingSavedSmartHandoff, savedSmartHandoffHeadIsCurrent } from "@/lib/smart-kpi-transaction";
import { resolveSmartKpiScope } from "@/lib/smart-kpi-scope";
const memory = new Map<string, string>();
vi.stubGlobal("localStorage", { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value), removeItem: (key: string) => memory.delete(key) });
const { useVdtStudioStore: store } = await import("./vdt-store");
const directories: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

describe("Smart through real SQLite revision routes", () => {
  it("replays a lost response without a duplicate revision, then Undo appends a real CAS revision", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "vdt-smart-storage-route-")); directories.push(directory);
    vi.stubEnv("VDT_DATA_DIR", directory); vi.stubEnv("VDT_APP_MODE", "development_web");
    const request = (url: string, body: unknown) => new Request(`http://localhost:3000${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const createdProject = await createProject(request("/api/vdt/projects", { name: "Synthetic Smart route QA" }));
    expect(createdProject.status).toBe(201); const projectBody = await createdProject.json() as { summary: StoredProjectSummary };
    const owner = projectBody.summary.project.id, project = createSmartKpiMeasuredFixture(0); project.graph.nodes[0]!.assumptions = ["Time period: month"]; project.scenarios[0]!.isMain = true;
    const created = await createVdt(request(`/api/vdt/projects/${owner}/vdts`, { schemaVersion: "create_vdt_with_initial_http_request.v1", idempotencyKey: "synthetic-smart-create",
      expectedRuntime: runtimeCasFromState(projectBody.summary.runtimeState), vdt: { requestedVdtId: "synthetic_smart_stored", name: "Synthetic KPI", rootKpi: "Output", unit: "t/month", timePeriod: "month", status: "draft", metadata: null }, project }), { params: Promise.resolve({ projectId: owner }) });
    expect(created.status).toBe(201); const body = await created.json() as { summary: StoredProjectSummary; vdt: { id: string } }; const vdtId = body.vdt.id;
    let loseResponse = true; const posted: string[] = []; const statuses: number[] = [];
    let remotePendingRevision: string | undefined;
    let deferOneRead: Promise<void> | undefined;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe(`/api/vdt/vdts/${vdtId}/revisions`);
      const params = { params: Promise.resolve({ vdtId }) };
      if (init?.method === "POST") {
        posted.push(String(init.body)); const response = await commit(new Request(`http://localhost:3000${url}`, init), params);
        statuses.push(response.status);
        if (loseResponse) { loseResponse = false; throw new Error("Synthetic response loss after actual SQLite commit"); }
        return response;
      }
      const defer = deferOneRead;
      deferOneRead = undefined;
      const actual = await revisions(new Request(`http://localhost:3000${url}`), params);
      await defer;
      if (!remotePendingRevision) return actual;
      const payload = await actual.json();
      return Response.json({ ...payload, head: { ...payload.head, pendingRevisionId: remotePendingRevision } });
    });
    store.setState({ project, projectRevision: 1, selectedNodeId: project.rootNodeId, activeScenarioId: project.scenarios[0]!.id,
      workspace: { activePanel: "vdt", activeProjectId: owner, activeVdtId: vdtId, projectSummaries: [body.summary], isLoading: false, isMutating: false,
        draftRevisionBase: workspaceDraftBase(body.summary.vdts[0]!.head, runtimeCasFromState(body.summary.runtimeState)) },
      smartKpiOperation: undefined, smartKpiUndo: undefined, smartKpiMutation: { status: "idle", canUndo: false }, smartKpiFencedRunIds: [],
      agentRun: undefined, generateActivity: undefined, agentChatHistory: [], activeAgentRunId: undefined, agentPendingQuestions: undefined, agentConnectionStatus: "idle", isGenerating: false });
    const context = await buildKpiSuggestionContext(project, { ...resolveSmartKpiScope(store.getState()), targetNodeId: project.rootNodeId });
    const recipe = KPI_SUGGESTION_RECIPES.recipes.find(r => r.id === "production.time_rate")!;
    const proposal = buildRecipeKpiSuggestions(context, [{ binding: { id: "synthetic-reviewed-selection", recipeId: recipe.id, recipeHash: recipe.recipeHash, skillHash: recipe.skillHash,
      targetRole: recipe.targetRole, contextHash: context.contextHash, basis: "model_selection", sourceRef: "synthetic-preparation-only", rationale: "Synthetic explicit model recipe selection; storage is real." } }], { proposalId: "synthetic-real-route", now: new Date().toISOString() })!;
    const input = { schemaVersion: "incoming_kpi_apply.v2" as const, context, proposal, draft: { schemaVersion: "incoming_kpi_draft.v2" as const, targetNodeId: context.targetNodeId, contextHash: context.contextHash, revision: 0, source: { kind: "proposal" as const, proposalId: proposal.proposalId, groupId: proposal.groups[0]!.id }, childKeys: proposal.groups[0]!.children.map(c => c.key), manualChildren: [], existingFactors: [], formula: incomingKpiProposalFormula(proposal, proposal.groups[0]!.id)!, formulaAuthorship: "recipe" as const, inputValues: { p_1: "8" } } };
    const view = editorHandoffView(store.getState());
    const handoff = { action: "suggested_kpis" as const, projectId: owner, vdtId,
      revisionId: view.revisionId!, nodeId: context.targetNodeId };
    const identity = { runId: "origin_run", id: "exact_handoff", handoff };
    const controller = new EditorHandoffController();
    const attempt = controller.start(identity, view)!;
    const match = (candidate = handoff, runId = identity.runId, artifactId = identity.id) =>
      matchingSavedSmartHandoff(store.getState(), runId, artifactId, candidate);
    expect(attempt.savedSmartHandoff(view, "wrong_target")).toBeUndefined();
    const wrongTarget = controller.start({ ...identity, id: "wrong_control", handoff: { ...handoff, nodeId: "wrong_target" } }, view)!;
    const cancelled = controller.start({ ...identity, id: "cancelled_control" }, view)!;
    cancelled.cancel();
    for (const rejected of [wrongTarget, cancelled]) {
      expect(await store.getState().applySmartKpiSuggestion(input, rejected)).toMatchObject({ ok: false, reason: expect.stringContaining("no longer matches") });
    }
    expect(posted).toHaveLength(0);
    expect(await store.getState().applySmartKpiSuggestion(input, attempt)).toMatchObject({ ok: false });
    expect(store.getState().project.graph.nodes).toHaveLength(1);
    expect(match()).toBeUndefined();
    expect(store.getState().smartKpiOperation?.editorHandoff).toMatchObject({ baseRevisionId: handoff.revisionId, artifactId: identity.id });
    expect(new EditorHandoffController().state(identity.runId, identity.id)).toBeUndefined();
    await store.persist.rehydrate(); expect(await store.getState().reconcilePendingSmartKpiCommit()).toBe(true);
    const receipt = match()!;
    expect(receipt?.savedEditorHandoff).toMatchObject({ runId: identity.runId, artifactId: identity.id, targetNodeId: context.targetNodeId });
    expect(posted[1]).toBe(posted[0]);
    expect(JSON.parse(posted[1]!).idempotencyKey).toBe(`smart-add:${vdtId}:${receipt.operationId}`);
    const verify = () => savedSmartHandoffHeadIsCurrent(receipt, () => match() === receipt);
    expect(await verify()).toBe(true);
    remotePendingRevision = "same_head_new_reservation";
    expect(await verify()).toBe(false);
    remotePendingRevision = undefined;
    await store.persist.rehydrate();
    expect(match()).toEqual(receipt);
    const reopenedReceipt = match()!;
    const reopenedVerify = () => savedSmartHandoffHeadIsCurrent(reopenedReceipt, () => match() === reopenedReceipt);
    const workspaceBeforeSwitch = store.getState().workspace;
    let releaseRead!: () => void;
    deferOneRead = new Promise<void>(resolve => { releaseRead = resolve; });
    const lateAfterScopeSwitch = reopenedVerify();
    store.setState({ workspace: { ...workspaceBeforeSwitch, activeVdtId: "different_vdt" } });
    releaseRead();
    expect(await lateAfterScopeSwitch).toBe(false);
    store.setState({ workspace: workspaceBeforeSwitch });
    const withPending = { ...workspaceBeforeSwitch, projectSummaries: workspaceBeforeSwitch.projectSummaries.map(summary => ({
      ...summary, vdts: summary.vdts.map(entry => ({ ...entry, head: { ...entry.head, pendingRevisionId: "cached_pending" } }))
    })) };
    store.setState({ workspace: withPending });
    expect(match()).toBeUndefined();
    store.setState({ workspace: workspaceBeforeSwitch });
    expect(match(handoff, "wrong_run")).toBeUndefined();
    expect(match(handoff, identity.runId, "wrong_card")).toBeUndefined();
    expect(match({ ...handoff, projectId: "wrong_project" })).toBeUndefined();
    expect(match({ ...handoff, vdtId: "wrong_vdt" })).toBeUndefined();
    expect(match({ ...handoff, revisionId: "wrong_base" })).toBeUndefined();
    expect(match({ ...handoff, nodeId: "wrong_node" })).toBeUndefined();
    store.setState({ workspace: { ...store.getState().workspace, isMutating: true } });
    expect(match()).toBeUndefined();
    store.setState({ workspace: { ...store.getState().workspace, isMutating: false } });
    expect(match()).toEqual(receipt); expect(calculateGraph(store.getState().project).rootValue).toBe(0); expect(store.getState().project.graph.nodes[0]!.baselineValue).toBe(0);
    let list = await (await revisions(new Request("http://localhost:3000"), { params: Promise.resolve({ vdtId }) })).json();
    expect(list.revisions).toHaveLength(2); expect(store.getState().smartKpiMutation.canUndo).toBe(true);
    deferOneRead = new Promise<void>(resolve => { releaseRead = resolve; });
    const lateAfterUndo = reopenedVerify();
    expect(await store.getState().undoSmartKpiSuggestion()).toBe(true);
    releaseRead();
    expect(await lateAfterUndo).toBe(false);
    expect(match()).toBeUndefined();
    expect(await savedSmartHandoffHeadIsCurrent(receipt, () => true)).toBe(false); expect(store.getState().project.graph).toEqual(project.graph);
    list = await (await revisions(new Request("http://localhost:3000"), { params: Promise.resolve({ vdtId }) })).json();
    expect(list.revisions).toHaveLength(3); expect(posted[2]).toContain("smart-undo:"); expect(store.getState().project.versions[0]?.taskType).toBe("suggest_incoming_kpis");
    expect(await store.getState().saveActiveWorkspaceVdt()).toBe(true);
    expect(JSON.parse(posted[3]!).expectedHead.commitGeneration).toBe(3);
    expect(statuses).toEqual([201, 201, 201, 200]);
    const unchanged = await (await revisions(new Request("http://localhost:3000"), { params: Promise.resolve({ vdtId }) })).json();
    expect(unchanged.head).toEqual(list.head);
    expect(unchanged.revisions).toHaveLength(3);
  });
});
