import { z } from "zod";
import type { VdtBuilderSession } from "@vdt-studio/vdt-core";
import type { AgentTool } from "../tool-registry";

const nodePatchSchema = z.record(z.unknown());

export function createVdtBuilderTools(): AgentTool[] {
  return [
    createDraftTool,
    addDriverTool,
    updateNodeTool,
    setFormulaTool,
    validateTool,
    layoutTool,
    calculateTool
  ];
}

const createDraftTool: AgentTool = {
  name: "vdt.create_draft",
  description: "Create a draft VDT project and root KPI node.",
  inputSchema: z.object({
    projectTitle: z.string().min(1).max(240),
    rootKpi: z.string().min(1).max(200),
    unit: z.string().max(80).optional(),
    timePeriod: z.string().max(80).optional(),
    industry: z.string().max(160).optional(),
    businessContext: z.string().max(2_000).optional(),
    goal: z.string().max(1_000).optional()
  }),
  outputSchema: z.object({ projectId: z.string(), rootNodeId: z.string(), revision: z.number() }),
  run(context, input) {
    const builder = requireBuilder(context.builder);
    const result = builder.createDraft(input);
    context.store.updateRun(context.runId, { draftProject: result.project });
    context.emit({
      type: "graph_patch",
      phase: "building_graph",
      title: "Draft root created",
      message: result.event.message,
      metadata: { revision: result.revision, rootNodeId: result.project.rootNodeId }
    });
    return { projectId: result.project.id, rootNodeId: result.project.rootNodeId, revision: result.revision };
  }
};

const addDriverTool: AgentTool = {
  name: "vdt.add_driver",
  description: "Add a driver node and edge under an existing parent node.",
  inputSchema: z.object({
    parentNodeId: z.string().min(1).max(160),
    nodeId: z.string().max(160).optional(),
    name: z.string().min(1).max(200),
    type: z.enum(["root_kpi", "calculated", "input", "assumption", "external_factor", "data_mapped"]).optional(),
    unit: z.string().max(80).optional(),
    relation: z.enum([
      "positive_driver",
      "negative_driver",
      "multiplicative_driver",
      "divisive_driver",
      "additive_component",
      "subtractive_component",
      "contextual_influence",
      "formula_dependency"
    ]).optional(),
    formula: z.string().max(500).optional(),
    baselineValue: z.number().finite().optional(),
    description: z.string().max(1_000).optional(),
    aiRationale: z.string().max(800).optional(),
    assumptions: z.array(z.string().max(300)).max(20).optional()
  }),
  outputSchema: z.object({ nodeId: z.string(), revision: z.number() }),
  run(context, input) {
    const builder = requireBuilder(context.builder);
    const result = builder.addDriver(input);
    context.store.updateRun(context.runId, { draftProject: result.project, pendingChangeSet: result.changeSet });
    context.emit({
      type: "graph_patch",
      phase: "building_graph",
      title: "Driver added",
      message: result.event.message,
      patch: result.changeSet,
      metadata: { revision: result.revision, nodeId: result.changeSet?.additions[0]?.nodeId }
    });
    return { nodeId: result.changeSet?.additions[0]?.nodeId ?? input.nodeId ?? input.name, revision: result.revision };
  }
};

const updateNodeTool: AgentTool = {
  name: "vdt.update_node",
  description: "Update a bounded node patch.",
  inputSchema: z.object({ nodeId: z.string().min(1), patch: nodePatchSchema }),
  outputSchema: z.object({ nodeId: z.string(), revision: z.number() }),
  run(context, input) {
    const result = requireBuilder(context.builder).updateNode({ nodeId: input.nodeId, patch: input.patch });
    context.store.updateRun(context.runId, { draftProject: result.project, pendingChangeSet: result.changeSet });
    context.emit({
      type: "graph_patch",
      phase: "building_graph",
      title: "Node updated",
      message: result.event.message,
      patch: result.changeSet,
      metadata: { revision: result.revision, nodeId: input.nodeId }
    });
    return { nodeId: input.nodeId, revision: result.revision };
  }
};

const setFormulaTool: AgentTool = {
  name: "vdt.set_formula",
  description: "Set a formula after parser validation.",
  inputSchema: z.object({
    nodeId: z.string().min(1).max(160),
    formula: z.string().min(1).max(500)
  }),
  outputSchema: z.object({ nodeId: z.string(), revision: z.number() }),
  run(context, input) {
    const result = requireBuilder(context.builder).setFormula(input);
    context.store.updateRun(context.runId, { draftProject: result.project, pendingChangeSet: result.changeSet });
    context.emit({
      type: "graph_patch",
      phase: "building_graph",
      title: "Formula set",
      message: result.event.message,
      patch: result.changeSet,
      metadata: { revision: result.revision, nodeId: input.nodeId }
    });
    return { nodeId: input.nodeId, revision: result.revision };
  }
};

const validateTool: AgentTool = {
  name: "vdt.validate",
  description: "Validate the current draft graph.",
  inputSchema: z.object({}),
  outputSchema: z.object({ valid: z.boolean(), errors: z.number(), warnings: z.number() }),
  run(context) {
    const validation = requireBuilder(context.builder).validate().validation;
    context.emit({
      type: "graph_validation",
      phase: "validating_graph",
      title: validation.valid ? "Graph validation passed" : "Graph validation found issues",
      message: validation.valid
        ? `Graph validation passed with ${validation.warnings.length} warning${validation.warnings.length === 1 ? "" : "s"}.`
        : `Graph validation found ${validation.errors.length} error${validation.errors.length === 1 ? "" : "s"}.`,
      metadata: { errors: validation.errors.length, warnings: validation.warnings.length }
    });
    return { valid: validation.valid, errors: validation.errors.length, warnings: validation.warnings.length };
  }
};

const layoutTool: AgentTool = {
  name: "vdt.layout",
  description: "Layout the current draft graph.",
  inputSchema: z.object({}),
  outputSchema: z.object({ revision: z.number() }),
  run(context) {
    const result = requireBuilder(context.builder).layout();
    context.store.updateRun(context.runId, { draftProject: result.project });
    context.emit({
      type: "graph_patch",
      phase: "applying_graph",
      title: "Layout applied",
      message: result.event.message,
      metadata: { revision: result.revision }
    });
    return { revision: result.revision };
  }
};

const calculateTool: AgentTool = {
  name: "vdt.calculate",
  description: "Calculate deterministic graph values.",
  inputSchema: z.object({}),
  outputSchema: z.object({ values: z.number(), errors: z.number(), warnings: z.number() }),
  run(context) {
    const calculation = requireBuilder(context.builder).calculate().calculation;
    return {
      values: Object.keys(calculation.values).length,
      errors: calculation.errors.length,
      warnings: calculation.warnings.length
    };
  }
};

function requireBuilder(builder: VdtBuilderSession | undefined): VdtBuilderSession {
  if (!builder) throw new Error("VDT builder session is not available for this run.");
  return builder;
}
