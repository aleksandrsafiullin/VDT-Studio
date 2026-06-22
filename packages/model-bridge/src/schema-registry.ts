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

const stringProp = { type: "string" };
const stringArrayProp = { type: "array", items: stringProp };
const objectArrayProp = { type: "array", items: { type: "object" } };
const warningArrayProp = objectArrayProp;

function objectSchema(
  properties: Record<string, unknown>,
  required: string[],
  additionalProperties = true
): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties };
}

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
      nodes: { type: "array", minItems: 1, items: { type: "object" } },
      edges: objectArrayProp,
      ...advisoryArrays
    },
    ["projectTitle", "rootNodeId", "nodes", "edges", ...advisoryRequired]
  ),
  "deepen-node-v1": objectSchema(
    {
      targetNodeId: stringProp,
      nodes: { type: "array", minItems: 1, items: { type: "object" } },
      edges: objectArrayProp,
      ...advisoryArrays
    },
    ["targetNodeId", "nodes", "edges", ...advisoryRequired]
  ),
  "simplify-branch-v1": objectSchema(
    {
      branchRootNodeId: stringProp,
      nodeRemovals: objectArrayProp,
      edgeChanges: objectArrayProp,
      rationale: stringProp,
      ...advisoryArrays
    },
    ["branchRootNodeId", "nodeRemovals", "edgeChanges", "rationale", ...advisoryRequired]
  ),
  "suggest-alternative-v1": objectSchema(
    {
      targetNodeId: stringProp,
      nodes: { type: "array", minItems: 1, items: { type: "object" } },
      edges: objectArrayProp,
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
      findings: objectArrayProp,
      suggestedChanges: { type: "object" },
      ...advisoryArrays
    },
    ["findings", ...advisoryRequired]
  ),
  "check-units-v1": objectSchema(
    {
      unitFindings: objectArrayProp,
      ...advisoryArrays
    },
    ["unitFindings", ...advisoryRequired]
  ),
  "identify-missing-drivers-v1": objectSchema(
    {
      missingDrivers: objectArrayProp,
      suggestedChanges: { type: "object" },
      ...advisoryArrays
    },
    ["missingDrivers", ...advisoryRequired]
  ),
  "identify-duplicate-drivers-v1": objectSchema(
    {
      duplicateClusters: objectArrayProp,
      suggestedChanges: { type: "object" },
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
      impactHighlights: objectArrayProp,
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
  return validators[schemaId](output);
}
