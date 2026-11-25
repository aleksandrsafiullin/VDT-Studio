import { describe, expect, it } from "vitest";
import { productionVolumeProject } from "../examples/production-volume";
import { calculateGraph } from "../formula/calculate";
import type { VdtProject } from "../types";
import { applyScenarioOperation, compareScenarioOperation, type ScenarioCommand } from "./scenario";

const now = "2026-11-24T00:00:00.000Z";
const downtime = "unplanned_downtime";
const baselineScenario = { ...productionVolumeProject.scenarios[0]!, id: "baseline", overrides: [], isMain: true };

const project: VdtProject = {
  ...productionVolumeProject,
  graph: {
    ...productionVolumeProject.graph,
    nodes: productionVolumeProject.graph.nodes.map((node) => {
      switch (node.id) {
        case "production_volume": return { ...node, unit: "t" };
        case "calendar_time": return { ...node, baselineValue: 1000 };
        case "planned_downtime": return { ...node, baselineValue: 0 };
        case downtime: return { ...node, baselineValue: 100 };
        case "nominal_rate": return { ...node, baselineValue: 2 };
        case "yield_factor": return { ...node, baselineValue: 1 };
        default: return node;
      }
    })
  },
  scenarios: [baselineScenario]
};

function apply(project: VdtProject, command: ScenarioCommand, operationId: string = command.kind) {
  const outcome = applyScenarioOperation(project, command, { operationId, now });
  if (outcome.status === "error") throw new Error(outcome.message);
  return outcome;
}

describe("Scenario operations", () => {
  it("saves the name and overrides atomically and reuses the scenario on repeat", () => {
    const save = { kind: "save", name: "Recovery", overrides: [{ nodeId: downtime, value: 90 }] } as const;
    const saved = apply(project, save);
    expect(saved.project.graph).toBe(project.graph);
    expect(saved.project.scenarios).toHaveLength(2);
    const { scenarioId } = saved.result;
    expect(compareScenarioOperation(saved.project, { scenarioId })).toMatchObject({
      status: "ok", result: { baselineValue: 1800, scenarioValue: 1820, absoluteChange: 20 }
    });
    const repeat = apply(saved.project, save, "different-call");
    expect(repeat.result.scenarioId).toBe(scenarioId);
    expect(repeat.project).toBe(saved.project);

    const updated = apply(saved.project, { ...save, overrides: [{ nodeId: downtime, value: 0 }] }, "update-scenario");
    expect(updated.result.scenarioId).toBe(scenarioId);
    expect(updated.project.scenarios.at(-1)?.overrides).toEqual([{ nodeId: downtime, value: 0 }]);
    const invalid = { ...save, overrides: [...save.overrides, { nodeId: "calendar_time", value: 5 }] };
    expect(applyScenarioOperation(project, invalid, { operationId: "invalid", now }))
      .toMatchObject({ status: "error", code: "SCENARIO_INPUT_FIXED" });
    expect(project.scenarios).toEqual([baselineScenario]);
  });

  it("compares Recovery against an unchanged baseline using absolute values", () => {
    const created = apply(project, { kind: "create", name: " Recovery " });
    const { scenarioId } = created.result;
    const changed = apply(created.project, { kind: "set_override", scenarioId, nodeId: downtime, value: 90 });
    expect(changed.project.scenarios.at(-1)?.name).toBe("Recovery");
    expect(changed.project.graph).toBe(project.graph);
    expect(calculateGraph(changed.project).rootValue).toBe(1800);
    expect(compareScenarioOperation(changed.project, { scenarioId })).toMatchObject({
      status: "ok",
      result: {
        scenarioId, rootNodeId: "production_volume", unit: "t", baselineValue: 1800,
        scenarioValue: 1820, absoluteChange: 20, errorCount: 0
      }
    });
    expect(project.scenarios).toEqual([baselineScenario]);
  });

  it("treats zero as an override and excludes historical overrides for fixed nodes", () => {
    const scenarioId = baselineScenario.id;
    const zero = apply(project, { kind: "set_override", scenarioId, nodeId: downtime, value: 0 });
    const stale = {
      ...zero.project,
      scenarios: [{
        ...zero.project.scenarios[0]!,
        overrides: [...zero.project.scenarios[0]!.overrides, { nodeId: "calendar_time", value: 500 }]
      }]
    };
    expect(compareScenarioOperation(stale, { scenarioId })).toMatchObject({
      status: "ok", result: { baselineValue: 1800, scenarioValue: 2000, absoluteChange: 200 }
    });
    expect(applyScenarioOperation(stale, {
      kind: "set_override", scenarioId, nodeId: "calendar_time", value: 1200
    }, { operationId: "fixed", now })).toMatchObject({ status: "error", code: "SCENARIO_INPUT_FIXED" });
    const cleared = apply(zero.project, { kind: "set_override", scenarioId, nodeId: downtime, value: null });
    expect(cleared.project.scenarios[0]?.overrides).toEqual([]);
  });

  it("creates and clones deterministically and keeps comments and overrides independent", () => {
    const command = { kind: "create", name: "Recovery" } as const;
    const created = apply(project, command);
    expect(apply(project, command)).toEqual(created);
    expect(apply(created.project, command).project).toBe(created.project);
    const { scenarioId } = created.result;
    const overridden = apply(created.project, { kind: "set_override", scenarioId, nodeId: downtime, value: 90 });
    const comment = { kind: "set_comment", scenarioId, nodeId: downtime, text: "Reschedule\n  preserve spacing" } as const;
    const annotated = apply(overridden.project, comment);
    expect(apply(annotated.project, comment).project).toBe(annotated.project);
    const clone = { kind: "clone", scenarioId } as const;
    const cloned = apply(annotated.project, clone);
    expect(apply(cloned.project, clone).project).toBe(cloned.project);
    const recreated = apply(cloned.project, clone, "clone-2");
    expect(recreated.project.scenarios.at(-1)?.name).toBe("Recovery copy (2)");
    expect(cloned.project.scenarios.at(-1)?.comments).toEqual([{ nodeId: downtime, text: comment.text }]);
    expect(cloned.project.scenarios.at(-1)?.comments).not.toBe(annotated.project.scenarios.at(-1)?.comments);
    expect(cloned.project.scenarios.at(-1)?.overrides).not.toBe(annotated.project.scenarios.at(-1)?.overrides);
    const cleared = apply(cloned.project, { ...comment, scenarioId: cloned.result.scenarioId, text: " " }, "clear-comment");
    expect(cleared.project.scenarios.at(-1)?.comments).toBeUndefined();
    expect(cleared.project.scenarios.at(-1)?.overrides).toEqual([{ nodeId: downtime, value: 90 }]);
    expect(cleared.project.scenarios[1]?.comments).toHaveLength(1);
  });

  it("renames, changes main, and returns the neighboring selection on deletion", () => {
    const created = apply(project, { kind: "create" });
    const { scenarioId } = created.result;
    const renamed = apply(created.project, { kind: "rename", scenarioId, name: " Recovery " });
    expect(renamed.project.scenarios[1]?.name).toBe("Recovery");
    const selected = apply(renamed.project, { kind: "set_main", scenarioId });
    expect(selected.project.scenarios.map((scenario) => scenario.isMain)).toEqual([false, true]);
    const deleted = apply(selected.project, { kind: "delete", scenarioId });
    expect(deleted.result.fallbackScenarioId).toBe(baselineScenario.id);
    expect(deleted.project.scenarios[0]?.isMain).toBe(true);
    expect(applyScenarioOperation(deleted.project, { kind: "delete", scenarioId: baselineScenario.id }, {
      operationId: "last", now
    })).toMatchObject({ status: "error", code: "LAST_SCENARIO" });
  });

  it("validates scenario and KPI identities, names, and numeric values", () => {
    expect(compareScenarioOperation(project, { scenarioId: "missing" })).toMatchObject({ code: "SCENARIO_NOT_FOUND" });
    const commands = [
      [{ kind: "clone", scenarioId: "missing" }, "SCENARIO_NOT_FOUND"],
      [{ kind: "create", name: " " }, "INVALID_SCENARIO_NAME"],
      [{ kind: "set_override", scenarioId: baselineScenario.id, nodeId: "missing", value: 0 }, "NODE_NOT_FOUND"],
      [{ kind: "set_override", scenarioId: baselineScenario.id, nodeId: downtime, value: Infinity }, "INVALID_SCENARIO_VALUE"]
    ] as const;
    for (const [command, code] of commands) {
      expect(applyScenarioOperation(project, command, { operationId: "invalid", now })).toMatchObject({
        status: "error", code
      });
    }
  });

  it("returns the full diagnostic count with a bounded preview", () => {
    const overrides = Array.from({ length: 25 }, (_, index) => ({ nodeId: `missing_${index}`, value: 1 }));
    const corrupt = { ...project, scenarios: [{ ...baselineScenario, overrides }] };
    const comparison = compareScenarioOperation(corrupt, { scenarioId: baselineScenario.id });
    if (comparison.status === "error") throw new Error(comparison.message);
    expect(comparison.result.errorCount).toBe(25);
    expect(comparison.result.errors).toHaveLength(20);
  });
});
