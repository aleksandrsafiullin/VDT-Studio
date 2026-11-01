import { beforeEach, describe, expect, it, vi } from "vitest";
import { calculateGraph, cloneProject, createVersionSnapshot, exportProjectJson, importProjectJson, productionVolumeProject } from "@vdt-studio/vdt-core";
import { validateStrictVdtProjectCommit } from "../../../../packages/vdt-storage/src/canonical";

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key)
});
const { useVdtStudioStore: store } = await import("./vdt-store");
const id = "unplanned_downtime";
beforeEach(() => {
  storage.clear();
  store.setState({ project: cloneProject(productionVolumeProject), agentRun: undefined });
});

describe("Back-calculation editing and persistence", () => {
  it("keeps configuration through strict revision validation, saved snapshots and browser rehydration", async () => {
    store.getState().updateNode(id, { goalSeek: { targetNodeId: "production_volume", targetValue: 100_000 } });
    const project = store.getState().project;
    expect(calculateGraph(project).rootValue).toBeCloseTo(100_000, 7);
    const snapshot = createVersionSnapshot(project, { name: "Actual baseline" });
    const canonical = validateStrictVdtProjectCommit(JSON.parse(exportProjectJson(snapshot))).project;
    expect(canonical.graph.nodes.find(node => node.id === id)?.goalSeek).toEqual(project.graph.nodes.find(node => node.id === id)?.goalSeek);
    const savedGraph = importProjectJson(exportProjectJson(canonical.versions[0]!.projectSnapshot));
    expect(calculateGraph(savedGraph).rootValue).toBeCloseTo(100_000, 7);
    const draft = storage.get("vdt-studio-state")!;
    store.setState({ project: cloneProject(productionVolumeProject) });
    storage.set("vdt-studio-state", draft);
    await store.persist.rehydrate();
    expect(calculateGraph(store.getState().project).rootValue).toBeCloseTo(100_000, 7);
    expect(store.getState().project.graph.nodes.find(node => node.id === id)?.baselineValue).toBe(80);
  });

  it("recalculates after edits, restores the stored source when disabled and exposes a deleted target", () => {
    store.getState().updateNode(id, { goalSeek: { targetNodeId: "effective_working_time", targetValue: 500 } });
    store.getState().updateNodeBaselineValue("planned_downtime", 60);
    expect(calculateGraph(store.getState().project).values[id]).toBe(160);
    store.getState().updateNode(id, { goalSeek: undefined });
    expect(calculateGraph(store.getState().project).values[id]).toBe(80);
    expect(() => validateStrictVdtProjectCommit(JSON.parse(exportProjectJson(store.getState().project)))).not.toThrow();
    store.getState().updateNode(id, { goalSeek: { targetNodeId: "effective_working_time", targetValue: 500 } });
    store.getState().deleteNode("effective_working_time");
    const result = calculateGraph(store.getState().project);
    expect(result.values[id]).toBeUndefined();
    expect(result.errors.some(error => error.type === "goal_seek_error" && error.message.includes("deleted"))).toBe(true);
  });
});
