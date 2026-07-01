import { z } from "zod";
import {
  extractFormulaReferences,
  type VdtBuilderSession,
  type VdtChangeSet,
  type VdtEdgeRelation,
  type VdtNodePatch
} from "@vdt-studio/vdt-core";
import { defaultProgressiveBuildPolicy, proposeAndMaybeApplyMutation } from "../mutation-pipeline";
import { AgentToolError, type AgentTool, type AgentToolContext } from "../tool-registry";
import { summarizeCalculation, summarizeValidation } from "../summaries";
import { cloneBuilder, combineChangeSets, requireBuilder, requireChangeSet } from "./builder-mutation-utils";

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

function normalizeEnumText(value: unknown): string | undefined {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/[\s-]+/g, "_")
    : undefined;
}

function normalizeNodeType(value: unknown): unknown {
  const normalized = normalizeEnumText(value);
  if (!normalized) return value;
  if (nodeTypeSchema.options.includes(normalized as never)) return normalized;
  if (["driver", "factor", "lever", "input_driver", "variable"].includes(normalized)) return "input";
  if (["calculation", "computed", "derived", "formula", "formula_node"].includes(normalized)) return "calculated";
  if (["root", "kpi", "root_metric", "root_driver"].includes(normalized)) return "root_kpi";
  if (["external", "context", "external_driver"].includes(normalized)) return "external_factor";
  if (["data", "mapped", "data_source", "data_mapped_node"].includes(normalized)) return "data_mapped";
  return value;
}

function normalizeEdgeRelation(value: unknown): unknown {
  const normalized = normalizeEnumText(value);
  if (!normalized) return value;
  if (edgeRelationSchema.options.includes(normalized as never)) return normalized;
  if (["determines", "drives", "driver", "influences", "contributes", "affects", "impacts"].includes(normalized)) {
    return "positive_driver";
  }
  if (["multiplies", "multiplier", "factor", "multiplicative"].includes(normalized)) return "multiplicative_driver";
  if (["divides", "denominator", "inverse", "divisive"].includes(normalized)) return "divisive_driver";
  if (["adds", "addition", "component", "part", "additive"].includes(normalized)) return "additive_component";
  if (["subtracts", "reduction", "reduces", "negative", "decreases"].includes(normalized)) return "negative_driver";
  if (["dependency", "formula", "formula_reference", "depends_on"].includes(normalized)) return "formula_dependency";
  return value;
}

const nodeTypeInputSchema = z.preprocess(normalizeNodeType, nodeTypeSchema);
const edgeRelationInputSchema = z.preprocess(normalizeEdgeRelation, edgeRelationSchema);
const nullToUndefined = (value: unknown): unknown => value === null ? undefined : value;
const optionalInput = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(nullToUndefined, schema.optional());
const valueStatusSchema = z.enum([
  "unknown",
  "user_provided_value",
  "default_assumption",
  "calculated",
  "partially_calculable"
]);
const valueSourceSchema = z.object({
  sourceTier: optionalInput(z.string().max(120)),
  confidence: optionalInput(z.string().max(80)),
  catalogRef: optionalInput(z.string().max(240)),
  acceptedByUserInDialog: optionalInput(z.boolean()),
  editableInDialog: optionalInput(z.boolean()),
  note: optionalInput(z.string().max(500)),
  range: optionalInput(z.tuple([z.number().finite(), z.number().finite()]))
}).strict();

const nodePatchSchema = z.object({
  name: optionalInput(z.string().min(1).max(200)),
  description: optionalInput(z.string().max(1_000)),
  type: optionalInput(nodeTypeInputSchema),
  unit: optionalInput(z.string().max(80)),
  formula: optionalInput(z.string().max(500)),
  baselineValue: optionalInput(z.number().finite()),
  value: optionalInput(z.number().finite()),
  valueStatus: optionalInput(valueStatusSchema),
  valueSource: optionalInput(valueSourceSchema),
  status: optionalInput(nodeStatusSchema),
  assumptions: optionalInput(z.array(z.string().max(300)).max(20)),
  tags: optionalInput(z.array(z.string().max(80)).max(20)),
  controllability: optionalInput(z.enum(["high", "medium", "low", "none"])),
  materiality: optionalInput(z.enum(["high", "medium", "low", "unknown"]))
}).strict();

export function createVdtBuilderTools(): AgentTool[] {
  return [
    createDraftTool,
    addDriverTool,
    addDriversBatchTool,
    addEdgeTool,
    updateNodeTool,
    deleteNodeTool,
    setFormulaTool,
    validateTool,
    layoutTool,
    calculateTool
  ];
}

const addDriverInputSchema = z.object({
  parentNodeId: z.string().min(1).max(160),
  nodeId: optionalInput(z.string().max(160)),
  name: z.string().min(1).max(200),
  type: optionalInput(nodeTypeInputSchema),
  unit: optionalInput(z.string().max(80)),
  relation: optionalInput(edgeRelationInputSchema),
  formula: optionalInput(z.string().max(500)),
  baselineValue: optionalInput(z.number().finite()),
  description: optionalInput(z.string().max(1_000)),
  aiRationale: optionalInput(z.string().max(800)),
  assumptions: optionalInput(z.array(z.string().max(300)).max(20))
});

type AddDriverToolInput = z.infer<typeof addDriverInputSchema>;

const createDraftTool: AgentTool = {
  name: "vdt.create_draft",
  description: "Create a draft VDT project and root KPI node.",
  inputSchema: z.object({
    projectTitle: z.string().min(1).max(240),
    rootKpi: z.string().min(1).max(200),
    unit: optionalInput(z.string().max(80)),
    timePeriod: optionalInput(z.string().max(80)),
    industry: optionalInput(z.string().max(160)),
    businessContext: optionalInput(z.string().max(2_000)),
    goal: optionalInput(z.string().max(1_000)),
    replaceExisting: optionalInput(z.boolean())
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
    const protectedBrief = protectedBriefFromRun(context);
    if (protectedBrief.rootKpi && !sameVisibleValue(input.rootKpi, protectedBrief.rootKpi)) {
      throw new AgentToolError(
        "VISIBLE_BRIEF_CONFLICT",
        `Draft root KPI "${input.rootKpi}" conflicts with the visible brief root KPI "${protectedBrief.rootKpi}". Ask the user before changing scope.`
      );
    }
    const result = builder.createDraft({
      ...input,
      ...(protectedBrief.rootKpi ? { rootKpi: protectedBrief.rootKpi, projectTitle: `${protectedBrief.rootKpi} Driver Model` } : {}),
      ...(protectedBrief.unit ? { unit: protectedBrief.unit } : {}),
      ...(protectedBrief.timePeriod ? { timePeriod: protectedBrief.timePeriod } : {})
    });
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
  inputSchema: addDriverInputSchema,
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
    const previewBuilder = cloneBuilder(context);
    const result = previewBuilder.addDriver(input);
    const changeSet = requireChangeSet(result.changeSet);
    const nodeId = result.changeSet?.additions[0]?.nodeId ?? input.nodeId ?? input.name;
    const edgeId = result.changeSet?.edgeChanges[0]?.action === "add"
      ? result.changeSet.edgeChanges[0].edge.id
      : "";
    const mutation = proposeAndMaybeApplyMutation(context, {
      title: "Driver added",
      summary: result.event.message,
      changeSet,
      targetNodeId: input.parentNodeId
    });
    return {
      nodeId,
      edgeId,
      revision: mutation.revision,
      validation: mutation.validation,
      mutationProposal: { id: mutation.proposal.id, status: mutation.proposal.status }
    };
  }
};

const addDriversBatchTool: AgentTool = {
  name: "vdt.add_drivers_batch",
  description: `Add 2 to ${defaultProgressiveBuildPolicy.maxNodesPerLayer} sibling driver nodes under one parent in one visible layer.`,
  inputSchema: z.object({
    drivers: z.array(addDriverInputSchema).min(2).max(defaultProgressiveBuildPolicy.maxNodesPerLayer)
  }),
  outputSchema: z.record(z.unknown()),
  mutatesProject: true,
  requiresDraftProject: true,
  phase: "building_graph",
  run(context, input) {
    const builder = requireBuilder(context.builder);
    const drivers = input.drivers as AddDriverToolInput[];
    const parentNodeIds = new Set(drivers.map((driver) => driver.parentNodeId));
    if (parentNodeIds.size > 1) {
      throw new AgentToolError("MUTATION_SCOPE_VIOLATION", "Batch driver mutations must add one visible layer under a single parent node.");
    }
    const targetNodeId = drivers[0]?.parentNodeId;
    if (!targetNodeId) throw new AgentToolError("INVALID_TOOL_ARGS", "At least one driver is required.");
    const previewBuilder = cloneBuilder(context);
    const added: Array<{ nodeId: string; edgeId: string; parentNodeId: string; name: string }> = [];
    const changeSets: VdtChangeSet[] = [];

    for (const driver of drivers) {
      const project = builder.getProject();
      const nodeIds = new Set(project.graph.nodes.map((node) => node.id));
      if (!nodeIds.has(driver.parentNodeId)) {
        throw new AgentToolError("PARENT_NOT_FOUND", `Parent node "${driver.parentNodeId}" was not found.`);
      }
      if (driver.nodeId && nodeIds.has(driver.nodeId)) {
        throw new AgentToolError("NODE_ID_EXISTS", `Node id "${driver.nodeId}" already exists.`);
      }
      const result = previewBuilder.addDriver(driver);
      changeSets.push(requireChangeSet(result.changeSet));
      const nodeId = result.changeSet?.additions[0]?.nodeId ?? driver.nodeId ?? driver.name;
      const edgeId = result.changeSet?.edgeChanges[0]?.action === "add"
        ? result.changeSet.edgeChanges[0].edge.id
        : "";
      added.push({ nodeId, edgeId, parentNodeId: driver.parentNodeId, name: driver.name });
    }

    const summary = `Added ${added.length} drivers: ${added.map((driver) => `"${driver.name}"`).join(", ")}.`;
    const mutation = proposeAndMaybeApplyMutation(context, {
      title: "Drivers added",
      summary,
      changeSet: combineChangeSets(changeSets, context),
      targetNodeId
    });
    return {
      nodeIds: added.map((driver) => driver.nodeId),
      edgeIds: added.map((driver) => driver.edgeId),
      revision: mutation.revision,
      validation: mutation.validation,
      mutationProposal: { id: mutation.proposal.id, status: mutation.proposal.status }
    };
  }
};

const addEdgeTool: AgentTool = {
  name: "vdt.add_edge",
  description: "Add one visual or formula-dependency edge between existing nodes.",
  inputSchema: z.object({
    sourceNodeId: z.string().min(1).max(160),
    targetNodeId: z.string().min(1).max(160),
    relation: edgeRelationInputSchema,
    label: optionalInput(z.string().max(120))
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
    const previewBuilder = cloneBuilder(context);
    const result = previewBuilder.addEdge(input);
    const changeSet = requireChangeSet(result.changeSet);
    const edgeId = result.changeSet?.edgeChanges[0]?.action === "add"
      ? result.changeSet.edgeChanges[0].edge.id
      : "";
    const mutation = proposeAndMaybeApplyMutation(context, {
      title: "Edge added",
      summary: result.event.message,
      changeSet,
      targetNodeId: input.sourceNodeId
    });
    return {
      edgeId,
      revision: mutation.revision,
      validation: mutation.validation,
      mutationProposal: { id: mutation.proposal.id, status: mutation.proposal.status }
    };
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
    if (input.nodeId === project.rootNodeId) {
      const protectedBrief = protectedBriefFromRun(context);
      if (input.patch.type && input.patch.type !== "root_kpi") {
        throw new AgentToolError("ROOT_TYPE_PROTECTED", "The root node type is protected by the visible brief.");
      }
      if (protectedBrief.rootKpi && input.patch.name && !sameVisibleValue(input.patch.name, protectedBrief.rootKpi)) {
        throw new AgentToolError(
          "VISIBLE_BRIEF_CONFLICT",
          `Root node rename "${input.patch.name}" conflicts with the visible brief root KPI "${protectedBrief.rootKpi}". Ask the user before changing scope.`
        );
      }
    }
    assertFormulaReferencesIfPresent(project, input.patch.formula, input.nodeId);
    const previewBuilder = cloneBuilder(context);
    const result = previewBuilder.updateNode({ nodeId: input.nodeId, patch: input.patch as VdtNodePatch });
    const mutation = proposeAndMaybeApplyMutation(context, {
      title: "Node updated",
      summary: result.event.message,
      changeSet: requireChangeSet(result.changeSet),
      targetNodeId: input.nodeId
    });
    return {
      nodeId: input.nodeId,
      revision: mutation.revision,
      validation: mutation.validation,
      mutationProposal: { id: mutation.proposal.id, status: mutation.proposal.status }
    };
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
    const previewBuilder = cloneBuilder(context);
    const result = previewBuilder.deleteNode(input);
    const mutation = proposeAndMaybeApplyMutation(context, {
      title: "Node deleted",
      summary: result.event.message,
      changeSet: requireChangeSet(result.changeSet),
      targetNodeId: input.nodeId
    });
    return {
      deletedNodeId: input.nodeId,
      removedEdgeIds,
      revision: mutation.revision,
      validation: mutation.validation,
      mutationProposal: { id: mutation.proposal.id, status: mutation.proposal.status }
    };
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
    const previewBuilder = cloneBuilder(context);
    const result = previewBuilder.setFormula(input);
    const mutation = proposeAndMaybeApplyMutation(context, {
      title: "Formula set",
      summary: result.event.message,
      changeSet: requireChangeSet(result.changeSet),
      targetNodeId: input.nodeId
    });
    return {
      nodeId: input.nodeId,
      revision: mutation.revision,
      validation: mutation.validation,
      mutationProposal: { id: mutation.proposal.id, status: mutation.proposal.status }
    };
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

function protectedBriefFromRun(context: AgentToolContext): {
  rootKpi?: string | undefined;
  unit?: string | undefined;
  timePeriod?: string | undefined;
} {
  const input = context.getRun().request.input;
  const rootKpi = input.rootKpi?.trim();
  return {
    rootKpi: rootKpi && !isPlaceholderRootKpi(rootKpi) ? rootKpi : undefined,
    unit: input.unit?.trim() || undefined,
    timePeriod: input.timePeriod?.trim() || undefined
  };
}

function isPlaceholderRootKpi(value: string): boolean {
  return /^(new vdt|untitled vdt|value driver tree)$/i.test(value.trim());
}

function sameVisibleValue(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
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
