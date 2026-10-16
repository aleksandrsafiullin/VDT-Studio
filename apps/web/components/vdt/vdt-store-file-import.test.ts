import { beforeEach, describe, expect, it, vi } from "vitest";
import { productionVolumeProject, type VdtChangeSet } from "@vdt-studio/vdt-core";
import { captureFileImportTarget } from "@/components/data-import/import-context";

vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
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

beforeEach(() => {
  const project = structuredClone(productionVolumeProject);
  project.id = "vdt_file";
  project.graph.nodes = [{ ...project.graph.nodes.find((node) => node.id === project.rootNodeId)!, formula: undefined, unit: "h" }];
  project.graph.edges = [];
  project.scenarios = [];
  project.dataSources = [];
  useVdtStudioStore.setState((state) => ({
    project, projectRevision: 0, selectedNodeId: project.rootNodeId, pendingChangeSet: undefined, pendingFileImport: undefined,
    aiActionError: undefined, changeSetSelection: new Set(),
    workspace: { ...state.workspace, activeProjectId: "owner_file", activeVdtId: "vdt_file" },
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
});
