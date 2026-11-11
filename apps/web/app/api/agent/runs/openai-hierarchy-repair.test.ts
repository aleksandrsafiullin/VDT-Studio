import { describe, expect, it } from "vitest";
import { VdtBuilderSession, calculateGraph, inspectDecompositionHierarchy, type VdtDecompositionPlan } from "@vdt-studio/vdt-core";
import { AgentRunStore, createDefaultToolRegistry, type AgentToolContext, type VdtAgentStartRequest } from "@vdt-studio/vdt-agent-runtime";
import { rootIdentityWrapper, suggestHierarchyRepair, suggestIdentityPromotion } from "./openai-hierarchy-repair";

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

  it("preserves a manual edge edit made between checked identity repair stages", async () => {
    const builder = new VdtBuilderSession();
    builder.createDraft({ rootKpi: "Total", projectTitle: "Total", unit: "USD" });
    const initial = builder.getProject();
    const root = initial.rootNodeId;
    const request: VdtAgentStartRequest = { ...generate, mode: "continue_project",
      input: { ...generate.input, project: initial }, options: { autoApplyPatches: true } };
    const store = new AgentRunStore();
    const run = store.createRun(request);
    store.updateRun(run.runId, { builder, draftProject: initial });
    const context: AgentToolContext = {
      runId: run.runId, store, builder, signal: run.abortController.signal, requirePlanOperands: true,
      requireDecompositionPlan: true,
      emit: (event) => store.appendEvent(run.runId, event), getRun: () => store.getSnapshot(run.runId),
      updateRun: (patch) => { store.updateRun(run.runId, patch); }
    };
    const registry = createDefaultToolRegistry();
    const write = async (name: string, args: Record<string, unknown>) => {
      expect(await registry.run(name, args, context)).toMatchObject({ ok: true });
    };
    const plan: VdtDecompositionPlan = { version: 1, goal: "Calculate total", nodes: [
      { nodeId: "subtotal", parentNodeId: root, kind: "calculated" },
      { nodeId: "quantity", parentNodeId: "subtotal", kind: "input" },
      { nodeId: "price", parentNodeId: "subtotal", kind: "input" }
    ] };
    await write("vdt.set_decomposition_plan", { plan });
    await write("vdt.add_driver", { parentNodeId: root, nodeId: "subtotal", name: "Subtotal", type: "calculated", unit: "USD" });
    await write("vdt.add_drivers_batch", { drivers: [
      { parentNodeId: "subtotal", nodeId: "quantity", name: "Quantity", unit: "items", baselineValue: 4 },
      { parentNodeId: "subtotal", nodeId: "price", name: "Price", unit: "USD/item", baselineValue: 25 }
    ] });
    await write("vdt.set_formula", { nodeId: "subtotal", formula: "quantity * price" });
    await write("vdt.set_formula", { nodeId: root, formula: "subtotal" });
    const getOwnership = () => store.getState(run.runId);
    const wrapper = rootIdentityWrapper(builder.getProject(), request, getOwnership());
    expect(wrapper?.id).toBe("subtotal");
    const promotion = suggestIdentityPromotion(builder.getProject(), request, getOwnership(), wrapper!);
    expect(promotion).toHaveLength(3);
    for (const { toolName, args } of promotion!) await write(toolName, args);

    const promoted = builder.getProject();
    const cleanOwnership = getOwnership();
    expect(suggestHierarchyRepair(promoted, request, cleanOwnership)?.map(({ toolName }) => toolName))
      .toEqual(["vdt.delete_node", "vdt.set_decomposition_plan"]);
    for (const change of [{ kind: "node_updated", nodeId: "quantity" }, { kind: "project_replaced" }, { kind: "change_set_applied" }] as const) {
      expect(suggestHierarchyRepair(promoted, request, { ...cleanOwnership, manualChanges: [
        { change, observedAt: promoted.updatedAt }
      ] })).toBeUndefined();
    }

    const edgeId = promoted.graph.edges.find(({ targetNodeId }) => targetNodeId === "quantity")!.id;
    const revision = builder.getRevision();
    builder.applyChangeSet({ id: "manual_quantity_link", taskType: "generate_tree", backendId: "user", createdAt: promoted.updatedAt,
      additions: [], updates: [], deletions: [], assumptions: [], questions: [], warnings: [],
      edgeChanges: [{ id: "edit_quantity_edge", action: "update", edgeId, patch: { sourceNodeId: "price" } }]
    });
    expect(builder.getRevision()).toBe(revision + 1);
    const manualProject = builder.getProject();
    expect(suggestHierarchyRepair(manualProject, request, cleanOwnership)).toContainEqual({
      toolName: "vdt.reparent_branch", args: { nodeId: "quantity", parentNodeId: root, fromParentNodeId: "price" }
    });
    store.observeManualChange(run.runId, { projectRevision: builder.getRevision(),
      change: { kind: "edge_updated", edgeId, patch: { sourceNodeId: "price" } }
    });
    expect(suggestHierarchyRepair(manualProject, request, getOwnership())).toBeUndefined();
    expect(builder.getProject()).toEqual(manualProject);
    expect(calculateGraph(manualProject).rootValue).toBe(100);
  });

  it.each(["existing", "manual", "shared", "scenario", "subtotal"] as const)(
    "keeps a %s calculation outside the root identity repair", async (variant) => {
      const builder = new VdtBuilderSession();
      builder.createDraft({ rootKpi: "Total", projectTitle: "Total", unit: "USD" });
      const initial = builder.getProject();
      const root = initial.rootNodeId;
      const request: VdtAgentStartRequest = {
        ...generate, mode: "continue_project", input: { ...generate.input, project: initial },
        options: { autoApplyPatches: true }
      };
      const store = new AgentRunStore();
      const run = store.createRun(request);
      store.updateRun(run.runId, { builder, draftProject: initial });
      const context: AgentToolContext = {
        runId: run.runId, store, builder, signal: run.abortController.signal,
        emit: (event) => store.appendEvent(run.runId, event), getRun: () => store.getSnapshot(run.runId),
        updateRun: (patch) => { store.updateRun(run.runId, patch); }
      };
      expect(await createDefaultToolRegistry().run("vdt.add_driver", {
        parentNodeId: root, nodeId: "net", name: "Net", type: "calculated", unit: "USD"
      }, context)).toMatchObject({ ok: true });
      builder.addDriver({ parentNodeId: "net", nodeId: "sales", name: "Sales", unit: "USD", baselineValue: 80 });
      builder.setFormula({ nodeId: "net", formula: "sales" });
      builder.setFormula({ nodeId: root, formula: "net" });
      const plan: VdtDecompositionPlan = { version: 1, goal: "Calculate total", nodes: [
        { nodeId: "net", parentNodeId: root, kind: "calculated" },
        { nodeId: "sales", parentNodeId: "net", kind: "input" }
      ] };
      builder.updateNode({ nodeId: root, patch: { decompositionPlan: plan } });
      const project = builder.getProject();
      const ownership = store.getState(run.runId);
      expect(rootIdentityWrapper(project, request, ownership)?.id).toBe("net");
      let checked = project;
      if (variant === "existing") request.input.project = project;
      if (variant === "manual") store.observeManualChange(run.runId, { change: { kind: "node_updated", nodeId: "net" } });
      if (variant === "shared") project.graph.nodes.push({
        ...project.graph.nodes.find(({ id }) => id === "net")!, id: "other_calculation", formula: "net * 2"
      });
      if (variant === "scenario") project.scenarios[0]!.overrides.push({ nodeId: "net", value: 85 });
      if (variant === "subtotal") {
        builder.addDriver({ parentNodeId: root, nodeId: "adjustment", name: "Adjustment", unit: "USD", baselineValue: 10 });
        builder.setFormula({ nodeId: root, formula: "net - adjustment" });
        builder.updateNode({ nodeId: root, patch: { decompositionPlan: {
          ...plan, nodes: [...plan.nodes, { nodeId: "adjustment", parentNodeId: root, kind: "input" }]
        } } });
        checked = builder.getProject();
        expect(calculateGraph(checked).rootValue).toBe(70);
        expect(inspectDecompositionHierarchy(checked).valid).toBe(true);
      }
      expect(rootIdentityWrapper(checked, request, store.getState(run.runId))).toBeUndefined();
    }
  );
});
