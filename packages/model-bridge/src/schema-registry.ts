import type { VdtAiTaskType } from "@vdt-studio/vdt-core";

export const VDT_OUTPUT_SCHEMA_IDS = [
  "agent-decision-v1",
  "agent-plan-v1",
  "generate-tree-v1",
  "deepen-node-v1",
  "simplify-branch-v1",
  "suggest-alternative-v1",
  "suggest-formula-v1",
  "review-model-v1",
  "check-units-v1",
  "identify-missing-drivers-v1",
  "identify-duplicate-drivers-v1",
  "explain-node-v1",
  "explain-scenario-v1",
  "generate-executive-summary-v1"
] as const;

export const VDT_SCHEMA_IDS = ["connection-test-v1", ...VDT_OUTPUT_SCHEMA_IDS] as const;

export type VdtOutputSchemaId = (typeof VDT_OUTPUT_SCHEMA_IDS)[number];
export type VdtSchemaId = (typeof VDT_SCHEMA_IDS)[number];

const schemaTask: Record<VdtOutputSchemaId, VdtAiTaskType> = {
  "agent-decision-v1": "agent_decision",
  "agent-plan-v1": "agent_plan",
  "generate-tree-v1": "generate_tree",
  "deepen-node-v1": "deepen_node",
  "simplify-branch-v1": "simplify_branch",
  "suggest-alternative-v1": "suggest_alternative",
  "suggest-formula-v1": "suggest_formula",
  "review-model-v1": "review_model",
  "check-units-v1": "check_units",
  "identify-missing-drivers-v1": "identify_missing_drivers",
  "identify-duplicate-drivers-v1": "identify_duplicate_drivers",
  "explain-node-v1": "explain_node",
  "explain-scenario-v1": "explain_scenario",
  "generate-executive-summary-v1": "generate_executive_summary"
};

const taskToSchemaId = Object.fromEntries(
  Object.entries(schemaTask).map(([schemaId, taskType]) => [taskType, schemaId])
) as Record<VdtAiTaskType, VdtOutputSchemaId>;

/** Maps each output schema ID to its canonical task type (one-to-one). */
export const schemaTasks: Record<VdtSchemaId, VdtAiTaskType> = {
  "connection-test-v1": "generate_tree",
  ...schemaTask
};

export function schemaIdForTask(taskType: VdtAiTaskType): VdtOutputSchemaId {
  return taskToSchemaId[taskType];
}

export function isVdtSchemaId(value: string): value is VdtSchemaId {
  return (VDT_SCHEMA_IDS as readonly string[]).includes(value);
}

export function schemaSupportsTask(schemaId: VdtSchemaId, taskType: VdtAiTaskType): boolean {
  return schemaTasks[schemaId] === taskType;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isStringArray(value: unknown): boolean {
  return isArray(value) && value.every((item) => typeof item === "string");
}

function isObjectArray(value: unknown): boolean {
  return isArray(value) && value.every((item) => isRecord(item));
}

function hasRequiredKeys(output: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => key in output);
}

const MAX_OUTPUT_STRING_LENGTH = 12_000;
const MAX_OUTPUT_ARRAY_ITEMS = 250;

const stringProp = { type: "string", maxLength: MAX_OUTPUT_STRING_LENGTH };
const stringArrayProp = { type: "array", maxItems: MAX_OUTPUT_ARRAY_ITEMS, items: stringProp };

function objectSchema(
  properties: Record<string, unknown>,
  required: string[],
  additionalProperties = false
): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties };
}

function arrayProp(items: Record<string, unknown>, maxItems = MAX_OUTPUT_ARRAY_ITEMS): Record<string, unknown> {
  return { type: "array", maxItems, items };
}

function enumProp(values: readonly string[]): Record<string, unknown> {
  return { type: "string", enum: [...values] };
}

const nodeIdProp = { type: "string", maxLength: 160 };
const confidenceProp = { type: "number", minimum: 0, maximum: 1 };
const nodeTypeProp = enumProp(["root_kpi", "calculated", "input", "assumption", "external_factor", "data_mapped"]);
const edgeRelationProp = enumProp([
  "positive_driver",
  "negative_driver",
  "multiplicative_driver",
  "divisive_driver",
  "additive_component",
  "subtractive_component",
  "contextual_influence",
  "formula_dependency"
]);
const severityProp = enumProp(["info", "warning", "error"]);
const controllabilityProp = enumProp(["high", "medium", "low", "none"]);
const materialityProp = enumProp(["high", "medium", "low", "unknown"]);

const aiNodeSchema = objectSchema(
  {
    id: nodeIdProp,
    name: { type: "string", maxLength: 120 },
    description: { type: "string", maxLength: 1_000 },
    type: nodeTypeProp,
    unit: { type: "string", maxLength: 80 },
    formula: { type: "string", maxLength: 500 },
    aiConfidence: confidenceProp,
    aiRationale: { type: "string", maxLength: 1_000 },
    controllability: controllabilityProp,
    materiality: materialityProp,
    fixedInScenario: { type: "boolean" }
  },
  ["id"]
);

const aiEdgeSchema = objectSchema(
  {
    id: nodeIdProp,
    sourceNodeId: nodeIdProp,
    targetNodeId: nodeIdProp,
    relation: edgeRelationProp,
    label: { type: "string", maxLength: 80 },
    aiConfidence: confidenceProp
  },
  ["id", "sourceNodeId", "targetNodeId", "relation"]
);

const warningSchema = objectSchema(
  {
    severity: severityProp,
    message: { type: "string", maxLength: 1_000 },
    nodeId: nodeIdProp,
    edgeId: nodeIdProp
  },
  ["message"]
);

const objectArrayProp = arrayProp(objectSchema({}, []));
const warningArrayProp = arrayProp(warningSchema);

const nodeRemovalSchema = objectSchema(
  {
    nodeId: nodeIdProp,
    mergeIntoNodeId: nodeIdProp,
    rationale: { type: "string", maxLength: 1_000 }
  },
  ["nodeId"]
);

const nodePatchSchema = objectSchema(
  {
    name: { type: "string", maxLength: 120 },
    description: { type: "string", maxLength: 1_000 },
    type: nodeTypeProp,
    unit: { type: "string", maxLength: 80 },
    formula: { type: "string", maxLength: 500 },
    aiConfidence: confidenceProp,
    aiRationale: { type: "string", maxLength: 1_000 },
    controllability: controllabilityProp,
    materiality: materialityProp,
    fixedInScenario: { type: "boolean" }
  },
  []
);

const stringOrNumberProp = { anyOf: [stringProp, { type: "number" }] };

const agentBuildIntentSchema = objectSchema(
  {
    rootKpi: stringProp,
    industry: stringProp,
    businessContext: stringProp,
    unit: { type: "string", maxLength: 80 },
    timePeriod: { type: "string", maxLength: 80 },
    goal: stringProp
  },
  ["rootKpi", "industry", "businessContext", "unit", "timePeriod", "goal"]
);

const agentExtractedInputSchema = objectSchema(
  {
    id: nodeIdProp,
    label: { type: "string", maxLength: 120 },
    value: stringOrNumberProp,
    unit: { type: "string", maxLength: 80 },
    sourceText: { type: "string", maxLength: 500 }
  },
  ["id", "label", "value"]
);

const agentMissingInputSchema = objectSchema(
  {
    id: nodeIdProp,
    question: { type: "string", maxLength: 500 },
    reason: { type: "string", maxLength: 1_000 },
    required: { type: "boolean" }
  },
  ["id", "question", "reason", "required"]
);

const agentDriverSchema = objectSchema(
  {
    id: nodeIdProp,
    parentNodeId: nodeIdProp,
    name: { type: "string", maxLength: 120 },
    type: nodeTypeProp,
    unit: { type: "string", maxLength: 80 },
    relation: edgeRelationProp,
    formula: { type: "string", maxLength: 500 },
    description: { type: "string", maxLength: 1_000 },
    value: stringOrNumberProp,
    assumptions: stringArrayProp
  },
  ["id", "parentNodeId", "name", "type", "unit", "relation", "formula", "description", "value", "assumptions"]
);

const agentQuestionSchema = objectSchema(
  {
    id: nodeIdProp,
    question: { type: "string", maxLength: 500 },
    reason: { type: "string", maxLength: 600 },
    required: { type: "boolean" },
    expectedAnswerType: enumProp(["text", "number", "single_choice", "multi_choice"]),
    options: stringArrayProp,
    defaultValue: { anyOf: [stringProp, { type: "number" }, stringArrayProp] }
  },
  ["id", "question", "reason", "required"]
);

const agentDecisionCallToolSchema = objectSchema(
  {
    type: { type: "string", const: "call_tool" },
    toolName: { type: "string", maxLength: 120 },
    args: { type: "object", properties: {}, required: [], additionalProperties: true },
    statusMessage: { type: "string", maxLength: 500 }
  },
  ["type", "toolName", "args", "statusMessage"]
);

const agentDecisionAskUserSchema = objectSchema(
  {
    type: { type: "string", const: "ask_user" },
    questions: { type: "array", minItems: 1, maxItems: 5, items: agentQuestionSchema },
    statusMessage: { type: "string", maxLength: 500 }
  },
  ["type", "questions", "statusMessage"]
);

const agentDecisionFinishSchema = objectSchema(
  {
    type: { type: "string", const: "finish" },
    summary: { type: "string", maxLength: 2_000 },
    nextSuggestedActions: { type: "array", maxItems: 10, items: { type: "string", maxLength: 300 } }
  },
  ["type", "summary", "nextSuggestedActions"]
);

const agentDecisionSchema = {
  type: "object",
  anyOf: [agentDecisionCallToolSchema, agentDecisionAskUserSchema, agentDecisionFinishSchema],
  properties: {},
  required: [],
  additionalProperties: false
};

const nodeUpdateSchema = objectSchema(
  {
    id: nodeIdProp,
    nodeId: nodeIdProp,
    patch: nodePatchSchema,
    name: { type: "string", maxLength: 120 },
    description: { type: "string", maxLength: 1_000 },
    type: nodeTypeProp,
    unit: { type: "string", maxLength: 80 },
    formula: { type: "string", maxLength: 500 },
    aiRationale: { type: "string", maxLength: 1_000 }
  },
  ["nodeId"]
);

const edgePatchSchema = objectSchema(
  {
    sourceNodeId: nodeIdProp,
    targetNodeId: nodeIdProp,
    relation: edgeRelationProp,
    label: { type: "string", maxLength: 80 },
    aiConfidence: confidenceProp
  },
  []
);

const edgeChangeAddSchema = objectSchema(
  {
    id: nodeIdProp,
    action: { type: "string", const: "add" },
    edge: aiEdgeSchema
  },
  ["id", "action", "edge"]
);
const edgeChangeRemoveSchema = objectSchema(
  {
    id: nodeIdProp,
    action: { type: "string", const: "remove" },
    edgeId: nodeIdProp
  },
  ["id", "action", "edgeId"]
);
const edgeChangeUpdateSchema = objectSchema(
  {
    id: nodeIdProp,
    action: { type: "string", const: "update" },
    edgeId: nodeIdProp,
    patch: edgePatchSchema
  },
  ["id", "action", "edgeId", "patch"]
);
const edgeChangeSchema = { anyOf: [edgeChangeAddSchema, edgeChangeRemoveSchema, edgeChangeUpdateSchema] };

const changeSetAdditionSchema = objectSchema(
  {
    id: nodeIdProp,
    nodeId: nodeIdProp,
    parentNodeId: nodeIdProp,
    relation: edgeRelationProp,
    name: { type: "string", maxLength: 120 },
    description: { type: "string", maxLength: 1_000 },
    type: nodeTypeProp,
    unit: { type: "string", maxLength: 80 },
    formula: { type: "string", maxLength: 500 },
    aiConfidence: confidenceProp,
    aiRationale: { type: "string", maxLength: 1_000 },
    controllability: controllabilityProp,
    materiality: materialityProp,
    fixedInScenario: { type: "boolean" }
  },
  ["id", "nodeId", "parentNodeId", "relation", "name"]
);
const changeSetUpdateSchema = objectSchema(
  {
    id: nodeIdProp,
    nodeId: nodeIdProp,
    patch: nodePatchSchema
  },
  ["id", "nodeId", "patch"]
);
const changeSetDeletionSchema = objectSchema(
  {
    id: nodeIdProp,
    nodeId: nodeIdProp,
    cascadeEdges: { type: "boolean" }
  },
  ["id", "nodeId"]
);
const changeSetDraftSchema = objectSchema(
  {
    id: nodeIdProp,
    additions: arrayProp(changeSetAdditionSchema, 15),
    updates: arrayProp(changeSetUpdateSchema, 10),
    deletions: arrayProp(changeSetDeletionSchema, 5),
    edgeChanges: arrayProp(edgeChangeSchema, 20),
    assumptions: stringArrayProp,
    questions: stringArrayProp,
    warnings: warningArrayProp
  },
  []
);

const reviewFindingSchema = objectSchema(
  {
    severity: severityProp,
    category: enumProp([
      "formula_validity",
      "unit_consistency",
      "business_logic",
      "duplicate_hints",
      "graph_structure",
      "data_quality"
    ]),
    message: { type: "string", maxLength: 1_000 },
    nodeId: nodeIdProp,
    edgeId: nodeIdProp
  },
  ["severity", "category", "message"]
);

const unitFindingSchema = objectSchema(
  {
    nodeId: nodeIdProp,
    expectedUnit: { type: "string", maxLength: 80 },
    actualUnit: { type: "string", maxLength: 80 },
    severity: severityProp,
    message: { type: "string", maxLength: 1_000 }
  },
  ["nodeId", "severity", "message"]
);

const missingDriverSchema = objectSchema(
  {
    parentNodeId: nodeIdProp,
    suggestedName: { type: "string", maxLength: 120 },
    suggestedType: nodeTypeProp,
    unit: { type: "string", maxLength: 80 },
    rationale: { type: "string", maxLength: 1_000 },
    suggestedNodeId: nodeIdProp
  },
  ["parentNodeId", "suggestedName", "suggestedType", "rationale"]
);

const duplicateClusterSchema = objectSchema(
  {
    nodeIds: { type: "array", minItems: 2, maxItems: 10, items: nodeIdProp },
    similarityReason: { type: "string", maxLength: 1_000 },
    mergeSuggestion: { type: "string", maxLength: 1_000 }
  },
  ["nodeIds", "similarityReason"]
);

const impactHighlightSchema = objectSchema(
  {
    nodeId: nodeIdProp,
    baselineValue: { type: "number" },
    scenarioValue: { type: "number" },
    delta: { type: "number" },
    message: { type: "string", maxLength: 500 }
  },
  ["nodeId", "message"]
);

const advisoryArrays = {
  assumptions: stringArrayProp,
  questionsForUser: stringArrayProp,
  warnings: warningArrayProp
};

const advisoryRequired = ["assumptions", "questionsForUser", "warnings"] as const;

function validateAdvisoryArrays(output: Record<string, unknown>): boolean {
  return (
    isStringArray(output.assumptions) &&
    isStringArray(output.questionsForUser) &&
    isObjectArray(output.warnings)
  );
}

function validateGenerateTreeGraph(output: Record<string, unknown>): RegisteredSchemaValidationResult {
  const errors: string[] = [];
  const rootId = typeof output.rootNodeId === "string" ? output.rootNodeId : "";
  const nodes = isObjectArray(output.nodes) ? output.nodes as Record<string, unknown>[] : [];
  const edges = isObjectArray(output.edges) ? output.edges as Record<string, unknown>[] : [];
  const nodeIds = new Set<string>();
  const nodeTypes = new Map<string, unknown>();

  for (const [index, node] of nodes.entries()) {
    if (typeof node.id !== "string" || node.id.length === 0) {
      errors.push(`$.nodes[${index}].id must be a non-empty string.`);
      continue;
    }
    if (nodeIds.has(node.id)) {
      errors.push(`Duplicate node id "${node.id}".`);
    }
    nodeIds.add(node.id);
    nodeTypes.set(node.id, node.type);
  }

  if (!rootId) {
    errors.push("$.rootNodeId must be a non-empty string.");
  } else if (!nodeIds.has(rootId)) {
    errors.push(`$.rootNodeId must reference an existing node: ${rootId}.`);
  }

  const childrenBySource = new Map<string, string[]>();
  const edgePairs = new Set<string>();
  for (const [index, edge] of edges.entries()) {
    const sourceNodeId = typeof edge.sourceNodeId === "string" ? edge.sourceNodeId : "";
    const targetNodeId = typeof edge.targetNodeId === "string" ? edge.targetNodeId : "";

    if (!sourceNodeId || !nodeIds.has(sourceNodeId)) {
      errors.push(`$.edges[${index}].sourceNodeId must reference an existing node: ${sourceNodeId || "(missing)"}.`);
      continue;
    }
    if (!targetNodeId || !nodeIds.has(targetNodeId)) {
      errors.push(`$.edges[${index}].targetNodeId must reference an existing node: ${targetNodeId || "(missing)"}.`);
      continue;
    }

    const edgePairKey = `${sourceNodeId}\u0000${targetNodeId}`;
    if (edgePairs.has(edgePairKey)) {
      errors.push(`Duplicate edge pair "${sourceNodeId}" -> "${targetNodeId}".`);
    }
    edgePairs.add(edgePairKey);
    childrenBySource.set(sourceNodeId, [...(childrenBySource.get(sourceNodeId) ?? []), targetNodeId]);
  }

  if (rootId && nodeIds.has(rootId)) {
    const reachable = new Set<string>();
    const stack = [rootId];
    while (stack.length > 0) {
      const nodeId = stack.pop();
      if (!nodeId || reachable.has(nodeId)) continue;
      reachable.add(nodeId);
      for (const childId of childrenBySource.get(nodeId) ?? []) {
        if (!reachable.has(childId)) stack.push(childId);
      }
    }

    for (const nodeId of nodeIds) {
      if (nodeId !== rootId && nodeTypes.get(nodeId) !== "external_factor" && !reachable.has(nodeId)) {
        errors.push(`Node "${nodeId}" must be reachable from root "${rootId}" through visual decomposition edges.`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function shouldPreferDuplicateEdge(candidate: Record<string, unknown>, current: Record<string, unknown>): boolean {
  const candidateIsFormula = candidate.relation === "formula_dependency";
  const currentIsFormula = current.relation === "formula_dependency";
  if (currentIsFormula && !candidateIsFormula) return true;
  return false;
}

function dedupeGenerateTreeEdges(edges: Record<string, unknown>[]): Record<string, unknown>[] {
  const orderedKeys: string[] = [];
  const edgeByPair = new Map<string, Record<string, unknown>>();

  for (const edge of edges) {
    const sourceNodeId = typeof edge.sourceNodeId === "string" ? edge.sourceNodeId : "";
    const targetNodeId = typeof edge.targetNodeId === "string" ? edge.targetNodeId : "";
    const key = `${sourceNodeId}\u0000${targetNodeId}`;
    const current = edgeByPair.get(key);
    if (!current) {
      orderedKeys.push(key);
      edgeByPair.set(key, edge);
      continue;
    }
    if (shouldPreferDuplicateEdge(edge, current)) {
      edgeByPair.set(key, edge);
    }
  }

  return orderedKeys.flatMap((key) => {
    const edge = edgeByPair.get(key);
    return edge ? [edge] : [];
  });
}

function orientGenerateTreeEdgesFromRoot(output: Record<string, unknown>): Record<string, unknown> {
  if (validateGenerateTreeGraph(output).valid) return output;

  const rootId = typeof output.rootNodeId === "string" ? output.rootNodeId : "";
  const nodes = isObjectArray(output.nodes) ? output.nodes as Record<string, unknown>[] : [];
  const edges = isObjectArray(output.edges) ? output.edges as Record<string, unknown>[] : [];
  const nodeTypes = new Map<string, unknown>();
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (typeof node.id !== "string" || node.id.length === 0) continue;
    nodeIds.add(node.id);
    nodeTypes.set(node.id, node.type);
  }
  if (!rootId || !nodeIds.has(rootId) || edges.length === 0) return output;

  const neighbors = new Map<string, string[]>();
  for (const edge of edges) {
    const sourceNodeId = typeof edge.sourceNodeId === "string" ? edge.sourceNodeId : "";
    const targetNodeId = typeof edge.targetNodeId === "string" ? edge.targetNodeId : "";
    if (!nodeIds.has(sourceNodeId) || !nodeIds.has(targetNodeId)) return output;
    neighbors.set(sourceNodeId, [...(neighbors.get(sourceNodeId) ?? []), targetNodeId]);
    neighbors.set(targetNodeId, [...(neighbors.get(targetNodeId) ?? []), sourceNodeId]);
  }

  const depth = new Map<string, number>([[rootId, 0]]);
  const queue = [rootId];
  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId) continue;
    const nextDepth = (depth.get(nodeId) ?? 0) + 1;
    for (const neighbor of neighbors.get(nodeId) ?? []) {
      if (depth.has(neighbor)) continue;
      depth.set(neighbor, nextDepth);
      queue.push(neighbor);
    }
  }

  for (const nodeId of nodeIds) {
    if (nodeId !== rootId && nodeTypes.get(nodeId) !== "external_factor" && !depth.has(nodeId)) return output;
  }

  const orientedEdges = edges.map((edge) => {
    const sourceDepth = typeof edge.sourceNodeId === "string" ? depth.get(edge.sourceNodeId) : undefined;
    const targetDepth = typeof edge.targetNodeId === "string" ? depth.get(edge.targetNodeId) : undefined;
    if (sourceDepth === undefined || targetDepth === undefined || sourceDepth <= targetDepth) return edge;
    return {
      ...edge,
      sourceNodeId: edge.targetNodeId,
      targetNodeId: edge.sourceNodeId
    };
  });

  const normalized = { ...output, edges: dedupeGenerateTreeEdges(orientedEdges) };
  return validateGenerateTreeGraph(normalized).valid ? normalized : output;
}

export function normalizeRegisteredSchemaOutput(schemaId: VdtSchemaId, output: unknown): unknown {
  if (schemaId === "generate-tree-v1" && isRecord(output)) return orientGenerateTreeEdgesFromRoot(output);
  return output;
}

const jsonSchemas: Record<VdtSchemaId, Record<string, unknown>> = {
  "connection-test-v1": {
    type: "object",
    properties: { ok: { type: "boolean", const: true } },
    required: ["ok"],
    additionalProperties: false
  },
  "agent-decision-v1": agentDecisionSchema,
  "agent-plan-v1": objectSchema(
    {
      buildIntent: agentBuildIntentSchema,
      selectedSkillIds: stringArrayProp,
      skillRationale: stringProp,
      extractedInputs: arrayProp(agentExtractedInputSchema, 80),
      missingInputs: arrayProp(agentMissingInputSchema, 40),
      driverPlan: arrayProp(agentDriverSchema, 80),
      rootFormula: { type: "string", maxLength: 500 },
      assumptions: stringArrayProp,
      questionsForUser: stringArrayProp,
      warnings: warningArrayProp,
      confidence: confidenceProp
    },
    [
      "buildIntent",
      "selectedSkillIds",
      "skillRationale",
      "extractedInputs",
      "missingInputs",
      "driverPlan",
      "rootFormula",
      "assumptions",
      "questionsForUser",
      "warnings",
      "confidence"
    ]
  ),
  "generate-tree-v1": objectSchema(
    {
      projectTitle: stringProp,
      rootNodeId: stringProp,
      nodes: { type: "array", minItems: 1, maxItems: MAX_OUTPUT_ARRAY_ITEMS, items: aiNodeSchema },
      edges: arrayProp(aiEdgeSchema),
      ...advisoryArrays
    },
    ["projectTitle", "rootNodeId", "nodes", "edges", ...advisoryRequired]
  ),
  "deepen-node-v1": objectSchema(
    {
      targetNodeId: stringProp,
      nodes: { type: "array", minItems: 1, maxItems: MAX_OUTPUT_ARRAY_ITEMS, items: aiNodeSchema },
      edges: arrayProp(aiEdgeSchema),
      ...advisoryArrays
    },
    ["targetNodeId", "nodes", "edges", ...advisoryRequired]
  ),
  "simplify-branch-v1": objectSchema(
    {
      branchRootNodeId: stringProp,
      nodeRemovals: arrayProp(nodeRemovalSchema),
      nodeUpdates: arrayProp(nodeUpdateSchema),
      edgeChanges: arrayProp(edgeChangeSchema),
      rationale: stringProp,
      ...advisoryArrays
    },
    ["branchRootNodeId", "nodeRemovals", "edgeChanges", "rationale", ...advisoryRequired]
  ),
  "suggest-alternative-v1": objectSchema(
    {
      targetNodeId: stringProp,
      nodes: { type: "array", minItems: 1, maxItems: MAX_OUTPUT_ARRAY_ITEMS, items: aiNodeSchema },
      edges: arrayProp(aiEdgeSchema),
      rationale: stringProp,
      ...advisoryArrays
    },
    ["targetNodeId", "nodes", "edges", "rationale", ...advisoryRequired]
  ),
  "suggest-formula-v1": objectSchema(
    {
      nodeId: stringProp,
      proposedFormula: stringProp,
      proposedUnit: stringProp,
      aiRationale: stringProp,
      confidence: { type: "number", minimum: 0, maximum: 1 },
      ...advisoryArrays
    },
    ["nodeId", "proposedFormula", "aiRationale", "confidence", ...advisoryRequired]
  ),
  "review-model-v1": objectSchema(
    {
      findings: arrayProp(reviewFindingSchema),
      suggestedChanges: changeSetDraftSchema,
      ...advisoryArrays
    },
    ["findings", ...advisoryRequired]
  ),
  "check-units-v1": objectSchema(
    {
      unitFindings: arrayProp(unitFindingSchema),
      ...advisoryArrays
    },
    ["unitFindings", ...advisoryRequired]
  ),
  "identify-missing-drivers-v1": objectSchema(
    {
      missingDrivers: arrayProp(missingDriverSchema),
      suggestedChanges: changeSetDraftSchema,
      ...advisoryArrays
    },
    ["missingDrivers", ...advisoryRequired]
  ),
  "identify-duplicate-drivers-v1": objectSchema(
    {
      duplicateClusters: arrayProp(duplicateClusterSchema),
      suggestedChanges: changeSetDraftSchema,
      ...advisoryArrays
    },
    ["duplicateClusters", ...advisoryRequired]
  ),
  "explain-node-v1": objectSchema(
    {
      nodeId: stringProp,
      explanation: stringProp,
      keyDrivers: stringArrayProp,
      assumptions: stringArrayProp,
      questionsForUser: stringArrayProp
    },
    ["nodeId", "explanation", "keyDrivers", "assumptions", "questionsForUser"]
  ),
  "explain-scenario-v1": objectSchema(
    {
      scenarioId: stringProp,
      narrative: stringProp,
      impactHighlights: arrayProp(impactHighlightSchema),
      assumptions: stringArrayProp,
      questionsForUser: stringArrayProp
    },
    ["scenarioId", "narrative", "impactHighlights", "assumptions", "questionsForUser"]
  ),
  "generate-executive-summary-v1": objectSchema(
    {
      headline: stringProp,
      keyDrivers: stringArrayProp,
      risks: stringArrayProp,
      recommendations: stringArrayProp
    },
    ["headline", "keyDrivers", "risks", "recommendations"]
  )
};

export function getRegisteredJsonSchema(schemaId: VdtSchemaId): Record<string, unknown> {
  return jsonSchemas[schemaId];
}

function toStrictResponseJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map((entry) => toStrictResponseJsonSchema(entry));
  }
  if (!isRecord(schema)) {
    return schema;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    result[key] = toStrictResponseJsonSchema(value);
  }

  if (Array.isArray(schema.anyOf)) {
    result.anyOf = schema.anyOf.map((entry) => toStrictResponseJsonSchema(entry));
  }

  if (schema.type === "array" && "items" in schema) {
    result.items = toStrictResponseJsonSchema(schema.items);
  }

  if (schema.type === "object") {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const strictProperties = Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [key, toStrictResponseJsonSchema(value)])
    );
    result.properties = strictProperties;
    result.required = Object.keys(strictProperties);
    result.additionalProperties = false;
  }

  return result;
}

export function getStrictResponseJsonSchema(schemaId: VdtSchemaId): Record<string, unknown> {
  return toStrictResponseJsonSchema(jsonSchemas[schemaId]) as Record<string, unknown>;
}

const validators: Record<VdtSchemaId, (output: Record<string, unknown>) => boolean> = {
  "connection-test-v1": (output) => output.ok === true,
  "agent-decision-v1": (output) => {
    for (const forbidden of ["driverPlan", "nodes", "edges", "rootFormula", "project", "fullProject", "fullGraph", "selectedSkillIds"]) {
      if (forbidden in output) return false;
    }
    if (output.type === "call_tool") {
      return typeof output.toolName === "string" && isRecord(output.args) && typeof output.statusMessage === "string";
    }
    if (output.type === "ask_user") {
      return isObjectArray(output.questions) && (output.questions as unknown[]).length > 0 && typeof output.statusMessage === "string";
    }
    if (output.type === "finish") {
      return typeof output.summary === "string" && isStringArray(output.nextSuggestedActions);
    }
    return false;
  },
  "agent-plan-v1": (output) =>
    isRecord(output.buildIntent) &&
    isStringArray(output.selectedSkillIds) &&
    typeof output.skillRationale === "string" &&
    isObjectArray(output.extractedInputs) &&
    isObjectArray(output.missingInputs) &&
    isObjectArray(output.driverPlan) &&
    typeof output.rootFormula === "string" &&
    validateAdvisoryArrays(output) &&
    typeof output.confidence === "number",
  "generate-tree-v1": (output) =>
    typeof output.projectTitle === "string" &&
    typeof output.rootNodeId === "string" &&
    isObjectArray(output.nodes) &&
    (output.nodes as unknown[]).length > 0 &&
    isObjectArray(output.edges) &&
    validateAdvisoryArrays(output) &&
    validateGenerateTreeGraph(output).valid,
  "deepen-node-v1": (output) =>
    typeof output.targetNodeId === "string" &&
    isObjectArray(output.nodes) &&
    (output.nodes as unknown[]).length > 0 &&
    isObjectArray(output.edges) &&
    validateAdvisoryArrays(output),
  "simplify-branch-v1": (output) =>
    typeof output.branchRootNodeId === "string" &&
    isObjectArray(output.nodeRemovals) &&
    isObjectArray(output.edgeChanges) &&
    typeof output.rationale === "string" &&
    validateAdvisoryArrays(output),
  "suggest-alternative-v1": (output) =>
    typeof output.targetNodeId === "string" &&
    isObjectArray(output.nodes) &&
    (output.nodes as unknown[]).length > 0 &&
    isObjectArray(output.edges) &&
    typeof output.rationale === "string" &&
    validateAdvisoryArrays(output),
  "suggest-formula-v1": (output) =>
    typeof output.nodeId === "string" &&
    typeof output.proposedFormula === "string" &&
    typeof output.aiRationale === "string" &&
    typeof output.confidence === "number" &&
    validateAdvisoryArrays(output),
  "review-model-v1": (output) => isObjectArray(output.findings) && validateAdvisoryArrays(output),
  "check-units-v1": (output) => isObjectArray(output.unitFindings) && validateAdvisoryArrays(output),
  "identify-missing-drivers-v1": (output) =>
    isObjectArray(output.missingDrivers) && validateAdvisoryArrays(output),
  "identify-duplicate-drivers-v1": (output) =>
    isObjectArray(output.duplicateClusters) && validateAdvisoryArrays(output),
  "explain-node-v1": (output) =>
    typeof output.nodeId === "string" &&
    typeof output.explanation === "string" &&
    isStringArray(output.keyDrivers) &&
    isStringArray(output.assumptions) &&
    isStringArray(output.questionsForUser),
  "explain-scenario-v1": (output) =>
    typeof output.scenarioId === "string" &&
    typeof output.narrative === "string" &&
    isObjectArray(output.impactHighlights) &&
    isStringArray(output.assumptions) &&
    isStringArray(output.questionsForUser),
  "generate-executive-summary-v1": (output) =>
    typeof output.headline === "string" &&
    isStringArray(output.keyDrivers) &&
    isStringArray(output.risks) &&
    isStringArray(output.recommendations)
};

export function validateRegisteredSchema(schemaId: VdtSchemaId, output: unknown): boolean {
  if (!isRecord(output)) return false;
  const schema = jsonSchemas[schemaId];
  if (!schema || !hasRequiredKeys(output, (schema.required as string[]) ?? [])) return false;
  return validators[schemaId](output) && validateJsonSchemaSubset(schema, output).valid;
}

export interface RegisteredSchemaValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateRegisteredSchemaDetailed(schemaId: VdtSchemaId, output: unknown): RegisteredSchemaValidationResult {
  const schema = jsonSchemas[schemaId];
  if (!schema) return { valid: false, errors: [`Unknown schema ${schemaId}.`] };
  const subset = validateJsonSchemaSubset(schema, output);
  if (!subset.valid) return subset;
  if (schemaId === "generate-tree-v1" && isRecord(output)) {
    const graph = validateGenerateTreeGraph(output);
    if (!graph.valid) return graph;
  }
  if (!isRecord(output) || !validators[schemaId](output)) {
    return { valid: false, errors: [`$ does not satisfy registered semantic validator for ${schemaId}.`] };
  }
  return { valid: true, errors: [] };
}

function validateJsonSchemaSubset(schema: unknown, value: unknown, path = "$"): RegisteredSchemaValidationResult {
  if (!isRecord(schema)) return { valid: true, errors: [] };
  if (Array.isArray(schema.anyOf)) {
    const branchResults = schema.anyOf.map((branch) => validateJsonSchemaSubset(branch, value, path));
    if (branchResults.some((result) => result.valid)) {
      return { valid: true, errors: [] };
    }
    return {
      valid: false,
      errors: branchResults.flatMap((result) => result.errors).slice(0, 12)
    };
  }
  const errors: string[] = [];
  const type = schema.type;

  if (type === "object") {
    if (!isRecord(value)) {
      return { valid: false, errors: [`${path} must be an object.`] };
    }
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === "string") : [];
    for (const key of required) {
      if (!(key in value)) errors.push(`${path}.${key} is required.`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) errors.push(`${path}.${key} is not an approved field.`);
      }
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (key in value) errors.push(...validateJsonSchemaSubset(propertySchema, value[key], `${path}.${key}`).errors);
    }
  } else if (type === "array") {
    if (!Array.isArray(value)) {
      return { valid: false, errors: [`${path} must be an array.`] };
    }
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push(`${path} must contain at least ${schema.minItems} item(s).`);
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      errors.push(`${path} must contain at most ${schema.maxItems} item(s).`);
    }
    value.forEach((item, index) => {
      errors.push(...validateJsonSchemaSubset(schema.items, item, `${path}[${index}]`).errors);
    });
  } else if (type === "string") {
    if (typeof value !== "string") {
      return { valid: false, errors: [`${path} must be a string.`] };
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      errors.push(`${path} must be at most ${schema.maxLength} character(s).`);
    }
  } else if (type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { valid: false, errors: [`${path} must be a finite number.`] };
    }
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push(`${path} must be at least ${schema.minimum}.`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      errors.push(`${path} must be at most ${schema.maximum}.`);
    }
  } else if (type === "boolean") {
    if (typeof value !== "boolean") {
      return { valid: false, errors: [`${path} must be a boolean.`] };
    }
  }

  if ("const" in schema && value !== schema.const) errors.push(`${path} must equal ${String(schema.const)}.`);
  return { valid: errors.length === 0, errors };
}
