import { z } from "zod";
import {
  extractFormulaReferences,
  inspectDecompositionHierarchy,
  serializeFormulaTokens,
  stableSnakeId,
  tokenizeFormula,
  uniqueId,
  type VdtBuilderSession,
  type VdtChangeSet,
  type VdtEdge,
  type VdtEdgeRelation,
  type VdtNode,
  type VdtNodeAddition,
  type VdtNodePatch,
  type VdtProject
} from "@vdt-studio/vdt-core";
import { defaultProgressiveBuildPolicy, proposeAndMaybeApplyMutation } from "../mutation-pipeline";
import { AgentToolError, type AgentTool, type AgentToolContext } from "../tool-registry";
import { summarizeCalculation, summarizeValidation } from "../summaries";
import { cloneBuilder, combineChangeSets, requireBuilder, requireChangeSet, wrapBuilderError } from "./builder-mutation-utils";
import { assertUserProvidedValueGrounded, runHasUserAnswerForNode } from "./value-provenance";
import { requirePlannedAdditions } from "./hierarchy-tools";

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
  if (edgeRelationSchema.options.includes(normalized as never)) {
    throw new AgentToolError(
      "ENUM_FIELD_MISMATCH",
      `Node field "type" received edge relation "${normalized}". Use a node type such as "input" and pass "${normalized}" in the "relation" field.`,
      {
        field: "type",
        received: normalized,
        expected: nodeTypeSchema.options,
        relationField: "relation"
      }
    );
  }
  if (["driver", "factor", "lever", "input_driver", "input_kpi", "variable"].includes(normalized)) return "input";
  if (["calculation", "calculated_kpi", "computed", "derived", "formula", "formula_node"].includes(normalized)) return "calculated";
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
  if (["multiply", "multiplies", "multiplier", "factor", "multiplicative"].includes(normalized)) return "multiplicative_driver";
  if (["divides", "denominator", "inverse", "divisive"].includes(normalized)) return "divisive_driver";
  if (["adds", "addition", "component", "part", "additive", "additive_driver"].includes(normalized)) return "additive_component";
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

const vdtNodeIdSchema = z.string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Node ids must be valid formula identifiers.");

const instantiateNodeOverrideSchema = nodePatchSchema.extend({
  nodeId: optionalInput(vdtNodeIdSchema),
  relation: optionalInput(edgeRelationInputSchema),
  aiRationale: optionalInput(z.string().max(800))
}).strict();

const instantiateSubtreeInputSchema = z.object({
  sourceRootNodeId: z.string().min(1).max(160),
  targetParentNodeId: z.string().min(1).max(160),
  overrides: optionalInput(
    z.record(z.string().min(1).max(160), instantiateNodeOverrideSchema)
      .refine((value) => Object.keys(value).length <= 200, "At most 200 node overrides are allowed.")
  )
}).strict();

type InstantiateNodeOverride = z.infer<typeof instantiateNodeOverrideSchema>;

export function createVdtBuilderTools(): AgentTool[] {
  return [
    createDraftTool,
    addDriverTool,
    addDriversBatchTool,
    instantiateSubtreeTool,
    addEdgeTool,
    updateNodeTool,
    setInputValuesBatchTool,
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

function assertNewDriverId(input: AddDriverToolInput, nodeIds: ReadonlySet<string>): void {
  // Non-Latin names share the builder's fallback base ("driver"). They are
  // distinct names, not attempts to write an existing ID; retain automatic
  // unique IDs for callers that did not supply an identifier.
  if (input.nodeId === undefined && !/[a-z0-9]/i.test(input.name)) return;
  const candidate = stableSnakeId(input.nodeId ?? input.name, "driver");
  if (!nodeIds.has(candidate)) return;
  throw new AgentToolError(
    "NODE_ID_EXISTS",
    `Node id "${candidate}" already exists. To fill its value or formula, use vdt.update_node or vdt.set_formula on that exact nodeId; adding another driver does not update it. Use a distinct explicit nodeId only for a genuinely separate quantity.`,
    { nodeId: candidate }
  );
}

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
    requirePlannedAdditions(context, [input]);
    const builder = requireBuilder(context.builder);
    const project = builder.getProject();
    const nodeIds = new Set(project.graph.nodes.map((node) => node.id));
    if (!nodeIds.has(input.parentNodeId)) {
      throw new AgentToolError("PARENT_NOT_FOUND", `Parent node "${input.parentNodeId}" was not found.`);
    }
    assertNewDriverId(input, nodeIds);
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
  description: `Add 2 to ${defaultProgressiveBuildPolicy.maxNodesPerLayer} sibling driver nodes under one parent in one visible layer, optionally setting that parent's explicit formula atomically. For exactly one driver, use vdt.add_driver with the driver's fields directly; do not wrap one driver in a batch.`,
  inputSchema: z.object({
    drivers: z.array(addDriverInputSchema).min(2).max(defaultProgressiveBuildPolicy.maxNodesPerLayer),
    parentFormula: optionalInput(z.string().min(1).max(500))
  }),
  outputSchema: z.record(z.unknown()),
  mutatesProject: true,
  requiresDraftProject: true,
  phase: "building_graph",
  run(context, input) {
    requirePlannedAdditions(context, input.drivers);
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
      const project = previewBuilder.getProject();
      const nodeIds = new Set(project.graph.nodes.map((node) => node.id));
      if (!nodeIds.has(driver.parentNodeId)) {
        throw new AgentToolError("PARENT_NOT_FOUND", `Parent node "${driver.parentNodeId}" was not found.`);
      }
      assertNewDriverId(driver, nodeIds);
      const result = previewBuilder.addDriver(driver);
      changeSets.push(requireChangeSet(result.changeSet));
      const nodeId = result.changeSet?.additions[0]?.nodeId ?? driver.nodeId ?? driver.name;
      const edgeId = result.changeSet?.edgeChanges[0]?.action === "add"
        ? result.changeSet.edgeChanges[0].edge.id
        : "";
      added.push({ nodeId, edgeId, parentNodeId: driver.parentNodeId, name: driver.name });
    }

    if (input.parentFormula) {
      const previewProject = previewBuilder.getProject();
      assertFormulaReferencesIfPresent(previewProject, input.parentFormula, targetNodeId);
      const formulaResult = previewBuilder.setFormula({
        nodeId: targetNodeId,
        formula: input.parentFormula
      });
      changeSets.push(requireChangeSet(formulaResult.changeSet));
    }

    const summary = [
      `Added ${added.length} drivers: ${added.map((driver) => `"${driver.name}"`).join(", ")}.`,
      input.parentFormula ? `Set the explicit formula for "${targetNodeId}" in the same atomic change.` : undefined
    ].filter(Boolean).join(" ");
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

const instantiateSubtreeTool: AgentTool = {
  name: "vdt.instantiate_subtree",
  description: "Clone one deterministic non-root subtree under an existing parent, with new node ids, source-id-keyed overrides, and internal formula-reference remapping.",
  inputSchema: instantiateSubtreeInputSchema,
  outputSchema: z.record(z.unknown()),
  mutatesProject: true,
  requiresDraftProject: true,
  phase: "building_graph",
  run(context, input) {
    const builder = requireBuilder(context.builder);
    const project = builder.getProject();
    const nodesById = new Map(project.graph.nodes.map((node) => [node.id, node]));
    const sourceRoot = nodesById.get(input.sourceRootNodeId);
    if (!sourceRoot) {
      throw new AgentToolError("SOURCE_NOT_FOUND", `Source subtree root "${input.sourceRootNodeId}" was not found.`);
    }
    if (!nodesById.has(input.targetParentNodeId)) {
      throw new AgentToolError("PARENT_NOT_FOUND", `Target parent node "${input.targetParentNodeId}" was not found.`);
    }
    if (sourceRoot.id === project.rootNodeId || sourceRoot.type === "root_kpi") {
      throw new AgentToolError("SOURCE_ROOT_NOT_CLONEABLE", "The project root cannot be instantiated as a child subtree.");
    }

    const discovered = discoverDeterministicSubtree(project, sourceRoot.id);
    const sourceNodeIds = new Set(discovered.orderedNodeIds);
    if (sourceNodeIds.has(input.targetParentNodeId)) {
      throw new AgentToolError(
        "TARGET_INSIDE_SOURCE_SUBTREE",
        `Target parent "${input.targetParentNodeId}" is inside source subtree "${sourceRoot.id}".`
      );
    }

    const overrides = input.overrides ?? {};
    const unknownOverrideIds = Object.keys(overrides).filter((sourceNodeId) => !sourceNodeIds.has(sourceNodeId));
    if (unknownOverrideIds.length > 0) {
      throw new AgentToolError(
        "UNKNOWN_SUBTREE_OVERRIDE",
        `Overrides reference nodes outside the source subtree: ${unknownOverrideIds.join(", ")}.`,
        { sourceRootNodeId: sourceRoot.id, unknownSourceNodeIds: unknownOverrideIds }
      );
    }

    const sourceToTargetNodeIds = allocateSubtreeNodeIds(
      discovered.orderedNodeIds,
      nodesById,
      overrides,
      new Set(nodesById.keys()),
      sourceRoot.id
    );
    const additions = discovered.orderedNodeIds.map((sourceNodeId, index) => {
      const sourceNode = nodesById.get(sourceNodeId)!;
      const override = overrides[sourceNodeId];
      const incomingEdge = discovered.incomingEdgeByNodeId.get(sourceNodeId)!;
      const targetNodeId = sourceToTargetNodeIds[sourceNodeId]!;
      const parentNodeId = sourceNodeId === sourceRoot.id
        ? input.targetParentNodeId
        : sourceToTargetNodeIds[incomingEdge.sourceNodeId]!;
      const formula = remapSubtreeFormula(
        override?.formula ?? sourceNode.formula,
        sourceNodeId,
        sourceNodeIds,
        sourceToTargetNodeIds
      );
      const type = override?.type ?? sourceNode.type;
      if (type === "root_kpi") {
        throw new AgentToolError(
          "CLONED_NODE_TYPE_INVALID",
          `Cloned node "${sourceNodeId}" cannot have type "root_kpi".`
        );
      }
      return subtreeAddition({
        id: `instantiate_${index + 1}_${targetNodeId}`,
        context,
        sourceNode,
        override,
        nodeId: targetNodeId,
        parentNodeId,
        relation: override?.relation ?? incomingEdge.relation,
        formula
      });
    });
    const statusUpdates = discovered.orderedNodeIds.flatMap((sourceNodeId, index) => {
      const status = overrides[sourceNodeId]?.status;
      if (!status) return [];
      return [{
        id: `instantiate_status_${index + 1}_${sourceToTargetNodeIds[sourceNodeId]}`,
        nodeId: sourceToTargetNodeIds[sourceNodeId]!,
        patch: { status }
      }];
    });
    const changeSet: VdtChangeSet = {
      id: `changeset_${context.runId}_instantiate_${builder.getRevision() + 1}`,
      taskType: "generate_tree",
      backendId: context.getRun().request.providerId,
      createdAt: new Date().toISOString(),
      additions,
      updates: statusUpdates,
      deletions: [],
      edgeChanges: [],
      assumptions: [],
      questions: [],
      warnings: []
    };
    const targetRootNodeId = sourceToTargetNodeIds[sourceRoot.id]!;
    const mutation = proposeAndMaybeApplyMutation(context, {
      title: "Subtree instantiated",
      summary: `Instantiated ${additions.length} nodes from "${sourceRoot.name}" under "${input.targetParentNodeId}".`,
      changeSet,
      targetNodeId: input.targetParentNodeId,
      allowSkillDefinedDepth: true
    });
    return {
      sourceRootNodeId: sourceRoot.id,
      targetRootNodeId,
      sourceToTargetNodeIds,
      nodeIds: additions.map((addition) => addition.nodeId),
      edgeIds: additions.map((addition) => `edge_${addition.parentNodeId}_${addition.nodeId}`),
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
    if (input.patch.valueStatus === "user_provided_value") {
      assertUserProvidedValueGrounded(context, input.nodeId, {
        value: input.patch.value ?? input.patch.baselineValue,
        quote: input.patch.valueSource?.note
      });
    }
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

interface InputValueWrite {
  nodeId: string;
  value: number;
  provenance: "user_provided_value" | "default_assumption";
  note: string;
}

const setInputValuesBatchTool: AgentTool = {
  name: "vdt.fill_input_values_batch",
  description: "Fill 1-8 UNPOPULATED existing numeric input leaves atomically. Never creates nodes, changes formulas or overwrites known inputs (use vdt.update_node for edits). Copy nodeId from unresolvedInputs. A user-provided note must quote that quantity verbatim; otherwise label a draft assumption.",
  inputSchema: z.object({ values: z.array(z.object({
    nodeId: vdtNodeIdSchema,
    value: z.number().finite(),
    provenance: z.enum(["user_provided_value", "default_assumption"]),
    note: z.string().trim().min(4).max(160)
  }).strict()).min(1).max(8) }).strict(),
  outputSchema: z.record(z.unknown()),
  mutatesProject: true,
  requiresDraftProject: true,
  phase: "building_graph",
  run(context, input) {
    const builder = requireBuilder(context.builder);
    const project = builder.getProject();
    const nodes = new Map(project.graph.nodes.map((node) => [node.id, node]));
    const seen = new Set<string>();
    const groundingErrors: Array<{ nodeId: string; error: AgentToolError }> = [];
    // Validate the entire batch before previewing or committing any write.
    for (const item of input.values) {
      const node = nodes.get(item.nodeId);
      if (!node) throw new AgentToolError("NODE_NOT_FOUND", `Node "${item.nodeId}" was not found. Use an existing input ID from the working graph.`);
      if (seen.has(item.nodeId)) throw new AgentToolError("DUPLICATE_INPUT_WRITE", `Input "${item.nodeId}" occurs more than once in the batch.`);
      seen.add(item.nodeId);
      if (node.id === project.rootNodeId || ["root_kpi", "calculated"].includes(node.type) || node.formula?.trim()) {
        throw new AgentToolError("INPUT_LEAF_REQUIRED", `Node "${item.nodeId}" is calculated or is the root. This tool only fills numeric input leaves; use vdt.set_formula for calculations.`);
      }
      if (project.graph.edges.some((edge) => edge.sourceNodeId === item.nodeId)) {
        throw new AgentToolError("INPUT_LEAF_REQUIRED", `Node "${item.nodeId}" has children and is not an input leaf.`);
      }
      if (Number.isFinite(node.baselineValue ?? node.value)) {
        throw new AgentToolError("INPUT_ALREADY_POPULATED", `Input "${item.nodeId}" already has a value. Fill remaining unresolved inputs; use vdt.update_node for an intentional edit.`);
      }
      if (item.provenance === "user_provided_value") {
        try { assertUserProvidedValueGrounded(context, item.nodeId, { value: item.value, quote: item.note }); }
        catch (error) {
          if (!(error instanceof AgentToolError)) throw error;
          groundingErrors.push({ nodeId: item.nodeId, error });
        }
      }
    }
    if (groundingErrors.length === 1) throw groundingErrors[0]!.error;
    if (groundingErrors.length > 1) throw new AgentToolError("USER_PROVIDED_VALUE_UNGROUNDED",
      `No values were applied. Correct all ${groundingErrors.length} ungrounded entries: ${groundingErrors.map(({ nodeId, error }) => `${nodeId}: ${error.message}`).join("\n")}`,
      { issues: groundingErrors.map(({ nodeId, error }) => ({ nodeId, code: error.code, message: error.message })) });
    const preview = cloneBuilder(context);
    const changes = input.values.map((item: InputValueWrite) => requireChangeSet(preview.updateNode({
      nodeId: item.nodeId,
      patch: {
        value: item.value, baselineValue: item.value, valueStatus: item.provenance,
        status: item.provenance === "default_assumption" ? "assumption" : "accepted",
        valueSource: {
          sourceTier: item.provenance === "default_assumption" ? "default_assumption" : "user_input",
          note: item.provenance === "default_assumption" ? `Editable draft assumption: ${item.note}` : item.note,
          editableInDialog: true,
          acceptedByUserInDialog: item.provenance === "user_provided_value"
        },
        ...(item.provenance === "default_assumption" ? {
          assumptions: [...new Set([...(nodes.get(item.nodeId)?.assumptions ?? []), item.note])].slice(-20)
        } : {})
      }
    }).changeSet));
    const mutation = proposeAndMaybeApplyMutation(context, {
      title: "Input values captured", summary: `Filled ${input.values.length} existing numeric inputs with explicit provenance.`,
      changeSet: combineChangeSets(changes, context), targetNodeId: context.store.getState(context.runId).request.mode === "deepen_node"
        ? context.store.getState(context.runId).request.input.selectedNodeId ?? project.rootNodeId : project.rootNodeId
    });
    return {
      nodeIds: input.values.map((item: InputValueWrite) => item.nodeId), revision: mutation.revision,
      validation: mutation.validation, mutationProposal: { id: mutation.proposal.id, status: mutation.proposal.status }
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
    if (!project.graph.nodes.some((node) => node.id === input.nodeId)) {
      throw new AgentToolError("NODE_NOT_FOUND", `Node "${input.nodeId}" was not found.`);
    }
    if (input.nodeId === project.rootNodeId) {
      throw new AgentToolError("ROOT_NODE_PROTECTED", "Root node cannot be deleted.");
    }
    const removedEdgeIds = project.graph.edges
      .filter((edge) => edge.sourceNodeId === input.nodeId || edge.targetNodeId === input.nodeId)
      .map((edge) => edge.id);
    const previewBuilder = cloneBuilder(context);
    let result;
    try {
      result = previewBuilder.deleteNode(input);
    } catch (error) {
      wrapBuilderError(error);
    }
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
    const builder=requireBuilder(context.builder);
    const graphValidation=summarizeValidation(builder.validate().validation);
    const hierarchy=inspectDecompositionHierarchy(builder.getProject());
    const validation=context.requireDecompositionPlan?{...graphValidation,valid:graphValidation.valid&&hierarchy.valid,errors:[...graphValidation.errors,...hierarchy.errors.slice(0,20).map(message=>({type:"invalid_graph" as const,severity:"error" as const,message}))]}:graphValidation;
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
    return {...validation,...(context.requireDecompositionPlan?{hierarchy:{...hierarchy,errors:hierarchy.errors.slice(0,20),errorCount:hierarchy.errors.length}}:{})};
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

function discoverDeterministicSubtree(
  project: VdtProject,
  sourceRootNodeId: string
): {
  orderedNodeIds: string[];
  incomingEdgeByNodeId: Map<string, VdtEdge>;
} {
  const nodesById = new Map(project.graph.nodes.map((node) => [node.id, node]));
  const outgoingBySource = new Map<string, VdtEdge[]>();
  const incomingByTarget = new Map<string, VdtEdge[]>();
  for (const edge of project.graph.edges) {
    if (!nodesById.has(edge.sourceNodeId) || !nodesById.has(edge.targetNodeId)) {
      throw new AgentToolError(
        "INVALID_SOURCE_GRAPH",
        `Edge "${edge.id}" references a missing node; the source subtree cannot be instantiated.`
      );
    }
    outgoingBySource.set(edge.sourceNodeId, [...(outgoingBySource.get(edge.sourceNodeId) ?? []), edge]);
    incomingByTarget.set(edge.targetNodeId, [...(incomingByTarget.get(edge.targetNodeId) ?? []), edge]);
  }
  for (const edges of outgoingBySource.values()) edges.sort(compareEdgesDeterministically);
  for (const edges of incomingByTarget.values()) edges.sort(compareEdgesDeterministically);

  const orderedNodeIds: string[] = [];
  const discovered = new Set<string>();
  const queue = [sourceRootNodeId];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (discovered.has(nodeId)) continue;
    discovered.add(nodeId);
    orderedNodeIds.push(nodeId);
    if (orderedNodeIds.length > 200) {
      throw new AgentToolError("SUBTREE_TOO_LARGE", "A subtree instantiation is limited to 200 nodes.");
    }
    for (const edge of outgoingBySource.get(nodeId) ?? []) queue.push(edge.targetNodeId);
  }

  const incomingEdgeByNodeId = new Map<string, VdtEdge>();
  for (const nodeId of orderedNodeIds) {
    const incoming = incomingByTarget.get(nodeId) ?? [];
    const internal = incoming.filter((edge) => discovered.has(edge.sourceNodeId));
    const external = incoming.filter((edge) => !discovered.has(edge.sourceNodeId));
    if (nodeId === sourceRootNodeId) {
      if (internal.length > 0 || external.length !== 1) {
        throw ambiguousSubtreeError(sourceRootNodeId, nodeId, incoming);
      }
      incomingEdgeByNodeId.set(nodeId, external[0]!);
      continue;
    }
    if (internal.length !== 1 || external.length > 0) {
      throw ambiguousSubtreeError(sourceRootNodeId, nodeId, incoming);
    }
    incomingEdgeByNodeId.set(nodeId, internal[0]!);
  }

  return { orderedNodeIds, incomingEdgeByNodeId };
}

function compareEdgesDeterministically(left: VdtEdge, right: VdtEdge): number {
  if (left.targetNodeId !== right.targetNodeId) return left.targetNodeId < right.targetNodeId ? -1 : 1;
  if (left.sourceNodeId !== right.sourceNodeId) return left.sourceNodeId < right.sourceNodeId ? -1 : 1;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

function ambiguousSubtreeError(sourceRootNodeId: string, nodeId: string, incoming: VdtEdge[]): AgentToolError {
  return new AgentToolError(
    "AMBIGUOUS_SUBTREE",
    `Source subtree "${sourceRootNodeId}" is not a strict tree at node "${nodeId}".`,
    {
      sourceRootNodeId,
      nodeId,
      incomingEdges: incoming.map((edge) => ({
        edgeId: edge.id,
        sourceNodeId: edge.sourceNodeId,
        relation: edge.relation
      }))
    }
  );
}

function allocateSubtreeNodeIds(
  orderedSourceNodeIds: string[],
  sourceNodesById: ReadonlyMap<string, VdtNode>,
  overrides: Record<string, InstantiateNodeOverride>,
  existingNodeIds: Set<string>,
  sourceRootNodeId: string
): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const sourceNodeId of orderedSourceNodeIds) {
    const sourceNode = sourceNodesById.get(sourceNodeId)!;
    const override = overrides[sourceNodeId];
    const explicitNodeId = override?.nodeId;
    let baseNodeId: string;
    if (explicitNodeId) {
      baseNodeId = explicitNodeId;
      if (existingNodeIds.has(baseNodeId)) {
        throw new AgentToolError("NODE_ID_EXISTS", `Cloned node id "${baseNodeId}" already exists.`);
      }
    } else if (override?.name) {
      baseNodeId = stableSnakeId(override.name, "driver");
    } else if (sourceNodeId === sourceRootNodeId) {
      baseNodeId = stableSnakeId(`${sourceNodeId}_copy`, "driver_copy");
    } else {
      const targetRootNodeId = mapping[sourceRootNodeId]!;
      const sourcePrefix = `${sourceRootNodeId}_`;
      const suffix = sourceNodeId.startsWith(sourcePrefix)
        ? sourceNodeId.slice(sourceRootNodeId.length)
        : `_${sourceNodeId}`;
      baseNodeId = stableSnakeId(`${targetRootNodeId}${suffix}`, "driver_copy");
    }
    const targetNodeId = explicitNodeId ? baseNodeId : uniqueId(baseNodeId, existingNodeIds);
    existingNodeIds.add(targetNodeId);
    mapping[sourceNode.id] = targetNodeId;
  }
  return mapping;
}

function remapSubtreeFormula(
  formula: string | undefined,
  sourceNodeId: string,
  sourceNodeIds: ReadonlySet<string>,
  sourceToTargetNodeIds: Readonly<Record<string, string>>
): string | undefined {
  if (!formula?.trim()) return undefined;
  let references: string[];
  try {
    references = extractFormulaReferences(formula);
  } catch (error) {
    throw new AgentToolError(
      "FORMULA_PARSE_ERROR",
      `Formula for source node "${sourceNodeId}" could not be parsed: ${error instanceof Error ? error.message : "invalid formula"}`
    );
  }
  const externalReferences = references.filter((reference) => !sourceNodeIds.has(reference));
  if (externalReferences.length > 0) {
    throw new AgentToolError(
      "EXTERNAL_SUBTREE_REFERENCE",
      `Formula for source node "${sourceNodeId}" references nodes outside the source subtree: ${externalReferences.join(", ")}.`,
      { sourceNodeId, externalReferences }
    );
  }
  const tokens = tokenizeFormula(formula);
  const remapped = tokens.map((token, index) => {
    if (token.type !== "identifier") return token;
    const next = tokens[index + 1];
    if ((token.value === "min" || token.value === "max") && next?.type === "left_paren") return token;
    const targetNodeId = sourceToTargetNodeIds[token.value];
    return targetNodeId ? { ...token, value: targetNodeId } : token;
  });
  return serializeFormulaTokens(remapped);
}

function subtreeAddition(input: {
  id: string;
  context: AgentToolContext;
  sourceNode: VdtNode;
  override: InstantiateNodeOverride | undefined;
  nodeId: string;
  parentNodeId: string;
  relation: VdtEdgeRelation;
  formula: string | undefined;
}): VdtNodeAddition {
  const { sourceNode, override } = input;
  const requestedStatus = override?.valueStatus ?? sourceNode.valueStatus;
  const requestedSource = override?.valueSource ?? sourceNode.valueSource;
  if (override?.valueStatus === "user_provided_value") {
    assertUserProvidedValueGrounded(input.context, input.nodeId);
  }
  const groundedUserValue = requestedStatus === "user_provided_value"
    && runHasUserAnswerForNode(input.context, input.nodeId);
  const valueStatus = requestedStatus === "user_provided_value" && !groundedUserValue
    ? "default_assumption"
    : requestedStatus;
  const valueSource = requestedStatus === "user_provided_value" && !groundedUserValue
    ? {
      ...requestedSource,
      acceptedByUserInDialog: false,
      note: requestedSource?.note
        ? `${requestedSource.note} Copied from source node "${sourceNode.id}"; not a user answer for this node.`
        : `Copied from source node "${sourceNode.id}"; not a user answer for this node.`
    }
    : requestedSource;
  return {
    id: input.id,
    nodeId: input.nodeId,
    parentNodeId: input.parentNodeId,
    relation: input.relation,
    name: override?.name ?? sourceNode.name,
    description: override?.description ?? sourceNode.description,
    type: override?.type ?? sourceNode.type,
    unit: override?.unit ?? sourceNode.unit,
    formula: input.formula,
    value: override?.value ?? sourceNode.value,
    baselineValue: override?.baselineValue ?? sourceNode.baselineValue,
    valueStatus,
    valueSource,
    aiConfidence: sourceNode.aiConfidence,
    aiRationale: override?.aiRationale ?? `Instantiated from source node "${sourceNode.id}".`,
    assumptions: override?.assumptions ?? sourceNode.assumptions,
    tags: override?.tags ?? sourceNode.tags,
    owner: sourceNode.owner,
    controllability: override?.controllability ?? sourceNode.controllability,
    materiality: override?.materiality ?? sourceNode.materiality,
    fixedInScenario: sourceNode.fixedInScenario,
    dataMapping: sourceNode.dataMapping
  };
}

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
