import { beforeEach, describe, expect, it, vi } from "vitest";
import { calculateScenario, cloneProject, exportProjectJson, importProjectJson, productionVolumeProject } from "@vdt-studio/vdt-core";
import { validateStrictVdtProjectCommit } from "../../../../packages/vdt-storage/src/canonical";

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key)
});
const { useVdtStudioStore: store } = await import("./vdt-store");
const scenarioId = productionVolumeProject.scenarios[0]!.id;
const nodeId = "unplanned_downtime";

beforeEach(() => {
  storage.clear();
  store.setState({ project: cloneProject(productionVolumeProject), activeScenarioId: scenarioId });
});

describe("Scenario KPI comments", () => {
  it("persists a comment without creating an override or changing calculations", async () => {
    store.getState().updateScenarioOverride(scenarioId, nodeId, undefined);
    const before = store.getState().project;
    const result = calculateScenario(before, before.scenarios[0]!);
    store.getState().updateScenarioComment(scenarioId, nodeId, "Сократить ожидание\nИзменить диспетчеризацию");
    const project = store.getState().project;
    expect(project.scenarios[0]!.overrides).toEqual(before.scenarios[0]!.overrides);
    expect(calculateScenario(project, project.scenarios[0]!)).toEqual(result);
    const serialized = exportProjectJson(project);
    expect(importProjectJson(serialized).scenarios[0]!.comments).toEqual(project.scenarios[0]!.comments);
    expect(validateStrictVdtProjectCommit(JSON.parse(serialized)).project.scenarios[0]!.comments)
      .toEqual(project.scenarios[0]!.comments);
    const savedComments = project.scenarios[0]!.comments;
    const persistedDraft = storage.get("vdt-studio-state")!;
    expect(JSON.parse(persistedDraft).state.project.scenarios[0].comments).toEqual(savedComments);
    store.setState({ project: cloneProject(productionVolumeProject) });
    // Restore the persisted draft through the same adapter used at startup.
    storage.set("vdt-studio-state", persistedDraft);
    await store.persist.rehydrate();
    expect(store.getState().project.scenarios[0]!.comments).toEqual(savedComments);
  });

  it("retains comments when the scenario value changes or returns to Baseline", () => {
    store.getState().updateScenarioComment(scenarioId, nodeId, "Improve scheduling");
    store.getState().updateScenarioOverride(scenarioId, nodeId, 60.123456);
    store.getState().updateScenarioOverride(scenarioId, nodeId, undefined);
    expect(store.getState().project.scenarios[0]!.comments).toEqual([{ nodeId, text: "Improve scheduling" }]);
    expect(store.getState().project.scenarios[0]!.overrides.some((override) => override.nodeId === nodeId)).toBe(false);
  });

  it("copies comments with a scenario and keeps subsequent edits independent", () => {
    store.getState().updateScenarioComment(scenarioId, nodeId, "Original plan");
    store.getState().cloneScenario(scenarioId);
    const cloneId = store.getState().activeScenarioId;
    const scenarios = store.getState().project.scenarios;
    expect(scenarios.at(-1)!.comments).toEqual(scenarios[0]!.comments);
    expect(scenarios.at(-1)!.comments).not.toBe(scenarios[0]!.comments);
    store.getState().updateScenarioComment(cloneId, nodeId, "Alternative plan");
    expect(store.getState().project.scenarios[0]!.comments![0]!.text).toBe("Original plan");
    store.getState().createScenario();
    expect(store.getState().project.scenarios.at(-1)!.comments).toBeUndefined();
  });

  it("clears only the comment and preserves the numeric override", () => {
    store.getState().updateScenarioOverride(scenarioId, nodeId, 0);
    store.getState().updateScenarioComment(scenarioId, nodeId, "Remove delay");
    store.getState().updateScenarioComment(scenarioId, nodeId, "  ");
    const scenario = store.getState().project.scenarios[0]!;
    expect(scenario.comments).toBeUndefined();
    expect(scenario.overrides).toContainEqual({ nodeId, value: 0 });
    expect(() => validateStrictVdtProjectCommit(JSON.parse(exportProjectJson(store.getState().project)))).not.toThrow();
  });

  it("ignores missing scenarios, missing KPIs and empty new comments", () => {
    const project = store.getState().project;
    store.getState().updateScenarioComment("missing", nodeId, "Plan");
    store.getState().updateScenarioComment(scenarioId, "missing", "Plan");
    store.getState().updateScenarioComment(scenarioId, nodeId, "  ");
    expect(store.getState().project).toBe(project);
  });

  it("loads older scenarios and rejects malformed comment data", () => {
    const project = JSON.parse(exportProjectJson(productionVolumeProject));
    expect(importProjectJson(JSON.stringify(project)).scenarios[0]!.comments).toBeUndefined();
    for (const comments of ["invalid", [{ nodeId, text: 42 }], [{ text: "Missing node" }]]) {
      project.scenarios[0].comments = comments;
      expect(() => importProjectJson(JSON.stringify(project))).toThrow(/scenario comment/);
    }
  });
});
