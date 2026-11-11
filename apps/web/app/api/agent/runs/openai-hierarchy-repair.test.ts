import { describe, expect, it } from "vitest";
import { VdtBuilderSession, calculateGraph, inspectDecompositionHierarchy, type VdtDecompositionPlan } from "@vdt-studio/vdt-core";
import type { VdtAgentStartRequest } from "@vdt-studio/vdt-agent-runtime";
import { suggestHierarchyRepair } from "./openai-hierarchy-repair";

const generate: VdtAgentStartRequest = {
  mode: "generate_vdt", providerId: "openai_compatible", input: { rootKpi: "Total", unit: "USD" }
};

function draft() {
  const builder = new VdtBuilderSession();
  builder.createDraft({ rootKpi: "Total", projectTitle: "Total", unit: "USD" });
  const initialProject = builder.getProject();
  const root = initialProject.rootNodeId;
  const plan: VdtDecompositionPlan = {
    version: 1,
    goal: "Calculate total",
    nodes: [
      { nodeId: "quantity", parentNodeId: root, kind: "input" },
      { nodeId: "price", parentNodeId: root, kind: "input" },
      { nodeId: "rate", parentNodeId: root, kind: "input" },
      { nodeId: "gross", parentNodeId: root, kind: "calculated" },
      { nodeId: "adjustment", parentNodeId: root, kind: "calculated" },
      { nodeId: "duplicate", parentNodeId: root, kind: "calculated" }
    ]
  };
  for (const [nodeId, unit, baselineValue] of [["quantity", "item", 10], ["price", "USD/item", 20], ["rate", "%", 5]] as const) {
    builder.addDriver({ parentNodeId: root, nodeId, name: nodeId, unit, baselineValue });
  }
  builder.updateNode({ nodeId: "price", patch: { valueSource: { note: "20 USD/item" }, valueStatus: "user_provided_value" } });
  for (const [nodeId, formula] of [["gross", "quantity * price"], ["adjustment", "gross * rate / 100"], ["duplicate", "gross - adjustment"]]) {
    builder.addDriver({ parentNodeId: root, nodeId: nodeId!, name: nodeId!, unit: "USD", type: "calculated", formula });
  }
  builder.setFormula({ nodeId: root, formula: "gross - adjustment" });
  builder.updateNode({ nodeId: root, patch: { decompositionPlan: plan } });
  return { builder, root, plan, initialProject };
}

describe("checked hierarchy repair", () => {
  it("offers only plan and edge edits plus removal of an exact unused AI duplicate", () => {
    const { builder, root } = draft();
    const before = builder.getProject();
    expect(calculateGraph(before).rootValue).toBe(190);
    expect(inspectDecompositionHierarchy(before).valid).toBe(false);
    const calls = suggestHierarchyRepair(before, generate);
    expect(calls).toEqual([
      { toolName: "vdt.delete_node", args: { nodeId: "duplicate", cascadeEdges: true } },
      { toolName: "vdt.reparent_branch", args: { nodeId: "quantity", fromParentNodeId: root, parentNodeId: "gross" } },
      { toolName: "vdt.reparent_branch", args: { nodeId: "price", fromParentNodeId: root, parentNodeId: "gross" } },
      { toolName: "vdt.reparent_branch", args: { nodeId: "rate", fromParentNodeId: root, parentNodeId: "adjustment" } },
      { toolName: "vdt.set_decomposition_plan", args: { plan: {
        version: 1, goal: "Calculate total", nodes: [
          { nodeId: "quantity", parentNodeId: "gross", kind: "input", sharedWith: undefined },
          { nodeId: "price", parentNodeId: "gross", kind: "input", sharedWith: undefined },
          { nodeId: "rate", parentNodeId: "adjustment", kind: "input", sharedWith: undefined },
          { nodeId: "gross", parentNodeId: root, kind: "calculated", sharedWith: ["adjustment"] },
          { nodeId: "adjustment", parentNodeId: root, kind: "calculated", sharedWith: undefined }
        ]
      } } }
    ]);
    expect(builder.getProject()).toEqual(before);
  });

  it("keeps an unused result with independent evidence or a different formula for model review", () => {
    const { builder } = draft();
    builder.updateNode({ nodeId: "duplicate", patch: { valueSource: { note: "Retained measurement" } } });
    expect(suggestHierarchyRepair(builder.getProject(), generate)).toBeUndefined();
    const independent = draft();
    independent.builder.setFormula({ nodeId: "duplicate", formula: "gross + adjustment" });
    expect(suggestHierarchyRepair(independent.builder.getProject(), generate)).toBeUndefined();
  });

  it("omits an unbuilt intermediate with no planned inputs from a complete direct calculation", () => {
    const { builder, root, plan, initialProject } = draft();
    for (const nodeId of ["gross", "adjustment", "duplicate"]) builder.deleteNode({ nodeId, cascadeEdges: true });
    builder.setFormula({ nodeId: root, formula: "quantity * price * (1 - rate / 100)" });
    const proposed = suggestHierarchyRepair(builder.getProject(), generate);
    expect(proposed).toHaveLength(1);
    expect(proposed?.[0]).toMatchObject({ toolName: "vdt.set_decomposition_plan", args: {
      plan: { nodes: plan.nodes.slice(0, 3) }
    } });
    const continuation: VdtAgentStartRequest = { ...generate, mode: "continue_project",
      input: { ...generate.input, project: initialProject } };
    expect(suggestHierarchyRepair(builder.getProject(), continuation)).toEqual(proposed);
    for (const patch of [{ baselineValue: 190 }, { decompositionPlan: plan }]) {
      const project = structuredClone(initialProject);
      Object.assign(project.graph.nodes[0]!, patch);
      expect(suggestHierarchyRepair(builder.getProject(), {
        ...continuation, input: { ...continuation.input, project }
      })).toBeUndefined();
    }
    builder.updateNode({ nodeId: root, patch: { decompositionPlan: {
      ...plan, nodes: [...plan.nodes, { nodeId: "missing_fact", parentNodeId: root, kind: "input" }]
    } } });
    expect(suggestHierarchyRepair(builder.getProject(), generate)).toBeUndefined();
  });
});
