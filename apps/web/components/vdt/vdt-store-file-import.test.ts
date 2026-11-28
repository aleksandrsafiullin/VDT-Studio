import { beforeEach, describe, expect, it, vi } from "vitest";
import { productionVolumeProject, type VdtChangeSet } from "@vdt-studio/vdt-core";
import { EditorHandoffController, editorHandoffView, matchingFileHandoffDraftReceipt } from "@/lib/editor-handoff-controller";
import { workspaceDraftBase, type StoredProjectSummary } from "@/lib/vdt-storage-client";
import { captureFileImportTarget } from "@/components/data-import/import-context";

const storage = new Map<string, string>();
const setItem = vi.fn((key: string, value: string) => storage.set(key, value));
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem,
  removeItem: (key: string) => storage.delete(key)
});
const { useVdtStudioStore } = await import("./vdt-store");

function createChangeSet(): VdtChangeSet {
  return {
    id: "file_hierarchy", taskType: "analyze_raw_dataset", backendId: "data_harness", createdAt: "2026-10-16T00:00:00Z",
    additions: [{ id: "add_repair", nodeId: "repair", parentNodeId: productionVolumeProject.rootNodeId, relation: "additive_component", name: "Repair", type: "input", unit: "h", baselineValue: 2, tags: ["incoming_kpi_breakdown"] }],
    updates: [{ id: "parent_sum", nodeId: productionVolumeProject.rootNodeId, patch: { formula: "repair" } }],
    deletions: [], edgeChanges: [], assumptions: [], questions: [], warnings: []
  };
}
function context() { const state = useVdtStudioStore.getState(); return captureFileImportTarget(state.project, state.workspace, state.project.rootNodeId)!; }

const date = "2026-10-16T00:00:00Z";
const summary = {
  project: { id: "owner_file", name: "Owner", createdAt: date, updatedAt: date },
  runtimeState: { schemaVersion: "project_runtime_state.v1", projectId: "owner_file", runtimeGeneration: "v1",
    generationVersion: 1, migrationState: "shadow_ready", writeState: "enabled", updatedAt: date },
  counts: { vdts: 1, revisions: 1, conversations: 0, agentRuns: 0, mutationProposals: 0, comparisons: 0 },
  vdts: [{
    vdt: { id: "vdt_file", projectId: "owner_file", name: "File VDT", rootKpi: "Output",
      status: "draft", createdAt: date, updatedAt: date },
    head: { schemaVersion: "vdt_revision_head.v2", projectId: "owner_file", vdtId: "vdt_file",
      activeRevisionId: "revision_file_1", activeContentIdentity: null, pendingRevisionId: null, commitGeneration: 1 },
    revisionCount: 1
  }]
} satisfies StoredProjectSummary;

function issueFileHandoff() {
  const controller = new EditorHandoffController();
  const state = useVdtStudioStore.getState();
  const scope = context();
  const issued = { runId: "origin", id: "file", handoff: {
    action: "file_import" as const, projectId: scope.projectId, vdtId: scope.vdtId,
    revisionId: "revision_file_1", nodeId: scope.targetNodeId
  } };
  const start = () => controller.start(issued, editorHandoffView(useVdtStudioStore.getState()))!;
  return { controller, state, scope, issued, start };
}

async function reopen(persisted: string) {
  useVdtStudioStore.setState({ fileHandoffDraftReceipt: undefined, pendingChangeSet: undefined, pendingFileImport: undefined });
  storage.set("vdt-studio-state", persisted);
  await useVdtStudioStore.persist.rehydrate();
  return useVdtStudioStore.getState();
}

beforeEach(() => {
  storage.clear();
  setItem.mockClear();
  const project = structuredClone(productionVolumeProject);
  project.id = "vdt_file";
  project.graph.nodes = [{ ...project.graph.nodes.find((node) => node.id === project.rootNodeId)!, formula: undefined, unit: "h" }];
  project.graph.edges = [];
  project.scenarios = [];
  project.dataSources = [];
  useVdtStudioStore.setState((state) => ({
    project, projectRevision: 0, selectedNodeId: project.rootNodeId, pendingChangeSet: undefined, pendingFileImport: undefined,
    fileHandoffDraftReceipt: undefined, aiActionError: undefined, changeSetSelection: new Set(),
    workspace: { ...state.workspace, activePanel: "vdt", activeProjectId: "owner_file", activeVdtId: "vdt_file",
      projectSummaries: [summary], draftRevisionBase: workspaceDraftBase(summary.vdts[0]!.head, {
        schemaVersion: "project_runtime_cas.v1", runtimeGeneration: "v1", generationVersion: 1
      }) },
    sendManualProjectChange: vi.fn(async () => {})
  }));
});

describe("file hierarchy change-set safety", () => {
  it("stages and applies a legacy graph whose id differs from both owning project and VDT record", () => {
    useVdtStudioStore.setState((state) => ({ project: { ...state.project, id: "legacy_graph_project" } }));
    const state = useVdtStudioStore.getState();
    const target = context();
    expect(target).toMatchObject({ projectId: "owner_file", vdtId: "vdt_file", graphProjectId: "legacy_graph_project" });
    expect(state.stageDataDiscoveryChangeSet(createChangeSet(), target)).toBe(true);
    state.applyPendingChangeSet();
    expect(useVdtStudioStore.getState().project.id).toBe("legacy_graph_project");
    expect(useVdtStudioStore.getState().project.graph.nodes.some((node) => node.id === "repair")).toBe(true);
  });
  it("stages the exact target only while its owning workspace is current", () => {
    const target = context();
    useVdtStudioStore.setState((state) => ({ workspace: { ...state.workspace, activeProjectId: "other" } }));
    expect(useVdtStudioStore.getState().stageDataDiscoveryChangeSet(createChangeSet(), target)).toBe(false);
    expect(useVdtStudioStore.getState().pendingChangeSet).toBeUndefined();
  });
  it("treats formulas and category nodes as one dependent selection group", () => {
    const state = useVdtStudioStore.getState();
    expect(state.stageDataDiscoveryChangeSet(createChangeSet(), context())).toBe(true);
    expect(useVdtStudioStore.getState().changeSetSelection.size).toBe(2);
    state.toggleChangeSelection("add_repair");
    expect(useVdtStudioStore.getState().changeSetSelection.size).toBe(0);
    state.toggleChangeSelection("parent_sum");
    expect([...useVdtStudioStore.getState().changeSetSelection]).toEqual(["add_repair", "parent_sum"]);
  });
  it("blocks final apply when the target changes after staging", () => {
    const state = useVdtStudioStore.getState();
    state.stageDataDiscoveryChangeSet(createChangeSet(), context());
    state.updateNode(state.project.rootNodeId, { unit: "minutes" });
    state.applyPendingChangeSet();
    expect(useVdtStudioStore.getState().aiActionError).toContain("target KPI changed");
    expect(useVdtStudioStore.getState().project.graph.nodes).toHaveLength(1);
  });
  it("clears origin context on discard and successful apply", () => {
    let state = useVdtStudioStore.getState();
    state.stageDataDiscoveryChangeSet(createChangeSet(), context());
    state.discardPendingChangeSet();
    expect(useVdtStudioStore.getState().pendingFileImport).toBeUndefined();
    state = useVdtStudioStore.getState();
    state.stageDataDiscoveryChangeSet(createChangeSet(), context());
    state.applyPendingChangeSet();
    expect(useVdtStudioStore.getState().project.graph.nodes.some((node) => node.id === "repair")).toBe(true);
    expect(useVdtStudioStore.getState().pendingFileImport).toBeUndefined();
  });
  it("clears a staged file proposal when leaving the VDT editor", () => {
    const state = useVdtStudioStore.getState();
    state.stageDataDiscoveryChangeSet(createChangeSet(), context());
    state.closeWorkspaceVdtEditor();
    expect(useVdtStudioStore.getState().pendingFileImport).toBeUndefined();
    expect(useVdtStudioStore.getState().pendingChangeSet).toBeUndefined();
  });
  it("does not attach an old file origin to a later manual or AI preview", () => {
    const state = useVdtStudioStore.getState();
    state.stageDataDiscoveryChangeSet(createChangeSet(), context());
    state.updateNode(state.project.rootNodeId, { name: "Updated target" });
    const replacement = { ...createChangeSet(), id: "later_preview" };
    useVdtStudioStore.setState({ pendingChangeSet: replacement });
    state.applyPendingChangeSet();
    expect(useVdtStudioStore.getState().aiActionError).toBeUndefined();
    expect(useVdtStudioStore.getState().project.graph.nodes.some((node) => node.id === "repair")).toBe(true);
  });
  it("settles the originating handoff only after the exact preview is applied", () => {
    const controller = new EditorHandoffController();
    const state = useVdtStudioStore.getState();
    const scope = context();
    const issued = { runId: "origin", id: "file", handoff: {
      action: "file_import" as const, projectId: scope.projectId, vdtId: scope.vdtId, nodeId: scope.targetNodeId
    } };
    const attempt = controller.start(issued, editorHandoffView(state))!;
    expect(state.stageDataDiscoveryChangeSet(createChangeSet(), scope, attempt)).toBe(true);
    expect(controller.state("origin", "file")).toBe("pending");
    state.discardPendingChangeSet();
    expect(controller.state("origin", "file")).toBe("cancelled");
    state.applyPendingChangeSet();
    expect(controller.state("origin", "file")).toBe("cancelled");
    const retry = controller.start(issued, editorHandoffView(useVdtStudioStore.getState()))!;
    expect(state.stageDataDiscoveryChangeSet(createChangeSet(), scope, retry)).toBe(true);
    state.applyPendingChangeSet();
    expect(controller.state("origin", "file")).toEqual({ kind: "file", nodeId: scope.targetNodeId, changeSetId: "file_hierarchy" });
  });

  it.each([
    ["foreign-only", ["not_from_the_review"], true, false],
    ["partial", ["add_repair"], false, false],
    ["complete plus foreign", ["add_repair", "parent_sum", "not_from_the_review"], true, true]
  ] as const)("creates no durable acknowledgment for a %s selection", (_, selection, completes, hasRepair) => {
    const { controller, state, scope, issued, start } = issueFileHandoff();
    expect(state.stageDataDiscoveryChangeSet(createChangeSet(), scope, start())).toBe(true);
    useVdtStudioStore.setState({ changeSetSelection: new Set(selection) });
    state.applyPendingChangeSet();
    const applied = useVdtStudioStore.getState();
    if (completes) {
      expect(applied.pendingChangeSet).toBeUndefined();
      expect(controller.state("origin", "file")).toMatchObject({ kind: "file" });
    } else {
      expect(applied.pendingChangeSet?.id).toBe("file_hierarchy");
      expect(applied.aiActionError).toBeTruthy();
      expect(controller.state("origin", "file")).toBe("pending");
    }
    expect(applied.project.graph.nodes.some(node => node.id === "repair")).toBe(hasRepair);
    expect(matchingFileHandoffDraftReceipt(applied, issued)).toBeUndefined();
    expect(JSON.parse(storage.get("vdt-studio-state")!).state.fileHandoffDraftReceipt).toBeUndefined();
  });

  it("does not retain acknowledgment for a replacement that reuses the reviewed change-set ID", () => {
    const { state, scope, issued, start } = issueFileHandoff();
    const reviewed = createChangeSet();
    expect(state.stageDataDiscoveryChangeSet(reviewed, scope, start())).toBe(true);
    const replacement = { ...reviewed, additions: reviewed.additions.map(entry => ({ ...entry, name: "Replacement" })) };
    useVdtStudioStore.setState({ pendingChangeSet: replacement });
    state.applyPendingChangeSet();
    const applied = useVdtStudioStore.getState();
    expect(applied.project.graph.nodes.find(node => node.id === "repair")?.name).toBe("Replacement");
    expect(matchingFileHandoffDraftReceipt(applied, issued)).toBeUndefined();
  });

  it.each([null, undefined])("keeps Apply and its live callback with draft save base %s", (draftRevisionBase) => {
    const { controller, state, scope, issued, start } = issueFileHandoff();
    expect(state.stageDataDiscoveryChangeSet(createChangeSet(), scope, start())).toBe(true);
    useVdtStudioStore.setState(current => ({ workspace: { ...current.workspace, draftRevisionBase } }));
    state.applyPendingChangeSet();
    const applied = useVdtStudioStore.getState();
    expect(applied.workspace.projectSummaries[0]?.vdts[0]?.head.activeRevisionId).toBe("revision_file_1");
    expect(applied.project.graph.nodes.some(node => node.id === "repair")).toBe(true);
    expect(controller.state("origin", "file")).toMatchObject({ kind: "file", changeSetId: "file_hierarchy" });
    const receipt = matchingFileHandoffDraftReceipt(applied, issued);
    const persisted = JSON.parse(storage.get("vdt-studio-state")!).state.fileHandoffDraftReceipt;
    if (draftRevisionBase === null) {
      expect(receipt).toBeUndefined();
      expect(persisted).toBeUndefined();
    } else {
      expect(receipt).toMatchObject({ revisionId: "revision_file_1" });
      expect(persisted).toEqual(receipt);
    }
  });

  it("persists the exact reviewed Apply with its draft before notifying the live callback", async () => {
    const { controller, state, scope, issued, start } = issueFileHandoff();
    expect(state.stageDataDiscoveryChangeSet(createChangeSet(), scope, start())).toBe(true);
    expect(JSON.parse(storage.get("vdt-studio-state")!).state.fileHandoffDraftReceipt).toBeUndefined();
    const pending = storage.get("vdt-studio-state")!;
    expect(matchingFileHandoffDraftReceipt(await reopen(pending), issued)).toBeUndefined();
    expect(useVdtStudioStore.getState().pendingFileImport).toBeUndefined();

    const abandoned = start();
    expect(state.stageDataDiscoveryChangeSet(createChangeSet(), scope, abandoned)).toBe(true);
    state.discardPendingChangeSet();
    state.applyPendingChangeSet();
    expect(matchingFileHandoffDraftReceipt(useVdtStudioStore.getState(), issued)).toBeUndefined();

    const retry = start();
    expect(state.stageDataDiscoveryChangeSet(createChangeSet(), scope, retry)).toBe(true);
    let applyAtCallback: string | undefined;
    const stop = controller.subscribe(() => {
      if (typeof controller.state("origin", "file") === "object") applyAtCallback = storage.get("vdt-studio-state");
    });
    state.applyPendingChangeSet();
    stop();
    const applied = storage.get("vdt-studio-state")!;
    expect(applyAtCallback).toBe(applied);
    const payload = JSON.parse(applied).state;
    expect(payload.fileHandoffDraftReceipt).toEqual({
      version: 1, runId: "origin", artifactId: "file", projectId: "owner_file", vdtId: "vdt_file",
      revisionId: "revision_file_1", graphProjectId: "vdt_file", draftGeneration: 1,
      checkpointVersionId: payload.project.versions.at(-1).id, targetNodeId: scope.targetNodeId, changeSetId: "file_hierarchy"
    });
    expect(payload.project.graph.nodes.some((node: { id: string }) => node.id === "repair")).toBe(true);
    expect(payload.pendingFileImport).toBeUndefined();
    expect(payload.pendingChangeSet).toBeUndefined();
    expect(abandoned.complete(editorHandoffView(state), editorHandoffView(useVdtStudioStore.getState()), {
      kind: "file", nodeId: scope.targetNodeId, changeSetId: "file_hierarchy"
    })).toBe(false);

    const restored = await reopen(applied);
    expect(matchingFileHandoffDraftReceipt(restored, issued)).toEqual(payload.fileHandoffDraftReceipt);
    expect(matchingFileHandoffDraftReceipt({
      ...restored, workspace: { ...restored.workspace, draftRevisionBase: null }
    }, issued)).toBeUndefined();
    await expect(restored.selectWorkspaceVdt("vdt_file", { expectedProjectId: "owner_file" })).resolves.toBe(true);
    expect(matchingFileHandoffDraftReceipt(useVdtStudioStore.getState(), issued)).toEqual(payload.fileHandoffDraftReceipt);
    expect(restored.project.graph.nodes.map(node => node.id).filter(id => id === "repair")).toHaveLength(1);
    expect(matchingFileHandoffDraftReceipt(restored, { ...issued, runId: "other" })).toBeUndefined();
    expect(matchingFileHandoffDraftReceipt(restored, { ...issued, id: "other" })).toBeUndefined();
    for (const values of [{ nodeId: "other" }, { projectId: "other" }, { vdtId: "other" }, { revisionId: "other" }]) {
      expect(matchingFileHandoffDraftReceipt(restored, { ...issued, handoff: { ...issued.handoff, ...values } })).toBeUndefined();
    }
    expect(matchingFileHandoffDraftReceipt({ ...restored, projectRevision: 2 }, issued)).toBeUndefined();
    expect(matchingFileHandoffDraftReceipt({ ...restored, workspace: { ...restored.workspace, activeProjectId: "other" } }, issued)).toBeUndefined();
    expect(matchingFileHandoffDraftReceipt({ ...restored, workspace: { ...restored.workspace, activeVdtId: "other" } }, issued)).toBeUndefined();
    const changedHead = { ...summary, vdts: summary.vdts.map(entry => ({
      ...entry, head: { ...entry.head, activeRevisionId: "revision_file_2" }
    })) };
    expect(matchingFileHandoffDraftReceipt({ ...restored, workspace: { ...restored.workspace, projectSummaries: [changedHead] } }, issued)).toBeUndefined();

    expect(restored.restoreVersionSnapshot(payload.fileHandoffDraftReceipt.checkpointVersionId)).toBe(true);
    expect(matchingFileHandoffDraftReceipt(useVdtStudioStore.getState(), issued)).toBeUndefined();
    expect(useVdtStudioStore.getState().project.graph.nodes.some(node => node.id === "repair")).toBe(false);

    for (const data of [undefined, { ...payload.fileHandoffDraftReceipt, version: 0 },
      { ...payload.fileHandoffDraftReceipt, prompt: "Unexpected field" },
      { ...payload.fileHandoffDraftReceipt, artifactId: "a".repeat(161) }]) {
      expect((await reopen(JSON.stringify({ ...JSON.parse(applied), state: { ...payload, fileHandoffDraftReceipt: data } })))
        .fileHandoffDraftReceipt).toBeUndefined();
    }
  });

});
