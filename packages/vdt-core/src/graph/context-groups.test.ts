import { describe, expect, it } from "vitest";
import { VdtBuilderSession } from "../builder/session";
import { calculateGraph } from "../formula/calculate";
import { exportProjectJson, importProjectJson } from "../export/export";
import { decompositionPlanErrors, getDecompositionContextGroupIds, inspectDecompositionHierarchy } from "./decomposition";

function example() {
  const b = new VdtBuilderSession();
  b.createDraft({ rootKpi: "Output", projectTitle: "Groups", unit: "t" });
  b.addDriver({ nodeId: "rate", parentNodeId: "output", name: "Rate", baselineValue: 2 });
  b.setFormula({ nodeId: "output", formula: "rate * 3" });
  b.addDriver({ nodeId: "refs", parentNodeId: "output", name: "Equipment references", type: "external_factor", relation: "contextual_influence" });
  for (const nodeId of ["speed", "capacity"]) b.addDriver({ nodeId, parentNodeId: "refs", name: nodeId, baselineValue: 10, relation: "contextual_influence" });
  b.updateNode({ nodeId: "output", patch: { decompositionPlan: { version: 1, goal: "Production with separate equipment references", nodes: [
    { nodeId: "rate", parentNodeId: "output", kind: "input" },
    { nodeId: "refs", parentNodeId: "output", kind: "context", rationale: "Reference container" },
    { nodeId: "speed", parentNodeId: "refs", kind: "context", rationale: "OEM reference" },
    { nodeId: "capacity", parentNodeId: "refs", kind: "context", rationale: "OEM reference" }
  ] } } });
  return b.getProject();
}

describe("non-numerical reference groups", () => {
  it("calculates a complete tree without inventing a value for its context container", () => {
    const p = example();
    expect(getDecompositionContextGroupIds(p.graph, p.rootNodeId)).toEqual(new Set(["refs"]));
    expect(calculateGraph(p)).toMatchObject({ rootValue: 6, errors: [] });
    expect(calculateGraph(p.graph, { rootNodeId: p.rootNodeId }).errors).toEqual([]);
    expect(calculateGraph(p).values.refs).toBeUndefined();
    expect(inspectDecompositionHierarchy(p).valid).toBe(true);
  });
  it("still rejects missing numerical leaves and using a group as a numeric factor", () => {
    const p = example();
    delete p.graph.nodes.find(n => n.id === "speed")!.baselineValue;
    expect(calculateGraph(p).errors.some(e => e.type === "missing_value" && e.nodeId === "speed")).toBe(true);
    const active = example(); active.graph.nodes[0]!.formula = "rate + refs";
    expect(calculateGraph(active).errors.length).toBeGreaterThan(0);
    expect(inspectDecompositionHierarchy(active).errors.join()).toContain("ACTIVE_FACTOR_MARKED_CONTEXT");
  });
  it("blocks reference-column flattening while keeping historical snapshots readable", () => {
    const p = example(); p.graph.nodes = p.graph.nodes.filter(n => n.id !== "refs");
    p.graph.edges = p.graph.edges.filter(e => e.targetNodeId !== "refs").map(e => ({ ...e, sourceNodeId: "output" }));
    const plan = p.graph.nodes[0]!.decompositionPlan!;
    plan.nodes = plan.nodes.filter(n => n.nodeId !== "refs").map(n => ({ ...n, parentNodeId: "output" }));
    expect(decompositionPlanErrors(plan, p.rootNodeId)).toEqual([]);
    expect(importProjectJson(exportProjectJson(p)).graph.nodes).toHaveLength(4);
    expect(inspectDecompositionHierarchy(p).errors.join()).toContain("ROOT_CONTEXT_LEAVES_REQUIRE_GROUP");
  });
  it("keeps a supplied numeric context summary and does not suppress malformed metadata", () => {
    const p = example(); p.graph.nodes.find(n => n.id === "refs")!.value = 20;
    expect(getDecompositionContextGroupIds(p.graph, p.rootNodeId).size).toBe(0);
    expect(calculateGraph(p).values.refs).toBe(20);
    delete p.graph.nodes.find(n => n.id === "refs")!.value;
    p.graph.nodes[0]!.decompositionPlan!.nodes[1]!.parentNodeId = "missing";
    expect(getDecompositionContextGroupIds(p.graph, p.rootNodeId).size).toBe(0);
    expect(calculateGraph(p).errors.some(e => e.nodeId === "refs")).toBe(true);
  });
});
