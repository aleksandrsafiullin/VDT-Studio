import { describe, expect, it } from "vitest";
import { VdtBuilderSession } from "@vdt-studio/vdt-core";
import { AgentRunStore } from "../run-store";
import type { AgentToolContext } from "../tool-registry";
import { createDefaultToolRegistry } from ".";

const timestamp = "2026-08-26T00:00:00.000Z";

describe("vdt.instantiate_subtree", () => {
  it("clones a strict subtree, remaps internal formulas, and applies source-id-keyed overrides", async () => {
    const { builder, context } = createToolContext();
    const registry = createDefaultToolRegistry();

    const result = await registry.run("vdt.instantiate_subtree", {
      sourceRootNodeId: "fleet",
      targetParentNodeId: "ore_hauled",
      overrides: {
        fleet: { nodeId: "cat_fleet", name: "CAT fleet" },
        fleet_cycles: { formula: "max(fleet_hours, fleet_cycle_time)" },
        fleet_payload: { baselineValue: 200 }
      }
    }, context);

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      sourceRootNodeId: "fleet",
      targetRootNodeId: "cat_fleet",
      sourceToTargetNodeIds: {
        fleet: "cat_fleet",
        fleet_cycles: "cat_fleet_cycles",
        fleet_cycle_time: "cat_fleet_cycle_time",
        fleet_hours: "cat_fleet_hours",
        fleet_payload: "cat_fleet_payload"
      }
    });
    const project = builder.getProject();
    expect(project.graph.nodes.find((node) => node.id === "cat_fleet")).toMatchObject({
      name: "CAT fleet",
      formula: "cat_fleet_payload * cat_fleet_cycles"
    });
    expect(project.graph.nodes.find((node) => node.id === "cat_fleet_cycles")?.formula)
      .toBe("max(cat_fleet_hours, cat_fleet_cycle_time)");
    expect(project.graph.nodes.find((node) => node.id === "cat_fleet_payload")?.baselineValue).toBe(200);
    expect(project.graph.edges.find((edge) => edge.targetNodeId === "cat_fleet")).toMatchObject({
      sourceNodeId: "ore_hauled",
      relation: "additive_component"
    });
    expect(builder.validate().validation.valid).toBe(true);
    expect(builder.calculate().calculation.errors).toEqual([]);
  });

  it("uses the ordinary approval path and does not mutate before approval", async () => {
    const { builder, context } = createToolContext({ autoApplyPatches: false });
    const registry = createDefaultToolRegistry();

    const result = await registry.run("vdt.instantiate_subtree", {
      sourceRootNodeId: "fleet",
      targetParentNodeId: "ore_hauled",
      overrides: { fleet: { nodeId: "cat_fleet", name: "CAT fleet" } }
    }, context);

    expect(result.ok).toBe(true);
    expect(result.projectChanged).toBe(false);
    expect(result.mutationProposal?.status).toBe("proposed");
    expect(builder.getProject().graph.nodes.some((node) => node.id === "cat_fleet")).toBe(false);
    expect(context.store.getSnapshot(context.runId).pendingMutationProposal?.changeSet.additions).toHaveLength(5);
  });

  it("rejects formulas that reference nodes outside the source subtree", async () => {
    const { builder, context } = createToolContext();
    builder.addDriver({
      parentNodeId: "ore_hauled",
      nodeId: "global_factor",
      name: "Global factor",
      baselineValue: 2
    });
    builder.setFormula({ nodeId: "fleet", formula: "fleet_payload * global_factor" });
    const registry = createDefaultToolRegistry();

    const result = await registry.run("vdt.instantiate_subtree", {
      sourceRootNodeId: "fleet",
      targetParentNodeId: "ore_hauled"
    }, context);

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: "EXTERNAL_SUBTREE_REFERENCE",
      details: { sourceNodeId: "fleet", externalReferences: ["global_factor"] }
    });
    expect(builder.getProject().graph.nodes.some((node) => node.id === "fleet_copy")).toBe(false);
  });

  it("rejects a subtree with a cross-boundary second parent", async () => {
    const { builder, context } = createToolContext();
    builder.addDriver({
      parentNodeId: "ore_hauled",
      nodeId: "shared_inputs",
      name: "Shared inputs",
      type: "calculated",
      formula: "fleet_payload"
    });
    builder.addEdge({
      sourceNodeId: "shared_inputs",
      targetNodeId: "fleet_payload",
      relation: "formula_dependency"
    });
    const registry = createDefaultToolRegistry();

    const result = await registry.run("vdt.instantiate_subtree", {
      sourceRootNodeId: "fleet",
      targetParentNodeId: "ore_hauled"
    }, context);

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: "AMBIGUOUS_SUBTREE" });
    expect(builder.getProject().graph.nodes.some((node) => node.id === "fleet_copy")).toBe(false);
  });

  it("returns ENUM_FIELD_MISMATCH when an edge relation is supplied as node type", async () => {
    const { builder, context } = createToolContext();
    const registry = createDefaultToolRegistry();

    const result = await registry.run("vdt.add_driver", {
      parentNodeId: "ore_hauled",
      nodeId: "bad_enum",
      name: "Bad enum",
      type: "positive_driver"
    }, context);

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: "ENUM_FIELD_MISMATCH",
      details: { field: "type", received: "positive_driver", relationField: "relation" }
    });
    expect(builder.getProject().graph.nodes.some((node) => node.id === "bad_enum")).toBe(false);
  });

  it("normalizes the unambiguous additive_driver relation alias locally", async () => {
    const { builder, context } = createToolContext();
    const registry = createDefaultToolRegistry();

    const result = await registry.run("vdt.add_driver", {
      parentNodeId: "ore_hauled",
      nodeId: "additive_input",
      name: "Additive input",
      type: "input",
      relation: "additive_driver",
      baselineValue: 1
    }, context);

    expect(result.ok).toBe(true);
    expect(builder.getProject().graph.edges.find((edge) => edge.targetNodeId === "additive_input")?.relation)
      .toBe("additive_component");
  });

  it("rejects unknown input fields before constructing a proposal", async () => {
    const { context } = createToolContext();
    const registry = createDefaultToolRegistry();

    const result = await registry.run("vdt.instantiate_subtree", {
      sourceRootNodeId: "fleet",
      targetParentNodeId: "ore_hauled",
      unexpectedAuthority: "project-id"
    }, context);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_TOOL_ARGS");
  });
});

function createToolContext(options: { autoApplyPatches?: boolean } = {}): {
  builder: VdtBuilderSession;
  context: AgentToolContext;
} {
  const store = new AgentRunStore({ now: () => timestamp });
  const run = store.createRun({
    mode: "continue_project",
    input: { rootKpi: "Ore hauled", unit: "tonnes/year", timePeriod: "year" },
    providerId: "mock",
    options: { autoApplyPatches: options.autoApplyPatches ?? true }
  });
  const builder = new VdtBuilderSession({ now: () => timestamp });
  builder.createDraft({
    projectTitle: "Ore hauled Driver Model",
    rootKpi: "Ore hauled",
    unit: "tonnes/year",
    timePeriod: "year"
  });
  builder.addDriver({
    parentNodeId: "ore_hauled",
    nodeId: "fleet",
    name: "BelAZ fleet",
    type: "calculated",
    relation: "additive_component",
    formula: "fleet_payload * fleet_cycles"
  });
  builder.addDriver({
    parentNodeId: "fleet",
    nodeId: "fleet_payload",
    name: "Fleet payload",
    baselineValue: 100
  });
  builder.addDriver({
    parentNodeId: "fleet",
    nodeId: "fleet_cycles",
    name: "Fleet cycles",
    type: "calculated",
    formula: "fleet_hours / fleet_cycle_time"
  });
  builder.addDriver({
    parentNodeId: "fleet_cycles",
    nodeId: "fleet_hours",
    name: "Fleet hours",
    baselineValue: 20
  });
  builder.addDriver({
    parentNodeId: "fleet_cycles",
    nodeId: "fleet_cycle_time",
    name: "Fleet cycle time",
    baselineValue: 5
  });
  builder.setFormula({ nodeId: "ore_hauled", formula: "fleet" });
  store.updateRun(run.runId, { builder, draftProject: builder.getProject() });
  const context: AgentToolContext = {
    runId: run.runId,
    store,
    emit: (event) => store.appendEvent(run.runId, event),
    getRun: () => store.getSnapshot(run.runId),
    updateRun: (patch) => {
      store.updateRun(run.runId, patch);
    },
    builder,
    signal: run.abortController.signal
  };
  return { builder, context };
}
