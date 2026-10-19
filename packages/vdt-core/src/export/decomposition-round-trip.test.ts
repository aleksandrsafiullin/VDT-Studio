import { describe, expect, it } from "vitest";
import { productionVolumeProject, type VdtProject } from "../index";
import { exportProjectJson, importProjectJson } from "./export";

function plannedProject(): VdtProject {
  const project = structuredClone(productionVolumeProject);
  project.graph.nodes.find(node => node.id === project.rootNodeId)!.decompositionPlan = {
    version: 1,
    goal: "Build production by time and rate",
    nodes: [
      { nodeId: "planned_production", parentNodeId: project.rootNodeId, kind: "calculated" },
      { nodeId: "planned_time", parentNodeId: "planned_production", kind: "input", sharedWith: [project.rootNodeId] },
      { nodeId: "reference", parentNodeId: project.rootNodeId, kind: "context", rationale: "OEM reference" }
    ]
  };
  return project;
}

describe("decomposition plan persistence", () => {
  it("round-trips a complete plan even while its future nodes are not built", () => {
    const project = plannedProject();
    const imported = importProjectJson(exportProjectJson(project));
    expect(imported.graph.nodes.find(node => node.id === project.rootNodeId)!.decompositionPlan)
      .toEqual(project.graph.nodes.find(node => node.id === project.rootNodeId)!.decompositionPlan);
  });

  it("rejects malformed plans and metadata placed outside the root", () => {
    const project = plannedProject();
    const root = project.graph.nodes.find(node => node.id === project.rootNodeId)!;
    root.decompositionPlan!.nodes[0]!.parentNodeId = "absent";
    expect(() => importProjectJson(exportProjectJson(project))).toThrow(/decomposition plan is invalid/);
    const misplaced = plannedProject();
    const other = misplaced.graph.nodes.find(node => node.id !== misplaced.rootNodeId)!;
    other.decompositionPlan = { version: 1, goal: "Wrong owner", nodes: [{ nodeId: "future", parentNodeId: other.id, kind: "input" }] };
    expect(() => importProjectJson(exportProjectJson(misplaced))).toThrow(/root KPI/);
  });
});
