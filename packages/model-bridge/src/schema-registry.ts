import type { VdtAiTaskType } from "@vdt-studio/vdt-core";

export const VDT_OUTPUT_SCHEMA_IDS = [
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
const nodeTypeProp = enumProp(["root_kpi", "calculated", "input", "assumption", "external_factor"]);
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
    materiality: materialityProp
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
    materiality: materialityProp
  },
  []
);

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
    materiality: materialityProp
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

const jsonSchemas: Record<VdtSchemaId, Record<string, unknown>> = {
  "connection-test-v1": {
    type: "object",
    properties: { ok: { type: "boolean", const: true } },
    required: ["ok"],
    additionalProperties: false
  },
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
  "generate-tree-v1": (output) =>
    typeof output.projectTitle === "string" &&
    typeof output.rootNodeId === "string" &&
    isObjectArray(output.nodes) &&
    (output.nodes as unknown[]).length > 0 &&
    isObjectArray(output.edges) &&
    validateAdvisoryArrays(output),
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
