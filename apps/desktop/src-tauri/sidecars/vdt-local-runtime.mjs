// ../local-runner/src/sidecar/index.ts
import { fileURLToPath as fileURLToPath2 } from "node:url";

// ../local-runner/src/sidecar/runtime.ts
import { randomUUID as randomUUID2 } from "node:crypto";

// ../local-runner/src/server/runtime.ts
import { randomUUID } from "node:crypto";

// ../model-bridge/src/fake-backend.ts
var FAKE_CAPABILITIES = Object.freeze({
  structuredOutput: true,
  streaming: false,
  modelSelection: false,
  accountBasedUsage: false,
  localExecution: true,
  toolsCanBeDisabled: true,
  requiresOsSandbox: false
});

// ../model-bridge/src/registry.ts
var capabilities = (value) => Object.freeze({ ...value });
var cloud = capabilities({
  structuredOutput: true,
  streaming: true,
  modelSelection: true,
  accountBasedUsage: false,
  localExecution: false,
  toolsCanBeDisabled: true,
  requiresOsSandbox: false
});
var localHttp = capabilities({
  structuredOutput: true,
  streaming: true,
  modelSelection: true,
  accountBasedUsage: false,
  localExecution: true,
  toolsCanBeDisabled: true,
  requiresOsSandbox: false
});
var subscription = (requiresOsSandbox, toolsCanBeDisabled = !requiresOsSandbox) => capabilities({
  structuredOutput: true,
  streaming: true,
  modelSelection: true,
  accountBasedUsage: true,
  localExecution: true,
  toolsCanBeDisabled,
  requiresOsSandbox
});
var MODEL_BACKEND_DEFINITIONS = Object.freeze([
  { id: "mock", label: "Mock", mode: "api", capabilities: cloud, releaseStatus: "supported" },
  { id: "openai_compatible", label: "OpenAI-compatible API", mode: "api", capabilities: cloud, releaseStatus: "supported" },
  { id: "anthropic", label: "Anthropic API", mode: "api", capabilities: cloud, releaseStatus: "supported" },
  { id: "gemini_api", label: "Gemini API", mode: "api", capabilities: cloud, releaseStatus: "supported" },
  { id: "azure_openai", label: "Azure OpenAI", mode: "api", capabilities: cloud, releaseStatus: "supported" },
  { id: "alibaba_coding_plan", label: "Alibaba Cloud Coding Plan", mode: "api", capabilities: cloud, releaseStatus: "beta" },
  { id: "ollama", label: "Ollama", mode: "local_http", capabilities: localHttp, releaseStatus: "supported" },
  { id: "lm_studio", label: "LM Studio", mode: "local_http", capabilities: localHttp, releaseStatus: "supported" },
  { id: "vllm", label: "vLLM", mode: "local_http", capabilities: localHttp, releaseStatus: "beta" },
  {
    id: "cursor_subscription",
    label: "Cursor Agent",
    mode: "subscription_cli",
    capabilities: subscription(false, false),
    releaseStatus: "beta"
  },
  { id: "codex_subscription", label: "Codex CLI", mode: "subscription_cli", capabilities: subscription(false), releaseStatus: "alpha" },
  { id: "claude_subscription", label: "Claude Code", mode: "subscription_cli", capabilities: subscription(false), releaseStatus: "alpha" },
  { id: "gemini_subscription", label: "Gemini CLI", mode: "subscription_cli", capabilities: subscription(false), releaseStatus: "experimental" },
  { id: "copilot_subscription", label: "GitHub Copilot CLI", mode: "subscription_cli", capabilities: subscription(false), releaseStatus: "experimental" },
  { id: "custom_cli", label: "Custom JSON CLI", mode: "custom_cli", capabilities: subscription(true), releaseStatus: "experimental-disabled" }
]);
var registry = new Map(MODEL_BACKEND_DEFINITIONS.map((backend) => [backend.id, backend]));
if (registry.size !== MODEL_BACKEND_DEFINITIONS.length) {
  throw new Error("Model backend registry contains duplicate ids.");
}

// ../model-bridge/src/safe-json.ts
var byteLength = (value) => new TextEncoder().encode(value).byteLength;
function findBalancedObject(value) {
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) return value.slice(start, index + 1);
    }
  }
  return void 0;
}
function extractBoundedJson(raw, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("maxBytes must be a positive integer.");
  }
  if (byteLength(raw) > maxBytes) throw new Error(`Model output exceeds ${maxBytes} bytes.`);
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim();
  const candidate = fenced ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const object = findBalancedObject(candidate);
    if (!object) throw new Error("Model output did not contain one complete JSON object.");
    try {
      return JSON.parse(object);
    } catch {
      throw new Error("Model output contained malformed JSON.");
    }
  }
}

// ../model-bridge/src/schema-registry.ts
var VDT_OUTPUT_SCHEMA_IDS = [
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
];
var VDT_SCHEMA_IDS = ["connection-test-v1", ...VDT_OUTPUT_SCHEMA_IDS];
var schemaTask = {
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
var taskToSchemaId = Object.fromEntries(
  Object.entries(schemaTask).map(([schemaId, taskType]) => [taskType, schemaId])
);
var schemaTasks = {
  "connection-test-v1": "generate_tree",
  ...schemaTask
};
function isVdtSchemaId(value) {
  return VDT_SCHEMA_IDS.includes(value);
}
function schemaSupportsTask(schemaId, taskType) {
  return schemaTasks[schemaId] === taskType;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isArray(value) {
  return Array.isArray(value);
}
function isStringArray(value) {
  return isArray(value) && value.every((item) => typeof item === "string");
}
function isObjectArray(value) {
  return isArray(value) && value.every((item) => isRecord(item));
}
function hasRequiredKeys(output, keys) {
  return keys.every((key) => key in output);
}
var MAX_OUTPUT_STRING_LENGTH = 12e3;
var MAX_OUTPUT_ARRAY_ITEMS = 250;
var stringProp = { type: "string", maxLength: MAX_OUTPUT_STRING_LENGTH };
var stringArrayProp = { type: "array", maxItems: MAX_OUTPUT_ARRAY_ITEMS, items: stringProp };
function objectSchema(properties, required, additionalProperties = false) {
  return { type: "object", properties, required, additionalProperties };
}
function arrayProp(items, maxItems = MAX_OUTPUT_ARRAY_ITEMS) {
  return { type: "array", maxItems, items };
}
function enumProp(values) {
  return { type: "string", enum: [...values] };
}
var nodeIdProp = { type: "string", maxLength: 160 };
var confidenceProp = { type: "number", minimum: 0, maximum: 1 };
var nodeTypeProp = enumProp(["root_kpi", "calculated", "input", "assumption", "external_factor"]);
var edgeRelationProp = enumProp([
  "positive_driver",
  "negative_driver",
  "multiplicative_driver",
  "divisive_driver",
  "additive_component",
  "subtractive_component",
  "contextual_influence",
  "formula_dependency"
]);
var severityProp = enumProp(["info", "warning", "error"]);
var controllabilityProp = enumProp(["high", "medium", "low", "none"]);
var materialityProp = enumProp(["high", "medium", "low", "unknown"]);
var aiNodeSchema = objectSchema(
  {
    id: nodeIdProp,
    name: { type: "string", maxLength: 120 },
    description: { type: "string", maxLength: 1e3 },
    type: nodeTypeProp,
    unit: { type: "string", maxLength: 80 },
    formula: { type: "string", maxLength: 500 },
    aiConfidence: confidenceProp,
    aiRationale: { type: "string", maxLength: 1e3 },
    controllability: controllabilityProp,
    materiality: materialityProp
  },
  ["id"]
);
var aiEdgeSchema = objectSchema(
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
var warningSchema = objectSchema(
  {
    severity: severityProp,
    message: { type: "string", maxLength: 1e3 },
    nodeId: nodeIdProp,
    edgeId: nodeIdProp
  },
  ["message"]
);
var objectArrayProp = arrayProp(objectSchema({}, []));
var warningArrayProp = arrayProp(warningSchema);
var nodeRemovalSchema = objectSchema(
  {
    nodeId: nodeIdProp,
    mergeIntoNodeId: nodeIdProp,
    rationale: { type: "string", maxLength: 1e3 }
  },
  ["nodeId"]
);
var nodePatchSchema = objectSchema(
  {
    name: { type: "string", maxLength: 120 },
    description: { type: "string", maxLength: 1e3 },
    type: nodeTypeProp,
    unit: { type: "string", maxLength: 80 },
    formula: { type: "string", maxLength: 500 },
    aiConfidence: confidenceProp,
    aiRationale: { type: "string", maxLength: 1e3 },
    controllability: controllabilityProp,
    materiality: materialityProp
  },
  []
);
var nodeUpdateSchema = objectSchema(
  {
    id: nodeIdProp,
    nodeId: nodeIdProp,
    patch: nodePatchSchema,
    name: { type: "string", maxLength: 120 },
    description: { type: "string", maxLength: 1e3 },
    type: nodeTypeProp,
    unit: { type: "string", maxLength: 80 },
    formula: { type: "string", maxLength: 500 },
    aiRationale: { type: "string", maxLength: 1e3 }
  },
  ["nodeId"]
);
var edgePatchSchema = objectSchema(
  {
    sourceNodeId: nodeIdProp,
    targetNodeId: nodeIdProp,
    relation: edgeRelationProp,
    label: { type: "string", maxLength: 80 },
    aiConfidence: confidenceProp
  },
  []
);
var edgeChangeAddSchema = objectSchema(
  {
    id: nodeIdProp,
    action: { type: "string", const: "add" },
    edge: aiEdgeSchema
  },
  ["id", "action", "edge"]
);
var edgeChangeRemoveSchema = objectSchema(
  {
    id: nodeIdProp,
    action: { type: "string", const: "remove" },
    edgeId: nodeIdProp
  },
  ["id", "action", "edgeId"]
);
var edgeChangeUpdateSchema = objectSchema(
  {
    id: nodeIdProp,
    action: { type: "string", const: "update" },
    edgeId: nodeIdProp,
    patch: edgePatchSchema
  },
  ["id", "action", "edgeId", "patch"]
);
var edgeChangeSchema = { anyOf: [edgeChangeAddSchema, edgeChangeRemoveSchema, edgeChangeUpdateSchema] };
var changeSetAdditionSchema = objectSchema(
  {
    id: nodeIdProp,
    nodeId: nodeIdProp,
    parentNodeId: nodeIdProp,
    relation: edgeRelationProp,
    name: { type: "string", maxLength: 120 },
    description: { type: "string", maxLength: 1e3 },
    type: nodeTypeProp,
    unit: { type: "string", maxLength: 80 },
    formula: { type: "string", maxLength: 500 },
    aiConfidence: confidenceProp,
    aiRationale: { type: "string", maxLength: 1e3 },
    controllability: controllabilityProp,
    materiality: materialityProp
  },
  ["id", "nodeId", "parentNodeId", "relation", "name"]
);
var changeSetUpdateSchema = objectSchema(
  {
    id: nodeIdProp,
    nodeId: nodeIdProp,
    patch: nodePatchSchema
  },
  ["id", "nodeId", "patch"]
);
var changeSetDeletionSchema = objectSchema(
  {
    id: nodeIdProp,
    nodeId: nodeIdProp,
    cascadeEdges: { type: "boolean" }
  },
  ["id", "nodeId"]
);
var changeSetDraftSchema = objectSchema(
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
var reviewFindingSchema = objectSchema(
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
    message: { type: "string", maxLength: 1e3 },
    nodeId: nodeIdProp,
    edgeId: nodeIdProp
  },
  ["severity", "category", "message"]
);
var unitFindingSchema = objectSchema(
  {
    nodeId: nodeIdProp,
    expectedUnit: { type: "string", maxLength: 80 },
    actualUnit: { type: "string", maxLength: 80 },
    severity: severityProp,
    message: { type: "string", maxLength: 1e3 }
  },
  ["nodeId", "severity", "message"]
);
var missingDriverSchema = objectSchema(
  {
    parentNodeId: nodeIdProp,
    suggestedName: { type: "string", maxLength: 120 },
    suggestedType: nodeTypeProp,
    unit: { type: "string", maxLength: 80 },
    rationale: { type: "string", maxLength: 1e3 },
    suggestedNodeId: nodeIdProp
  },
  ["parentNodeId", "suggestedName", "suggestedType", "rationale"]
);
var duplicateClusterSchema = objectSchema(
  {
    nodeIds: { type: "array", minItems: 2, maxItems: 10, items: nodeIdProp },
    similarityReason: { type: "string", maxLength: 1e3 },
    mergeSuggestion: { type: "string", maxLength: 1e3 }
  },
  ["nodeIds", "similarityReason"]
);
var impactHighlightSchema = objectSchema(
  {
    nodeId: nodeIdProp,
    baselineValue: { type: "number" },
    scenarioValue: { type: "number" },
    delta: { type: "number" },
    message: { type: "string", maxLength: 500 }
  },
  ["nodeId", "message"]
);
var advisoryArrays = {
  assumptions: stringArrayProp,
  questionsForUser: stringArrayProp,
  warnings: warningArrayProp
};
var advisoryRequired = ["assumptions", "questionsForUser", "warnings"];
function validateAdvisoryArrays(output) {
  return isStringArray(output.assumptions) && isStringArray(output.questionsForUser) && isObjectArray(output.warnings);
}
function validateGenerateTreeGraph(output) {
  const errors = [];
  const rootId = typeof output.rootNodeId === "string" ? output.rootNodeId : "";
  const nodes = isObjectArray(output.nodes) ? output.nodes : [];
  const edges = isObjectArray(output.edges) ? output.edges : [];
  const nodeIds = /* @__PURE__ */ new Set();
  const nodeTypes = /* @__PURE__ */ new Map();
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
  const childrenBySource = /* @__PURE__ */ new Map();
  const edgePairs = /* @__PURE__ */ new Set();
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
    const edgePairKey = `${sourceNodeId}\0${targetNodeId}`;
    if (edgePairs.has(edgePairKey)) {
      errors.push(`Duplicate edge pair "${sourceNodeId}" -> "${targetNodeId}".`);
    }
    edgePairs.add(edgePairKey);
    childrenBySource.set(sourceNodeId, [...childrenBySource.get(sourceNodeId) ?? [], targetNodeId]);
  }
  if (rootId && nodeIds.has(rootId)) {
    const reachable = /* @__PURE__ */ new Set();
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
function shouldPreferDuplicateEdge(candidate, current) {
  const candidateIsFormula = candidate.relation === "formula_dependency";
  const currentIsFormula = current.relation === "formula_dependency";
  if (currentIsFormula && !candidateIsFormula) return true;
  return false;
}
function dedupeGenerateTreeEdges(edges) {
  const orderedKeys = [];
  const edgeByPair = /* @__PURE__ */ new Map();
  for (const edge of edges) {
    const sourceNodeId = typeof edge.sourceNodeId === "string" ? edge.sourceNodeId : "";
    const targetNodeId = typeof edge.targetNodeId === "string" ? edge.targetNodeId : "";
    const key = `${sourceNodeId}\0${targetNodeId}`;
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
function orientGenerateTreeEdgesFromRoot(output) {
  if (validateGenerateTreeGraph(output).valid) return output;
  const rootId = typeof output.rootNodeId === "string" ? output.rootNodeId : "";
  const nodes = isObjectArray(output.nodes) ? output.nodes : [];
  const edges = isObjectArray(output.edges) ? output.edges : [];
  const nodeTypes = /* @__PURE__ */ new Map();
  const nodeIds = /* @__PURE__ */ new Set();
  for (const node of nodes) {
    if (typeof node.id !== "string" || node.id.length === 0) continue;
    nodeIds.add(node.id);
    nodeTypes.set(node.id, node.type);
  }
  if (!rootId || !nodeIds.has(rootId) || edges.length === 0) return output;
  const neighbors = /* @__PURE__ */ new Map();
  for (const edge of edges) {
    const sourceNodeId = typeof edge.sourceNodeId === "string" ? edge.sourceNodeId : "";
    const targetNodeId = typeof edge.targetNodeId === "string" ? edge.targetNodeId : "";
    if (!nodeIds.has(sourceNodeId) || !nodeIds.has(targetNodeId)) return output;
    neighbors.set(sourceNodeId, [...neighbors.get(sourceNodeId) ?? [], targetNodeId]);
    neighbors.set(targetNodeId, [...neighbors.get(targetNodeId) ?? [], sourceNodeId]);
  }
  const depth = /* @__PURE__ */ new Map([[rootId, 0]]);
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
    const sourceDepth = typeof edge.sourceNodeId === "string" ? depth.get(edge.sourceNodeId) : void 0;
    const targetDepth = typeof edge.targetNodeId === "string" ? depth.get(edge.targetNodeId) : void 0;
    if (sourceDepth === void 0 || targetDepth === void 0 || sourceDepth <= targetDepth) return edge;
    return {
      ...edge,
      sourceNodeId: edge.targetNodeId,
      targetNodeId: edge.sourceNodeId
    };
  });
  const normalized = { ...output, edges: dedupeGenerateTreeEdges(orientedEdges) };
  return validateGenerateTreeGraph(normalized).valid ? normalized : output;
}
function normalizeRegisteredSchemaOutput(schemaId, output) {
  if (schemaId === "generate-tree-v1" && isRecord(output)) return orientGenerateTreeEdgesFromRoot(output);
  return output;
}
var jsonSchemas = {
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
function getRegisteredJsonSchema(schemaId) {
  return jsonSchemas[schemaId];
}
function toStrictResponseJsonSchema(schema) {
  if (Array.isArray(schema)) {
    return schema.map((entry) => toStrictResponseJsonSchema(entry));
  }
  if (!isRecord(schema)) {
    return schema;
  }
  const result = {};
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
function getStrictResponseJsonSchema(schemaId) {
  return toStrictResponseJsonSchema(jsonSchemas[schemaId]);
}
var validators = {
  "connection-test-v1": (output) => output.ok === true,
  "generate-tree-v1": (output) => typeof output.projectTitle === "string" && typeof output.rootNodeId === "string" && isObjectArray(output.nodes) && output.nodes.length > 0 && isObjectArray(output.edges) && validateAdvisoryArrays(output) && validateGenerateTreeGraph(output).valid,
  "deepen-node-v1": (output) => typeof output.targetNodeId === "string" && isObjectArray(output.nodes) && output.nodes.length > 0 && isObjectArray(output.edges) && validateAdvisoryArrays(output),
  "simplify-branch-v1": (output) => typeof output.branchRootNodeId === "string" && isObjectArray(output.nodeRemovals) && isObjectArray(output.edgeChanges) && typeof output.rationale === "string" && validateAdvisoryArrays(output),
  "suggest-alternative-v1": (output) => typeof output.targetNodeId === "string" && isObjectArray(output.nodes) && output.nodes.length > 0 && isObjectArray(output.edges) && typeof output.rationale === "string" && validateAdvisoryArrays(output),
  "suggest-formula-v1": (output) => typeof output.nodeId === "string" && typeof output.proposedFormula === "string" && typeof output.aiRationale === "string" && typeof output.confidence === "number" && validateAdvisoryArrays(output),
  "review-model-v1": (output) => isObjectArray(output.findings) && validateAdvisoryArrays(output),
  "check-units-v1": (output) => isObjectArray(output.unitFindings) && validateAdvisoryArrays(output),
  "identify-missing-drivers-v1": (output) => isObjectArray(output.missingDrivers) && validateAdvisoryArrays(output),
  "identify-duplicate-drivers-v1": (output) => isObjectArray(output.duplicateClusters) && validateAdvisoryArrays(output),
  "explain-node-v1": (output) => typeof output.nodeId === "string" && typeof output.explanation === "string" && isStringArray(output.keyDrivers) && isStringArray(output.assumptions) && isStringArray(output.questionsForUser),
  "explain-scenario-v1": (output) => typeof output.scenarioId === "string" && typeof output.narrative === "string" && isObjectArray(output.impactHighlights) && isStringArray(output.assumptions) && isStringArray(output.questionsForUser),
  "generate-executive-summary-v1": (output) => typeof output.headline === "string" && isStringArray(output.keyDrivers) && isStringArray(output.risks) && isStringArray(output.recommendations)
};
function validateRegisteredSchema(schemaId, output) {
  if (!isRecord(output)) return false;
  const schema = jsonSchemas[schemaId];
  if (!schema || !hasRequiredKeys(output, schema.required ?? [])) return false;
  return validators[schemaId](output) && validateJsonSchemaSubset(schema, output).valid;
}
function validateRegisteredSchemaDetailed(schemaId, output) {
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
function validateJsonSchemaSubset(schema, value, path6 = "$") {
  if (!isRecord(schema)) return { valid: true, errors: [] };
  if (Array.isArray(schema.anyOf)) {
    const branchResults = schema.anyOf.map((branch) => validateJsonSchemaSubset(branch, value, path6));
    if (branchResults.some((result) => result.valid)) {
      return { valid: true, errors: [] };
    }
    return {
      valid: false,
      errors: branchResults.flatMap((result) => result.errors).slice(0, 12)
    };
  }
  const errors = [];
  const type = schema.type;
  if (type === "object") {
    if (!isRecord(value)) {
      return { valid: false, errors: [`${path6} must be an object.`] };
    }
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required.filter((key) => typeof key === "string") : [];
    for (const key of required) {
      if (!(key in value)) errors.push(`${path6}.${key} is required.`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) errors.push(`${path6}.${key} is not an approved field.`);
      }
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (key in value) errors.push(...validateJsonSchemaSubset(propertySchema, value[key], `${path6}.${key}`).errors);
    }
  } else if (type === "array") {
    if (!Array.isArray(value)) {
      return { valid: false, errors: [`${path6} must be an array.`] };
    }
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push(`${path6} must contain at least ${schema.minItems} item(s).`);
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      errors.push(`${path6} must contain at most ${schema.maxItems} item(s).`);
    }
    value.forEach((item, index) => {
      errors.push(...validateJsonSchemaSubset(schema.items, item, `${path6}[${index}]`).errors);
    });
  } else if (type === "string") {
    if (typeof value !== "string") {
      return { valid: false, errors: [`${path6} must be a string.`] };
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      errors.push(`${path6} must be at most ${schema.maxLength} character(s).`);
    }
  } else if (type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { valid: false, errors: [`${path6} must be a finite number.`] };
    }
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push(`${path6} must be at least ${schema.minimum}.`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      errors.push(`${path6} must be at most ${schema.maximum}.`);
    }
  } else if (type === "boolean") {
    if (typeof value !== "boolean") {
      return { valid: false, errors: [`${path6} must be a boolean.`] };
    }
  }
  if ("const" in schema && value !== schema.const) errors.push(`${path6} must equal ${String(schema.const)}.`);
  return { valid: errors.length === 0, errors };
}

// ../model-bridge/src/subscription-cli/security.ts
var DANGEROUS_CLI_FLAG_PATTERNS = Object.freeze([
  /^--?force(?:=|$)/i,
  /^--?trust(?:[-=]|$)/i,
  /^--?yolo(?:=|$)/i,
  /^--?allow-all(?:-tools)?(?:=|$)/i,
  /^--?bypass[_-]?permissions(?:=|$)/i,
  /^--?dangerously(?:-auto-approve|-autoapprove|AutoApprove)?(?:=|$)/i,
  /^--dangerouslyAutoApprove(?:=|$)/i,
  /^--?dangerous(?:ly)?(?:-auto-approve|-autoapprove)?(?:=|$)/i,
  /^--?workspace[_-]?trust(?:=|$)/i,
  /^--?allow[_-]?all[_-]?tools(?:=|$)/i,
  /^bypass[_-]?permissions$/i,
  /^dangerously(?:autoapprove|auto[_-]?approve)?$/i,
  /^allow[_-]?all(?:[_-]?tools)?$/i,
  /^yolo$/i
]);
function assertArgsSafe(args, options = {}) {
  for (const arg of args) {
    if (arg.includes("\0")) {
      throw Object.assign(new Error("Forbidden CLI argument contains a NUL byte."), {
        code: "UNSAFE_CLI_ARGS",
        arg,
        pattern: "NUL"
      });
    }
    if (arg.split(/[\\/]+/).includes("..")) {
      throw Object.assign(new Error(`Forbidden CLI argument contains path traversal: ${arg}`), {
        code: "UNSAFE_CLI_ARGS",
        arg,
        pattern: "path-traversal"
      });
    }
    for (const pattern of DANGEROUS_CLI_FLAG_PATTERNS) {
      if (options.allowScopedTrust === true && arg === "--trust" && pattern.test(arg)) continue;
      if (pattern.test(arg)) {
        throw Object.assign(new Error(`Forbidden CLI argument: ${arg}`), {
          code: "UNSAFE_CLI_ARGS",
          arg,
          pattern: pattern.source
        });
      }
    }
  }
}

// ../model-bridge/src/subscription-cli/claude/auth.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// ../model-bridge/src/subscription-cli/claude/parser.ts
var DEFAULT_CLAUDE_JSON_PARSE_LIMITS = Object.freeze({
  maxBytes: 4 * 1024 * 1024
});
var byteLength2 = (value) => Buffer.byteLength(value, "utf8");
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseClaudeJsonOutput(stdout, stderr, limits = DEFAULT_CLAUDE_JSON_PARSE_LIMITS) {
  if (!Number.isSafeInteger(limits.maxBytes) || limits.maxBytes <= 0) {
    throw new Error("maxBytes must be a positive integer.");
  }
  if (byteLength2(stdout) > limits.maxBytes) {
    throw new Error(`Claude JSON output exceeds ${limits.maxBytes} bytes.`);
  }
  const combinedError = `${stdout}
${stderr}`.trim();
  if (/auth|login|sign[\s-]?in|not logged in/i.test(combinedError)) {
    return { output: void 0, error: stderr.trim() || "Claude Code authentication required." };
  }
  if (/quota|usage limit|rate.?limit|billing/i.test(combinedError)) {
    return { output: void 0, error: stderr.trim() || "Claude Code usage limit reached." };
  }
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { output: void 0, error: stderr.trim() || "Claude Code produced no stdout." };
  }
  let envelope;
  try {
    envelope = JSON.parse(trimmed);
  } catch {
    try {
      return { output: extractBoundedJson(trimmed, limits.maxBytes), rawText: trimmed };
    } catch {
      return { output: void 0, error: stderr.trim() || "Claude Code output was not valid JSON." };
    }
  }
  if (!isRecord2(envelope)) {
    return { output: void 0, error: "Claude Code JSON envelope was not an object." };
  }
  if (envelope.is_error === true || envelope.subtype === "error") {
    const message = typeof envelope.result === "string" && envelope.result.trim() ? envelope.result : typeof envelope.error === "string" ? envelope.error : "Claude Code completed with an error result.";
    return { output: void 0, error: message };
  }
  if (envelope.structured_output !== void 0) {
    return { output: envelope.structured_output, rawText: trimmed };
  }
  if (typeof envelope.result === "string" && envelope.result.trim()) {
    try {
      return { output: extractBoundedJson(envelope.result, limits.maxBytes), rawText: envelope.result };
    } catch {
      return { output: envelope.result, rawText: envelope.result };
    }
  }
  return { output: void 0, error: "Claude Code JSON response did not include structured output." };
}

// ../model-bridge/src/subscription-cli/claude/auth.ts
var execFileAsync = promisify(execFile);
var CLAUDE_CONNECTION_TEST_PROMPT = 'Respond with only valid JSON matching {"ok":true}. No markdown, commentary, or extra keys.';
function classifyAuthFailure(stderr, stdout, exitCode) {
  const haystack = `${stderr}
${stdout}`.toLowerCase();
  if (/rate.?limit|quota|too many requests|429|usage limit|billing/.test(haystack)) return "rate_limited";
  if (/login|sign.?in|authenticate|authentication|not logged|claude pro/.test(haystack)) return "authentication_required";
  if (exitCode === 0) return "error";
  return "error";
}
function authSummaryForStatus(status) {
  switch (status) {
    case "ready":
      return "Claude subscription is authenticated and ready.";
    case "authentication_required":
      return "Claude Pro sign-in required. Run `claude login` in a terminal.";
    case "rate_limited":
      return "Claude usage limit reached. Try again later.";
    case "unsupported_version":
      return "Claude Code version is not supported.";
    case "installed":
      return "Claude Code is installed; authentication was not verified.";
    case "error":
      return "Claude Code connection probe failed.";
    default:
      return "Claude Code status is unknown.";
  }
}
function parseStatusJson(stdout) {
  try {
    const payload = JSON.parse(stdout.trim());
    if (typeof payload !== "object" || payload === null) return void 0;
    const record = payload;
    const loggedIn = record.loggedIn ?? record.logged_in ?? record.authenticated ?? record.isAuthenticated;
    if (loggedIn === true) return "ready";
    if (loggedIn === false) return "authentication_required";
    const status = typeof record.status === "string" ? record.status.toLowerCase() : "";
    if (status.includes("ready") || status.includes("authenticated") || status.includes("logged")) return "ready";
    if (status.includes("login") || status.includes("auth")) return "authentication_required";
    if (status.includes("rate")) return "rate_limited";
    return void 0;
  } catch {
    return void 0;
  }
}
async function runExec(executable, args, options) {
  const execImpl = options.execFileImpl ?? execFileAsync;
  const execOptions = {
    encoding: "utf8",
    timeout: options.timeoutMs ?? 15e3,
    maxBuffer: 512 * 1024,
    windowsHide: true,
    shell: false,
    signal: options.signal
  };
  const result = await execImpl(executable, [...args], execOptions);
  return { stdout: result.stdout, stderr: result.stderr };
}
async function probeWithStatusCommand(executable, options) {
  try {
    const result = await runExec(executable, ["auth", "status", "--json"], options);
    const mapped = parseStatusJson(result.stdout) ?? (result.stderr ? classifyAuthFailure(result.stderr, result.stdout, 0) : "ready");
    return {
      backendId: CLAUDE_BACKEND_ID,
      status: mapped,
      authSummary: authSummaryForStatus(mapped),
      diagnostics: mapped === "ready" ? [] : [result.stderr.trim() || result.stdout.trim()].filter(Boolean)
    };
  } catch (error2) {
    const execError = error2;
    if (execError.code === "ENOENT" || /unknown command|invalid command|unrecognized|not found/i.test(String(execError.stderr ?? execError.message))) {
      return null;
    }
    const stderr = execError.stderr ?? "";
    const stdout = execError.stdout ?? "";
    const status = classifyAuthFailure(stderr, stdout, typeof execError.code === "number" ? execError.code : void 0);
    return {
      backendId: CLAUDE_BACKEND_ID,
      status,
      authSummary: authSummaryForStatus(status),
      diagnostics: [stderr.trim() || execError.message || "Claude status probe failed."].filter(Boolean)
    };
  }
}
async function probeWithConnectionTest(executable, options) {
  try {
    const result = await runExec(
      executable,
      [
        "-p",
        "--output-format",
        "json",
        "--no-session-persistence",
        "--tools",
        "",
        "--disallowedTools",
        "*",
        "--strict-mcp-config",
        CLAUDE_CONNECTION_TEST_PROMPT
      ],
      options
    );
    const parsed = parseClaudeJsonOutput(result.stdout, result.stderr);
    if (parsed.error) {
      const status = classifyAuthFailure(result.stderr, `${result.stdout}
${parsed.error}`);
      return {
        backendId: CLAUDE_BACKEND_ID,
        status,
        authSummary: authSummaryForStatus(status),
        diagnostics: [parsed.error, result.stderr.trim()].filter(Boolean)
      };
    }
    if (validateRegisteredSchema("connection-test-v1", parsed.output)) {
      return {
        backendId: CLAUDE_BACKEND_ID,
        status: "ready",
        authSummary: authSummaryForStatus("ready"),
        diagnostics: []
      };
    }
    return {
      backendId: CLAUDE_BACKEND_ID,
      status: "error",
      authSummary: authSummaryForStatus("error"),
      diagnostics: ["Claude connection test did not return { ok: true } JSON."]
    };
  } catch (error2) {
    const execError = error2;
    const stderr = execError.stderr ?? "";
    const stdout = execError.stdout ?? "";
    const status = classifyAuthFailure(stderr, stdout, typeof execError.code === "number" ? execError.code : void 0);
    return {
      backendId: CLAUDE_BACKEND_ID,
      status,
      authSummary: authSummaryForStatus(status),
      diagnostics: [stderr.trim() || execError.message || "Claude connection test failed."].filter(Boolean)
    };
  }
}
async function probeClaudeAuth(executable, options = {}) {
  if (options.versionStatus?.status === "unsupported_version") {
    return {
      backendId: CLAUDE_BACKEND_ID,
      status: "unsupported_version",
      authSummary: authSummaryForStatus("unsupported_version"),
      diagnostics: [...options.versionStatus.diagnostics]
    };
  }
  const statusProbe = await probeWithStatusCommand(executable, options);
  if (statusProbe) return statusProbe;
  return probeWithConnectionTest(executable, options);
}

// ../model-bridge/src/subscription-cli/claude/version.ts
var CLAUDE_CLI_MIN_VERSION = "1.0.0";
var SEMVER_PATTERN = /(\d+)\.(\d+)\.(\d+)/;
function parseClaudeVersionOutput(output) {
  const raw = output.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (!raw) return null;
  const match = raw.match(SEMVER_PATTERN);
  if (!match) return { raw };
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isFinite)) return { raw };
  return { raw, semver: `${major}.${minor}.${patch}`, major, minor, patch };
}
function compareSemver(a, b) {
  for (const key of ["major", "minor", "patch"]) {
    const left = a[key] ?? 0;
    const right = b[key] ?? 0;
    if (left !== right) return left - right;
  }
  return 0;
}
function evaluateClaudeVersion(version) {
  if (!version) {
    return {
      supported: false,
      status: "installed",
      diagnostics: ["Claude Code is installed, but the version could not be determined."]
    };
  }
  const parsed = parseClaudeVersionOutput(version);
  if (!parsed?.semver) {
    return {
      supported: false,
      status: "installed",
      diagnostics: [
        `Claude Code version "${parsed?.raw ?? version}" is not a recognized semver; compatibility is unknown.`
      ]
    };
  }
  const minimum = parseClaudeVersionOutput(CLAUDE_CLI_MIN_VERSION);
  if (!minimum?.semver) {
    return { supported: true, status: "installed", diagnostics: [] };
  }
  if (compareSemver(parsed, minimum) < 0) {
    return {
      supported: false,
      status: "unsupported_version",
      diagnostics: [
        `Claude Code ${parsed.semver} is below the minimum supported version ${CLAUDE_CLI_MIN_VERSION}.`
      ]
    };
  }
  return { supported: true, status: "installed", diagnostics: [] };
}

// ../model-bridge/src/subscription-cli/claude/adapter.ts
var CLAUDE_BACKEND_ID = "claude_subscription";
function buildClaudeDynamicArgs(input) {
  const args = [];
  if (input.model) args.push("--model", input.model);
  if (input.schemaPath) args.push("--json-schema", input.schemaPath);
  const prompt = input.promptText?.trim();
  if (!prompt) throw Object.assign(new Error("Claude subscription prompt text is required."), { code: "PROMPT_REQUIRED" });
  args.push(prompt);
  assertArgsSafe(args);
  return Object.freeze(args);
}
function mapClaudeError(message) {
  if (/auth|login|sign[\s-]?in|not logged in/i.test(message)) return "AUTH_REQUIRED";
  if (/quota|usage limit|rate.?limit|billing/i.test(message)) return "RATE_LIMITED";
  return "BACKEND_PARSE_FAILED";
}
var claudeSubscriptionCliAdapter = {
  id: "claude",
  backendId: CLAUDE_BACKEND_ID,
  buildArgs(input) {
    return buildClaudeDynamicArgs(input);
  },
  parseOutput(stdout, stderr, _schemaId) {
    const parsed = parseClaudeJsonOutput(stdout, stderr);
    if (parsed.error) {
      throw Object.assign(new Error(parsed.error), { code: mapClaudeError(parsed.error) });
    }
    if (parsed.output === void 0) {
      throw Object.assign(new Error("Claude Code output did not contain structured JSON."), { code: "BACKEND_PARSE_FAILED" });
    }
    return parsed.output;
  },
  async probeAuth(executable, signal) {
    return testClaudeConnection(executable, signal);
  }
};
async function testClaudeConnection(executable, signal) {
  let version = null;
  try {
    const { execFile: execFile8 } = await import("node:child_process");
    const { promisify: promisify8 } = await import("node:util");
    const result = await promisify8(execFile8)(executable, ["--version"], {
      encoding: "utf8",
      timeout: 5e3,
      maxBuffer: 64 * 1024,
      windowsHide: true,
      shell: false,
      signal
    });
    version = parseClaudeVersionOutput(`${result.stdout}
${result.stderr}`.trim())?.raw ?? null;
  } catch {
    version = null;
  }
  return probeClaudeAuth(executable, {
    ...signal ? { signal } : {},
    versionStatus: evaluateClaudeVersion(version)
  });
}

// ../model-bridge/src/subscription-cli/codex/auth.ts
import { execFile as execFile2 } from "node:child_process";
import { promisify as promisify2 } from "node:util";

// ../model-bridge/src/subscription-cli/codex/constants.ts
var CODEX_BACKEND_ID = "codex_subscription";
var CODEX_CHATGPT_DEFAULT_MODEL = "gpt-5.5";
var CODEX_FAST_SERVICE_TIER_ARGS = Object.freeze(["-c", 'service_tier="fast"']);

// ../model-bridge/src/subscription-cli/codex/parser.ts
var DEFAULT_CODEX_EXEC_PARSE_LIMITS = Object.freeze({
  maxBytes: 4 * 1024 * 1024,
  maxLines: 1e5
});
var byteLength3 = (value) => Buffer.byteLength(value, "utf8");
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isCodexStreamEvent(value) {
  const type = value.type;
  return type === "thread.started" || type === "turn.started" || type === "turn.completed" || type === "turn.failed" || type === "item.started" || type === "item.updated" || type === "item.completed" || type === "error";
}
function agentMessageText(item) {
  const itemType = item.type ?? item.item_type;
  if (itemType !== "agent_message" && itemType !== "assistant_message") return void 0;
  return typeof item.text === "string" ? item.text : void 0;
}
function extractStructuredCandidate(value) {
  if (isCodexStreamEvent(value)) return void 0;
  if ("ok" in value || "projectTitle" in value || "rootNodeId" in value) return value;
  return void 0;
}
function parseCodexExecJson(stdout, stderr, limits = DEFAULT_CODEX_EXEC_PARSE_LIMITS) {
  if (!Number.isSafeInteger(limits.maxBytes) || limits.maxBytes <= 0) {
    throw new Error("maxBytes must be a positive integer.");
  }
  if (!Number.isSafeInteger(limits.maxLines) || limits.maxLines <= 0) {
    throw new Error("maxLines must be a positive integer.");
  }
  if (byteLength3(stdout) > limits.maxBytes) {
    throw new Error(`Codex exec output exceeds ${limits.maxBytes} bytes.`);
  }
  const combinedError = `${stdout}
${stderr}`.trim();
  if (/auth|login|sign[\s-]?in|not logged in/i.test(combinedError) && !/"ok"\s*:\s*true/.test(stdout)) {
    return { output: void 0, error: stderr.trim() || "Codex authentication required." };
  }
  if (/quota|usage limit|rate.?limit/i.test(combinedError) && !/"ok"\s*:\s*true/.test(stdout)) {
    return { output: void 0, error: stderr.trim() || "Codex usage limit reached." };
  }
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { output: void 0, error: stderr.trim() || "Codex exec produced no stdout." };
  }
  try {
    const direct = JSON.parse(trimmed);
    if (isRecord3(direct)) {
      const candidate = extractStructuredCandidate(direct);
      if (candidate !== void 0) return { output: candidate, rawText: trimmed };
    }
  } catch {
  }
  let lineCount = 0;
  let terminalError;
  let lastAgentText;
  let lastStructured;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    lineCount += 1;
    if (lineCount > limits.maxLines) {
      throw new Error(`Codex exec output exceeds ${limits.maxLines} lines.`);
    }
    if (byteLength3(line) > limits.maxBytes) {
      throw new Error(`Codex exec line exceeds ${limits.maxBytes} bytes.`);
    }
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord3(event)) continue;
    if (event.type === "error") {
      terminalError = typeof event.message === "string" ? event.message : typeof event.error === "string" ? event.error : "Codex exec reported an error event.";
      continue;
    }
    if (event.type === "turn.failed") {
      const nested = isRecord3(event.error) && typeof event.error.message === "string" ? event.error.message : void 0;
      terminalError = nested ?? "Codex exec turn failed.";
      continue;
    }
    const structured = extractStructuredCandidate(event);
    if (structured !== void 0) {
      lastStructured = structured;
      continue;
    }
    if (event.type === "item.completed" && isRecord3(event.item)) {
      const text = agentMessageText(event.item);
      if (text) lastAgentText = text;
    }
  }
  if (terminalError) return { output: void 0, error: terminalError };
  if (lastStructured !== void 0) {
    return { output: lastStructured, rawText: JSON.stringify(lastStructured) };
  }
  if (lastAgentText) {
    try {
      return { output: extractBoundedJson(lastAgentText, limits.maxBytes), rawText: lastAgentText };
    } catch {
      return { output: void 0, rawText: lastAgentText, error: "Codex agent message did not contain structured JSON." };
    }
  }
  try {
    return { output: extractBoundedJson(trimmed, limits.maxBytes), rawText: trimmed };
  } catch {
    return { output: void 0, error: stderr.trim() || "Codex exec output did not contain structured JSON." };
  }
}

// ../model-bridge/src/subscription-cli/codex/auth.ts
var execFileAsync2 = promisify2(execFile2);
var CODEX_CONNECTION_TEST_PROMPT = 'Respond with only valid JSON matching {"ok":true}. No markdown, commentary, or extra keys.';
function classifyAuthFailure2(stderr, stdout, exitCode) {
  const haystack = `${stderr}
${stdout}`.toLowerCase();
  if (/rate.?limit|quota|too many requests|429|usage limit/.test(haystack)) return "rate_limited";
  if (/login|sign.?in|authenticate|authentication|not logged|chatgpt/.test(haystack)) return "authentication_required";
  if (exitCode === 0) return "error";
  return "error";
}
function authSummaryForStatus2(status) {
  switch (status) {
    case "ready":
      return "ChatGPT subscription is authenticated and ready.";
    case "authentication_required":
      return "ChatGPT sign-in required. Run `codex login` in a terminal.";
    case "rate_limited":
      return "Codex usage limit reached. Try again later.";
    case "unsupported_version":
      return "Codex CLI version is not supported.";
    case "installed":
      return "Codex CLI is installed; authentication was not verified.";
    case "error":
      return "Codex connection probe failed.";
    default:
      return "Codex CLI status is unknown.";
  }
}
function parseStatusJson2(stdout) {
  try {
    const payload = JSON.parse(stdout.trim());
    if (typeof payload !== "object" || payload === null) return void 0;
    const record = payload;
    const loggedIn = record.loggedIn ?? record.logged_in ?? record.authenticated ?? record.isAuthenticated;
    if (loggedIn === true) return "ready";
    if (loggedIn === false) return "authentication_required";
    const status = typeof record.status === "string" ? record.status.toLowerCase() : "";
    if (status.includes("ready") || status.includes("authenticated") || status.includes("logged")) return "ready";
    if (status.includes("login") || status.includes("auth")) return "authentication_required";
    if (status.includes("rate")) return "rate_limited";
    return void 0;
  } catch {
    return void 0;
  }
}
function parseStatusText(output) {
  const text = output.toLowerCase();
  if (/logged in|authenticated|using chatgpt/.test(text)) return "ready";
  if (/not logged|log in|login required|sign.?in|authenticate/.test(text)) return "authentication_required";
  if (/rate.?limit|quota|usage limit/.test(text)) return "rate_limited";
  return void 0;
}
function isUnsupportedJsonFlag(error2) {
  const text = `${error2.stderr ?? ""}
${error2.stdout ?? ""}
${error2.message ?? ""}`;
  return /unexpected argument '--json'|unknown option.*--json|unrecognized.*--json/i.test(text);
}
function isLegacyServiceTierConfigError(error2) {
  const text = `${error2.stderr ?? ""}
${error2.stdout ?? ""}
${error2.message ?? ""}`;
  return /service_tier|unknown variant `default`|unknown variant "default"/i.test(text);
}
async function runExec2(executable, args, options, input) {
  const execImpl = options.execFileImpl ?? execFileAsync2;
  const execOptions = {
    encoding: "utf8",
    timeout: options.timeoutMs ?? 15e3,
    maxBuffer: 512 * 1024,
    windowsHide: true,
    shell: false,
    signal: options.signal,
    ...input === void 0 ? {} : { input }
  };
  const result = await execImpl(executable, [...args], execOptions);
  return { stdout: result.stdout, stderr: result.stderr };
}
async function runExecWithConfigFallback(executable, args, options, input) {
  try {
    return await runExec2(executable, args, options, input);
  } catch (error2) {
    const execError = error2;
    if (!isLegacyServiceTierConfigError(execError)) throw error2;
    return runExec2(executable, [...args, ...CODEX_FAST_SERVICE_TIER_ARGS], options, input);
  }
}
async function probeWithStatusCommand2(executable, options) {
  try {
    const result = await runExecWithConfigFallback(executable, ["login", "status", "--json"], options);
    const mapped = parseStatusJson2(result.stdout) ?? parseStatusText(`${result.stdout}
${result.stderr}`) ?? (result.stderr ? classifyAuthFailure2(result.stderr, result.stdout, 0) : "ready");
    return {
      backendId: CODEX_BACKEND_ID,
      status: mapped,
      authSummary: authSummaryForStatus2(mapped),
      diagnostics: mapped === "ready" ? [] : [result.stderr.trim() || result.stdout.trim()].filter(Boolean)
    };
  } catch (error2) {
    const execError = error2;
    if (isUnsupportedJsonFlag(execError)) {
      try {
        const result = await runExecWithConfigFallback(executable, ["login", "status"], options);
        const mapped = parseStatusText(`${result.stdout}
${result.stderr}`) ?? parseStatusJson2(result.stdout) ?? (result.stderr ? classifyAuthFailure2(result.stderr, result.stdout, 0) : "ready");
        return {
          backendId: CODEX_BACKEND_ID,
          status: mapped,
          authSummary: authSummaryForStatus2(mapped),
          diagnostics: mapped === "ready" ? [] : [result.stderr.trim() || result.stdout.trim()].filter(Boolean)
        };
      } catch (fallbackError) {
        const fallbackExecError = fallbackError;
        const stderr2 = fallbackExecError.stderr ?? "";
        const stdout2 = fallbackExecError.stdout ?? "";
        const status2 = classifyAuthFailure2(stderr2, stdout2, typeof fallbackExecError.code === "number" ? fallbackExecError.code : void 0);
        return {
          backendId: CODEX_BACKEND_ID,
          status: status2,
          authSummary: authSummaryForStatus2(status2),
          diagnostics: [stderr2.trim() || fallbackExecError.message || "Codex status probe failed."].filter(Boolean)
        };
      }
    }
    if (execError.code === "ENOENT" || /unknown command|invalid command|unrecognized|not a codex command/i.test(String(execError.stderr ?? execError.message))) {
      return null;
    }
    const stderr = execError.stderr ?? "";
    const stdout = execError.stdout ?? "";
    const status = classifyAuthFailure2(stderr, stdout, typeof execError.code === "number" ? execError.code : void 0);
    return {
      backendId: CODEX_BACKEND_ID,
      status,
      authSummary: authSummaryForStatus2(status),
      diagnostics: [stderr.trim() || execError.message || "Codex status probe failed."].filter(Boolean)
    };
  }
}
async function probeWithConnectionTest2(executable, options) {
  try {
    const result = await runExecWithConfigFallback(
      executable,
      [
        "exec",
        "--ephemeral",
        "--json",
        "--color",
        "never",
        "--skip-git-repo-check",
        "--ignore-rules",
        "--sandbox",
        "workspace-write",
        "--model",
        CODEX_CHATGPT_DEFAULT_MODEL,
        "-c",
        "sandbox_workspace_write.network_access=true",
        ...CODEX_FAST_SERVICE_TIER_ARGS
      ],
      options,
      CODEX_CONNECTION_TEST_PROMPT
    );
    const parsed = parseCodexExecJson(result.stdout, result.stderr);
    if (parsed.error) {
      const status = classifyAuthFailure2(result.stderr, `${result.stdout}
${parsed.error}`);
      return {
        backendId: CODEX_BACKEND_ID,
        status,
        authSummary: authSummaryForStatus2(status),
        diagnostics: [parsed.error, result.stderr.trim()].filter(Boolean)
      };
    }
    if (validateRegisteredSchema("connection-test-v1", parsed.output)) {
      return {
        backendId: CODEX_BACKEND_ID,
        status: "ready",
        authSummary: authSummaryForStatus2("ready"),
        diagnostics: []
      };
    }
    return {
      backendId: CODEX_BACKEND_ID,
      status: "error",
      authSummary: authSummaryForStatus2("error"),
      diagnostics: ["Codex connection test did not return { ok: true } JSON."]
    };
  } catch (error2) {
    const execError = error2;
    const stderr = execError.stderr ?? "";
    const stdout = execError.stdout ?? "";
    const status = classifyAuthFailure2(stderr, stdout, typeof execError.code === "number" ? execError.code : void 0);
    return {
      backendId: CODEX_BACKEND_ID,
      status,
      authSummary: authSummaryForStatus2(status),
      diagnostics: [stderr.trim() || execError.message || "Codex connection test failed."].filter(Boolean)
    };
  }
}
async function probeCodexAuth(executable, options = {}) {
  if (options.versionStatus?.status === "unsupported_version") {
    return {
      backendId: CODEX_BACKEND_ID,
      status: "unsupported_version",
      authSummary: authSummaryForStatus2("unsupported_version"),
      diagnostics: [...options.versionStatus.diagnostics]
    };
  }
  const statusProbe = await probeWithStatusCommand2(executable, options);
  if (statusProbe) return statusProbe;
  return probeWithConnectionTest2(executable, options);
}

// ../model-bridge/src/subscription-cli/codex/version.ts
var CODEX_CLI_MIN_VERSION = "0.20.0";
var SEMVER_PATTERN2 = /(\d+)\.(\d+)\.(\d+)/;
function parseCodexVersionOutput(output) {
  const raw = output.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (!raw) return null;
  const match = raw.match(SEMVER_PATTERN2);
  if (!match) return { raw };
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isFinite)) return { raw };
  return { raw, semver: `${major}.${minor}.${patch}`, major, minor, patch };
}
function compareSemver2(a, b) {
  for (const key of ["major", "minor", "patch"]) {
    const left = a[key] ?? 0;
    const right = b[key] ?? 0;
    if (left !== right) return left - right;
  }
  return 0;
}
function evaluateCodexVersion(version) {
  if (!version) {
    return {
      supported: false,
      status: "installed",
      diagnostics: ["Codex CLI is installed, but the version could not be determined."]
    };
  }
  const parsed = parseCodexVersionOutput(version);
  if (!parsed?.semver) {
    return {
      supported: false,
      status: "installed",
      diagnostics: [
        `Codex CLI version "${parsed?.raw ?? version}" is not a recognized semver; compatibility is unknown.`
      ]
    };
  }
  const minimum = parseCodexVersionOutput(CODEX_CLI_MIN_VERSION);
  if (!minimum?.semver) {
    return { supported: true, status: "installed", diagnostics: [] };
  }
  if (compareSemver2(parsed, minimum) < 0) {
    return {
      supported: false,
      status: "unsupported_version",
      diagnostics: [`Codex CLI ${parsed.semver} is below the minimum supported version ${CODEX_CLI_MIN_VERSION}.`]
    };
  }
  return { supported: true, status: "installed", diagnostics: [] };
}

// ../model-bridge/src/subscription-cli/codex/adapter.ts
function isRecord4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function extractModelId(value) {
  if (typeof value === "string") return value.trim() || void 0;
  if (!isRecord4(value)) return void 0;
  for (const key of ["slug", "id", "model", "name"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return void 0;
}
function parseCodexModelList(output) {
  const models = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (value) => {
    const model = extractModelId(value);
    if (model && !seen.has(model)) {
      seen.add(model);
      models.push(model);
    }
  };
  const trimmed = output.trim();
  if (!trimmed) return Object.freeze(models);
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      parsed.forEach(add);
      return Object.freeze(models);
    }
    if (isRecord4(parsed)) {
      const nested = parsed.models ?? parsed.data;
      if (Array.isArray(nested)) {
        nested.forEach(add);
        return Object.freeze(models);
      }
      add(parsed);
      return Object.freeze(models);
    }
  } catch {
  }
  for (const line of trimmed.split(/\r?\n/)) {
    const text = line.trim();
    if (!text || /^[-=\s]+$/.test(text)) continue;
    try {
      const parsed = JSON.parse(text);
      if (isRecord4(parsed) && Array.isArray(parsed.models)) {
        parsed.models.forEach(add);
      } else {
        add(parsed);
      }
      continue;
    } catch {
    }
    const firstToken = text.match(/^([a-zA-Z0-9][a-zA-Z0-9._:/-]*)\b/)?.[1];
    if (firstToken && !["model", "models", "name", "id", "warning", "warn", "error"].includes(firstToken.toLowerCase())) add(firstToken);
  }
  return Object.freeze(models);
}
function isSupportedCodexChatGptModel(model) {
  const normalized = model.toLowerCase();
  return !normalized.includes("-codex") && !normalized.includes("auto-review");
}
async function defaultExecFileProbe(executable, args, options) {
  const { execFile: execFile8 } = await import("node:child_process");
  const { promisify: promisify8 } = await import("node:util");
  const result = await promisify8(execFile8)(executable, [...args], options);
  return { stdout: result.stdout, stderr: result.stderr };
}
async function listCodexModels(executable, options = {}) {
  const execFile8 = options.execFile ?? defaultExecFileProbe;
  const execOptions = {
    encoding: "utf8",
    timeout: 1e4,
    maxBuffer: 512 * 1024,
    windowsHide: true,
    shell: false,
    ...options.signal ? { signal: options.signal } : {}
  };
  let result;
  try {
    result = await execFile8(executable, ["debug", "models"], execOptions);
  } catch (error2) {
    const text = error2 instanceof Error ? error2.message : String(error2);
    if (!/service_tier|unknown variant `default`|unknown variant "default"/i.test(text)) throw error2;
    result = await execFile8(executable, ["debug", "models", ...CODEX_FAST_SERVICE_TIER_ARGS], execOptions);
  }
  return parseCodexModelList(`${result.stdout}
${result.stderr}`).filter(isSupportedCodexChatGptModel);
}
function buildCodexDynamicArgs(input) {
  const args = [];
  if (input.cwd) args.push("-C", input.cwd);
  args.push("--model", input.model ?? CODEX_CHATGPT_DEFAULT_MODEL);
  if (input.schemaPath) args.push("--output-schema", input.schemaPath);
  if (input.outputPath) args.push("--output-last-message", input.outputPath);
  assertArgsSafe(args);
  return Object.freeze(args);
}
function mapCodexError(message) {
  if (/auth|login|sign[\s-]?in|not logged in/i.test(message)) return "AUTH_REQUIRED";
  if (/quota|usage limit|rate.?limit/i.test(message)) return "RATE_LIMITED";
  return "BACKEND_PARSE_FAILED";
}
var codexSubscriptionCliAdapter = {
  id: "codex",
  backendId: CODEX_BACKEND_ID,
  spawnHints: Object.freeze({ stdin: "prompt" }),
  buildArgs(input) {
    return buildCodexDynamicArgs(input);
  },
  parseOutput(stdout, stderr, _schemaId) {
    const parsed = parseCodexExecJson(stdout, stderr);
    if (parsed.error) {
      throw Object.assign(new Error(parsed.error), { code: mapCodexError(parsed.error) });
    }
    if (parsed.output === void 0) {
      throw Object.assign(new Error("Codex exec output did not contain structured JSON."), { code: "BACKEND_PARSE_FAILED" });
    }
    return parsed.output;
  },
  async probeAuth(executable, signal) {
    return testCodexConnection(executable, signal);
  },
  async listModels(executable, options) {
    return listCodexModels(executable, options);
  }
};
async function testCodexConnection(executable, signal) {
  let version = null;
  try {
    const { execFile: execFile8 } = await import("node:child_process");
    const { promisify: promisify8 } = await import("node:util");
    const result = await promisify8(execFile8)(executable, ["--version"], {
      encoding: "utf8",
      timeout: 5e3,
      maxBuffer: 64 * 1024,
      windowsHide: true,
      shell: false,
      signal
    });
    version = parseCodexVersionOutput(`${result.stdout}
${result.stderr}`.trim())?.raw ?? null;
  } catch {
    version = null;
  }
  return probeCodexAuth(executable, {
    ...signal ? { signal } : {},
    versionStatus: evaluateCodexVersion(version)
  });
}

// ../model-bridge/src/subscription-cli/cursor/adapter.ts
import path2 from "node:path";

// ../model-bridge/src/subscription-cli/cursor/auth.ts
import { execFile as execFile4 } from "node:child_process";
import { promisify as promisify4 } from "node:util";

// ../model-bridge/src/subscription-cli/cursor/parser.ts
var DEFAULT_CURSOR_STREAM_PARSE_LIMITS = Object.freeze({
  maxBytes: 4 * 1024 * 1024,
  maxLines: 1e5
});
var byteLength4 = (value) => Buffer.byteLength(value, "utf8");
function isRecord5(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function assistantText(event) {
  const message = event.message;
  if (!isRecord5(message) || !Array.isArray(message.content)) return void 0;
  const parts = message.content.map((part) => isRecord5(part) && typeof part.text === "string" ? part.text : "").join("");
  return parts || void 0;
}
function parseCursorStreamJson(stdout, limits = DEFAULT_CURSOR_STREAM_PARSE_LIMITS) {
  if (!Number.isSafeInteger(limits.maxBytes) || limits.maxBytes <= 0) {
    throw new Error("maxBytes must be a positive integer.");
  }
  if (!Number.isSafeInteger(limits.maxLines) || limits.maxLines <= 0) {
    throw new Error("maxLines must be a positive integer.");
  }
  if (byteLength4(stdout) > limits.maxBytes) {
    throw new Error(`Cursor stream output exceeds ${limits.maxBytes} bytes.`);
  }
  let lineCount = 0;
  let terminalResult;
  let terminalError;
  let lastAssistantText;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    lineCount += 1;
    if (lineCount > limits.maxLines) {
      throw new Error(`Cursor stream output exceeds ${limits.maxLines} lines.`);
    }
    if (byteLength4(line) > limits.maxBytes) {
      throw new Error(`Cursor stream line exceeds ${limits.maxBytes} bytes.`);
    }
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord5(event) || typeof event.type !== "string") continue;
    if (event.type === "assistant") {
      const text = assistantText(event);
      if (text) lastAssistantText = text;
      continue;
    }
    if (event.type === "error") {
      terminalError = typeof event.message === "string" ? event.message : typeof event.error === "string" ? event.error : "Cursor Agent reported an error event.";
      continue;
    }
    if (event.type === "done") {
      if (typeof event.error === "string") terminalError = event.error;
      continue;
    }
    if (event.type === "result") {
      terminalResult = event;
      if (event.is_error === true || event.subtype === "error") {
        terminalError = typeof event.result === "string" && event.result.trim() ? event.result : "Cursor Agent completed with an error result.";
      }
    }
  }
  if (terminalError) {
    return { output: void 0, error: terminalError };
  }
  if (!terminalResult) {
    if (lastAssistantText) {
      try {
        return { output: extractBoundedJson(lastAssistantText, limits.maxBytes), rawText: lastAssistantText };
      } catch {
        return { output: void 0, rawText: lastAssistantText, error: "Cursor stream ended without a terminal result event." };
      }
    }
    return { output: void 0, error: "Cursor stream did not contain a terminal result event." };
  }
  const rawText = typeof terminalResult.result === "string" ? terminalResult.result : void 0;
  if (!rawText?.trim()) {
    return { output: void 0, error: "Cursor result event did not include assistant text." };
  }
  try {
    return { output: extractBoundedJson(rawText, limits.maxBytes), rawText };
  } catch {
    return { output: rawText, rawText };
  }
}

// ../model-bridge/src/detection.ts
import { execFile as execFile3 } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify as promisify3 } from "node:util";
var SUBSCRIPTION_CLI_IDS = ["cursor-agent", "codex", "claude", "gemini", "copilot"];
var SUBSCRIPTION_CLI_DEFINITIONS = Object.freeze([
  { id: "cursor-agent", backendId: "cursor_subscription", aliases: ["agent", "cursor-agent", "cursor"], versionArgs: ["--version"] },
  { id: "codex", backendId: "codex_subscription", aliases: ["codex"], versionArgs: ["--version"] },
  { id: "claude", backendId: "claude_subscription", aliases: ["claude"], versionArgs: ["--version"] },
  { id: "gemini", backendId: "gemini_subscription", aliases: ["gemini"], versionArgs: ["--version"] },
  { id: "copilot", backendId: "copilot_subscription", aliases: ["copilot"], versionArgs: ["--version"] }
]);
var execFileAsync3 = promisify3(execFile3);
var definitions = new Map(SUBSCRIPTION_CLI_DEFINITIONS.map((definition) => [definition.id, definition]));
function isSubscriptionCliId(value) {
  return definitions.has(value);
}
var defaultExecutableCheck = async (candidate) => {
  try {
    await access(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
};
var defaultVersionProbe = async (executable, args) => {
  const result = await execFileAsync3(executable, [...args], {
    encoding: "utf8",
    timeout: 5e3,
    maxBuffer: 64 * 1024,
    windowsHide: true,
    shell: false
  });
  return { stdout: result.stdout, stderr: result.stderr };
};
async function findExecutableOnPath(aliases, options = {}) {
  const platform = options.platform ?? process.platform;
  const pathValue = options.path ?? process.env.PATH ?? "";
  const pathExt = options.pathExt ?? process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  const check = options.executableCheck ?? defaultExecutableCheck;
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const directories = pathValue.split(platform === "win32" ? ";" : ":").filter(Boolean);
  for (const alias of aliases) {
    if (pathApi.basename(alias) !== alias || alias === "." || alias === "..") continue;
    const extensions = platform === "win32" && pathApi.extname(alias) === "" ? ["", ...pathExt.split(";").map((value) => value.trim().toLowerCase()).filter(Boolean)] : [""];
    for (const directory of directories) {
      for (const extension of extensions) {
        const executable = pathApi.resolve(directory, `${alias}${extension}`);
        if (await check(executable)) return { executable, alias };
      }
    }
  }
  return null;
}
async function detectSubscriptionCli(id, options = {}) {
  const definition = definitions.get(id);
  if (!definition) throw new Error(`Unknown subscription CLI: ${id}`);
  const match = await findExecutableOnPath(definition.aliases, options);
  if (!match) return { id, backendId: definition.backendId, installed: false, executable: null, alias: null, version: null };
  try {
    const result = await (options.versionProbe ?? defaultVersionProbe)(match.executable, definition.versionArgs);
    const version = `${result.stdout}
${result.stderr}`.trim().split(/\r?\n/, 1)[0]?.trim() || null;
    return { id, backendId: definition.backendId, installed: true, executable: match.executable, alias: match.alias, version };
  } catch (error2) {
    return {
      id,
      backendId: definition.backendId,
      installed: true,
      executable: match.executable,
      alias: match.alias,
      version: null,
      error: error2 instanceof Error ? error2.message : String(error2)
    };
  }
}
async function detectSubscriptionClis(options = {}) {
  return Promise.all(SUBSCRIPTION_CLI_IDS.map((id) => detectSubscriptionCli(id, options)));
}

// ../model-bridge/src/subscription-cli/cursor/version.ts
var CURSOR_CLI_MIN_VERSION = "0.45.0";
var SEMVER_PATTERN3 = /(\d+)\.(\d+)\.(\d+)/;
function parseCursorVersionOutput(output) {
  const raw = output.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (!raw) return null;
  const match = raw.match(SEMVER_PATTERN3);
  if (!match) return { raw };
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isFinite)) return { raw };
  return { raw, semver: `${major}.${minor}.${patch}`, major, minor, patch };
}
function compareSemver3(a, b) {
  for (const key of ["major", "minor", "patch"]) {
    const left = a[key] ?? 0;
    const right = b[key] ?? 0;
    if (left !== right) return left - right;
  }
  return 0;
}
function evaluateCursorVersion(version) {
  if (!version) {
    return {
      supported: false,
      status: "installed",
      diagnostics: ["Cursor Agent is installed, but the CLI version could not be determined."]
    };
  }
  const parsed = parseCursorVersionOutput(version);
  if (!parsed?.semver) {
    return {
      supported: false,
      status: "installed",
      diagnostics: [
        `Cursor Agent version "${parsed?.raw ?? version}" is not a recognized semver; compatibility is unknown.`
      ]
    };
  }
  const minimum = parseCursorVersionOutput(CURSOR_CLI_MIN_VERSION);
  if (!minimum?.semver) {
    return { supported: true, status: "installed", diagnostics: [] };
  }
  if (compareSemver3(parsed, minimum) < 0) {
    return {
      supported: false,
      status: "unsupported_version",
      diagnostics: [
        `Cursor Agent ${parsed.semver} is below the minimum supported version ${CURSOR_CLI_MIN_VERSION}.`
      ]
    };
  }
  return { supported: true, status: "installed", diagnostics: [] };
}

// ../model-bridge/src/subscription-cli/cursor/detection.ts
var CURSOR_BACKEND_ID = "cursor_subscription";

// ../model-bridge/src/subscription-cli/cursor/auth.ts
var execFileAsync4 = promisify4(execFile4);
var CURSOR_CONNECTION_TEST_PROMPT = 'Respond with only valid JSON matching {"ok":true}. No markdown, commentary, or extra keys.';
function classifyAuthFailure3(stderr, stdout, exitCode) {
  const haystack = `${stderr}
${stdout}`.toLowerCase();
  if (/rate.?limit|quota|too many requests|429/.test(haystack)) return "rate_limited";
  if (/login|sign.?in|authenticate|authentication|not logged|api.?key/.test(haystack)) return "authentication_required";
  if (exitCode === 0) return "error";
  return "error";
}
function authSummaryForStatus3(status) {
  switch (status) {
    case "ready":
      return "Cursor account is authenticated and ready.";
    case "authentication_required":
      return "Cursor sign-in required. Run `agent login` in a terminal.";
    case "rate_limited":
      return "Cursor account is rate limited. Try again later.";
    case "unsupported_version":
      return "Cursor Agent CLI version is not supported.";
    case "installed":
      return "Cursor Agent is installed; authentication was not verified.";
    case "error":
      return "Cursor Agent connection probe failed.";
    default:
      return "Cursor Agent status is unknown.";
  }
}
function parseStatusJson3(stdout) {
  try {
    const payload = JSON.parse(stdout.trim());
    if (typeof payload !== "object" || payload === null) return void 0;
    const record = payload;
    const loggedIn = record.loggedIn ?? record.logged_in ?? record.authenticated;
    if (loggedIn === true) return "ready";
    if (loggedIn === false) return "authentication_required";
    const status = typeof record.status === "string" ? record.status.toLowerCase() : "";
    if (status.includes("ready") || status.includes("authenticated")) return "ready";
    if (status.includes("login") || status.includes("auth")) return "authentication_required";
    if (status.includes("rate")) return "rate_limited";
    return void 0;
  } catch {
    return void 0;
  }
}
async function runExec3(executable, args, options, input) {
  const execImpl = options.execFileImpl ?? execFileAsync4;
  const execOptions = {
    encoding: "utf8",
    timeout: options.timeoutMs ?? 15e3,
    maxBuffer: 512 * 1024,
    windowsHide: true,
    shell: false,
    signal: options.signal,
    ...input === void 0 ? {} : { input }
  };
  const result = await execImpl(executable, [...args], execOptions);
  return { stdout: result.stdout, stderr: result.stderr };
}
async function probeWithStatusCommand3(executable, options) {
  try {
    const result = await runExec3(executable, ["status", "--format", "json"], options);
    const mapped = parseStatusJson3(result.stdout) ?? (result.stderr ? classifyAuthFailure3(result.stderr, result.stdout, 0) : "ready");
    return {
      backendId: CURSOR_BACKEND_ID,
      status: mapped,
      authSummary: authSummaryForStatus3(mapped),
      diagnostics: mapped === "ready" ? [] : [result.stderr.trim() || result.stdout.trim()].filter(Boolean)
    };
  } catch (error2) {
    const execError = error2;
    if (execError.code === "ENOENT" || /unknown command|invalid command|unrecognized/i.test(String(execError.stderr ?? execError.message))) {
      return null;
    }
    const stderr = execError.stderr ?? "";
    const stdout = execError.stdout ?? "";
    const status = classifyAuthFailure3(stderr, stdout, typeof execError.code === "number" ? execError.code : void 0);
    return {
      backendId: CURSOR_BACKEND_ID,
      status,
      authSummary: authSummaryForStatus3(status),
      diagnostics: [stderr.trim() || execError.message || "Cursor status probe failed."].filter(Boolean)
    };
  }
}
async function probeWithConnectionTest3(executable, options) {
  try {
    const result = await runExec3(
      executable,
      ["--print", "--output-format", "stream-json", "--stream-partial-output", "--mode", "ask"],
      options,
      CURSOR_CONNECTION_TEST_PROMPT
    );
    const parsed = parseCursorStreamJson(result.stdout);
    if (parsed.error) {
      const status = classifyAuthFailure3(result.stderr, `${result.stdout}
${parsed.error}`);
      return {
        backendId: CURSOR_BACKEND_ID,
        status,
        authSummary: authSummaryForStatus3(status),
        diagnostics: [parsed.error, result.stderr.trim()].filter(Boolean)
      };
    }
    if (validateRegisteredSchema("connection-test-v1", parsed.output)) {
      return {
        backendId: CURSOR_BACKEND_ID,
        status: "ready",
        authSummary: authSummaryForStatus3("ready"),
        diagnostics: []
      };
    }
    return {
      backendId: CURSOR_BACKEND_ID,
      status: "error",
      authSummary: authSummaryForStatus3("error"),
      diagnostics: ["Cursor connection test did not return { ok: true } JSON."]
    };
  } catch (error2) {
    const execError = error2;
    const stderr = execError.stderr ?? "";
    const stdout = execError.stdout ?? "";
    const status = classifyAuthFailure3(stderr, stdout, typeof execError.code === "number" ? execError.code : void 0);
    return {
      backendId: CURSOR_BACKEND_ID,
      status,
      authSummary: authSummaryForStatus3(status),
      diagnostics: [stderr.trim() || execError.message || "Cursor connection test failed."].filter(Boolean)
    };
  }
}
async function probeCursorAuth(executable, options = {}) {
  if (options.versionStatus?.status === "unsupported_version") {
    return {
      backendId: CURSOR_BACKEND_ID,
      status: "unsupported_version",
      authSummary: authSummaryForStatus3("unsupported_version"),
      diagnostics: [...options.versionStatus.diagnostics]
    };
  }
  const statusProbe = await probeWithStatusCommand3(executable, options);
  if (statusProbe) return statusProbe;
  return probeWithConnectionTest3(executable, options);
}

// ../model-bridge/src/subscription-cli/cursor/adapter.ts
function buildCursorDynamicArgs(input) {
  const args = [];
  if (input.enableWorkspaceTrust) args.push("--trust");
  if (input.model) args.push("--model", input.model);
  const workspace = input.cwd ?? (input.promptPath ? path2.dirname(input.promptPath) : void 0);
  if (workspace) args.push("--workspace", workspace);
  assertArgsSafe(args, { allowScopedTrust: input.enableWorkspaceTrust === true });
  return Object.freeze(args);
}
function isRecord6(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function mapCursorError(message) {
  return /auth|login|sign[\s-]?in/i.test(message) ? "AUTH_REQUIRED" : /rate.?limit/i.test(message) ? "RATE_LIMITED" : "BACKEND_PARSE_FAILED";
}
function extractModelId2(value) {
  if (typeof value === "string") return value.trim() || void 0;
  if (!isRecord6(value)) return void 0;
  for (const key of ["id", "name", "model", "slug"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return void 0;
}
function parseCursorAgentModelList(output) {
  const models = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (value) => {
    const model = extractModelId2(value);
    if (model && !seen.has(model)) {
      seen.add(model);
      models.push(model);
    }
  };
  const trimmed = output.trim();
  if (!trimmed || /no models available/i.test(trimmed)) return Object.freeze(models);
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      parsed.forEach(add);
      return Object.freeze(models);
    }
    if (isRecord6(parsed)) {
      const nested = parsed.models ?? parsed.data;
      if (Array.isArray(nested)) {
        nested.forEach(add);
        return Object.freeze(models);
      }
      add(parsed);
      return Object.freeze(models);
    }
  } catch {
  }
  for (const line of trimmed.split(/\r?\n/)) {
    const text = line.trim().replace(/^[-*]\s+/, "");
    if (!text || /^[-=\s]+$/.test(text) || /no models available/i.test(text)) continue;
    const model = text.match(/^([a-zA-Z0-9][a-zA-Z0-9._:/-]*)(?:\s+-\s+|\s{2,}|$)/)?.[1];
    if (model && !["model", "models", "name", "id"].includes(model.toLowerCase())) add(model);
  }
  return Object.freeze(models);
}
async function defaultExecFileProbe2(executable, args, options) {
  const { execFile: execFile8 } = await import("node:child_process");
  const { promisify: promisify8 } = await import("node:util");
  const result = await promisify8(execFile8)(executable, [...args], options);
  return { stdout: result.stdout, stderr: result.stderr };
}
async function listCursorAgentModels(executable, options = {}) {
  const execFile8 = options.execFile ?? defaultExecFileProbe2;
  const result = await execFile8(executable, ["models"], {
    encoding: "utf8",
    timeout: 1e4,
    maxBuffer: 512 * 1024,
    windowsHide: true,
    shell: false,
    ...options.signal ? { signal: options.signal } : {}
  });
  return parseCursorAgentModelList(`${result.stdout}
${result.stderr}`);
}
var cursorSubscriptionCliAdapter = {
  id: "cursor-agent",
  backendId: CURSOR_BACKEND_ID,
  spawnHints: Object.freeze({ stdin: "prompt" }),
  buildArgs(input) {
    return buildCursorDynamicArgs(input);
  },
  parseOutput(stdout, stderr, _schemaId) {
    const parsed = parseCursorStreamJson(stdout);
    if (parsed.error) {
      const stderrDetail = stderr.trim();
      const message = stderrDetail && /terminal result event|structured JSON/i.test(parsed.error) ? stderrDetail : parsed.error;
      throw Object.assign(new Error(message), { code: mapCursorError(message) });
    }
    if (parsed.output === void 0) {
      const detail = stderr.trim() || "Cursor output did not contain structured JSON.";
      throw Object.assign(new Error(detail), { code: mapCursorError(detail) });
    }
    return parsed.output;
  },
  parseStreamingOutput(stdout, stderr, _schemaId) {
    const parsed = parseCursorStreamJson(stdout);
    if (parsed.error) {
      if (/without a terminal result event|did not contain a terminal result event|did not contain structured JSON/i.test(parsed.error)) {
        const detail = stderr.trim();
        if (!detail) return void 0;
      }
      const stderrDetail = stderr.trim();
      const message = stderrDetail && /terminal result event|structured JSON/i.test(parsed.error) ? stderrDetail : parsed.error;
      throw Object.assign(new Error(message), { code: mapCursorError(message) });
    }
    return parsed.output;
  },
  async probeAuth(executable, signal) {
    return testCursorConnection(executable, signal);
  },
  async listModels(executable, options) {
    return listCursorAgentModels(executable, options);
  }
};
async function testCursorConnection(executable, signal) {
  let version = null;
  try {
    const { execFile: execFile8 } = await import("node:child_process");
    const { promisify: promisify8 } = await import("node:util");
    const result = await promisify8(execFile8)(executable, ["--version"], {
      encoding: "utf8",
      timeout: 5e3,
      maxBuffer: 64 * 1024,
      windowsHide: true,
      shell: false,
      signal
    });
    version = parseCursorVersionOutput(`${result.stdout}
${result.stderr}`.trim())?.raw ?? null;
  } catch {
    version = null;
  }
  return probeCursorAuth(executable, {
    ...signal ? { signal } : {},
    versionStatus: evaluateCursorVersion(version)
  });
}

// ../model-bridge/src/subscription-cli/gemini/auth.ts
import { execFile as execFile5 } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path3 from "node:path";
import { promisify as promisify5 } from "node:util";

// ../model-bridge/src/subscription-cli/gemini/parser.ts
var MAX_BYTES = 4 * 1024 * 1024;
var byteLength5 = (value) => Buffer.byteLength(value, "utf8");
function isRecord7(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function errorText(error2) {
  if (typeof error2 === "string") return error2;
  if (!isRecord7(error2)) return void 0;
  return [error2.message, error2.type, error2.code].filter((value) => typeof value === "string").join(": ") || void 0;
}
function parseGeminiJsonOutput(stdout, stderr, maxBytes = MAX_BYTES) {
  if (byteLength5(stdout) > maxBytes) throw new Error(`Gemini JSON output exceeds ${maxBytes} bytes.`);
  const trimmed = stdout.trim();
  if (!trimmed) return { output: void 0, error: stderr.trim() || "Gemini CLI produced no stdout." };
  let envelope;
  try {
    envelope = JSON.parse(trimmed);
  } catch {
    try {
      return { output: extractBoundedJson(trimmed, maxBytes), rawText: trimmed };
    } catch {
      return { output: void 0, error: stderr.trim() || "Gemini CLI output was not valid JSON." };
    }
  }
  if (!isRecord7(envelope)) return { output: void 0, error: "Gemini CLI JSON envelope was not an object." };
  const reportedError = errorText(envelope.error);
  if (reportedError) return { output: void 0, error: reportedError };
  if (typeof envelope.response !== "string" || !envelope.response.trim()) {
    return { output: void 0, error: "Gemini CLI JSON response did not include response text." };
  }
  try {
    return { output: extractBoundedJson(envelope.response, maxBytes), rawText: envelope.response };
  } catch {
    return { output: void 0, rawText: envelope.response, error: "Gemini response did not contain one bounded JSON document." };
  }
}

// ../model-bridge/src/subscription-cli/gemini/auth.ts
var GEMINI_CONNECTION_TEST_PROMPT = 'Respond with only valid JSON matching {"ok":true}. No tools, markdown, or commentary.';
function classify(text) {
  if (/quota|rate.?limit|capacity|resource.?exhausted|429|daily limit/i.test(text)) return "rate_limited";
  if (/policy|code assist.*disabled|organization.*disabled/i.test(text)) return "unavailable";
  if (/auth|login|sign[\s-]?in|not logged|google account|credentials/i.test(text)) return "authentication_required";
  return "error";
}
function summary(status) {
  if (status === "ready") return "Gemini Code Assist Enterprise authentication is ready.";
  if (status === "authentication_required") return "Gemini sign-in required. Run `gemini` in a terminal and complete Google authentication.";
  if (status === "rate_limited") return "Gemini account allowance or request limit was reached.";
  if (status === "unsupported_version") return "Gemini CLI version is not supported.";
  if (status === "unavailable") return "Gemini CLI is unavailable for this account tier or organization policy.";
  return "Gemini connection probe failed.";
}
async function probeGeminiAuth(executable, options = {}) {
  if (options.versionStatus?.status === "unsupported_version") {
    return { backendId: GEMINI_BACKEND_ID, status: "unsupported_version", authSummary: summary("unsupported_version"), diagnostics: [...options.versionStatus.diagnostics] };
  }
  const cwd = await mkdtemp(path3.join(os.tmpdir(), "vdt-gemini-probe-"));
  const policyPath = path3.join(cwd, "deny-all-tools.toml");
  await writeFile(policyPath, '[[rule]]\ntoolName = "*"\ndecision = "deny"\npriority = 999\n', { encoding: "utf8", mode: 384 });
  try {
    const probe = options.execFileImpl ?? promisify5(execFile5);
    const execOptions = { encoding: "utf8", cwd, timeout: options.timeoutMs ?? 15e3, maxBuffer: 512 * 1024, windowsHide: true, shell: false, signal: options.signal };
    const result = await probe(executable, ["--output-format", "json", "--approval-mode", "default", "--admin-policy", policyPath, "--prompt", GEMINI_CONNECTION_TEST_PROMPT], execOptions);
    const parsed = parseGeminiJsonOutput(result.stdout, result.stderr);
    if (!parsed.error && validateRegisteredSchema("connection-test-v1", parsed.output)) {
      return { backendId: GEMINI_BACKEND_ID, status: "ready", authSummary: summary("ready"), diagnostics: [] };
    }
    const message = parsed.error ?? result.stderr ?? "Gemini connection response was invalid.";
    const status = classify(message);
    return { backendId: GEMINI_BACKEND_ID, status, authSummary: summary(status), diagnostics: [message].filter(Boolean) };
  } catch (error2) {
    const execError = error2;
    const message = `${execError.stderr ?? ""}
${execError.stdout ?? ""}
${execError.message}`.trim();
    const status = classify(message);
    return { backendId: GEMINI_BACKEND_ID, status, authSummary: summary(status), diagnostics: [message] };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

// ../model-bridge/src/subscription-cli/gemini/version.ts
var GEMINI_CLI_MIN_VERSION = "0.43.0";
var SEMVER_PATTERN4 = /(\d+)\.(\d+)\.(\d+)/;
function parseGeminiVersionOutput(output) {
  const raw = output.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (!raw) return null;
  const match = raw.match(SEMVER_PATTERN4);
  if (!match) return { raw };
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return { raw, semver: `${major}.${minor}.${patch}`, major, minor, patch };
}
function compare(a, b) {
  for (const key of ["major", "minor", "patch"]) {
    const difference = (a[key] ?? 0) - (b[key] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
function evaluateGeminiVersion(version) {
  if (!version) {
    return { supported: false, status: "installed", diagnostics: ["Gemini CLI is installed, but its version could not be determined."] };
  }
  const parsed = parseGeminiVersionOutput(version);
  if (!parsed?.semver) {
    return { supported: false, status: "installed", diagnostics: [`Gemini CLI version "${parsed?.raw ?? version}" is not recognized; compatibility is unknown.`] };
  }
  const minimum = parseGeminiVersionOutput(GEMINI_CLI_MIN_VERSION);
  if (compare(parsed, minimum) < 0) {
    return { supported: false, status: "unsupported_version", diagnostics: [`Gemini CLI ${parsed.semver} is below the minimum supported version ${GEMINI_CLI_MIN_VERSION}.`] };
  }
  return { supported: true, status: "installed", diagnostics: [] };
}

// ../model-bridge/src/subscription-cli/gemini/adapter.ts
var GEMINI_BACKEND_ID = "gemini_subscription";
function buildGeminiDynamicArgs(input) {
  const prompt = input.promptText?.trim();
  if (!prompt) throw Object.assign(new Error("Gemini subscription prompt text is required."), { code: "PROMPT_REQUIRED" });
  if (!input.toolPolicyPath) throw Object.assign(new Error("Gemini deny-all tool policy is required."), { code: "UNSAFE_CONFIGURATION" });
  const args = ["--admin-policy", input.toolPolicyPath];
  if (input.model) args.push("--model", input.model);
  args.push("--prompt", prompt);
  assertArgsSafe(args);
  return Object.freeze(args);
}
function mapGeminiError(message) {
  if (/auth|login|sign[\s-]?in|not logged|google account/i.test(message)) return "AUTH_REQUIRED";
  if (/quota|rate.?limit|capacity|resource.?exhausted|429|daily limit/i.test(message)) return "RATE_LIMITED";
  if (/policy|code assist.*disabled|organization.*disabled/i.test(message)) return "POLICY_DISABLED";
  return "BACKEND_PARSE_FAILED";
}
var geminiSubscriptionCliAdapter = {
  id: "gemini",
  backendId: GEMINI_BACKEND_ID,
  buildArgs: buildGeminiDynamicArgs,
  parseOutput(stdout, stderr, _schemaId) {
    const parsed = parseGeminiJsonOutput(stdout, stderr);
    if (parsed.error) throw Object.assign(new Error(parsed.error), { code: mapGeminiError(parsed.error) });
    if (parsed.output === void 0) throw Object.assign(new Error("Gemini CLI returned no structured output."), { code: "BACKEND_PARSE_FAILED" });
    return parsed.output;
  },
  async probeAuth(executable, signal) {
    return testGeminiConnection(executable, signal);
  }
};
async function testGeminiConnection(executable, signal) {
  let version = null;
  try {
    const { execFile: execFile8 } = await import("node:child_process");
    const { promisify: promisify8 } = await import("node:util");
    const result = await promisify8(execFile8)(executable, ["--version"], { encoding: "utf8", timeout: 5e3, maxBuffer: 64 * 1024, windowsHide: true, shell: false, signal });
    version = parseGeminiVersionOutput(`${result.stdout}
${result.stderr}`)?.raw ?? null;
  } catch {
    version = null;
  }
  return probeGeminiAuth(executable, { ...signal ? { signal } : {}, versionStatus: evaluateGeminiVersion(version) });
}

// ../model-bridge/src/subscription-cli/copilot/auth.ts
import { execFile as execFile6 } from "node:child_process";
import { mkdtemp as mkdtemp2, rm as rm2 } from "node:fs/promises";
import os2 from "node:os";
import path4 from "node:path";
import { promisify as promisify6 } from "node:util";

// ../model-bridge/src/subscription-cli/copilot/parser.ts
var MAX_BYTES2 = 4 * 1024 * 1024;
var MAX_LINES = 1e5;
var byteLength6 = (value) => Buffer.byteLength(value, "utf8");
function isRecord8(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function findText(value) {
  for (const candidate of [value.content, value.text, value.message, value.response, value.result]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
    if (isRecord8(candidate)) {
      const nested = findText(candidate);
      if (nested) return nested;
    }
  }
  if (isRecord8(value.data)) return findText(value.data);
  return void 0;
}
function parseCopilotJsonlOutput(stdout, stderr, maxBytes = MAX_BYTES2) {
  if (byteLength6(stdout) > maxBytes) throw new Error(`Copilot JSONL output exceeds ${maxBytes} bytes.`);
  const trimmed = stdout.trim();
  if (!trimmed) return { output: void 0, error: stderr.trim() || "Copilot CLI produced no stdout." };
  let lastAssistantText;
  let lastDirectObject;
  let terminalError;
  let lineCount = 0;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    lineCount += 1;
    if (lineCount > MAX_LINES) throw new Error(`Copilot JSONL output exceeds ${MAX_LINES} lines.`);
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord8(event)) continue;
    const type = typeof event.type === "string" ? event.type.toLowerCase() : "";
    if (type.includes("error") || type.endsWith("failed")) terminalError = findText(event) ?? "Copilot CLI reported an error.";
    if (type.includes("assistant") || type === "message") lastAssistantText = findText(event) ?? lastAssistantText;
    if ("ok" in event || "projectTitle" in event || "rootNodeId" in event) lastDirectObject = event;
  }
  if (terminalError) return { output: void 0, error: terminalError };
  if (lastDirectObject !== void 0) return { output: lastDirectObject, rawText: JSON.stringify(lastDirectObject) };
  if (lastAssistantText) {
    try {
      return { output: extractBoundedJson(lastAssistantText, maxBytes), rawText: lastAssistantText };
    } catch {
      return { output: void 0, rawText: lastAssistantText, error: "Copilot response did not contain one bounded JSON document." };
    }
  }
  try {
    return { output: extractBoundedJson(trimmed, maxBytes), rawText: trimmed };
  } catch {
    return { output: void 0, error: stderr.trim() || "Copilot JSONL did not contain an assistant response." };
  }
}

// ../model-bridge/src/subscription-cli/copilot/auth.ts
var COPILOT_CONNECTION_TEST_PROMPT = 'Respond with only valid JSON matching {"ok":true}. Do not use tools, markdown, or commentary.';
function classify2(text) {
  if (/premium request|quota|usage limit|rate.?limit|429|budget/i.test(text)) return "rate_limited";
  if (/organization.*policy|policy.*disabled|copilot cli.*disabled|plan.*unavailable/i.test(text)) return "unavailable";
  if (/auth|login|sign[\s-]?in|not logged|credentials/i.test(text)) return "authentication_required";
  return "error";
}
function summary2(status) {
  if (status === "ready") return "GitHub Copilot plan authentication is ready.";
  if (status === "authentication_required") return "GitHub sign-in required. Run `copilot login` in a terminal.";
  if (status === "rate_limited") return "Copilot premium request or usage limit was reached.";
  if (status === "unsupported_version") return "Copilot CLI version is not supported.";
  if (status === "unavailable") return "Copilot CLI is unavailable for this plan or organization policy.";
  return "Copilot connection probe failed.";
}
async function probeCopilotAuth(executable, options = {}) {
  if (options.versionStatus?.status === "unsupported_version") {
    return { backendId: COPILOT_BACKEND_ID, status: "unsupported_version", authSummary: summary2("unsupported_version"), diagnostics: [...options.versionStatus.diagnostics] };
  }
  const cwd = await mkdtemp2(path4.join(os2.tmpdir(), "vdt-copilot-probe-"));
  try {
    const probe = options.execFileImpl ?? promisify6(execFile6);
    const execOptions = { encoding: "utf8", cwd, timeout: options.timeoutMs ?? 15e3, maxBuffer: 512 * 1024, windowsHide: true, shell: false, signal: options.signal };
    const args = ["--output-format=json", "--stream=off", "--available-tools=", "--disable-builtin-mcps", "--no-custom-instructions", "--no-ask-user", "--no-auto-update", "--prompt", COPILOT_CONNECTION_TEST_PROMPT];
    const result = await probe(executable, args, execOptions);
    const parsed = parseCopilotJsonlOutput(result.stdout, result.stderr);
    if (!parsed.error && validateRegisteredSchema("connection-test-v1", parsed.output)) {
      return { backendId: COPILOT_BACKEND_ID, status: "ready", authSummary: summary2("ready"), diagnostics: [] };
    }
    const message = parsed.error ?? result.stderr ?? "Copilot connection response was invalid.";
    const status = classify2(message);
    return { backendId: COPILOT_BACKEND_ID, status, authSummary: summary2(status), diagnostics: [message].filter(Boolean) };
  } catch (error2) {
    const execError = error2;
    const message = `${execError.stderr ?? ""}
${execError.stdout ?? ""}
${execError.message}`.trim();
    const status = classify2(message);
    return { backendId: COPILOT_BACKEND_ID, status, authSummary: summary2(status), diagnostics: [message] };
  } finally {
    await rm2(cwd, { recursive: true, force: true });
  }
}

// ../model-bridge/src/subscription-cli/copilot/version.ts
var COPILOT_CLI_MIN_VERSION = "1.0.0";
var SEMVER_PATTERN5 = /(\d+)\.(\d+)\.(\d+)/;
function parseCopilotVersionOutput(output) {
  const raw = output.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (!raw) return null;
  const match = raw.match(SEMVER_PATTERN5);
  if (!match) return { raw };
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return { raw, semver: `${major}.${minor}.${patch}`, major, minor, patch };
}
function compare2(a, b) {
  for (const key of ["major", "minor", "patch"]) {
    const difference = (a[key] ?? 0) - (b[key] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
function evaluateCopilotVersion(version) {
  if (!version) return { supported: false, status: "installed", diagnostics: ["Copilot CLI is installed, but its version could not be determined."] };
  const parsed = parseCopilotVersionOutput(version);
  if (!parsed?.semver) return { supported: false, status: "installed", diagnostics: [`Copilot CLI version "${parsed?.raw ?? version}" is not recognized; compatibility is unknown.`] };
  const minimum = parseCopilotVersionOutput(COPILOT_CLI_MIN_VERSION);
  if (compare2(parsed, minimum) < 0) {
    return { supported: false, status: "unsupported_version", diagnostics: [`Copilot CLI ${parsed.semver} is below the minimum supported version ${COPILOT_CLI_MIN_VERSION}.`] };
  }
  return { supported: true, status: "installed", diagnostics: [] };
}

// ../model-bridge/src/subscription-cli/copilot/adapter.ts
var COPILOT_BACKEND_ID = "copilot_subscription";
function buildCopilotDynamicArgs(input) {
  const prompt = input.promptText?.trim();
  if (!prompt) throw Object.assign(new Error("Copilot subscription prompt text is required."), { code: "PROMPT_REQUIRED" });
  const args = [];
  if (input.model) args.push("--model", input.model);
  args.push("--prompt", prompt);
  assertArgsSafe(args);
  return Object.freeze(args);
}
function mapCopilotError(message) {
  if (/auth|login|sign[\s-]?in|not logged|credentials/i.test(message)) return "AUTH_REQUIRED";
  if (/premium request|quota|usage limit|rate.?limit|429|budget/i.test(message)) return "RATE_LIMITED";
  if (/organization.*policy|policy.*disabled|copilot cli.*disabled|plan.*unavailable/i.test(message)) return "POLICY_DISABLED";
  return "BACKEND_PARSE_FAILED";
}
var copilotSubscriptionCliAdapter = {
  id: "copilot",
  backendId: COPILOT_BACKEND_ID,
  buildArgs: buildCopilotDynamicArgs,
  parseOutput(stdout, stderr, _schemaId) {
    const parsed = parseCopilotJsonlOutput(stdout, stderr);
    if (parsed.error) throw Object.assign(new Error(parsed.error), { code: mapCopilotError(parsed.error) });
    if (parsed.output === void 0) throw Object.assign(new Error("Copilot CLI returned no structured output."), { code: "BACKEND_PARSE_FAILED" });
    return parsed.output;
  },
  async probeAuth(executable, signal) {
    return testCopilotConnection(executable, signal);
  }
};
async function testCopilotConnection(executable, signal) {
  let version = null;
  try {
    const { execFile: execFile8 } = await import("node:child_process");
    const { promisify: promisify8 } = await import("node:util");
    const result = await promisify8(execFile8)(executable, ["--version"], { encoding: "utf8", timeout: 5e3, maxBuffer: 64 * 1024, windowsHide: true, shell: false, signal });
    version = parseCopilotVersionOutput(`${result.stdout}
${result.stderr}`)?.raw ?? null;
  } catch {
    version = null;
  }
  return probeCopilotAuth(executable, { ...signal ? { signal } : {}, versionStatus: evaluateCopilotVersion(version) });
}

// ../model-bridge/src/subscription-cli/registry.ts
var ADAPTERS = Object.freeze(
  /* @__PURE__ */ new Map([
    [cursorSubscriptionCliAdapter.backendId, cursorSubscriptionCliAdapter],
    [codexSubscriptionCliAdapter.backendId, codexSubscriptionCliAdapter],
    [claudeSubscriptionCliAdapter.backendId, claudeSubscriptionCliAdapter],
    [geminiSubscriptionCliAdapter.backendId, geminiSubscriptionCliAdapter],
    [copilotSubscriptionCliAdapter.backendId, copilotSubscriptionCliAdapter]
  ])
);
function getSubscriptionCliAdapter(backendId) {
  return ADAPTERS.get(backendId);
}

// ../model-bridge/src/enrich-detection.ts
async function enrichSubscriptionCliDetection(agent, options = {}) {
  if (!agent.installed || !agent.executable) {
    return {
      ...agent,
      status: "not_installed",
      diagnostics: []
    };
  }
  const adapter = getSubscriptionCliAdapter(agent.backendId);
  if (adapter?.probeAuth) {
    try {
      const probe = await adapter.probeAuth(agent.executable, options.signal);
      return {
        ...agent,
        status: probe.status,
        ...probe.authSummary ? { authSummary: probe.authSummary } : {},
        diagnostics: probe.diagnostics
      };
    } catch (error2) {
      if (options.signal?.aborted) {
        return {
          ...agent,
          status: "installed",
          authSummary: "Authentication probe timed out.",
          diagnostics: ["CLI enrichment timed out before auth could be verified."]
        };
      }
      return {
        ...agent,
        status: "error",
        diagnostics: [error2 instanceof Error ? error2.message : "Auth probe failed."]
      };
    }
  }
  const diagnostics = [];
  if (agent.error) diagnostics.push(`Version probe failed: ${agent.error}`);
  return {
    ...agent,
    status: "installed",
    diagnostics
  };
}
async function enrichSubscriptionCliDetections(agents, options = {}) {
  const probeTimeoutMs = options.probeTimeoutMs ?? 5e3;
  return Promise.all(
    agents.map(async (agent) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), probeTimeoutMs);
      try {
        return await enrichSubscriptionCliDetection(agent, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    })
  );
}

// ../vdt-core/src/formula/ast.ts
var FormulaParseError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "FormulaParseError";
  }
};

// ../vdt-core/src/formula/parser.ts
function isDigit(char) {
  return /[0-9]/.test(char);
}
function isIdentifierStart(char) {
  return /[A-Za-z_]/.test(char);
}
function isIdentifierPart(char) {
  return /[A-Za-z0-9_]/.test(char);
}
function tokenizeFormula(formula) {
  const tokens = [];
  let index = 0;
  while (index < formula.length) {
    const char = formula[index];
    if (!char) {
      break;
    }
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (isDigit(char) || char === ".") {
      const start = index;
      let hasDot = char === ".";
      index += 1;
      while (index < formula.length) {
        const next = formula[index];
        if (!next) {
          break;
        }
        if (next === ".") {
          if (hasDot) {
            throw new FormulaParseError(`Invalid number literal near "${formula.slice(start, index + 1)}".`);
          }
          hasDot = true;
          index += 1;
          continue;
        }
        if (!isDigit(next)) {
          break;
        }
        index += 1;
      }
      const numericRaw = formula.slice(start, index);
      if (numericRaw === ".") {
        throw new FormulaParseError("A number cannot be only a decimal point.");
      }
      let raw = numericRaw;
      let value = Number(numericRaw);
      if (formula[index] === "%") {
        raw = `${numericRaw}%`;
        value /= 100;
        index += 1;
      }
      if (!Number.isFinite(value)) {
        throw new FormulaParseError(`Invalid number literal: ${raw}`);
      }
      tokens.push({ type: "number", value, raw });
      continue;
    }
    if (isIdentifierStart(char)) {
      const start = index;
      index += 1;
      while (index < formula.length && isIdentifierPart(formula[index] ?? "")) {
        index += 1;
      }
      tokens.push({ type: "identifier", value: formula.slice(start, index) });
      continue;
    }
    if (char === "+" || char === "-" || char === "*" || char === "/") {
      tokens.push({ type: "operator", value: char });
      index += 1;
      continue;
    }
    if (char === "(") {
      tokens.push({ type: "left_paren" });
      index += 1;
      continue;
    }
    if (char === ")") {
      tokens.push({ type: "right_paren" });
      index += 1;
      continue;
    }
    throw new FormulaParseError(`Unsupported token "${char}" in formula.`);
  }
  tokens.push({ type: "eof" });
  return tokens;
}
var FormulaParser = class {
  constructor(tokens) {
    this.tokens = tokens;
  }
  tokens;
  cursor = 0;
  parse() {
    const expression = this.parseAdditive();
    if (this.peek().type !== "eof") {
      throw new FormulaParseError("Unexpected token after formula expression.");
    }
    return expression;
  }
  parseAdditive() {
    let expression = this.parseMultiplicative();
    while (true) {
      const next = this.peek();
      if (next.type !== "operator" || next.value !== "+" && next.value !== "-") {
        break;
      }
      const operator = this.advance();
      expression = {
        type: "binary",
        operator: operator.value,
        left: expression,
        right: this.parseMultiplicative()
      };
    }
    return expression;
  }
  parseMultiplicative() {
    let expression = this.parseUnary();
    while (true) {
      const next = this.peek();
      if (next.type !== "operator" || next.value !== "*" && next.value !== "/") {
        break;
      }
      const operator = this.advance();
      expression = {
        type: "binary",
        operator: operator.value,
        left: expression,
        right: this.parseUnary()
      };
    }
    return expression;
  }
  parseUnary() {
    const next = this.peek();
    if (next.type === "operator" && next.value === "-") {
      this.advance();
      return {
        type: "unary",
        operator: "-",
        expression: this.parseUnary()
      };
    }
    return this.parsePrimary();
  }
  parsePrimary() {
    const token = this.advance();
    if (token.type === "number") {
      return { type: "number", value: token.value, raw: token.raw };
    }
    if (token.type === "identifier") {
      return { type: "reference", name: token.value };
    }
    if (token.type === "left_paren") {
      const expression = this.parseAdditive();
      if (this.peek().type !== "right_paren") {
        throw new FormulaParseError("Missing closing parenthesis.");
      }
      this.advance();
      return expression;
    }
    throw new FormulaParseError("Expected a number, reference, or parenthesized expression.");
  }
  peek() {
    return this.tokens[this.cursor] ?? { type: "eof" };
  }
  advance() {
    const token = this.peek();
    this.cursor += 1;
    return token;
  }
};
function parseFormula(formula) {
  if (!formula.trim()) {
    throw new FormulaParseError("Formula cannot be empty.");
  }
  return new FormulaParser(tokenizeFormula(formula)).parse();
}

// ../vdt-core/src/formula/evaluator.ts
function extractReferencesFromAst(expression, references = /* @__PURE__ */ new Set()) {
  if (expression.type === "reference") {
    references.add(expression.name);
  } else if (expression.type === "unary") {
    extractReferencesFromAst(expression.expression, references);
  } else if (expression.type === "binary") {
    extractReferencesFromAst(expression.left, references);
    extractReferencesFromAst(expression.right, references);
  }
  return [...references];
}

// ../vdt-core/src/graph/validation.ts
function isProject(input) {
  return "graph" in input && "rootNodeId" in input;
}
function issue(id, severity, type, message, nodeId, edgeId) {
  return {
    id,
    severity,
    type,
    message,
    ...nodeId ? { nodeId } : {},
    ...edgeId ? { edgeId } : {}
  };
}
function error(id, type, message, nodeId, edgeId) {
  return issue(id, "error", type, message, nodeId, edgeId);
}
function warning(id, type, message, nodeId, edgeId) {
  return issue(id, "warning", type, message, nodeId, edgeId);
}
function getRootNodeId(input, rootNodeId) {
  if (rootNodeId) return rootNodeId;
  if (isProject(input)) return input.rootNodeId;
  const roots = input.nodes.filter((node) => node.type === "root_kpi");
  return roots.length === 1 ? roots[0]?.id : void 0;
}
function normalizeUnit(unit) {
  const normalized = unit?.trim().toLowerCase();
  return normalized ? normalized : void 0;
}
function unitsCompatible(left, right) {
  return normalizeUnit(left) === normalizeUnit(right);
}
function collectUnitWarnings(node, expression, nodeById, warnings, path6 = "root") {
  if (expression.type === "number") {
    return void 0;
  }
  if (expression.type === "reference") {
    return normalizeUnit(nodeById.get(expression.name)?.unit);
  }
  if (expression.type === "unary") {
    return collectUnitWarnings(node, expression.expression, nodeById, warnings, `${path6}-unary`);
  }
  const leftUnit = collectUnitWarnings(node, expression.left, nodeById, warnings, `${path6}-left`);
  const rightUnit = collectUnitWarnings(node, expression.right, nodeById, warnings, `${path6}-right`);
  if ((expression.operator === "+" || expression.operator === "-") && leftUnit && rightUnit && !unitsCompatible(leftUnit, rightUnit)) {
    warnings.push(
      warning(
        `validation-unit-mismatch-${node.id}-${path6}`,
        "unit_mismatch",
        `Formula for "${node.name}" combines incompatible units with "${expression.operator}": "${leftUnit}" and "${rightUnit}"`,
        node.id
      )
    );
  }
  if (expression.operator === "+" || expression.operator === "-") {
    return leftUnit ?? rightUnit;
  }
  return void 0;
}
function validateGraph(input, rootNodeId) {
  const graph = isProject(input) ? input.graph : input;
  const rootId = getRootNodeId(input, rootNodeId);
  const errors = [];
  const warnings = [];
  const nodeIds = /* @__PURE__ */ new Set();
  const nodeById = /* @__PURE__ */ new Map();
  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      errors.push(
        error(
          `validation-duplicate-node-${node.id}`,
          "invalid_graph",
          `Duplicate node id "${node.id}"`,
          node.id
        )
      );
    }
    nodeIds.add(node.id);
    nodeById.set(node.id, node);
  }
  const edgeIds = /* @__PURE__ */ new Set();
  const edgePairs = /* @__PURE__ */ new Set();
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      errors.push(
        error(
          `validation-duplicate-edge-${edge.id}`,
          "invalid_graph",
          `Duplicate edge id "${edge.id}"`,
          void 0,
          edge.id
        )
      );
    }
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.sourceNodeId)) {
      errors.push(
        error(
          `validation-edge-source-${edge.id}`,
          "invalid_graph",
          `Edge "${edge.id}" references missing source node "${edge.sourceNodeId}"`,
          edge.sourceNodeId,
          edge.id
        )
      );
    }
    if (!nodeIds.has(edge.targetNodeId)) {
      errors.push(
        error(
          `validation-edge-target-${edge.id}`,
          "invalid_graph",
          `Edge "${edge.id}" references missing target node "${edge.targetNodeId}"`,
          edge.targetNodeId,
          edge.id
        )
      );
    }
    const pair = `${edge.sourceNodeId}->${edge.targetNodeId}`;
    if (edgePairs.has(pair)) {
      warnings.push(
        warning(
          `validation-duplicate-edge-pair-${edge.sourceNodeId}-${edge.targetNodeId}`,
          "invalid_graph",
          `Duplicate edge pair "${edge.sourceNodeId}" -> "${edge.targetNodeId}"`,
          void 0,
          edge.id
        )
      );
    }
    edgePairs.add(pair);
  }
  if (!rootId) {
    errors.push(
      error(
        "validation-root-missing",
        "invalid_graph",
        "Graph must define a root node id or contain exactly one root_kpi node"
      )
    );
  } else if (!nodeIds.has(rootId)) {
    errors.push(
      error(
        `validation-root-not-found-${rootId}`,
        "invalid_graph",
        `Root node "${rootId}" does not exist`,
        rootId
      )
    );
  }
  const formulaReferencesByNode = /* @__PURE__ */ new Map();
  for (const node of graph.nodes) {
    if (!node.formula?.trim()) continue;
    try {
      const expression = parseFormula(node.formula);
      const references = extractReferencesFromAst(expression);
      formulaReferencesByNode.set(node.id, references);
      for (const reference of references) {
        if (!nodeIds.has(reference)) {
          errors.push(
            error(
              `validation-formula-reference-${node.id}-${reference}`,
              "unknown_reference",
              `The formula for "${node.name}" references missing node "${reference}"`,
              node.id
            )
          );
        }
      }
      collectUnitWarnings(node, expression, nodeById, warnings);
    } catch (caught) {
      if (!(caught instanceof FormulaParseError)) {
        throw caught;
      }
      errors.push(
        error(
          `validation-formula-parse-${node.id}`,
          "formula_parse_error",
          `The formula for "${node.name}" cannot be parsed: ${caught.message}`,
          node.id
        )
      );
    }
  }
  const formulaVisitState = /* @__PURE__ */ new Map();
  const formulaStack = [];
  const circularFormulaIds = /* @__PURE__ */ new Set();
  const validateFormulaNode = (nodeId) => {
    const state = formulaVisitState.get(nodeId);
    if (state === "visited") return;
    if (state === "visiting") {
      const cycleStart = formulaStack.indexOf(nodeId);
      const cycle = [...formulaStack.slice(cycleStart >= 0 ? cycleStart : 0), nodeId];
      const cycleId = cycle.join("->");
      if (!circularFormulaIds.has(cycleId)) {
        circularFormulaIds.add(cycleId);
        errors.push(
          error(
            `validation-formula-cycle-${cycleId}`,
            "circular_dependency",
            `Circular formula dependency detected: ${cycle.join(" -> ")}`,
            nodeId
          )
        );
      }
      return;
    }
    formulaVisitState.set(nodeId, "visiting");
    formulaStack.push(nodeId);
    for (const reference of formulaReferencesByNode.get(nodeId) ?? []) {
      if (!nodeIds.has(reference)) continue;
      validateFormulaNode(reference);
    }
    formulaStack.pop();
    formulaVisitState.set(nodeId, "visited");
  };
  for (const node of graph.nodes) {
    validateFormulaNode(node.id);
  }
  if (rootId && nodeIds.has(rootId)) {
    const childrenBySource = /* @__PURE__ */ new Map();
    for (const edge of graph.edges) {
      if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) continue;
      const children = childrenBySource.get(edge.sourceNodeId) ?? [];
      children.push(edge.targetNodeId);
      childrenBySource.set(edge.sourceNodeId, children);
    }
    for (const [nodeId, references] of formulaReferencesByNode) {
      const children = childrenBySource.get(nodeId) ?? [];
      for (const reference of references) {
        if (nodeIds.has(reference)) {
          children.push(reference);
        }
      }
      childrenBySource.set(nodeId, children);
    }
    const reachable = /* @__PURE__ */ new Set();
    const queue = [rootId];
    while (queue.length > 0) {
      const nodeId = queue.shift();
      if (!nodeId || reachable.has(nodeId)) continue;
      reachable.add(nodeId);
      for (const child of childrenBySource.get(nodeId) ?? []) queue.push(child);
    }
    for (const node of graph.nodes) {
      if (reachable.has(node.id) && node.status === "rejected") {
        errors.push(
          error(
            `validation-rejected-active-node-${node.id}`,
            "invalid_graph",
            `Active model depends on rejected node "${node.name}"`,
            node.id
          )
        );
      }
      if (node.id === rootId || node.type === "external_factor") continue;
      if (!reachable.has(node.id)) {
        errors.push(
          error(
            `validation-unreachable-${node.id}`,
            "invalid_graph",
            `Node "${node.id}" is not reachable from root "${rootId}" through visual or formula dependency edges`,
            node.id
          )
        );
      }
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

// ../vdt-core/src/graph/layout.ts
var DEFAULT_CANVAS_LAYOUT = Object.freeze({
  margin: 48,
  cardWidth: 260,
  cardHeight: 132,
  horizontalGap: 220,
  verticalGap: 36
});
var DEFAULT_SVG_LAYOUT = Object.freeze({
  margin: 48,
  cardWidth: 240,
  cardHeight: 120,
  horizontalGap: 180,
  verticalGap: 32
});

// ../vdt-agent/src/index.ts
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
var DOMAIN_TERMS = {
  mining: [
    "mine",
    "mining",
    "ore",
    "tonne",
    "tons",
    "haulage",
    "truck",
    "payload",
    "pit",
    "dump",
    "crusher",
    "throughput",
    "production volume"
  ],
  finance: [
    "revenue",
    "profit",
    "margin",
    "ebitda",
    "cost",
    "price",
    "discount",
    "refund",
    "sales",
    "gross profit",
    "operating profit"
  ],
  saas: [
    "saas",
    "arr",
    "mrr",
    "churn",
    "retention",
    "signup",
    "activation",
    "trial",
    "conversion",
    "arpa",
    "arpu",
    "nrr",
    "funnel"
  ],
  generic: []
};
var FIELD_LABELS = {
  rootKpi: "Root KPI",
  industry: "Industry",
  businessContext: "Business context",
  unit: "Unit",
  timePeriod: "Time period",
  goal: "Business goal",
  levelOfDetail: "Desired level of detail"
};
function parseFrontmatter(markdown) {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0] !== "---") {
    throw new Error("Markdown skill must start with YAML frontmatter.");
  }
  const closeIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  if (closeIndex === -1) {
    throw new Error("Markdown skill frontmatter is missing a closing marker.");
  }
  const attributes = {};
  const frontmatterLines = lines.slice(1, closeIndex);
  for (let index = 0; index < frontmatterLines.length; index += 1) {
    const line = frontmatterLines[index];
    if (!line.trim() || line.trimStart().startsWith("#")) {
      continue;
    }
    const keyMatch = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(line);
    if (!keyMatch) {
      throw new Error(`Unsupported frontmatter line: ${line}`);
    }
    const key = keyMatch[1];
    const inlineValue = keyMatch[2] ?? "";
    if (inlineValue.trim()) {
      attributes[key] = parseScalarFrontmatterValue(inlineValue.trim());
      continue;
    }
    const values = [];
    while (frontmatterLines[index + 1]?.match(/^\s*-\s+/)) {
      index += 1;
      values.push(parseStringValue(frontmatterLines[index].replace(/^\s*-\s+/, "")));
    }
    attributes[key] = values;
  }
  return {
    attributes,
    body: lines.slice(closeIndex + 1).join("\n").trim()
  };
}
function parseSkillMarkdown(path6, markdown) {
  const parsed = parseFrontmatter(markdown);
  const frontmatter = normalizeSkillFrontmatter(parsed.attributes, path6);
  return {
    id: frontmatter.id,
    path: path6,
    title: frontmatter.title,
    domain: frontmatter.domain,
    frontmatter,
    body: parsed.body,
    raw: markdown
  };
}
function parseRegistryMarkdown(markdown) {
  const rows = markdown.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("|") && line.endsWith("|"));
  const headerIndex = rows.findIndex((line) => normalizeHeaderCells(splitMarkdownTableRow(line)).includes("skill id"));
  if (headerIndex === -1 || !rows[headerIndex + 2]) {
    return [];
  }
  const header = normalizeHeaderCells(splitMarkdownTableRow(rows[headerIndex]));
  return rows.slice(headerIndex + 2).map((row) => {
    const cells = splitMarkdownTableRow(row);
    const cell = (name) => cells[header.indexOf(name)]?.trim() ?? "";
    return {
      id: cell("skill id"),
      path: cell("path"),
      domain: cell("domain"),
      matchingTerms: splitListCell(cell("matching terms")),
      kpiPatterns: splitListCell(cell("primary kpi patterns")),
      inputRequirements: splitListCell(cell("input requirements")),
      expectedOutputs: splitListCell(cell("expected outputs")),
      confidenceHints: cell("confidence hints"),
      whenNotToUse: cell("when not to use")
    };
  });
}
function loadSkillLibraryFromMemory(sources) {
  const registrySource = sources["registry.md"] ?? sources["skills/registry.md"];
  if (!registrySource) {
    throw new Error("Skill library source map must include registry.md.");
  }
  const registry2 = parseRegistryMarkdown(registrySource);
  const skillPaths = Object.keys(sources).filter((path6) => path6 !== "registry.md" && path6 !== "skills/registry.md");
  const skills = skillPaths.sort().map((path6) => parseSkillMarkdown(path6, sources[path6]));
  assertRegistryCoversSkills(registry2, skills);
  return {
    registry: registry2,
    skills,
    byId: new Map(skills.map((skill) => [skill.id, skill]))
  };
}
async function loadSkillLibraryFromFs(rootDir) {
  const [{ readdir, readFile: readFile2 }, { join: join2, relative }] = await Promise.all([import("node:fs/promises"), import("node:path")]);
  const registryPath = join2(rootDir, "registry.md");
  const registrySource = await readFile2(registryPath, "utf8");
  const markdownPaths = await collectMarkdownFiles(rootDir, readdir, join2);
  const sources = { "registry.md": registrySource };
  await Promise.all(
    markdownPaths.filter((path6) => !path6.endsWith("registry.md")).map(async (path6) => {
      sources[relative(rootDir, path6).replaceAll("\\", "/")] = await readFile2(path6, "utf8");
    })
  );
  return loadSkillLibraryFromMemory(sources);
}
var defaultSkillLibraryPromise;
function loadDefaultSkillLibrary() {
  defaultSkillLibraryPromise ??= resolveDefaultSkillRoot().then((rootDir) => loadSkillLibraryFromFs(rootDir));
  return defaultSkillLibraryPromise;
}
async function resolveDefaultSkillRoot() {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDir, "vdt-agent-skills"),
    join(dirname(moduleDir), "vdt-agent-skills"),
    join(dirname(moduleDir), "skills")
  ];
  const { access: access2 } = await import("node:fs/promises");
  for (const candidate of candidates) {
    try {
      await access2(join(candidate, "registry.md"));
      return candidate;
    } catch {
    }
  }
  throw new Error(`Default VDT skill library was not found. Checked: ${candidates.join(", ")}`);
}
function classifyVdtRequest(request) {
  const haystack = normalizeText(
    [
      request.rootKpi,
      request.industry ?? "",
      request.businessContext ?? "",
      request.unit ?? "",
      request.timePeriod ?? "",
      request.goal ?? ""
    ].join(" ")
  );
  const scored = Object.keys(DOMAIN_TERMS).filter((domain) => domain !== "generic").map((domain) => {
    const matchedTerms = DOMAIN_TERMS[domain].filter((term) => includesTerm(haystack, term));
    return { domain, matchedTerms, score: matchedTerms.length };
  }).sort((a, b) => b.score - a.score || a.domain.localeCompare(b.domain));
  const winner = scored[0];
  if (!winner || winner.score === 0) {
    return {
      domain: "generic",
      pattern: "logical_kpi_decomposition",
      confidence: 0.35,
      matchedTerms: []
    };
  }
  return {
    domain: winner.domain,
    pattern: inferPattern(winner.domain, haystack),
    confidence: Math.min(0.95, 0.5 + winner.score * 0.12),
    matchedTerms: winner.matchedTerms
  };
}
function retrieveSkills(request, library, options = {}) {
  const classification = options.classification ?? classifyVdtRequest(request);
  const haystack = normalizeText(
    [request.rootKpi, request.industry ?? "", request.businessContext ?? "", request.goal ?? ""].join(" ")
  );
  const registryById = new Map(library.registry.map((entry) => [entry.id, entry]));
  const scored = library.skills.map((skill) => {
    const entry = registryById.get(skill.id);
    const terms = [
      ...skill.frontmatter.patterns,
      ...skill.frontmatter.kpiPatterns,
      ...entry?.matchingTerms ?? [],
      ...entry?.kpiPatterns ?? [],
      ...skill.frontmatter.outputs,
      ...entry?.expectedOutputs ?? []
    ];
    const matchedTerms = uniqueStrings(terms.filter((term) => includesTerm(haystack, term)));
    const hasExplicitMatch = matchedTerms.length > 0;
    const isGenericFallback = skill.domain === "generic";
    const domainScore = skill.domain === classification.domain && hasExplicitMatch ? 8 : isGenericFallback ? 1 : 0;
    const patternScore = matchedTerms.length * 3;
    const outputScore = skill.frontmatter.outputs.some((output) => matchedTerms.includes(output)) ? 2 : 0;
    const score = domainScore + patternScore + outputScore;
    return {
      skill,
      score,
      matchedTerms,
      reason: buildSelectionReason(skill, classification, matchedTerms)
    };
  }).filter(
    (candidate) => candidate.skill.domain === "generic" || candidate.skill.domain === classification.domain && candidate.matchedTerms.length > 0
  ).filter((candidate) => candidate.score > 0).sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id));
  const domainSpecific = scored.filter((candidate) => candidate.skill.domain !== "generic");
  if (domainSpecific.length > 0) {
    return domainSpecific.slice(0, options.maxSkills ?? 3);
  }
  const generic = library.skills.find((skill) => skill.id === "generic.logical_kpi_decomposition");
  return generic ? [
    {
      skill: generic,
      score: 1,
      matchedTerms: [],
      reason: "Selected as fallback because no domain-specific skill matched the request."
    }
  ] : [];
}
function readSkillExcerpts(skills, maxChars = 1800) {
  return skills.map((item) => {
    const skill = "skill" in item ? item.skill : item;
    const reason = "reason" in item ? item.reason : void 0;
    const excerpt = {
      id: skill.id,
      path: skill.path,
      title: skill.title,
      domain: skill.domain,
      excerpt: createSkillExcerpt(skill, maxChars),
      outputs: skill.frontmatter.outputs,
      questions: skill.frontmatter.questions
    };
    if (reason) {
      excerpt.reason = reason;
    }
    return excerpt;
  });
}
function planDecomposition(request, classification, skillExcerpts) {
  const formulas = uniqueStrings(skillExcerpts.flatMap((skill) => extractFormulaTemplates(skill.excerpt))).slice(0, 8);
  const firstLevelDrivers = uniqueStrings(skillExcerpts.flatMap((skill) => skill.outputs ?? [])).slice(0, 8);
  const questionsForUser = buildClarifyingQuestions(request, skillExcerpts).slice(0, 3);
  return {
    rootKpi: request.rootKpi,
    domain: classification.domain,
    pattern: classification.pattern,
    selectedSkillIds: skillExcerpts.map((skill) => skill.id),
    firstLevelDrivers,
    formulaTemplates: formulas,
    assumptions: [
      "Use provided brief fields as authoritative.",
      "State any missing numeric inputs as assumptions instead of inventing values.",
      "Keep decomposition edges directed from parent KPI to child driver."
    ],
    questionsForUser
  };
}
function createAgenticGeneratePrompt(request, selectedSkillExcerpts, classification = classifyVdtRequest(request)) {
  const decompositionPlan = planDecomposition(request, classification, selectedSkillExcerpts);
  const requestLines = Object.keys(FIELD_LABELS).map((key) => `${FIELD_LABELS[key]}: ${request[key] || "Not specified"}`).join("\n");
  const skillLines = selectedSkillExcerpts.map((skill) => [`Skill ${skill.id} (${skill.path})`, skill.excerpt].join("\n")).join("\n\n---\n\n");
  return {
    systemPromptAddition: [
      "Use the selected VDT skills as grounded decomposition guidance.",
      "Do not expose hidden chain-of-thought or invent progress messages.",
      "Return only the requested structured output when the provider call is made by the caller."
    ].join("\n"),
    userPromptAddition: [
      "Agentic VDT preparation",
      requestLines,
      "",
      `Classified domain: ${classification.domain}`,
      `Decomposition pattern: ${classification.pattern}`,
      "",
      "Selected skill excerpts:",
      skillLines || "No skill excerpts selected.",
      "",
      "Deterministic decomposition plan:",
      JSON.stringify(decompositionPlan, null, 2)
    ].join("\n"),
    decompositionPlan,
    finalReportSeed: buildFinalReportSeed(request, decompositionPlan)
  };
}
function prepareAgenticVdtRun(request, library, options = {}) {
  const runId = options.runId ?? `vdt-agent-${stableHash(JSON.stringify(request)).slice(0, 8)}`;
  const now = options.now ?? (() => /* @__PURE__ */ new Date());
  let eventIndex = 0;
  const events = [];
  const addEvent = (event) => {
    eventIndex += 1;
    events.push(createRunEvent(runId, eventIndex, now, event));
  };
  const classification = classifyVdtRequest(request);
  addEvent({
    type: "classification",
    title: "Request classified",
    message: `Classified request as ${classification.domain} / ${classification.pattern}.`,
    metadata: { ...classification }
  });
  const retrieveOptions = { classification };
  if (options.maxSkills !== void 0) {
    retrieveOptions.maxSkills = options.maxSkills;
  }
  const retrievedSkills = retrieveSkills(request, library, retrieveOptions);
  addEvent({
    type: "skill_search",
    title: "Skill search completed",
    message: `Found ${retrievedSkills.length} candidate skill${retrievedSkills.length === 1 ? "" : "s"}.`,
    metadata: {
      candidates: retrievedSkills.map((candidate) => ({
        id: candidate.skill.id,
        score: candidate.score,
        matchedTerms: candidate.matchedTerms
      }))
    }
  });
  for (const candidate of retrievedSkills) {
    addEvent({
      type: "skill_selected",
      title: "Skill selected",
      message: `Selected ${candidate.skill.id}: ${candidate.reason}`,
      metadata: { id: candidate.skill.id, path: candidate.skill.path, score: candidate.score }
    });
  }
  const skillExcerpts = readSkillExcerpts(retrievedSkills);
  for (const skill of skillExcerpts) {
    addEvent({
      type: "skill_read",
      title: "Skill read",
      message: `Read ${skill.id}: ${summarizeExcerpt(skill.excerpt)}.`,
      metadata: { id: skill.id, path: skill.path, excerptLength: skill.excerpt.length }
    });
  }
  const questions = buildClarifyingQuestions(request, skillExcerpts).slice(0, 3);
  const continueWithAssumptions = options.continueWithAssumptions ?? true;
  addEvent({
    type: "clarifying_questions",
    title: "Clarifying questions evaluated",
    message: questions.length === 0 ? "No clarifying questions required before drafting the first decomposition." : continueWithAssumptions ? `Prepared ${questions.length} question${questions.length === 1 ? "" : "s"}; continuing with explicit assumptions.` : `Prepared ${questions.length} question${questions.length === 1 ? "" : "s"} before graph generation.`,
    metadata: { questions, continueWithAssumptions }
  });
  const prompt = createAgenticGeneratePrompt(request, skillExcerpts, classification);
  addEvent({
    type: "planning_decomposition",
    title: "Decomposition plan prepared",
    message: `Prepared plan from ${prompt.decompositionPlan.selectedSkillIds.length} skill${prompt.decompositionPlan.selectedSkillIds.length === 1 ? "" : "s"}.`,
    metadata: { ...prompt.decompositionPlan }
  });
  addEvent({
    type: "planning_decomposition",
    title: "Report seed prepared",
    message: "Prepared a report seed for the eventual generated VDT.",
    metadata: { selectedSkillIds: prompt.decompositionPlan.selectedSkillIds }
  });
  const run = {
    runId,
    status: questions.length > 0 && !continueWithAssumptions ? "needs_user_input" : "running",
    phase: questions.length > 0 && !continueWithAssumptions ? "asking_clarifying_questions" : "generating_graph",
    request,
    selectedSkills: retrievedSkills.map((candidate) => ({
      id: candidate.skill.id,
      path: candidate.skill.path,
      reason: candidate.reason
    })),
    events
  };
  if (questions.length > 0 && !continueWithAssumptions) {
    run.questionsForUser = questions;
  }
  return { run, classification, skillExcerpts, prompt };
}
function finalizeAgenticVdtRun(run, input) {
  const now = input.now ?? (() => /* @__PURE__ */ new Date());
  const nextEvents = [...run.events];
  const addEvent = (event) => {
    nextEvents.push(createRunEvent(run.runId, nextEvents.length + 1, now, event));
  };
  addEvent({
    type: "model_call_completed",
    title: "Model call completed",
    message: "Graph generation completed and returned a candidate VDT.",
    metadata: { resultProjectId: input.resultProjectId }
  });
  addEvent({
    type: "graph_validation",
    title: "Graph validation completed",
    message: input.validationSummary,
    metadata: { resultProjectId: input.resultProjectId }
  });
  addEvent({
    type: "final_report",
    title: "Final report prepared",
    message: "Prepared final VDT report after graph generation and validation.",
    metadata: { resultProjectId: input.resultProjectId }
  });
  const finalized = {
    ...run,
    status: "succeeded",
    phase: "reporting",
    resultProjectId: input.resultProjectId,
    finalReport: input.finalReport,
    events: nextEvents
  };
  if (input.draftGraph !== void 0) {
    finalized.draftGraph = input.draftGraph;
  }
  return finalized;
}
function appendAgenticVdtRunEvent(run, event, options = {}) {
  const now = options.now ?? (() => /* @__PURE__ */ new Date());
  return {
    ...run,
    ...options.phase ? { phase: options.phase } : {},
    ...options.status ? { status: options.status } : {},
    events: [...run.events, createRunEvent(run.runId, run.events.length + 1, now, event)]
  };
}
function parseScalarFrontmatterValue(value) {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return parseStringValue(value);
}
function parseStringValue(value) {
  return value.replace(/^["']|["']$/g, "").trim();
}
function normalizeSkillFrontmatter(attributes, path6) {
  const getString = (key) => {
    const value = attributes[key];
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`Skill ${path6} is missing required string frontmatter: ${key}.`);
    }
    return value.trim();
  };
  const getStringArray = (key) => {
    const value = attributes[key];
    if (!Array.isArray(value)) {
      throw new Error(`Skill ${path6} is missing required list frontmatter: ${key}.`);
    }
    const values = value.map((item) => item.trim()).filter(Boolean);
    if (values.length === 0) {
      throw new Error(`Skill ${path6} must define at least one value for frontmatter list: ${key}.`);
    }
    return values;
  };
  const version = attributes.version;
  const frontmatter = {
    id: getString("id"),
    title: getString("title"),
    domain: getString("domain"),
    patterns: getStringArray("patterns"),
    kpiPatterns: getStringArray("kpi_patterns"),
    requires: getStringArray("requires"),
    outputs: getStringArray("outputs"),
    questions: getStringArray("questions")
  };
  if (typeof version === "number") {
    frontmatter.version = version;
  }
  return frontmatter;
}
function splitMarkdownTableRow(row) {
  return row.slice(1, -1).split("|").map((cell) => cell.trim());
}
function normalizeHeaderCells(cells) {
  return cells.map((cell) => cell.toLowerCase().replace(/\s+/g, " "));
}
function splitListCell(cell) {
  return cell.split(/[,;]/).map((value) => value.trim()).filter(Boolean);
}
function assertRegistryCoversSkills(registry2, skills) {
  const registryById = new Map(registry2.map((entry) => [entry.id, entry]));
  const missing = skills.filter((skill) => registryById.get(skill.id)?.path !== skill.path);
  if (missing.length > 0) {
    throw new Error(`Registry does not reference skill paths: ${missing.map((skill) => skill.path).join(", ")}`);
  }
  const incomplete = registry2.filter(
    (entry) => entry.matchingTerms.length === 0 || entry.kpiPatterns.length === 0 || entry.inputRequirements.length === 0 || entry.expectedOutputs.length === 0 || !entry.confidenceHints || !entry.whenNotToUse
  );
  if (incomplete.length > 0) {
    throw new Error(`Registry entries are missing required contract fields: ${incomplete.map((entry) => entry.id).join(", ")}`);
  }
}
function createRunEvent(runId, eventIndex, now, event) {
  return {
    id: `${runId}-event-${String(eventIndex).padStart(3, "0")}`,
    timestamp: now().toISOString(),
    ...event
  };
}
async function collectMarkdownFiles(rootDir, readdir, join2) {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path6 = join2(rootDir, entry.name);
      if (entry.isDirectory()) {
        return collectMarkdownFiles(path6, readdir, join2);
      }
      return entry.isFile() && entry.name.endsWith(".md") ? [path6] : [];
    })
  );
  return nested.flat().sort();
}
function normalizeText(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function includesTerm(haystack, term) {
  const normalizedTerm = normalizeText(term);
  return normalizedTerm.length > 0 && ` ${haystack} `.includes(` ${normalizedTerm} `);
}
function inferPattern(domain, haystack) {
  if (domain === "mining" && (includesTerm(haystack, "haulage") || includesTerm(haystack, "truck"))) {
    return "haulage_truck_cycle";
  }
  if (domain === "mining") {
    return "production_volume";
  }
  if (domain === "finance") {
    return "revenue_profit";
  }
  if (domain === "saas") {
    return "funnel_growth";
  }
  return "logical_kpi_decomposition";
}
function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}
function buildSelectionReason(skill, classification, matchedTerms) {
  const reasonParts = [];
  if (skill.domain === classification.domain) {
    reasonParts.push(`domain matched ${classification.domain}`);
  }
  if (matchedTerms.length > 0) {
    reasonParts.push(`matched ${matchedTerms.slice(0, 4).join(", ")}`);
  }
  if (skill.domain === "generic" && reasonParts.length === 0) {
    reasonParts.push("generic fallback coverage");
  }
  return reasonParts.join("; ") || "registry candidate selected by deterministic scoring";
}
function createSkillExcerpt(skill, maxChars) {
  const sections = ["When To Use", "Decomposition Pattern", "Formula Templates", "Required Inputs", "Warnings And Edge Cases"];
  const selected = sections.map((section) => extractMarkdownSection(skill.body, section)).filter(Boolean).join("\n\n");
  const excerpt = selected || skill.body;
  return excerpt.length > maxChars ? `${excerpt.slice(0, maxChars - 3).trimEnd()}...` : excerpt;
}
function extractMarkdownSection(markdown, title) {
  const pattern = new RegExp(`(^|\\n)## ${escapeRegExp(title)}\\n([\\s\\S]*?)(?=\\n## |$)`);
  return pattern.exec(markdown)?.[0].trim() ?? "";
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function extractFormulaTemplates(excerpt) {
  return excerpt.split(/\r?\n/).map((line) => line.replace(/^[-*]\s+/, "").trim()).filter((line) => /^[a-z][a-z0-9_]*\s*=/.test(line));
}
function buildClarifyingQuestions(request, skillExcerpts) {
  const questions = [];
  if (!request.timePeriod) {
    questions.push("What time period should the VDT use?");
  }
  if (!request.unit) {
    questions.push("What unit should the root KPI use?");
  }
  if (!request.businessContext && skillExcerpts[0]?.questions?.[0]) {
    questions.push(skillExcerpts[0].questions[0]);
  }
  return uniqueStrings(questions);
}
function summarizeExcerpt(excerpt) {
  if (excerpt.includes("Formula Templates")) {
    return "found formula templates and decomposition guidance";
  }
  return "found decomposition guidance";
}
function buildFinalReportSeed(request, plan) {
  return [
    `Root KPI: ${request.rootKpi}`,
    `Domain classification: ${plan.domain} / ${plan.pattern}`,
    `Selected skills: ${plan.selectedSkillIds.join(", ") || "none"}`,
    `First-level driver families: ${plan.firstLevelDrivers.join(", ") || "to be generated"}`,
    `Formula families: ${plan.formulaTemplates.slice(0, 4).join("; ") || "to be generated"}`,
    `Assumptions: ${plan.assumptions.join(" ")}`,
    `Questions: ${plan.questionsForUser.join(" ") || "none for initial draft"}`,
    "Validation result: pending graph generation and validator execution.",
    "Recommended next deepen action: inspect weak or assumption-heavy first-level drivers."
  ].join("\n");
}
function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// ../local-runner/src/server/executor.ts
import { execFile as execFile7, spawn as nodeSpawn } from "node:child_process";
import { chmod, copyFile, lstat, mkdir, mkdtemp as mkdtemp3, readFile, realpath, rm as rm3, writeFile as writeFile2 } from "node:fs/promises";
import os3 from "node:os";
import path5 from "node:path";
import { promisify as promisify7 } from "node:util";
var advisoryStub = Object.freeze({
  assumptions: [],
  questionsForUser: [],
  warnings: []
});
var mockNode = Object.freeze({
  id: "root",
  name: "Root KPI",
  description: "Mock root KPI.",
  type: "root_kpi",
  unit: "units",
  aiConfidence: 0.9,
  aiRationale: "Mock schema-valid node.",
  controllability: "medium",
  materiality: "high"
});
var MOCK_STUB_OUTPUT = {
  "connection-test-v1": { ok: true },
  "generate-tree-v1": { projectTitle: "Mock tree", rootNodeId: "root", nodes: [mockNode], edges: [], ...advisoryStub },
  "deepen-node-v1": { targetNodeId: "node-1", nodes: [{ ...mockNode, id: "child_a", name: "Child A" }], edges: [], ...advisoryStub },
  "simplify-branch-v1": { branchRootNodeId: "node-1", nodeRemovals: [], edgeChanges: [], rationale: "Mock", ...advisoryStub },
  "suggest-alternative-v1": { targetNodeId: "node-1", nodes: [{ ...mockNode, id: "alternative_a", name: "Alternative A" }], edges: [], rationale: "Mock", ...advisoryStub },
  "suggest-formula-v1": { nodeId: "node-1", proposedFormula: "1", aiRationale: "Mock", confidence: 0.5, ...advisoryStub },
  "review-model-v1": { findings: [], ...advisoryStub },
  "check-units-v1": { unitFindings: [], ...advisoryStub },
  "identify-missing-drivers-v1": { missingDrivers: [], ...advisoryStub },
  "identify-duplicate-drivers-v1": { duplicateClusters: [], ...advisoryStub },
  "explain-node-v1": { nodeId: "node-1", explanation: "Mock", keyDrivers: [], assumptions: [], questionsForUser: [] },
  "explain-scenario-v1": { scenarioId: "scenario-1", narrative: "Mock", impactHighlights: [], assumptions: [], questionsForUser: [] },
  "generate-executive-summary-v1": { headline: "Mock", keyDrivers: [], risks: [], recommendations: [] }
};
function isRecord9(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function mockOutput(schemaId, input) {
  if (isRecord9(input) && validateRegisteredSchema(schemaId, input)) return input;
  return MOCK_STUB_OUTPUT[schemaId];
}
var EXECUTION_LIMITS = Object.freeze({
  maxPromptBytes: 512 * 1024,
  maxLineBytes: 1024 * 1024,
  maxStdoutBytes: 4 * 1024 * 1024,
  maxStderrBytes: 1024 * 1024,
  maxResultBytes: 1024 * 1024,
  maxRepairExcerptBytes: 16 * 1024,
  repairTimeoutMs: 6e4,
  timeoutMs: 12e4,
  killGraceMs: 3e3
});
var ALLOWED_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "NO_COLOR",
  "VDT_FAKE_CURSOR_MODE",
  "VDT_FAKE_CODEX_MODE",
  "VDT_FAKE_CLAUDE_MODE",
  "VDT_FAKE_GEMINI_MODE",
  "VDT_FAKE_COPILOT_MODE"
];
var CODEX_HOME_COPY_FILES = ["auth.json", "installation_id", "models_cache.json"];
function byteLength7(value) {
  return Buffer.byteLength(value, "utf8");
}
function abortError(message = "Completion was cancelled.") {
  return Object.assign(new Error(message), { name: "AbortError", code: "CANCELLED" });
}
function safeEnvironment(source) {
  const result = {};
  for (const key of ALLOWED_ENV_KEYS) {
    const value = source[key];
    if (value !== void 0) result[key] = value;
  }
  result.NO_COLOR = "1";
  return result;
}
async function defaultResolveExecutable(manifest, env) {
  const cli = manifest.cli;
  if (!cli) throw Object.assign(new Error("Backend has no executable manifest."), { code: "INVALID_MANIFEST" });
  const pathValue = env.PATH ?? "";
  for (const alias of cli.executableAliases) {
    if (alias.includes("\0") || path5.basename(alias) !== alias || alias === "." || alias === "..") continue;
    for (const directory of pathValue.split(path5.delimiter).filter((entry) => path5.isAbsolute(entry))) {
      const candidate = path5.resolve(directory, alias);
      try {
        const info = await lstat(candidate);
        if (!info.isSymbolicLink() && !info.isFile()) continue;
        const resolved = await realpath(candidate);
        if (!path5.isAbsolute(resolved)) continue;
        const resolvedInfo = await lstat(resolved);
        if (!resolvedInfo.isFile()) continue;
        const projectRoot = path5.resolve(process.cwd());
        if (resolved === projectRoot || resolved.startsWith(`${projectRoot}${path5.sep}`)) continue;
        return resolved;
      } catch {
      }
    }
  }
  throw Object.assign(new Error(`${manifest.label} executable was not found as a regular non-symlink file on PATH.`), {
    code: "BACKEND_NOT_INSTALLED"
  });
}
async function normalizeResolvedExecutable(executable) {
  if (!path5.isAbsolute(executable) || executable.includes("\0")) {
    throw Object.assign(new Error("Resolved executable must be an absolute path without NUL bytes."), { code: "UNSAFE_EXECUTABLE" });
  }
  try {
    return await realpath(executable);
  } catch {
    return executable;
  }
}
function isJavaScriptExecutable(executable) {
  return /\.(?:mjs|cjs|js)$/i.test(executable);
}
function isPathInside(root, candidate) {
  const relative = path5.relative(path5.resolve(root), path5.resolve(candidate));
  return relative === "" || !!relative && !relative.startsWith("..") && !path5.isAbsolute(relative);
}
function shouldLocalizeJavaScriptExecutable(executable, options) {
  return options.resolveExecutable !== void 0 && isPathInside(process.cwd(), executable);
}
function errorCode(error2) {
  return typeof error2 === "object" && error2 !== null && "code" in error2 ? String(error2.code) : void 0;
}
async function copyCodexHomeFile(sourceDir, targetDir, fileName) {
  try {
    const targetPath = path5.join(targetDir, fileName);
    await copyFile(path5.join(sourceDir, fileName), targetPath);
    await chmod(targetPath, 384);
  } catch (error2) {
    if (errorCode(error2) === "ENOENT") return;
    throw error2;
  }
}
async function prepareEphemeralCodexHome(cwd, envSource) {
  const sourceCodexHome = envSource.CODEX_HOME ?? (envSource.HOME ? path5.join(envSource.HOME, ".codex") : void 0);
  if (!sourceCodexHome) return void 0;
  const codexHome = path5.join(cwd, "codex-home");
  await mkdir(codexHome, { recursive: true, mode: 448 });
  await chmod(codexHome, 448);
  for (const fileName of CODEX_HOME_COPY_FILES) {
    await copyCodexHomeFile(sourceCodexHome, codexHome, fileName);
  }
  return codexHome;
}
function isEphemeralWorkspaceCertified(manifest) {
  return manifest.id === "cursor_subscription" && manifest.kind === "subscription_cli" && manifest.safety.ephemeralWorkspaceOnly === true && manifest.safety.trustEphemeralWorkspace === true && manifest.safety.requiresOsSandbox === false;
}
function assertManifestSafe(manifest) {
  if (manifest.kind !== "subscription_cli" && manifest.kind !== "custom_cli") return;
  if (manifest.cli?.args) {
    assertArgsSafe(manifest.cli.args, {
      allowScopedTrust: manifest.safety.trustEphemeralWorkspace === true
    });
  }
  const { certified, toolsDisabled, requiresOsSandbox } = manifest.safety;
  const ephemeralWorkspaceCertified = isEphemeralWorkspaceCertified(manifest);
  if (!certified || requiresOsSandbox || !toolsDisabled && !ephemeralWorkspaceCertified) {
    throw Object.assign(new Error(`${manifest.label} is not certified for isolated execution.`), {
      code: "UNSAFE_CONFIGURATION"
    });
  }
}
function assertLineLimit(value) {
  for (const line of value.split(/\r?\n/)) {
    if (byteLength7(line) > EXECUTION_LIMITS.maxLineBytes) {
      throw Object.assign(new Error("Backend output line exceeds the configured limit."), { code: "OUTPUT_LINE_TOO_LARGE" });
    }
  }
}
function truncateForRepair(value) {
  if (byteLength7(value) <= EXECUTION_LIMITS.maxRepairExcerptBytes) return value;
  let end = Math.min(value.length, EXECUTION_LIMITS.maxRepairExcerptBytes);
  while (end > 0 && byteLength7(value.slice(0, end)) > EXECUTION_LIMITS.maxRepairExcerptBytes) {
    end -= 1;
  }
  return `${value.slice(0, end)}
[truncated]`;
}
function tailForDiagnostics(value, maxBytes = 2048) {
  if (!value.trim()) return "";
  let start = Math.max(0, value.length - maxBytes);
  while (start < value.length && byteLength7(value.slice(start)) > maxBytes) {
    start += 1;
  }
  return value.slice(start).replace(/\s+/g, " ").trim();
}
function timeoutDiagnostic(stdout, stderr, timeoutMs) {
  const stdoutBytes = byteLength7(stdout);
  const stderrBytes = byteLength7(stderr);
  const parts = [`after ${timeoutMs}ms`, `stdout=${stdoutBytes} bytes`, `stderr=${stderrBytes} bytes`];
  const stderrTail = tailForDiagnostics(stderr);
  const stdoutTail = tailForDiagnostics(stdout);
  if (stderrTail) parts.push(`stderrTail=${JSON.stringify(stderrTail)}`);
  if (stdoutTail) parts.push(`stdoutTail=${JSON.stringify(stdoutTail)}`);
  return parts.join("; ");
}
function validationSummary(schemaId, output) {
  const schema = getRegisteredJsonSchema(schemaId);
  const required = Array.isArray(schema.required) ? schema.required.filter((key) => typeof key === "string") : [];
  const missing = isRecord9(output) ? required.filter((key) => !(key in output)) : required;
  const detailed = validateRegisteredSchemaDetailed(schemaId, output).errors;
  return [
    `Output must be one JSON object for schema ${schemaId}.`,
    ...missing.length > 0 ? [`Missing required keys: ${missing.join(", ")}.`] : [],
    ...detailed.slice(0, 12),
    "Nested values must match the registered VDT runtime schema."
  ];
}
function buildRepairMessages(schemaId, request, invalidJson, parsedOutput) {
  return [
    {
      role: "system",
      content: [
        "Repair one invalid VDT JSON response.",
        "Return exactly one corrected JSON object.",
        "Do not include markdown fences, commentary, file paths, environment values, credentials, or tokens."
      ].join(" ")
    },
    {
      role: "user",
      content: JSON.stringify({
        taskType: request.taskType,
        schemaId,
        validationErrors: validationSummary(schemaId, parsedOutput),
        invalidJsonExcerpt: truncateForRepair(invalidJson)
      })
    }
  ];
}
function buildSubscriptionPrompt(request) {
  const schemaId = request.schemaId;
  return [
    `Return only JSON matching approved schema ${request.schemaId} for VDT task ${request.taskType}.`,
    "Do not include markdown fences or commentary.",
    "Do not use tools, run commands, inspect files, edit files, or wait for user input. Answer directly from the provided request.",
    JSON.stringify({
      schemaId: request.schemaId,
      taskType: request.taskType,
      outputJsonSchema: getStrictResponseJsonSchema(schemaId),
      input: request.input,
      ...request.model ? { model: request.model } : {}
    })
  ].join("\n");
}
function buildRepairPrompt(request, invalidJson, parsedOutput) {
  return [
    `Repair JSON for approved schema ${request.schemaId} and VDT task ${request.taskType}.`,
    "Return exactly one corrected JSON object.",
    "Do not include markdown fences, commentary, file paths, environment values, credentials, or tokens.",
    JSON.stringify({
      taskType: request.taskType,
      schemaId: request.schemaId,
      validationErrors: validationSummary(request.schemaId, parsedOutput),
      invalidJsonExcerpt: truncateForRepair(invalidJson)
    })
  ].join("\n");
}
async function probeExecutableVersion(executable, versionArgs) {
  try {
    const result = await promisify7(execFile7)(executable, [...versionArgs], {
      encoding: "utf8",
      timeout: 5e3,
      maxBuffer: 64 * 1024,
      windowsHide: true,
      shell: false
    });
    const combined = `${result.stdout}
${result.stderr}`.trim();
    return combined || void 0;
  } catch {
    return void 0;
  }
}
async function executableHelpIncludes(executable, needle) {
  try {
    const result = await promisify7(execFile7)(executable, ["--help"], {
      encoding: "utf8",
      timeout: 5e3,
      maxBuffer: 256 * 1024,
      windowsHide: true,
      shell: false
    });
    return `${result.stdout}
${result.stderr}`.includes(needle);
  } catch {
    return false;
  }
}
async function executeCli(manifest, request, signal, options) {
  assertManifestSafe(manifest);
  const adapter = manifest.kind === "subscription_cli" ? getSubscriptionCliAdapter(manifest.id) : void 0;
  const envSource = options.env ?? process.env;
  const executable = await normalizeResolvedExecutable(await (options.resolveExecutable ?? defaultResolveExecutable)(manifest, envSource));
  const payload = JSON.stringify({
    requestId: request.requestId,
    taskType: request.taskType,
    schemaId: request.schemaId,
    input: request.input,
    ...request.model ? { model: request.model } : {}
  });
  if (byteLength7(payload) > EXECUTION_LIMITS.maxPromptBytes) {
    throw Object.assign(new Error("Completion request exceeds the prompt limit."), { code: "PROMPT_TOO_LARGE" });
  }
  const executableVersion = manifest.cli?.versionArgs?.length && !isJavaScriptExecutable(executable) ? await probeExecutableVersion(executable, manifest.cli.versionArgs) : void 0;
  async function runCliAttempt(prompt, timeoutMs, requestJson = payload) {
    if (byteLength7(prompt) > EXECUTION_LIMITS.maxPromptBytes) {
      throw Object.assign(new Error("Completion request exceeds the prompt limit."), { code: "PROMPT_TOO_LARGE" });
    }
    const tempRoot = options.tempRoot ?? os3.tmpdir();
    await mkdir(tempRoot, { recursive: true });
    const cwd = await mkdtemp3(path5.join(tempRoot, "vdt-run-"));
    await chmod(cwd, 448);
    const requestPath = path5.join(cwd, "request.json");
    await writeFile2(requestPath, requestJson, { encoding: "utf8", mode: 384, flag: "wx" });
    const promptPath = path5.join(cwd, "prompt.txt");
    await writeFile2(promptPath, prompt, { encoding: "utf8", mode: 384, flag: "wx" });
    const schemaPath = path5.join(cwd, "schema.json");
    await writeFile2(schemaPath, `${JSON.stringify(getStrictResponseJsonSchema(request.schemaId), null, 2)}
`, {
      encoding: "utf8",
      mode: 384,
      flag: "wx"
    });
    const outputPath = path5.join(cwd, "last-message.json");
    const toolPolicyPath = path5.join(cwd, "deny-all-tools.toml");
    await writeFile2(
      toolPolicyPath,
      '[[rule]]\ntoolName = "*"\ndecision = "deny"\npriority = 999\n',
      { encoding: "utf8", mode: 384, flag: "wx" }
    );
    const promptText = await readFile(promptPath, "utf8");
    const staticArgs = manifest.cli?.args ?? [];
    const dynamicArgs = adapter ? adapter.buildArgs({
      ...request.model ? { model: request.model } : {},
      cwd,
      promptPath,
      promptText,
      schemaPath,
      outputPath,
      toolPolicyPath,
      enableWorkspaceTrust: manifest.id === "cursor_subscription" && manifest.safety.trustEphemeralWorkspace === true && await executableHelpIncludes(executable, "--trust")
    }) : [];
    let command = executable;
    let spawnArgs = [...staticArgs, ...dynamicArgs];
    assertArgsSafe(spawnArgs, {
      allowScopedTrust: manifest.safety.trustEphemeralWorkspace === true
    });
    if (isJavaScriptExecutable(executable)) {
      let scriptPath = executable;
      if (shouldLocalizeJavaScriptExecutable(executable, options)) {
        scriptPath = path5.join(cwd, path5.basename(executable));
        await copyFile(executable, scriptPath);
        await chmod(scriptPath, 448);
      }
      command = process.execPath;
      spawnArgs = [scriptPath, ...spawnArgs];
    }
    let finalArgs = spawnArgs;
    const childEnv = safeEnvironment(envSource);
    if (manifest.id === "cursor_subscription") {
      childEnv.NODE_COMPILE_CACHE = path5.join(cwd, "node-compile-cache");
    }
    if (manifest.id === "codex_subscription") {
      const codexHome = await prepareEphemeralCodexHome(cwd, envSource);
      if (codexHome) childEnv.CODEX_HOME = codexHome;
    }
    const child = (options.spawn ?? ((spawnCommand, args, spawnOptions) => nodeSpawn(spawnCommand, [...args], spawnOptions)))(
      command,
      finalArgs,
      { cwd, env: childEnv, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    let timeout;
    let forceKill;
    let cancelled = false;
    let outputLimitExceeded = false;
    const terminate = () => {
      cancelled = true;
      child.kill("SIGTERM");
      forceKill = setTimeout(() => child.kill("SIGKILL"), EXECUTION_LIMITS.killGraceMs);
      forceKill.unref?.();
    };
    signal.addEventListener("abort", terminate, { once: true });
    const effectiveTimeout = Math.min(timeoutMs, EXECUTION_LIMITS.timeoutMs);
    timeout = setTimeout(terminate, effectiveTimeout);
    timeout.unref?.();
    let completionSettled = false;
    let streamingResult;
    let streamingError;
    const stopChildAfterStreamingResult = () => {
      child.kill("SIGTERM");
      const streamKill = setTimeout(() => child.kill("SIGKILL"), 50);
      streamKill.unref?.();
      child.once("close", () => clearTimeout(streamKill));
    };
    const completion = new Promise((resolve, reject) => {
      const settle = (event) => {
        if (completionSettled) return;
        completionSettled = true;
        resolve(event);
      };
      const fail = (error2) => {
        if (completionSettled) return;
        completionSettled = true;
        reject(error2);
      };
      const trySettleFromStream = () => {
        if (!adapter?.parseStreamingOutput) return;
        if (streamingResult || streamingError !== void 0) return;
        let output;
        try {
          output = normalizeRegisteredSchemaOutput(
            request.schemaId,
            adapter.parseStreamingOutput(stdout, stderr, request.schemaId)
          );
        } catch (error2) {
          streamingError = error2;
          stopChildAfterStreamingResult();
          return;
        }
        if (output === void 0 || !validateRegisteredSchema(request.schemaId, output)) return;
        streamingResult = {
          output,
          rawText: stdout,
          outputBytes: byteLength7(stdout),
          schemaValid: true,
          exitCode: 0,
          ...executableVersion === void 0 ? {} : { executableVersion }
        };
        stopChildAfterStreamingResult();
      };
      child.once("error", fail);
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
        if (byteLength7(stdout) > EXECUTION_LIMITS.maxStdoutBytes) {
          outputLimitExceeded = true;
          terminate();
          return;
        }
        trySettleFromStream();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
        if (byteLength7(stderr) > EXECUTION_LIMITS.maxStderrBytes) {
          outputLimitExceeded = true;
          terminate();
          return;
        }
        trySettleFromStream();
      });
      child.once("close", (code) => {
        if (streamingError !== void 0) {
          fail(streamingError);
          return;
        }
        if (streamingResult) {
          settle({ type: "stream", result: streamingResult });
          return;
        }
        settle({ type: "exit", exitCode: code ?? -1 });
      });
    });
    try {
      if (signal.aborted) terminate();
      if (adapter) {
        if (adapter.spawnHints?.stdin === "prompt") {
          child.stdin.end(promptText);
        } else {
          child.stdin.end();
        }
      } else {
        child.stdin.end(requestJson);
      }
      const completed = await completion;
      if (completed.type === "stream") return completed.result;
      const exitCode = completed.exitCode;
      if (cancelled) {
        if (byteLength7(stdout) > EXECUTION_LIMITS.maxStdoutBytes || byteLength7(stderr) > EXECUTION_LIMITS.maxStderrBytes) {
          throw Object.assign(new Error("Backend output exceeded the configured limit."), { code: "OUTPUT_TOO_LARGE" });
        }
        if (signal.aborted) throw abortError();
        throw Object.assign(new Error(`Backend timed out (${timeoutDiagnostic(stdout, stderr, effectiveTimeout)}).`), {
          code: "TIMEOUT",
          rawText: stdout
        });
      }
      if (exitCode !== 0) {
        if (adapter) {
          try {
            adapter.parseOutput(stdout, stderr, request.schemaId);
          } catch (error2) {
            throw error2;
          }
        }
        throw Object.assign(new Error(`Backend exited with code ${exitCode}; stderr contained ${byteLength7(stderr)} bytes.`), {
          code: "BACKEND_EXIT_FAILED",
          exitCode
        });
      }
      assertLineLimit(stdout);
      if (byteLength7(stdout) > EXECUTION_LIMITS.maxResultBytes && !adapter) {
        throw Object.assign(new Error("Backend result exceeds the configured limit."), { code: "OUTPUT_TOO_LARGE" });
      }
      const parsedOutput = adapter ? adapter.parseOutput(stdout, stderr, request.schemaId) : extractBoundedJson(stdout, EXECUTION_LIMITS.maxResultBytes);
      const output = normalizeRegisteredSchemaOutput(request.schemaId, parsedOutput);
      const schemaValid = validateRegisteredSchema(request.schemaId, output);
      if (!schemaValid) {
        throw Object.assign(new Error("Backend output failed registered schema validation."), {
          code: "SCHEMA_INVALID",
          output,
          rawText: stdout
        });
      }
      return {
        output,
        rawText: stdout,
        outputBytes: byteLength7(stdout),
        schemaValid,
        exitCode,
        ...executableVersion === void 0 ? {} : { executableVersion }
      };
    } catch (error2) {
      if (outputLimitExceeded) {
        throw Object.assign(new Error("Backend output exceeded the configured limit."), { code: "OUTPUT_TOO_LARGE" });
      }
      if (error2 instanceof Error && !("rawText" in error2) && error2.code === "BACKEND_PARSE_FAILED") {
        throw Object.assign(error2, { rawText: stdout });
      }
      throw error2;
    } finally {
      signal.removeEventListener("abort", terminate);
      if (timeout) clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      await rm3(cwd, { recursive: true, force: true });
    }
  }
  const first = await runCliAttempt(buildSubscriptionPrompt(request), request.timeoutMs ?? EXECUTION_LIMITS.timeoutMs).catch(
    async (error2) => {
      const code = typeof error2 === "object" && error2 !== null && "code" in error2 ? String(error2.code) : "";
      if (code !== "SCHEMA_INVALID" && code !== "BACKEND_PARSE_FAILED") throw error2;
      const parsedOutput = typeof error2 === "object" && error2 !== null && "output" in error2 ? error2.output : void 0;
      const invalidText = parsedOutput === void 0 ? typeof error2 === "object" && error2 !== null && "rawText" in error2 && typeof error2.rawText === "string" ? error2.rawText : error2 instanceof Error ? error2.message : "Invalid provider output." : JSON.stringify(parsedOutput);
      let repaired;
      try {
        repaired = await runCliAttempt(
          buildRepairPrompt(request, invalidText, parsedOutput),
          Math.min(EXECUTION_LIMITS.repairTimeoutMs, request.timeoutMs ?? EXECUTION_LIMITS.repairTimeoutMs),
          JSON.stringify({
            requestId: request.requestId,
            taskType: request.taskType,
            schemaId: request.schemaId,
            repair: true
          })
        );
      } catch (repairError) {
        if (repairError instanceof Error) {
          throw Object.assign(repairError, { repairAttempted: true, repairSucceeded: false });
        }
        throw repairError;
      }
      return {
        ...repaired,
        outputBytes: repaired.outputBytes + byteLength7(invalidText),
        repaired: true,
        repairAttempted: true,
        repairSucceeded: true
      };
    }
  );
  return first;
}
async function readBoundedResponse(response) {
  if (response.redirected) throw Object.assign(new Error("Provider redirects are disabled."), { code: "REDIRECT_BLOCKED" });
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > EXECUTION_LIMITS.maxStdoutBytes) {
    throw Object.assign(new Error("Provider response exceeds the configured limit."), { code: "OUTPUT_TOO_LARGE" });
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > EXECUTION_LIMITS.maxStdoutBytes) {
      await reader.cancel();
      throw Object.assign(new Error("Provider response exceeds the configured limit."), { code: "OUTPUT_TOO_LARGE" });
    }
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
async function postLocalHttpChat(manifest, messages, signal, options, request, timeoutMs) {
  if (!manifest.localHttp) throw Object.assign(new Error("Backend has no local HTTP manifest."), { code: "INVALID_MANIFEST" });
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, Math.min(timeoutMs, EXECUTION_LIMITS.timeoutMs));
  timeout.unref?.();
  let response;
  let rawResponse;
  try {
    response = await (options.fetch ?? fetch)(`${manifest.localHttp.baseUrl}/chat/completions`, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: request.model ?? manifest.localHttp.defaultModel,
        temperature: 0,
        response_format: { type: "json_object" },
        messages
      })
    });
    rawResponse = await readBoundedResponse(response);
    assertLineLimit(rawResponse);
  } catch (error2) {
    if (controller.signal.aborted) {
      if (signal.aborted) throw abortError();
      throw Object.assign(new Error("Local provider timed out."), { code: "TIMEOUT" });
    }
    throw error2;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
  if (!response.ok) throw Object.assign(new Error(`Local provider failed with status ${response.status}.`), { code: "LOCAL_HTTP_FAILED" });
  const envelope = JSON.parse(rawResponse);
  const content = envelope.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw Object.assign(new Error("Local provider response did not contain message content."), { code: "INVALID_PROVIDER_RESPONSE" });
  return content;
}
async function executeLocalHttp(manifest, request, signal, options) {
  const schemaId = request.schemaId;
  const content = await postLocalHttpChat(
    manifest,
    [
      { role: "system", content: `Return one JSON object for VDT task ${request.taskType} matching approved schema ${request.schemaId}.` },
      { role: "user", content: JSON.stringify(request.input) }
    ],
    signal,
    options,
    request,
    request.timeoutMs ?? EXECUTION_LIMITS.timeoutMs
  );
  let output;
  let schemaValid = false;
  try {
    output = normalizeRegisteredSchemaOutput(schemaId, extractBoundedJson(content, EXECUTION_LIMITS.maxResultBytes));
    schemaValid = validateRegisteredSchema(schemaId, output);
  } catch {
    output = void 0;
  }
  if (schemaValid) return { output, outputBytes: byteLength7(content), schemaValid };
  let repairedContent;
  let repairedOutput;
  try {
    repairedContent = await postLocalHttpChat(
      manifest,
      buildRepairMessages(schemaId, request, output === void 0 ? content : JSON.stringify(output), output),
      signal,
      options,
      request,
      Math.min(EXECUTION_LIMITS.repairTimeoutMs, request.timeoutMs ?? EXECUTION_LIMITS.repairTimeoutMs)
    );
    repairedOutput = normalizeRegisteredSchemaOutput(
      schemaId,
      extractBoundedJson(repairedContent, EXECUTION_LIMITS.maxResultBytes)
    );
    const repairedSchemaValid = validateRegisteredSchema(schemaId, repairedOutput);
    if (!repairedSchemaValid) {
      throw Object.assign(new Error("Backend output failed registered schema validation after one repair attempt."), {
        code: "SCHEMA_INVALID"
      });
    }
  } catch (repairError) {
    if (repairError instanceof Error) {
      throw Object.assign(repairError, { repairAttempted: true, repairSucceeded: false });
    }
    throw repairError;
  }
  return {
    output: repairedOutput,
    outputBytes: byteLength7(content) + byteLength7(repairedContent),
    schemaValid: true,
    repaired: true,
    repairAttempted: true,
    repairSucceeded: true
  };
}
async function executeCompletion(manifest, request, signal, options = {}) {
  if (!isVdtSchemaId(request.schemaId)) throw Object.assign(new Error("Unknown schemaId."), { code: "UNKNOWN_SCHEMA" });
  if (signal.aborted) throw abortError();
  const prompt = JSON.stringify({
    requestId: request.requestId,
    taskType: request.taskType,
    schemaId: request.schemaId,
    input: request.input,
    ...request.model ? { model: request.model } : {}
  });
  if (byteLength7(prompt) > EXECUTION_LIMITS.maxPromptBytes) {
    throw Object.assign(new Error("Completion request exceeds the prompt limit."), { code: "PROMPT_TOO_LARGE" });
  }
  if (manifest.kind === "mock") {
    const output = mockOutput(request.schemaId, request.input);
    const schemaValid = validateRegisteredSchema(request.schemaId, output);
    if (!schemaValid) throw Object.assign(new Error("Mock input failed registered schema validation."), { code: "SCHEMA_INVALID" });
    return { output, outputBytes: byteLength7(JSON.stringify(output)), schemaValid };
  }
  if (manifest.kind === "local_http") return executeLocalHttp(manifest, request, signal, options);
  return executeCli(manifest, request, signal, options);
}
async function listBackendModels(manifest, signal, options = {}) {
  if (!manifest.modelSelection) return [];
  if (signal.aborted) throw abortError("Model listing was cancelled.");
  if (manifest.kind !== "subscription_cli") return [];
  const adapter = getSubscriptionCliAdapter(manifest.id);
  if (!adapter?.listModels) return [];
  const envSource = options.env ?? process.env;
  const executable = await normalizeResolvedExecutable(await (options.resolveExecutable ?? defaultResolveExecutable)(manifest, envSource));
  const fixtureExecFile = isJavaScriptExecutable(executable) ? (async (_executable, args, execOptions) => {
    const result = await promisify7(execFile7)(process.execPath, [executable, ...args], execOptions);
    return { stdout: result.stdout, stderr: result.stderr };
  }) : void 0;
  return adapter.listModels(executable, { signal, ...fixtureExecFile ? { execFile: fixtureExecFile } : {} });
}

// ../local-runner/src/server/manifests.ts
var ALL_VDT_TASK_TYPES = VDT_OUTPUT_SCHEMA_IDS.map((schemaId) => schemaTasks[schemaId]);
var ALL_VDT_SCHEMA_IDS = VDT_SCHEMA_IDS;
var BUILTIN_BACKEND_MANIFESTS = Object.freeze([
  {
    id: "mock",
    label: "Safe Mock",
    kind: "mock",
    supportLevel: "supported",
    taskTypes: ALL_VDT_TASK_TYPES,
    schemaIds: ALL_VDT_SCHEMA_IDS,
    modelSelection: false,
    safety: { toolsDisabled: true, requiresOsSandbox: false, certified: true }
  },
  {
    id: "ollama",
    label: "Ollama",
    kind: "local_http",
    supportLevel: "supported",
    taskTypes: ALL_VDT_TASK_TYPES,
    schemaIds: ALL_VDT_SCHEMA_IDS,
    modelSelection: true,
    localHttp: { baseUrl: "http://127.0.0.1:11434/v1", defaultModel: "qwen3" },
    safety: { toolsDisabled: true, requiresOsSandbox: false, certified: true }
  },
  {
    id: "lm_studio",
    label: "LM Studio",
    kind: "local_http",
    supportLevel: "supported",
    taskTypes: ALL_VDT_TASK_TYPES,
    schemaIds: ALL_VDT_SCHEMA_IDS,
    modelSelection: true,
    localHttp: { baseUrl: "http://127.0.0.1:1234/v1", defaultModel: "local-model" },
    safety: { toolsDisabled: true, requiresOsSandbox: false, certified: true }
  },
  {
    id: "vllm",
    label: "vLLM",
    kind: "local_http",
    supportLevel: "beta",
    taskTypes: ALL_VDT_TASK_TYPES,
    schemaIds: ALL_VDT_SCHEMA_IDS,
    modelSelection: true,
    localHttp: { baseUrl: "http://127.0.0.1:8000/v1", defaultModel: "local-model" },
    safety: { toolsDisabled: true, requiresOsSandbox: false, certified: true }
  },
  {
    id: "cursor_subscription",
    label: "Cursor Agent",
    kind: "subscription_cli",
    supportLevel: "beta",
    taskTypes: ALL_VDT_TASK_TYPES,
    schemaIds: ALL_VDT_SCHEMA_IDS,
    modelSelection: true,
    cli: {
      executableAliases: ["agent", "cursor-agent", "cursor"],
      args: ["--print", "--output-format", "stream-json", "--stream-partial-output", "--mode", "ask"],
      versionArgs: ["--version"]
    },
    safety: {
      toolsDisabled: false,
      requiresOsSandbox: false,
      certified: true,
      ephemeralWorkspaceOnly: true,
      trustEphemeralWorkspace: true
    }
  },
  {
    id: "codex_subscription",
    label: "Codex CLI",
    kind: "subscription_cli",
    supportLevel: "alpha",
    taskTypes: ALL_VDT_TASK_TYPES,
    schemaIds: ALL_VDT_SCHEMA_IDS,
    modelSelection: true,
    cli: {
      executableAliases: ["codex"],
      args: [
        "exec",
        "--ephemeral",
        "--json",
        "--color",
        "never",
        "--skip-git-repo-check",
        "--ignore-rules",
        "--sandbox",
        "workspace-write",
        "-c",
        "sandbox_workspace_write.network_access=true",
        "-c",
        'service_tier="fast"'
      ],
      versionArgs: ["--version"]
    },
    safety: { toolsDisabled: true, requiresOsSandbox: false, certified: true }
  },
  {
    id: "claude_subscription",
    label: "Claude Code",
    kind: "subscription_cli",
    supportLevel: "alpha",
    taskTypes: ALL_VDT_TASK_TYPES,
    schemaIds: ALL_VDT_SCHEMA_IDS,
    modelSelection: true,
    cli: {
      executableAliases: ["claude"],
      args: [
        "-p",
        "--output-format",
        "json",
        "--no-session-persistence",
        "--tools",
        "",
        "--disallowedTools",
        "*",
        "--strict-mcp-config"
      ],
      versionArgs: ["--version"]
    },
    safety: { toolsDisabled: true, requiresOsSandbox: false, certified: true }
  },
  {
    id: "gemini_subscription",
    label: "Gemini CLI",
    kind: "subscription_cli",
    supportLevel: "experimental",
    taskTypes: ALL_VDT_TASK_TYPES,
    schemaIds: ALL_VDT_SCHEMA_IDS,
    modelSelection: true,
    cli: {
      executableAliases: ["gemini"],
      args: ["--output-format", "json", "--approval-mode", "default"],
      versionArgs: ["--version"]
    },
    safety: {
      toolsDisabled: true,
      requiresOsSandbox: false,
      certified: true
    }
  },
  {
    id: "copilot_subscription",
    label: "GitHub Copilot CLI",
    kind: "subscription_cli",
    supportLevel: "experimental",
    taskTypes: ALL_VDT_TASK_TYPES,
    schemaIds: ALL_VDT_SCHEMA_IDS,
    modelSelection: true,
    cli: {
      executableAliases: ["copilot"],
      args: [
        "--output-format=json",
        "--stream=off",
        "--available-tools=",
        "--disable-builtin-mcps",
        "--no-custom-instructions",
        "--no-ask-user",
        "--no-auto-update"
      ],
      versionArgs: ["--version"]
    },
    safety: {
      toolsDisabled: true,
      requiresOsSandbox: false,
      certified: true
    }
  }
]);
function createManifestRegistry(additional = []) {
  const registry2 = /* @__PURE__ */ new Map();
  for (const manifest of [...BUILTIN_BACKEND_MANIFESTS, ...additional]) {
    if (registry2.has(manifest.id)) throw new Error(`Duplicate backend manifest: ${manifest.id}`);
    registry2.set(manifest.id, Object.freeze({ ...manifest }));
  }
  return registry2;
}
function publicManifest(manifest) {
  const unavailable = manifest.supportLevel === "beta-blocked" || manifest.supportLevel === "experimental-disabled";
  return {
    id: manifest.id,
    backendId: manifest.id,
    label: manifest.label,
    kind: manifest.kind,
    mode: manifest.kind === "mock" ? "local_http" : manifest.kind,
    supportLevel: manifest.supportLevel,
    status: unavailable ? "unavailable" : "available",
    ...unavailable ? { message: "Backend is present but not enabled for normal execution." } : {},
    taskTypes: manifest.taskTypes,
    schemaIds: manifest.schemaIds,
    modelSelection: manifest.modelSelection,
    safety: {
      toolsDisabled: manifest.safety.toolsDisabled,
      requiresOsSandbox: manifest.safety.requiresOsSandbox,
      certified: manifest.safety.certified,
      ...manifest.safety.ephemeralWorkspaceOnly === true ? { ephemeralWorkspaceOnly: true } : {}
    }
  };
}

// ../local-runner/src/server/runtime.ts
var LOCAL_RUNTIME_VERSION = "0.2.0";
var MAX_RETAINED_RUNS = 200;
var TASK_TYPES = /* @__PURE__ */ new Set([
  "generate_tree",
  "deepen_node",
  "simplify_branch",
  "suggest_alternative",
  "suggest_formula",
  "review_model",
  "check_units",
  "identify_missing_drivers",
  "identify_duplicate_drivers",
  "explain_node",
  "explain_scenario",
  "generate_executive_summary"
]);
var PROGRESS_LABELS = {
  preparing_request: "Preparing request",
  starting_backend: "Starting backend",
  waiting_for_provider: "Waiting for CLI/provider",
  validating_schema: "Validating schema",
  repairing_output: "Repairing/normalizing output",
  building_project: "Building project",
  complete: "Complete",
  error: "Error",
  cancelled: "Cancelled"
};
var LocalRuntimeError = class extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = "LocalRuntimeError";
  }
  statusCode;
  code;
};
function setRunProgress(run, phase, status = run.status) {
  run.progress = {
    phase,
    label: PROGRESS_LABELS[phase],
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  run.status = status;
}
function createLocalRuntimeContext(config = {}) {
  return {
    config,
    manifests: createManifestRegistry(config.manifests),
    runs: /* @__PURE__ */ new Map(),
    auditSink: config.auditSink ?? ((event) => process.stdout.write(`${JSON.stringify({ event: "vdt_runner_audit", ...event })}
`)),
    adapterVersion: config.adapterVersion ?? LOCAL_RUNTIME_VERSION
  };
}
function listRuntimeBackends(context) {
  return { statusCode: 200, payload: { ok: true, backends: [...context.manifests.values()].map(publicManifest) } };
}
async function detectRuntimeSubscriptionClis(context, agentId) {
  if (agentId !== void 0 && !isSubscriptionCliId(agentId)) {
    throw new LocalRuntimeError(400, "UNKNOWN_CLI_AGENT", `Unknown CLI agent: ${agentId}`);
  }
  const detectionOptions = context.config.detection ?? {};
  const detected = agentId ? [await detectSubscriptionCli(agentId, detectionOptions)] : await detectSubscriptionClis(detectionOptions);
  const enrichmentOptions = detectionOptions.probeTimeoutMs === void 0 ? {} : { probeTimeoutMs: detectionOptions.probeTimeoutMs };
  const agents = await enrichSubscriptionCliDetections(detected, enrichmentOptions);
  const modelsByAgent = {};
  await Promise.all(
    agents.map(async (agent) => {
      if (!agent.installed || !agent.executable) {
        modelsByAgent[agent.id] = [];
        return;
      }
      const manifest = context.manifests.get(agent.backendId);
      if (!manifest) {
        modelsByAgent[agent.id] = [];
        return;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15e3);
      try {
        modelsByAgent[agent.id] = [
          ...await listBackendModels(manifest, controller.signal, {
            ...context.config.executor ?? {},
            resolveExecutable: async () => agent.executable
          })
        ];
      } catch {
        modelsByAgent[agent.id] = [];
      } finally {
        clearTimeout(timer);
      }
    })
  );
  return { statusCode: 200, payload: { ok: true, agents, modelsByAgent } };
}
async function listRuntimeModels(backendId, context) {
  const manifest = context.manifests.get(backendId);
  if (!manifest) throw new LocalRuntimeError(404, "UNKNOWN_BACKEND", "Unknown backendId.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15e3);
  timeout.unref?.();
  try {
    const models = await listBackendModels(manifest, controller.signal, context.config.executor);
    return { statusCode: 200, payload: { ok: true, backendId, models } };
  } catch (error2) {
    if (isSoftModelListFailure(error2)) {
      return { statusCode: 200, payload: { ok: true, backendId, models: [] } };
    }
    throw error2;
  } finally {
    clearTimeout(timeout);
  }
}
async function testRuntimeBackend(backendId, context) {
  return completeRuntime({
    requestId: randomUUID(),
    backendId,
    taskType: "generate_tree",
    schemaId: "connection-test-v1",
    input: { probe: true },
    timeoutMs: 3e4
  }, context);
}
async function completeRuntime(request, context) {
  if (context.runs.has(request.requestId)) throw new LocalRuntimeError(409, "DUPLICATE_REQUEST_ID", "requestId already exists.");
  if (context.runs.size >= MAX_RETAINED_RUNS) {
    const completedId = [...context.runs].find(([, run2]) => run2.status !== "running")?.[0];
    if (!completedId) throw new LocalRuntimeError(503, "RUN_CAPACITY_REACHED", "Local runner is at its active run limit.");
    context.runs.delete(completedId);
  }
  const manifest = context.manifests.get(request.backendId);
  if (!manifest) throw new LocalRuntimeError(404, "UNKNOWN_BACKEND", "Unknown backendId.");
  if (!manifest.taskTypes.includes(request.taskType) || !manifest.schemaIds.includes(request.schemaId)) {
    throw new LocalRuntimeError(400, "UNSUPPORTED_CONTRACT", "Backend does not support this task/schema contract.");
  }
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  const controller = new AbortController();
  const run = {
    requestId: request.requestId,
    backendId: request.backendId,
    taskType: request.taskType,
    schemaId: request.schemaId,
    status: "running",
    createdAt,
    startedAt: createdAt,
    progress: { phase: "starting_backend", label: PROGRESS_LABELS.starting_backend, updatedAt: createdAt },
    controller
  };
  context.runs.set(request.requestId, run);
  const started = Date.now();
  let executionRequest = request;
  try {
    setRunProgress(run, "preparing_request");
    const preparedAgent = await prepareRuntimeAgentRun(request);
    if (preparedAgent) {
      executionRequest = preparedAgent.request;
      run.agentRun = preparedAgent.agentRun;
    }
    setRunProgress(run, "waiting_for_provider");
    const result = await executeCompletion(manifest, executionRequest, controller.signal, context.config.executor);
    run.status = "succeeded";
    run.output = result.output;
    if (run.agentRun) {
      run.agentRun = finalizeRuntimeAgentRun(run.agentRun, request, result.output);
    }
    run.outputBytes = result.outputBytes;
    run.schemaValid = result.schemaValid;
    if (result.repaired === true) run.repaired = true;
    if (result.repairAttempted === true) run.repairAttempted = true;
    if (result.repairSucceeded === true) run.repairSucceeded = true;
    run.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
    run.latencyMs = Date.now() - started;
    setRunProgress(run, "complete", "succeeded");
    context.auditSink({
      requestId: run.requestId,
      backendId: run.backendId,
      adapterVersion: context.adapterVersion,
      taskType: run.taskType,
      startedAt: run.startedAt,
      latencyMs: run.latencyMs,
      outputBytes: result.outputBytes,
      schemaValid: result.schemaValid,
      ...result.repaired === true ? { repaired: true } : {},
      ...result.repairAttempted === true ? { repairAttempted: true } : {},
      ...result.repairSucceeded === true ? { repairSucceeded: true } : {},
      ...result.exitCode === void 0 ? {} : { exitCode: result.exitCode },
      ...result.executableVersion === void 0 ? {} : { executableVersion: result.executableVersion }
    });
    return { statusCode: 200, payload: { ok: true, run: publicRun(run), output: result.output } };
  } catch (error2) {
    const normalized = publicRuntimeError(error2);
    run.status = normalized.code === "CANCELLED" ? "cancelled" : "failed";
    run.error = normalized;
    run.outputBytes = 0;
    run.schemaValid = false;
    if (hasRepairAttempt(error2)) {
      run.repairAttempted = true;
      run.repairSucceeded = false;
    }
    if (run.agentRun) {
      run.agentRun = appendAgenticVdtRunEvent(
        run.agentRun,
        {
          type: "error",
          title: normalized.code === "CANCELLED" ? "Provider execution cancelled" : "Provider execution failed",
          message: normalized.message,
          metadata: { code: normalized.code }
        },
        { phase: "reporting", status: normalized.code === "CANCELLED" ? "cancelled" : "failed" }
      );
    }
    run.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
    run.latencyMs = Date.now() - started;
    setRunProgress(run, normalized.code === "CANCELLED" ? "cancelled" : "error", run.status);
    context.auditSink({
      requestId: run.requestId,
      backendId: run.backendId,
      adapterVersion: context.adapterVersion,
      taskType: run.taskType,
      startedAt: run.startedAt,
      latencyMs: run.latencyMs,
      outputBytes: 0,
      schemaValid: false,
      ...hasRepairAttempt(error2) ? { repairAttempted: true, repairSucceeded: false } : {},
      errorCode: normalized.code
    });
    return { statusCode: normalized.code === "CANCELLED" ? 409 : 502, payload: { ok: false, run: publicRun(run), error: normalized } };
  }
}
async function prepareRuntimeAgentRun(request) {
  if (request.schemaId === "connection-test-v1") return void 0;
  if (request.taskType !== "generate_tree" && request.taskType !== "deepen_node") return void 0;
  const agentRequest = request.taskType === "generate_tree" ? generateInputFromCompletionInput(request.input) : deepenInputFromCompletionInput(request.input);
  if (!agentRequest) return void 0;
  const library = await loadDefaultSkillLibrary();
  const prepared = prepareAgenticVdtRun(agentRequest, library);
  const agentRun = appendAgenticVdtRunEvent(
    prepared.run,
    {
      type: "model_call_started",
      title: request.taskType === "generate_tree" ? "Model call started" : "Deepen model call started",
      message: request.taskType === "generate_tree" ? `Generating graph from ${prepared.skillExcerpts.length} selected skill${prepared.skillExcerpts.length === 1 ? "" : "s"}.` : `Generating deepen patch from ${prepared.skillExcerpts.length} selected skill${prepared.skillExcerpts.length === 1 ? "" : "s"}.`,
      metadata: {
        taskType: request.taskType,
        selectedSkillIds: prepared.prompt.decompositionPlan.selectedSkillIds
      }
    },
    { phase: "generating_graph" }
  );
  return {
    request: request.taskType === "generate_tree" || request.taskType === "deepen_node" ? { ...request, input: enrichAgenticCompletionInput(request.input, prepared.prompt) } : request,
    agentRun
  };
}
function finalizeRuntimeAgentRun(agentRun, request, output) {
  const resultProjectId = outputProjectId(output) ?? request.requestId;
  if (request.taskType === "generate_tree") {
    const validation = graphValidationSummaryFromGenerateOutput(output);
    return finalizeAgenticVdtRun(agentRun, {
      resultProjectId,
      finalReport: runtimeFinalReport(
        agentRun,
        "Generated a candidate VDT graph through the local runtime.",
        validation.message
      ),
      validationSummary: validation.message,
      draftGraph: output
    });
  }
  const withPatch = appendAgenticVdtRunEvent(
    agentRun,
    {
      type: "graph_patch",
      title: "Graph patch returned",
      message: "Deepen operation returned a candidate change set payload.",
      metadata: { targetNodeId: isRecord10(output) ? output.targetNodeId : void 0 }
    },
    { phase: "validating_graph" }
  );
  const withCompleted = appendAgenticVdtRunEvent(
    withPatch,
    {
      type: "model_call_completed",
      title: "Deepen model call completed",
      message: validationSummaryFromOutput(output),
      metadata: { targetNodeId: isRecord10(output) ? output.targetNodeId : void 0 }
    },
    { phase: "reporting" }
  );
  const validationSummary2 = validationSummaryFromOutput(output);
  const withReport = appendAgenticVdtRunEvent(
    withCompleted,
    {
      type: "final_report",
      title: "Deepen report prepared",
      message: "Prepared deepen run report after provider schema validation.",
      metadata: { targetNodeId: isRecord10(output) ? output.targetNodeId : void 0 }
    },
    { phase: "reporting", status: "succeeded" }
  );
  return {
    ...withReport,
    resultProjectId,
    finalReport: runtimeFinalReport(
      withReport,
      "Generated a candidate deepen patch through the local runtime.",
      validationSummary2
    ),
    draftGraph: output
  };
}
function unwrapTaskInput(input) {
  if (isRecord10(input) && "data" in input) return input.data;
  return input;
}
function generateInputFromCompletionInput(input) {
  const data = unwrapTaskInput(input);
  if (!isRecord10(data)) return void 0;
  const rootKpi = boundedString(data.rootKpi) ?? boundedString(data.projectTitle) ?? boundedString(data.prompt);
  if (!rootKpi) return void 0;
  const request = { rootKpi };
  const industry = boundedString(data.industry);
  const businessContext = boundedString(data.businessContext);
  const unit = boundedString(data.unit);
  const timePeriod = boundedString(data.timePeriod);
  const goal = boundedString(data.goal);
  const levelOfDetail = boundedString(data.levelOfDetail);
  if (industry) request.industry = industry;
  if (businessContext) request.businessContext = businessContext;
  if (unit) request.unit = unit;
  if (timePeriod) request.timePeriod = timePeriod;
  if (goal) request.goal = goal;
  if (levelOfDetail) request.levelOfDetail = levelOfDetail;
  return request;
}
function deepenInputFromCompletionInput(input) {
  const data = unwrapTaskInput(input);
  if (!isRecord10(data)) return void 0;
  const project = projectFromDeepenInput(data);
  const targetNodeId = boundedString(data.targetNodeId) ?? boundedString(data.nodeId);
  const targetName = targetNameFromDeepenInput(data);
  const rootKpi = targetName ?? targetNodeId;
  if (!rootKpi) return void 0;
  const context = isRecord10(data.context) ? data.context : void 0;
  const request = { rootKpi };
  const industry = boundedString(data.industry) ?? boundedString(project?.industry);
  const businessContext = boundedString(data.businessContext) ?? boundedString(project?.businessContext) ?? boundedString(project?.description);
  const goal = boundedString(context?.goal);
  const targetUnit = targetUnitFromDeepenInput(data);
  if (industry) request.industry = industry;
  if (businessContext) request.businessContext = businessContext;
  if (targetUnit) request.unit = targetUnit;
  if (goal) request.goal = goal;
  return request;
}
function targetNameFromDeepenInput(data) {
  const targetNodeId = boundedString(data.targetNodeId) ?? boundedString(data.nodeId);
  const excerpt = isRecord10(data.excerpt) ? data.excerpt : void 0;
  const project = projectFromDeepenInput(data);
  const graph = isRecord10(project?.graph) ? project.graph : void 0;
  const nodes = Array.isArray(excerpt?.nodes) ? excerpt.nodes : Array.isArray(graph?.nodes) ? graph.nodes : [];
  const target = nodes.find((node) => isRecord10(node) && node.id === targetNodeId);
  return boundedString(target?.name);
}
function targetUnitFromDeepenInput(data) {
  const targetNodeId = boundedString(data.targetNodeId) ?? boundedString(data.nodeId);
  const excerpt = isRecord10(data.excerpt) ? data.excerpt : void 0;
  const project = projectFromDeepenInput(data);
  const graph = isRecord10(project?.graph) ? project.graph : void 0;
  const nodes = Array.isArray(excerpt?.nodes) ? excerpt.nodes : Array.isArray(graph?.nodes) ? graph.nodes : [];
  const target = nodes.find((node) => isRecord10(node) && node.id === targetNodeId);
  return boundedString(target?.unit, 80);
}
function projectFromDeepenInput(data) {
  const project = data.project;
  return isRecord10(project) ? project : void 0;
}
function enrichAgenticCompletionInput(input, prompt) {
  const context = {
    selectedSkillIds: prompt.decompositionPlan.selectedSkillIds,
    decompositionPlan: prompt.decompositionPlan
  };
  if (isRecord10(input)) {
    const hasAgenticPrompt = typeof input.userPrompt === "string" && input.userPrompt.includes("Agentic VDT preparation");
    return {
      ...input,
      agenticContext: context,
      ...typeof input.systemPrompt === "string" && !hasAgenticPrompt ? { systemPrompt: `${input.systemPrompt}

${prompt.systemPromptAddition}` } : {},
      ...typeof input.userPrompt === "string" && !hasAgenticPrompt ? { userPrompt: `${input.userPrompt}

${prompt.userPromptAddition}` } : {}
    };
  }
  return {
    data: input,
    systemPrompt: prompt.systemPromptAddition,
    userPrompt: prompt.userPromptAddition,
    agenticContext: context
  };
}
function boundedString(value, maxLength = 2e3) {
  if (typeof value !== "string") return void 0;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : void 0;
}
function outputProjectId(output) {
  if (!isRecord10(output)) return void 0;
  return boundedString(output.projectId) ?? boundedString(output.rootNodeId) ?? boundedString(output.projectTitle);
}
function validationSummaryFromOutput(output) {
  if (!isRecord10(output)) return "Provider output passed registered schema validation.";
  const nodes = Array.isArray(output.nodes) ? output.nodes.length : void 0;
  const edges = Array.isArray(output.edges) ? output.edges.length : void 0;
  if (nodes !== void 0 && edges !== void 0) {
    return `Provider output passed registered schema validation: ${nodes} nodes, ${edges} edges.`;
  }
  return "Provider output passed registered schema validation.";
}
function graphValidationSummaryFromGenerateOutput(output) {
  if (!isRecord10(output) || typeof output.rootNodeId !== "string" || !Array.isArray(output.nodes) || !Array.isArray(output.edges)) {
    return { valid: false, message: "Graph validation failed: provider output was not a graph-shaped generate_tree payload." };
  }
  const validation = validateGraph(
    {
      nodes: output.nodes,
      edges: output.edges
    },
    output.rootNodeId
  );
  if (validation.valid && validation.warnings.length === 0) {
    return {
      valid: true,
      message: `Graph validation passed: ${output.nodes.length} nodes, ${output.edges.length} decomposition edges.`
    };
  }
  const issues = [...validation.errors, ...validation.warnings].map((issue2) => issue2.message).slice(0, 6);
  return {
    valid: false,
    message: `Graph validation failed: ${issues.join("; ")}`
  };
}
function runtimeFinalReport(agentRun, headline, validationSummary2) {
  return [
    headline,
    `Selected skills: ${agentRun.selectedSkills.map((skill) => skill.id).join(", ") || "none"}.`,
    `Validation result: ${validationSummary2}`
  ].join("\n");
}
function hasRepairAttempt(error2) {
  return typeof error2 === "object" && error2 !== null && error2.repairAttempted === true;
}
function isSoftModelListFailure(error2) {
  const code = typeof error2 === "object" && error2 !== null && "code" in error2 ? String(error2.code) : "";
  return code === "BACKEND_NOT_INSTALLED" || code === "AUTH_REQUIRED" || code === "CANCELLED";
}
function cancelRuntimeRequest(requestId, context) {
  const run = context.runs.get(requestId);
  if (!run) throw new LocalRuntimeError(404, "RUN_NOT_FOUND", "Run was not found.");
  if (run.status !== "running") throw new LocalRuntimeError(409, "RUN_NOT_ACTIVE", "Run is not active.");
  run.controller.abort();
  setRunProgress(run, "cancelled");
  return { statusCode: 202, payload: { ok: true, requestId, status: "cancelling" } };
}
function getRuntimeRun(requestId, context) {
  const run = context.runs.get(requestId);
  if (!run) throw new LocalRuntimeError(404, "RUN_NOT_FOUND", "Run was not found.");
  return { statusCode: 200, payload: { ok: true, run: publicRun(run) } };
}
function openRuntimeProviderAuth(backendId, context) {
  const manifest = context.manifests.get(backendId);
  if (!manifest) throw new LocalRuntimeError(404, "UNKNOWN_BACKEND", "Unknown backendId.");
  if (manifest.kind !== "subscription_cli") {
    throw new LocalRuntimeError(400, "AUTH_ACTION_UNAVAILABLE", "Provider authentication is only available for subscription backends.");
  }
  const action = providerAuthAction(backendId);
  if (!action) {
    throw new LocalRuntimeError(501, "AUTH_ACTION_UNAVAILABLE", "Provider authentication is not available for this backend.");
  }
  return { statusCode: 200, payload: { ok: true, backendId, ...action } };
}
function parseCompletionPayload(value) {
  if (!isRecord10(value)) throw new LocalRuntimeError(400, "INVALID_BODY", "Completion body must be an object.");
  for (const forbidden of ["command", "args", "providerConfig", "schema", "systemPrompt", "userPrompt", "cwd", "env", "extraArgs"]) {
    if (forbidden in value) throw new LocalRuntimeError(400, "FORBIDDEN_FIELD", `Completion body must not include ${forbidden}.`);
  }
  const allowed = /* @__PURE__ */ new Set(["requestId", "backendId", "taskType", "schemaId", "input", "model", "timeoutMs"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new LocalRuntimeError(400, "UNKNOWN_FIELD", `Unknown completion field: ${key}.`);
  }
  const requestId = typeof value.requestId === "string" ? value.requestId : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new LocalRuntimeError(400, "INVALID_REQUEST_ID", "requestId must be a UUID.");
  }
  const backendId = typeof value.backendId === "string" ? value.backendId : "";
  const taskType = typeof value.taskType === "string" && TASK_TYPES.has(value.taskType) ? value.taskType : void 0;
  const schemaId = typeof value.schemaId === "string" && isVdtSchemaId(value.schemaId) ? value.schemaId : void 0;
  if (!backendId) throw new LocalRuntimeError(400, "INVALID_BACKEND_ID", "backendId is required.");
  if (!taskType) throw new LocalRuntimeError(400, "INVALID_TASK_TYPE", "taskType is not approved.");
  if (!schemaId || !schemaSupportsTask(schemaId, taskType)) {
    throw new LocalRuntimeError(400, "INVALID_SCHEMA_ID", "schemaId is not approved for this task.");
  }
  const timeoutMs = value.timeoutMs;
  if (timeoutMs !== void 0 && (typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > EXECUTION_LIMITS.timeoutMs)) {
    throw new LocalRuntimeError(400, "INVALID_TIMEOUT", `timeoutMs must be at most ${EXECUTION_LIMITS.timeoutMs}.`);
  }
  if (value.model !== void 0 && (typeof value.model !== "string" || value.model.length > 160 || value.model.includes("\0"))) {
    throw new LocalRuntimeError(400, "INVALID_MODEL", "model must be a bounded string.");
  }
  return {
    requestId,
    backendId,
    taskType,
    schemaId,
    input: value.input,
    ...typeof value.model === "string" ? { model: value.model } : {},
    ...typeof timeoutMs === "number" ? { timeoutMs } : {}
  };
}
function publicRun(run) {
  const { controller: _controller, ...snapshot } = run;
  return snapshot;
}
function publicRuntimeError(error2) {
  const code = typeof error2 === "object" && error2 !== null && "code" in error2 ? String(error2.code) : "EXECUTION_FAILED";
  const messages = {
    CANCELLED: "Completion was cancelled.",
    TIMEOUT: "Backend execution timed out.",
    OUTPUT_TOO_LARGE: "Backend output exceeded the configured limit.",
    OUTPUT_LINE_TOO_LARGE: "Backend output line exceeded the configured limit.",
    SCHEMA_INVALID: "Backend output failed schema validation.",
    BACKEND_NOT_INSTALLED: "Backend executable is not installed.",
    UNSAFE_CONFIGURATION: "Backend is not certified for isolated execution.",
    LOCAL_HTTP_FAILED: "Local model endpoint failed.",
    INVALID_PROVIDER_RESPONSE: "Local model returned an invalid response.",
    AUTH_REQUIRED: "Backend account authentication is required.",
    RATE_LIMITED: "Backend account allowance or request limit was reached.",
    POLICY_DISABLED: "Backend access is disabled by the current plan or organization policy.",
    BACKEND_PARSE_FAILED: "Backend output could not be parsed as the required structured response.",
    BACKEND_EXIT_FAILED: "Backend process exited before producing a valid response."
  };
  return { code, message: messages[code] ?? "Backend execution failed." };
}
function providerAuthAction(backendId) {
  if (backendId === "cursor_subscription") {
    return {
      action: "instructions",
      label: "Cursor Agent authentication",
      instructions: "Use Cursor's official Agent sign-in flow, then rescan this provider in VDT Studio Desktop.",
      docsUrl: "https://docs.cursor.com/agent"
    };
  }
  if (backendId === "codex_subscription") {
    return {
      action: "instructions",
      label: "Codex CLI authentication",
      instructions: "Use the official Codex CLI sign-in flow, then rescan this provider in VDT Studio Desktop.",
      docsUrl: "https://developers.openai.com/codex/cli"
    };
  }
  if (backendId === "claude_subscription") {
    return {
      action: "instructions",
      label: "Claude Code authentication",
      instructions: "Use Claude Code's official sign-in flow, then rescan this provider in VDT Studio Desktop.",
      docsUrl: "https://docs.anthropic.com/en/docs/claude-code"
    };
  }
  if (backendId === "gemini_subscription") {
    return {
      action: "instructions",
      label: "Gemini CLI authentication",
      instructions: "Use Gemini CLI's official sign-in flow, then rescan this provider in VDT Studio Desktop.",
      docsUrl: "https://github.com/google-gemini/gemini-cli"
    };
  }
  if (backendId === "copilot_subscription") {
    return {
      action: "instructions",
      label: "GitHub Copilot CLI authentication",
      instructions: "Use GitHub Copilot CLI's official sign-in flow, then rescan this provider in VDT Studio Desktop.",
      docsUrl: "https://docs.github.com/en/copilot"
    };
  }
  return void 0;
}
function isRecord10(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ../local-runner/src/sidecar/protocol.ts
var SIDECAR_PROTOCOL_VERSION = 1;
var DEFAULT_SIDECAR_MAX_FRAME_BYTES = 1024 * 1024;
var SIDECAR_REQUEST_METHODS = [
  "list_backends",
  "detect_clis",
  "test_backend",
  "list_models",
  "complete",
  "get_run",
  "open_provider_auth",
  "get_app_mode"
];
var SIDECAR_EVENTS = [
  "backend_status_changed",
  "run_status_changed",
  "runtime_ready"
];
var SidecarProtocolError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "SidecarProtocolError";
  }
  code;
};
var SidecarRequestTracker = class {
  #seen = /* @__PURE__ */ new Set();
  #active = /* @__PURE__ */ new Set();
  registerRequest(requestId) {
    if (this.#seen.has(requestId)) {
      throw new SidecarProtocolError("DUPLICATE_REQUEST_ID", `Duplicate sidecar request id: ${requestId}.`);
    }
    this.#seen.add(requestId);
    this.#active.add(requestId);
  }
  completeRequest(requestId) {
    if (!this.#seen.has(requestId)) {
      throw new SidecarProtocolError("UNKNOWN_REQUEST_ID", `Sidecar response references an unknown request id: ${requestId}.`);
    }
    if (!this.#active.has(requestId)) {
      throw new SidecarProtocolError("STALE_REQUEST_ID", `Sidecar response references a completed request id: ${requestId}.`);
    }
    this.#active.delete(requestId);
  }
  assertActive(requestId) {
    if (!this.#seen.has(requestId)) {
      throw new SidecarProtocolError("UNKNOWN_REQUEST_ID", `Sidecar message references an unknown request id: ${requestId}.`);
    }
    if (!this.#active.has(requestId)) {
      throw new SidecarProtocolError("STALE_REQUEST_ID", `Sidecar message references a completed request id: ${requestId}.`);
    }
  }
  isActive(requestId) {
    return this.#active.has(requestId);
  }
};
var SidecarFrameDecoder = class {
  #options;
  #buffer = "";
  constructor(options = {}) {
    this.#options = options;
  }
  push(chunk) {
    this.#buffer += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    const maxFrameBytes = this.#options.maxFrameBytes ?? DEFAULT_SIDECAR_MAX_FRAME_BYTES;
    if (Buffer.byteLength(this.#buffer, "utf8") > maxFrameBytes) {
      throw new SidecarProtocolError("FRAME_TOO_LARGE", "Sidecar frame exceeds the configured byte limit.");
    }
    const messages = [];
    for (; ; ) {
      const newlineIndex = this.#buffer.indexOf("\n");
      if (newlineIndex === -1) break;
      const frame = this.#buffer.slice(0, newlineIndex).replace(/\r$/, "");
      this.#buffer = this.#buffer.slice(newlineIndex + 1);
      if (frame.length === 0) continue;
      messages.push(parseSidecarFrame(frame, this.#options));
    }
    return messages;
  }
};
var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var REQUEST_METHOD_SET = new Set(SIDECAR_REQUEST_METHODS);
var EVENT_SET = new Set(SIDECAR_EVENTS);
var MESSAGE_TYPES = /* @__PURE__ */ new Set(["hello", "ready", "request", "response", "cancel", "event"]);
var EMPTY_PAYLOAD_METHODS = /* @__PURE__ */ new Set(["list_backends", "get_app_mode"]);
var METHOD_PAYLOAD_KEYS = {
  list_backends: [],
  detect_clis: ["agentId"],
  test_backend: ["backendId"],
  list_models: ["backendId"],
  complete: ["backendId", "taskType", "schemaId", "input", "model", "timeoutMs"],
  get_run: ["runRequestId"],
  open_provider_auth: ["backendId"],
  get_app_mode: []
};
function parseSidecarFrame(frame, options = {}) {
  const raw = typeof frame === "string" ? frame : Buffer.from(frame).toString("utf8");
  const maxFrameBytes = options.maxFrameBytes ?? DEFAULT_SIDECAR_MAX_FRAME_BYTES;
  if (raw.length === 0) throw new SidecarProtocolError("EMPTY_FRAME", "Sidecar frame is empty.");
  if (Buffer.byteLength(raw, "utf8") > maxFrameBytes) {
    throw new SidecarProtocolError("FRAME_TOO_LARGE", "Sidecar frame exceeds the configured byte limit.");
  }
  if (raw.includes("\n") || raw.includes("\r")) {
    throw new SidecarProtocolError("FRAME_CONTAINS_NEWLINE", "Sidecar frame must contain exactly one JSON object.");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SidecarProtocolError("INVALID_JSON", "Sidecar frame must be valid JSON.");
  }
  const message = validateSidecarMessage(parsed);
  applyTracking(message, options);
  return message;
}
function serializeSidecarMessage(message, options = {}) {
  const validated = validateSidecarMessage(message);
  const serialized = `${JSON.stringify(validated)}
`;
  const maxFrameBytes = options.maxFrameBytes ?? DEFAULT_SIDECAR_MAX_FRAME_BYTES;
  if (Buffer.byteLength(serialized, "utf8") > maxFrameBytes) {
    throw new SidecarProtocolError("FRAME_TOO_LARGE", "Sidecar frame exceeds the configured byte limit.");
  }
  return serialized;
}
function applyTracking(message, options) {
  const tracker = options.requestTracker;
  if (!tracker) return;
  if (options.direction === "host-to-sidecar") {
    if (message.type === "request") tracker.registerRequest(message.requestId);
    if (message.type === "cancel") tracker.assertActive(message.requestId);
    return;
  }
  if (options.direction === "sidecar-to-host" && message.type === "response") {
    tracker.completeRequest(message.requestId);
  }
}
function validateSidecarMessage(value) {
  const object = asObject(value, "Sidecar message must be a JSON object.");
  requireProtocolVersion(object);
  const type = requireString(object.type, "type");
  if (!MESSAGE_TYPES.has(type)) {
    throw new SidecarProtocolError("UNKNOWN_MESSAGE_TYPE", `Unknown sidecar message type: ${type}.`);
  }
  if (type === "hello") return validateHello(object);
  if (type === "ready") return validateReady(object);
  if (type === "request") return validateRequest(object);
  if (type === "response") return validateResponse(object);
  if (type === "cancel") return validateCancel(object);
  return validateEvent(object);
}
function validateHello(object) {
  assertKnownKeys(object, ["protocolVersion", "type", "nonce"]);
  const nonce = requireBoundedString(object.nonce, "nonce", 128);
  return { protocolVersion: SIDECAR_PROTOCOL_VERSION, type: "hello", nonce };
}
function validateReady(object) {
  assertKnownKeys(object, ["protocolVersion", "type", "nonce"]);
  const nonce = requireBoundedString(object.nonce, "nonce", 128);
  return { protocolVersion: SIDECAR_PROTOCOL_VERSION, type: "ready", nonce };
}
function validateRequest(object) {
  assertKnownKeys(object, ["protocolVersion", "type", "requestId", "method", "payload"]);
  const requestId = requireRequestId(object.requestId);
  const method = requireString(object.method, "method");
  if (!REQUEST_METHOD_SET.has(method)) {
    throw new SidecarProtocolError("UNKNOWN_METHOD", `Unknown sidecar request method: ${method}.`);
  }
  const requestMethod = method;
  const payload = asJsonObject(object.payload, "Request payload must be a JSON object.");
  validateRequestPayload(requestMethod, payload);
  return { protocolVersion: SIDECAR_PROTOCOL_VERSION, type: "request", requestId, method: requestMethod, payload };
}
function validateResponse(object) {
  assertKnownKeys(object, ["protocolVersion", "type", "requestId", "ok", "payload", "error"]);
  const requestId = requireRequestId(object.requestId);
  if (typeof object.ok !== "boolean") throw new SidecarProtocolError("INVALID_MESSAGE", "Response ok must be a boolean.");
  if (object.error !== void 0) {
    const error2 = asObject(object.error, "Response error must be a JSON object.");
    assertKnownKeys(error2, ["code", "message"]);
    const code = requireBoundedString(error2.code, "error.code", 120);
    const message = requireBoundedString(error2.message, "error.message", 500);
    if (object.ok) throw new SidecarProtocolError("INVALID_MESSAGE", "Successful responses must not include error.");
    return { protocolVersion: SIDECAR_PROTOCOL_VERSION, type: "response", requestId, ok: false, error: { code, message } };
  }
  if (!object.ok) throw new SidecarProtocolError("INVALID_MESSAGE", "Failed responses must include error.");
  const payload = object.payload;
  return payload === void 0 ? { protocolVersion: SIDECAR_PROTOCOL_VERSION, type: "response", requestId, ok: true } : { protocolVersion: SIDECAR_PROTOCOL_VERSION, type: "response", requestId, ok: true, payload: asJsonValue(payload, "payload") };
}
function validateCancel(object) {
  assertKnownKeys(object, ["protocolVersion", "type", "requestId"]);
  return { protocolVersion: SIDECAR_PROTOCOL_VERSION, type: "cancel", requestId: requireRequestId(object.requestId) };
}
function validateEvent(object) {
  assertKnownKeys(object, ["protocolVersion", "type", "event", "payload"]);
  const event = requireString(object.event, "event");
  if (!EVENT_SET.has(event)) {
    throw new SidecarProtocolError("UNKNOWN_EVENT", `Unknown sidecar event: ${event}.`);
  }
  const payload = asJsonObject(object.payload, "Event payload must be a JSON object.");
  return { protocolVersion: SIDECAR_PROTOCOL_VERSION, type: "event", event, payload };
}
function validateRequestPayload(method, payload) {
  const allowedKeys = METHOD_PAYLOAD_KEYS[method];
  assertKnownKeys(payload, allowedKeys);
  if (EMPTY_PAYLOAD_METHODS.has(method) && Object.keys(payload).length > 0) {
    throw new SidecarProtocolError("UNKNOWN_FIELD", `${method} payload must be empty.`);
  }
  for (const key of ["agentId", "backendId", "taskType", "schemaId", "model", "runRequestId"]) {
    if (key in payload) requireBoundedString(payload[key], key, 180);
  }
  if ("timeoutMs" in payload && (!Number.isSafeInteger(payload.timeoutMs) || Number(payload.timeoutMs) <= 0)) {
    throw new SidecarProtocolError("INVALID_PAYLOAD", "timeoutMs must be a positive safe integer.");
  }
}
function requireProtocolVersion(object) {
  if (object.protocolVersion !== SIDECAR_PROTOCOL_VERSION) {
    throw new SidecarProtocolError("INVALID_PROTOCOL_VERSION", `Sidecar protocolVersion must be ${SIDECAR_PROTOCOL_VERSION}.`);
  }
}
function requireRequestId(value) {
  const requestId = requireString(value, "requestId");
  if (!UUID_PATTERN.test(requestId)) {
    throw new SidecarProtocolError("INVALID_REQUEST_ID", "requestId must be a UUID.");
  }
  return requestId;
}
function requireString(value, fieldName) {
  if (typeof value !== "string" || value.length === 0) {
    throw new SidecarProtocolError("INVALID_MESSAGE", `${fieldName} must be a non-empty string.`);
  }
  return value;
}
function requireBoundedString(value, fieldName, maxLength) {
  const result = requireString(value, fieldName);
  if (result.length > maxLength || result.includes("\0")) {
    throw new SidecarProtocolError("INVALID_MESSAGE", `${fieldName} must be a bounded string.`);
  }
  return result;
}
function asObject(value, message) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SidecarProtocolError("INVALID_MESSAGE", message);
  }
  return value;
}
function asJsonObject(value, message) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SidecarProtocolError("INVALID_PAYLOAD", message);
  }
  for (const nestedValue of Object.values(value)) asJsonValue(nestedValue, "payload");
  return value;
}
function asJsonValue(value, fieldName) {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new SidecarProtocolError("INVALID_PAYLOAD", `${fieldName} contains a non-finite number.`);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => asJsonValue(entry, fieldName));
  if (typeof value === "object") {
    for (const nestedValue of Object.values(value)) asJsonValue(nestedValue, fieldName);
    return value;
  }
  throw new SidecarProtocolError("INVALID_PAYLOAD", `${fieldName} must be JSON serializable.`);
}
function assertKnownKeys(object, allowedKeys) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) throw new SidecarProtocolError("UNKNOWN_FIELD", `Unknown sidecar field: ${key}.`);
  }
}

// ../local-runner/src/sidecar/runtime.ts
async function handleSidecarRequest(message, context) {
  try {
    const result = await routeSidecarRequest(message, context);
    return runtimeResultToSidecarResult(result);
  } catch (error2) {
    return { ok: false, error: normalizeSidecarRuntimeError(error2) };
  }
}
function handleSidecarCancel(message, context) {
  cancelRuntimeRequest(message.requestId, context);
}
function runLocalRuntimeSidecar(options = {}) {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const runtimeConfig = {
    ...options.runtimeConfig ?? {},
    auditSink: options.runtimeConfig?.auditSink ?? ((event) => {
      stderr.write(`${JSON.stringify({ event: "vdt_sidecar_audit", audit: event })}
`);
    })
  };
  const context = createLocalRuntimeContext(runtimeConfig);
  const tracker = new SidecarRequestTracker();
  const decoder = new SidecarFrameDecoder({ requestTracker: tracker, direction: "host-to-sidecar" });
  const nonce = options.nonce ?? randomUUID2();
  let ready = false;
  function write(message) {
    stdout.write(serializeSidecarMessage(message));
  }
  function fail(error2) {
    const normalized = error2 instanceof SidecarProtocolError ? { code: error2.code, message: error2.message } : normalizeSidecarRuntimeError(error2);
    stderr.write(`${JSON.stringify({ event: "vdt_sidecar_error", error: normalized })}
`);
    process.exitCode = 1;
  }
  write({ protocolVersion: SIDECAR_PROTOCOL_VERSION, type: "hello", nonce });
  stdin.on("data", (chunk) => {
    let messages;
    try {
      messages = decoder.push(chunk);
    } catch (error2) {
      fail(error2);
      return;
    }
    for (const message of messages) {
      if (!ready) {
        if (message.type !== "ready" || message.nonce !== nonce) {
          fail(new SidecarProtocolError("INVALID_MESSAGE", "Sidecar host did not complete the expected handshake."));
          continue;
        }
        ready = true;
        write({ protocolVersion: SIDECAR_PROTOCOL_VERSION, type: "event", event: "runtime_ready", payload: {} });
        continue;
      }
      if (message.type === "cancel") {
        try {
          handleSidecarCancel(message, context);
        } catch (error2) {
          fail(error2);
        }
        continue;
      }
      if (message.type !== "request") continue;
      void handleSidecarRequest(message, context).then((result) => {
        tracker.completeRequest(message.requestId);
        write(result.ok ? {
          protocolVersion: SIDECAR_PROTOCOL_VERSION,
          type: "response",
          requestId: message.requestId,
          ok: true,
          ...result.payload === void 0 ? {} : { payload: result.payload }
        } : {
          protocolVersion: SIDECAR_PROTOCOL_VERSION,
          type: "response",
          requestId: message.requestId,
          ok: false,
          error: result.error
        });
      }).catch((error2) => fail(error2));
    }
  });
}
async function routeSidecarRequest(message, context) {
  if (message.method === "list_backends") return listRuntimeBackends(context);
  if (message.method === "detect_clis") {
    const agentId = typeof message.payload.agentId === "string" ? message.payload.agentId : void 0;
    return detectRuntimeSubscriptionClis(context, agentId);
  }
  if (message.method === "test_backend") return testRuntimeBackend(requireBackendId(message.payload), context);
  if (message.method === "complete") {
    return completeRuntime(parseCompletionPayload({ ...message.payload, requestId: message.requestId }), context);
  }
  if (message.method === "get_run") {
    const runRequestId = typeof message.payload.runRequestId === "string" ? message.payload.runRequestId : "";
    if (!runRequestId) throw new LocalRuntimeError(400, "INVALID_REQUEST_ID", "runRequestId is required.");
    return getRuntimeRun(runRequestId, context);
  }
  if (message.method === "list_models") {
    return listRuntimeModels(requireBackendId(message.payload), context);
  }
  if (message.method === "open_provider_auth") {
    return openRuntimeProviderAuth(requireBackendId(message.payload), context);
  }
  return { statusCode: 200, payload: { ok: true, appMode: "desktop" } };
}
function runtimeResultToSidecarResult(result) {
  const payload = toJsonValue(result.payload);
  if (result.statusCode >= 400) {
    const error2 = asPayloadError(payload) ?? { code: "RUNTIME_FAILED", message: "Runtime request failed." };
    return { ok: false, error: error2 };
  }
  return payload === void 0 ? { ok: true } : { ok: true, payload };
}
function asPayloadError(value) {
  if (!isJsonObject(value)) return void 0;
  const error2 = value.error;
  if (!isJsonObject(error2) || typeof error2.code !== "string" || typeof error2.message !== "string") return void 0;
  return { code: error2.code, message: error2.message };
}
function requireBackendId(payload) {
  const backendId = payload.backendId;
  if (typeof backendId !== "string" || backendId.length === 0) {
    throw new LocalRuntimeError(400, "INVALID_BACKEND_ID", "backendId is required.");
  }
  return backendId;
}
function normalizeSidecarRuntimeError(error2) {
  if (error2 instanceof LocalRuntimeError) return { code: error2.code, message: error2.message };
  if (error2 instanceof SidecarProtocolError) return { code: error2.code, message: error2.message };
  return { code: "SIDECAR_RUNTIME_ERROR", message: error2 instanceof Error ? error2.message : "Sidecar runtime failed safely." };
}
function toJsonValue(value) {
  if (value === void 0) return void 0;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map((entry) => toJsonValue(entry) ?? null);
  if (typeof value === "object") {
    const result = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      const jsonValue = toJsonValue(nestedValue);
      if (jsonValue !== void 0) result[key] = jsonValue;
    }
    return result;
  }
  return null;
}
function isJsonObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ../local-runner/src/sidecar/index.ts
if (process.argv[1] && fileURLToPath2(import.meta.url) === process.argv[1]) {
  runLocalRuntimeSidecar();
}
export {
  runLocalRuntimeSidecar
};
