import { describe, expect, it } from "vitest";
import { applyChangeSet, calculateGraph, cloneProject, exportProjectJson, extractFormulaReferences, importProjectJson, productionVolumeProject, validateGraph, type VdtNode, type VdtProject } from "../index";

const date = "2026-11-01T00:00:00.000Z";
const node = (id: string, unit?: string, patch: Partial<VdtNode> = {}): VdtNode => ({
  id, name: id, type: "input", status: "accepted", unit, baselineValue: 10, aiGenerated: false, createdAt: date, updatedAt: date, ...patch
});
function model(formula = "x * y", output = "t/month", x = "h/month", y = "t/h"): VdtProject {
  return { ...cloneProject(productionVolumeProject), rootNodeId: "output", scenarios: [], versions: [], dataSources: [], graph: {
    nodes: [node("output", output, { type: "root_kpi", formula }), node("x", x), node("y", y, { type: "external_factor" })],
    edges: extractFormulaReferences(formula).map(id => ({ id: `output_${id}`, sourceNodeId: "output", targetNodeId: id, relation: "formula_dependency", aiGenerated: false }))
  } };
}

describe("F-05 model contract", () => {
  it.each([
    ["x * y", "t/month", "hours/month", "tonnes/hour"],
    ["x * y", "  (t/month)  ", " hours/month ", " tonnes/hour "],
    ["x / y", "USD/item", "USD/month", "items/month"],
    ["-(x + y)", "h/day", "hours/day", "h/day"],
    ["max(x, min(y, 100))", "kg", "kg", "kilograms"],
    ["x * x", "m^2", "metres", "m"],
    ["x / x", "fraction", "km/trip", "fraction"],
    ["x / (y * y)", "m/s^2", "m", "seconds"],
    ["2 * x + 5", "widgets/month", "widgets/month", "fraction"],
    ["x * y / 100", "%", "%", "%"],
    ["x + y", "USD_2026", "USD_2026", "USD_2026"]
  ])("accepts compatible formula %s with output %s", (formula, output, x, y) => {
    expect(validateGraph(model(formula, output, x, y)).errors).toEqual([]);
  });

  it.each([
    ["x * 60", "min", "h"], ["x / 60", "min", "s"],
    ["x * 1000", "kg", "t"], ["x * (60 - 0)", "min", "h"],
    ["x * 24", "h", "day"], ["x * 3600", "t/h", "t/s"]
  ])("checks the explicit numeric scale in %s", (formula, output, unit) => {
    expect(validateGraph(model(formula, output, unit)).errors).toEqual([]);
  });

  it.each(["x * 2", "x * 600", "x / 60"])("rejects a wrong hour-to-minute scale in %s", formula => {
    expect(validateGraph(model(formula, "min", "h")).errors.some(issue => issue.type === "unit_mismatch")).toBe(true);
  });

  it("requires review instead of inventing the dimension of a custom per-entity basis", () => {
    const project = model("x * y", "t", "custom_devices", "t");
    expect(validateGraph(project).warnings.some(issue => issue.message.includes("per-entity basis"))).toBe(true);
    expect(validateGraph(project).errors).toEqual([]);
  });

  it("supports incremental drafts without reporting their unfinished model as valid", () => {
    const project = model("x", "h", "h");
    project.graph.edges.push({ id: "pending_factor", sourceNodeId: "output", targetNodeId: "y", relation: "formula_dependency", aiGenerated: false });
    expect(validateGraph(project, undefined, { purpose: "draft" }).valid).toBe(true);
    expect(validateGraph(project).valid).toBe(false);
    project.graph.nodes[0]!.formula = "x * y"; project.graph.nodes[0]!.unit = "USD";
    expect(validateGraph(project, undefined, { purpose: "draft" }).valid).toBe(false);
  });

  it.each([
    ["x * y", "USD", "h/month", "t/h"],
    ["x / y", "t", "USD", "h"],
    ["x + y", "h", "h", "min"],
    ["min(x, y)", "USD", "USD", "EUR"],
    ["x + y", "t/month", "t/month", "t/year"],
    ["x * y", "kg", "tonnes", "fraction"],
    ["x", "km", "m", "fraction"],
    ["x + y", "USD_2026", "USD_2026", "USD_2025"],
    ["x * y", "m", "m", "m"]
  ])("blocks incompatible formula %s with output %s", (formula, output, x, y) => {
    const validation = validateGraph(model(formula, output, x, y));
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContainEqual(expect.objectContaining({ type: "unit_mismatch", nodeId: "output", severity: "error" }));
  });

  it("does not claim missing or malformed units have been verified", () => {
    const project = model();
    project.graph.nodes[1]!.unit = undefined;
    expect(validateGraph(project).warnings).toContainEqual(expect.objectContaining({ type: "unit_mismatch", nodeId: "output" }));
    project.graph.nodes[1]!.unit = "h/**month";
    expect(validateGraph(project).warnings.some(issue => issue.message.includes("cannot be checked"))).toBe(true);
  });

  it("checks intermediate results as well as the root result", () => {
    const project = cloneProject(productionVolumeProject);
    project.graph.nodes.find(item => item.id === "average_productivity")!.unit = "USD";
    const errors = validateGraph(project).errors.filter(issue => issue.type === "unit_mismatch");
    expect(errors.some(issue => issue.nodeId === "average_productivity")).toBe(true);
    expect(errors.some(issue => issue.nodeId === project.rootNodeId)).toBe(true);
  });

  it("requires the correct root role and a finite value or formula, retaining zero", () => {
    const project = model("x", "h", "h");
    const root = project.graph.nodes[0]!;
    root.type = "input";
    expect(validateGraph(project).errors.some(issue => issue.message.includes("must have type Root KPI"))).toBe(true);
    root.type = "root_kpi"; root.formula = undefined; root.baselineValue = 0;
    project.graph.edges = []; project.graph.nodes = [root];
    expect(validateGraph(project).errors).toEqual([]);
    for (const value of [undefined, NaN, Infinity]) {
      root.baselineValue = value;
      expect(validateGraph(project).errors).toContainEqual(expect.objectContaining({ type: "missing_value", nodeId: "output" }));
    }
  });

  it("rejects another root marker and formula-free Calculated nodes", () => {
    const project = model();
    project.graph.nodes[1]!.type = "root_kpi";
    expect(validateGraph(project).errors.some(issue => issue.id.includes("extra-root"))).toBe(true);
    project.graph.nodes[1]!.type = "calculated";
    expect(validateGraph(project).errors).toContainEqual(expect.objectContaining({ type: "missing_formula", nodeId: "x" }));
  });

  it.each(["formula_dependency", "contextual_influence"] as const)("blocks visual cycles involving %s even with acyclic formulas", relation => {
    const project = model();
    project.graph.edges.push({ id: "back", sourceNodeId: "x", targetNodeId: "output", relation, aiGenerated: false });
    const result = validateGraph(project);
    expect(result.valid).toBe(false);
    expect(result.errors.some(issue => issue.type === "circular_dependency" && issue.message.includes("Visual links"))).toBe(true);
    expect(result.errors.some(issue => issue.id.includes("root-parent"))).toBe(true);
    expect(calculateGraph(project).errors).toEqual([]);
  });

  it("detects a visual cycle outside the root calculation and self-links", () => {
    const project = model();
    project.graph.nodes.push(node("reference", "h"));
    project.graph.edges.push({ id: "context", sourceNodeId: "output", targetNodeId: "reference", relation: "contextual_influence", aiGenerated: false },
      { id: "self", sourceNodeId: "reference", targetNodeId: "reference", relation: "contextual_influence", aiGenerated: false });
    expect(validateGraph(project).errors.some(issue => issue.edgeId === "self" && issue.type === "circular_dependency")).toBe(true);
  });

  it("requires both directions of mathematical formula/link reconciliation", () => {
    const missing = model(); missing.graph.edges.pop();
    expect(validateGraph(missing).errors.some(issue => issue.id.includes("missing-factor-output-y"))).toBe(true);
    const unused = model("x", "h", "h");
    unused.graph.edges.push({ id: "unused", sourceNodeId: "output", targetNodeId: "y", relation: "positive_driver", aiGenerated: false });
    expect(validateGraph(unused).errors.some(issue => issue.edgeId === "unused" && issue.message.includes("not used"))).toBe(true);
    unused.graph.edges.at(-1)!.relation = "contextual_influence";
    expect(validateGraph(unused).errors).toEqual([]);
    unused.graph.nodes[0]!.formula = "x * y";
    expect(validateGraph(unused).errors.some(issue => issue.edgeId === "unused" && issue.message.includes("link is contextual"))).toBe(true);
  });

  it("preserves explicit shared references without requiring another primary edge", () => {
    const project = model("x + y", "count", "count", "count");
    for (const item of project.graph.nodes.slice(1)) { item.type = "calculated"; item.formula = "shared"; }
    project.graph.nodes.push(node("shared", "count"));
    project.graph.edges.push({ id: "primary", sourceNodeId: "x", targetNodeId: "shared", relation: "formula_dependency", aiGenerated: false });
    project.graph.nodes[0]!.decompositionPlan = { version: 1, goal: "Explicit source reuse", nodes: [
      { nodeId: "x", parentNodeId: "output", kind: "calculated" }, { nodeId: "y", parentNodeId: "output", kind: "calculated" },
      { nodeId: "shared", parentNodeId: "x", kind: "input", sharedWith: ["y"] }
    ] };
    expect(validateGraph(project).errors).toEqual([]);
    expect(calculateGraph(project).rootValue).toBe(20);
    project.graph.nodes[0]!.decompositionPlan!.nodes[2]!.sharedWith = [];
    expect(validateGraph(project).errors.some(issue => issue.id.includes("missing-factor-y-shared"))).toBe(true);
  });

  it("keeps an explicit off-root reference calculation local until activated", () => {
    const project = model("x", "h", "h");
    const reference = project.graph.nodes[2]!;
    reference.type = "calculated"; reference.unit = "h"; reference.formula = "reference_input";
    project.graph.nodes.push(node("reference_input", "h"));
    project.graph.edges.push(...[["output", "y"], ["y", "reference_input"]].map(([sourceNodeId, targetNodeId], index) => ({
      id: `reference_${index}`, sourceNodeId: sourceNodeId!, targetNodeId: targetNodeId!, relation: "contextual_influence" as const, aiGenerated: false
    })));
    expect(validateGraph(project).errors).toEqual([]);
    project.graph.nodes[0]!.formula = "x + y";
    expect(validateGraph(project).errors.some(issue => issue.message.includes("link is contextual"))).toBe(true);
  });

  it("retains repairable drafts through import while reporting their model errors", () => {
    const project = cloneProject(productionVolumeProject);
    project.graph.nodes[0]!.unit = "USD";
    project.graph.edges.push({ id: "visual_back", sourceNodeId: "calendar_time", targetNodeId: project.rootNodeId, relation: "contextual_influence", aiGenerated: false });
    const restored = importProjectJson(exportProjectJson(project));
    expect(restored.graph).toEqual(project.graph);
    expect(validateGraph(restored).valid).toBe(false);
    restored.graph.nodes[0]!.formula = "missing_node";
    expect(() => importProjectJson(exportProjectJson(restored))).toThrow(/missing node/);
  });

  it("rejects invalid apply operations atomically and permits a real repair", () => {
    const project = cloneProject(productionVolumeProject), before = exportProjectJson(project);
    const changeSet = { id: "f05", taskType: "suggest_formula" as const, backendId: "manual", createdAt: date,
      additions: [], deletions: [], edgeChanges: [], assumptions: [], questions: [], warnings: [],
      updates: [{ id: "unit", nodeId: project.rootNodeId, patch: { unit: "USD" } }] };
    const result = applyChangeSet(project, changeSet, new Set(["unit"]));
    expect(result.success).toBe(false);
    expect(exportProjectJson(project)).toBe(before);
    expect(result.warnings.some(issue => issue.type === "unit_mismatch")).toBe(true);
    project.graph.nodes[0]!.unit = "USD";
    changeSet.updates[0]!.patch.unit = "tonnes/month";
    const repaired = applyChangeSet(project, changeSet, new Set(["unit"]));
    expect(repaired.success).toBe(true);
    expect(validateGraph(repaired.project).valid).toBe(true);
  });
});
