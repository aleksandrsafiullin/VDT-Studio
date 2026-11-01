import { describe, expect, it } from "vitest";
import { calculateGraph, calculateIsolatedRootEffect, calculateScenarioGraph, cloneProject, exportProjectJson, getGoalSeekTargets, importProjectJson, productionVolumeProject, type VdtNode } from "../index";

function calibrated(targetValue = 100_000) {
  const project = cloneProject(productionVolumeProject);
  project.graph.nodes.find(node => node.id === "unplanned_downtime")!.goalSeek = { targetNodeId: project.rootNodeId, targetValue };
  return project;
}
function simple(formula: string, targetValue: number, patch: Partial<VdtNode> = {}) {
  const project = calibrated(targetValue);
  const template = project.graph.nodes[0]!;
  project.rootNodeId = "output";
  project.graph.nodes = [
    { ...template, id: "output", name: "Output", formula, goalSeek: undefined },
    { ...template, id: "x", name: "Balancing input", type: "input", formula: undefined, baselineValue: 99, ...patch, goalSeek: { targetNodeId: "output", targetValue } },
    { ...template, id: "known", name: "Measured input", type: "input", formula: undefined, baselineValue: 10 }
  ];
  project.graph.edges = [];
  return project;
}

describe("Baseline back-calculation", () => {
  it("balances a deep input to actual production, without mutating measured evidence", () => {
    const project = calibrated();
    const before = JSON.stringify(project);
    const result = calculateGraph(project);
    expect(result.rootValue).toBeCloseTo(100_000, 7);
    expect(result.values.unplanned_downtime).toBeCloseTo(720 - 40 - 100_000 / (220 * 0.96), 9);
    expect(result.errors).toEqual([]);
    expect(result.trace.find(item => item.nodeId === "unplanned_downtime")?.goalSeek?.targetValue).toBe(100_000);
    expect(JSON.stringify(project)).toBe(before);
    expect(project.graph.nodes.find(node => node.id === "unplanned_downtime")?.baselineValue).toBe(80);
  });

  it("recalibrates when measurements, a formula or a new branch changes", () => {
    const project = calibrated();
    const first = calculateGraph(project).values.unplanned_downtime!;
    project.graph.nodes.find(node => node.id === "nominal_rate")!.baselineValue = 250;
    expect(calculateGraph(project).rootValue).toBeCloseTo(100_000, 7);
    expect(calculateGraph(project).values.unplanned_downtime).not.toBe(first);
    const reference = project.graph.nodes.find(node => node.id === "planned_downtime")!;
    project.graph.nodes.push({ ...reference, id: "new_loss", name: "New measured loss", baselineValue: 15 });
    project.graph.nodes.find(node => node.id === "effective_working_time")!.formula += " - new_loss";
    expect(calculateGraph(project).values.unplanned_downtime).toBeCloseTo(720 - 40 - 15 - 100_000 / 240, 9);
    expect(calculateGraph(project).rootValue).toBeCloseTo(100_000, 7);
  });

  it("keeps calibration in Baseline while scenario and sensitivity changes affect output", () => {
    const project = calibrated();
    const base = calculateGraph(project);
    const scenario = { ...project.scenarios[0]!, overrides: [{ nodeId: "planned_downtime", value: 20 }] };
    const result = calculateScenarioGraph(project, scenario);
    expect(result.values.unplanned_downtime).toBe(base.values.unplanned_downtime);
    expect(result.rootValue).toBeCloseTo(100_000 + 20 * 220 * 0.96, 7);
    expect(calculateIsolatedRootEffect(project, "planned_downtime", 20)).toBeCloseTo(20 * 220 * 0.96, 7);
    scenario.overrides = [{ nodeId: "unplanned_downtime", value: 0 }];
    expect(calculateScenarioGraph(project, scenario).rootValue).toBeCloseTo(680 * 220 * 0.96, 7);
    project.graph.nodes.find(node => node.id === "unplanned_downtime")!.fixedInScenario = true;
    expect(calculateScenarioGraph(project, scenario).rootValue).toBeCloseTo(100_000, 7);
  });

  it.each([
    ["known - x", 0, 10], ["known + x", 10, 0], ["known + x", 0, -10],
    ["known / x", 2, 5], ["x / known", 2, 20], ["-(x + known)", -15, 5],
    ["x + x + known", 14, 2], ["x / (x + known)", 0.5, 10],
    ["known * (1 - x)", 9, 0.1], ["x + min(known, 3)", 7, 4]
  ])("solves %s = %s", (formula, target, expected) => {
    const result = calculateGraph(simple(formula, target));
    expect(result.values.x).toBeCloseTo(expected, 9);
    expect(result.rootValue).toBeCloseTo(target, 9);
    expect(result.errors).toEqual([]);
    if (expected < 0) expect(result.warnings.some(item => item.message.includes("negative"))).toBe(true);
  });

  it.each(["x * x", "min(x, known)", "max(x, known)", "known + x * 0", "x / x", "known / x"])("fails visibly without stale fallback for %s", formula => {
    const result = calculateGraph(simple(formula, 0));
    expect(result.values.x).toBeUndefined();
    expect(result.rootValue).toBeUndefined();
    expect(result.errors.some(error => error.type === "goal_seek_error" && error.nodeId === "x")).toBe(true);
  });

  it("handles missing measurements, deleted targets, cycles, rejected inputs and duplicate calibration", () => {
    for (const mutate of [
      (p: ReturnType<typeof simple>) => { p.graph.nodes.find(node => node.id === "known")!.baselineValue = undefined; },
      (p: ReturnType<typeof simple>) => { p.graph.nodes.find(node => node.id === "x")!.goalSeek!.targetNodeId = "deleted"; },
      (p: ReturnType<typeof simple>) => { p.graph.nodes.find(node => node.id === "known")!.formula = "output"; },
      (p: ReturnType<typeof simple>) => { p.graph.nodes.find(node => node.id === "known")!.status = "rejected"; },
      (p: ReturnType<typeof simple>) => { p.graph.nodes.find(node => node.id === "known")!.goalSeek = { targetNodeId: "output", targetValue: 20 }; }
    ]) {
      const project = simple("known - x", 5);
      mutate(project);
      const result = calculateGraph(project);
      expect(result.values.x).toBeUndefined();
      expect(result.errors.some(error => error.type === "goal_seek_error")).toBe(true);
    }
  });

  it("allows another output target and any KPI type, retaining its original formula", () => {
    const project = calibrated();
    const node = project.graph.nodes.find(node => node.id === "average_productivity")!;
    project.graph.nodes.find(candidate => candidate.goalSeek)!.goalSeek = undefined;
    node.goalSeek = { targetNodeId: project.rootNodeId, targetValue: 100_000 };
    expect(calculateGraph(project).values.average_productivity).toBeCloseTo(100_000 / 600, 8);
    expect(calculateGraph(project, { overrides: { nominal_rate: 500 } }).rootValue).toBeCloseTo(100_000, 7);
    node.goalSeek = undefined;
    expect(calculateGraph(project).values.average_productivity).toBeCloseTo(220 * 0.96, 8);
    const loss = project.graph.nodes.find(candidate => candidate.id === "unplanned_downtime")!;
    loss.goalSeek = { targetNodeId: "effective_working_time", targetValue: 500 };
    expect(calculateGraph(project).values.unplanned_downtime).toBe(180);
    expect(calculateGraph(project).rootValue).toBe(500 * 220 * 0.96);
    expect(getGoalSeekTargets(project.graph, loss.id).map(item => item.id)).toEqual(["production_volume", "effective_working_time"]);
  });

  it("preserves cancelled dependency paths and verifies original division domains", () => {
    const project = simple("x + known", 4);
    project.graph.nodes.find(node => node.id === "known")!.formula = "x - x";
    expect(calculateGraph(project).values.x).toBe(4);
    expect(calculateGraph(simple("x / (x - known)", 0)).values.x).toBe(0);
    expect(calculateGraph(simple("x / (x - known)", 1)).values.x).toBeUndefined();
  });

  it("round-trips the target and rejects malformed target values", () => {
    const project = simple("known - x", 0);
    const restored = importProjectJson(exportProjectJson(project));
    expect(restored.graph.nodes.find(node => node.id === "x")!.goalSeek).toEqual({ targetNodeId: "output", targetValue: 0 });
    expect(calculateGraph(restored).rootValue).toBe(0);
    const raw = JSON.parse(exportProjectJson(project));
    raw.graph.nodes[1].goalSeek.targetValue = "bad";
    expect(() => importProjectJson(JSON.stringify(raw))).toThrow();
  });
});
