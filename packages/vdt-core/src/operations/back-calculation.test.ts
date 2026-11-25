import { describe, expect, it } from "vitest";
import { cloneProject, productionVolumeProject, VdtBuilderSession } from "../index";
import { inspectBackCalculation, prepareBackCalculationPatch } from "./back-calculation";

const nodeId = "unplanned_downtime";
const setting = { targetNodeId: "effective_working_time", targetValue: 500 };

describe("back-calculation operations", () => {
  it("replays the same setting, edit and explicit clear through a serialized change set", () => {
    const builder = new VdtBuilderSession({ project: productionVolumeProject });
    for (const [target, baselineValue] of [[setting, 180], [{ ...setting, targetValue: 600 }, 80], [null, 80]] as const) {
      const project = builder.getProject();
      const operation = prepareBackCalculationPatch(project, { nodeId, setting: target });
      expect(operation.status).toBe("ok");
      if (operation.status !== "ok") throw new Error(operation.message);
      const copy = new VdtBuilderSession({ project });
      const { changeSet } = copy.updateNode({ nodeId, patch: operation.patch });
      builder.applyChangeSet(JSON.parse(JSON.stringify(changeSet)));
      const applied = inspectBackCalculation(builder.getProject(), nodeId);
      expect(applied).toMatchObject({ status: "ok", sourceValue: 80, value: baselineValue, issues: [] });
      if (applied.status !== "ok") throw new Error(applied.message);
      expect(applied.setting ?? null).toEqual(target);
      if (!target) expect(applied.node).not.toHaveProperty("clearGoalSeek");
    }
  });

  it("rejects ineligible candidates and leaves old unavailable settings visible and clearable", () => {
    const project = cloneProject(productionVolumeProject);
    const node = project.graph.nodes.find(candidate => candidate.id === nodeId)!;
    expect(prepareBackCalculationPatch(project, { nodeId: project.rootNodeId, setting }))
      .toMatchObject({ status: "error", code: "GOAL_SEEK_INELIGIBLE" });
    expect(prepareBackCalculationPatch(project, { nodeId, setting: { ...setting, targetNodeId: "planned_downtime" } }))
      .toMatchObject({ status: "error", code: "INVALID_GOAL_SEEK_TARGET" });
    expect(prepareBackCalculationPatch(project, { nodeId, setting: { ...setting, targetValue: Infinity } }))
      .toMatchObject({ status: "error", code: "INVALID_GOAL_SEEK_TARGET" });
    node.goalSeek = { ...setting, targetNodeId: "deleted" };
    expect(prepareBackCalculationPatch(project, { nodeId: "planned_downtime", setting }))
      .toMatchObject({ status: "error", code: "GOAL_SEEK_OCCUPIED" });
    expect(inspectBackCalculation(project, nodeId)).toMatchObject({
      status: "ok", setting: node.goalSeek, value: undefined, sourceValue: 80,
      issues: expect.arrayContaining([expect.objectContaining({ type: "goal_seek_error" })])
    });
    expect(prepareBackCalculationPatch(project, { nodeId, setting: null }))
      .toEqual({ status: "ok", changed: true, patch: { clearGoalSeek: true } });
  });
});
