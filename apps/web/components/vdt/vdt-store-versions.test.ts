import { beforeEach, describe, expect, it, vi } from "vitest";
import { cloneProject, createVersionSnapshot, MAX_VERSION_SNAPSHOTS, productionVolumeProject } from "@vdt-studio/vdt-core";

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key)
});
const { useVdtStudioStore: store, canUndoVersionRestore } = await import("./vdt-store");
const notifyAgent = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  storage.clear();
  notifyAgent.mockClear();
  store.setState({
    project: cloneProject(productionVolumeProject),
    projectRevision: 10,
    selectedNodeId: "unplanned_downtime",
    activeScenarioId: "scenario_original",
    activeAgentRunId: undefined,
    versionRestoreUndo: undefined,
    workspace: { ...store.getState().workspace, activeVdtId: "versions_test_vdt" },
    pendingChangeSet: undefined,
    sendManualProjectChange: notifyAgent
  });
});

function prepareVersion() {
  const saved = createVersionSnapshot(store.getState().project, {
    name: "Before analyze_raw_dataset apply", taskType: "analyze_raw_dataset"
  });
  const current = {
    ...saved,
    scenarios: [{ id: "scenario_original", name: "Custom scenario", overrides: [], createdAt: saved.createdAt, updatedAt: saved.updatedAt }],
    dataSources: [{ id: "source_current", name: "Current source", type: "manual" as const }],
    graph: { ...saved.graph, nodes: saved.graph.nodes.map((node) => node.id === "unplanned_downtime" ? { ...node, baselineValue: 60 } : node) }
  };
  store.setState({ project: current });
  return { versionId: saved.versions[0]!.id, current };
}

describe("Versions restore and undo", () => {
  it("checkpoints current graph/scenarios/sources and restores them with one undo", () => {
    const { versionId, current } = prepareVersion();
    expect(store.getState().restoreVersionSnapshot(versionId)).toBe(true);
    const restored = store.getState();
    expect(restored.projectRevision).toBe(11);
    expect(restored.project.graph).toEqual(productionVolumeProject.graph);
    expect(restored.project.versions.at(-1)?.projectSnapshot.graph).toEqual(current.graph);
    expect(restored.project.versions.at(-1)?.name).toBe("Before restoring “Before data import”");
    expect(canUndoVersionRestore(restored)).toBe(true);
    expect(notifyAgent).toHaveBeenCalledWith(expect.objectContaining({ kind: "project_replaced" }));
    expect(restored.undoVersionRestore()).toBe(true);
    expect(store.getState().project.graph).toEqual(current.graph);
    expect(store.getState().project.scenarios).toEqual(current.scenarios);
    expect(store.getState().project.dataSources).toEqual(current.dataSources);
    expect(store.getState().activeScenarioId).toBe("scenario_original");
    expect(store.getState().selectedNodeId).toBe("unplanned_downtime");
    expect(store.getState().projectRevision).toBe(12);
    expect(store.getState().undoVersionRestore()).toBe(false);
    const persisted = JSON.parse(storage.get("vdt-studio-state")!).state;
    expect(persisted.versionRestoreUndo).toBeUndefined();
    expect(persisted.project.versions.at(-1).projectSnapshot.graph).toEqual(current.graph);
  });

  it("restores the oldest target even when the checkpoint fills the history cap", () => {
    let project = store.getState().project;
    for (let i = 0; i < MAX_VERSION_SNAPSHOTS; i++) project = createVersionSnapshot(project, { name: `Version ${i}` });
    const oldest = project.versions[0]!;
    store.setState({ project });
    expect(store.getState().restoreVersionSnapshot(oldest.id)).toBe(true);
    expect(store.getState().project.versions).toHaveLength(MAX_VERSION_SNAPSHOTS);
    expect(store.getState().project.graph).toEqual(oldest.projectSnapshot.graph);
    expect(store.getState().undoVersionRestore()).toBe(true);
  });

  it("keeps later manual or scenario edits intact instead of undoing over them", () => {
    const { versionId } = prepareVersion();
    store.getState().restoreVersionSnapshot(versionId);
    store.getState().createScenario();
    const edited = store.getState().project;
    expect(canUndoVersionRestore(store.getState())).toBe(false);
    expect(store.getState().undoVersionRestore()).toBe(false);
    expect(store.getState().project).toBe(edited);
    expect(edited.versions.some((version) => version.id === store.getState().versionRestoreUndo?.checkpointVersionId)).toBe(true);
  });

  it("does not restore into a different VDT and does not checkpoint a missing target", () => {
    const { versionId } = prepareVersion();
    const current = store.getState().project;
    expect(store.getState().restoreVersionSnapshot("missing")).toBe(false);
    expect(store.getState().project).toBe(current);
    store.getState().restoreVersionSnapshot(versionId);
    store.setState({ workspace: { ...store.getState().workspace, activeVdtId: "another_vdt" } });
    expect(store.getState().undoVersionRestore()).toBe(false);
  });

  it("supports named checkpoints and renaming without changing the model", () => {
    const graph = store.getState().project.graph;
    expect(store.getState().saveVersionSnapshot("  ")).toBeUndefined();
    const id = store.getState().saveVersionSnapshot("  Для согласования  ")!;
    store.getState().renameVersionSnapshot(id, "  Согласованная модель  ");
    expect(store.getState().project.graph).toBe(graph);
    expect(store.getState().project.versions[0]?.name).toBe("Согласованная модель");
  });
});
