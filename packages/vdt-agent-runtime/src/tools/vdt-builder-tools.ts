import { z } from "zod";
import {
  extractFormulaReferences,
  type VdtBuilderSession,
  type VdtEdgeRelation,
  type VdtNodePatch
} from "@vdt-studio/vdt-core";
import { AgentToolError, type AgentTool } from "../tool-registry";
import { summarizeCalculation, summarizeValidation } from "../summaries";

const nodeTypeSchema = z.enum(["root_kpi", "calculated", "input", "assumption", "external_factor", "data_mapped"]);
const nodeStatusSchema = z.enum([
  "ai_suggested",
  "accepted",
  "edited",
  "rejected",
  "needs_data",
  "formula_issue",
  "unit_issue",
  "assumption",
  "external_factor"
]);
const edgeRelationSchema = z.enum([
  "positive_driver",
  "negative_driver",
  "multiplicative_driver",
  "divisive_driver",
  "additive_component",
  "subtractive_component",
  "contextual_influence",
  "formula_dependency"
]);

const nodePatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1_000).optional(),
  type: nodeTypeSchema.optional(),
  unit: z.string().max(80).optional(),
  formula: z.string().max(500).optional(),
  baselineValue: z.number().finite().optional(),
  value: z.number().finite().optional(),
  status: nodeStatusSchema.optional(),
  assumptions: z.array(z.string().max(300)).max(20).optional(),
  tags: z.array(z.string().max(80)).max(20).optional(),
  controllability: z.enum(["high", "medium", "low", "none"]).optional(),
  materiality: z.enum(["high", "medium", "low", "unknown"]).optional()
}).strict();

export function createVdtBuilderTools(): AgentTool[] {
  return [
    createDraftTool,
    addDriverTool,
    addEdgeTool,
    updateNodeTool,
    deleteNodeTool,
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
    goal: z.string().max(1_000).optional(),
    replaceExisting: z.boolean().optional()
  }),
  outputSchema: z.record(z.unknown()),
  mutatesProject: true,
  phase: "building_graph",
  run(context, input) {
    const builder = requireBuilder(context.builder);
    const existing = builder.getProject();
    if (existing.graph.nodes.length > 0 && input.replaceExisting !== true) {
      throw new AgentToolError("DRAFT_ALREADY_EXISTS", "Draft project already exists. Pass replaceExisting=true to replace it.");
    }
    const result = builder.createDraft(input);
    const validation = summarizeValidation(builder.validate().validation);
    context.store.updateRun(context.runId, {
      draftProject: result.project,
      validationState: validation
    });
    context.emit({
      type: "graph_patch",
      phase: "building_graph",
      title: "Draft root created",
      message: result.event.message,
      metadata: { revision: result.revision, rootNodeId: result.project.rootNodeId }
    });
    return { projectId: result.project.id, rootNodeId: result.project.rootNodeId, revision: result.revision, validation };
  }
};

const addDriverTool: AgentTool = {
  name: "vdt.add_driver",
  description: "Add one driver node and edge under an existing parent node.",
  inputSchema: z.object({
    parentNodeId: z.string().min(1).max(160),
    nodeId: z.string().max(160).optional(),
    name: z.string().min(1).max(200),
    type: nodeTypeSchema.optional(),
    unit: z.string().max(80).optional(),
    relation: edgeRelationSchema.optional(),
    formula: z.string().max(500).optional(),
    baselineValue: z.number().finite().optional(),
    description: z.string().max(1_000).optional(),
    aiRationale: z.string().max(800).optional(),
    assumptions: z.array(z.string().max(300)).max(20).optional()
  }),
  outputSchema: z.record(z.unknown()),
  mutatesProject: true,
  requiresDraftProject: true,
  phase: "building_graph",
  run(context, input) {
    const builder = requireBuilder(context.builder);
    const project = builder.getProject();
    const nodeIds = new Set(project.graph.nodes.map((node) => node.id));
    if (!nodeIds.has(input.parentNodeId)) {
      throw new AgentToolError("PARENT_NOT_FOUND", `Parent node "${input.parentNodeId}" was not found.`);
    }
    if (input.nodeId && nodeIds.has(input.nodeId)) {
      throw new AgentToolError("NODE_ID_EXISTS", `Node id "${input.nodeId}" already exists.`);
    }
    const result = builder.addDriver(input);
    const nodeId = result.changeSet?.additions[0]?.nodeId ?? input.nodeId ?? input.name;
    const edgeId = result.changeSet?.edgeChanges[0]?.action === "add"
      ? result.changeSet.edgeChanges[0].edge.id
      : "";
    const validation = summarizeValidation(builder.validate().validation);
    context.store.updateRun(context.runId, {
      draftProject: result.project,
      pendingChangeSet: result.changeSet,
      validationState: validation
    });
    context.emit({
      type: "graph_patch",
      phase: "building_graph",
      title: "Driver added",
      message: result.event.message,
      patch: result.changeSet,
      metadata: { revision: result.revision, nodeId, edgeId }
    });
    return { nodeId, edgeId, revision: result.revision, validation };
  }
};

const addEdgeTool: AgentTool = {
  name: "vdt.add_edge",
  description: "Add one visual or formula-dependency edge between existing nodes.",
  inputSchema: z.object({
    sourceNodeId: z.string().min(1).max(160),
    targetNodeId: z.string().min(1).max(160),
    relation: edgeRelationSchema,
    label: z.string().max(120).optional()
  }),
  outputSchema: z.record(z.unknown()),
  mutatesProject: true,
  requiresDraftProject: true,
  phase: "building_graph",
  run(context, input) {
    const builder = requireBuilder(context.builder);
    const project = builder.getProject();
    const nodeIds = new Set(project.graph.nodes.map((node) => node.id));
    if (!nodeIds.has(input.sourceNodeId)) throw new AgentToolError("SOURCE_NOT_FOUND", `Source node "${input.sourceNodeId}" was not found.`);
    if (!nodeIds.has(input.targetNodeId)) throw new AgentToolError("TARGET_NOT_FOUND", `Target node "${input.targetNodeId}" was not found.`);
    const result = builder.addEdge(input);
    const edgeId = result.changeSet?.edgeChanges[0]?.action === "add"
      ? result.changeSet.edgeChanges[0].edge.id
      : "";
    const validation = summarizeValidation(builder.validate().validation);
    context.store.updateRun(context.runId, {
      draftProject: result.project,
      pendingChangeSet: result.changeSet,
      validationState: validation
    });
    context.emit({
      type: "graph_patch",
      phase: "building_graph",
      title: "Edge added",
      message: result.event.message,
      patch: result.changeSet,
      metadata: { revision: result.revision, edgeId }
    });
    return { edgeId, revision: result.revision, validation };
  }
};

const updateNodeTool: AgentTool = {
  name: "vdt.update_node",
  description: "Update allowed fields on an existing node.",
  inputSchema: z.object({ nodeId: z.string().min(1), patch: nodePatchSchema }),
  outputSchema: z.record(z.unknown()),
  mutatesProject: true,
  requiresDraftProject: true,
  phase: "building_graph",
  run(context, input) {
    const builder = requireBuilder(context.builder);
    const project = builder.getProject();
    if (!project.graph.nodes.some((node) => node.id === input.nodeId)) {
      throw new AgentToolError("NODE_NOT_FOUND", `Node "${input.nodeId}" was not found.`);
    }
    assertFormulaReferencesIfPresent(project, input.patch.formula, input.nodeId);
    const result = builder.updateNode({ nodeId: input.nodeId, patch: input.patch as VdtNodePatch });
    const validation = summarizeValidation(builder.validate().validation);
    context.store.updateRun(context.runId, {
      draftProject: result.project,
      pendingChangeSet: result.changeSet,
      validationState: validation
    });
    context.emit({
      type: "graph_patch",
      phase: "building_graph",
      title: "Node updated",
      message: result.event.message,
      patch: result.changeSet,
      metadata: { revision: result.revision, nodeId: input.nodeId }
    });
    return { nodeId: input.nodeId, revision: result.revision, validation };
  }
};

const deleteNodeTool: AgentTool = {
  name: "vdt.delete_node",
  description: "Delete one non-root node, optionally removing connected edges.",
  inputSchema: z.object({
    nodeId: z.string().min(1).max(160),
    cascadeEdges: z.boolean().optional()
  }),
  outputSchema: z.record(z.unknown()),
  mutatesProject: true,
  requiresDraftProject: true,
  phase: "building_graph",
  run(context, input) {
    const builder = requireBuilder(context.builder);
    const project = builder.getProject();
    const removedEdgeIds = project.graph.edges
      .filter((edge) => edge.sourceNodeId === input.nodeId || edge.targetNodeId === input.nodeId)
      .map((edge) => edge.id);
    const result = builder.deleteNode(input);
    const validation = summarizeValidation(builder.validate().validation);
    context.store.updateRun(context.runId, {
      draftProject: result.project,
      pendingChangeSet: result.changeSet,
      validationState: validation
    });
    context.emit({
      type: "graph_patch",
      phase: "building_graph",
      title: "Node deleted",
      message: result.event.message,
      patch: result.changeSet,
      metadata: { revision: result.revision, nodeId: input.nodeId, removedEdgeIds }
    });
    return { deletedNodeId: input.nodeId, removedEdgeIds, revision: result.revision, validation };
  }
};

const setFormulaTool: AgentTool = {
  name: "vdt.set_formula",
  description: "Set a formula on one node after parser and reference validation.",
  inputSchema: z.object({
    nodeId: z.string().min(1).max(160),
    formula: z.string().min(1).max(500)
  }),
  outputSchema: z.record(z.unknown()),
  mutatesProject: true,
  requiresDraftProject: true,
  phase: "building_graph",
  run(context, input) {
    const builder = requireBuilder(context.builder);
    const project = builder.getProject();
    if (!project.graph.nodes.some((node) => node.id === input.nodeId)) {
      throw new AgentToolError("NODE_NOT_FOUND", `Node "${input.nodeId}" was not found.`);
    }
    assertFormulaReferencesIfPresent(project, input.formula, input.nodeId);
    const result = builder.setFormula(input);
    const validation = summarizeValidation(builder.validate().validation);
    context.store.updateRun(context.runId, {
      draftProject: result.project,
      pendingChangeSet: result.changeSet,
      validationState: validation
    });
    context.emit({
      type: "graph_patch",
      phase: "building_graph",
      title: "Formula set",
      message: result.event.message,
      patch: result.changeSet,
      metadata: { revision: result.revision, nodeId: input.nodeId }
    });
    return { nodeId: input.nodeId, revision: result.revision, validation };
  }
};

const validateTool: AgentTool = {
  name: "vdt.validate",
  description: "Validate the current draft graph and return detailed issues.",
  inputSchema: z.object({}),
  outputSchema: z.record(z.unknown()),
  requiresDraftProject: true,
  phase: "validating_graph",
  run(context) {
    const validation = summarizeValidation(requireBuilder(context.builder).validate().validation);
    context.store.updateRun(context.runId, { validationState: validation });
    context.emit({
      type: "graph_validation",
      phase: "validating_graph",
      title: validation.valid ? "Graph validation passed" : "Graph validation found issues",
      message: validation.valid
        ? `Graph validation passed with ${validation.warnings.length} warning${validation.warnings.length === 1 ? "" : "s"}.`
        : `Graph validation found ${validation.errors.length} error${validation.errors.length === 1 ? "" : "s"}.`,
      metadata: { errors: validation.errors.length, warnings: validation.warnings.length }
    });
    return validation;
  }
};

const layoutTool: AgentTool = {
  name: "vdt.layout",
  description: "Layout the current draft graph.",
  inputSchema: z.object({}),
  outputSchema: z.record(z.unknown()),
  mutatesProject: true,
  requiresDraftProject: true,
  phase: "applying_graph",
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
  description: "Calculate deterministic graph values and return root/calculation details.",
  inputSchema: z.object({}),
  outputSchema: z.record(z.unknown()),
  requiresDraftProject: true,
  phase: "validating_graph",
  run(context) {
    const calculation = summarizeCalculation(requireBuilder(context.builder).calculate().calculation);
    context.store.updateRun(context.runId, { calculationState: calculation });
    return calculation;
  }
};

function requireBuilder(builder: VdtBuilderSession | undefined): VdtBuilderSession {
  if (!builder) throw new AgentToolError("NO_DRAFT_PROJECT", "VDT builder session is not available for this run.");
  return builder;
}

function assertFormulaReferencesIfPresent(project: ReturnType<VdtBuilderSession["getProject"]>, formula: string | undefined, nodeId: string): void {
  if (!formula?.trim()) return;
  let references: string[];
  try {
    references = extractFormulaReferences(formula);
  } catch (error) {
    throw new AgentToolError(
      "FORMULA_PARSE_ERROR",
      error instanceof Error ? error.message : "Formula could not be parsed."
    );
  }
  const availableNodeIds = project.graph.nodes.map((node) => node.id);
  const available = new Set(availableNodeIds);
  const missingReferences = references.filter((reference) => !available.has(reference));
  if (missingReferences.length === 0) return;
  throw new AgentToolError("MISSING_FORMULA_REFERENCES", `Formula for "${nodeId}" references missing node ids: ${missingReferences.join(", ")}.`, {
    missingReferences,
    availableNodeIds,
    similarNodeIds: Object.fromEntries(
      missingReferences.map((reference) => [reference, similarNodeIds(reference, availableNodeIds)])
    )
  });
}

function similarNodeIds(reference: string, availableNodeIds: string[]): string[] {
  return availableNodeIds
    .map((nodeId) => ({ nodeId, score: similarity(reference, nodeId) }))
    .filter((entry) => entry.score > 0.35)
    .sort((a, b) => b.score - a.score || a.nodeId.localeCompare(b.nodeId))
    .slice(0, 5)
    .map((entry) => entry.nodeId);
}

function similarity(left: string, right: string): number {
  if (left === right) return 1;
  const leftParts = new Set(left.toLowerCase().split(/[_\W]+/).filter(Boolean));
  const rightParts = new Set(right.toLowerCase().split(/[_\W]+/).filter(Boolean));
  const intersection = [...leftParts].filter((part) => rightParts.has(part)).length;
  const union = new Set([...leftParts, ...rightParts]).size || 1;
  const tokenScore = intersection / union;
  const prefixScore = right.startsWith(left) || left.startsWith(right) ? 0.5 : 0;
  return Math.max(tokenScore, prefixScore);
}
