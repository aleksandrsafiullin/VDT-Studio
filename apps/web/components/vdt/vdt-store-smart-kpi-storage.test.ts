import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildKpiSuggestionContext, buildRecipeKpiSuggestions, calculateGraph, createSmartKpiMeasuredFixture, KPI_SUGGESTION_RECIPES, incomingKpiProposalFormula } from "@vdt-studio/vdt-core";
import { POST as createProject } from "@/app/api/vdt/projects/route";
import { POST as createVdt } from "@/app/api/vdt/projects/[projectId]/vdts/route";
import { GET as revisions, POST as commit } from "@/app/api/vdt/vdts/[vdtId]/revisions/route";
import { runtimeCasFromState, type StoredProjectSummary } from "@/lib/vdt-storage-client";
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
    const owner = projectBody.summary.project.id, project = createSmartKpiMeasuredFixture(0); project.graph.nodes[0]!.assumptions = ["Time period: month"];
    const created = await createVdt(request(`/api/vdt/projects/${owner}/vdts`, { schemaVersion: "create_vdt_with_initial_http_request.v1", idempotencyKey: "synthetic-smart-create",
      expectedRuntime: runtimeCasFromState(projectBody.summary.runtimeState), vdt: { requestedVdtId: "synthetic_smart_stored", name: "Synthetic KPI", rootKpi: "Output", unit: "t/month", timePeriod: "month", status: "draft", metadata: null }, project }), { params: Promise.resolve({ projectId: owner }) });
    expect(created.status).toBe(201); const body = await created.json() as { summary: StoredProjectSummary; vdt: { id: string } }; const vdtId = body.vdt.id;
    let loseResponse = true; const posted: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe(`/api/vdt/vdts/${vdtId}/revisions`);
      const params = { params: Promise.resolve({ vdtId }) };
      if (init?.method === "POST") {
        posted.push(String(init.body)); const response = await commit(new Request(`http://localhost:3000${url}`, init), params);
        expect(response.status).toBe(201);
        if (loseResponse) { loseResponse = false; throw new Error("Synthetic response loss after actual SQLite commit"); }
        return response;
      }
      return revisions(new Request(`http://localhost:3000${url}`), params);
    });
    store.setState({ project, projectRevision: 1, selectedNodeId: project.rootNodeId, activeScenarioId: project.scenarios[0]!.id,
      workspace: { activePanel: "vdt", activeProjectId: owner, activeVdtId: vdtId, projectSummaries: [body.summary], isLoading: false, isMutating: false },
      smartKpiOperation: undefined, smartKpiUndo: undefined, smartKpiMutation: { status: "idle", canUndo: false }, smartKpiFencedRunIds: [],
      agentRun: undefined, generateActivity: undefined, agentChatHistory: [], activeAgentRunId: undefined, agentPendingQuestions: undefined, agentConnectionStatus: "idle", isGenerating: false });
    const context = await buildKpiSuggestionContext(project, { ...resolveSmartKpiScope(store.getState()), targetNodeId: project.rootNodeId });
    const recipe = KPI_SUGGESTION_RECIPES.recipes.find(r => r.id === "production.time_rate")!;
    const proposal = buildRecipeKpiSuggestions(context, [{ binding: { id: "synthetic-reviewed-selection", recipeId: recipe.id, recipeHash: recipe.recipeHash, skillHash: recipe.skillHash,
      targetRole: recipe.targetRole, contextHash: context.contextHash, basis: "model_selection", sourceRef: "synthetic-preparation-only", rationale: "Synthetic explicit model recipe selection; storage is real." } }], { proposalId: "synthetic-real-route", now: new Date().toISOString() })!;
    const input = { schemaVersion: "incoming_kpi_apply.v2" as const, context, proposal, draft: { schemaVersion: "incoming_kpi_draft.v2" as const, targetNodeId: context.targetNodeId, contextHash: context.contextHash, revision: 0, source: { kind: "proposal" as const, proposalId: proposal.proposalId, groupId: proposal.groups[0]!.id }, childKeys: proposal.groups[0]!.children.map(c => c.key), manualChildren: [], existingFactors: [], formula: incomingKpiProposalFormula(proposal, proposal.groups[0]!.id)!, formulaAuthorship: "recipe" as const } };
    expect(await store.getState().applySmartKpiSuggestion(input)).toMatchObject({ ok: false }); expect(store.getState().project.graph.nodes).toHaveLength(1);
    await store.persist.rehydrate(); expect(await store.getState().reconcilePendingSmartKpiCommit()).toBe(true);
    expect(posted[1]).toBe(posted[0]); expect(calculateGraph(store.getState().project).rootValue).toBeUndefined(); expect(store.getState().project.graph.nodes[0]!.baselineValue).toBe(0);
    let list = await (await revisions(new Request("http://localhost:3000"), { params: Promise.resolve({ vdtId }) })).json();
    expect(list.revisions).toHaveLength(2); expect(store.getState().smartKpiMutation.canUndo).toBe(true);
    expect(await store.getState().undoSmartKpiSuggestion()).toBe(true); expect(store.getState().project.graph).toEqual(project.graph);
    list = await (await revisions(new Request("http://localhost:3000"), { params: Promise.resolve({ vdtId }) })).json();
    expect(list.revisions).toHaveLength(3); expect(posted[2]).toContain("smart-undo:"); expect(store.getState().project.versions[0]?.taskType).toBe("suggest_incoming_kpis");
  });
});
