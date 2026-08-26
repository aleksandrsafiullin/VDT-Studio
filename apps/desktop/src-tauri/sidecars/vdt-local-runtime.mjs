var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// ../local-runner/src/sidecar/index.ts
import { fileURLToPath as fileURLToPath3 } from "node:url";

// ../local-runner/src/sidecar/runtime.ts
import { randomUUID as randomUUID2 } from "node:crypto";

// ../local-runner/src/server/runtime.ts
import { randomUUID } from "node:crypto";
import { execFile as execFile8 } from "node:child_process";
import { promisify as promisify8 } from "node:util";

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
  "orchestrator-first-response-v1",
  "agent-decision-v2",
  "agent-plan-v1",
  "data-agent-decision-v1",
  "analyze-raw-dataset-v1",
  "review-dataset-proposal-v1",
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
var VDT_COMPATIBILITY_SCHEMA_IDS = ["agent-decision-v1"];
var VDT_SCHEMA_IDS = ["connection-test-v1", ...VDT_COMPATIBILITY_SCHEMA_IDS, ...VDT_OUTPUT_SCHEMA_IDS];
var schemaTask = {
  "orchestrator-first-response-v1": "orchestrator_first_response",
  "agent-decision-v1": "agent_decision",
  "agent-decision-v2": "agent_decision",
  "agent-plan-v1": "agent_plan",
  "data-agent-decision-v1": "data_agent_decision",
  "analyze-raw-dataset-v1": "analyze_raw_dataset",
  "review-dataset-proposal-v1": "review_dataset_proposal",
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
  VDT_OUTPUT_SCHEMA_IDS.map((schemaId) => [schemaTask[schemaId], schemaId])
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
var nodeTypeProp = enumProp(["root_kpi", "calculated", "input", "assumption", "external_factor", "data_mapped"]);
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
    materiality: materialityProp,
    fixedInScenario: { type: "boolean" }
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
    materiality: materialityProp,
    fixedInScenario: { type: "boolean" }
  },
  []
);
var stringOrNumberProp = { anyOf: [stringProp, { type: "number" }] };
var agentBuildIntentSchema = objectSchema(
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
var agentExtractedInputSchema = objectSchema(
  {
    id: nodeIdProp,
    label: { type: "string", maxLength: 120 },
    value: stringOrNumberProp,
    unit: { type: "string", maxLength: 80 },
    sourceText: { type: "string", maxLength: 500 }
  },
  ["id", "label", "value"]
);
var agentMissingInputSchema = objectSchema(
  {
    id: nodeIdProp,
    question: { type: "string", maxLength: 500 },
    reason: { type: "string", maxLength: 1e3 },
    required: { type: "boolean" }
  },
  ["id", "question", "reason", "required"]
);
var agentDriverSchema = objectSchema(
  {
    id: nodeIdProp,
    parentNodeId: nodeIdProp,
    name: { type: "string", maxLength: 120 },
    type: nodeTypeProp,
    unit: { type: "string", maxLength: 80 },
    relation: edgeRelationProp,
    formula: { type: "string", maxLength: 500 },
    description: { type: "string", maxLength: 1e3 },
    value: stringOrNumberProp,
    assumptions: stringArrayProp
  },
  ["id", "parentNodeId", "name", "type", "unit", "relation", "formula", "description", "value", "assumptions"]
);
var agentQuestionSchema = objectSchema(
  {
    id: nodeIdProp,
    question: { type: "string", maxLength: 500 },
    reason: { type: "string", maxLength: 600 },
    required: { type: "boolean" },
    expectedAnswerType: enumProp(["text", "number", "single_choice", "multi_choice"]),
    answerKind: enumProp(["text", "number", "single_choice", "multi_choice", "field_group"]),
    options: {
      type: "array",
      maxItems: 20,
      items: {
        anyOf: [
          stringProp,
          objectSchema(
            {
              id: nodeIdProp,
              label: { type: "string", maxLength: 160 },
              value: { type: "string", maxLength: 500 },
              requiresFreeText: { type: "boolean" },
              revealsFields: arrayProp(objectSchema(
                {
                  id: nodeIdProp,
                  label: { type: "string", maxLength: 160 },
                  kind: enumProp(["text", "number"]),
                  unit: { type: "string", maxLength: 80 },
                  required: { type: "boolean" },
                  placeholder: { type: "string", maxLength: 200 }
                },
                ["id", "label", "kind"]
              ), 12)
            },
            ["id", "label", "value"]
          )
        ]
      }
    },
    fields: arrayProp(objectSchema(
      {
        id: nodeIdProp,
        label: { type: "string", maxLength: 160 },
        kind: enumProp(["text", "number"]),
        unit: { type: "string", maxLength: 80 },
        required: { type: "boolean" },
        placeholder: { type: "string", maxLength: 200 }
      },
      ["id", "label", "kind"]
    ), 12),
    freeTextAllowed: { type: "boolean" },
    placeholder: { type: "string", maxLength: 200 },
    defaultValue: { anyOf: [stringProp, { type: "number" }, stringArrayProp] }
  },
  ["id", "question", "reason", "required"]
);
var publicAgentStatusSchema = objectSchema(
  {
    phase: enumProp([
      "reading_request",
      "asking_questions",
      "planning_model",
      "running_subagents",
      "building_draft",
      "checking_model",
      "waiting_user",
      "ready",
      "retryable_error"
    ]),
    message: { type: "string", maxLength: 500 },
    progress: objectSchema(
      {
        completed: { type: "number" },
        total: { type: "number" }
      },
      ["completed", "total"]
    )
  },
  ["phase", "message"]
);
var orchestratorFirstResponseSchema = objectSchema(
  {
    assistantMessage: { type: "string", minLength: 1, maxLength: 2e3 },
    nextAction: enumProp(["ask_user", "continue_building"]),
    questions: { type: "array", maxItems: 5, items: agentQuestionSchema },
    publicStatus: publicAgentStatusSchema
  },
  ["assistantMessage", "nextAction", "questions", "publicStatus"]
);
var agentDecisionCallToolSchema = objectSchema(
  {
    type: { type: "string", const: "call_tool" },
    toolName: { type: "string", maxLength: 120 },
    args: { type: "object", properties: {}, required: [], additionalProperties: true },
    statusMessage: { type: "string", maxLength: 500 }
  },
  ["type", "toolName", "args", "statusMessage"]
);
var agentDecisionAskUserSchema = objectSchema(
  {
    type: { type: "string", const: "ask_user" },
    questions: { type: "array", minItems: 1, maxItems: 5, items: agentQuestionSchema },
    statusMessage: { type: "string", maxLength: 500 }
  },
  ["type", "questions", "statusMessage"]
);
var agentDecisionFinishSchema = objectSchema(
  {
    type: { type: "string", const: "finish" },
    summary: { type: "string", maxLength: 2e3 },
    nextSuggestedActions: { type: "array", maxItems: 10, items: { type: "string", maxLength: 300 } }
  },
  ["type", "summary", "nextSuggestedActions"]
);
var agentDecisionSchema = {
  type: "object",
  anyOf: [agentDecisionCallToolSchema, agentDecisionAskUserSchema, agentDecisionFinishSchema],
  properties: {},
  required: [],
  additionalProperties: false
};
var agentDecisionToolCallItemSchema = objectSchema(
  {
    toolName: { type: "string", minLength: 1, maxLength: 120 },
    args: { type: "object", properties: {}, required: [], additionalProperties: true }
  },
  ["toolName", "args"]
);
var agentDecisionCallToolsSchema = objectSchema(
  {
    type: { type: "string", const: "call_tools" },
    calls: { type: "array", minItems: 2, maxItems: 6, items: agentDecisionToolCallItemSchema },
    statusMessage: { type: "string", minLength: 1, maxLength: 500 }
  },
  ["type", "calls", "statusMessage"]
);
var agentDecisionV2Schema = {
  type: "object",
  anyOf: [agentDecisionCallToolSchema, agentDecisionCallToolsSchema, agentDecisionAskUserSchema, agentDecisionFinishSchema],
  properties: {},
  required: [],
  additionalProperties: false
};
var agentDecisionStrictResponseSchema = objectSchema(
  {
    type: enumProp(["call_tool", "ask_user", "finish"]),
    toolName: { type: "string", maxLength: 120 },
    argsJson: {
      type: "string",
      maxLength: MAX_OUTPUT_STRING_LENGTH,
      description: "A JSON object string containing tool arguments. Use {} when type is not call_tool."
    },
    statusMessage: {
      type: "string",
      minLength: 1,
      maxLength: 500,
      description: "A concise user-visible status message for this decision."
    },
    questionsJson: {
      type: "string",
      maxLength: MAX_OUTPUT_STRING_LENGTH,
      description: "A JSON array string containing user questions. Use [] unless type is ask_user."
    },
    summary: {
      type: "string",
      maxLength: 2e3,
      description: "Finish summary. Use an empty string unless type is finish."
    },
    nextSuggestedActions: {
      type: "array",
      maxItems: 10,
      items: { type: "string", maxLength: 300 }
    }
  },
  ["type", "toolName", "argsJson", "statusMessage", "questionsJson", "summary", "nextSuggestedActions"]
);
var agentDecisionV2StrictResponseSchema = objectSchema(
  {
    type: enumProp(["call_tool", "call_tools", "ask_user", "finish"]),
    toolName: { type: "string", maxLength: 120 },
    argsJson: {
      type: "string",
      maxLength: MAX_OUTPUT_STRING_LENGTH,
      description: "A JSON object string containing arguments for call_tool. Use {} for other decision types."
    },
    callsJson: {
      type: "string",
      maxLength: MAX_OUTPUT_STRING_LENGTH,
      description: "A JSON array string with 2-6 sequential {toolName,args} calls. Use [] unless type is call_tools."
    },
    statusMessage: {
      type: "string",
      minLength: 1,
      maxLength: 500,
      description: "A concise user-visible status message for this decision."
    },
    questionsJson: {
      type: "string",
      maxLength: MAX_OUTPUT_STRING_LENGTH,
      description: "A JSON array string containing user questions. Use [] unless type is ask_user."
    },
    summary: {
      type: "string",
      maxLength: 2e3,
      description: "Finish summary. Use an empty string unless type is finish."
    },
    nextSuggestedActions: {
      type: "array",
      maxItems: 10,
      items: { type: "string", maxLength: 300 }
    }
  },
  ["type", "toolName", "argsJson", "callsJson", "statusMessage", "questionsJson", "summary", "nextSuggestedActions"]
);
var dataDiscoveryToolNameProp = enumProp([
  "file.inspect",
  "file.preview_raw",
  "file.detect_tables",
  "table.list",
  "table.preview",
  "table.sample",
  "table.profile",
  "table.quality_report",
  "table.flatten_json",
  "table.select_columns",
  "column.profile",
  "column.detect_type",
  "column.detect_unit",
  "column.sample_values",
  "column.value_distribution",
  "column.parse_candidates",
  "column.semantic_role_candidates",
  "table.group_by",
  "table.pivot",
  "table.time_series",
  "table.correlate",
  "table.outliers",
  "table.duplicates",
  "table.cardinality_matrix",
  "text.normalize_values",
  "text.cluster_values",
  "text.extract_keywords",
  "text.suggest_taxonomy_candidates",
  "text.classification_diagnostics",
  "semantic.detect_entities",
  "semantic.detect_measures",
  "semantic.detect_dimensions",
  "semantic.detect_events",
  "semantic.build_dataset_summary",
  "vdt.project_excerpt",
  "vdt.find_matching_nodes",
  "vdt.propose_metric_bindings",
  "vdt.validate_formula_candidates",
  "vdt.validate_change_set"
]);
var dataAgentDecisionToolCallSchema = objectSchema(
  {
    type: { type: "string", const: "tool_call" },
    toolName: dataDiscoveryToolNameProp,
    rationale: { type: "string", minLength: 1, maxLength: 1e3 },
    input: { type: "object", properties: {}, required: [], additionalProperties: true }
  },
  ["type", "toolName", "rationale", "input"]
);
var dataAgentDecisionFinalSchema = objectSchema(
  {
    type: { type: "string", const: "final_proposal" },
    rationale: { type: "string", minLength: 1, maxLength: 2e3 },
    result: { type: "object", properties: {}, required: [], additionalProperties: true }
  },
  ["type", "rationale", "result"]
);
var dataAgentDecisionAskUserSchema = objectSchema(
  {
    type: { type: "string", const: "ask_user" },
    questions: { type: "array", minItems: 1, maxItems: 5, items: { type: "string", minLength: 1, maxLength: 500 } },
    rationale: { type: "string", minLength: 1, maxLength: 1e3 }
  },
  ["type", "questions", "rationale"]
);
var dataAgentDecisionSchema = {
  type: "object",
  anyOf: [dataAgentDecisionToolCallSchema, dataAgentDecisionFinalSchema, dataAgentDecisionAskUserSchema],
  properties: {},
  required: [],
  additionalProperties: false
};
var dataEvidenceSchema = objectSchema(
  {
    type: enumProp([
      "column_name",
      "value_pattern",
      "distribution",
      "aggregation_result",
      "data_quality",
      "cross_column_relationship",
      "user_confirmation",
      "model_reasoning"
    ]),
    message: { type: "string", minLength: 1, maxLength: 1e3 },
    strength: enumProp(["weak", "medium", "strong"]),
    observationRef: { type: "string", maxLength: 200 }
  },
  ["type", "message", "strength"]
);
var rawDatasetColumnSchema = objectSchema(
  {
    tableId: nodeIdProp,
    columnName: { type: "string", minLength: 1, maxLength: 200 },
    physicalType: enumProp(["string", "number", "date", "boolean", "mixed", "unknown"]),
    logicalType: enumProp([
      "identifier",
      "category",
      "text",
      "measure",
      "duration",
      "timestamp",
      "date",
      "currency",
      "percentage",
      "status",
      "other"
    ]),
    semanticRole: { type: "string", maxLength: 120 },
    unit: { type: "string", maxLength: 80 },
    confidence: confidenceProp,
    evidence: { type: "array", minItems: 1, maxItems: 12, items: dataEvidenceSchema },
    profileRef: { type: "string", minLength: 1, maxLength: 240 }
  },
  ["tableId", "columnName", "physicalType", "logicalType", "confidence", "evidence", "profileRef"]
);
var rawDatasetMetricCandidateSchema = objectSchema(
  {
    id: nodeIdProp,
    name: { type: "string", minLength: 1, maxLength: 200 },
    description: { type: "string", minLength: 1, maxLength: 800 },
    sourceTableId: nodeIdProp,
    sourceColumns: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", minLength: 1, maxLength: 200 } },
    aggregation: enumProp(["sum", "count", "avg", "min", "max", "ratio", "distinct_count", "custom"]),
    unit: { type: "string", maxLength: 80 },
    formula: { type: "string", maxLength: 1e3 },
    dimensions: { type: "array", maxItems: 20, items: nodeIdProp },
    confidence: confidenceProp,
    evidence: { type: "array", minItems: 1, maxItems: 12, items: dataEvidenceSchema },
    limitations: { type: "array", maxItems: 10, items: { type: "string", maxLength: 500 } }
  },
  ["id", "name", "description", "sourceTableId", "sourceColumns", "aggregation", "confidence", "evidence", "limitations"]
);
var rawDatasetAnalysisSchema = objectSchema(
  {
    datasetId: { type: "string", minLength: 1, maxLength: 200 },
    summary: objectSchema(
      {
        rowCount: { type: "number", minimum: 0 },
        tableCount: { type: "number", minimum: 0 },
        likelyDatasetKind: { type: "string", minLength: 1, maxLength: 200 },
        confidence: confidenceProp,
        description: { type: "string", minLength: 1, maxLength: 1e3 }
      },
      ["rowCount", "tableCount", "likelyDatasetKind", "confidence", "description"]
    ),
    columns: arrayProp(rawDatasetColumnSchema, 500),
    metricCandidates: arrayProp(rawDatasetMetricCandidateSchema, 50),
    assumptions: stringArrayProp,
    questionsForUser: stringArrayProp,
    warnings: stringArrayProp
  },
  ["datasetId", "summary", "columns", "metricCandidates", "assumptions", "questionsForUser", "warnings"]
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
    materiality: materialityProp,
    fixedInScenario: { type: "boolean" }
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
function parseJsonObjectString(value) {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return void 0;
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : void 0;
  } catch {
    return void 0;
  }
}
function parseJsonObjectArrayString(value) {
  if (isObjectArray(value)) return value;
  if (typeof value !== "string") return void 0;
  try {
    const parsed = JSON.parse(value);
    return isObjectArray(parsed) ? parsed : void 0;
  } catch {
    return void 0;
  }
}
function normalizeStatusMessage(value, fallback) {
  return typeof value === "string" && value.trim() ? value : fallback;
}
var userQuestionToolAliases = /* @__PURE__ */ new Set(["request_user_input", "ask_user", "user.ask", "user.request_input"]);
function questionFromRecord(record, index = 0) {
  const question = typeof record.question === "string" && record.question.trim() ? record.question : typeof record.message === "string" && record.message.trim() ? record.message : void 0;
  if (!question) return void 0;
  return {
    id: typeof record.id === "string" && record.id.trim() ? record.id : `question_${index + 1}`,
    question,
    reason: typeof record.reason === "string" && record.reason.trim() ? record.reason : "The agent needs this information before continuing.",
    required: typeof record.required === "boolean" ? record.required : true,
    ...typeof record.expectedAnswerType === "string" ? { expectedAnswerType: record.expectedAnswerType } : {},
    ...isStringArray(record.options) ? { options: record.options } : {},
    ...record.defaultValue === void 0 ? {} : { defaultValue: record.defaultValue }
  };
}
function questionsFromArgs(args) {
  if (isObjectArray(args.questions)) {
    return args.questions.map((question, index) => questionFromRecord(question, index)).filter((question) => question !== void 0);
  }
  const single = questionFromRecord(args);
  return single ? [single] : [];
}
function fallbackQuestionFromMessage(message) {
  const question = typeof message === "string" && message.trim() ? message.trim() : "What additional information should the agent use before continuing?";
  return [
    {
      id: "additional_input",
      question,
      reason: "The agent requested user input before continuing.",
      required: true
    }
  ];
}
function normalizeAgentDecisionOutput(output) {
  if (output.type === "call_tool") {
    const toolName = typeof output.toolName === "string" ? output.toolName : "";
    const args = parseJsonObjectString(output.argsJson ?? output.args) ?? {};
    if (userQuestionToolAliases.has(toolName)) {
      return {
        type: "ask_user",
        questions: questionsFromArgs(args),
        statusMessage: normalizeStatusMessage(output.statusMessage, "Additional inputs are needed.")
      };
    }
    return {
      type: output.type,
      toolName,
      args,
      statusMessage: normalizeStatusMessage(output.statusMessage, toolName ? `Calling ${toolName}.` : "Calling the next tool.")
    };
  }
  if (output.type === "call_tools") {
    const calls = parseJsonObjectArrayString(output.callsJson ?? output.calls) ?? [];
    return {
      type: output.type,
      calls: calls.map((call) => ({
        toolName: typeof call.toolName === "string" ? call.toolName : "",
        args: parseJsonObjectString(call.argsJson ?? call.args) ?? {}
      })),
      statusMessage: normalizeStatusMessage(output.statusMessage, "Running the next tool steps.")
    };
  }
  if (output.type === "ask_user") {
    const questions = parseJsonObjectArrayString(output.questionsJson ?? output.questions) ?? questionsFromArgs(parseJsonObjectString(output.argsJson ?? output.args) ?? {});
    return {
      type: output.type,
      questions: questions.length > 0 ? questions : fallbackQuestionFromMessage(output.statusMessage),
      statusMessage: normalizeStatusMessage(output.statusMessage, "Additional inputs are needed.")
    };
  }
  if (output.type === "finish") {
    return {
      type: output.type,
      summary: typeof output.summary === "string" && output.summary.trim() ? output.summary : "Finished the VDT agent run.",
      nextSuggestedActions: isStringArray(output.nextSuggestedActions) ? output.nextSuggestedActions : []
    };
  }
  return output;
}
function normalizeRegisteredSchemaOutput(schemaId, output) {
  if ((schemaId === "agent-decision-v1" || schemaId === "agent-decision-v2") && isRecord(output)) {
    return normalizeAgentDecisionOutput(output);
  }
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
  "orchestrator-first-response-v1": orchestratorFirstResponseSchema,
  "agent-decision-v1": agentDecisionSchema,
  "agent-decision-v2": agentDecisionV2Schema,
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
  "data-agent-decision-v1": dataAgentDecisionSchema,
  "analyze-raw-dataset-v1": rawDatasetAnalysisSchema,
  "review-dataset-proposal-v1": rawDatasetAnalysisSchema,
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
  if (schemaId === "agent-decision-v1") return agentDecisionStrictResponseSchema;
  if (schemaId === "agent-decision-v2") return agentDecisionV2StrictResponseSchema;
  return toStrictResponseJsonSchema(jsonSchemas[schemaId]);
}
var validators = {
  "connection-test-v1": (output) => output.ok === true,
  "orchestrator-first-response-v1": (output) => typeof output.assistantMessage === "string" && (output.nextAction === "ask_user" || output.nextAction === "continue_building") && isObjectArray(output.questions) && isRecord(output.publicStatus),
  "agent-decision-v1": (output) => {
    for (const forbidden of ["driverPlan", "nodes", "edges", "rootFormula", "project", "fullProject", "fullGraph", "selectedSkillIds"]) {
      if (forbidden in output) return false;
    }
    if (output.type === "call_tool") {
      return typeof output.toolName === "string" && isRecord(output.args) && typeof output.statusMessage === "string";
    }
    if (output.type === "ask_user") {
      return isObjectArray(output.questions) && output.questions.length > 0 && typeof output.statusMessage === "string";
    }
    if (output.type === "finish") {
      return typeof output.summary === "string" && isStringArray(output.nextSuggestedActions);
    }
    return false;
  },
  "agent-decision-v2": (output) => {
    for (const forbidden of ["driverPlan", "nodes", "edges", "rootFormula", "project", "fullProject", "fullGraph", "selectedSkillIds"]) {
      if (forbidden in output) return false;
    }
    if (output.type === "call_tools") {
      if (!isObjectArray(output.calls)) return false;
      const calls = output.calls;
      if (calls.length < 2 || calls.length > 6) return false;
      return calls.every(
        (call) => typeof call.toolName === "string" && call.toolName !== "user.ask" && call.toolName !== "user.request_approval" && isRecord(call.args)
      ) && typeof output.statusMessage === "string";
    }
    if (output.type === "call_tool") {
      return typeof output.toolName === "string" && isRecord(output.args) && typeof output.statusMessage === "string";
    }
    if (output.type === "ask_user") {
      return isObjectArray(output.questions) && output.questions.length > 0 && typeof output.statusMessage === "string";
    }
    if (output.type === "finish") {
      return typeof output.summary === "string" && isStringArray(output.nextSuggestedActions);
    }
    return false;
  },
  "agent-plan-v1": (output) => isRecord(output.buildIntent) && isStringArray(output.selectedSkillIds) && typeof output.skillRationale === "string" && isObjectArray(output.extractedInputs) && isObjectArray(output.missingInputs) && isObjectArray(output.driverPlan) && typeof output.rootFormula === "string" && validateAdvisoryArrays(output) && typeof output.confidence === "number",
  "data-agent-decision-v1": (output) => {
    if (output.type === "tool_call") {
      return typeof output.toolName === "string" && typeof output.rationale === "string" && isRecord(output.input);
    }
    if (output.type === "final_proposal") {
      return typeof output.rationale === "string" && isRecord(output.result);
    }
    if (output.type === "ask_user") {
      return isStringArray(output.questions) && output.questions.length > 0 && typeof output.rationale === "string";
    }
    return false;
  },
  "analyze-raw-dataset-v1": validateRawDatasetAnalysisOutput,
  "review-dataset-proposal-v1": validateRawDatasetAnalysisOutput,
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
function validateRawDatasetAnalysisOutput(output) {
  return typeof output.datasetId === "string" && isRecord(output.summary) && isObjectArray(output.columns) && isObjectArray(output.metricCandidates) && isStringArray(output.assumptions) && isStringArray(output.questionsForUser) && isStringArray(output.warnings);
}
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
    const { execFile: execFile9 } = await import("node:child_process");
    const { promisify: promisify9 } = await import("node:util");
    const result = await promisify9(execFile9)(executable, ["--version"], {
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
    if (isRecord4(value) && typeof value.visibility === "string" && value.visibility.toLowerCase() === "hide") {
      return;
    }
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
async function defaultExecFileProbe(executable, args, options) {
  const { execFile: execFile9 } = await import("node:child_process");
  const { promisify: promisify9 } = await import("node:util");
  const result = await promisify9(execFile9)(executable, [...args], options);
  return { stdout: result.stdout, stderr: result.stderr };
}
async function listCodexModels(executable, options = {}) {
  const execFile9 = options.execFile ?? defaultExecFileProbe;
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
    result = await execFile9(executable, ["debug", "models"], execOptions);
  } catch (error2) {
    const text = error2 instanceof Error ? error2.message : String(error2);
    if (!/service_tier|unknown variant `default`|unknown variant "default"/i.test(text)) throw error2;
    result = await execFile9(executable, ["debug", "models", ...CODEX_FAST_SERVICE_TIER_ARGS], execOptions);
  }
  return parseCodexModelList(`${result.stdout}
${result.stderr}`);
}
function buildCodexDynamicArgs(input) {
  const args = [];
  if (input.cwd) args.push("-C", input.cwd);
  if (input.model) args.push("--model", input.model);
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
    const { execFile: execFile9 } = await import("node:child_process");
    const { promisify: promisify9 } = await import("node:util");
    const result = await promisify9(execFile9)(executable, ["--version"], {
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
      return "Cursor sign-in required. Use Authenticate to start the Cursor CLI sign-in flow.";
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
    const statusMessage = [record.message, record.error, record.detail].filter((value) => typeof value === "string").join(" ").toLowerCase();
    if (/unable to fetch user|authentication required|login required|sign.?in required|token (?:is )?(?:invalid|expired)/.test(statusMessage)) {
      return "authentication_required";
    }
    const loggedIn = record.loggedIn ?? record.logged_in ?? record.authenticated ?? record.isAuthenticated;
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
  const { execFile: execFile9 } = await import("node:child_process");
  const { promisify: promisify9 } = await import("node:util");
  const result = await promisify9(execFile9)(executable, [...args], options);
  return { stdout: result.stdout, stderr: result.stderr };
}
async function listCursorAgentModels(executable, options = {}) {
  const execFile9 = options.execFile ?? defaultExecFileProbe2;
  const result = await execFile9(executable, ["models"], {
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
    const { execFile: execFile9 } = await import("node:child_process");
    const { promisify: promisify9 } = await import("node:util");
    const result = await promisify9(execFile9)(executable, ["--version"], {
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
    const { execFile: execFile9 } = await import("node:child_process");
    const { promisify: promisify9 } = await import("node:util");
    const result = await promisify9(execFile9)(executable, ["--version"], { encoding: "utf8", timeout: 5e3, maxBuffer: 64 * 1024, windowsHide: true, shell: false, signal });
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
    const { execFile: execFile9 } = await import("node:child_process");
    const { promisify: promisify9 } = await import("node:util");
    const result = await promisify9(execFile9)(executable, ["--version"], { encoding: "utf8", timeout: 5e3, maxBuffer: 64 * 1024, windowsHide: true, shell: false, signal });
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

// ../model-bridge/src/agent-engines/action-batch.ts
var DEFAULT_ACTION_BATCH_MAX_BYTES = 128 * 1024;
var FORBIDDEN_TOOL_PREFIXES = Object.freeze([
  "app.",
  "bash.",
  "browser.",
  "command.",
  "computer.",
  "exec.",
  "file.",
  "filesystem.",
  "fs.",
  "git.",
  "http.",
  "https.",
  "mcp.",
  "network.",
  "plugin.",
  "shell.",
  "subagent.",
  "terminal.",
  "tools.",
  "web."
]);

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue2) {
      return issue2.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error2) => {
      for (const issue2 of error2.issues) {
        if (issue2.code === "invalid_union") {
          issue2.unionErrors.map(processError);
        } else if (issue2.code === "invalid_return_type") {
          processError(issue2.returnTypeError);
        } else if (issue2.code === "invalid_arguments") {
          processError(issue2.argumentsError);
        } else if (issue2.path.length === 0) {
          fieldErrors._errors.push(mapper(issue2));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue2.path.length) {
            const el = issue2.path[i];
            const terminal = i === issue2.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue2));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue2) => issue2.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error2 = new ZodError(issues);
  return error2;
};

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/locales/en.js
var errorMap = (issue2, _ctx) => {
  let message;
  switch (issue2.code) {
    case ZodIssueCode.invalid_type:
      if (issue2.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue2.expected}, received ${issue2.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue2.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue2.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue2.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue2.options)}, received '${issue2.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue2.validation === "object") {
        if ("includes" in issue2.validation) {
          message = `Invalid input: must include "${issue2.validation.includes}"`;
          if (typeof issue2.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue2.validation.position}`;
          }
        } else if ("startsWith" in issue2.validation) {
          message = `Invalid input: must start with "${issue2.validation.startsWith}"`;
        } else if ("endsWith" in issue2.validation) {
          message = `Invalid input: must end with "${issue2.validation.endsWith}"`;
        } else {
          util.assertNever(issue2.validation);
        }
      } else if (issue2.validation !== "regex") {
        message = `Invalid ${issue2.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue2.type === "array")
        message = `Array must contain ${issue2.exact ? "exactly" : issue2.inclusive ? `at least` : `more than`} ${issue2.minimum} element(s)`;
      else if (issue2.type === "string")
        message = `String must contain ${issue2.exact ? "exactly" : issue2.inclusive ? `at least` : `over`} ${issue2.minimum} character(s)`;
      else if (issue2.type === "number")
        message = `Number must be ${issue2.exact ? `exactly equal to ` : issue2.inclusive ? `greater than or equal to ` : `greater than `}${issue2.minimum}`;
      else if (issue2.type === "bigint")
        message = `Number must be ${issue2.exact ? `exactly equal to ` : issue2.inclusive ? `greater than or equal to ` : `greater than `}${issue2.minimum}`;
      else if (issue2.type === "date")
        message = `Date must be ${issue2.exact ? `exactly equal to ` : issue2.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue2.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue2.type === "array")
        message = `Array must contain ${issue2.exact ? `exactly` : issue2.inclusive ? `at most` : `less than`} ${issue2.maximum} element(s)`;
      else if (issue2.type === "string")
        message = `String must contain ${issue2.exact ? `exactly` : issue2.inclusive ? `at most` : `under`} ${issue2.maximum} character(s)`;
      else if (issue2.type === "number")
        message = `Number must be ${issue2.exact ? `exactly` : issue2.inclusive ? `less than or equal to` : `less than`} ${issue2.maximum}`;
      else if (issue2.type === "bigint")
        message = `BigInt must be ${issue2.exact ? `exactly` : issue2.inclusive ? `less than or equal to` : `less than`} ${issue2.maximum}`;
      else if (issue2.type === "date")
        message = `Date must be ${issue2.exact ? `exactly` : issue2.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue2.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue2.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue2);
  }
  return { message };
};
var en_default = errorMap;

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path: path6, errorMaps, issueData } = params;
  const fullPath = [...path6, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue2 = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue2);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path6, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path6;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error2 = new ZodError(ctx.common.issues);
        this._error = error2;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue2, ctx) => {
          const defaultError = this._def.errorMap?.(issue2, ctx).message ?? ctx.defaultError;
          if (issue2.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error2) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error2
        }
      });
    }
    function makeReturnsIssue(returns, error2) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error2
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error2 = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error2.addIssue(makeArgsIssue(args, e));
          throw error2;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error2.addIssue(makeReturnsIssue(result, e));
          throw error2;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = /* @__PURE__ */ Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: ((arg) => ZodString.create({ ...arg, coerce: true })),
  number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
  boolean: ((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })),
  bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
  date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
};
var NEVER = INVALID;

// ../vdt-agent-runtime/src/schemas/agent-event.ts
var agentQuestionSchema2 = external_exports.object({
  id: external_exports.string().min(1).max(120),
  question: external_exports.string().min(1).max(500),
  reason: external_exports.string().min(1).max(600),
  required: external_exports.boolean(),
  expectedAnswerType: external_exports.enum(["text", "number", "single_choice", "multi_choice"]).optional(),
  answerKind: external_exports.enum(["text", "number", "single_choice", "multi_choice", "field_group"]).optional(),
  options: external_exports.array(external_exports.union([
    external_exports.string().max(160),
    external_exports.object({
      id: external_exports.string().min(1).max(120),
      label: external_exports.string().min(1).max(160),
      value: external_exports.string().min(1).max(500),
      revealsFields: external_exports.array(external_exports.object({
        id: external_exports.string().min(1).max(120),
        label: external_exports.string().min(1).max(160),
        kind: external_exports.enum(["text", "number"]),
        unit: external_exports.string().max(80).optional(),
        required: external_exports.boolean().optional(),
        placeholder: external_exports.string().max(200).optional()
      })).max(12).optional(),
      requiresFreeText: external_exports.boolean().optional()
    })
  ])).max(20).optional(),
  fields: external_exports.array(external_exports.object({
    id: external_exports.string().min(1).max(120),
    label: external_exports.string().min(1).max(160),
    kind: external_exports.enum(["text", "number"]),
    unit: external_exports.string().max(80).optional(),
    required: external_exports.boolean().optional(),
    placeholder: external_exports.string().max(200).optional()
  })).max(12).optional(),
  freeTextAllowed: external_exports.boolean().optional(),
  placeholder: external_exports.string().max(200).optional(),
  defaultValue: external_exports.union([external_exports.string(), external_exports.number(), external_exports.array(external_exports.string())]).optional()
});
var agentEventTypeSchema = external_exports.enum([
  "run_started",
  "classification",
  "skill_search",
  "skill_selected",
  "skill_read",
  "clarifying_questions",
  "user_answer_received",
  "user_instruction",
  "node_decomposition_requested",
  "assistant_message",
  "plan_proposed",
  "tool_call_started",
  "tool_call_completed",
  "mutation_proposed",
  "mutation_applied",
  "mutation_rejected",
  "graph_patch",
  "graph_validation",
  "manual_change_observed",
  "repair_started",
  "final_report",
  "run_completed",
  "error"
]);
var agentPhaseSchema = external_exports.enum([
  "classifying_request",
  "retrieving_skills",
  "reading_skills",
  "asking_clarifying_questions",
  "planning_decomposition",
  "building_graph",
  "previewing_mutation",
  "validating_graph",
  "repairing_graph",
  "applying_graph",
  "reporting"
]);
var agentEventSchema = external_exports.object({
  id: external_exports.string(),
  runId: external_exports.string(),
  seq: external_exports.number().int().positive(),
  timestamp: external_exports.string(),
  phase: agentPhaseSchema,
  type: agentEventTypeSchema,
  title: external_exports.string(),
  message: external_exports.string(),
  metadata: external_exports.record(external_exports.unknown()).optional(),
  patch: external_exports.unknown().optional(),
  questions: external_exports.array(agentQuestionSchema2).optional()
});

// ../vdt-agent-runtime/src/schemas/agent-run-event-v2.ts
var nonEmptyString = (max) => external_exports.string().trim().min(1).max(max);
var safeIdSchema = nonEmptyString(200).regex(
  /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/,
  "Must use only letters, numbers, dots, colons, underscores, or hyphens."
);
var sha256Schema = external_exports.string().regex(/^sha256:[a-f0-9]{64}$/);
var agentRunEventV2TypeSchema = external_exports.enum([
  "assistant_message",
  "question",
  "runtime_status",
  "tool_call",
  "tool_result",
  "approval_required",
  "checkpoint",
  "warning",
  "final",
  "error"
]);
var agentRunEventV2SourceSchema = external_exports.enum([
  "external_agent",
  "vdt_agent",
  "runtime",
  "tool_gateway"
]);
var commonEventShape = {
  schemaVersion: external_exports.literal(2),
  id: safeIdSchema,
  runId: safeIdSchema,
  seq: external_exports.number().int().positive(),
  previousHash: sha256Schema.nullable(),
  hash: sha256Schema,
  timestamp: external_exports.string().datetime({ offset: true }),
  sessionId: safeIdSchema.optional(),
  turnId: safeIdSchema.optional(),
  correlationId: safeIdSchema.optional(),
  messageId: safeIdSchema.optional()
};
var agentSourceSchema = external_exports.enum(["external_agent", "vdt_agent"]);
var warningOrErrorSourceSchema = external_exports.enum(["runtime", "tool_gateway"]);
var assistantMessageEventSchema = external_exports.object({
  ...commonEventShape,
  type: external_exports.literal("assistant_message"),
  source: agentSourceSchema,
  sessionId: safeIdSchema,
  messageId: safeIdSchema,
  payload: external_exports.object({
    text: nonEmptyString(8e3),
    format: external_exports.enum(["plain_text", "markdown"]),
    completed: external_exports.literal(true)
  }).strict()
}).strict();
var questionEventSchema = external_exports.object({
  ...commonEventShape,
  type: external_exports.literal("question"),
  source: agentSourceSchema,
  sessionId: safeIdSchema,
  messageId: safeIdSchema,
  payload: external_exports.object({
    questionSetId: safeIdSchema,
    checkpointId: safeIdSchema,
    questions: external_exports.array(agentQuestionSchema2.strict()).min(1).max(5)
  }).strict()
}).strict();
var runtimeStatusEventSchema = external_exports.object({
  ...commonEventShape,
  type: external_exports.literal("runtime_status"),
  source: external_exports.literal("runtime"),
  payload: external_exports.object({
    code: safeIdSchema,
    message: nonEmptyString(1e3),
    state: nonEmptyString(120).optional(),
    progress: external_exports.object({
      completed: external_exports.number().int().nonnegative(),
      total: external_exports.number().int().positive()
    }).strict().optional()
  }).strict()
}).strict();
var toolCallEventSchema = external_exports.object({
  ...commonEventShape,
  type: external_exports.literal("tool_call"),
  source: external_exports.literal("tool_gateway"),
  correlationId: safeIdSchema,
  payload: external_exports.object({
    externalCallId: safeIdSchema,
    toolName: nonEmptyString(160),
    argsHash: sha256Schema,
    replay: external_exports.boolean()
  }).strict()
}).strict();
var toolResultEventSchema = external_exports.object({
  ...commonEventShape,
  type: external_exports.literal("tool_result"),
  source: external_exports.literal("tool_gateway"),
  correlationId: safeIdSchema,
  payload: external_exports.object({
    externalCallId: safeIdSchema,
    toolName: nonEmptyString(160),
    status: external_exports.enum([
      "succeeded",
      "failed",
      "replayed",
      "waiting_user",
      "waiting_approval"
    ]),
    resultCode: nonEmptyString(160),
    resultHash: sha256Schema,
    retryable: external_exports.boolean()
  }).strict()
}).strict();
var approvalRequiredEventSchema = external_exports.object({
  ...commonEventShape,
  type: external_exports.literal("approval_required"),
  source: external_exports.literal("tool_gateway"),
  correlationId: safeIdSchema,
  payload: external_exports.object({
    approvalId: safeIdSchema,
    externalCallId: safeIdSchema,
    proposalId: safeIdSchema,
    proposalBasisHash: sha256Schema,
    summary: nonEmptyString(1e3)
  }).strict()
}).strict();
var checkpointEventSchema = external_exports.object({
  ...commonEventShape,
  type: external_exports.literal("checkpoint"),
  source: external_exports.literal("runtime"),
  payload: external_exports.object({
    checkpointId: safeIdSchema,
    checkpointHash: sha256Schema,
    reason: external_exports.enum([
      "engine_exchange",
      "tool_call",
      "tool_result",
      "waiting_user",
      "waiting_approval",
      "manual_reconciliation",
      "human_input_accepted",
      "finish_verified",
      "recovery"
    ]),
    sessionEpoch: external_exports.number().int().positive()
  }).strict()
}).strict();
var warningEventSchema = external_exports.object({
  ...commonEventShape,
  type: external_exports.literal("warning"),
  source: warningOrErrorSourceSchema,
  payload: external_exports.object({
    code: safeIdSchema,
    message: nonEmptyString(2e3),
    retryable: external_exports.boolean(),
    detailsHash: sha256Schema.nullable()
  }).strict()
}).strict();
var finalEventSchema = external_exports.object({
  ...commonEventShape,
  type: external_exports.literal("final"),
  source: agentSourceSchema,
  sessionId: safeIdSchema,
  messageId: safeIdSchema,
  payload: external_exports.object({
    text: nonEmptyString(8e3),
    format: external_exports.enum(["plain_text", "markdown"]),
    finishReceiptId: safeIdSchema,
    finishReceiptHash: sha256Schema
  }).strict()
}).strict();
var errorEventSchema = external_exports.object({
  ...commonEventShape,
  type: external_exports.literal("error"),
  source: warningOrErrorSourceSchema,
  payload: external_exports.object({
    code: safeIdSchema,
    message: nonEmptyString(2e3),
    retryable: external_exports.boolean(),
    detailsHash: sha256Schema.nullable()
  }).strict()
}).strict();
var agentRunEventV2Schema = external_exports.union([
  assistantMessageEventSchema,
  questionEventSchema,
  runtimeStatusEventSchema,
  toolCallEventSchema,
  toolResultEventSchema,
  approvalRequiredEventSchema,
  checkpointEventSchema,
  warningEventSchema,
  finalEventSchema,
  errorEventSchema
]).superRefine((value, ctx) => {
  if (value.seq === 1 && value.previousHash !== null) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["previousHash"],
      message: "The first event in a run must have a null previousHash."
    });
  }
  if (value.seq > 1 && value.previousHash === null) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["previousHash"],
      message: "Events after sequence 1 must link to the previous event hash."
    });
  }
});

// ../vdt-agent-runtime/src/agent-execution-contracts.ts
var nonEmptyString2 = (max) => external_exports.string().trim().min(1).max(max);
var safeIdSchema2 = nonEmptyString2(160).regex(
  /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/,
  "Must use only letters, numbers, dots, colons, underscores, or hyphens."
);
var sha256Schema2 = external_exports.string().regex(/^sha256:[a-f0-9]{64}$/);
var timestampSchema = external_exports.string().datetime({ offset: true });
var agentExecutionProfileSchema = external_exports.enum([
  "external_cli_agent",
  "model_agent"
]);
var agentSessionStrategySchema = external_exports.enum([
  "native",
  "checkpoint_resume",
  "structured_turn"
]);
var agentToolIsolationSchema = external_exports.enum([
  "unverified",
  "permission_only",
  "hard_verified"
]);
var agentQualificationStatusSchema = external_exports.enum([
  "unverified",
  "qualified",
  "rejected",
  "revoked"
]);
var agentPlatformSchema = external_exports.object({
  os: nonEmptyString2(80),
  arch: nonEmptyString2(80),
  runtimeVersion: nonEmptyString2(120).nullable()
}).strict();
var agentQualificationSchema = external_exports.object({
  status: agentQualificationStatusSchema,
  platform: agentPlatformSchema,
  testedAt: timestampSchema.nullable(),
  evidenceHash: sha256Schema2.nullable()
}).strict().superRefine((value, ctx) => {
  if (value.status === "qualified" && value.testedAt === null) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["testedAt"],
      message: "A qualified capability must include testedAt."
    });
  }
  if (value.status === "qualified" && value.evidenceHash === null) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["evidenceHash"],
      message: "A qualified capability must include evidenceHash."
    });
  }
});
var capabilityFlagsShape = {
  supportsNativeSession: external_exports.boolean(),
  supportsResume: external_exports.boolean(),
  supportsStructuredEvents: external_exports.boolean(),
  supportsToolBridge: external_exports.boolean(),
  supportsQuestions: external_exports.boolean(),
  supportsCancellation: external_exports.boolean(),
  supportsUsageMetrics: external_exports.boolean()
};
var capabilityCommonShape = {
  schemaVersion: external_exports.literal(1),
  engineId: safeIdSchema2,
  engineAdapterId: safeIdSchema2,
  backendId: safeIdSchema2,
  protocolVersion: nonEmptyString2(120),
  sessionStrategy: agentSessionStrategySchema,
  toolCatalogHash: sha256Schema2,
  toolIsolation: agentToolIsolationSchema,
  qualification: agentQualificationSchema,
  ...capabilityFlagsShape
};
var externalAgentCapabilitySchema = external_exports.object({
  ...capabilityCommonShape,
  executionProfile: external_exports.literal("external_cli_agent"),
  cli: external_exports.object({
    name: nonEmptyString2(120),
    version: nonEmptyString2(120)
  }).strict()
}).strict().superRefine((value, ctx) => {
  if (value.sessionStrategy === "structured_turn") {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["sessionStrategy"],
      message: "The external_cli_agent profile must use native or checkpoint_resume."
    });
  }
  if (value.sessionStrategy === "native" && !value.supportsNativeSession) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["supportsNativeSession"],
      message: "A native external session must advertise supportsNativeSession."
    });
  }
  if (value.sessionStrategy === "checkpoint_resume" && !value.supportsResume) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["supportsResume"],
      message: "A checkpoint_resume external session must advertise supportsResume."
    });
  }
  if (!value.supportsStructuredEvents || !value.supportsToolBridge) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: [!value.supportsStructuredEvents ? "supportsStructuredEvents" : "supportsToolBridge"],
      message: "External execution requires structured events and the VDT-only tool bridge."
    });
  }
  if (value.toolIsolation === "hard_verified" && value.qualification.status !== "qualified") {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["toolIsolation"],
      message: "hard_verified isolation requires a qualified capability."
    });
  }
});
var modelAgentCapabilitySchema = external_exports.object({
  ...capabilityCommonShape,
  executionProfile: external_exports.literal("model_agent"),
  cli: external_exports.null()
}).strict().superRefine((value, ctx) => {
  if (value.sessionStrategy !== "structured_turn") {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["sessionStrategy"],
      message: "The model_agent profile must use structured_turn."
    });
  }
  if (!value.supportsStructuredEvents || !value.supportsToolBridge) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: [!value.supportsStructuredEvents ? "supportsStructuredEvents" : "supportsToolBridge"],
      message: "Model-agent execution requires structured events and the VDT-only tool bridge."
    });
  }
});
var agentCapabilityProfileSchema = external_exports.union([
  externalAgentCapabilitySchema,
  modelAgentCapabilitySchema
]);
var agentSessionBindingSchema = external_exports.object({
  schemaVersion: external_exports.literal(2),
  bindingId: safeIdSchema2,
  runId: safeIdSchema2,
  projectId: safeIdSchema2,
  executionProfile: agentExecutionProfileSchema,
  engineId: safeIdSchema2,
  engineAdapterId: safeIdSchema2,
  backendId: safeIdSchema2,
  modelId: nonEmptyString2(160),
  protocolVersion: nonEmptyString2(120),
  cliVersion: nonEmptyString2(120).nullable(),
  toolIsolation: agentToolIsolationSchema,
  qualificationStatus: agentQualificationStatusSchema,
  capabilityEvidenceHash: sha256Schema2.nullable(),
  settingsHash: sha256Schema2,
  capabilityProfileHash: sha256Schema2,
  toolCatalogHash: sha256Schema2,
  externalSessionId: nonEmptyString2(512).nullable(),
  sessionEpoch: external_exports.number().int().positive(),
  boundAt: timestampSchema
}).strict().superRefine((value, ctx) => {
  if (value.executionProfile === "external_cli_agent" && value.cliVersion === null) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["cliVersion"],
      message: "An external CLI binding must pin the CLI version."
    });
  }
  if (value.executionProfile === "model_agent" && value.cliVersion !== null) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["cliVersion"],
      message: "A model-agent binding cannot claim a CLI version."
    });
  }
  if (value.qualificationStatus === "qualified" && value.capabilityEvidenceHash === null) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["capabilityEvidenceHash"],
      message: "A qualified binding must pin its capability evidence hash."
    });
  }
});
var checkpointCursorSchema = external_exports.object({
  cursor: nonEmptyString2(512),
  contentHash: sha256Schema2
}).strict();
var activeExchangeSchema = external_exports.object({
  exchangeId: safeIdSchema2,
  stableCallKey: safeIdSchema2,
  state: external_exports.enum(["prepared", "in_flight", "completed", "failed", "ambiguous"])
}).strict();
var activeToolCallSchema = external_exports.object({
  externalCallId: safeIdSchema2,
  toolName: nonEmptyString2(160),
  state: external_exports.enum(["reserved", "in_flight", "completed", "failed", "ambiguous"])
}).strict();
var finishCheckpointSchema = external_exports.object({
  receiptId: safeIdSchema2,
  state: external_exports.enum(["verified", "final_persisted"]),
  receiptHash: sha256Schema2
}).strict();
var agentHumanInputSchema = external_exports.discriminatedUnion("type", [
  external_exports.object({
    type: external_exports.literal("user_answer"),
    questionSetId: nonEmptyString2(160),
    answers: external_exports.record(external_exports.string(), external_exports.unknown())
  }).strict(),
  external_exports.object({
    type: external_exports.literal("user_instruction"),
    text: nonEmptyString2(8e3)
  }).strict()
]);
var agentEngineCheckpointSchema = external_exports.object({
  schemaVersion: external_exports.literal(2),
  checkpointId: safeIdSchema2,
  bindingId: safeIdSchema2,
  runId: safeIdSchema2,
  sessionEpoch: external_exports.number().int().positive(),
  externalSessionId: nonEmptyString2(512).nullable(),
  lastConfirmedInput: checkpointCursorSchema.nullable(),
  lastConfirmedOutput: checkpointCursorSchema.nullable(),
  activeExchange: activeExchangeSchema.nullable(),
  activeToolCall: activeToolCallSchema.nullable(),
  finishReceipt: finishCheckpointSchema.nullable(),
  /** Inputs accepted by the Supervisor but not yet confirmed by an engine
   * exchange. Optional keeps previously persisted Sequence 4 checkpoints
   * readable while making new acknowledgements crash-safe. */
  pendingHumanInputs: external_exports.array(agentHumanInputSchema).max(20).optional(),
  createdAt: timestampSchema
}).strict();
var MODEL_CONTROLLED_AUTHORITY_KEYS = /* @__PURE__ */ new Set([
  "actor",
  "backendid",
  "bindingid",
  "capabilityevidencehash",
  "capabilityprofilehash",
  "engineadapterid",
  "enginebindingid",
  "expecteddraftrevision",
  "expectedrevision",
  "externalsessionid",
  "idempotencykey",
  "leasegeneration",
  "leasetoken",
  "modelid",
  "ownertoken",
  "permission",
  "permissions",
  "projectid",
  "revision",
  "runid",
  "sessionepoch",
  "sessionid",
  "settingshash",
  "toolcataloghash"
]);
function normalizedAuthorityKey(key) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function findModelControlledAuthorityKey(value, path6 = [], visited = /* @__PURE__ */ new WeakSet()) {
  if (value === null || typeof value !== "object") return void 0;
  if (visited.has(value)) return void 0;
  visited.add(value);
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const found = findModelControlledAuthorityKey(entry, [...path6, index], visited);
      if (found) return found;
    }
    return void 0;
  }
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = [...path6, key];
    if (MODEL_CONTROLLED_AUTHORITY_KEYS.has(normalizedAuthorityKey(key))) {
      return entryPath;
    }
    const found = findModelControlledAuthorityKey(entry, entryPath, visited);
    if (found) return found;
  }
  return void 0;
}
var vdtGatewayToolCallSchema = external_exports.object({
  externalCallId: safeIdSchema2,
  toolName: nonEmptyString2(160),
  args: external_exports.record(external_exports.unknown())
}).strict().superRefine((value, ctx) => {
  const authorityPath = findModelControlledAuthorityKey(value.args);
  if (authorityPath) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["args", ...authorityPath],
      message: "Run authority is server-owned and cannot be supplied in tool arguments."
    });
  }
});
var vdtGatewayToolResultSchema = external_exports.object({
  externalCallId: safeIdSchema2,
  toolName: nonEmptyString2(160),
  status: external_exports.enum([
    "succeeded",
    "failed",
    "replayed",
    "waiting_user",
    "waiting_approval"
  ]),
  resultCode: nonEmptyString2(160),
  resultHash: sha256Schema2,
  payload: external_exports.unknown()
}).strict();
var CONTROL_TOOLS = /* @__PURE__ */ new Set([
  "user.ask",
  "approval.request",
  "user.request_approval",
  "run.request_finish"
]);
var agentActionBatchSchema = external_exports.object({
  calls: external_exports.array(vdtGatewayToolCallSchema).min(1).max(6)
}).strict().superRefine((value, ctx) => {
  const ids = /* @__PURE__ */ new Set();
  for (const [index, call] of value.calls.entries()) {
    if (ids.has(call.externalCallId)) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["calls", index, "externalCallId"],
        message: "externalCallId must be unique within an ActionBatch."
      });
    }
    ids.add(call.externalCallId);
  }
  if (value.calls.length > 1) {
    for (const [index, call] of value.calls.entries()) {
      if (CONTROL_TOOLS.has(call.toolName)) {
        ctx.addIssue({
          code: external_exports.ZodIssueCode.custom,
          path: ["calls", index, "toolName"],
          message: "Question, approval, and finish calls must be the only call in a batch."
        });
      }
    }
  }
});

// ../vdt-agent-runtime/src/agent-supervisor-persistence.ts
var nonEmptyString3 = (max) => external_exports.string().trim().min(1).max(max);
var safeIdSchema3 = nonEmptyString3(200).regex(
  /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/,
  "Must use only letters, numbers, dots, colons, underscores, or hyphens."
);
var sha256Schema3 = external_exports.string().regex(/^sha256:[a-f0-9]{64}$/);
var timestampSchema2 = external_exports.string().datetime({ offset: true });
var exchangeStateSchema = external_exports.enum([
  "prepared",
  "in_flight",
  "completed",
  "failed",
  "ambiguous"
]);
var toolOperationStateSchema = external_exports.enum([
  "reserved",
  "in_flight",
  "completed",
  "failed",
  "ambiguous"
]);
var agentEngineExchangeReceiptV2Schema = external_exports.object({
  schemaVersion: external_exports.literal(2),
  receiptId: safeIdSchema3,
  runId: safeIdSchema3,
  bindingId: safeIdSchema3,
  exchangeId: safeIdSchema3,
  stableCallKey: safeIdSchema3,
  sessionEpoch: external_exports.number().int().positive(),
  state: exchangeStateSchema,
  inputHash: sha256Schema3,
  outputHash: sha256Schema3.nullable(),
  resultCode: safeIdSchema3.nullable(),
  startedAt: timestampSchema2,
  updatedAt: timestampSchema2
}).strict().superRefine((value, ctx) => {
  if (value.updatedAt < value.startedAt) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["updatedAt"],
      message: "updatedAt must not precede startedAt."
    });
  }
  if (value.state === "completed" && value.outputHash === null) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["outputHash"],
      message: "A completed exchange must include outputHash."
    });
  }
  if ((value.state === "failed" || value.state === "ambiguous") && value.resultCode === null) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["resultCode"],
      message: "A failed or ambiguous exchange must include resultCode."
    });
  }
});
var agentToolOperationReceiptV2Schema = external_exports.object({
  schemaVersion: external_exports.literal(2),
  receiptId: safeIdSchema3,
  runId: safeIdSchema3,
  bindingId: safeIdSchema3,
  externalCallId: safeIdSchema3,
  toolName: nonEmptyString3(160),
  idempotencyKey: safeIdSchema3,
  sessionEpoch: external_exports.number().int().positive(),
  state: toolOperationStateSchema,
  argsHash: sha256Schema3,
  resultHash: sha256Schema3.nullable(),
  resultCode: safeIdSchema3.nullable(),
  /** Exact bounded gateway response used for terminal same-key replay. It is
   * internal authority state and is never included in the public summary. */
  replayResult: vdtGatewayToolResultSchema.nullable().optional(),
  expectedRevision: external_exports.number().int().nonnegative().nullable(),
  committedRevision: external_exports.number().int().nonnegative().nullable(),
  startedAt: timestampSchema2,
  updatedAt: timestampSchema2
}).strict().superRefine((value, ctx) => {
  if (value.updatedAt < value.startedAt) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["updatedAt"],
      message: "updatedAt must not precede startedAt."
    });
  }
  if (value.state === "completed" && (value.resultHash === null || value.resultCode === null)) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["resultHash"],
      message: "A completed tool operation must include resultHash and resultCode."
    });
  }
  if (value.replayResult) {
    if (value.replayResult.externalCallId !== value.externalCallId || value.replayResult.toolName !== value.toolName || value.replayResult.resultHash !== value.resultHash || value.replayResult.resultCode !== value.resultCode) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["replayResult"],
        message: "replayResult must match the stable tool receipt identity and result hashes."
      });
    }
    if (new TextEncoder().encode(JSON.stringify(value.replayResult)).byteLength > 256 * 1024) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["replayResult"],
        message: "replayResult exceeds the 256 KiB durable replay limit."
      });
    }
  }
  if ((value.state === "failed" || value.state === "ambiguous") && value.resultCode === null) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["resultCode"],
      message: "A failed or ambiguous tool operation must include resultCode."
    });
  }
  if (value.committedRevision !== null && value.expectedRevision !== null && value.committedRevision < value.expectedRevision) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["committedRevision"],
      message: "committedRevision must not precede expectedRevision."
    });
  }
});
var finishReceiptV2Schema = external_exports.object({
  schemaVersion: external_exports.literal(2),
  receiptId: safeIdSchema3,
  runId: safeIdSchema3,
  bindingId: safeIdSchema3,
  sessionEpoch: external_exports.number().int().positive(),
  state: external_exports.enum(["verified", "final_persisted"]),
  receiptHash: sha256Schema3,
  projectRevision: external_exports.number().int().nonnegative(),
  projectHash: sha256Schema3,
  validationHash: sha256Schema3,
  calculationHash: sha256Schema3,
  finalMessageHash: sha256Schema3.nullable(),
  verifiedAt: timestampSchema2,
  finalPersistedAt: timestampSchema2.nullable()
}).strict().superRefine((value, ctx) => {
  if (value.state === "verified") {
    if (value.finalMessageHash !== null || value.finalPersistedAt !== null) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["state"],
        message: "A verified finish receipt cannot claim a persisted final message."
      });
    }
    return;
  }
  if (value.finalMessageHash === null || value.finalPersistedAt === null) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["finalMessageHash"],
      message: "A final_persisted receipt must include the final message hash and timestamp."
    });
  } else if (value.finalPersistedAt < value.verifiedAt) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["finalPersistedAt"],
      message: "finalPersistedAt must not precede verifiedAt."
    });
  }
});
var recoveredFinishFinalizationV2Schema = external_exports.object({
  schemaVersion: external_exports.literal(2),
  runId: safeIdSchema3,
  bindingId: safeIdSchema3,
  receiptId: safeIdSchema3,
  receiptHash: sha256Schema3,
  originSessionEpoch: external_exports.number().int().positive(),
  recoverySessionEpoch: external_exports.number().int().positive(),
  finalMessageHash: sha256Schema3,
  finalPersistedAt: timestampSchema2
}).strict().superRefine((value, ctx) => {
  if (value.recoverySessionEpoch !== value.originSessionEpoch + 1) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["recoverySessionEpoch"],
      message: "Recovered finish finalization requires the exact successor session epoch."
    });
  }
});
var agentSupervisorPersistenceStateV2Schema = external_exports.object({
  schemaVersion: external_exports.literal(2),
  binding: agentSessionBindingSchema,
  checkpoint: agentEngineCheckpointSchema.nullable(),
  exchangeReceipts: external_exports.array(agentEngineExchangeReceiptV2Schema),
  toolOperationReceipts: external_exports.array(agentToolOperationReceiptV2Schema),
  finishReceipt: finishReceiptV2Schema.nullable(),
  eventOutbox: external_exports.array(agentRunEventV2Schema).optional(),
  updatedAt: timestampSchema2
}).strict();

// ../vdt-agent-runtime/src/feedback.ts
function createStructuredFeedback(input) {
  return {
    ...input,
    id: input.id ?? `feedback_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: input.createdAt ?? (/* @__PURE__ */ new Date()).toISOString()
  };
}

// ../vdt-core/src/builder/ids.ts
function stableSnakeId(input, fallback = "node") {
  const normalized = input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const safe = normalized || fallback;
  return /^[a-z]/.test(safe) ? safe : `${fallback}_${safe}`;
}
function uniqueId(base, existing) {
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}_${suffix}`)) {
    suffix += 1;
  }
  return `${base}_${suffix}`;
}

// ../vdt-core/src/formula/ast.ts
var FormulaParseError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "FormulaParseError";
  }
};
var FormulaEvaluationError = class extends Error {
  constructor(code, message, reference) {
    super(message);
    this.code = code;
    this.reference = reference;
    this.name = "FormulaEvaluationError";
  }
  code;
  reference;
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
  const functionParentheses = [];
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
        if (next === "," && !functionParentheses.includes(true)) {
          const comma = scanCommaNumericSegment(formula, start, index, hasDot);
          if (comma) {
            index = comma.end;
            continue;
          }
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
      let value = Number(normalizeNumericLiteral(numericRaw));
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
      functionParentheses.push(tokens.at(-2)?.type === "identifier");
      index += 1;
      continue;
    }
    if (char === ")") {
      tokens.push({ type: "right_paren" });
      functionParentheses.pop();
      index += 1;
      continue;
    }
    if (char === ",") {
      tokens.push({ type: "comma" });
      index += 1;
      continue;
    }
    throw new FormulaParseError(`Unsupported token "${char}" in formula.`);
  }
  tokens.push({ type: "eof" });
  return tokens;
}
function scanCommaNumericSegment(formula, start, commaIndex, hasDot) {
  if (hasDot || !isDigit(formula[commaIndex - 1] ?? "") || !isDigit(formula[commaIndex + 1] ?? "")) {
    return void 0;
  }
  let end = commaIndex + 1;
  while (isDigit(formula[end] ?? "")) end += 1;
  const firstGroupLength = end - (commaIndex + 1);
  const next = formula[end];
  if (next === ",") {
    if (firstGroupLength !== 3) return void 0;
    let cursor = end;
    while (formula[cursor] === ",") {
      const groupStart = cursor + 1;
      cursor = groupStart;
      while (isDigit(formula[cursor] ?? "")) cursor += 1;
      if (cursor - groupStart !== 3) return void 0;
    }
    return { end: cursor };
  }
  const integerLength = commaIndex - start;
  if (integerLength < 1 || firstGroupLength < 1) return void 0;
  return { end };
}
function normalizeNumericLiteral(raw) {
  if (!raw.includes(",")) return raw;
  const groups = raw.split(",");
  if (groups.length > 2 && groups.slice(1).every((group) => group.length === 3)) {
    return groups.join("");
  }
  if (groups.length === 2 && groups[1]?.length === 3) {
    return groups.join("");
  }
  return raw.replace(",", ".");
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
      const next = this.peek();
      if (next.type === "left_paren") {
        if (token.value === "min" || token.value === "max") {
          return this.parseCall(token.value);
        }
        throw new FormulaParseError(`Unknown function "${token.value}".`);
      }
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
  parseCall(name) {
    const open = this.advance();
    if (open.type !== "left_paren") {
      throw new FormulaParseError("Expected '(' after function name.");
    }
    if (this.peek().type === "right_paren") {
      throw new FormulaParseError(`Function "${name}" requires at least one argument.`);
    }
    const args = [this.parseAdditive()];
    while (this.peek().type === "comma") {
      this.advance();
      if (this.peek().type === "right_paren") {
        throw new FormulaParseError("Trailing comma in function call.");
      }
      args.push(this.parseAdditive());
    }
    if (this.peek().type !== "right_paren") {
      throw new FormulaParseError("Missing closing parenthesis in function call.");
    }
    this.advance();
    return { type: "call", name, args };
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
  } else if (expression.type === "call") {
    for (const arg of expression.args) {
      extractReferencesFromAst(arg, references);
    }
  }
  return [...references];
}
function extractFormulaReferences(formula) {
  return extractReferencesFromAst(parseFormula(formula));
}
function evaluateAst(expression, resolve) {
  switch (expression.type) {
    case "number":
      return expression.value;
    case "reference": {
      const value = resolve(expression.name);
      if (value === void 0) {
        throw new FormulaEvaluationError(
          "missing_value",
          `Missing value for formula reference: ${expression.name}`,
          expression.name
        );
      }
      return value;
    }
    case "unary":
      return -evaluateAst(expression.expression, resolve);
    case "binary": {
      const left = evaluateAst(expression.left, resolve);
      const right = evaluateAst(expression.right, resolve);
      if (expression.operator === "+") {
        return left + right;
      }
      if (expression.operator === "-") {
        return left - right;
      }
      if (expression.operator === "*") {
        return left * right;
      }
      if (right === 0) {
        throw new FormulaEvaluationError("division_by_zero", "Formula attempted to divide by zero.");
      }
      return left / right;
    }
    case "call": {
      const values = expression.args.map((arg) => evaluateAst(arg, resolve));
      return expression.name === "min" ? Math.min(...values) : Math.max(...values);
    }
  }
}
function formatResolvedAst(expression, values) {
  switch (expression.type) {
    case "number":
      return expression.raw;
    case "reference": {
      const value = values[expression.name];
      return value === void 0 ? expression.name : String(Number(value.toFixed(6)));
    }
    case "unary":
      return `-${formatResolvedAst(expression.expression, values)}`;
    case "binary": {
      const left = formatResolvedAst(expression.left, values);
      const right = formatResolvedAst(expression.right, values);
      return `${left} ${expression.operator} ${right}`;
    }
    case "call": {
      const args = expression.args.map((arg) => formatResolvedAst(arg, values));
      return `${expression.name}(${args.join(", ")})`;
    }
  }
}
function resolveFormulaText(formula, values) {
  return formatResolvedAst(parseFormula(formula), values);
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
  if (expression.type === "call") {
    const argUnits = [];
    for (const arg of expression.args) {
      argUnits.push(
        collectUnitWarnings(node, arg, nodeById, warnings, `${path6}-arg-${argUnits.length}`)
      );
    }
    for (let index = 0; index < argUnits.length; index += 1) {
      for (let otherIndex = index + 1; otherIndex < argUnits.length; otherIndex += 1) {
        const leftUnit2 = argUnits[index];
        const rightUnit2 = argUnits[otherIndex];
        if (leftUnit2 && rightUnit2 && !unitsCompatible(leftUnit2, rightUnit2)) {
          warnings.push(
            warning(
              `validation-unit-mismatch-${node.id}-${path6}-${index}-${otherIndex}`,
              "unit_mismatch",
              `Formula for "${node.name}" combines incompatible units in "${expression.name}(...)": "${leftUnit2}" and "${rightUnit2}"`,
              node.id
            )
          );
        }
      }
    }
    return argUnits.find((unit) => unit !== void 0);
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

// ../vdt-core/src/utils.ts
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function stableIdPart(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
}
function warning2(input) {
  const stableId2 = input.id ?? [
    "warning",
    input.severity,
    input.type,
    input.nodeId ?? input.edgeId ?? "global",
    stableIdPart(input.message)
  ].join("_");
  return {
    id: stableId2,
    severity: input.severity,
    type: input.type,
    message: input.message,
    ...input.nodeId ? { nodeId: input.nodeId } : {},
    ...input.edgeId ? { edgeId: input.edgeId } : {}
  };
}
function cloneProject(value) {
  return JSON.parse(JSON.stringify(value));
}

// ../vdt-core/src/changeset/mutate.ts
function filterChangeSet(changeSet2, selection) {
  const isSelected = (id) => !selection || selection.has(id);
  return {
    additions: changeSet2.additions.filter((entry) => isSelected(entry.id)),
    updates: changeSet2.updates.filter((entry) => isSelected(entry.id)),
    deletions: changeSet2.deletions.filter((entry) => isSelected(entry.id)),
    edgeChanges: changeSet2.edgeChanges.filter((entry) => isSelected(entry.id)),
    dataSourceChanges: (changeSet2.dataSourceChanges ?? []).filter((entry) => isSelected(entry.id)),
    dataMappingChanges: (changeSet2.dataMappingChanges ?? []).filter((entry) => isSelected(entry.id)),
    taxonomyChanges: (changeSet2.taxonomyChanges ?? []).filter((entry) => isSelected(entry.id))
  };
}
function defaultNodeType(addition2) {
  if (addition2.type) {
    return addition2.type;
  }
  return addition2.relation === "contextual_influence" ? "external_factor" : "input";
}
function additionToNode(addition2, timestamp) {
  return {
    id: addition2.nodeId,
    name: addition2.name,
    type: defaultNodeType(addition2),
    status: "ai_suggested",
    aiGenerated: true,
    ...definedProperties({
      description: addition2.description,
      unit: addition2.unit,
      formula: addition2.formula,
      value: addition2.value,
      baselineValue: addition2.baselineValue,
      valueStatus: addition2.valueStatus,
      valueSource: addition2.valueSource,
      aiConfidence: addition2.aiConfidence,
      aiRationale: addition2.aiRationale,
      assumptions: addition2.assumptions,
      tags: addition2.tags,
      owner: addition2.owner,
      controllability: addition2.controllability,
      materiality: addition2.materiality,
      fixedInScenario: addition2.fixedInScenario,
      dataMapping: addition2.dataMapping
    }),
    createdAt: timestamp,
    updatedAt: timestamp
  };
}
function additionToEdge(addition2) {
  return {
    id: `edge_${addition2.parentNodeId}_${addition2.nodeId}`,
    sourceNodeId: addition2.parentNodeId,
    targetNodeId: addition2.nodeId,
    relation: addition2.relation,
    label: "AI proposed",
    aiGenerated: true,
    ...definedProperties({ aiConfidence: addition2.aiConfidence })
  };
}
function collectChangeSetStructureWarnings(changeSet2, project, filtered) {
  const errors = [];
  const seenEntryIds = /* @__PURE__ */ new Set();
  for (const entry of [
    ...changeSet2.additions,
    ...changeSet2.updates,
    ...changeSet2.deletions,
    ...changeSet2.edgeChanges,
    ...changeSet2.dataSourceChanges ?? [],
    ...changeSet2.dataMappingChanges ?? [],
    ...changeSet2.taxonomyChanges ?? []
  ]) {
    if (seenEntryIds.has(entry.id)) {
      errors.push(
        warning2({
          severity: "error",
          type: "invalid_graph",
          message: `Duplicate change entry id: ${entry.id}`
        })
      );
    }
    seenEntryIds.add(entry.id);
  }
  const existingNodeIds = new Set(project.graph.nodes.map((node) => node.id));
  const dataSourcesById = new Map(project.dataSources.map((source) => [source.id, source]));
  const existingDataSourceIds = new Set(dataSourcesById.keys());
  const proposedNodeIds = /* @__PURE__ */ new Set();
  const proposedDataSourceIds = /* @__PURE__ */ new Set();
  const proposedDataSourcesById = /* @__PURE__ */ new Map();
  for (const addition2 of filtered.additions) {
    if (proposedNodeIds.has(addition2.nodeId)) {
      errors.push(
        warning2({
          severity: "error",
          type: "invalid_graph",
          message: `Duplicate proposed node id in change set: ${addition2.nodeId}`,
          nodeId: addition2.nodeId
        })
      );
    }
    proposedNodeIds.add(addition2.nodeId);
    if (existingNodeIds.has(addition2.nodeId)) {
      errors.push(
        warning2({
          severity: "error",
          type: "invalid_graph",
          message: `Addition targets existing node id: ${addition2.nodeId}`,
          nodeId: addition2.nodeId
        })
      );
    }
  }
  for (const change of filtered.dataSourceChanges) {
    if (change.action === "add") {
      if (existingDataSourceIds.has(change.dataSource.id)) {
        errors.push(
          warning2({
            severity: "error",
            type: "data_discovery_validation_failed",
            message: `Data source already exists: ${change.dataSource.id}`
          })
        );
      }
      if (proposedDataSourceIds.has(change.dataSource.id)) {
        errors.push(
          warning2({
            severity: "error",
            type: "data_discovery_validation_failed",
            message: `Duplicate proposed data source id in change set: ${change.dataSource.id}`
          })
        );
      }
      proposedDataSourceIds.add(change.dataSource.id);
      proposedDataSourcesById.set(change.dataSource.id, change.dataSource);
    } else if (!existingDataSourceIds.has(change.sourceId) && !proposedDataSourceIds.has(change.sourceId)) {
      errors.push(
        warning2({
          severity: "error",
          type: "data_discovery_validation_failed",
          message: `Data source update targets unknown source: ${change.sourceId}`
        })
      );
    }
  }
  for (const change of filtered.dataMappingChanges) {
    if (!existingNodeIds.has(change.nodeId) && !proposedNodeIds.has(change.nodeId)) {
      errors.push(
        warning2({
          severity: "error",
          type: "data_discovery_validation_failed",
          message: `Data mapping targets unknown node: ${change.nodeId}`,
          nodeId: change.nodeId
        })
      );
    }
    const mappingError = validateDataMappingReference(
      change.mapping,
      dataSourcesById,
      proposedDataSourcesById
    );
    if (mappingError) {
      errors.push(
        warning2({
          severity: "error",
          type: "data_discovery_validation_failed",
          message: mappingError,
          nodeId: change.nodeId
        })
      );
    }
  }
  for (const addition2 of filtered.additions) {
    if (!addition2.dataMapping) continue;
    const mappingError = validateDataMappingReference(
      addition2.dataMapping,
      dataSourcesById,
      proposedDataSourcesById
    );
    if (mappingError) {
      errors.push(
        warning2({
          severity: "error",
          type: "data_discovery_validation_failed",
          message: mappingError,
          nodeId: addition2.nodeId
        })
      );
    }
  }
  for (const change of filtered.taxonomyChanges) {
    const source = proposedDataSourcesById.get(change.sourceId) ?? dataSourcesById.get(change.sourceId);
    if (!source) {
      errors.push(
        warning2({
          severity: "error",
          type: "data_discovery_validation_failed",
          message: `Taxonomy change references unknown data source: ${change.sourceId}`
        })
      );
      continue;
    }
    const table = source.schema?.tables.find((candidate) => candidate.tableId === change.taxonomy.sourceTableId);
    if (!table) {
      errors.push(
        warning2({
          severity: "error",
          type: "data_discovery_validation_failed",
          message: `Taxonomy change references unknown table: ${change.taxonomy.sourceTableId}`
        })
      );
      continue;
    }
    const fields = new Set(table.fields.map((field) => field.name));
    const missingColumn = change.taxonomy.sourceColumns.find((column) => !fields.has(column));
    if (missingColumn) {
      errors.push(
        warning2({
          severity: "error",
          type: "data_discovery_validation_failed",
          message: `Taxonomy change references unknown column: ${missingColumn}`
        })
      );
    }
  }
  return errors;
}
function validateDataMappingReference(mapping, existingDataSourcesById, proposedDataSourcesById) {
  const source = proposedDataSourcesById.get(mapping.sourceId) ?? existingDataSourcesById.get(mapping.sourceId);
  if (!source) {
    return `Data mapping references unknown data source: ${mapping.sourceId}`;
  }
  const tableId = mapping.tableId ?? (source.schema?.tables.length === 1 ? source.schema.tables[0]?.tableId : void 0);
  if (!tableId) {
    return `Data mapping for field ${mapping.field} must specify a source table.`;
  }
  const table = source.schema?.tables.find((candidate) => candidate.tableId === tableId);
  if (!table) {
    return `Data mapping references unknown table: ${tableId}`;
  }
  if (mapping.field === "*" && mapping.aggregation === "count") {
    return void 0;
  }
  if (!table.fields.some((field) => field.name === mapping.field)) {
    return `Data mapping references unknown field: ${tableId}.${mapping.field}`;
  }
  return void 0;
}
function collectFormulaValidationWarnings(filtered) {
  const errors = [];
  const validateFormula = (formula, nodeId, nodeName) => {
    if (!formula?.trim()) {
      return;
    }
    try {
      parseFormula(formula);
    } catch (error2) {
      errors.push(
        warning2({
          severity: "error",
          type: "formula_parse_error",
          message: error2 instanceof FormulaParseError ? `The formula for ${nodeName} cannot be parsed: ${error2.message}` : `The formula for ${nodeName} cannot be parsed.`,
          nodeId
        })
      );
    }
  };
  for (const addition2 of filtered.additions) {
    validateFormula(addition2.formula, addition2.nodeId, addition2.name);
  }
  for (const update of filtered.updates) {
    if (update.patch.formula !== void 0) {
      validateFormula(update.patch.formula, update.nodeId, update.nodeId);
    }
  }
  return errors;
}
function mutateProjectGraph(project, filtered, options) {
  const timestamp = nowIso();
  const next = cloneProject(project);
  let nodes = [...next.graph.nodes];
  let edges = [...next.graph.edges];
  let dataSources = [...next.dataSources];
  for (const addition2 of filtered.additions) {
    nodes.push(additionToNode(addition2, timestamp));
    edges.push(additionToEdge(addition2));
  }
  for (const change of filtered.edgeChanges) {
    if (change.action === "add") {
      edges.push({
        id: change.edge.id,
        sourceNodeId: change.edge.sourceNodeId,
        targetNodeId: change.edge.targetNodeId,
        relation: change.edge.relation,
        aiGenerated: change.edge.aiGenerated ?? true,
        ...definedProperties({
          label: change.edge.label,
          aiConfidence: change.edge.aiConfidence
        })
      });
    }
  }
  for (const update of filtered.updates) {
    nodes = nodes.map((node) => {
      if (node.id !== update.nodeId) {
        return node;
      }
      const patch = update.patch;
      return {
        ...node,
        ...definedProperties(patch),
        updatedAt: timestamp
      };
    });
  }
  for (const change of filtered.dataMappingChanges) {
    nodes = nodes.map((node) => {
      if (node.id !== change.nodeId) {
        return node;
      }
      return {
        ...node,
        type: node.type === "root_kpi" ? node.type : "data_mapped",
        dataMapping: change.mapping,
        valueSource: {
          ...node.valueSource,
          sourceTier: node.valueSource?.sourceTier ?? "file",
          confidence: node.valueSource?.confidence ?? confidenceLabel(change.mapping.confidence),
          note: node.valueSource?.note ?? "Derived from imported dataset analysis"
        },
        updatedAt: timestamp
      };
    });
  }
  for (const change of filtered.dataSourceChanges) {
    if (change.action === "add") {
      dataSources = [...dataSources.filter((source) => source.id !== change.dataSource.id), change.dataSource];
    } else {
      dataSources = dataSources.map((source) => source.id === change.sourceId ? { ...source, ...definedProperties(change.patch) } : source);
    }
  }
  for (const change of filtered.taxonomyChanges) {
    dataSources = dataSources.map((source) => {
      if (source.id !== change.sourceId) {
        return source;
      }
      const semanticModel = source.semanticModel;
      if (!semanticModel) {
        return source;
      }
      const taxonomies = [
        ...semanticModel.taxonomies.filter((taxonomy) => taxonomy.id !== change.taxonomy.id),
        change.taxonomy
      ];
      return {
        ...source,
        semanticModel: {
          ...semanticModel,
          taxonomies
        }
      };
    });
  }
  for (const change of filtered.edgeChanges) {
    if (change.action === "update") {
      edges = edges.map((edge) => {
        if (edge.id !== change.edgeId) {
          return edge;
        }
        return {
          ...edge,
          ...definedProperties(change.patch)
        };
      });
    }
  }
  for (const change of filtered.edgeChanges) {
    if (change.action === "remove") {
      edges = edges.filter((edge) => edge.id !== change.edgeId);
    }
  }
  for (const deletion of filtered.deletions) {
    if (deletion.cascadeEdges) {
      edges = edges.filter(
        (edge) => edge.sourceNodeId !== deletion.nodeId && edge.targetNodeId !== deletion.nodeId
      );
    }
    nodes = nodes.filter((node) => node.id !== deletion.nodeId);
  }
  if (options?.touchUpdatedAt) {
    next.updatedAt = timestamp;
  }
  next.graph = { nodes, edges };
  next.dataSources = dataSources;
  return next;
}
function definedProperties(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== void 0)
  );
}
function confidenceLabel(confidence) {
  if (confidence === void 0) return "medium";
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.55) return "medium";
  return "low";
}

// ../vdt-core/src/changeset/apply.ts
function applyChangeSet(project, changeSet2, selection) {
  const baseline = cloneProject(project);
  const filtered = filterChangeSet(changeSet2, selection);
  const structureErrors = collectChangeSetStructureWarnings(changeSet2, project, filtered);
  const formulaErrors = collectFormulaValidationWarnings(filtered);
  if (structureErrors.length > 0 || formulaErrors.length > 0) {
    return {
      success: false,
      project: baseline,
      warnings: [...structureErrors, ...formulaErrors]
    };
  }
  const next = mutateProjectGraph(baseline, filtered, { touchUpdatedAt: true });
  const validation = validateGraph(next.graph, next.rootNodeId);
  if (!validation.valid) {
    return {
      success: false,
      project: baseline,
      warnings: [...validation.errors, ...validation.warnings]
    };
  }
  return {
    success: true,
    project: next,
    warnings: validation.warnings
  };
}

// ../vdt-core/src/formula/calculate.ts
function isProject2(input) {
  return "graph" in input && "rootNodeId" in input;
}
function normalizeOverrides(overrides) {
  if (!overrides) {
    return /* @__PURE__ */ new Map();
  }
  if (Array.isArray(overrides)) {
    return new Map(overrides.map((override) => [override.nodeId, override.value]));
  }
  return new Map(Object.entries(overrides));
}
function calculateGraph(input, options = {}) {
  const graph = isProject2(input) ? input.graph : input;
  const rootNodeId = options.rootNodeId ?? (isProject2(input) ? input.rootNodeId : graph.nodes[0]?.id ?? "");
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const overrides = normalizeOverrides(options.overrides);
  const values = {};
  const traceByNode = /* @__PURE__ */ new Map();
  const errors = [];
  const warnings = [];
  const visiting = [];
  const visited = /* @__PURE__ */ new Set();
  const addError = (nodeId, type, message) => {
    errors.push(warning2({ severity: "error", type, message, nodeId }));
  };
  const evaluateNode = (nodeId) => {
    if (visited.has(nodeId)) {
      return values[nodeId];
    }
    const node = nodeById.get(nodeId);
    if (!node) {
      addError(nodeId, "unknown_reference", `Formula references a missing node: ${nodeId}`);
      return void 0;
    }
    if (node.status === "rejected") {
      addError(nodeId, "invalid_graph", `Rejected node ${node.name} is excluded from calculation.`);
      visited.add(nodeId);
      return void 0;
    }
    const circularIndex = visiting.indexOf(nodeId);
    if (circularIndex >= 0) {
      const cycle = [...visiting.slice(circularIndex), nodeId].join(" -> ");
      addError(nodeId, "circular_dependency", `Circular formula dependency detected: ${cycle}`);
      return void 0;
    }
    visiting.push(nodeId);
    if (overrides.has(nodeId)) {
      const overrideValue = overrides.get(nodeId);
      if (overrideValue !== void 0) {
        if (!Number.isFinite(overrideValue)) {
          addError(nodeId, "invalid_value", `Scenario override for ${node.name} must be a finite number.`);
          visiting.pop();
          visited.add(nodeId);
          return void 0;
        }
        values[nodeId] = overrideValue;
        traceByNode.set(nodeId, {
          nodeId,
          nodeName: node.name,
          value: overrideValue,
          unit: node.unit,
          inputs: []
        });
        visiting.pop();
        visited.add(nodeId);
        return overrideValue;
      }
    }
    if (!node.formula?.trim()) {
      const value = node.baselineValue ?? node.value;
      if (value === void 0) {
        addError(nodeId, "missing_value", `Missing value for ${node.name}.`);
        visiting.pop();
        visited.add(nodeId);
        return void 0;
      }
      if (!Number.isFinite(value)) {
        addError(nodeId, "invalid_value", `Value for ${node.name} must be a finite number.`);
        visiting.pop();
        visited.add(nodeId);
        return void 0;
      }
      values[nodeId] = value;
      traceByNode.set(nodeId, {
        nodeId,
        nodeName: node.name,
        value,
        unit: node.unit,
        inputs: []
      });
      visiting.pop();
      visited.add(nodeId);
      return value;
    }
    try {
      const expression = parseFormula(node.formula);
      const references = extractReferencesFromAst(expression);
      for (const reference of references) {
        if (!nodeById.has(reference)) {
          addError(nodeId, "unknown_reference", `The formula for ${node.name} references a missing node: ${reference}`);
        }
      }
      for (const reference of references) {
        evaluateNode(reference);
      }
      const value = evaluateAst(expression, (reference) => values[reference]);
      if (!Number.isFinite(value)) {
        addError(nodeId, "invalid_value", `Calculated value for ${node.name} must be a finite number.`);
        visiting.pop();
        visited.add(nodeId);
        return void 0;
      }
      values[nodeId] = value;
      traceByNode.set(nodeId, {
        nodeId,
        nodeName: node.name,
        formula: node.formula,
        resolvedFormula: resolveFormulaText(node.formula, values),
        value,
        unit: node.unit,
        inputs: references.map((reference) => {
          const inputNode2 = nodeById.get(reference);
          return {
            nodeId: reference,
            nodeName: inputNode2?.name ?? reference,
            value: values[reference],
            unit: inputNode2?.unit
          };
        })
      });
      visiting.pop();
      visited.add(nodeId);
      return value;
    } catch (error2) {
      if (error2 instanceof FormulaParseError) {
        addError(nodeId, "formula_parse_error", `The formula for ${node.name} cannot be parsed: ${error2.message}`);
      } else if (error2 instanceof FormulaEvaluationError) {
        addError(nodeId, error2.code, error2.message);
      } else {
        throw error2;
      }
      visiting.pop();
      visited.add(nodeId);
      return void 0;
    }
  };
  for (const node of graph.nodes) {
    evaluateNode(node.id);
  }
  return {
    rootNodeId,
    rootValue: values[rootNodeId],
    values,
    trace: graph.nodes.flatMap((node) => {
      const item = traceByNode.get(node.id);
      return item ? [item] : [];
    }),
    errors,
    warnings
  };
}

// ../vdt-core/src/graph/layout.ts
var DEFAULT_CANVAS_LAYOUT = Object.freeze({
  margin: 48,
  cardWidth: 260,
  cardHeight: 158,
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
function byStableNodeOrder(nodesById, existing) {
  return (a, b) => {
    const aPosition = existing?.get(a);
    const bPosition = existing?.get(b);
    if (aPosition && bPosition && aPosition.y !== bPosition.y) return aPosition.y - bPosition.y;
    if (aPosition && !bPosition) return -1;
    if (!aPosition && bPosition) return 1;
    const aNode = nodesById.get(a);
    const bNode = nodesById.get(b);
    return `${aNode?.name ?? ""}:${a}`.localeCompare(`${bNode?.name ?? ""}:${b}`);
  };
}
function compareNodeOrder(nodesById) {
  return (a, b) => {
    const aNode = nodesById.get(a);
    const bNode = nodesById.get(b);
    return `${aNode?.name ?? ""}:${a}`.localeCompare(`${bNode?.name ?? ""}:${b}`);
  };
}
function orderSiblings(childIds, nodesById, existing) {
  if (childIds.length <= 1) return [...childIds];
  const byName = compareNodeOrder(nodesById);
  if (!existing) return [...childIds].sort(byName);
  const positioned = [];
  const unpositioned = [];
  for (const childId of childIds) {
    if (existing.has(childId)) {
      positioned.push(childId);
    } else {
      unpositioned.push(childId);
    }
  }
  if (positioned.length === 0) return [...childIds].sort(byName);
  const positionedSorted = [...positioned].sort((a, b) => {
    const yDiff = existing.get(a).y - existing.get(b).y;
    return yDiff || byName(a, b);
  });
  return [...positionedSorted, ...unpositioned.sort(byName)];
}
function layoutSubtree(nodeId, depth, childrenBySource, nodesById, options, path6) {
  const x = options.margin + depth * (options.cardWidth + options.horizontalGap);
  const nextPath = new Set(path6);
  nextPath.add(nodeId);
  const childIds = orderSiblings(
    childrenBySource.get(nodeId) ?? [],
    nodesById,
    options.existingPositions
  ).filter((childId) => !nextPath.has(childId));
  if (childIds.length === 0) {
    return {
      positions: /* @__PURE__ */ new Map([[nodeId, { x, y: 0 }]]),
      top: 0,
      bottom: options.cardHeight
    };
  }
  const positions = /* @__PURE__ */ new Map();
  let cursor = 0;
  let childrenTop = Infinity;
  let childrenBottom = -Infinity;
  for (const childId of childIds) {
    const childLayout = layoutSubtree(childId, depth + 1, childrenBySource, nodesById, options, nextPath);
    const yOffset = cursor - childLayout.top;
    for (const [id, position] of childLayout.positions) {
      positions.set(id, { x: position.x, y: position.y + yOffset });
    }
    const shiftedTop = childLayout.top + yOffset;
    const shiftedBottom = childLayout.bottom + yOffset;
    childrenTop = Math.min(childrenTop, shiftedTop);
    childrenBottom = Math.max(childrenBottom, shiftedBottom);
    cursor = shiftedBottom + options.verticalGap;
  }
  if (childrenTop === Infinity) {
    return {
      positions: /* @__PURE__ */ new Map([[nodeId, { x, y: 0 }]]),
      top: 0,
      bottom: options.cardHeight
    };
  }
  const y = (childrenTop + childrenBottom) / 2 - options.cardHeight / 2;
  positions.set(nodeId, { x, y });
  return {
    positions,
    top: Math.min(y, childrenTop),
    bottom: Math.max(y + options.cardHeight, childrenBottom)
  };
}
function resolveLayoutOptions(options = {}) {
  const resolved = {
    margin: options.margin ?? DEFAULT_CANVAS_LAYOUT.margin,
    cardWidth: options.cardWidth ?? DEFAULT_CANVAS_LAYOUT.cardWidth,
    cardHeight: options.cardHeight ?? DEFAULT_CANVAS_LAYOUT.cardHeight,
    horizontalGap: options.horizontalGap ?? options.xGap ?? DEFAULT_CANVAS_LAYOUT.horizontalGap,
    verticalGap: options.verticalGap ?? options.yGap ?? DEFAULT_CANVAS_LAYOUT.verticalGap
  };
  return options.existingPositions ? { ...resolved, existingPositions: options.existingPositions } : resolved;
}
function layoutGraph(graph, rootNodeId, options = DEFAULT_CANVAS_LAYOUT) {
  const resolvedOptions = resolveLayoutOptions(options);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const childrenBySource = /* @__PURE__ */ new Map();
  for (const edge of graph.edges) {
    if (!nodesById.has(edge.sourceNodeId) || !nodesById.has(edge.targetNodeId)) continue;
    const children = childrenBySource.get(edge.sourceNodeId) ?? [];
    children.push(edge.targetNodeId);
    childrenBySource.set(edge.sourceNodeId, children);
  }
  const rootLayout = nodesById.has(rootNodeId) ? layoutSubtree(rootNodeId, 0, childrenBySource, nodesById, resolvedOptions, /* @__PURE__ */ new Set()) : { positions: /* @__PURE__ */ new Map(), top: 0, bottom: 0 };
  const positions = new Map(rootLayout.positions);
  const sorter = byStableNodeOrder(nodesById, resolvedOptions.existingPositions);
  const unvisited = graph.nodes.filter((node) => !positions.has(node.id)).sort((a, b) => sorter(a.id, b.id));
  let cursor = positions.size > 0 ? rootLayout.bottom + resolvedOptions.verticalGap : 0;
  for (const node of unvisited) {
    positions.set(node.id, { x: resolvedOptions.margin, y: cursor });
    cursor += resolvedOptions.cardHeight + resolvedOptions.verticalGap;
  }
  let minY = Infinity;
  for (const position of positions.values()) {
    minY = Math.min(minY, position.y);
  }
  if (minY !== Infinity) {
    const yShift = resolvedOptions.margin - minY;
    for (const position of positions.values()) {
      position.y += yShift;
    }
  }
  let maxX = resolvedOptions.margin + resolvedOptions.cardWidth;
  let maxY = resolvedOptions.margin + resolvedOptions.cardHeight;
  for (const position of positions.values()) {
    maxX = Math.max(maxX, position.x + resolvedOptions.cardWidth + resolvedOptions.margin);
    maxY = Math.max(maxY, position.y + resolvedOptions.cardHeight + resolvedOptions.margin);
  }
  return {
    positions,
    width: maxX,
    height: maxY,
    cardWidth: resolvedOptions.cardWidth,
    cardHeight: resolvedOptions.cardHeight
  };
}

// ../vdt-core/src/builder/session.ts
var VdtBuilderSession = class {
  project;
  revision = 0;
  events = [];
  providerId;
  now;
  constructor(input = {}) {
    this.project = input.project ? cloneProject(input.project) : createEmptyProject(input.now?.() ?? (/* @__PURE__ */ new Date()).toISOString());
    this.providerId = input.providerId ?? "vdt_builder";
    this.now = input.now ?? (() => (/* @__PURE__ */ new Date()).toISOString());
  }
  getProject() {
    return cloneProject(this.project);
  }
  getRevision() {
    return this.revision;
  }
  getEvents() {
    return this.events.map((event) => ({ ...event }));
  }
  createDraft(input) {
    const timestamp = this.now();
    const rootNodeId = stableSnakeId(input.rootKpi, "root_kpi");
    const rootNode = {
      id: rootNodeId,
      name: input.rootKpi.trim(),
      description: input.goal?.trim() || input.businessContext?.trim() || void 0,
      type: "root_kpi",
      status: "ai_suggested",
      unit: input.unit?.trim() || void 0,
      aiGenerated: true,
      aiConfidence: 0.78,
      aiRationale: "Created as the root KPI for the agent draft.",
      assumptions: input.timePeriod ? [`Time period: ${input.timePeriod}`] : void 0,
      position: { x: 48, y: 48 },
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.project = {
      id: `project_${rootNodeId}`,
      name: input.projectTitle.trim() || `${input.rootKpi.trim()} Driver Model`,
      description: input.goal?.trim() || void 0,
      industry: input.industry?.trim() || void 0,
      businessContext: input.businessContext?.trim() || void 0,
      rootNodeId,
      graph: {
        nodes: [rootNode],
        edges: []
      },
      scenarios: [defaultScenario(timestamp)],
      dataSources: [],
      aiSettings: {
        defaultProviderId: this.providerId
      },
      versions: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    return this.commit("create_draft", "Draft created", `Created draft project with root KPI "${rootNode.name}".`);
  }
  addDriver(input) {
    this.requireNode(input.parentNodeId);
    if (input.formula?.trim()) parseFormula(input.formula);
    const timestamp = this.now();
    const nodeIds = new Set(this.project.graph.nodes.map((node2) => node2.id));
    const nodeId = uniqueId(stableSnakeId(input.nodeId ?? input.name, "driver"), nodeIds);
    const edgeIds = new Set(this.project.graph.edges.map((edge2) => edge2.id));
    const edgeId = uniqueId(`edge_${input.parentNodeId}_${nodeId}`, edgeIds);
    const node = {
      id: nodeId,
      name: input.name.trim(),
      description: input.description?.trim() || void 0,
      type: input.type ?? "input",
      status: "ai_suggested",
      unit: input.unit?.trim() || void 0,
      formula: input.formula?.trim() || void 0,
      baselineValue: input.baselineValue,
      aiGenerated: true,
      aiConfidence: 0.72,
      aiRationale: input.aiRationale?.trim() || "Added by the VDT builder as an agent driver.",
      assumptions: input.assumptions,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const edge = {
      id: edgeId,
      sourceNodeId: input.parentNodeId,
      targetNodeId: nodeId,
      relation: input.relation ?? "positive_driver",
      aiGenerated: true,
      aiConfidence: 0.72
    };
    const changeSet2 = {
      id: `changeset_${this.revision + 1}_${nodeId}`,
      taskType: "generate_tree",
      backendId: this.providerId,
      createdAt: timestamp,
      additions: [
        {
          id: `add_${nodeId}`,
          nodeId,
          parentNodeId: input.parentNodeId,
          relation: edge.relation,
          name: node.name,
          description: node.description,
          type: node.type,
          unit: node.unit,
          formula: node.formula,
          baselineValue: node.baselineValue,
          aiConfidence: node.aiConfidence,
          aiRationale: node.aiRationale,
          assumptions: node.assumptions
        }
      ],
      updates: [],
      deletions: [],
      edgeChanges: [
        {
          id: `edge_${edgeId}`,
          action: "add",
          edge
        }
      ],
      assumptions: input.assumptions ?? [],
      questions: [],
      warnings: []
    };
    this.project = {
      ...this.project,
      updatedAt: timestamp,
      graph: {
        nodes: [...this.project.graph.nodes, node],
        edges: [...this.project.graph.edges, edge]
      }
    };
    return this.commit(
      "add_driver",
      "Driver added",
      `Added "${node.name}" under "${this.requireNode(input.parentNodeId).name}".`,
      { changeSet: changeSet2, metadata: { nodeId, parentNodeId: input.parentNodeId } }
    );
  }
  updateNode(input) {
    this.requireNode(input.nodeId);
    if (input.patch.formula?.trim()) parseFormula(input.patch.formula);
    const timestamp = this.now();
    this.project = {
      ...this.project,
      updatedAt: timestamp,
      graph: {
        ...this.project.graph,
        nodes: this.project.graph.nodes.map(
          (node) => node.id === input.nodeId ? { ...node, ...cleanNodePatch(input.patch), updatedAt: timestamp } : node
        )
      }
    };
    const changeSet2 = this.changeSet({
      updates: [{ id: `update_${input.nodeId}_${this.revision + 1}`, nodeId: input.nodeId, patch: cleanNodePatch(input.patch) }]
    });
    return this.commit("update_node", "Node updated", `Updated node "${input.nodeId}".`, {
      changeSet: changeSet2,
      metadata: { nodeId: input.nodeId, patch: input.patch }
    });
  }
  deleteNode(input) {
    this.requireNode(input.nodeId);
    if (input.nodeId === this.project.rootNodeId) {
      throw new Error("Root node cannot be deleted.");
    }
    const timestamp = this.now();
    const touchingEdges = this.project.graph.edges.filter(
      (edge) => edge.sourceNodeId === input.nodeId || edge.targetNodeId === input.nodeId
    );
    if (touchingEdges.length > 0 && input.cascadeEdges !== true) {
      throw new Error("Node has connected edges. Pass cascadeEdges to delete it.");
    }
    this.project = {
      ...this.project,
      updatedAt: timestamp,
      graph: {
        nodes: this.project.graph.nodes.filter((node) => node.id !== input.nodeId),
        edges: this.project.graph.edges.filter((edge) => !touchingEdges.includes(edge))
      }
    };
    const changeSet2 = this.changeSet({
      deletions: [{ id: `delete_${input.nodeId}`, nodeId: input.nodeId, cascadeEdges: input.cascadeEdges }]
    });
    return this.commit("delete_node", "Node deleted", `Deleted node "${input.nodeId}".`, {
      changeSet: changeSet2,
      metadata: { nodeId: input.nodeId, removedEdgeIds: touchingEdges.map((edge) => edge.id) }
    });
  }
  addEdge(input) {
    this.requireNode(input.sourceNodeId);
    this.requireNode(input.targetNodeId);
    const timestamp = this.now();
    const edgeIds = new Set(this.project.graph.edges.map((edge2) => edge2.id));
    const edgeId = uniqueId(input.edgeId ?? `edge_${input.sourceNodeId}_${input.targetNodeId}`, edgeIds);
    const edge = {
      id: edgeId,
      sourceNodeId: input.sourceNodeId,
      targetNodeId: input.targetNodeId,
      relation: input.relation,
      label: input.label,
      aiGenerated: true,
      aiConfidence: 0.7
    };
    this.project = {
      ...this.project,
      updatedAt: timestamp,
      graph: {
        ...this.project.graph,
        edges: [...this.project.graph.edges, edge]
      }
    };
    const changeSet2 = this.changeSet({
      edgeChanges: [{ id: `edge_${edgeId}`, action: "add", edge }]
    });
    return this.commit("add_edge", "Edge added", `Added edge "${edgeId}".`, {
      changeSet: changeSet2,
      metadata: { edgeId, sourceNodeId: input.sourceNodeId, targetNodeId: input.targetNodeId }
    });
  }
  setFormula(input) {
    parseFormula(input.formula);
    return this.updateNode({
      nodeId: input.nodeId,
      patch: {
        formula: input.formula.trim(),
        type: "calculated",
        status: "ai_suggested"
      }
    });
  }
  applyChangeSet(changeSet2, selection) {
    const selected = selection ?? collectChangeIds(changeSet2);
    const applied = applyChangeSet(this.project, changeSet2, selected);
    if (!applied.success) {
      const event = this.createEvent("apply_changeset", "Change set rejected", "Change set failed builder validation.", {
        changeSet: changeSet2,
        metadata: { warningCount: applied.warnings.length }
      });
      return {
        project: this.getProject(),
        revision: this.revision,
        changeSet: changeSet2,
        event,
        warnings: applied.warnings
      };
    }
    this.project = applied.project;
    return this.commit("apply_changeset", "Change set applied", "Applied validated change set to draft project.", {
      changeSet: changeSet2,
      metadata: { selectedChangeIds: [...selected] }
    });
  }
  validate() {
    const validation = validateGraph(this.project);
    const event = this.createEvent(
      "validate",
      validation.valid ? "Graph validation passed" : "Graph validation found issues",
      validation.valid ? `Graph validation passed with ${validation.warnings.length} warning${validation.warnings.length === 1 ? "" : "s"}.` : `Graph validation found ${validation.errors.length} error${validation.errors.length === 1 ? "" : "s"}.`,
      { metadata: { errors: validation.errors.length, warnings: validation.warnings.length } }
    );
    return { validation, revision: this.revision, event };
  }
  layout(options) {
    const layout = layoutGraph(this.project.graph, this.project.rootNodeId, options);
    const timestamp = this.now();
    this.project = {
      ...this.project,
      updatedAt: timestamp,
      graph: {
        ...this.project.graph,
        nodes: this.project.graph.nodes.map((node) => ({
          ...node,
          position: layout.positions.get(node.id) ?? node.position ?? { x: 0, y: 0 },
          updatedAt: timestamp
        }))
      }
    };
    return this.commit("layout", "Graph layout applied", "Updated draft node positions.", {
      metadata: { width: layout.width, height: layout.height }
    });
  }
  calculate() {
    const calculation = calculateGraph(this.project);
    const event = this.createEvent(
      "calculate",
      "Graph calculation completed",
      `Calculated ${Object.keys(calculation.values).length} node value${Object.keys(calculation.values).length === 1 ? "" : "s"}.`,
      { metadata: { warnings: calculation.warnings.length, errors: calculation.errors.length } }
    );
    return { calculation, revision: this.revision, event };
  }
  snapshot(name) {
    const timestamp = this.now();
    const snapshot = cloneProject(this.project);
    const version = {
      id: stableSnakeId(`version_${name}_${this.revision}`, "version"),
      name,
      projectSnapshot: snapshot,
      createdAt: timestamp
    };
    this.project = {
      ...this.project,
      updatedAt: timestamp,
      versions: [...this.project.versions, version]
    };
    this.recordEvent("snapshot", "Snapshot created", `Created builder snapshot "${name}".`, { metadata: { name } });
    return this.getProject();
  }
  snapshotResult(name) {
    const project = this.snapshot(name);
    const event = this.events[this.events.length - 1];
    return { project, revision: this.revision, event };
  }
  requireNode(nodeId) {
    const node = this.project.graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) throw new Error(`Node "${nodeId}" does not exist.`);
    return node;
  }
  commit(type, title, message, options = {}) {
    this.revision += 1;
    const validation = validateGraph(this.project);
    const event = this.recordEvent(type, title, message, options);
    return {
      project: this.getProject(),
      revision: this.revision,
      changeSet: options.changeSet,
      event,
      warnings: [...validation.errors, ...validation.warnings]
    };
  }
  recordEvent(type, title, message, options = {}) {
    const event = this.createEvent(type, title, message, options);
    this.events.push(event);
    return event;
  }
  createEvent(type, title, message, options = {}) {
    return {
      id: `builder_event_${this.events.length + 1}`,
      revision: this.revision,
      timestamp: this.now(),
      type,
      title,
      message,
      metadata: options.metadata,
      changeSet: options.changeSet
    };
  }
  changeSet(input) {
    return {
      id: `changeset_${this.revision + 1}`,
      taskType: "generate_tree",
      backendId: this.providerId,
      createdAt: this.now(),
      additions: input.additions ?? [],
      updates: input.updates ?? [],
      deletions: input.deletions ?? [],
      edgeChanges: input.edgeChanges ?? [],
      assumptions: input.assumptions ?? [],
      questions: input.questions ?? [],
      warnings: input.warnings ?? []
    };
  }
};
function createEmptyProject(timestamp) {
  return {
    id: "draft_project",
    name: "Draft VDT",
    rootNodeId: "",
    graph: {
      nodes: [],
      edges: []
    },
    scenarios: [],
    dataSources: [],
    aiSettings: {
      defaultProviderId: "vdt_builder"
    },
    versions: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}
function defaultScenario(timestamp) {
  return {
    id: "base_scenario",
    name: "Base scenario",
    description: "Baseline values for the agent draft.",
    isMain: true,
    overrides: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}
function cleanNodePatch(patch) {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== void 0));
}
function collectChangeIds(changeSet2) {
  return /* @__PURE__ */ new Set([
    ...changeSet2.additions.map((entry) => entry.id),
    ...changeSet2.updates.map((entry) => entry.id),
    ...changeSet2.deletions.map((entry) => entry.id),
    ...changeSet2.edgeChanges.map((entry) => entry.id)
  ]);
}

// ../vdt-core/src/changeset/preview.ts
function previewChangeSet(project, changeSet2, selection) {
  const source = cloneProject(project);
  const filtered = filterChangeSet(changeSet2, selection);
  return mutateProjectGraph(source, filtered);
}

// ../vdt-core/src/formula/serialize.ts
function tokenText(token) {
  switch (token.type) {
    case "number":
      return token.raw;
    case "identifier":
      return token.value;
    case "operator":
      return token.value;
    case "left_paren":
      return "(";
    case "right_paren":
      return ")";
    case "comma":
      return ",";
    case "eof":
      return "";
  }
}
function isUnaryMinus(tokens, index) {
  const token = tokens[index];
  if (token?.type !== "operator" || token.value !== "-") {
    return false;
  }
  const previous = tokens[index - 1];
  if (!previous || previous.type === "eof") {
    return true;
  }
  return previous.type === "left_paren" || previous.type === "operator";
}
function shouldInsertSpaceBetween(tokens, index) {
  const previous = tokens[index - 1];
  const next = tokens[index];
  if (!previous || previous.type === "eof" || !next || next.type === "eof") {
    return false;
  }
  if (next.type === "right_paren" || next.type === "comma") {
    return false;
  }
  if (previous.type === "left_paren") {
    return false;
  }
  if (previous.type === "identifier" && next.type === "left_paren") {
    return false;
  }
  if (previous.type === "comma") {
    return true;
  }
  if (previous.type === "operator") {
    if (isUnaryMinus(tokens, index - 1) && (next.type === "identifier" || next.type === "number" || next.type === "left_paren")) {
      return false;
    }
    return true;
  }
  if (next.type === "operator") {
    if (isUnaryMinus(tokens, index)) {
      return false;
    }
    return true;
  }
  return true;
}
function serializeFormulaTokens(tokens) {
  const contentTokens = tokens.filter((token) => token.type !== "eof");
  if (contentTokens.length === 0) {
    return "";
  }
  const parts = [];
  for (let index = 0; index < contentTokens.length; index += 1) {
    const token = contentTokens[index];
    if (!token) {
      continue;
    }
    if (index > 0 && shouldInsertSpaceBetween(contentTokens, index)) {
      parts.push(" ");
    }
    parts.push(tokenText(token));
  }
  return parts.join("");
}

// ../vdt-agent-runtime/src/summaries.ts
var MAX_CONTEXT_NODES = 60;
var MAX_RECENT_EVENTS = 12;
var MAX_MANUAL_CHANGES = 20;
function summarizeProject(project, maxNodes = MAX_CONTEXT_NODES) {
  const childIdsByNode = /* @__PURE__ */ new Map();
  for (const edge of project.graph.edges) {
    childIdsByNode.set(edge.sourceNodeId, [...childIdsByNode.get(edge.sourceNodeId) ?? [], edge.targetNodeId]);
  }
  const includedNodeIds = new Set(project.graph.nodes.slice(0, maxNodes).map((node) => node.id));
  return {
    id: project.id,
    name: project.name,
    rootNodeId: project.rootNodeId,
    nodeCount: project.graph.nodes.length,
    edgeCount: project.graph.edges.length,
    nodes: project.graph.nodes.slice(0, maxNodes).map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      unit: node.unit,
      formula: node.formula,
      baselineValue: node.baselineValue,
      value: node.value,
      status: node.status,
      childIds: childIdsByNode.get(node.id) ?? []
    })),
    edges: project.graph.edges.filter((edge) => includedNodeIds.has(edge.sourceNodeId) && includedNodeIds.has(edge.targetNodeId)).map((edge) => ({
      id: edge.id,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      relation: edge.relation
    })),
    truncated: project.graph.nodes.length > maxNodes
  };
}
function summarizeNode(project, nodeId) {
  return summarizeProject(project, project.graph.nodes.length).nodes.find((node) => node.id === nodeId);
}
function summarizeValidation(validation) {
  return {
    valid: validation.valid,
    errors: validation.errors.map(summarizeWarning),
    warnings: validation.warnings.map(summarizeWarning)
  };
}
function summarizeCalculation(calculation) {
  return {
    rootNodeId: calculation.rootNodeId,
    ...isFiniteNumber(calculation.rootValue) ? { rootValue: calculation.rootValue } : {},
    valueCount: Object.keys(calculation.values).length,
    errors: calculation.errors.map(summarizeWarning),
    warnings: calculation.warnings.map(summarizeWarning),
    tracePreview: calculation.trace.slice(0, 20).map(summarizeTraceItem)
  };
}
function summarizeManualChanges(state, limit = MAX_MANUAL_CHANGES) {
  return state.manualChanges.slice(-limit).map((entry) => ({
    observedAt: entry.observedAt,
    projectRevision: entry.projectRevision,
    kind: entry.change.kind,
    nodeId: entry.change.nodeId,
    edgeId: entry.change.edgeId,
    summary: entry.change.summary
  }));
}
function summarizeEvents(events, limit = MAX_RECENT_EVENTS) {
  return events.filter(isSignificantAgentEvent).slice(-limit).map((event) => ({
    id: event.id,
    seq: event.seq,
    type: event.type,
    phase: event.phase,
    title: event.title,
    message: event.message,
    metadata: event.metadata
  }));
}
function isSignificantAgentEvent(event) {
  if (event.type === "tool_call_started" || event.type === "assistant_message") return false;
  if (event.type === "tool_call_completed" && event.metadata?.taskType === "agent_decision") return false;
  return true;
}
function summarizeWarning(warning3) {
  const repairHints = repairHintsForWarning(warning3);
  return {
    type: warning3.type,
    severity: warning3.severity,
    message: warning3.message,
    ...warning3.nodeId !== void 0 ? { nodeId: warning3.nodeId } : {},
    ...warning3.edgeId !== void 0 ? { edgeId: warning3.edgeId } : {},
    ...repairHints !== void 0 ? { repairHints } : {}
  };
}
function summarizeTraceItem(item) {
  return {
    nodeId: item.nodeId,
    nodeName: item.nodeName,
    ...item.formula !== void 0 ? { formula: item.formula } : {},
    ...item.resolvedFormula !== void 0 ? { resolvedFormula: item.resolvedFormula } : {},
    ...isFiniteNumber(item.value) ? { value: item.value } : {},
    ...item.unit !== void 0 ? { unit: item.unit } : {},
    inputs: item.inputs.map((input) => ({
      nodeId: input.nodeId,
      nodeName: input.nodeName,
      ...isFiniteNumber(input.value) ? { value: input.value } : {},
      ...input.unit !== void 0 ? { unit: input.unit } : {}
    }))
  };
}
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function repairHintsForWarning(warning3) {
  if (warning3.type === "unknown_reference") {
    return [
      "Use formula.check_references to identify missing ids.",
      "Use formula.suggest_reference_repair or vdt.repair_missing_formula_reference."
    ];
  }
  if (warning3.type === "formula_parse_error") {
    return ["Use formula.parse, then vdt.set_formula with a parser-valid expression."];
  }
  if (warning3.type === "invalid_graph") {
    return ["Use project.get_node and a repair tool, or ask the user if the intended graph relation is ambiguous."];
  }
  if (warning3.type === "missing_value") {
    return ["Ask the user for the missing value or add an assumption node with a baselineValue."];
  }
  return void 0;
}

// ../vdt-agent-runtime/src/in-product-model-agent-engine.ts
var safeId = external_exports.string().trim().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
var sha256 = external_exports.string().regex(/^sha256:[a-f0-9]{64}$/);
var MAX_MODEL_AGENT_SESSION_STATE_BYTES = 16 * 1024;
var assistantMessageSchema = external_exports.object({
  messageId: safeId,
  text: external_exports.string().trim().min(1).max(8e3)
}).strict();
var modelAgentStructuredTurnSchema = external_exports.object({
  turnId: safeId,
  /** Server-private bounded semantic checkpoint for stateless structured HTTP
   * transports. It is fed only to the next provider turn and is never emitted
   * as a public/durable run event. */
  sessionState: external_exports.string().trim().min(1).max(MAX_MODEL_AGENT_SESSION_STATE_BYTES).refine(
    (value) => new TextEncoder().encode(value).byteLength <= MAX_MODEL_AGENT_SESSION_STATE_BYTES,
    { message: `sessionState must be at most ${MAX_MODEL_AGENT_SESSION_STATE_BYTES} UTF-8 bytes` }
  ),
  assistantMessage: assistantMessageSchema.nullable(),
  action: external_exports.discriminatedUnion("type", [
    external_exports.object({
      type: external_exports.literal("action_batch"),
      batch: agentActionBatchSchema
    }).strict(),
    external_exports.object({
      type: external_exports.literal("question"),
      messageId: safeId,
      questionSetId: safeId,
      questions: external_exports.array(agentQuestionSchema2.strict()).min(1).max(5)
    }).strict(),
    external_exports.object({
      type: external_exports.literal("final"),
      messageId: safeId,
      finishReceiptId: safeId,
      text: external_exports.string().trim().min(1).max(8e3)
    }).strict()
  ])
}).strict();

// ../vdt-agent-runtime/src/tool-registry.ts
var AgentToolError = class extends Error {
  code;
  details;
  constructor(code, message, details) {
    super(message);
    this.name = "AgentToolError";
    this.code = code;
    this.details = details;
  }
};

// ../vdt-agent-runtime/src/mutation-pipeline.ts
var defaultAgentMutationPolicy = {
  autoApply: false,
  askBeforeFirstPatch: true,
  requireApprovalForGraphStructure: true,
  requireApprovalForFormulaChanges: true,
  requireApprovalForDelete: true
};
var defaultProgressiveBuildPolicy = {
  maxAutoDepth: 3,
  maxNodesPerLayer: 8,
  requireUserInputOnAmbiguity: true,
  requireUserInputOnMissingValues: false,
  allowStructureWithoutValues: true,
  allowFormulaWithoutBaselineValues: true,
  stopOnFormulaError: true
};
function proposeAndMaybeApplyMutation(context, input) {
  const builder = context.builder;
  if (!builder) throw new AgentToolError("NO_DRAFT_PROJECT", "VDT builder session is not available for this run.");
  const state = context.store.getState(context.runId);
  const changeSet2 = normalizeChangeSetForApply(input.changeSet);
  const normalizedInput = { ...input, changeSet: changeSet2 };
  const baseProject = builder.getProject();
  const baseRevision = builder.getRevision();
  const selectedChangeIds = normalizedInput.selectedChangeIds ?? collectChangeIds2(changeSet2);
  const previewProject = previewChangeSet(baseProject, changeSet2, new Set(selectedChangeIds));
  const validation = summarizeValidation(validateGraph(previewProject));
  const calculation = validation.valid ? summarizeCalculation(calculateGraph(previewProject)) : void 0;
  const policy = mutationPolicyForRun(context);
  const boundedScope = progressiveScopeForMutation(baseProject, changeSet2, normalizedInput.targetNodeId);
  const boundedScopeError = validateProgressiveMutationScope(baseProject, changeSet2, boundedScope);
  const bypassBoundedScope = normalizedInput.allowSkillDefinedDepth === true && boundedScopeError !== void 0;
  const scope = bypassBoundedScope ? void 0 : boundedScope;
  const scopeError = validateSingleLayerRunScope(
    state,
    changeSet2,
    normalizedInput.targetNodeId
  ) ?? (bypassBoundedScope ? void 0 : boundedScopeError);
  const approvalRequired = !scopeError && validation.valid && requiresApproval(policy, changeSet2, state.mutationProposals ?? []);
  const proposal = buildMutationProposal({
    runId: context.runId,
    project: baseProject,
    baseRevision,
    input: normalizedInput,
    selectedChangeIds,
    previewProject,
    validation,
    calculation,
    policy,
    scope,
    proposalNumber: (state.mutationProposals?.length ?? 0) + 1
  });
  context.emit({
    type: "mutation_proposed",
    phase: "previewing_mutation",
    title: "Mutation proposal created",
    message: proposal.summary,
    patch: proposal.changeSet,
    metadata: {
      proposalId: proposal.id,
      status: proposal.status,
      selectedChangeIds,
      validationValid: validation.valid,
      approvalRequired,
      targetNodeId: scope?.targetNodeId
    }
  });
  if (scopeError || !validation.valid) {
    const failed = updateProposal(proposal, {
      status: "failed",
      failureReason: scopeError ?? validation.errors.map((error2) => error2.message).join("; ")
    });
    storeProposal(context, failed);
    context.emit({
      type: "mutation_rejected",
      phase: "previewing_mutation",
      title: scopeError ? "Mutation scope rejected" : "Mutation validation failed",
      message: failed.failureReason ?? "Mutation proposal failed validation.",
      patch: failed.changeSet,
      metadata: { proposalId: failed.id, status: failed.status }
    });
    throw new AgentToolError(
      scopeError ? "MUTATION_SCOPE_VIOLATION" : "MUTATION_VALIDATION_FAILED",
      failed.failureReason ?? "Mutation proposal failed validation.",
      { proposalId: failed.id, validation }
    );
  }
  if (approvalRequired) {
    storeProposal(context, proposal, { pending: true });
    context.store.updateRun(context.runId, {
      status: "waiting_approval",
      phase: "previewing_mutation",
      pendingChangeSet: proposal.changeSet,
      pendingMutationProposal: proposal,
      validationState: validation,
      ...calculation ? { calculationState: calculation } : {}
    });
    return {
      proposal,
      applied: false,
      revision: baseRevision,
      validation,
      ...calculation ? { calculation } : {}
    };
  }
  const applied = applyProposalToBuilder(context, proposal, selectedChangeIds);
  return applied;
}
function validateSingleLayerRunScope(state, changeSet2, targetNodeId) {
  if (state.request.mode !== "deepen_node") return void 0;
  const selectedNodeId = state.request.input.selectedNodeId;
  if (!selectedNodeId) {
    return "Single-level decomposition requires a selected KPI.";
  }
  if (targetNodeId && targetNodeId !== selectedNodeId) {
    return `Single-level decomposition can mutate only the selected KPI "${selectedNodeId}".`;
  }
  if (changeSet2.additions.some((addition2) => addition2.parentNodeId !== selectedNodeId)) {
    return `Single-level decomposition can add only immediate children of "${selectedNodeId}".`;
  }
  if (changeSet2.updates.some((update) => update.nodeId !== selectedNodeId)) {
    return `Single-level decomposition can update only the selected KPI "${selectedNodeId}".`;
  }
  if (changeSet2.deletions.length > 0) {
    return "Single-level decomposition cannot delete KPI nodes.";
  }
  if (changeSet2.edgeChanges.some(
    (change) => change.action !== "add" || change.edge.sourceNodeId !== selectedNodeId
  )) {
    return `Single-level decomposition can add edges only from the selected KPI "${selectedNodeId}".`;
  }
  return void 0;
}
function applyProposalToBuilder(context, proposal, selectedChangeIds) {
  const builder = context.builder;
  if (!builder) throw new AgentToolError("NO_DRAFT_PROJECT", "VDT builder session is not available for this run.");
  const beforeRevision = builder.getRevision();
  if (beforeRevision !== proposal.baseRevision) {
    const message = `Proposal revision ${proposal.baseRevision} is stale; current revision is ${beforeRevision}.`;
    const failed = updateProposal(proposal, {
      status: "failed",
      failureReason: message
    });
    storeProposal(context, failed);
    context.store.updateRun(context.runId, {
      pendingMutationProposal: void 0,
      pendingChangeSet: void 0
    });
    context.emit({
      type: "mutation_rejected",
      phase: "applying_graph",
      title: "Stale mutation proposal rejected",
      message,
      patch: failed.changeSet,
      metadata: {
        proposalId: failed.id,
        status: failed.status,
        expectedRevision: proposal.baseRevision,
        currentRevision: beforeRevision
      }
    });
    throw new AgentToolError("STALE_REVISION", message, {
      proposalId: failed.id,
      expectedRevision: proposal.baseRevision,
      currentRevision: beforeRevision
    });
  }
  const result = builder.applyChangeSet(proposal.changeSet, new Set(selectedChangeIds));
  const afterRevision = builder.getRevision();
  if (afterRevision === beforeRevision) {
    const failed = updateProposal(proposal, {
      status: "failed",
      failureReason: result.warnings.map((warning3) => warning3.message).join("; ") || "Mutation could not be applied."
    });
    storeProposal(context, failed);
    context.store.updateRun(context.runId, {
      pendingMutationProposal: void 0,
      pendingChangeSet: void 0,
      validationState: failed.validation
    });
    context.emit({
      type: "mutation_rejected",
      phase: "applying_graph",
      title: "Mutation apply failed",
      message: failed.failureReason ?? "Mutation could not be applied.",
      patch: failed.changeSet,
      metadata: { proposalId: failed.id, status: failed.status }
    });
    throw new AgentToolError("MUTATION_APPLY_FAILED", failed.failureReason ?? "Mutation could not be applied.", {
      proposalId: failed.id
    });
  }
  const project = builder.getProject();
  const validation = summarizeValidation(builder.validate().validation);
  const calculation = validation.valid ? summarizeCalculation(calculateGraph(project)) : void 0;
  const applied = updateProposal(proposal, {
    status: "applied",
    appliedAt: (/* @__PURE__ */ new Date()).toISOString(),
    selectedChangeIds,
    previewProject: project,
    validation,
    calculation
  });
  const progressiveBuild = updateProgressiveBuild(
    context.store.getState(context.runId).progressiveBuild,
    project,
    applied,
    context.store.getState(context.runId).request.options?.maxAutoDepth
  );
  storeProposal(context, applied);
  context.store.updateRun(context.runId, {
    status: "running",
    phase: "applying_graph",
    draftProject: project,
    pendingChangeSet: applied.changeSet,
    pendingMutationProposal: void 0,
    validationState: validation,
    progressiveBuild,
    ...calculation ? { calculationState: calculation } : {}
  });
  context.emit({
    type: "mutation_applied",
    phase: "applying_graph",
    title: "Mutation proposal applied",
    message: applied.summary,
    patch: applied.changeSet,
    metadata: {
      proposalId: applied.id,
      status: applied.status,
      revision: afterRevision,
      selectedChangeIds
    }
  });
  context.emit({
    type: "graph_patch",
    phase: "applying_graph",
    title: applied.title,
    message: applied.summary,
    patch: applied.changeSet,
    metadata: {
      proposalId: applied.id,
      revision: afterRevision,
      nodeIds: applied.changeSet.additions.map((addition2) => addition2.nodeId),
      edgeIds: applied.changeSet.edgeChanges.filter((change) => change.action === "add").map((change) => change.edge.id)
    }
  });
  return {
    proposal: applied,
    applied: true,
    revision: afterRevision,
    validation,
    ...calculation ? { calculation } : {}
  };
}
function buildMutationProposal(input) {
  const proposal = {
    id: `${input.runId}:mutation:${input.proposalNumber}`,
    runId: input.runId,
    projectId: input.project.id,
    vdtId: input.project.rootNodeId || input.project.id,
    baseRevisionId: `builder:${input.baseRevision}`,
    baseRevision: input.baseRevision,
    source: input.input.source ?? "agent",
    title: input.input.title,
    summary: input.input.summary,
    changeSet: input.input.changeSet,
    selectedChangeIds: input.selectedChangeIds,
    previewProject: input.previewProject,
    validation: input.validation,
    status: "proposed",
    policy: input.policy,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (input.calculation) proposal.calculation = input.calculation;
  if (input.scope) proposal.progressiveScope = input.scope;
  return proposal;
}
function updateProposal(proposal, patch) {
  const next = { ...proposal, ...patch };
  return next;
}
function storeProposal(context, proposal, options = {}) {
  const state = context.store.getState(context.runId);
  const existing = state.mutationProposals ?? [];
  const proposals = existing.some((candidate) => candidate.id === proposal.id) ? existing.map((candidate) => candidate.id === proposal.id ? proposal : candidate) : [...existing, proposal];
  context.store.updateRun(context.runId, {
    mutationProposals: proposals,
    ...options.pending ? { pendingMutationProposal: proposal, pendingChangeSet: proposal.changeSet } : {}
  });
}
function mutationPolicyForRun(context) {
  const options = context.store.getState(context.runId).request.options;
  if (options?.autoApplyPatches === true) {
    return {
      autoApply: true,
      askBeforeFirstPatch: options.askBeforeFirstPatch ?? false,
      requireApprovalForGraphStructure: false,
      requireApprovalForFormulaChanges: false,
      requireApprovalForDelete: false
    };
  }
  return {
    ...defaultAgentMutationPolicy,
    ...options?.askBeforeFirstPatch !== void 0 ? { askBeforeFirstPatch: options.askBeforeFirstPatch } : {}
  };
}
function requiresApproval(policy, changeSet2, existing) {
  if (!policy.autoApply) return true;
  if (policy.askBeforeFirstPatch && existing.every((proposal) => proposal.status !== "applied")) return true;
  if (policy.requireApprovalForDelete && changeSet2.deletions.length > 0) return true;
  if (policy.requireApprovalForFormulaChanges && changeSet2.updates.some((update) => update.patch.formula !== void 0)) return true;
  if (policy.requireApprovalForGraphStructure) {
    return changeSet2.additions.length > 0 || changeSet2.deletions.length > 0 || changeSet2.edgeChanges.length > 0;
  }
  return false;
}
function progressiveScopeForMutation(project, changeSet2, targetNodeId) {
  if (changeSet2.additions.length === 0) return void 0;
  const parentIds = [...new Set(changeSet2.additions.map((addition2) => addition2.parentNodeId))];
  const target = targetNodeId ?? (parentIds.length === 1 ? parentIds[0] : project.rootNodeId);
  if (!target) return void 0;
  return {
    targetNodeId: target,
    maxDepthDelta: 1,
    maxNodesPerLayer: defaultProgressiveBuildPolicy.maxNodesPerLayer,
    allowGrandchildrenInSingleMutation: false
  };
}
function validateProgressiveMutationScope(project, changeSet2, scope) {
  if (!scope) return void 0;
  if (changeSet2.additions.length > scope.maxNodesPerLayer) {
    return `Mutation adds ${changeSet2.additions.length} nodes, exceeding the one-layer limit of ${scope.maxNodesPerLayer}.`;
  }
  const parentIds = new Set(changeSet2.additions.map((addition2) => addition2.parentNodeId));
  if (parentIds.size > 1) {
    return "One mutation can add children under only one target node.";
  }
  if (![...parentIds].every((parentId) => parentId === scope.targetNodeId)) {
    return `Mutation target must be "${scope.targetNodeId}".`;
  }
  const existingNodeIds = new Set(project.graph.nodes.map((node) => node.id));
  if (!existingNodeIds.has(scope.targetNodeId)) {
    return `Mutation target "${scope.targetNodeId}" does not exist.`;
  }
  const addedNodeIds = new Set(changeSet2.additions.map((addition2) => addition2.nodeId));
  if (changeSet2.additions.some((addition2) => addedNodeIds.has(addition2.parentNodeId))) {
    return "One mutation cannot add grandchildren; decompose the next layer in a separate proposal.";
  }
  if (changeSet2.edgeChanges.some(
    (change) => change.action === "add" && addedNodeIds.has(change.edge.sourceNodeId) && addedNodeIds.has(change.edge.targetNodeId)
  )) {
    return "One mutation cannot connect newly added nodes as parent and child in the same proposal.";
  }
  return void 0;
}
function updateProgressiveBuild(current, project, proposal, requestedMaxAutoDepth) {
  const childrenByParent = /* @__PURE__ */ new Map();
  for (const edge of project.graph.edges) {
    childrenByParent.set(edge.sourceNodeId, [...childrenByParent.get(edge.sourceNodeId) ?? [], edge.targetNodeId]);
  }
  const depths = collectDepths(project, childrenByParent);
  const maxAutoDepth = current?.maxAutoDepth ?? requestedMaxAutoDepth ?? defaultProgressiveBuildPolicy.maxAutoDepth;
  const frontierNodeIds = project.graph.nodes.map((node) => node.id).filter((nodeId) => (childrenByParent.get(nodeId)?.length ?? 0) === 0);
  const completedLayerNodeIds = new Set(current?.completedLayerNodeIds ?? []);
  if (proposal.progressiveScope?.targetNodeId) completedLayerNodeIds.add(proposal.progressiveScope.targetNodeId);
  const currentDepth = Math.max(0, ...depths.values());
  return {
    rootNodeId: project.rootNodeId,
    currentDepth,
    maxAutoDepth,
    completedLayerNodeIds: [...completedLayerNodeIds],
    frontierNodeIds,
    blockedNodeIds: current?.blockedNodeIds ?? []
  };
}
function collectDepths(project, childrenByParent) {
  const children = childrenByParent ?? /* @__PURE__ */ new Map();
  if (!childrenByParent) {
    for (const edge of project.graph.edges) {
      children.set(edge.sourceNodeId, [...children.get(edge.sourceNodeId) ?? [], edge.targetNodeId]);
    }
  }
  const depths = /* @__PURE__ */ new Map();
  const visit = (nodeId, depth) => {
    const previous = depths.get(nodeId);
    if (previous !== void 0 && previous <= depth) return;
    depths.set(nodeId, depth);
    for (const childId of children.get(nodeId) ?? []) visit(childId, depth + 1);
  };
  if (project.rootNodeId) visit(project.rootNodeId, 0);
  return depths;
}
function collectChangeIds2(changeSet2) {
  return [
    ...changeSet2.additions.map((entry) => entry.id),
    ...changeSet2.updates.map((entry) => entry.id),
    ...changeSet2.deletions.map((entry) => entry.id),
    ...changeSet2.edgeChanges.map((entry) => entry.id)
  ];
}
function normalizeChangeSetForApply(changeSet2) {
  if (changeSet2.additions.length === 0 || changeSet2.edgeChanges.length === 0) return changeSet2;
  const implicitEdges = new Set(changeSet2.additions.map((addition2) => `${addition2.parentNodeId}->${addition2.nodeId}`));
  const edgeChanges = changeSet2.edgeChanges.filter((change) => {
    if (change.action !== "add") return true;
    return !implicitEdges.has(`${change.edge.sourceNodeId}->${change.edge.targetNodeId}`);
  });
  if (edgeChanges.length === changeSet2.edgeChanges.length) return changeSet2;
  return {
    ...changeSet2,
    edgeChanges
  };
}

// ../vdt-agent-runtime/src/chat-messages.ts
function normalizeUserQuestions(questions) {
  return questions.flatMap((question) => normalizeOneQuestion(question)).slice(0, 5);
}
function publicStatusForPhase(phase, message) {
  switch (phase) {
    case "classifying_request":
      return { phase: "reading_request", message: message ?? "Reading your request..." };
    case "asking_clarifying_questions":
      return { phase: "waiting_user", message: message ?? "Waiting for your answer." };
    case "retrieving_skills":
    case "reading_skills":
    case "planning_decomposition":
      return { phase: "planning_model", message: message ?? "Planning the VDT structure..." };
    case "building_graph":
    case "previewing_mutation":
    case "applying_graph":
      return { phase: "building_draft", message: message ?? "Drafting the driver tree..." };
    case "validating_graph":
    case "repairing_graph":
      return { phase: "checking_model", message: message ?? "Checking formulas and units..." };
    case "reporting":
      return { phase: "ready", message: message ?? "Draft ready." };
  }
}
function normalizeOneQuestion(question) {
  const fleetQuestions = splitFleetAndShiftQuestion(question);
  if (fleetQuestions) return fleetQuestions;
  const fieldGroupQuestion = inferFieldGroupQuestion(question);
  if (fieldGroupQuestion) return [fieldGroupQuestion];
  return [normalizeQuestionDefaults(question)];
}
function normalizeQuestionDefaults(question) {
  const answerKind = question.answerKind ?? question.expectedAnswerType ?? inferAnswerKind(question);
  const freeTextAllowed = question.freeTextAllowed ?? (question.fields && question.fields.length > 0 ? false : true);
  return {
    ...question,
    answerKind,
    freeTextAllowed,
    placeholder: question.placeholder ?? (freeTextAllowed ? "Add details or provide a custom answer..." : void 0)
  };
}
function splitFleetAndShiftQuestion(question) {
  if (hasExplicitAnswerStructure(question)) return void 0;
  const text = question.question.toLowerCase();
  const mentionsFleet = /excavator|truck|haul\s*truck|dump\s*truck|самосвал|экскаватор/.test(text);
  const mentionsShift = /shift|смен/.test(text);
  if (!mentionsFleet || !mentionsShift) return void 0;
  return [
    normalizeQuestionDefaults({
      id: `${question.id}_fleet`.replace(/_{2,}/g, "_"),
      question: "What fleet is in scope?",
      reason: question.reason || "Fleet counts determine the available loading and hauling capacity.",
      required: question.required,
      answerKind: "field_group",
      freeTextAllowed: false,
      fields: [
        {
          id: "excavator_count",
          label: "Excavators",
          kind: "number",
          unit: "units",
          required: /excavator|экскаватор/.test(text),
          placeholder: "5"
        },
        {
          id: "haul_truck_count",
          label: "Haul trucks",
          kind: "number",
          unit: "units",
          required: /truck|самосвал/.test(text),
          placeholder: "10"
        }
      ]
    }),
    normalizeQuestionDefaults({
      id: `${question.id}_shifts`.replace(/_{2,}/g, "_"),
      question: "How many shifts does the fleet work?",
      reason: "Shift pattern determines annual working time and downtime assumptions.",
      required: question.required,
      answerKind: "field_group",
      freeTextAllowed: true,
      placeholder: "Add which equipment works in each shift if it differs.",
      fields: [
        {
          id: "shifts_per_day",
          label: "Shifts per day",
          kind: "number",
          unit: "shifts/day",
          required: true,
          placeholder: "2"
        }
      ]
    })
  ];
}
function inferFieldGroupQuestion(question) {
  if (hasExplicitAnswerStructure(question)) return void 0;
  const text = question.question.toLowerCase();
  const mentionsExcavators = /excavator|экскаватор/.test(text);
  const mentionsTrucks = /truck|haul\s*truck|dump\s*truck|самосвал/.test(text);
  const mentionsReverseShovel = /reverse\s+shovel|backhoe|обратн/.test(text);
  const mentionsStraightShovel = /straight\s+shovel|face\s+shovel|прям/.test(text);
  const mentionsHours = /hour|час/.test(text);
  const mentionsDaysPerYear = /(day|дн).*(year|год)|(year|год).*(day|дн)/.test(text);
  const mentionsDistance = /distance|km|км/.test(text);
  const mentionsSpeed = /speed|km\/h|км\/ч/.test(text);
  if (mentionsReverseShovel && mentionsStraightShovel) {
    return normalizeQuestionDefaults({
      ...question,
      answerKind: "field_group",
      freeTextAllowed: false,
      fields: [
        {
          id: "reverse_shovel_count",
          label: "Reverse shovel excavators",
          kind: "number",
          unit: "units",
          required: true,
          placeholder: "3"
        },
        {
          id: "straight_shovel_count",
          label: "Straight shovel excavators",
          kind: "number",
          unit: "units",
          required: true,
          placeholder: "2"
        }
      ]
    });
  }
  if (mentionsExcavators && mentionsTrucks) {
    return normalizeQuestionDefaults({
      ...question,
      answerKind: "field_group",
      freeTextAllowed: false,
      fields: [
        {
          id: "excavator_count",
          label: "Excavators",
          kind: "number",
          unit: "units",
          required: true,
          placeholder: "5"
        },
        {
          id: "haul_truck_count",
          label: "Haul trucks",
          kind: "number",
          unit: "units",
          required: true,
          placeholder: "10"
        }
      ]
    });
  }
  if (mentionsHours && mentionsDaysPerYear) {
    return normalizeQuestionDefaults({
      ...question,
      answerKind: "field_group",
      freeTextAllowed: true,
      fields: [
        {
          id: /shift|смен/.test(text) ? "hours_per_shift" : "operating_hours",
          label: /shift|смен/.test(text) ? "Hours per shift" : "Operating hours",
          kind: "number",
          unit: "h",
          required: true,
          placeholder: "12"
        },
        {
          id: "working_days_per_year",
          label: "Working days per year",
          kind: "number",
          unit: "days/year",
          required: true,
          placeholder: "350"
        }
      ]
    });
  }
  if (mentionsDistance && mentionsSpeed) {
    return normalizeQuestionDefaults({
      ...question,
      answerKind: "field_group",
      freeTextAllowed: true,
      fields: [
        {
          id: "haul_distance_km",
          label: "Haul distance",
          kind: "number",
          unit: "km",
          required: true,
          placeholder: "2.7"
        },
        {
          id: "loaded_speed_kmh",
          label: "Loaded speed",
          kind: "number",
          unit: "km/h",
          required: false,
          placeholder: "7"
        },
        {
          id: "empty_speed_kmh",
          label: "Empty speed",
          kind: "number",
          unit: "km/h",
          required: false,
          placeholder: "11"
        }
      ]
    });
  }
  return void 0;
}
function hasExplicitAnswerStructure(question) {
  return (question.fields?.length ?? 0) > 0 || (question.options?.length ?? 0) > 0;
}
function inferAnswerKind(question) {
  if (question.fields && question.fields.length > 0) return "field_group";
  if (question.options && question.options.length > 0) return "single_choice";
  return "text";
}

// ../vdt-agent-runtime/src/prompts/agent-decision.ts
var AGENT_DECISION_SYSTEM_PROMPT = [
  "You are the VDT Studio agent.",
  "Choose one small decision at a time. For ordinary runs, call_tools may contain 2-6 sequential calls when each call logically depends on the previous result.",
  "Return only AgentDecision JSON.",
  "For call_tool, toolName must exactly match one of availableTools.name from the current context.",
  "For call_tools, every calls[].toolName must exactly match availableTools.name. Never include user.ask or user.request_approval in a batch; return ask_user separately and let the mutation pipeline create approvals.",
  "Never return a full graph, full project, nodes array, edges array, driverPlan, fullGraph, fullProject, or selectedSkillIds.",
  "All graph changes must be made through VDT tools.",
  "For user questions, return type ask_user with precise structured questions.",
  "Use lastFeedback and recentFeedback before retrying after schema, tool, validation, calculation, or finish errors.",
  "The visible brief and visible conversation are authoritative.",
  "Do not override root KPI, title, unit, period, fleet, domain or scope with examples, skills, recipes or mock defaults.",
  "Use briefReadiness to decide whether the requested model direction is defined before selecting skills or building.",
  "Follow researchPolicy exactly. Never use research.search_web when researchPolicy.mode is off.",
  "When researchPolicy.mode is on or auto permits research, use research.search_web only as source discovery feeding the next AgentDecision, not as single-shot report generation.",
  "If no strong skill match exists, or a compiled recipe is partial or missing, read the best available skill markdown, use research/discovery tools if available, or ask the user for the process decomposition boundary.",
  "Follow domainPolicies from the current context; domain and business restrictions live in skills, validators, and domain policies.",
  "Build VDTs progressively, one visible layer at a time.",
  "When mode=continue_project or currentProject is present, the open VDT already has a root. Extend it with vdt.add_driver, vdt.add_drivers_batch, or vdt.update_node; do not call vdt.create_draft unless replaceExisting=true with explicit user confirmation.",
  "When mode=deepen_node, return call_tool only, add exactly one immediate child layer under selectedNode, update only that selected node as needed, and then finish the run.",
  "In deepen_node mode, never add grandchildren, never continue into any newly created child, and never invent baseline values merely to satisfy the normal full-model finish gate.",
  "Ask only for continuationPolicy.askOnlyWhen reasons: missing data, business choice, scope conflict, ambiguous logic, low confidence, or formula ambiguity.",
  "A graph mutation should target one node or one sibling layer only; never add grandchildren in the same decision.",
  "Do not add a calculated-node formula until every referenced node already exists or is part of the same validated proposal.",
  "When adding several sibling drivers under the same parent, prefer vdt.add_drivers_batch over repeated vdt.add_driver calls.",
  "When vdt.add_drivers_batch creates all references needed by its parent, pass an explicit parentFormula so the children and formula are validated and applied atomically. Never infer arithmetic only from edge relation labels.",
  "Work through formulaBacklog bottom-up before finish. Each listed calculated node has children but no formula.",
  "Finish only when the VDT is valid and calculable, or ask the user when missing business data would otherwise create a false model.",
  "Never expose hidden chain-of-thought. Use concise status messages only."
].join("\n");

// ../vdt-agent-runtime/src/schemas/agent-decision.ts
var agentToolCallSchema = external_exports.object({
  toolName: external_exports.string().min(1).max(120),
  args: external_exports.record(external_exports.unknown())
});
var agentDecisionV1Schema = external_exports.discriminatedUnion("type", [
  external_exports.object({
    type: external_exports.literal("call_tool"),
    ...agentToolCallSchema.shape,
    statusMessage: external_exports.string().min(1).max(500)
  }),
  external_exports.object({
    type: external_exports.literal("ask_user"),
    questions: external_exports.array(agentQuestionSchema2).min(1).max(5),
    statusMessage: external_exports.string().min(1).max(500)
  }),
  external_exports.object({
    type: external_exports.literal("finish"),
    summary: external_exports.string().min(1).max(2e3),
    nextSuggestedActions: external_exports.array(external_exports.string().max(300)).max(10).default([])
  })
]);
var agentDecisionSchema2 = external_exports.discriminatedUnion("type", [
  ...agentDecisionV1Schema.options,
  external_exports.object({
    type: external_exports.literal("call_tools"),
    calls: external_exports.array(agentToolCallSchema).min(2).max(6),
    statusMessage: external_exports.string().min(1).max(500)
  })
]);

// ../vdt-agent-runtime/src/tools/ai-task-tools.ts
var advisoryOutputSchema = external_exports.object({
  assumptions: external_exports.array(external_exports.string()),
  questionsForUser: external_exports.array(external_exports.string()),
  warnings: external_exports.array(external_exports.object({
    severity: external_exports.enum(["info", "warning", "error"]),
    message: external_exports.string(),
    nodeId: external_exports.string().optional(),
    edgeId: external_exports.string().optional()
  }))
});
var checkUnitsTool = {
  name: "ai.check_units",
  description: "Run bounded unit consistency checks using deterministic validators.",
  inputSchema: external_exports.object({}),
  outputSchema: advisoryOutputSchema,
  run(context) {
    const project = context.store.getSnapshot(context.runId).draftProject;
    if (!project) throw new Error("No draft project is available.");
    const validation = validateGraph(project);
    const warnings = [...validation.errors, ...validation.warnings].filter((warning3) => warning3.type === "unit_mismatch" || warning3.type === "unknown_reference" || warning3.type === "formula_parse_error").map(toAdvisoryWarning);
    mergeReview(context, { assumptions: [], questionsForUser: [], warnings });
    return { assumptions: [], questionsForUser: [], warnings };
  }
};
var identifyMissingDriversTool = {
  name: "ai.identify_missing_drivers",
  description: "Identify likely underdeveloped driver branches without external tool access.",
  inputSchema: external_exports.object({}),
  outputSchema: advisoryOutputSchema,
  run(context) {
    const project = context.store.getSnapshot(context.runId).draftProject;
    if (!project) throw new Error("No draft project is available.");
    const childCounts = /* @__PURE__ */ new Map();
    for (const edge of project.graph.edges) {
      childCounts.set(edge.sourceNodeId, (childCounts.get(edge.sourceNodeId) ?? 0) + 1);
    }
    const warnings = project.graph.nodes.filter((node) => node.type === "calculated" && node.id !== project.rootNodeId && (childCounts.get(node.id) ?? 0) === 0).slice(0, 10).map((node) => ({
      severity: "warning",
      message: `"${node.name}" is calculated but has no visible child drivers yet.`,
      ...node.id ? { nodeId: node.id } : {}
    }));
    const questionsForUser = warnings.length > 0 ? ["Which calculated branch should the agent deepen next?"] : [];
    mergeReview(context, { assumptions: [], questionsForUser, warnings });
    return { assumptions: [], questionsForUser, warnings };
  }
};
var identifyDuplicateDriversTool = {
  name: "ai.identify_duplicate_drivers",
  description: "Identify duplicate driver names in the current draft.",
  inputSchema: external_exports.object({}),
  outputSchema: advisoryOutputSchema,
  run(context) {
    const project = context.store.getSnapshot(context.runId).draftProject;
    if (!project) throw new Error("No draft project is available.");
    const byName = /* @__PURE__ */ new Map();
    for (const node of project.graph.nodes) {
      const key = node.name.trim().toLowerCase();
      byName.set(key, [...byName.get(key) ?? [], node.id]);
    }
    const warnings = [...byName].filter(([, ids]) => ids.length > 1).map(([name, ids]) => ({
      severity: "warning",
      message: `Duplicate driver label "${name}" appears on ${ids.length} nodes.`,
      ...ids[0] ? { nodeId: ids[0] } : {}
    }));
    mergeReview(context, { assumptions: [], questionsForUser: [], warnings });
    return { assumptions: [], questionsForUser: [], warnings };
  }
};
var reviewModelTool = {
  name: "ai.review_model",
  description: "Create a bounded model review summary from validation and visible structure.",
  inputSchema: external_exports.object({}),
  outputSchema: advisoryOutputSchema,
  run(context) {
    const project = context.store.getSnapshot(context.runId).draftProject;
    if (!project) throw new Error("No draft project is available.");
    const validation = validateGraph(project);
    const assumptions = [
      "The first draft uses skill recipes and should be refined with actual business values.",
      "Formula structure is validated syntactically, but numeric assumptions still need owner review."
    ];
    const questionsForUser = validation.valid ? ["Which first-level driver should be deepened next?"] : ["Should the agent repair the validation issues before adding more detail?"];
    const warnings = [...validation.errors, ...validation.warnings].map(toAdvisoryWarning);
    mergeReview(context, { assumptions, questionsForUser, warnings });
    return { assumptions, questionsForUser, warnings };
  }
};
function toAdvisoryWarning(warning3) {
  return {
    severity: warning3.severity,
    message: warning3.message,
    ...warning3.nodeId ? { nodeId: warning3.nodeId } : {},
    ...warning3.edgeId ? { edgeId: warning3.edgeId } : {}
  };
}
function mergeReview(context, result) {
  const snapshot = context.store.getSnapshot(context.runId);
  const project = snapshot.draftProject;
  if (!project) return;
  context.store.updateRun(context.runId, {
    draftProject: {
      ...project,
      aiReview: {
        assumptions: [.../* @__PURE__ */ new Set([...project.aiReview?.assumptions ?? [], ...result.assumptions])],
        questionsForUser: [.../* @__PURE__ */ new Set([...project.aiReview?.questionsForUser ?? [], ...result.questionsForUser])],
        warnings: [
          ...project.aiReview?.warnings ?? [],
          ...result.warnings.map((warning3, index) => ({
            id: `agent_review_${snapshot.events.length}_${index}`,
            severity: warning3.severity,
            type: "weak_business_logic",
            message: warning3.message,
            nodeId: warning3.nodeId,
            edgeId: warning3.edgeId
          }))
        ]
      }
    }
  });
}

// ../vdt-agent-runtime/src/tools/excavation-tools.ts
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ../vdt-agent-runtime/src/tools/builder-mutation-utils.ts
function cloneBuilder(context) {
  const builder = requireBuilder(context.builder);
  return new VdtBuilderSession({
    project: builder.getProject(),
    providerId: context.getRun().request.providerId
  });
}
function requireBuilder(builder) {
  if (!builder) throw new AgentToolError("NO_DRAFT_PROJECT", "VDT builder session is not available for this run.");
  return builder;
}
function requireChangeSet(changeSet2) {
  if (!changeSet2) throw new AgentToolError("MUTATION_CHANGESET_MISSING", "Builder operation did not produce a change set.");
  return changeSet2;
}
function combineChangeSets(changeSets, context) {
  if (changeSets.length === 0) {
    throw new AgentToolError("MUTATION_CHANGESET_MISSING", "Batch operation did not produce change sets.");
  }
  const first = changeSets[0];
  return {
    id: `changeset_${context.runId}_batch_${Date.now()}`,
    taskType: first.taskType,
    backendId: first.backendId,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    additions: changeSets.flatMap((changeSet2) => changeSet2.additions),
    updates: changeSets.flatMap((changeSet2) => changeSet2.updates),
    deletions: changeSets.flatMap((changeSet2) => changeSet2.deletions),
    edgeChanges: changeSets.flatMap((changeSet2) => changeSet2.edgeChanges),
    assumptions: changeSets.flatMap((changeSet2) => changeSet2.assumptions),
    questions: changeSets.flatMap((changeSet2) => changeSet2.questions),
    warnings: changeSets.flatMap((changeSet2) => changeSet2.warnings)
  };
}

// ../vdt-agent-runtime/src/tools/excavation-tools.ts
var valueStatusSchema = external_exports.enum([
  "unknown",
  "user_provided_value",
  "default_assumption",
  "calculated",
  "partially_calculable"
]);
var valueSourceSchema = external_exports.object({
  sourceTier: external_exports.string().max(120).optional(),
  confidence: external_exports.string().max(80).optional(),
  catalogRef: external_exports.string().max(240).optional(),
  acceptedByUserInDialog: external_exports.boolean().optional(),
  editableInDialog: external_exports.boolean().optional(),
  note: external_exports.string().max(500).optional(),
  range: external_exports.tuple([external_exports.number().finite(), external_exports.number().finite()]).optional()
}).strict();
var seedTopologyInputSchema = external_exports.object({
  materialMode: external_exports.enum(["ore_tonnes", "rock_solid_m3", "mixed_ore_tonnes_and_rock_m3"]).default("ore_tonnes"),
  scope: external_exports.enum(["output", "productivity"]).default("output"),
  splitMode: external_exports.enum(["none", "equipment_class"]).default("none"),
  rootKpi: external_exports.string().min(1).max(200).optional(),
  unit: external_exports.string().max(80).optional(),
  timePeriod: external_exports.string().max(80).optional(),
  downtimeBasis: external_exports.enum(["per_excavator", "fleet_total"]).default("per_excavator"),
  includeReadinessDowntime: external_exports.boolean().default(true)
}).strict();
var suggestInputSchema = external_exports.object({
  nodeId: external_exports.string().min(1).max(160),
  materialKey: external_exports.string().max(120).optional(),
  equipmentAlias: external_exports.string().max(120).optional()
}).strict();
var writeInputValueSchema = external_exports.object({
  nodeId: external_exports.string().min(1).max(160),
  value: external_exports.number().finite().optional(),
  unit: external_exports.string().max(80).optional(),
  valueStatus: valueStatusSchema,
  source: valueSourceSchema.optional()
}).strict();
var excavationDialoguePolicyTool = {
  name: "excavation.dialogue_policy",
  description: "Read the compact dialog-only policy from excavation-dialogue-flow.yaml for topology-first conversation order.",
  inputSchema: external_exports.object({
    section: external_exports.enum(["runtime_principles", "topology_questions", "input_order", "reference_lookup_policy", "final_validation"]).default("input_order")
  }).strict(),
  outputSchema: external_exports.record(external_exports.unknown()),
  phase: "planning_decomposition",
  async run(_context, input) {
    const dialogue = await readReferenceFile("excavation-dialogue-flow.yaml");
    return dialoguePolicySection(dialogue, input.section);
  }
};
var excavationSeedTopologyTool = {
  name: "excavation.seed_topology",
  description: "Build a mining excavation VDT topology first, with unknown numeric leaves and no silent defaults.",
  inputSchema: seedTopologyInputSchema,
  outputSchema: external_exports.record(external_exports.unknown()),
  mutatesProject: true,
  requiresDraftProject: true,
  phase: "building_graph",
  run(context, input) {
    const builder = requireBuilder(context.builder);
    let project = builder.getProject();
    const rootKpi = input.rootKpi ?? defaultRootKpi(input.materialMode, input.scope, input.splitMode);
    if (project.graph.nodes.length === 0) {
      const result = builder.createDraft({
        projectTitle: `${rootKpi} Driver Model`,
        rootKpi,
        unit: input.unit ?? defaultUnit(input.materialMode, input.scope),
        timePeriod: input.timePeriod
      });
      project = result.project;
      context.store.updateRun(context.runId, { draftProject: project });
      context.emit({
        type: "graph_patch",
        phase: "building_graph",
        title: "Excavation draft root created",
        message: result.event.message,
        metadata: { revision: result.revision, rootNodeId: project.rootNodeId }
      });
    }
    if (input.materialMode === "mixed_ore_tonnes_and_rock_m3") {
      return seedMixedUnitSplit(context, project.rootNodeId);
    }
    if (input.splitMode === "equipment_class") {
      return seedEquipmentSplit(context, project.rootNodeId);
    }
    if (input.scope === "productivity") {
      return seedProductivityRoot(context, project.rootNodeId, input.materialMode);
    }
    return seedOutputTopology(context, project.rootNodeId, input.materialMode, input.downtimeBasis, input.includeReadinessDowntime);
  }
};
var excavationSuggestReferenceValueTool = {
  name: "excavation.suggest_reference_value",
  description: "Return one targeted excavation reference suggestion for the active input KPI only.",
  inputSchema: suggestInputSchema,
  outputSchema: external_exports.record(external_exports.unknown()),
  phase: "planning_decomposition",
  async run(_context, input) {
    const suggestion = await suggestExcavationReference(input.nodeId, {
      materialKey: input.materialKey,
      equipmentAlias: input.equipmentAlias
    });
    return {
      suggestion,
      policy: {
        dialogOnly: true,
        applyAutomatically: false,
        acceptedStatus: "default_assumption",
        fullCatalogLoadedIntoPrompt: false
      }
    };
  }
};
var excavationWriteInputValueTool = {
  name: "excavation.write_input_value",
  description: "Write one dialog-provided or accepted-default excavation input value with explicit provenance.",
  inputSchema: writeInputValueSchema,
  outputSchema: external_exports.record(external_exports.unknown()),
  mutatesProject: true,
  requiresDraftProject: true,
  phase: "building_graph",
  run(context, input) {
    const builder = requireBuilder(context.builder);
    const project = builder.getProject();
    if (!project.graph.nodes.some((node) => node.id === input.nodeId)) {
      throw new AgentToolError("NODE_NOT_FOUND", `Node "${input.nodeId}" was not found.`);
    }
    const patch = {
      status: input.valueStatus === "unknown" ? "needs_data" : input.valueStatus === "default_assumption" ? "assumption" : "accepted",
      valueStatus: input.valueStatus
    };
    if (input.value !== void 0) {
      patch.baselineValue = input.value;
      patch.value = input.value;
    }
    if (input.unit) patch.unit = input.unit;
    if (input.source) patch.valueSource = input.source;
    const mutation = proposeAndMaybeApplyMutation(context, {
      title: "Excavation input value captured",
      summary: `Captured ${input.valueStatus} for ${input.nodeId}.`,
      targetNodeId: input.nodeId,
      changeSet: changeSet(context, {
        updates: [{ id: `update_${input.nodeId}_value`, nodeId: input.nodeId, patch }]
      })
    });
    return {
      nodeId: input.nodeId,
      valueStatus: input.valueStatus,
      revision: mutation.revision,
      mutationProposal: { id: mutation.proposal.id, status: mutation.proposal.status },
      validation: mutation.validation
    };
  }
};
var excavationValidateTool = {
  name: "excavation.validate",
  description: "Validate excavation-specific graph guardrails such as readiness downtime, forbidden haulage creep, and mixed-unit sums.",
  inputSchema: external_exports.object({}),
  outputSchema: external_exports.record(external_exports.unknown()),
  requiresDraftProject: true,
  phase: "validating_graph",
  run(context) {
    const project = requireBuilder(context.builder).getProject();
    const result = validateExcavationProject(project);
    context.emit({
      type: "graph_validation",
      phase: "validating_graph",
      title: result.valid ? "Excavation validation passed" : "Excavation validation found issues",
      message: result.valid ? `Excavation validation passed with ${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}.` : `Excavation validation found ${result.errors.length} error${result.errors.length === 1 ? "" : "s"}.`,
      metadata: { errors: result.errors.length, warnings: result.warnings.length }
    });
    return result;
  }
};
function seedOutputTopology(context, rootNodeId, materialMode, downtimeBasis, includeReadinessDowntime) {
  const proposals = [];
  const top = applyLayer(context, rootNodeId, [
    inputNode("active_excavator_count", "Active excavator count", "excavators"),
    calculatedNode("net_excavation_time_per_excavator_h", "Net excavation time per excavator", "h"),
    calculatedNode("excavator_productivity", "Excavator productivity", materialMode === "ore_tonnes" ? "t/h" : "solid m3/h")
  ], [
    {
      nodeId: rootNodeId,
      patch: {
        formula: "active_excavator_count * net_excavation_time_per_excavator_h * excavator_productivity",
        valueStatus: "calculated"
      }
    }
  ], {
    title: "Excavation top drivers added",
    summary: "Added the canonical active fleet, net time, and productivity drivers.",
    assumptions: ["Numeric site inputs remain unknown until collected through dialog."]
  });
  proposals.push(top);
  if (!top.applied) return pendingResult(context, proposals);
  const timeLayer = applyLayer(context, "net_excavation_time_per_excavator_h", [
    calculatedNode("calendar_time_per_excavator_h", "Calendar time per excavator", "h"),
    calculatedNode("downtime_per_excavator_h", "Downtime per excavator", "h")
  ], [], {
    title: "Excavation time branch added",
    summary: "Added calendar time and downtime under net excavation time."
  });
  proposals.push(timeLayer);
  if (!timeLayer.applied) return pendingResult(context, proposals);
  const calendarLayer = applyLayer(context, "calendar_time_per_excavator_h", [
    inputNode("period_days", "Period days", "days"),
    constantNode("hours_per_day_24", "Hours per day", "h/day", 24)
  ], [
    { nodeId: "calendar_time_per_excavator_h", patch: { formula: "period_days * 24", valueStatus: "calculated" } },
    { nodeId: "net_excavation_time_per_excavator_h", patch: { formula: "calendar_time_per_excavator_h - downtime_per_excavator_h", valueStatus: "calculated" } }
  ], {
    title: "Excavation calendar branch added",
    summary: "Added period and fixed 24-hour calendar constant."
  });
  proposals.push(calendarLayer);
  if (!calendarLayer.applied) return pendingResult(context, proposals);
  if (downtimeBasis === "fleet_total") {
    const fleetLayer = applyLayer(context, "downtime_per_excavator_h", [
      inputNode("fleet_downtime_h", "Fleet downtime", "h")
    ], [
      { nodeId: "downtime_per_excavator_h", patch: { formula: "fleet_downtime_h / active_excavator_count", valueStatus: "calculated" } }
    ], {
      title: "Excavation fleet downtime branch added",
      summary: "Converted fleet-total downtime to downtime per excavator.",
      warnings: [
        excavationWarning("fleet_downtime_basis", "downtime basis is fleet total and must be converted or modeled as fleet net time", "downtime_per_excavator_h")
      ]
    });
    proposals.push(fleetLayer);
    if (!fleetLayer.applied) return pendingResult(context, proposals);
  } else {
    const downtimeNodes = downtimeCategoryNodes(includeReadinessDowntime);
    const firstDowntime = applyLayer(context, "downtime_per_excavator_h", downtimeNodes.slice(0, 8), [], {
      title: "Excavation downtime categories added",
      summary: "Added the first visible layer of downtime categories.",
      assumptions: ["Readiness, drill/blast waits, access, geotechnical, and safety restrictions are downtime categories, not caps."]
    });
    proposals.push(firstDowntime);
    if (!firstDowntime.applied) return pendingResult(context, proposals);
    const remaining = downtimeNodes.slice(8);
    if (remaining.length > 0) {
      const secondDowntime = applyLayer(context, "downtime_per_excavator_h", remaining, [], {
        title: "Excavation downtime categories completed",
        summary: "Added remaining downtime categories."
      });
      proposals.push(secondDowntime);
      if (!secondDowntime.applied) return pendingResult(context, proposals);
    }
    const downtimeFormula = applyUpdates(context, [
      {
        nodeId: "downtime_per_excavator_h",
        patch: {
          formula: downtimeCategoryFormula(downtimeNodes.map((node) => node.id)),
          valueStatus: "calculated"
        }
      }
    ], {
      title: "Excavation downtime formula set",
      summary: "Set downtime as the sum of explicit downtime categories."
    });
    proposals.push(downtimeFormula);
    if (!downtimeFormula.applied) return pendingResult(context, proposals);
  }
  const productivity = seedProductivityBranch(context, "excavator_productivity", materialMode);
  proposals.push(...productivity.proposals);
  if (!productivity.applied) return pendingResult(context, proposals);
  const validation = validateExcavationProject(requireBuilder(context.builder).getProject());
  context.store.updateRun(context.runId, { validationState: summarizeValidation(validation) });
  return {
    applied: true,
    rootNodeId,
    materialMode,
    proposals: proposals.map((proposal) => proposalSummary(proposal)),
    validation
  };
}
function seedProductivityRoot(context, rootNodeId, materialMode) {
  const productivity = seedProductivityBranch(context, rootNodeId, materialMode);
  const validation = validateExcavationProject(requireBuilder(context.builder).getProject());
  context.store.updateRun(context.runId, { validationState: summarizeValidation(validation) });
  return {
    applied: productivity.applied,
    rootNodeId,
    materialMode,
    proposals: productivity.proposals.map((proposal) => proposalSummary(proposal)),
    validation
  };
}
function seedProductivityBranch(context, parentNodeId, materialMode) {
  const proposals = [];
  const namedProductivityId = materialMode === "ore_tonnes" ? "ore_excavator_productivity_tph" : "rock_excavator_productivity_m3ph";
  const materialPerTruckId = materialMode === "ore_tonnes" ? "tonnes_per_truck" : "rock_volume_per_truck_in_solid_m3";
  const materialPerTruckName = materialMode === "ore_tonnes" ? "Tonnes per truck" : "Rock volume per truck in solid m3";
  const materialPerTruckUnit = materialMode === "ore_tonnes" ? "t/truck" : "solid m3/truck";
  const productivityUnit = materialMode === "ore_tonnes" ? "t/h" : "solid m3/h";
  const layer = applyLayer(context, parentNodeId, [
    calculatedNode("loaded_trucks_per_hour", "Loaded trucks per hour", "trucks/h"),
    calculatedNode("material_per_truck", "Material per truck", materialPerTruckUnit),
    calculatedNode(namedProductivityId, materialMode === "ore_tonnes" ? "Ore excavator productivity" : "Rock excavator productivity", productivityUnit)
  ], [
    { nodeId: parentNodeId, patch: { formula: "loaded_trucks_per_hour * material_per_truck", valueStatus: "calculated" } }
  ], {
    title: "Excavation productivity branch added",
    summary: "Added loaded trucks per hour and material per truck without adding haulage cycle nodes."
  });
  proposals.push(layer);
  if (!layer.applied) return { applied: false, proposals };
  const loadedTruckLayer = applyLayer(context, "loaded_trucks_per_hour", [
    constantNode("minutes_per_hour_60", "Minutes per hour", "min/h", 60),
    calculatedNode("truck_loading_time_min", "Truck loading time", "min/truck")
  ], [
    { nodeId: "loaded_trucks_per_hour", patch: { formula: "60 / truck_loading_time_min", valueStatus: "calculated" } }
  ], {
    title: "Excavation loaded-truck rate added",
    summary: "Added loading-time denominator for loaded trucks per hour."
  });
  proposals.push(loadedTruckLayer);
  if (!loadedTruckLayer.applied) return { applied: false, proposals };
  const truckLoadingLayer = applyLayer(context, "truck_loading_time_min", [
    calculatedNode("loading_movement_unloading_time_min", "Loading movement and unloading time", "min/truck"),
    inputNode("face_breakdown_ripping_time_min", "Face breakdown or ripping time", "min/truck"),
    inputNode("truck_departure_arrival_time_min", "Truck departure and arrival time", "min/truck"),
    inputNode("relocation_time_min", "Relocation time", "min/truck")
  ], [
    {
      nodeId: "truck_loading_time_min",
      patch: {
        formula: "loading_movement_unloading_time_min + face_breakdown_ripping_time_min + truck_departure_arrival_time_min + relocation_time_min",
        valueStatus: "calculated"
      }
    }
  ], {
    title: "Excavation loading-time components added",
    summary: "Added loading-time components without route, queueing, or dispatch nodes."
  });
  proposals.push(truckLoadingLayer);
  if (!truckLoadingLayer.applied) return { applied: false, proposals };
  const materialLayer = applyLayer(context, "material_per_truck", [
    calculatedNode(materialPerTruckId, materialPerTruckName, materialPerTruckUnit)
  ], [
    { nodeId: "material_per_truck", patch: { formula: materialPerTruckId, valueStatus: "calculated" } },
    {
      nodeId: namedProductivityId,
      patch: {
        formula: `loaded_trucks_per_hour * ${materialPerTruckId}`,
        valueStatus: "calculated"
      }
    }
  ], {
    title: "Excavation material-per-truck branch added",
    summary: `Added ${materialPerTruckName.toLowerCase()} for the selected material mode.`
  });
  proposals.push(materialLayer);
  if (!materialLayer.applied) return { applied: false, proposals };
  const materialBranch = materialMode === "ore_tonnes" ? seedOreMaterialBranch(context) : seedRockMaterialBranch(context);
  proposals.push(...materialBranch);
  if (materialBranch.some((proposal) => !proposal.applied)) return { applied: false, proposals };
  const formulaLayer = applyUpdates(context, [
    {
      nodeId: "loading_movement_unloading_time_min",
      patch: { formula: "buckets_per_truck * bucket_cycle_time_sec / 60", valueStatus: "calculated" }
    }
  ], {
    title: "Excavation bucket movement formula set",
    summary: "Set loading movement time from bucket passes and bucket cycle time."
  });
  proposals.push(formulaLayer);
  return { applied: proposals.every((proposal) => proposal.applied), proposals };
}
function seedOreMaterialBranch(context) {
  const proposals = [];
  const truckLayer = applyLayer(context, "tonnes_per_truck", [
    inputNode("buckets_per_truck", "Buckets per truck", "buckets/truck"),
    calculatedNode("tonnes_per_bucket", "Tonnes per bucket", "t/bucket")
  ], [
    { nodeId: "tonnes_per_truck", patch: { formula: "buckets_per_truck * tonnes_per_bucket", valueStatus: "calculated" } }
  ], {
    title: "Excavation ore truck payload branch added",
    summary: "Added buckets per truck and tonnes per bucket."
  });
  proposals.push(truckLayer);
  if (!truckLayer.applied) return proposals;
  const bucketLayer = applyLayer(context, "tonnes_per_bucket", [
    inputNode("average_bucket_volume_m3", "Average bucket volume", "m3"),
    inputNode("ore_density_in_solid_t_per_m3", "Ore density in solid tonnes per m3", "t/solid m3"),
    inputNode("swell_factor", "Swell factor", "ratio"),
    inputNode("actual_bucket_fill_factor", "Actual bucket fill factor", "ratio"),
    inputNode("bucket_cycle_time_sec", "Bucket cycle time", "sec/bucket")
  ], [
    {
      nodeId: "tonnes_per_bucket",
      patch: {
        formula: "average_bucket_volume_m3 / swell_factor * actual_bucket_fill_factor * ore_density_in_solid_t_per_m3",
        valueStatus: "calculated"
      }
    }
  ], {
    title: "Excavation ore bucket payload branch added",
    summary: "Added bucket volume, density, swell, fill factor, and bucket cycle inputs."
  });
  proposals.push(bucketLayer);
  return proposals;
}
function seedRockMaterialBranch(context) {
  const proposals = [];
  const truckLayer = applyLayer(context, "rock_volume_per_truck_in_solid_m3", [
    inputNode("buckets_per_truck", "Buckets per truck", "buckets/truck"),
    calculatedNode("rock_volume_per_bucket_in_solid_m3", "Rock volume per bucket in solid m3", "solid m3/bucket")
  ], [
    {
      nodeId: "rock_volume_per_truck_in_solid_m3",
      patch: { formula: "buckets_per_truck * rock_volume_per_bucket_in_solid_m3", valueStatus: "calculated" }
    }
  ], {
    title: "Excavation rock truck-volume branch added",
    summary: "Added buckets per truck and solid rock volume per bucket."
  });
  proposals.push(truckLayer);
  if (!truckLayer.applied) return proposals;
  const bucketLayer = applyLayer(context, "rock_volume_per_bucket_in_solid_m3", [
    inputNode("average_bucket_volume_m3", "Average bucket volume", "m3"),
    inputNode("swell_factor", "Swell factor", "ratio"),
    inputNode("actual_bucket_fill_factor", "Actual bucket fill factor", "ratio"),
    inputNode("bucket_cycle_time_sec", "Bucket cycle time", "sec/bucket")
  ], [
    {
      nodeId: "rock_volume_per_bucket_in_solid_m3",
      patch: { formula: "average_bucket_volume_m3 / swell_factor * actual_bucket_fill_factor", valueStatus: "calculated" }
    }
  ], {
    title: "Excavation rock bucket-volume branch added",
    summary: "Added bucket volume, swell, fill factor, and bucket cycle inputs."
  });
  proposals.push(bucketLayer);
  return proposals;
}
function seedMixedUnitSplit(context, rootNodeId) {
  const proposal = applyLayer(context, rootNodeId, [
    calculatedNode("ore_excavation_output_t", "Ore excavation output", "t"),
    calculatedNode("rock_excavation_output_solid_m3", "Rock excavation output", "solid m3")
  ], [], {
    title: "Excavation material split added",
    summary: "Added ore tonnes and rock solid-m3 branches without summing unlike units.",
    warnings: [
      excavationWarning(
        "mixed_units_reporting_convention",
        "ore tonnes and rock cubic meters cannot be summed without an explicit reporting convention"
      )
    ]
  });
  const validation = validateExcavationProject(requireBuilder(context.builder).getProject());
  return { applied: proposal.applied, rootNodeId, proposals: [proposalSummary(proposal)], validation };
}
function seedEquipmentSplit(context, rootNodeId) {
  const proposal = applyLayer(context, rootNodeId, [
    calculatedNode("hydraulic_shovel_excavation_output", "Hydraulic shovel excavation output"),
    calculatedNode("rope_shovel_excavation_output", "Rope shovel excavation output")
  ], [
    {
      nodeId: rootNodeId,
      patch: {
        formula: "hydraulic_shovel_excavation_output + rope_shovel_excavation_output",
        valueStatus: "calculated"
      }
    }
  ], {
    title: "Excavation equipment split added",
    summary: "Split excavation output by equipment class because productivity drivers differ."
  });
  const validation = validateExcavationProject(requireBuilder(context.builder).getProject());
  return { applied: proposal.applied, rootNodeId, proposals: [proposalSummary(proposal)], validation };
}
function applyLayer(context, parentNodeId, nodeSpecs, updates = [], options) {
  const project = requireBuilder(context.builder).getProject();
  const existing = new Set(project.graph.nodes.map((node) => node.id));
  const additions = nodeSpecs.filter((node) => !existing.has(node.id)).map((node) => addition(parentNodeId, node));
  return applyChangeSet2(context, additions, updates, parentNodeId, options);
}
function applyUpdates(context, updates, options) {
  return applyChangeSet2(context, [], updates, void 0, options);
}
function applyChangeSet2(context, additions, updates, targetNodeId, options) {
  if (additions.length === 0 && updates.length === 0) {
    return {
      applied: true,
      revision: requireBuilder(context.builder).getRevision(),
      proposal: {
        id: `${context.runId}:mutation:skipped`,
        status: "applied",
        title: options.title,
        summary: options.summary
      }
    };
  }
  return proposeAndMaybeApplyMutation(context, {
    title: options.title,
    summary: options.summary,
    targetNodeId,
    allowSkillDefinedDepth: true,
    changeSet: changeSet(context, {
      additions,
      updates: updates.map((update) => ({ id: `update_${update.nodeId}_${stableSnakeId(options.title, "excavation")}`, ...update })),
      ...options.assumptions ? { assumptions: options.assumptions } : {},
      ...options.warnings ? { warnings: options.warnings } : {}
    })
  });
}
function changeSet(context, input) {
  return {
    id: `changeset_${context.runId}_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    taskType: "generate_tree",
    backendId: context.getRun().request.providerId,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    additions: input.additions ?? [],
    updates: input.updates ?? [],
    deletions: input.deletions ?? [],
    edgeChanges: input.edgeChanges ?? [],
    assumptions: input.assumptions ?? [],
    questions: input.questions ?? [],
    warnings: input.warnings ?? []
  };
}
function addition(parentNodeId, node) {
  return {
    id: `add_${node.id}`,
    nodeId: node.id,
    parentNodeId,
    relation: node.relation ?? (node.formula || node.type === "calculated" ? "formula_dependency" : "positive_driver"),
    name: node.name,
    description: void 0,
    type: node.type,
    unit: node.unit,
    formula: node.formula,
    baselineValue: node.baselineValue,
    valueStatus: node.valueStatus,
    valueSource: node.valueSource,
    assumptions: node.assumptions,
    tags: node.tags
  };
}
function inputNode(id, name, unit) {
  return {
    id,
    name,
    type: "input",
    unit,
    status: "needs_data",
    valueStatus: "unknown",
    assumptions: ["Collect value through dialog; do not silently default."]
  };
}
function calculatedNode(id, name, unit) {
  return { id, name, type: "calculated", unit, valueStatus: "calculated", relation: "formula_dependency" };
}
function constantNode(id, name, unit, value) {
  return {
    id,
    name,
    type: "assumption",
    unit,
    baselineValue: value,
    valueStatus: "default_assumption",
    valueSource: {
      sourceTier: "fixed_time_conversion",
      confidence: "high",
      acceptedByUserInDialog: true,
      editableInDialog: false,
      note: "Fixed calendar conversion constant."
    },
    assumptions: ["Fixed conversion constant."]
  };
}
function downtimeCategoryNodes(includeReadiness) {
  const base = [
    inputNode("scheduled_non_excavation_time_h", "Scheduled non-excavation time", "h"),
    inputNode("technical_downtime_h", "Technical downtime", "h"),
    inputNode("technological_downtime_h", "Technological downtime", "h"),
    inputNode("organizational_downtime_h", "Organizational downtime", "h"),
    inputNode("relocation_or_move_time_h", "Relocation or move time", "h")
  ];
  if (!includeReadiness) {
    return [...base, inputNode("other_downtime_h", "Other downtime", "h")];
  }
  return [
    ...base,
    inputNode("material_or_face_not_ready_time_h", "Material or face not ready time", "h"),
    inputNode("drill_blast_waiting_or_restricted_access_time_h", "Drill/blast waiting or restricted access time", "h"),
    inputNode("operating_area_access_restriction_time_h", "Operating area access restriction time", "h"),
    inputNode("geotechnical_or_safety_restriction_time_h", "Geotechnical or safety restriction time", "h"),
    inputNode("other_downtime_h", "Other downtime", "h")
  ];
}
function downtimeCategoryFormula(nodeIds) {
  return nodeIds.join(" + ");
}
function defaultRootKpi(materialMode, scope, splitMode) {
  if (splitMode === "equipment_class") return "total_excavation_output";
  if (materialMode === "mixed_ore_tonnes_and_rock_m3") return "material_output_split";
  if (scope === "productivity") {
    return materialMode === "ore_tonnes" ? "ore_excavator_productivity_tph" : "rock_excavator_productivity_m3ph";
  }
  return materialMode === "ore_tonnes" ? "excavation_output" : "rock_excavation_output_solid_m3";
}
function defaultUnit(materialMode, scope) {
  if (materialMode === "mixed_ore_tonnes_and_rock_m3") return void 0;
  if (scope === "productivity") return materialMode === "ore_tonnes" ? "t/h" : "solid m3/h";
  return materialMode === "ore_tonnes" ? "t" : "solid m3";
}
function pendingResult(context, proposals) {
  const latest = context.store.getState(context.runId).pendingMutationProposal;
  return {
    applied: false,
    pendingMutationProposal: latest ? { id: latest.id, status: latest.status, title: latest.title } : void 0,
    proposals: proposals.map((proposal) => proposalSummary(proposal))
  };
}
function proposalSummary(proposal) {
  return {
    id: proposal.proposal.id,
    status: proposal.proposal.status,
    title: proposal.proposal.title,
    applied: proposal.applied
  };
}
async function suggestExcavationReference(nodeId, input = {}) {
  if (nodeId === "average_bucket_volume_m3" && input.equipmentAlias) {
    const equipment = await equipmentSuggestion(input.equipmentAlias);
    if (equipment) return equipment;
  }
  return defaultSuggestion(nodeId, input.materialKey);
}
async function equipmentSuggestion(alias) {
  const normalized = normalizeKey(alias);
  if (!["cat6020", "caterpillar6020", "cat_6020"].includes(normalized)) return null;
  await readReferenceFile("equipment-catalog.yaml");
  return {
    nodeId: "average_bucket_volume_m3",
    value: 12,
    unit: "m3",
    sourceTier: "equipment_model_specific_value",
    confidence: "medium",
    catalogRef: "references/equipment-catalog.yaml#excavators.cat_6020.bucket.nominal_volume_m3",
    assumptionStatus: "default_assumption",
    editableInDialog: true,
    acceptedByUserInDialog: false,
    referenceFile: "references/equipment-catalog.yaml"
  };
}
async function defaultSuggestion(nodeId, materialKey) {
  await readReferenceFile("excavation-defaults.yaml");
  const key = normalizeKey(materialKey ?? "");
  if (nodeId === "actual_bucket_fill_factor") {
    if (key.includes("average") || key.includes("blast") || !key) {
      return defaultReference(nodeId, 0.825, "ratio", [0.75, 0.9], "material_specific_industry_default", "low", "references/excavation-defaults.yaml#default_tables.actual_bucket_fill_factor.entries.average_blasted_rock");
    }
  }
  if (nodeId === "swell_factor") {
    const rock = key.includes("waste") || key.includes("rock");
    return defaultReference(nodeId, rock ? 1.65 : 1.6, "ratio_loose_to_bank", rock ? [1.5, 1.75] : [1.45, 1.7], "material_specific_industry_default", "low", `references/excavation-defaults.yaml#default_tables.swell_factor.entries.${rock ? "unknown_blasted_waste_rock" : "unknown_blasted_ore"}`);
  }
  if (nodeId === "buckets_per_truck") {
    return defaultReference(nodeId, 5, "buckets/truck", [3, 6], "generic_open_pit_excavation_default", "low", "references/excavation-defaults.yaml#default_tables.buckets_per_truck.entries.generic_open_pit_excavation_default");
  }
  if (nodeId === "bucket_cycle_time_sec") {
    const shovel = key.includes("hydraulic") ? "hydraulic_front_shovel" : "unknown_mining_excavator";
    return defaultReference(nodeId, shovel === "hydraulic_front_shovel" ? 29 : 30, "sec/bucket", shovel === "hydraulic_front_shovel" ? [25, 33] : [25, 35], "generic_open_pit_excavation_default", "low", `references/excavation-defaults.yaml#default_tables.bucket_cycle_time_sec.entries.${shovel}`);
  }
  return null;
}
function defaultReference(nodeId, value, unit, range, sourceTier, confidence, catalogRef) {
  return {
    nodeId,
    value,
    unit,
    range,
    sourceTier,
    confidence,
    catalogRef,
    assumptionStatus: "default_assumption",
    editableInDialog: true,
    acceptedByUserInDialog: false,
    referenceFile: catalogRef.split("#")[0].replace("references/", "references/")
  };
}
async function readReferenceFile(fileName) {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDir, "../../../vdt-agent/skills/mining/references", fileName),
    join(moduleDir, "../../vdt-agent-skills/mining/references", fileName),
    join(moduleDir, "vdt-agent-skills/mining/references", fileName)
  ];
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf8");
    } catch {
    }
  }
  throw new AgentToolError("REFERENCE_FILE_NOT_FOUND", `Excavation reference file "${fileName}" was not found.`);
}
function dialoguePolicySection(text, section) {
  if (section === "runtime_principles") {
    return {
      referenceFile: "references/excavation-dialogue-flow.yaml",
      interactionMode: scalarAfter(text, "interaction_mode"),
      noMissingInputsPanel: booleanAfter(text, "no_missing_inputs_panel"),
      topologyBeforeInputValues: booleanAfter(text, "topology_before_input_values"),
      maxQuestionsPerTurn: numberAfter(text, "max_questions_per_turn"),
      acceptedDefaultsStatus: scalarAfter(text, "store_accepted_defaults_as"),
      skippedValuesStatus: scalarAfter(text, "store_skipped_values_as"),
      readinessAccessAsDowntime: booleanAfter(text, "model_readiness_access_as_downtime"),
      noReadinessAccessMinCaps: booleanAfter(text, "do_not_create_readiness_access_min_caps")
    };
  }
  if (section === "topology_questions") {
    return {
      referenceFile: "references/excavation-dialogue-flow.yaml",
      topologyQuestionIds: listItemIds(text, "topology_question_bank"),
      maxQuestionsPerTurn: numberAfter(text, "max_questions_per_turn"),
      topologyOnlyBeforeValues: true
    };
  }
  if (section === "reference_lookup_policy") {
    return {
      referenceFile: "references/excavation-dialogue-flow.yaml",
      defaultsCatalogNodes: nestedList(text, "load_defaults_catalog_for_nodes"),
      equipmentCatalogNodes: nestedList(text, "load_equipment_catalog_for_nodes"),
      noReferenceDefaultsForNodes: nestedList(text, "no_reference_defaults_for_nodes"),
      loadOnlyActiveQuestionEntries: true
    };
  }
  if (section === "final_validation") {
    return {
      referenceFile: "references/excavation-dialogue-flow.yaml",
      requiredChecks: nestedList(text, "required_checks")
    };
  }
  return {
    referenceFile: "references/excavation-dialogue-flow.yaml",
    inputKpiQuestionOrder: nestedList(text, "input_kpi_question_order"),
    answerOptions: ["enter_custom_value", "use_suggested_reference_value_when_available", "leave_unknown_for_now"],
    valueStatuses: {
      customUserValue: "user_provided_value",
      acceptedCatalogSuggestion: "default_assumption",
      skippedOrUnknown: "unknown"
    }
  };
}
function scalarAfter(text, key) {
  return new RegExp(`\\n\\s*${key}:\\s*([^\\n]+)`).exec(`
${text}`)?.[1]?.trim();
}
function booleanAfter(text, key) {
  const value = scalarAfter(text, key);
  return value === "true" ? true : value === "false" ? false : void 0;
}
function numberAfter(text, key) {
  const value = Number(scalarAfter(text, key));
  return Number.isFinite(value) ? value : void 0;
}
function nestedList(text, key) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `${key}:`);
  if (start === -1) return [];
  const values = [];
  const baseIndent = leadingSpaces(lines[start]);
  for (const line of lines.slice(start + 1)) {
    if (line.trim() && leadingSpaces(line) <= baseIndent && !line.trim().startsWith("- ")) break;
    const item = /^\s*-\s+(.+)$/.exec(line)?.[1]?.trim();
    if (item) values.push(item);
  }
  return values;
}
function listItemIds(text, key) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `${key}:`);
  if (start === -1) return [];
  const values = [];
  const baseIndent = leadingSpaces(lines[start]);
  for (const line of lines.slice(start + 1)) {
    if (line.trim() && leadingSpaces(line) <= baseIndent) break;
    const item = /^\s*-\s+id:\s+(.+)$/.exec(line)?.[1]?.trim();
    if (item) values.push(item);
  }
  return values;
}
function leadingSpaces(value) {
  return value.match(/^\s*/)?.[0].length ?? 0;
}
function validateExcavationProject(project, options = {}) {
  const errors = [];
  const warnings = [];
  const nodeIds = new Set(project.graph.nodes.map((node) => node.id));
  const normalizedNodes = new Map(project.graph.nodes.map((node) => [normalizeKey(node.id), node]));
  const childrenByParent = /* @__PURE__ */ new Map();
  for (const edge of project.graph.edges) {
    childrenByParent.set(edge.sourceNodeId, [...childrenByParent.get(edge.sourceNodeId) ?? [], edge.targetNodeId]);
  }
  for (const forbidden of GLOBAL_FORBIDDEN_NODES) {
    if (nodeIds.has(forbidden) || normalizedNodes.has(normalizeKey(forbidden))) {
      errors.push(excavationWarning(`forbidden_${forbidden}`, `Forbidden excavation skill node present: ${forbidden}.`, forbidden));
    }
  }
  for (const node of project.graph.nodes) {
    const normalizedId = normalizeKey(node.id);
    const normalizedName = normalizeKey(node.name);
    const formula = normalizeFormula(node.formula ?? "");
    if ((normalizedId.includes("cap") || normalizedName.includes("cap")) && READINESS_ACCESS_TERMS.some((term) => normalizedId.includes(term) || normalizedName.includes(term))) {
      errors.push(excavationWarning(`readiness_cap_${node.id}`, "Readiness and access restrictions must be downtime categories, not cap nodes.", node.id));
    }
    if (formula.includes("min(") || /material.*readiness.*factor/.test(formula)) {
      errors.push(excavationWarning(`readiness_formula_${node.id}`, "Readiness and access restrictions must not be modeled as min caps or output multipliers.", node.id));
    }
    if (/(ktg|kio|availability|utilization).*coefficient/.test(normalizedId) || /(ktg|kio|availability|utilization).*coefficient/.test(formula)) {
      errors.push(excavationWarning(`coefficient_substitute_${node.id}`, "Do not substitute KTG/KIO/availability/utilization coefficients for explicit excavation time and downtime structure.", node.id));
    }
    if (/activexcavatorcount\*\(activexcavatorcount\*perioddays\*24-fleetdowntimeh\)\*excavatorproductivity/.test(formula)) {
      errors.push(excavationWarning(`double_count_${node.id}`, "Fleet downtime is multiplied by active excavator count twice.", node.id));
    }
    if (/oreexcavationoutputt\+rockexcavationoutputsolidm3|rockexcavationoutputsolidm3\+oreexcavationoutputt/.test(formula)) {
      errors.push(excavationWarning(`mixed_unit_sum_${node.id}`, "Ore tonnes and rock cubic meters cannot be summed without an explicit reporting convention.", node.id));
    }
  }
  for (const readinessNodeId of READINESS_DOWNTIME_NODE_IDS) {
    if (!nodeIds.has(readinessNodeId)) continue;
    const downtimeChildren = new Set(childrenByParent.get("downtime_per_excavator_h") ?? []);
    if (!downtimeChildren.has(readinessNodeId)) {
      errors.push(excavationWarning(`readiness_parent_${readinessNodeId}`, `${readinessNodeId} must sit under downtime_per_excavator_h.`, readinessNodeId));
    }
  }
  const hasFleetDowntime = nodeIds.has("fleet_downtime_h");
  const downtimeFormula = project.graph.nodes.find((node) => node.id === "downtime_per_excavator_h")?.formula;
  if (hasFleetDowntime && downtimeFormula !== "fleet_downtime_h / active_excavator_count") {
    warnings.push(excavationWarning("fleet_downtime_basis", "downtime basis is fleet total and must be converted or modeled as fleet net time", "downtime_per_excavator_h"));
  }
  const missingVisibleStatus = project.graph.nodes.filter(
    (node) => node.type === "input" && node.baselineValue === void 0 && node.valueStatus !== "unknown"
  );
  for (const node of missingVisibleStatus) {
    warnings.push(excavationWarning(`unknown_status_${node.id}`, "Missing numeric values should be visibly marked unknown.", node.id));
  }
  const requireCanonicalOutput = options.requireCanonicalOutputTopology === true || hasCanonicalExcavationOutputSignal(project, nodeIds);
  if (requireCanonicalOutput) {
    requireNodeSet(nodeIds, CANONICAL_OUTPUT_NODE_IDS, "canonical_output", errors);
    requireChildren(project.rootNodeId, ["active_excavator_count", "net_excavation_time_per_excavator_h", "excavator_productivity"], childrenByParent, errors);
    requireFormula(project, project.rootNodeId, "active_excavator_count * net_excavation_time_per_excavator_h * excavator_productivity", errors);
    requireChildren("net_excavation_time_per_excavator_h", ["calendar_time_per_excavator_h", "downtime_per_excavator_h"], childrenByParent, errors);
    requireChildren("calendar_time_per_excavator_h", ["period_days", "hours_per_day_24"], childrenByParent, errors);
    requireFormula(project, "calendar_time_per_excavator_h", "period_days * 24", errors);
    requireFormula(project, "net_excavation_time_per_excavator_h", "calendar_time_per_excavator_h - downtime_per_excavator_h", errors);
  }
  const requireProductivity = options.requireProductivityTopology === true || hasProductivitySignal(nodeIds);
  if (requireProductivity) {
    requireNodeSet(nodeIds, PRODUCTIVITY_NODE_IDS, "productivity", errors);
    const productivityParentId = nodeIds.has("excavator_productivity") ? "excavator_productivity" : project.rootNodeId;
    requireChildren(productivityParentId, ["loaded_trucks_per_hour", "material_per_truck"], childrenByParent, errors);
    requireFormula(project, productivityParentId, "loaded_trucks_per_hour * material_per_truck", errors);
    requireChildren("loaded_trucks_per_hour", ["minutes_per_hour_60", "truck_loading_time_min"], childrenByParent, errors);
    requireFormula(project, "loaded_trucks_per_hour", "60 / truck_loading_time_min", errors);
    requireNodeSet(nodeIds, TRUCK_LOADING_TIME_COMPONENT_NODE_IDS, "truck_loading_time", errors);
    requireChildren("truck_loading_time_min", TRUCK_LOADING_TIME_COMPONENT_NODE_IDS, childrenByParent, errors);
    requireFormula(project, "truck_loading_time_min", "loading_movement_unloading_time_min + face_breakdown_ripping_time_min + truck_departure_arrival_time_min + relocation_time_min", errors);
    requireFormula(project, "loading_movement_unloading_time_min", "buckets_per_truck * bucket_cycle_time_sec / 60", errors);
    const hasOreBranch = ORE_MATERIAL_BRANCH_NODE_IDS.every((nodeId) => nodeIds.has(nodeId));
    const hasRockBranch = ROCK_MATERIAL_BRANCH_NODE_IDS.every((nodeId) => nodeIds.has(nodeId));
    if (!hasOreBranch && !hasRockBranch) {
      errors.push(excavationWarning(
        "incomplete_material_per_truck_branch",
        "Excavation productivity must decompose material_per_truck into either the ore tonnes branch or the rock solid-volume branch.",
        "material_per_truck"
      ));
    }
    if (nodeIds.has("tonnes_per_truck") || !hasOreBranch && !hasRockBranch) {
      requireNodeSet(nodeIds, ORE_MATERIAL_BRANCH_NODE_IDS, "ore_material_branch", errors);
      requireChildren("material_per_truck", ["tonnes_per_truck"], childrenByParent, errors);
      requireChildren("tonnes_per_truck", ["buckets_per_truck", "tonnes_per_bucket"], childrenByParent, errors);
      requireChildren("tonnes_per_bucket", ["average_bucket_volume_m3", "ore_density_in_solid_t_per_m3", "swell_factor", "actual_bucket_fill_factor", "bucket_cycle_time_sec"], childrenByParent, errors);
      requireFormula(project, "material_per_truck", "tonnes_per_truck", errors);
      requireFormula(project, "tonnes_per_truck", "buckets_per_truck * tonnes_per_bucket", errors);
      requireFormula(project, "tonnes_per_bucket", "average_bucket_volume_m3 / swell_factor * actual_bucket_fill_factor * ore_density_in_solid_t_per_m3", errors);
    }
    if (nodeIds.has("rock_volume_per_truck_in_solid_m3")) {
      requireNodeSet(nodeIds, ROCK_MATERIAL_BRANCH_NODE_IDS, "rock_material_branch", errors);
      requireChildren("material_per_truck", ["rock_volume_per_truck_in_solid_m3"], childrenByParent, errors);
      requireChildren("rock_volume_per_truck_in_solid_m3", ["buckets_per_truck", "rock_volume_per_bucket_in_solid_m3"], childrenByParent, errors);
      requireChildren("rock_volume_per_bucket_in_solid_m3", ["average_bucket_volume_m3", "swell_factor", "actual_bucket_fill_factor", "bucket_cycle_time_sec"], childrenByParent, errors);
      requireFormula(project, "material_per_truck", "rock_volume_per_truck_in_solid_m3", errors);
      requireFormula(project, "rock_volume_per_truck_in_solid_m3", "buckets_per_truck * rock_volume_per_bucket_in_solid_m3", errors);
      requireFormula(project, "rock_volume_per_bucket_in_solid_m3", "average_bucket_volume_m3 / swell_factor * actual_bucket_fill_factor", errors);
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}
function hasCanonicalExcavationOutputSignal(project, nodeIds) {
  const root = project.graph.nodes.find((node) => node.id === project.rootNodeId);
  const rootKey = normalizeKey(`${root?.id ?? ""} ${root?.name ?? ""}`);
  const rootFormula = normalizeFormula(root?.formula ?? "");
  return rootKey.includes("excavation") || nodeIds.has("active_excavator_count") || nodeIds.has("net_excavation_time_per_excavator_h") || nodeIds.has("hydraulic_shovel_excavation_output") || rootFormula === normalizeFormula("active_excavator_count * net_excavation_time_per_excavator_h * excavator_productivity");
}
function hasProductivitySignal(nodeIds) {
  return [
    "excavator_productivity",
    "loaded_trucks_per_hour",
    "truck_loading_time_min",
    "material_per_truck",
    "tonnes_per_truck",
    "rock_volume_per_truck_in_solid_m3"
  ].some((nodeId) => nodeIds.has(nodeId));
}
function requireNodeSet(nodeIds, requiredNodeIds, scope, errors) {
  for (const nodeId of requiredNodeIds) {
    if (!nodeIds.has(nodeId)) {
      errors.push(excavationWarning(`missing_${scope}_${nodeId}`, `Required excavation skill node is missing: ${nodeId}.`, nodeId));
    }
  }
}
function requireChildren(parentNodeId, requiredChildIds, childrenByParent, errors) {
  const children = new Set(childrenByParent.get(parentNodeId) ?? []);
  for (const childId of requiredChildIds) {
    if (!children.has(childId)) {
      errors.push(excavationWarning(`missing_child_${parentNodeId}_${childId}`, `${parentNodeId} must decompose into ${childId}.`, parentNodeId));
    }
  }
}
function requireFormula(project, nodeId, expectedFormula, errors) {
  const node = project.graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return;
  if (normalizeFormula(node.formula ?? "") !== normalizeFormula(expectedFormula)) {
    errors.push(excavationWarning(
      `formula_${nodeId}`,
      `${nodeId} must use the excavation skill formula: ${expectedFormula}.`,
      nodeId
    ));
  }
}
function excavationWarning(id, message, nodeId) {
  return warning2({
    id: `excavation_${id}`,
    severity: id.startsWith("fleet_") || id.startsWith("unknown_") || id.startsWith("mixed_units") ? "warning" : "error",
    type: "invalid_graph",
    message,
    nodeId
  });
}
function normalizeKey(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function normalizeFormula(value) {
  return normalizeKey(value);
}
var GLOBAL_FORBIDDEN_NODES = [
  "truck_fleet_capacity",
  "truck_arrival_rate",
  "truck_queueing_time",
  "haul_route_cycle_time",
  "dispatch_match_factor",
  "dumping_capacity",
  "processing_throughput",
  "material_ready_for_excavation_cap",
  "operating_area_access_cap",
  "drilling_blasting_readiness_cap"
];
var READINESS_DOWNTIME_NODE_IDS = [
  "material_or_face_not_ready_time_h",
  "drill_blast_waiting_or_restricted_access_time_h",
  "operating_area_access_restriction_time_h",
  "geotechnical_or_safety_restriction_time_h"
];
var READINESS_ACCESS_TERMS = ["materialready", "facenotready", "access", "drillblast", "geotechnical", "safety"];
var CANONICAL_OUTPUT_NODE_IDS = [
  "active_excavator_count",
  "net_excavation_time_per_excavator_h",
  "calendar_time_per_excavator_h",
  "period_days",
  "hours_per_day_24",
  "downtime_per_excavator_h",
  "excavator_productivity"
];
var PRODUCTIVITY_NODE_IDS = [
  "loaded_trucks_per_hour",
  "minutes_per_hour_60",
  "truck_loading_time_min",
  "material_per_truck"
];
var TRUCK_LOADING_TIME_COMPONENT_NODE_IDS = [
  "loading_movement_unloading_time_min",
  "face_breakdown_ripping_time_min",
  "truck_departure_arrival_time_min",
  "relocation_time_min"
];
var ORE_MATERIAL_BRANCH_NODE_IDS = [
  "tonnes_per_truck",
  "buckets_per_truck",
  "tonnes_per_bucket",
  "average_bucket_volume_m3",
  "ore_density_in_solid_t_per_m3",
  "swell_factor",
  "actual_bucket_fill_factor",
  "bucket_cycle_time_sec"
];
var ROCK_MATERIAL_BRANCH_NODE_IDS = [
  "rock_volume_per_truck_in_solid_m3",
  "buckets_per_truck",
  "rock_volume_per_bucket_in_solid_m3",
  "average_bucket_volume_m3",
  "swell_factor",
  "actual_bucket_fill_factor",
  "bucket_cycle_time_sec"
];

// ../vdt-agent-runtime/src/tools/formula-tools.ts
var formulaParseTool = {
  name: "formula.parse",
  description: "Parse a formula and return references or a parse error.",
  inputSchema: external_exports.object({ formula: external_exports.string().min(1).max(500) }),
  outputSchema: external_exports.record(external_exports.unknown()),
  phase: "validating_graph",
  run(_context, input) {
    try {
      parseFormula(input.formula);
      return { valid: true, references: extractFormulaReferences(input.formula) };
    } catch (error2) {
      return {
        valid: false,
        references: [],
        error: error2 instanceof Error ? error2.message : "Formula could not be parsed."
      };
    }
  }
};
var formulaExtractReferencesTool = {
  name: "formula.extract_references",
  description: "Extract formula references from a parser-valid formula.",
  inputSchema: external_exports.object({ formula: external_exports.string().min(1).max(500) }),
  outputSchema: external_exports.record(external_exports.unknown()),
  phase: "validating_graph",
  run(_context, input) {
    try {
      return { references: extractFormulaReferences(input.formula) };
    } catch {
      return { references: [] };
    }
  }
};
var formulaCheckReferencesTool = {
  name: "formula.check_references",
  description: "Check formula references against the current draft node ids.",
  inputSchema: external_exports.object({
    formula: external_exports.string().min(1).max(500),
    nodeId: external_exports.string().max(160).optional()
  }),
  outputSchema: external_exports.record(external_exports.unknown()),
  phase: "validating_graph",
  run(context, input) {
    const project = context.builder?.getProject() ?? context.store.getSnapshot(context.runId).draftProject;
    const availableNodeIds = project?.graph.nodes.map((node) => node.id) ?? [];
    let references = [];
    let parseError;
    try {
      references = extractFormulaReferences(input.formula);
    } catch (error2) {
      parseError = error2 instanceof Error ? error2.message : "Formula could not be parsed.";
    }
    const available = new Set(availableNodeIds);
    const missingReferences = references.filter((reference) => !available.has(reference));
    return {
      valid: !parseError && missingReferences.length === 0,
      references,
      missingReferences,
      availableNodeIds,
      similarNodeIds: Object.fromEntries(missingReferences.map((reference) => [reference, similarNodeIds(reference, availableNodeIds)])),
      ...input.nodeId ? { nodeId: input.nodeId } : {},
      ...parseError ? { error: parseError } : {}
    };
  }
};
var formulaRenameReferenceTool = {
  name: "formula.rename_reference",
  description: "Rename one formula reference token deterministically.",
  inputSchema: external_exports.object({
    formula: external_exports.string().min(1).max(500),
    from: external_exports.string().min(1).max(160),
    to: external_exports.string().min(1).max(160)
  }),
  outputSchema: external_exports.record(external_exports.unknown()),
  phase: "repairing_graph",
  run(_context, input) {
    const pattern = new RegExp(`\\b${escapeRegExp(input.from)}\\b`, "g");
    const formula = input.formula.replace(pattern, input.to);
    return { formula, changed: formula !== input.formula };
  }
};
var formulaSuggestReferenceRepairTool = {
  name: "formula.suggest_reference_repair",
  description: "Suggest existing node ids for a missing formula reference using deterministic string similarity.",
  inputSchema: external_exports.object({
    missingReference: external_exports.string().min(1).max(160),
    availableNodeIds: external_exports.array(external_exports.string().max(160)).max(200).optional()
  }),
  outputSchema: external_exports.record(external_exports.unknown()),
  phase: "repairing_graph",
  run(context, input) {
    const project = context.builder?.getProject() ?? context.store.getSnapshot(context.runId).draftProject;
    const availableNodeIds = input.availableNodeIds ?? project?.graph.nodes.map((node) => node.id) ?? [];
    return {
      suggestions: similarNodeIds(input.missingReference, availableNodeIds).map((nodeId) => ({
        nodeId,
        confidence: similarity(input.missingReference, nodeId),
        reason: `Node id is similar to missing reference "${input.missingReference}".`
      }))
    };
  }
};
function similarNodeIds(reference, availableNodeIds) {
  return availableNodeIds.map((nodeId) => ({ nodeId, score: similarity(reference, nodeId) })).filter((entry) => entry.score > 0.2).sort((a, b) => b.score - a.score || a.nodeId.localeCompare(b.nodeId)).slice(0, 5).map((entry) => entry.nodeId);
}
function similarity(left, right) {
  if (left === right) return 1;
  const leftParts = new Set(left.toLowerCase().split(/[_\W]+/).filter(Boolean));
  const rightParts = new Set(right.toLowerCase().split(/[_\W]+/).filter(Boolean));
  const intersection = [...leftParts].filter((part) => rightParts.has(part)).length;
  const union = (/* @__PURE__ */ new Set([...leftParts, ...rightParts])).size || 1;
  const tokenScore = intersection / union;
  const prefixScore = right.startsWith(left) || left.startsWith(right) ? 0.5 : 0;
  return Math.max(tokenScore, prefixScore);
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ../vdt-agent-runtime/src/tools/memory-tools.ts
var getRecentEventsTool = {
  name: "memory.get_recent_events",
  description: "Read recent agent event summaries.",
  inputSchema: external_exports.object({ limit: external_exports.number().int().min(1).max(50).optional() }),
  outputSchema: external_exports.record(external_exports.unknown()),
  phase: "planning_decomposition",
  run(context, input) {
    return { events: summarizeEvents(context.store.getState(context.runId).events, input.limit ?? 30) };
  }
};
var getUserAnswersTool = {
  name: "memory.get_user_answers",
  description: "Read user answers collected during this run.",
  inputSchema: external_exports.object({}),
  outputSchema: external_exports.record(external_exports.unknown()),
  phase: "planning_decomposition",
  run(context) {
    return { answers: context.store.getState(context.runId).answers };
  }
};
var getManualChangesTool = {
  name: "memory.get_manual_changes",
  description: "Read recent manual project changes observed during this run.",
  inputSchema: external_exports.object({ limit: external_exports.number().int().min(1).max(50).optional() }),
  outputSchema: external_exports.record(external_exports.unknown()),
  phase: "planning_decomposition",
  run(context, input) {
    return { manualChanges: summarizeManualChanges(context.store.getState(context.runId), input.limit ?? 20) };
  }
};
var addNoteTool = {
  name: "memory.add_note",
  description: "Store a concise, user-safe note for this run.",
  inputSchema: external_exports.object({
    note: external_exports.string().min(1).max(500),
    tags: external_exports.array(external_exports.string().min(1).max(40)).max(10).optional()
  }),
  outputSchema: external_exports.object({ ok: external_exports.literal(true) }),
  phase: "planning_decomposition",
  run(context, input) {
    const state = context.store.getState(context.runId);
    context.store.updateRun(context.runId, {
      memoryNotes: [
        ...state.memoryNotes,
        {
          note: input.note,
          tags: input.tags ?? [],
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      ].slice(-50)
    });
    return { ok: true };
  }
};

// ../vdt-agent-runtime/src/tools/project-tools.ts
var getCurrentProjectTool = {
  name: "project.get_current",
  description: "Read the compact current project summary.",
  inputSchema: external_exports.object({}),
  outputSchema: external_exports.record(external_exports.unknown()),
  phase: "planning_decomposition",
  run(context) {
    const project = currentProject(context);
    return { project: project ? summarizeProject(project) : null };
  }
};
var readCurrentProjectTool = {
  name: "project.read_current",
  description: "Legacy alias for project.get_current.",
  inputSchema: external_exports.object({}),
  outputSchema: external_exports.record(external_exports.unknown()),
  phase: "planning_decomposition",
  run(context) {
    const project = currentProject(context);
    return { project: project ? summarizeProject(project) : null };
  }
};
var getSelectedNodeTool = {
  name: "project.get_selected_node",
  description: "Read the selected node with compact parent and child summaries.",
  inputSchema: external_exports.object({}),
  outputSchema: external_exports.record(external_exports.unknown()),
  phase: "planning_decomposition",
  run(context) {
    const project = requireProject(context);
    const selectedNodeId = context.store.getState(context.runId).request.input.selectedNodeId;
    if (!selectedNodeId) return { node: null, children: [], parents: [] };
    return nodeNeighborhood(project, selectedNodeId);
  }
};
var getNodeTool = {
  name: "project.get_node",
  description: "Read one node with compact parent, child, and formula reference context.",
  inputSchema: external_exports.object({
    nodeId: external_exports.string().min(1).max(160)
  }),
  outputSchema: external_exports.record(external_exports.unknown()),
  phase: "planning_decomposition",
  run(context, input) {
    return nodeNeighborhood(requireProject(context), input.nodeId);
  }
};
var getSubtreeTool = {
  name: "project.get_subtree",
  description: "Read a compact subtree under a node.",
  inputSchema: external_exports.object({
    rootNodeId: external_exports.string().min(1).max(160),
    depth: external_exports.number().int().min(1).max(6).optional()
  }),
  outputSchema: external_exports.record(external_exports.unknown()),
  phase: "planning_decomposition",
  run(context, input) {
    const project = requireProject(context);
    const maxDepth = input.depth ?? 2;
    const included = /* @__PURE__ */ new Set([input.rootNodeId]);
    let frontier = [input.rootNodeId];
    for (let depth = 0; depth < maxDepth; depth += 1) {
      const next = [];
      for (const nodeId of frontier) {
        for (const edge of project.graph.edges.filter((candidate) => candidate.sourceNodeId === nodeId)) {
          if (!included.has(edge.targetNodeId)) {
            included.add(edge.targetNodeId);
            next.push(edge.targetNodeId);
          }
        }
      }
      frontier = next;
    }
    const filtered = {
      ...project,
      graph: {
        nodes: project.graph.nodes.filter((node) => included.has(node.id)),
        edges: project.graph.edges.filter((edge) => included.has(edge.sourceNodeId) && included.has(edge.targetNodeId))
      }
    };
    return { subtree: summarizeProject(filtered, 60) };
  }
};
var getRecentManualChangesTool = {
  name: "project.get_recent_manual_changes",
  description: "Read recent user-originated manual changes observed by the agent.",
  inputSchema: external_exports.object({
    limit: external_exports.number().int().min(1).max(50).optional()
  }),
  outputSchema: external_exports.record(external_exports.unknown()),
  phase: "planning_decomposition",
  run(context, input) {
    return { manualChanges: summarizeManualChanges(context.store.getState(context.runId), input.limit ?? 20) };
  }
};
var observeManualChangeTool = {
  name: "project.observe_manual_change",
  description: "Record a user-originated manual project change in agent context.",
  inputSchema: external_exports.object({
    kind: external_exports.string().min(1).max(120),
    nodeId: external_exports.string().max(160).optional(),
    edgeId: external_exports.string().max(160).optional(),
    summary: external_exports.string().max(500).optional()
  }),
  outputSchema: external_exports.object({ observed: external_exports.boolean() }),
  phase: "planning_decomposition",
  run(context, input) {
    context.store.observeManualChange(context.runId, {
      change: {
        kind: input.kind,
        nodeId: input.nodeId,
        edgeId: input.edgeId,
        summary: input.summary
      }
    });
    return { observed: true };
  }
};
function currentProject(context) {
  const snapshot = context.store.getSnapshot(context.runId);
  return context.builder?.getProject() ?? snapshot.draftProject ?? snapshot.project;
}
function requireProject(context) {
  const project = currentProject(context);
  if (!project) throw new AgentToolError("NO_DRAFT_PROJECT", "No draft project is available.");
  return project;
}
function nodeNeighborhood(project, nodeId) {
  const node = summarizeNode(project, nodeId);
  if (!node) throw new AgentToolError("NODE_NOT_FOUND", `Node "${nodeId}" was not found.`);
  const children = project.graph.edges.filter((edge) => edge.sourceNodeId === nodeId).map((edge) => summarizeNode(project, edge.targetNodeId)).filter((summary3) => Boolean(summary3));
  const parents = project.graph.edges.filter((edge) => edge.targetNodeId === nodeId).map((edge) => summarizeNode(project, edge.sourceNodeId)).filter((summary3) => Boolean(summary3));
  const formulasReferencingNode = project.graph.nodes.filter((candidate) => {
    if (!candidate.formula) return false;
    try {
      return extractFormulaReferences(candidate.formula).includes(nodeId);
    } catch {
      return false;
    }
  }).map((candidate) => candidate.id);
  return { node, children, parents, formulasReferencingNode };
}

// ../vdt-agent-runtime/src/tools/repair-tools.ts
var edgeRelationSchema = external_exports.enum([
  "positive_driver",
  "negative_driver",
  "multiplicative_driver",
  "divisive_driver",
  "additive_component",
  "subtractive_component",
  "contextual_influence",
  "formula_dependency"
]);
var repairMissingFormulaReferenceTool = {
  name: "vdt.repair_missing_formula_reference",
  description: "Repair one missing formula reference by renaming, creating an input node, or neutralizing the reference.",
  inputSchema: external_exports.object({
    nodeId: external_exports.string().min(1).max(160),
    missingReference: external_exports.string().min(1).max(160),
    strategy: external_exports.enum(["rename_to_existing", "create_input_node", "remove_reference"]),
    replacementNodeId: external_exports.string().max(160).optional(),
    newNode: external_exports.object({
      parentNodeId: external_exports.string().min(1).max(160),
      nodeId: external_exports.string().min(1).max(160),
      name: external_exports.string().min(1).max(200),
      unit: external_exports.string().max(80).optional(),
      baselineValue: external_exports.number().finite().optional()
    }).optional()
  }),
  outputSchema: external_exports.record(external_exports.unknown()),
  mutatesProject: true,
  requiresDraftProject: true,
  phase: "repairing_graph",
  run(context, input) {
    const builder = context.builder;
    if (!builder) throw new AgentToolError("NO_DRAFT_PROJECT", "VDT builder session is not available for this run.");
    let project = builder.getProject();
    const node = project.graph.nodes.find((candidate) => candidate.id === input.nodeId);
    if (!node) throw new AgentToolError("NODE_NOT_FOUND", `Node "${input.nodeId}" was not found.`);
    if (!node.formula) throw new AgentToolError("FORMULA_NOT_FOUND", `Node "${input.nodeId}" does not have a formula.`);
    let formula = node.formula;
    let addedNodeId;
    const previewBuilder = cloneBuilder(context);
    const changeSets = [];
    if (input.strategy === "rename_to_existing") {
      if (!input.replacementNodeId) {
        throw new AgentToolError("REPLACEMENT_REQUIRED", "replacementNodeId is required for rename_to_existing.");
      }
      if (!project.graph.nodes.some((candidate) => candidate.id === input.replacementNodeId)) {
        throw new AgentToolError("REPLACEMENT_NOT_FOUND", `Replacement node "${input.replacementNodeId}" was not found.`);
      }
      formula = renameReference(formula, input.missingReference, input.replacementNodeId);
    } else if (input.strategy === "create_input_node") {
      if (!input.newNode) throw new AgentToolError("NEW_NODE_REQUIRED", "newNode is required for create_input_node.");
      if (!project.graph.nodes.some((candidate) => candidate.id === input.newNode.parentNodeId)) {
        throw new AgentToolError("PARENT_NOT_FOUND", `Parent node "${input.newNode.parentNodeId}" was not found.`);
      }
      if (!project.graph.nodes.some((candidate) => candidate.id === input.newNode.nodeId)) {
        const added = previewBuilder.addDriver({
          parentNodeId: input.newNode.parentNodeId,
          nodeId: input.newNode.nodeId,
          name: input.newNode.name,
          type: "input",
          unit: input.newNode.unit,
          relation: "formula_dependency",
          baselineValue: input.newNode.baselineValue
        });
        changeSets.push(requireChangeSet(added.changeSet));
        addedNodeId = added.changeSet?.additions[0]?.nodeId ?? input.newNode.nodeId;
      }
      formula = input.newNode.nodeId === input.missingReference ? formula : renameReference(formula, input.missingReference, input.newNode.nodeId);
    } else {
      formula = renameReference(formula, input.missingReference, "1");
    }
    project = previewBuilder.getProject();
    const available = new Set(project.graph.nodes.map((candidate) => candidate.id));
    const stillMissing = extractFormulaReferences(formula).filter((reference) => !available.has(reference));
    if (stillMissing.length > 0) {
      throw new AgentToolError("MISSING_FORMULA_REFERENCES", `Repair still leaves missing references: ${stillMissing.join(", ")}.`, {
        missingReferences: stillMissing
      });
    }
    const result = previewBuilder.setFormula({ nodeId: input.nodeId, formula });
    changeSets.push(requireChangeSet(result.changeSet));
    context.emit({
      type: "repair_started",
      phase: "repairing_graph",
      title: "Formula reference repaired",
      message: `Repaired missing reference "${input.missingReference}" on "${input.nodeId}".`,
      metadata: { strategy: input.strategy, nodeId: input.nodeId, addedNodeId }
    });
    const mutation = proposeAndMaybeApplyMutation(context, {
      source: "repair",
      title: "Formula repair applied",
      summary: result.event.message,
      changeSet: combineChangeSets(changeSets, context),
      targetNodeId: input.nodeId
    });
    return {
      repaired: true,
      strategy: input.strategy,
      nodeId: input.nodeId,
      formula,
      addedNodeId,
      revision: mutation.revision,
      validation: mutation.validation,
      mutationProposal: { id: mutation.proposal.id, status: mutation.proposal.status }
    };
  }
};
var repairOrphanNodeTool = {
  name: "vdt.repair_orphan_node",
  description: "Attach an orphan node to an existing node with a new edge.",
  inputSchema: external_exports.object({
    nodeId: external_exports.string().min(1).max(160),
    attachToNodeId: external_exports.string().min(1).max(160),
    relation: edgeRelationSchema
  }),
  outputSchema: external_exports.record(external_exports.unknown()),
  mutatesProject: true,
  requiresDraftProject: true,
  phase: "repairing_graph",
  run(context, input) {
    const builder = context.builder;
    if (!builder) throw new AgentToolError("NO_DRAFT_PROJECT", "VDT builder session is not available for this run.");
    const previewBuilder = cloneBuilder(context);
    const result = previewBuilder.addEdge({
      sourceNodeId: input.attachToNodeId,
      targetNodeId: input.nodeId,
      relation: input.relation
    });
    const mutation = proposeAndMaybeApplyMutation(context, {
      source: "repair",
      title: "Orphan node attached",
      summary: result.event.message,
      changeSet: requireChangeSet(result.changeSet),
      targetNodeId: input.attachToNodeId
    });
    return {
      repaired: true,
      revision: mutation.revision,
      validation: mutation.validation,
      mutationProposal: { id: mutation.proposal.id, status: mutation.proposal.status }
    };
  }
};
var repairDuplicateNodeIdTool = {
  name: "vdt.repair_duplicate_node_id",
  description: "Rename one node id and optionally update formula references.",
  inputSchema: external_exports.object({
    nodeId: external_exports.string().min(1).max(160),
    newNodeId: external_exports.string().min(1).max(160),
    updateFormulaReferences: external_exports.boolean().optional()
  }),
  outputSchema: external_exports.record(external_exports.unknown()),
  mutatesProject: true,
  requiresDraftProject: true,
  phase: "repairing_graph",
  run(context, input) {
    const builder = context.builder;
    if (!builder) throw new AgentToolError("NO_DRAFT_PROJECT", "VDT builder session is not available for this run.");
    const project = builder.getProject();
    if (!project.graph.nodes.some((node) => node.id === input.nodeId)) {
      throw new AgentToolError("NODE_NOT_FOUND", `Node "${input.nodeId}" was not found.`);
    }
    if (project.graph.nodes.some((node) => node.id === input.newNodeId)) {
      throw new AgentToolError("NODE_ID_EXISTS", `Node "${input.newNodeId}" already exists.`);
    }
    const target = project.graph.nodes.find((node) => node.id === input.nodeId);
    const previewBuilder = cloneBuilder(context);
    const changeSets = [];
    const deleted = previewBuilder.deleteNode({ nodeId: input.nodeId, cascadeEdges: true });
    changeSets.push(requireChangeSet(deleted.changeSet));
    const parentEdge = project.graph.edges.find((edge) => edge.targetNodeId === input.nodeId);
    const parentNodeId = parentEdge?.sourceNodeId ?? project.rootNodeId;
    const added = previewBuilder.addDriver({
      parentNodeId,
      nodeId: input.newNodeId,
      name: target.name,
      type: target.type,
      unit: target.unit,
      relation: parentEdge?.relation ?? "positive_driver",
      formula: target.formula,
      baselineValue: target.baselineValue,
      description: target.description,
      assumptions: target.assumptions
    });
    changeSets.push(requireChangeSet(added.changeSet));
    if (input.updateFormulaReferences === true) {
      for (const node of previewBuilder.getProject().graph.nodes) {
        if (!node.formula?.includes(input.nodeId)) continue;
        const updated = previewBuilder.updateNode({
          nodeId: node.id,
          patch: { formula: renameReference(node.formula, input.nodeId, input.newNodeId) }
        });
        changeSets.push(requireChangeSet(updated.changeSet));
      }
    }
    const mutation = proposeAndMaybeApplyMutation(context, {
      source: "repair",
      title: "Duplicate node id repaired",
      summary: `Renamed "${input.nodeId}" to "${input.newNodeId}".`,
      changeSet: combineChangeSets(changeSets, context),
      targetNodeId: parentNodeId
    });
    return {
      repaired: true,
      oldNodeId: input.nodeId,
      newNodeId: input.newNodeId,
      revision: mutation.revision,
      validation: mutation.validation,
      mutationProposal: { id: mutation.proposal.id, status: mutation.proposal.status }
    };
  }
};
function renameReference(formula, from, to) {
  return formula.replace(new RegExp(`\\b${escapeRegExp2(from)}\\b`, "g"), to);
}
function escapeRegExp2(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ../vdt-agent-runtime/src/tools/research-tools.ts
var researchPurposeSchema = external_exports.enum(["best_practices", "process_components", "benchmarks", "standards", "regulations"]);
var researchSearchResultSchema = external_exports.object({
  id: external_exports.string().min(1).max(200),
  title: external_exports.string().min(1).max(300),
  url: external_exports.string().url().optional(),
  sourceName: external_exports.string().min(1).max(160).optional(),
  snippet: external_exports.string().min(1).max(1500),
  retrievedAt: external_exports.string().min(1).max(80)
});
var candidateDriverSchema = external_exports.object({
  id: external_exports.string().min(1).max(160),
  name: external_exports.string().min(1).max(200),
  driverType: external_exports.enum(["volume", "time", "rate", "quality", "mix", "yield", "capacity", "cost", "constraint", "external"]),
  expectedUnit: external_exports.string().max(80).optional(),
  formulaHint: external_exports.string().max(500).optional(),
  confidence: external_exports.number().min(0).max(1),
  sourceIds: external_exports.array(external_exports.string().max(160)).max(20)
});
var extractProcessDriversTool = {
  name: "research.extract_process_drivers",
  description: "Extract candidate VDT drivers from a skill markdown excerpt, process description, or user-provided process notes.",
  inputSchema: external_exports.object({
    rootKpi: external_exports.string().min(1).max(200),
    industry: external_exports.string().max(120).optional(),
    processDescription: external_exports.string().min(1).max(6e3),
    sourceIds: external_exports.array(external_exports.string().max(160)).max(20).optional()
  }),
  outputSchema: external_exports.record(external_exports.unknown()),
  phase: "planning_decomposition",
  run(_context, input) {
    const sourceIds = input.sourceIds?.length ? input.sourceIds : ["process_description"];
    const candidateDrivers = extractCandidateDrivers(input.processDescription, sourceIds);
    return {
      candidateDrivers,
      missingClarifications: missingClarifications(input.rootKpi, candidateDrivers, input.processDescription)
    };
  }
};
var proposeDecompositionTool = {
  name: "research.propose_decomposition",
  description: "Propose a small first-layer VDT decomposition from candidate process drivers.",
  inputSchema: external_exports.object({
    rootKpi: external_exports.string().min(1).max(200),
    candidateDrivers: external_exports.array(candidateDriverSchema).min(1).max(30),
    maxFirstLevelDrivers: external_exports.number().int().min(1).max(8).optional()
  }),
  outputSchema: external_exports.record(external_exports.unknown()),
  phase: "planning_decomposition",
  run(_context, input) {
    const maxDrivers = input.maxFirstLevelDrivers ?? 6;
    const firstLevelDrivers = [...input.candidateDrivers].sort((a, b) => b.confidence - a.confidence).slice(0, maxDrivers);
    return {
      firstLevelDrivers,
      formulaCandidates: proposeFormulaCandidates(input.rootKpi, firstLevelDrivers),
      assumptions: [
        "Candidate decomposition is deterministic from provided text and must be validated against user context before finalizing."
      ],
      questions: questionsForCandidateGaps(input.rootKpi, firstLevelDrivers)
    };
  }
};
function extractCandidateDrivers(text, sourceIds) {
  const normalized = text.toLowerCase();
  const drivers = [];
  addIfMatched(drivers, normalized, sourceIds, ["time", "hours", "shift", "downtime", "delay", "availability"], {
    id: "working_time",
    name: "Working time",
    driverType: "time",
    expectedUnit: "hours",
    formulaHint: "scheduled_time - planned_downtime - unplanned_downtime",
    confidence: 0.82
  });
  addIfMatched(drivers, normalized, sourceIds, ["rate", "productivity", "throughput", "capacity", "tph", "per hour"], {
    id: "process_rate",
    name: "Process rate",
    driverType: "rate",
    expectedUnit: "units/hour",
    confidence: 0.78
  });
  addIfMatched(drivers, normalized, sourceIds, ["yield", "recovery", "loss", "quality", "factor"], {
    id: "yield_factor",
    name: "Yield factor",
    driverType: "yield",
    confidence: 0.72
  });
  addIfMatched(drivers, normalized, sourceIds, ["mix", "allocation", "share", "ore", "waste", "material"], {
    id: "material_mix",
    name: "Material mix",
    driverType: "mix",
    confidence: 0.7
  });
  addIfMatched(drivers, normalized, sourceIds, ["constraint", "bottleneck", "limit", "readiness", "availability"], {
    id: "constraint_or_bottleneck",
    name: "Constraint or bottleneck",
    driverType: "constraint",
    confidence: 0.74
  });
  if (drivers.length === 0) {
    drivers.push({
      id: "process_driver_logic",
      name: "Process driver logic",
      driverType: "external",
      confidence: 0.35,
      sourceIds
    });
  }
  return drivers;
}
function addIfMatched(drivers, text, sourceIds, terms, driver) {
  if (!terms.some((term) => text.includes(term))) return;
  drivers.push({ ...driver, sourceIds });
}
function missingClarifications(rootKpi, drivers, text) {
  const clarifications = [];
  if (!/\b(day|week|month|quarter|year|shift|period)\b/i.test(text)) {
    clarifications.push(`What time period should "${rootKpi}" use?`);
  }
  if (!/\b(unit|tonnes|hours|usd|percent|m3|bcm|rate)\b/i.test(text)) {
    clarifications.push(`What unit should "${rootKpi}" use?`);
  }
  if (drivers.some((driver) => driver.confidence < 0.5)) {
    clarifications.push("What are the first-level process components and formula boundary?");
  }
  return clarifications;
}
function proposeFormulaCandidates(rootKpi, drivers) {
  const hasTime = drivers.some((driver) => driver.driverType === "time");
  const hasRate = drivers.some((driver) => driver.driverType === "rate");
  const hasYield = drivers.some((driver) => driver.driverType === "yield");
  if (hasTime && hasRate && hasYield) {
    return [{ targetNodeId: stableId(rootKpi), formula: "working_time * process_rate * yield_factor", confidence: 0.72 }];
  }
  if (hasTime && hasRate) {
    return [{ targetNodeId: stableId(rootKpi), formula: "working_time * process_rate", confidence: 0.66 }];
  }
  return [];
}
function questionsForCandidateGaps(rootKpi, drivers) {
  if (drivers.length > 1 && drivers.every((driver) => driver.confidence >= 0.65)) return [];
  return [{
    id: "process_decomposition_boundary",
    question: `What are the main process components that drive ${rootKpi}?`,
    reason: "The available skill/research context is not enough to build a faithful first layer.",
    required: true,
    expectedAnswerType: "text"
  }];
}
function stableId(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "root";
}

// ../vdt-agent/src/index.ts
import { dirname as dirname2, join as join2 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// ../vdt-agent/src/skill-questions.ts
function buildCriticalQuestions(request, selectedSkills = []) {
  const questions = [];
  const skillIds = new Set(selectedSkills.map((skill) => skill.id));
  const haystack = [request.rootKpi, request.industry ?? "", request.businessContext ?? "", request.goal ?? ""].join(" ").toLowerCase();
  const rootLooksFlow = /volume|throughput|revenue|profit|mrr|arr|rate|flow|tonnes|tons|sales|production/.test(haystack);
  if (!request.unit?.trim()) {
    questions.push({
      id: "unit",
      question: "What unit should the root KPI use?",
      reason: "The builder needs a root unit before creating formulas and validation warnings.",
      required: true,
      expectedAnswerType: "text"
    });
  }
  if (!request.timePeriod?.trim() && rootLooksFlow) {
    questions.push({
      id: "timePeriod",
      question: "What time period should the KPI use?",
      reason: "Flow and rate KPIs need a period so driver units stay consistent.",
      required: true,
      expectedAnswerType: "text",
      defaultValue: "monthly"
    });
  }
  if ((skillIds.has("mining.production_volume") || /mine|mining|ore|haulage|truck/.test(haystack)) && !/bottleneck|haulage|truck|crusher|plant|loading|dump/.test(haystack)) {
    questions.push({
      id: "bottleneck",
      question: "Which operational bottleneck should the production tree emphasize?",
      reason: "Mining production volume trees depend on the controlling constraint.",
      required: true,
      expectedAnswerType: "single_choice",
      options: ["haulage", "loading", "processing", "dumping"]
    });
  }
  if (skillIds.has("finance.revenue_profit") && !/revenue|gross profit|operating profit|ebitda|net profit/.test(haystack)) {
    questions.push({
      id: "profitScope",
      question: "Is the target revenue, gross profit, operating profit, EBITDA, or net profit?",
      reason: "Financial trees need the profit scope before subtracting cost layers.",
      required: true,
      expectedAnswerType: "single_choice",
      options: ["revenue", "gross profit", "operating profit", "EBITDA", "net profit"]
    });
  }
  if (skillIds.has("saas.funnel_growth") && !/mrr|arr|nrr|active customers|retention/.test(haystack)) {
    questions.push({
      id: "recurringRevenueMetric",
      question: "Is the SaaS target ARR, MRR, active customers, or net revenue retention?",
      reason: "SaaS recipes branch differently for recurring revenue, customer counts, and retention.",
      required: true,
      expectedAnswerType: "single_choice",
      options: ["MRR", "ARR", "active customers", "net revenue retention"]
    });
  }
  return questions.slice(0, 5);
}

// ../vdt-agent/src/skill-recipe.ts
var RECIPE_TEMPLATES = {
  "mining.excavation": {
    skillId: "mining.excavation",
    requiredInputs: [
      "target_kpi_and_unit",
      "equipment_scope_and_active_count",
      "period_days",
      "downtime_basis_and_categories",
      "productivity_material_mode",
      "bucket_truck_loading_inputs"
    ],
    initialDrivers: [
      {
        id: "active_excavator_count",
        name: "Active excavator count",
        type: "input",
        unit: "excavators",
        relation: "multiplicative_driver",
        assumptions: ["Collect through dialog; leave unknown until provided."]
      },
      {
        id: "net_excavation_time_per_excavator_h",
        name: "Net excavation time per excavator",
        type: "calculated",
        unit: "h",
        relation: "multiplicative_driver"
      },
      {
        id: "excavator_productivity",
        name: "Excavator productivity",
        type: "calculated",
        relation: "multiplicative_driver"
      }
    ],
    formulaTemplates: [
      { targetNodeId: "root", formula: "active_excavator_count * net_excavation_time_per_excavator_h * excavator_productivity" },
      { targetNodeId: "calendar_time_per_excavator_h", formula: "period_days * hours_per_day_24" },
      { targetNodeId: "net_excavation_time_per_excavator_h", formula: "calendar_time_per_excavator_h - downtime_per_excavator_h" },
      { targetNodeId: "loaded_trucks_per_hour", formula: "minutes_per_hour_60 / truck_loading_time_min" },
      { targetNodeId: "truck_loading_time_min", formula: "loading_movement_unloading_time_min + face_breakdown_ripping_time_min + truck_departure_arrival_time_min + relocation_time_min" },
      { targetNodeId: "ore_excavator_productivity_tph", formula: "loaded_trucks_per_hour * tonnes_per_truck" },
      { targetNodeId: "rock_excavator_productivity_m3ph", formula: "loaded_trucks_per_hour * rock_volume_per_truck_in_solid_m3" }
    ],
    deepenRules: [
      {
        nodeId: "net_excavation_time_per_excavator_h",
        suggestedDrivers: ["calendar_time_per_excavator_h", "downtime_per_excavator_h"],
        guidance: "Model material readiness, drill/blast waits, access, geotechnical, and safety restrictions as downtime categories only."
      },
      {
        nodeId: "excavator_productivity",
        suggestedDrivers: ["loaded_trucks_per_hour", "material_per_truck"],
        guidance: "Keep the branch excavation-only; trucks are a loading container, not a haulage cycle tree."
      }
    ],
    warnings: [
      "Build topology with unknown numeric leaves before suggesting defaults.",
      "Accepted catalog values must be marked default_assumption.",
      "Do not model readiness or access limits as caps, min branches, or multipliers."
    ]
  },
  "mining.production_volume": {
    skillId: "mining.production_volume",
    requiredInputs: ["unit", "timePeriod", "bottleneck"],
    initialDrivers: [
      { id: "effective_working_time", name: "Effective working time", type: "calculated", unit: "hours", relation: "multiplicative_driver" },
      { id: "average_productivity", name: "Average productivity", type: "calculated", unit: "tonnes/hour", relation: "multiplicative_driver" }
    ],
    formulaTemplates: [
      { targetNodeId: "root", formula: "effective_working_time * average_productivity" },
      { targetNodeId: "effective_working_time", formula: "calendar_time - planned_downtime - unplanned_downtime" },
      { targetNodeId: "average_productivity", formula: "bottleneck_rate * yield_factor" }
    ],
    deepenRules: [
      {
        nodeId: "effective_working_time",
        suggestedDrivers: ["calendar_time", "planned_downtime", "unplanned_downtime"],
        guidance: "Deepen time with shift calendar, planned maintenance, breakdowns, weather, and workforce availability."
      },
      {
        nodeId: "average_productivity",
        useSkillId: "mining.haulage_truck_cycle",
        suggestedDrivers: ["bottleneck_rate", "yield_factor"],
        guidance: "Deepen productivity with the named bottleneck such as haulage, loading, crushing, or dumping."
      }
    ],
    warnings: ["Do not double count downtime inside both working time and productivity."]
  },
  "mining.haulage_truck_cycle": {
    skillId: "mining.haulage_truck_cycle",
    requiredInputs: ["number_of_trucks", "payload_per_trip_t", "cycle_time_h", "truck_working_time"],
    initialDrivers: [
      { id: "number_of_trucks", name: "Number of trucks", type: "input", relation: "multiplicative_driver" },
      { id: "trips_per_truck", name: "Trips per truck", type: "calculated", relation: "multiplicative_driver" },
      { id: "payload_per_trip_t", name: "Payload per trip", type: "input", unit: "tonnes", relation: "multiplicative_driver" },
      { id: "truck_working_time", name: "Truck working time", type: "calculated", unit: "hours", relation: "multiplicative_driver" },
      { id: "payload_factor", name: "Payload factor", type: "assumption", relation: "multiplicative_driver" }
    ],
    formulaTemplates: [
      { targetNodeId: "hauled_tonnes", formula: "number_of_trucks * trips_per_truck * payload_per_trip_t * payload_factor" },
      { targetNodeId: "trips_per_truck", formula: "truck_working_time / cycle_time_h" },
      { targetNodeId: "cycle_time_h", formula: "loading_time_h + loaded_travel_time_h + dumping_time_h + empty_return_time_h + queue_time_h" }
    ],
    deepenRules: [
      {
        nodeId: "cycle_time_h",
        suggestedDrivers: ["loading_time_h", "loaded_travel_time_h", "dumping_time_h", "empty_return_time_h", "queue_time_h"],
        guidance: "Deepen cycle time into loading, travel, dumping, return, and queueing components."
      }
    ],
    warnings: ["Do not count standby trucks in active fleet unless they are available to operate."]
  },
  "mining.block_preparation_dozer": {
    skillId: "mining.block_preparation_dozer",
    requiredInputs: ["mine_type", "dozer_count", "dozer_effective_hours", "dozer_productivity_rate", "block_area_or_volume", "material_type", "allocation_policy"],
    initialDrivers: [
      { id: "dozer_effective_hours", name: "Dozer effective hours", type: "calculated", unit: "hours", relation: "multiplicative_driver" },
      { id: "dozer_productivity_rate", name: "Dozer productivity rate", type: "input", relation: "multiplicative_driver" },
      { id: "floor_acceptance_factor", name: "Floor acceptance factor", type: "assumption", relation: "multiplicative_driver" },
      { id: "material_allocation_policy", name: "Material allocation policy", type: "assumption", relation: "formula_dependency" }
    ],
    formulaTemplates: [
      { targetNodeId: "root", formula: "dozer_effective_hours * dozer_productivity_rate * floor_acceptance_factor" },
      { targetNodeId: "dozer_effective_hours", formula: "dozer_count * scheduled_hours - dozer_downtime_hours" }
    ],
    deepenRules: [
      {
        nodeId: "dozer_effective_hours",
        suggestedDrivers: ["dozer_count", "scheduled_hours", "dozer_downtime_hours"],
        guidance: "Deepen dozer time into fleet count, scheduled hours, maintenance, weather, access, and standby delay categories."
      },
      {
        nodeId: "floor_acceptance_factor",
        suggestedDrivers: ["survey_release", "grade_control_release", "geotechnical_release", "drainage_release"],
        guidance: "Separate physical preparation capacity from release/acceptance readiness."
      }
    ],
    warnings: ["Do not treat prepared area, prepared volume, and released tonnes as interchangeable without density or geometry assumptions."]
  },
  "mining.drill_and_blast": {
    skillId: "mining.drill_and_blast",
    requiredInputs: ["mine_type", "drill_count", "drill_effective_hours", "penetration_rate_mph", "blast_pattern", "explosive_consumption", "material_type", "allocation_policy"],
    initialDrivers: [
      { id: "drilled_meters", name: "Drilled meters", type: "calculated", unit: "m", relation: "multiplicative_driver" },
      { id: "tonnes_per_drilled_meter", name: "Tonnes per drilled meter", type: "input", unit: "t/m", relation: "multiplicative_driver" },
      { id: "blast_quality_factor", name: "Blast quality factor", type: "assumption", relation: "multiplicative_driver" },
      { id: "material_allocation_policy", name: "Material allocation policy", type: "assumption", relation: "formula_dependency" }
    ],
    formulaTemplates: [
      { targetNodeId: "root", formula: "drilled_meters * tonnes_per_drilled_meter * blast_quality_factor" },
      { targetNodeId: "drilled_meters", formula: "drill_count * drill_effective_hours * penetration_rate_mph" },
      { targetNodeId: "explosives_kg", formula: "blasted_tonnes * powder_factor_kg_per_t" }
    ],
    deepenRules: [
      {
        nodeId: "drilled_meters",
        suggestedDrivers: ["drill_count", "drill_effective_hours", "penetration_rate_mph"],
        guidance: "Deepen drilling into available rigs, effective drilling hours, penetration rate, redrill, and drilling delays."
      },
      {
        nodeId: "blast_quality_factor",
        suggestedDrivers: ["fragmentation_factor", "misfire_loss", "dilution_factor", "ore_loss_factor"],
        guidance: "Use quality factors only when they represent explicit blast outcomes such as fragmentation, dilution, ore loss, or rework."
      }
    ],
    warnings: ["Do not mix drill meters, blasted tonnes, explosives kg, and advance meters without an explicit conversion boundary."]
  },
  "mining.material_allocation_ore_waste": {
    skillId: "mining.material_allocation_ore_waste",
    requiredInputs: ["material_types", "equipment_classes", "allocation_policy", "equipment_effective_hours", "material_productivity_rates"],
    initialDrivers: [
      { id: "ore_capacity_tonnes", name: "Ore capacity tonnes", type: "calculated", unit: "tonnes", relation: "positive_driver" },
      { id: "waste_capacity_tonnes", name: "Waste capacity tonnes", type: "calculated", unit: "tonnes", relation: "positive_driver" },
      { id: "allocation_policy", name: "Allocation policy", type: "assumption", relation: "formula_dependency" },
      { id: "ore_time_share", name: "Ore time share", type: "assumption", relation: "formula_dependency" },
      { id: "waste_time_share", name: "Waste time share", type: "assumption", relation: "formula_dependency" }
    ],
    formulaTemplates: [
      { targetNodeId: "total_material_moved", formula: "ore_capacity_tonnes + waste_capacity_tonnes" },
      { targetNodeId: "ore_capacity_tonnes", formula: "equipment_effective_hours * ore_time_share * ore_productivity_rate" },
      { targetNodeId: "waste_capacity_tonnes", formula: "equipment_effective_hours * waste_time_share * waste_productivity_rate" },
      { targetNodeId: "strip_ratio_t_per_t", formula: "waste_capacity_tonnes / ore_capacity_tonnes" }
    ],
    deepenRules: [
      {
        nodeId: "allocation_policy",
        suggestedDrivers: ["hard_allocation", "time_share_allocation", "dynamic_dispatch_allocation"],
        guidance: "Ask which allocation policy applies when ore and waste share equipment."
      }
    ],
    warnings: ["Do not sum ore and waste into a product KPI unless the root KPI is total material moved."]
  },
  "mining.mine_production_system": {
    skillId: "mining.mine_production_system",
    requiredInputs: ["mine_type", "production_boundary", "time_period", "material_types", "stage_capacities", "allocation_policy"],
    initialDrivers: [
      { id: "production_boundary", name: "Production boundary", type: "assumption", relation: "formula_dependency" },
      { id: "mine_type", name: "Mine type", type: "assumption", relation: "formula_dependency" },
      { id: "material_scope", name: "Material scope", type: "assumption", relation: "formula_dependency" },
      { id: "stage_readiness_tonnes", name: "Stage readiness tonnes", type: "calculated", unit: "tonnes", relation: "multiplicative_driver" },
      { id: "material_allocation_policy", name: "Material allocation policy", type: "assumption", relation: "formula_dependency" },
      { id: "downstream_capacity_tonnes", name: "Downstream capacity tonnes", type: "calculated", unit: "tonnes", relation: "multiplicative_driver" },
      { id: "yield_factor", name: "Yield factor", type: "assumption", relation: "multiplicative_driver" }
    ],
    formulaTemplates: [],
    deepenRules: [
      {
        nodeId: "stage_readiness_tonnes",
        suggestedDrivers: ["block_preparation", "drill_and_blast", "excavation_loading", "haulage", "dump_or_crusher"],
        guidance: "For open-pit systems, deepen stage readiness through preparation, drill/blast, excavation/loading, haulage, and dump/crusher readiness. Treat sequential stages as bottlenecks, not additive contributors."
      },
      {
        nodeId: "material_allocation_policy",
        useSkillId: "mining.material_allocation_ore_waste",
        suggestedDrivers: ["hard_allocation", "time_share_allocation", "dynamic_dispatch_allocation"],
        guidance: "Clarify ore/waste material allocation before mixing material streams."
      }
    ],
    warnings: [
      "Formula engine does not auto-apply min(stage_readiness_tonnes, downstream_capacity_tonnes); ask the user or model an explicit bottleneck/assumption before final formula setup.",
      "Do not add sequential production stages together unless a stockpile or buffer boundary is explicit."
    ]
  },
  "mining.underground_production_cycle": {
    skillId: "mining.underground_production_cycle",
    requiredInputs: ["mining_method", "face_or_stope_availability", "drill_charge_blast_cycle_time", "ventilation_reentry_time", "mucking_loading_capacity", "haulage_or_hoisting_capacity", "ground_support_or_backfill_constraint"],
    initialDrivers: [
      { id: "development_readiness", name: "Development readiness", type: "calculated", relation: "multiplicative_driver" },
      { id: "stope_production_tonnes", name: "Stope production tonnes", type: "calculated", unit: "tonnes", relation: "multiplicative_driver" },
      { id: "mucking_loading_capacity_tonnes", name: "Mucking/loading capacity tonnes", type: "calculated", unit: "tonnes", relation: "multiplicative_driver" },
      { id: "underground_haulage_or_hoisting_capacity_tonnes", name: "Underground haulage or hoisting capacity tonnes", type: "calculated", unit: "tonnes", relation: "multiplicative_driver" },
      { id: "ground_support_or_backfill_constraint", name: "Ground support or backfill constraint", type: "assumption", relation: "multiplicative_driver" }
    ],
    formulaTemplates: [
      { targetNodeId: "stope_production_tonnes", formula: "completed_rounds * tonnes_per_round" },
      { targetNodeId: "completed_rounds", formula: "available_cycle_time / drill_charge_blast_muck_cycle_time" }
    ],
    deepenRules: [
      {
        nodeId: "development_readiness",
        suggestedDrivers: ["face_availability", "drill_charge_blast_cycle_time", "ventilation_reentry_time", "ground_support_time"],
        guidance: "Model underground readiness with development cycle, ventilation re-entry, support, services, and access constraints."
      },
      {
        nodeId: "underground_haulage_or_hoisting_capacity_tonnes",
        suggestedDrivers: ["lhd_capacity", "truck_haulage_capacity", "orepass_capacity", "hoisting_capacity"],
        guidance: "Keep underground haulage/hoisting distinct from open-pit truck route assumptions unless the user specifies a mixed operation."
      }
    ],
    warnings: ["Do not force underground stoping or development into an open-pit block-drill-blast-load-haul chain."]
  },
  "finance.revenue_profit": {
    skillId: "finance.revenue_profit",
    requiredInputs: ["unit", "timePeriod", "profitScope"],
    initialDrivers: [
      { id: "revenue", name: "Revenue", type: "calculated", relation: "positive_driver" },
      { id: "variable_costs", name: "Variable costs", type: "input", relation: "negative_driver" },
      { id: "operating_expenses", name: "Operating expenses", type: "input", relation: "negative_driver" }
    ],
    formulaTemplates: [
      { targetNodeId: "revenue", formula: "units_sold * average_selling_price * (1 - discount_rate) - refunds" },
      { targetNodeId: "gross_profit", formula: "revenue - variable_costs - cost_of_goods_sold" },
      { targetNodeId: "operating_profit", formula: "gross_profit - operating_expenses" }
    ],
    deepenRules: [
      {
        nodeId: "revenue",
        suggestedDrivers: ["units_sold", "average_selling_price", "discount_rate", "refunds"],
        guidance: "Deepen revenue by customer, price, discount, product mix, and returns."
      }
    ],
    warnings: ["Do not subtract variable costs twice if COGS already includes them."]
  },
  "saas.funnel_growth": {
    skillId: "saas.funnel_growth",
    requiredInputs: ["unit", "timePeriod", "recurringRevenueMetric"],
    initialDrivers: [
      { id: "new_mrr", name: "New MRR", type: "calculated", relation: "positive_driver" },
      { id: "expansion_mrr", name: "Expansion MRR", type: "input", relation: "positive_driver" },
      { id: "contraction_mrr", name: "Contraction MRR", type: "input", relation: "negative_driver" },
      { id: "churned_mrr", name: "Churned MRR", type: "input", relation: "negative_driver" }
    ],
    formulaTemplates: [
      { targetNodeId: "mrr", formula: "active_customers * arpa" },
      { targetNodeId: "new_customers", formula: "visitors * signup_rate * activation_rate * paid_conversion_rate" },
      { targetNodeId: "new_mrr", formula: "new_customers * new_customer_arpa" },
      { targetNodeId: "net_new_mrr", formula: "new_mrr + expansion_mrr - contraction_mrr - churned_mrr" }
    ],
    deepenRules: [
      {
        nodeId: "new_mrr",
        suggestedDrivers: ["new_customers", "new_customer_arpa"],
        guidance: "Deepen new MRR through acquisition, activation, conversion, and ARPA."
      }
    ],
    warnings: ["Do not mix customer churn and revenue churn without labeling the unit."]
  },
  "generic.logical_kpi_decomposition": {
    skillId: "generic.logical_kpi_decomposition",
    requiredInputs: ["unit", "timePeriod", "driverLogic"],
    initialDrivers: [
      { id: "throughput_rate", name: "Throughput rate", type: "input", relation: "multiplicative_driver" },
      { id: "working_time", name: "Working time", type: "calculated", relation: "multiplicative_driver" },
      { id: "quality_factor", name: "Quality factor", type: "assumption", relation: "multiplicative_driver" }
    ],
    formulaTemplates: [
      { targetNodeId: "root", formula: "throughput_rate * working_time * quality_factor" },
      { targetNodeId: "available_output", formula: "throughput_rate * working_time * quality_factor" },
      { targetNodeId: "net_flow", formula: "inflow - outflow" }
    ],
    deepenRules: [
      {
        nodeId: "working_time",
        suggestedDrivers: ["scheduled_time", "planned_downtime", "unplanned_downtime", "operational_delay_time"],
        guidance: "Deepen working time into scheduled time and explicit downtime or delay categories."
      }
    ],
    warnings: ["Do not add ratios as if they were amounts."]
  }
};
function compileSkillRecipe(skill) {
  const template = RECIPE_TEMPLATES[skill.id];
  const questions = buildCriticalQuestions({ rootKpi: skill.title, industry: skill.domain }, [{ id: skill.id }]);
  const markdown = "raw" in skill ? skill.body : skill.excerpt;
  if (!template) {
    return compileRecipeFromMarkdown(skill, markdown, questions);
  }
  return {
    skillId: skill.id,
    recipeQuality: "complete",
    recipeSource: "template",
    requiredInputs: [...template.requiredInputs],
    questions,
    initialDrivers: template.initialDrivers.map((driver) => ({ ...driver })),
    formulaTemplates: [
      ...template.formulaTemplates.map((formula) => ({ ...formula })),
      ...markdownFormulaTemplatesForSkill(skill.id, markdown)
    ].filter(uniqueFormulaTemplate),
    deepenRules: template.deepenRules.map((rule) => ({ ...rule, suggestedDrivers: [...rule.suggestedDrivers] })),
    warnings: [...template.warnings]
  };
}
function compileRecipeFromMarkdown(skill, markdown, questions) {
  const extractedDrivers = extractDriverTemplates(markdown);
  const extractedFormulas = markdownFormulaTemplatesForSkill(skill.id, markdown);
  if (extractedDrivers.length > 0 || extractedFormulas.length > 0) {
    return {
      skillId: skill.id,
      recipeQuality: "partial",
      recipeSource: "markdown_extracted",
      requiredInputs: inferRequiredInputs(skill),
      questions,
      initialDrivers: extractedDrivers.length > 0 ? extractedDrivers : supportGenericDrivers(),
      formulaTemplates: extractedFormulas.filter(uniqueFormulaTemplate),
      deepenRules: extractedDrivers.map((driver) => ({
        nodeId: driver.id,
        suggestedDrivers: [],
        guidance: "Extracted from markdown decomposition guidance; read the full skill before building deeper structure."
      })),
      warnings: ["Executable recipe template is not available; recipe was partially extracted from markdown guidance."]
    };
  }
  const generic = RECIPE_TEMPLATES["generic.logical_kpi_decomposition"];
  return {
    skillId: skill.id,
    recipeQuality: "missing",
    recipeSource: "generic_fallback",
    requiredInputs: inferRequiredInputs(skill),
    questions,
    initialDrivers: generic.initialDrivers.map((driver) => ({ ...driver })),
    formulaTemplates: [],
    deepenRules: [],
    warnings: [
      "Executable recipe missing. Generic driver skeleton is support only and must not be treated as a complete domain recipe.",
      "Read markdown guidance, use research/discovery, or ask the user before building."
    ]
  };
}
function inferRequiredInputs(skill) {
  if ("frontmatter" in skill) return [...skill.frontmatter.requires];
  return ["root_kpi_definition", "unit", "time_period", "driver_logic"];
}
function supportGenericDrivers() {
  const generic = RECIPE_TEMPLATES["generic.logical_kpi_decomposition"];
  return generic.initialDrivers.map((driver) => ({ ...driver }));
}
function extractDriverTemplates(text) {
  const drivers = /* @__PURE__ */ new Map();
  const matches = text.matchAll(/```(?:text)?\n([\s\S]*?)```/g);
  for (const match of matches) {
    const lines = (match[1] ?? "").split("\n");
    for (const line of lines.slice(1)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.includes("=") || /^[-*]/.test(trimmed)) continue;
      if (!/^[a-zA-Z][a-zA-Z0-9_\s/()-]+$/.test(trimmed)) continue;
      const id = stableRecipeId(trimmed);
      if (!drivers.has(id)) {
        drivers.set(id, {
          id,
          name: titleFromId(trimmed),
          type: "calculated",
          relation: "positive_driver"
        });
      }
    }
  }
  return [...drivers.values()].slice(0, 8);
}
function extractFormulaTemplates(text) {
  const formulas = [];
  const matches = text.matchAll(/```(?:text)?\n([\s\S]*?)```/g);
  for (const match of matches) {
    const body = match[1] ?? "";
    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.includes("=")) formulas.push(trimmed);
    }
  }
  return formulas;
}
function markdownFormulaTemplatesForSkill(skillId, markdown) {
  if (skillId === "mining.mine_production_system") return [];
  return extractFormulaTemplates(markdown).map((formula) => ({
    targetNodeId: formula.split("=")[0]?.trim() || "root",
    formula: formula.includes("=") ? formula.split("=").slice(1).join("=").trim() : formula
  })).filter(isExecutableFormulaTemplate);
}
function isExecutableFormulaTemplate(template) {
  if (/[+\-*/(),\s]/.test(template.targetNodeId)) return false;
  if (/\b(min|max|sum)\s*\(/i.test(template.formula)) return false;
  return /^[a-zA-Z0-9_+\-*/().\s]+$/.test(template.formula);
}
function stableRecipeId(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "driver";
}
function titleFromId(value) {
  return value.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function uniqueFormulaTemplate(template, index, all) {
  return all.findIndex((candidate) => candidate.targetNodeId === template.targetNodeId && candidate.formula === template.formula) === index;
}

// ../vdt-agent/src/index.ts
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
    "production volume",
    "excavation",
    "excavator",
    "shovel",
    "bucket",
    "bucket fill",
    "swell",
    "rock m3",
    "solid m3",
    "downtime",
    "face not ready",
    "restricted access"
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
    const inlineValue = keyMatch[2]?.trim() ?? "";
    if (inlineValue) {
      if (inlineValue === ">-" || inlineValue === ">" || inlineValue === "|" || inlineValue === "|-") {
        const { value, nextIndex } = parseBlockScalarFrontmatterValue(frontmatterLines, index, inlineValue);
        attributes[key] = value;
        index = nextIndex;
        continue;
      }
      attributes[key] = parseScalarFrontmatterValue(inlineValue);
      continue;
    }
    const values = [];
    while (frontmatterLines[index + 1]?.match(/^\s*-\s+/)) {
      index += 1;
      values.push(parseStringValue(frontmatterLines[index].replace(/^\s*-\s+/, "")));
    }
    if (values.length > 0) {
      attributes[key] = values;
      continue;
    }
    const map = {};
    while (frontmatterLines[index + 1]?.match(/^\s+[A-Za-z0-9_-]+:/)) {
      index += 1;
      const nestedLine = frontmatterLines[index].trim();
      const nestedMatch = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(nestedLine);
      if (!nestedMatch) {
        throw new Error(`Unsupported nested frontmatter line: ${frontmatterLines[index]}`);
      }
      const nestedValue = parseScalarFrontmatterValue(nestedMatch[2]?.trim() ?? "");
      if (Array.isArray(nestedValue) || isFrontmatterMap(nestedValue)) {
        throw new Error(`Unsupported nested frontmatter value: ${frontmatterLines[index]}`);
      }
      map[nestedMatch[1]] = nestedValue;
    }
    attributes[key] = Object.keys(map).length > 0 ? map : values;
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
  const [{ readdir, readFile: readFile3 }, { join: join3, relative }] = await Promise.all([import("node:fs/promises"), import("node:path")]);
  const registryPath = join3(rootDir, "registry.md");
  const registrySource = await readFile3(registryPath, "utf8");
  const markdownPaths = await collectMarkdownFiles(rootDir, readdir, join3);
  const sources = { "registry.md": registrySource };
  await Promise.all(
    markdownPaths.filter((path6) => !path6.endsWith("registry.md")).map(async (path6) => {
      sources[relative(rootDir, path6).replaceAll("\\", "/")] = await readFile3(path6, "utf8");
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
  const moduleDir = dirname2(fileURLToPath2(import.meta.url));
  const candidates = [
    join2(moduleDir, "vdt-agent-skills"),
    join2(dirname2(moduleDir), "vdt-agent-skills"),
    join2(dirname2(moduleDir), "skills")
  ];
  const { access: access2 } = await import("node:fs/promises");
  for (const candidate of candidates) {
    try {
      await access2(join2(candidate, "registry.md"));
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
    const patternMatched = skillMatchesClassificationPattern(skill, classification);
    const effectiveMatchedTerms = patternMatched ? uniqueStrings([...matchedTerms, classification.pattern]) : matchedTerms;
    const hasExplicitMatch = effectiveMatchedTerms.length > 0;
    const isGenericFallback = skill.domain === "generic";
    const domainScore = skill.domain === classification.domain && hasExplicitMatch ? 8 : isGenericFallback ? 1 : 0;
    const patternScore = matchedTerms.length * 3 + (patternMatched ? 6 : 0);
    const outputScore = skill.frontmatter.outputs.some((output) => effectiveMatchedTerms.includes(output)) ? 2 : 0;
    const score = domainScore + patternScore + outputScore;
    return {
      skill,
      score,
      matchedTerms: effectiveMatchedTerms,
      reason: buildSelectionReason(skill, classification, effectiveMatchedTerms)
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
function skillMatchesClassificationPattern(skill, classification) {
  if (skill.domain !== classification.domain) return false;
  if (classification.pattern === "logical_kpi_decomposition" || classification.pattern === "production_volume") return false;
  const normalizedPattern = normalizeText(classification.pattern);
  if (!normalizedPattern) return false;
  const skillIdSuffix = skill.id.split(".").at(-1) ?? skill.id;
  if (normalizeText(skillIdSuffix) === normalizedPattern) return true;
  return [...skill.frontmatter.patterns, ...skill.frontmatter.kpiPatterns].some((pattern) => normalizeText(pattern) === normalizedPattern);
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
      questions: skill.frontmatter.questions,
      ...skill.frontmatter.referenceFiles ? { referenceFiles: skill.frontmatter.referenceFiles } : {},
      ...skill.frontmatter.evalFiles ? { evalFiles: skill.frontmatter.evalFiles } : {},
      ...skill.frontmatter.runtimePolicy ? { runtimePolicy: skill.frontmatter.runtimePolicy } : {}
    };
    if (reason) {
      excerpt.reason = reason;
    }
    return excerpt;
  });
}
function planDecomposition(request, classification, skillExcerpts) {
  const formulas = uniqueStrings(skillExcerpts.flatMap((skill) => extractFormulaTemplates2(skill.excerpt))).slice(0, 8);
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
function parseBlockScalarFrontmatterValue(lines, index, marker) {
  const blockLines = [];
  let cursor = index;
  while (lines[cursor + 1] !== void 0 && !/^[A-Za-z0-9_-]+:\s*/.test(lines[cursor + 1])) {
    cursor += 1;
    blockLines.push(lines[cursor].replace(/^\s{2}/, ""));
  }
  const chomped = blockLines.join(marker.startsWith("|") ? "\n" : " ").replace(/\s+/g, " ").trim();
  return { value: chomped, nextIndex: cursor };
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
  const getOptionalString = (key) => {
    const value = attributes[key];
    return typeof value === "string" && value.trim() ? value.trim() : void 0;
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
  const getOptionalStringArray = (key) => {
    const value = attributes[key];
    if (value === void 0) return [];
    if (!Array.isArray(value)) {
      throw new Error(`Skill ${path6} frontmatter must be a list: ${key}.`);
    }
    return value.map((item) => item.trim()).filter(Boolean);
  };
  const getStringMap = (key) => {
    const value = attributes[key];
    if (!isFrontmatterMap(value)) return void 0;
    return Object.fromEntries(
      Object.entries(value).filter((entry) => typeof entry[1] === "string" && entry[1].trim().length > 0).map(([mapKey, mapValue]) => [mapKey, mapValue.trim()])
    );
  };
  const getScalarMap = (key) => {
    const value = attributes[key];
    return isFrontmatterMap(value) ? { ...value } : void 0;
  };
  const version = attributes.version;
  const name = getOptionalString("name");
  const orchestratorId = getOptionalString("orchestrator_id");
  const description = getOptionalString("description");
  const frontmatter = {
    id: getString("id"),
    ...name ? { name } : {},
    ...orchestratorId ? { orchestratorId } : {},
    title: getString("title"),
    domain: getString("domain"),
    ...description ? { description } : {},
    patterns: getStringArray("patterns"),
    kpiPatterns: getStringArray("kpi_patterns"),
    requires: getStringArray("requires"),
    outputs: getStringArray("outputs"),
    questions: getOptionalStringArray("questions")
  };
  if (typeof version === "number") {
    frontmatter.version = version;
  }
  const referenceFiles = getStringMap("reference_files");
  const evalFiles = getStringMap("eval_files");
  const runtimePolicy = getScalarMap("runtime_policy");
  if (referenceFiles && Object.keys(referenceFiles).length > 0) {
    frontmatter.referenceFiles = referenceFiles;
  }
  if (evalFiles && Object.keys(evalFiles).length > 0) {
    frontmatter.evalFiles = evalFiles;
  }
  if (runtimePolicy && Object.keys(runtimePolicy).length > 0) {
    frontmatter.runtimePolicy = runtimePolicy;
  }
  return frontmatter;
}
function isFrontmatterMap(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
async function collectMarkdownFiles(rootDir, readdir, join3) {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path6 = join3(rootDir, entry.name);
      if (entry.isDirectory()) {
        return collectMarkdownFiles(path6, readdir, join3);
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
  if (domain === "mining") {
    const excavationTerms = [
      "excavation",
      "excavator",
      "shovel",
      "bucket",
      "bucket fill",
      "swell",
      "ore tonnes",
      "rock m3",
      "solid m3",
      "downtime",
      "truck loading time",
      "loaded trucks per hour",
      "face not ready",
      "material not ready",
      "restricted access",
      "equipment split",
      "material split"
    ];
    if (excavationTerms.some((term) => includesTerm(haystack, term))) {
      return "excavation";
    }
    const haulageTerms = [
      "haulage",
      "haul route",
      "haul distance",
      "truck cycle",
      "truck productivity",
      "loaded speed",
      "empty speed",
      "queueing",
      "dumping",
      "truck"
    ];
    if (haulageTerms.some((term) => includesTerm(haystack, term))) {
      return "haulage_truck_cycle";
    }
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
  const pattern = new RegExp(`(^|\\n)## ${escapeRegExp3(title)}\\n([\\s\\S]*?)(?=\\n## |$)`);
  return pattern.exec(markdown)?.[0].trim() ?? "";
}
function escapeRegExp3(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function extractFormulaTemplates2(excerpt) {
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

// ../vdt-agent-runtime/src/tools/skill-tools.ts
var skillListTool = {
  name: "skill.list",
  description: "List available VDT skills without reading full markdown.",
  inputSchema: external_exports.object({}),
  outputSchema: external_exports.record(external_exports.unknown()),
  phase: "retrieving_skills",
  async run() {
    const library = await loadDefaultSkillLibrary();
    return {
      skills: library.skills.map((skill) => ({
        id: skill.id,
        title: skill.title,
        domain: skill.domain,
        patterns: skill.frontmatter.patterns,
        kpiPatterns: skill.frontmatter.kpiPatterns,
        requiredInputs: skill.frontmatter.requires,
        outputs: skill.frontmatter.outputs,
        referenceFiles: skill.frontmatter.referenceFiles,
        runtimePolicy: skill.frontmatter.runtimePolicy
      }))
    };
  }
};
var skillSearchTool = {
  name: "skill.search",
  description: "Search the local VDT skill library for decomposition skills.",
  inputSchema: external_exports.object({
    rootKpi: external_exports.string().min(1).max(200),
    industry: external_exports.string().max(200).optional(),
    businessContext: external_exports.string().max(2e3).optional(),
    goal: external_exports.string().max(1e3).optional(),
    maxSkills: external_exports.number().int().min(1).max(10).optional()
  }),
  outputSchema: external_exports.record(external_exports.unknown()),
  phase: "retrieving_skills",
  async run(context, input) {
    const library = await loadDefaultSkillLibrary();
    const classification = classifyVdtRequest(input);
    const candidates = retrieveSkills(input, library, {
      classification,
      ...input.maxSkills !== void 0 ? { maxSkills: input.maxSkills } : {}
    }).map((candidate) => ({
      id: candidate.skill.id,
      path: candidate.skill.path,
      title: candidate.skill.title,
      score: candidate.score,
      reason: candidate.reason,
      matchedTerms: candidate.matchedTerms,
      domain: candidate.skill.domain,
      requiredInputs: candidate.skill.frontmatter.requires,
      outputs: candidate.skill.frontmatter.outputs,
      referenceFiles: candidate.skill.frontmatter.referenceFiles,
      runtimePolicy: candidate.skill.frontmatter.runtimePolicy
    }));
    context.emit({
      type: "skill_search",
      phase: "retrieving_skills",
      title: "Skill search completed",
      message: `Found ${candidates.length} candidate skill${candidates.length === 1 ? "" : "s"}.`,
      metadata: { candidateIds: candidates.map((candidate) => candidate.id), classification }
    });
    return { classification, candidates };
  }
};
var skillReadTool = {
  name: "skill.read",
  description: "Read a selected local VDT skill excerpt and structured metadata.",
  inputSchema: external_exports.object({
    skillId: external_exports.string().min(1).max(160),
    maxChars: external_exports.number().int().min(200).max(1e4).optional()
  }),
  outputSchema: external_exports.record(external_exports.unknown()),
  phase: "reading_skills",
  async run(context, input) {
    const library = await loadDefaultSkillLibrary();
    const skill = library.byId.get(input.skillId);
    if (!skill) throw new AgentToolError("SKILL_NOT_FOUND", `Skill "${input.skillId}" was not found.`);
    const [excerpt] = readSkillExcerpts([skill], input.maxChars);
    if (!excerpt) throw new AgentToolError("SKILL_READ_FAILED", `Skill "${input.skillId}" could not be read.`);
    const recipe = compileSkillRecipe(skill);
    if (!context.store.getState(context.runId).selectedSkills.some((selected) => selected.id === skill.id)) {
      context.store.updateRun(context.runId, {
        selectedSkills: [
          ...context.store.getState(context.runId).selectedSkills,
          {
            id: skill.id,
            path: skill.path,
            title: skill.title,
            score: 100,
            reason: "Read by agent decision.",
            matchedTerms: []
          }
        ]
      });
    }
    context.emit({
      type: "skill_read",
      phase: "reading_skills",
      title: "Skill read",
      message: `Read ${skill.id}: ${skill.title}.`,
      metadata: { id: skill.id, path: skill.path, outputs: skill.frontmatter.outputs }
    });
    return {
      id: excerpt.id,
      path: excerpt.path,
      title: excerpt.title,
      domain: excerpt.domain,
      excerpt: excerpt.excerpt,
      requiredInputs: skill.frontmatter.requires,
      outputs: excerpt.outputs ?? [],
      questions: excerpt.questions ?? [],
      referenceFiles: skill.frontmatter.referenceFiles ?? {},
      evalFiles: skill.frontmatter.evalFiles ?? {},
      runtimePolicy: skill.frontmatter.runtimePolicy ?? {},
      recipeQuality: recipe.recipeQuality,
      recipeSource: recipe.recipeSource,
      formulaTemplates: recipe.formulaTemplates.map((formula) => `${formula.targetNodeId} = ${formula.formula}`)
    };
  }
};
var skillCompileRecipeTool = {
  name: "skill.compile_recipe",
  description: "Compile a local markdown skill into a structured executable VDT recipe.",
  inputSchema: external_exports.object({
    skillId: external_exports.string().min(1).max(160)
  }),
  outputSchema: external_exports.record(external_exports.unknown()),
  phase: "planning_decomposition",
  async run(context, input) {
    const library = await loadDefaultSkillLibrary();
    const skill = library.byId.get(input.skillId);
    if (!skill) throw new AgentToolError("SKILL_NOT_FOUND", `Skill "${input.skillId}" was not found.`);
    const recipe = compileSkillRecipe(skill);
    const state = context.store.getState(context.runId);
    const feedback = recipe.recipeQuality === "complete" ? void 0 : createStructuredFeedback({
      kind: "recipe_incomplete",
      severity: "warning",
      message: `Skill "${recipe.skillId}" exists, but executable recipe is ${recipe.recipeQuality}. Read markdown guidance, use research/discovery, or ask user before building.`,
      target: { toolName: "skill.compile_recipe" },
      expected: "Complete executable recipe template.",
      actual: { recipeQuality: recipe.recipeQuality, recipeSource: recipe.recipeSource },
      suggestedNextTools: ["skill.read", "research.search_web", "user.ask"],
      retryable: true
    });
    context.store.updateRun(context.runId, {
      recipes: [
        ...state.recipes.filter((existing) => existing.skillId !== recipe.skillId),
        recipe
      ],
      ...feedback ? {
        feedbackHistory: [...state.feedbackHistory ?? [], feedback].slice(-20),
        lastFeedback: feedback
      } : {}
    });
    return {
      ...recipe
    };
  }
};
var skillSeedDraftFromRecipeTool = {
  name: "skill.seed_draft_from_recipe",
  description: "Create a small deterministic draft skeleton from a compiled skill recipe.",
  inputSchema: external_exports.object({
    skillId: external_exports.string().min(1).max(160),
    rootKpi: external_exports.string().min(1).max(200),
    unit: external_exports.string().max(80).optional(),
    timePeriod: external_exports.string().max(80).optional(),
    knownInputs: external_exports.record(external_exports.union([external_exports.string(), external_exports.number()])).optional(),
    maxInitialDrivers: external_exports.number().int().min(1).max(12).optional()
  }),
  outputSchema: external_exports.record(external_exports.unknown()),
  mutatesProject: true,
  requiresDraftProject: true,
  phase: "building_graph",
  async run(context, input) {
    const builder = context.builder;
    if (!builder) throw new AgentToolError("NO_DRAFT_PROJECT", "VDT builder session is not available for this run.");
    const state = context.store.getState(context.runId);
    let recipe = state.recipes.find((candidate) => candidate.skillId === input.skillId);
    if (!recipe) {
      const library = await loadDefaultSkillLibrary();
      const skill = library.byId.get(input.skillId);
      if (!skill) throw new AgentToolError("SKILL_NOT_FOUND", `Skill "${input.skillId}" was not found.`);
      recipe = compileSkillRecipe(skill);
    }
    if (recipe.recipeQuality === "missing") {
      throw new AgentToolError(
        "RECIPE_INCOMPLETE",
        `Skill "${recipe.skillId}" has no executable recipe. Read markdown guidance, use research/discovery, or ask the user before building.`,
        { recipeQuality: recipe.recipeQuality, recipeSource: recipe.recipeSource, warnings: recipe.warnings }
      );
    }
    let project = builder.getProject();
    if (project.graph.nodes.length === 0) {
      project = builder.createDraft({
        projectTitle: `${input.rootKpi} Driver Model`,
        rootKpi: input.rootKpi,
        unit: input.unit,
        timePeriod: input.timePeriod
      }).project;
      context.store.updateRun(context.runId, { draftProject: project });
    }
    const rootNodeId = project.rootNodeId || stableSnakeId(input.rootKpi, "root_kpi");
    const previewBuilder = cloneBuilder(context);
    const changeSets = [];
    const addedNodeIds = [];
    const appliedFormulaNodeIds = [];
    const knownInputs = input.knownInputs ?? {};
    for (const driver of recipe.initialDrivers.slice(0, input.maxInitialDrivers ?? 6)) {
      const current = previewBuilder.getProject();
      if (current.graph.nodes.some((node) => node.id === driver.id)) continue;
      const formula = driver.formula && referencesExist(current, driver.formula) ? driver.formula : void 0;
      const baselineValue = parseKnownNumber(knownInputs[driver.id]);
      const result = previewBuilder.addDriver({
        parentNodeId: rootNodeId,
        nodeId: driver.id,
        name: driver.name,
        type: driver.type,
        unit: driver.unit,
        relation: driver.relation,
        formula,
        baselineValue,
        description: driver.description,
        assumptions: driver.assumptions
      });
      changeSets.push(requireChangeSet(result.changeSet));
      addedNodeIds.push(result.changeSet?.additions[0]?.nodeId ?? driver.id);
    }
    for (const formula of recipe.formulaTemplates) {
      const current = previewBuilder.getProject();
      const targetNodeId = formula.targetNodeId === "root" || formula.targetNodeId === input.rootKpi ? current.rootNodeId : formula.targetNodeId;
      if (!current.graph.nodes.some((node) => node.id === targetNodeId)) continue;
      if (!referencesExist(current, formula.formula)) continue;
      const result = previewBuilder.setFormula({ nodeId: targetNodeId, formula: formula.formula });
      changeSets.push(requireChangeSet(result.changeSet));
      appliedFormulaNodeIds.push(targetNodeId);
    }
    const missingInputs = recipe.requiredInputs.filter((id) => knownInputs[id] === void 0);
    if (changeSets.length === 0) {
      const latest2 = builder.getProject();
      const validation = summarizeValidation(builder.validate().validation);
      context.store.updateRun(context.runId, {
        draftProject: latest2,
        validationState: validation
      });
      return {
        projectId: latest2.id,
        rootNodeId: latest2.rootNodeId,
        addedNodeIds,
        appliedFormulaNodeIds,
        missingInputs,
        revision: builder.getRevision(),
        validation
      };
    }
    const summary3 = `Seeded ${addedNodeIds.length} driver node${addedNodeIds.length === 1 ? "" : "s"} from ${recipe.skillId}.`;
    const mutation = proposeAndMaybeApplyMutation(context, {
      title: "Recipe draft seeded",
      summary: summary3,
      changeSet: combineChangeSets(changeSets, context),
      targetNodeId: rootNodeId
    });
    const latest = mutation.applied ? builder.getProject() : mutation.proposal.previewProject;
    return {
      projectId: latest.id,
      rootNodeId: latest.rootNodeId,
      addedNodeIds,
      appliedFormulaNodeIds,
      missingInputs,
      revision: mutation.revision,
      validation: mutation.validation,
      mutationProposal: { id: mutation.proposal.id, status: mutation.proposal.status }
    };
  }
};
function referencesExist(project, formula) {
  const nodeIds = new Set(project.graph.nodes.map((node) => node.id));
  try {
    return extractFormulaReferences(formula).every((reference) => nodeIds.has(reference));
  } catch {
    return false;
  }
}
function parseKnownNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : void 0;
  if (typeof value !== "string") return void 0;
  const match = value.replace(",", ".").match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return void 0;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : void 0;
}

// ../vdt-agent-runtime/src/tools/subagent-tools.ts
var SUBAGENT_TIMEOUT_MAX_MS = 3e5;
var subagentTaskTypeSchema = external_exports.enum([
  "brief_alignment",
  "level_decomposition",
  "formula_builder",
  "critic",
  "memory_curator"
]);
var createTaskTool = {
  name: "subagent.create_task",
  description: "Create and execute a bounded internal subagent task. Subagents return compact reports and never mutate the VDT.",
  inputSchema: external_exports.object({
    type: subagentTaskTypeSchema,
    inputArtifactId: external_exports.string().min(1).max(160).optional(),
    objective: external_exports.string().max(600).optional(),
    targetNodeId: external_exports.string().max(160).optional(),
    publicStatus: external_exports.string().max(300).optional(),
    timeoutMs: external_exports.number().int().min(1e3).max(SUBAGENT_TIMEOUT_MAX_MS).optional()
  }),
  outputSchema: external_exports.record(external_exports.unknown()),
  phase: "planning_decomposition",
  run(context, input) {
    if (context.signal.aborted) {
      throw new AgentToolError("SUBAGENT_CANCELLED", "Subagent task was cancelled before it started.");
    }
    const state = context.store.getState(context.runId);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const taskNumber = (state.subagentTasks?.length ?? 0) + 1;
    const task = {
      id: `${context.runId}:subagent:${taskNumber}`,
      runId: context.runId,
      type: input.type,
      status: "queued",
      inputArtifactId: input.inputArtifactId ?? `subagent_input_${taskNumber}`,
      ...input.publicStatus ? { publicStatus: input.publicStatus } : {},
      timeoutMs: input.timeoutMs ?? 6e4,
      retryCount: 0
    };
    context.store.updateRun(context.runId, {
      subagentTasks: [...state.subagentTasks ?? [], task]
    });
    context.emit({
      type: "tool_call_started",
      phase: "planning_decomposition",
      title: "Internal subagent task started",
      message: input.publicStatus ?? `Running ${input.type.replaceAll("_", " ")} task.`,
      metadata: { taskId: task.id, subagentType: input.type, internal: true, createdAt: now }
    });
    const startedAt = (/* @__PURE__ */ new Date()).toISOString();
    updateTask(context, task.id, {
      status: "running",
      startedAt,
      heartbeatAt: startedAt
    });
    const runningState = context.store.getState(context.runId);
    const report = runBoundedSubagent(runningState, {
      task: { ...task, status: "running", startedAt, heartbeatAt: startedAt },
      objective: input.objective,
      targetNodeId: input.targetNodeId
    });
    const completedAt = (/* @__PURE__ */ new Date()).toISOString();
    const terminalTaskStatus = report.status === "failed_retryable" ? "failed_retryable" : report.status === "failed" ? "failed" : "succeeded";
    const latest = context.store.getState(context.runId);
    context.store.updateRun(context.runId, {
      subagentReports: [...latest.subagentReports ?? [], report],
      subagentTasks: (latest.subagentTasks ?? []).map(
        (candidate) => candidate.id === task.id ? {
          ...candidate,
          status: terminalTaskStatus,
          completedAt,
          heartbeatAt: completedAt
        } : candidate
      )
    });
    context.emit({
      type: "tool_call_completed",
      phase: "planning_decomposition",
      title: "Internal subagent report ready",
      message: report.summaryForOrchestrator,
      metadata: {
        taskId: task.id,
        subagentType: input.type,
        status: report.status,
        confidence: report.confidence,
        internal: true
      }
    });
    return { taskId: task.id, report };
  }
};
function updateTask(context, taskId, patch) {
  const state = context.store.getState(context.runId);
  context.store.updateRun(context.runId, {
    subagentTasks: (state.subagentTasks ?? []).map(
      (task) => task.id === taskId ? { ...task, ...patch } : task
    )
  });
}
function runBoundedSubagent(state, input) {
  const project = state.builder?.getProject() ?? state.draftProject ?? state.project ?? state.request.input.project;
  switch (input.task.type) {
    case "brief_alignment":
      return briefAlignmentReport(state, input.task, project, input.objective);
    case "level_decomposition":
      return levelDecompositionReport(state, input.task, project, input.targetNodeId, input.objective);
    case "formula_builder":
      return formulaBuilderReport(input.task, project, input.targetNodeId);
    case "critic":
      return criticReport(input.task, project);
    case "memory_curator":
      return memoryCuratorReport(state, input.task, project);
  }
}
function briefAlignmentReport(state, task, project, objective) {
  const briefRoot = state.visibleContext.brief.rootKpi;
  const rootNode = project?.graph.nodes.find((node) => node.id === project.rootNodeId);
  const risks = [];
  if (rootNode && rootNode.name.toLowerCase() !== briefRoot.toLowerCase()) {
    risks.push(`Draft root "${rootNode.name}" differs from visible brief "${briefRoot}".`);
  }
  if (!state.request.input.prompt && !state.request.input.businessContext) {
    risks.push("User brief has limited business context.");
  }
  return {
    taskId: task.id,
    status: risks.some((risk) => risk.includes("differs")) ? "needs_user_input" : "succeeded",
    summaryForOrchestrator: [
      `Brief root KPI is "${briefRoot}".`,
      rootNode ? `Draft root is "${rootNode.name}".` : "No draft root exists yet.",
      objective ? `Objective: ${objective}` : ""
    ].filter(Boolean).join(" "),
    assumptions: [
      ...state.selectedSkills.slice(0, 3).map((skill) => `Selected skill: ${skill.id}`),
      ...state.visibleContext.brief.unit ? [`Unit: ${state.visibleContext.brief.unit}`] : []
    ],
    ...risks.length > 0 ? { risks } : {},
    confidence: risks.length > 0 ? 0.62 : 0.86
  };
}
function levelDecompositionReport(state, task, project, targetNodeId, objective) {
  if (!project) {
    return noProjectReport(task, "Level decomposition cannot run before a draft VDT exists.");
  }
  const childrenByParent = childrenByParentMap(project);
  const target = targetNodeId ? project.graph.nodes.find((node) => node.id === targetNodeId) : project.graph.nodes.find((node) => node.id === project.rootNodeId);
  if (!target) {
    return {
      taskId: task.id,
      status: "failed_retryable",
      summaryForOrchestrator: `Target node "${targetNodeId ?? project.rootNodeId}" was not found for level decomposition.`,
      risks: ["The orchestrator should select an existing node before requesting decomposition critique."],
      confidence: 0.35
    };
  }
  const childIds = childrenByParent.get(target.id) ?? [];
  const leafCandidates = project.graph.nodes.filter((node) => (childrenByParent.get(node.id)?.length ?? 0) === 0).slice(0, 8).map((node) => node.id);
  return {
    taskId: task.id,
    status: "succeeded",
    summaryForOrchestrator: [
      `Target "${target.name}" has ${childIds.length} direct child driver${childIds.length === 1 ? "" : "s"}.`,
      childIds.length === 0 ? "It is a candidate for the next visible layer." : `Existing child ids: ${childIds.slice(0, 8).join(", ")}.`,
      leafCandidates.length > 0 ? `Current frontier candidates: ${leafCandidates.join(", ")}.` : "",
      objective ? `Objective: ${objective}` : "",
      state.progressiveBuild ? `Progressive depth is ${state.progressiveBuild.currentDepth}.` : ""
    ].filter(Boolean).join(" "),
    assumptions: ["Subagent reviewed structure only; it did not create a patch."],
    confidence: childIds.length === 0 ? 0.78 : 0.72
  };
}
function formulaBuilderReport(task, project, targetNodeId) {
  if (!project) return noProjectReport(task, "Formula builder cannot run before a draft VDT exists.");
  const nodes = targetNodeId ? project.graph.nodes.filter((node) => node.id === targetNodeId) : project.graph.nodes;
  if (targetNodeId && nodes.length === 0) {
    return {
      taskId: task.id,
      status: "failed_retryable",
      summaryForOrchestrator: `Target node "${targetNodeId}" was not found for formula review.`,
      confidence: 0.35
    };
  }
  const missingFormula = nodes.filter((node) => node.type === "calculated" && !node.formula?.trim()).map((node) => node.id).slice(0, 10);
  const missingValues = nodes.filter((node) => node.type === "input" && node.baselineValue === void 0 && node.value === void 0).map((node) => node.id).slice(0, 10);
  return {
    taskId: task.id,
    status: missingValues.length > 0 ? "needs_user_input" : "succeeded",
    summaryForOrchestrator: [
      missingFormula.length > 0 ? `Calculated nodes missing formulas: ${missingFormula.join(", ")}.` : "No missing calculated-node formulas found in the bounded review.",
      missingValues.length > 0 ? `Input nodes missing values: ${missingValues.join(", ")}.` : "No missing input values found in the bounded review."
    ].join(" "),
    assumptions: ["Formula subagent proposed no graph mutation; orchestrator must use VDT tools for any changes."],
    confidence: missingFormula.length > 0 || missingValues.length > 0 ? 0.7 : 0.84
  };
}
function criticReport(task, project) {
  if (!project) return noProjectReport(task, "Critic cannot run before a draft VDT exists.");
  const validation = summarizeValidation(validateGraph(project));
  const calculation = validation.valid ? summarizeCalculation(calculateGraph(project)) : void 0;
  const risks = [
    ...validation.errors.map((issue2) => issue2.message),
    ...validation.warnings.slice(0, 5).map((issue2) => issue2.message),
    ...calculation?.errors.slice(0, 5).map((issue2) => issue2.message) ?? []
  ];
  return {
    taskId: task.id,
    status: validation.valid && (calculation?.errors.length ?? 0) === 0 ? "succeeded" : "needs_user_input",
    summaryForOrchestrator: [
      validation.valid ? `Validation passed with ${validation.warnings.length} warning${validation.warnings.length === 1 ? "" : "s"}.` : `Validation has ${validation.errors.length} error${validation.errors.length === 1 ? "" : "s"}.`,
      calculation ? `Calculation has ${calculation.valueCount} computed value${calculation.valueCount === 1 ? "" : "s"}.` : "Calculation was skipped because validation is not clean."
    ].join(" "),
    ...risks.length > 0 ? { risks } : {},
    confidence: validation.valid ? 0.88 : 0.68
  };
}
function memoryCuratorReport(state, task, project) {
  const answerKeys = Object.keys(state.answers);
  const nodeCount = project?.graph.nodes.length ?? 0;
  return {
    taskId: task.id,
    status: "succeeded",
    summaryForOrchestrator: [
      `Keep root KPI "${state.visibleContext.brief.rootKpi}" as the durable brief anchor.`,
      project ? `Current draft has ${nodeCount} node${nodeCount === 1 ? "" : "s"}.` : "No draft project exists yet.",
      answerKeys.length > 0 ? `User provided answers for: ${answerKeys.slice(0, 10).join(", ")}.` : "No structured user answers have been recorded."
    ].join(" "),
    assumptions: state.memoryNotes.slice(-5).map((note) => note.note),
    confidence: 0.8
  };
}
function noProjectReport(task, message) {
  return {
    taskId: task.id,
    status: "failed_retryable",
    summaryForOrchestrator: message,
    risks: ["Run this subagent again after creating a draft project."],
    confidence: 0.4
  };
}
function childrenByParentMap(project) {
  const childrenByParent = /* @__PURE__ */ new Map();
  for (const edge of project.graph.edges) {
    childrenByParent.set(edge.sourceNodeId, [...childrenByParent.get(edge.sourceNodeId) ?? [], edge.targetNodeId]);
  }
  return childrenByParent;
}

// ../vdt-agent-runtime/src/tools/user-tools.ts
var askUserTool = {
  name: "user.ask",
  description: "Pause the run and ask required user questions.",
  inputSchema: external_exports.object({
    questions: external_exports.array(agentQuestionSchema2).min(1).max(5)
  }),
  outputSchema: external_exports.object({ status: external_exports.literal("needs_user_input") }),
  phase: "asking_clarifying_questions",
  run(context, input) {
    const questions = normalizeUserQuestions(input.questions);
    context.store.updateRun(context.runId, {
      status: "needs_user_input",
      phase: "asking_clarifying_questions",
      pendingQuestions: questions
    });
    context.store.appendChatMessage(context.runId, {
      role: "assistant",
      kind: "question",
      questions
    });
    context.store.updatePublicStatus(context.runId, publicStatusForPhase("asking_clarifying_questions", "Waiting for your answer."));
    context.emit({
      type: "clarifying_questions",
      phase: "asking_clarifying_questions",
      title: "Clarifying questions",
      message: `Agent needs ${questions.length} answer${questions.length === 1 ? "" : "s"} before continuing.`,
      questions
    });
    return { status: "needs_user_input" };
  }
};
var showStatusTool = {
  name: "user.show_status",
  description: "Show a visible non-mutating status update to the user.",
  inputSchema: external_exports.object({
    title: external_exports.string().min(1).max(200),
    message: external_exports.string().min(1).max(1e3),
    level: external_exports.enum(["info", "warning", "success"]).optional()
  }),
  outputSchema: external_exports.object({ ok: external_exports.literal(true) }),
  phase: "planning_decomposition",
  run(context, input) {
    const state = context.store.getState(context.runId);
    const updated = context.store.updatePublicStatus(context.runId, publicStatusForPhase(state.phase, input.message));
    context.store.appendChatMessage(context.runId, {
      role: "assistant",
      kind: "status",
      text: input.message,
      status: updated.publicStatus
    });
    context.emit({
      type: "tool_call_completed",
      phase: state.phase,
      title: input.title,
      message: input.message,
      metadata: { level: input.level ?? "info", toolName: "user.show_status" }
    });
    context.emit({
      type: "assistant_message",
      phase: state.phase,
      title: input.title,
      message: input.message,
      metadata: { level: input.level ?? "info", toolName: "user.show_status" }
    });
    return { ok: true };
  }
};
var requestApprovalTool = {
  name: "user.request_approval",
  description: "Pause the run for user approval.",
  inputSchema: external_exports.object({
    title: external_exports.string().min(1).max(200),
    message: external_exports.string().min(1).max(1e3),
    changeSetId: external_exports.string().max(160).optional(),
    selectedChangeIds: external_exports.array(external_exports.string().max(160)).max(50).optional(),
    changeSet: external_exports.unknown().optional(),
    plan: external_exports.unknown().optional()
  }),
  outputSchema: external_exports.object({ status: external_exports.literal("waiting_approval") }),
  phase: "planning_decomposition",
  run(context, input) {
    const state = context.store.getState(context.runId);
    const approvalText = [input.title, input.message].filter(Boolean).join("\n\n");
    context.store.updateRun(context.runId, {
      status: "waiting_approval",
      phase: "planning_decomposition",
      pendingChangeSet: input.changeSet,
      pendingPlan: input.plan
    });
    context.store.appendChatMessage(context.runId, {
      role: "assistant",
      kind: "assistant_message",
      text: approvalText
    });
    context.store.updatePublicStatus(
      context.runId,
      publicStatusForPhase("planning_decomposition", input.message)
    );
    context.emit({
      type: "plan_proposed",
      phase: "planning_decomposition",
      title: input.title,
      message: input.message,
      metadata: {
        changeSetId: input.changeSetId,
        selectedChangeIds: input.selectedChangeIds ?? []
      }
    });
    context.emit({
      type: "assistant_message",
      phase: state.phase,
      title: input.title,
      message: input.message,
      metadata: { toolName: "user.request_approval" }
    });
    return { status: "waiting_approval" };
  }
};

// ../vdt-agent-runtime/src/tools/vdt-builder-tools.ts
var nodeTypeSchema = external_exports.enum(["root_kpi", "calculated", "input", "assumption", "external_factor", "data_mapped"]);
var nodeStatusSchema = external_exports.enum([
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
var edgeRelationSchema2 = external_exports.enum([
  "positive_driver",
  "negative_driver",
  "multiplicative_driver",
  "divisive_driver",
  "additive_component",
  "subtractive_component",
  "contextual_influence",
  "formula_dependency"
]);
function normalizeEnumText(value) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : void 0;
}
function normalizeNodeType(value) {
  const normalized = normalizeEnumText(value);
  if (!normalized) return value;
  if (nodeTypeSchema.options.includes(normalized)) return normalized;
  if (edgeRelationSchema2.options.includes(normalized)) {
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
function normalizeEdgeRelation(value) {
  const normalized = normalizeEnumText(value);
  if (!normalized) return value;
  if (edgeRelationSchema2.options.includes(normalized)) return normalized;
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
var nodeTypeInputSchema = external_exports.preprocess(normalizeNodeType, nodeTypeSchema);
var edgeRelationInputSchema = external_exports.preprocess(normalizeEdgeRelation, edgeRelationSchema2);
var nullToUndefined = (value) => value === null ? void 0 : value;
var optionalInput = (schema) => external_exports.preprocess(nullToUndefined, schema.optional());
var valueStatusSchema2 = external_exports.enum([
  "unknown",
  "user_provided_value",
  "default_assumption",
  "calculated",
  "partially_calculable"
]);
var valueSourceSchema2 = external_exports.object({
  sourceTier: optionalInput(external_exports.string().max(120)),
  confidence: optionalInput(external_exports.string().max(80)),
  catalogRef: optionalInput(external_exports.string().max(240)),
  acceptedByUserInDialog: optionalInput(external_exports.boolean()),
  editableInDialog: optionalInput(external_exports.boolean()),
  note: optionalInput(external_exports.string().max(500)),
  range: optionalInput(external_exports.tuple([external_exports.number().finite(), external_exports.number().finite()]))
}).strict();
var nodePatchSchema2 = external_exports.object({
  name: optionalInput(external_exports.string().min(1).max(200)),
  description: optionalInput(external_exports.string().max(1e3)),
  type: optionalInput(nodeTypeInputSchema),
  unit: optionalInput(external_exports.string().max(80)),
  formula: optionalInput(external_exports.string().max(500)),
  baselineValue: optionalInput(external_exports.number().finite()),
  value: optionalInput(external_exports.number().finite()),
  valueStatus: optionalInput(valueStatusSchema2),
  valueSource: optionalInput(valueSourceSchema2),
  status: optionalInput(nodeStatusSchema),
  assumptions: optionalInput(external_exports.array(external_exports.string().max(300)).max(20)),
  tags: optionalInput(external_exports.array(external_exports.string().max(80)).max(20)),
  controllability: optionalInput(external_exports.enum(["high", "medium", "low", "none"])),
  materiality: optionalInput(external_exports.enum(["high", "medium", "low", "unknown"]))
}).strict();
var vdtNodeIdSchema = external_exports.string().min(1).max(160).regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Node ids must be valid formula identifiers.");
var instantiateNodeOverrideSchema = nodePatchSchema2.extend({
  nodeId: optionalInput(vdtNodeIdSchema),
  relation: optionalInput(edgeRelationInputSchema),
  aiRationale: optionalInput(external_exports.string().max(800))
}).strict();
var instantiateSubtreeInputSchema = external_exports.object({
  sourceRootNodeId: external_exports.string().min(1).max(160),
  targetParentNodeId: external_exports.string().min(1).max(160),
  overrides: optionalInput(
    external_exports.record(external_exports.string().min(1).max(160), instantiateNodeOverrideSchema).refine((value) => Object.keys(value).length <= 200, "At most 200 node overrides are allowed.")
  )
}).strict();
var addDriverInputSchema = external_exports.object({
  parentNodeId: external_exports.string().min(1).max(160),
  nodeId: optionalInput(external_exports.string().max(160)),
  name: external_exports.string().min(1).max(200),
  type: optionalInput(nodeTypeInputSchema),
  unit: optionalInput(external_exports.string().max(80)),
  relation: optionalInput(edgeRelationInputSchema),
  formula: optionalInput(external_exports.string().max(500)),
  baselineValue: optionalInput(external_exports.number().finite()),
  description: optionalInput(external_exports.string().max(1e3)),
  aiRationale: optionalInput(external_exports.string().max(800)),
  assumptions: optionalInput(external_exports.array(external_exports.string().max(300)).max(20))
});
var createDraftTool = {
  name: "vdt.create_draft",
  description: "Create a draft VDT project and root KPI node.",
  inputSchema: external_exports.object({
    projectTitle: external_exports.string().min(1).max(240),
    rootKpi: external_exports.string().min(1).max(200),
    unit: optionalInput(external_exports.string().max(80)),
    timePeriod: optionalInput(external_exports.string().max(80)),
    industry: optionalInput(external_exports.string().max(160)),
    businessContext: optionalInput(external_exports.string().max(2e3)),
    goal: optionalInput(external_exports.string().max(1e3)),
    replaceExisting: optionalInput(external_exports.boolean())
  }),
  outputSchema: external_exports.record(external_exports.unknown()),
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
      ...protectedBrief.rootKpi ? { rootKpi: protectedBrief.rootKpi, projectTitle: `${protectedBrief.rootKpi} Driver Model` } : {},
      ...protectedBrief.unit ? { unit: protectedBrief.unit } : {},
      ...protectedBrief.timePeriod ? { timePeriod: protectedBrief.timePeriod } : {}
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
var addDriverTool = {
  name: "vdt.add_driver",
  description: "Add one driver node and edge under an existing parent node.",
  inputSchema: addDriverInputSchema,
  outputSchema: external_exports.record(external_exports.unknown()),
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
    const changeSet2 = requireChangeSet(result.changeSet);
    const nodeId = result.changeSet?.additions[0]?.nodeId ?? input.nodeId ?? input.name;
    const edgeId = result.changeSet?.edgeChanges[0]?.action === "add" ? result.changeSet.edgeChanges[0].edge.id : "";
    const mutation = proposeAndMaybeApplyMutation(context, {
      title: "Driver added",
      summary: result.event.message,
      changeSet: changeSet2,
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
var addDriversBatchTool = {
  name: "vdt.add_drivers_batch",
  description: `Add 2 to ${defaultProgressiveBuildPolicy.maxNodesPerLayer} sibling driver nodes under one parent in one visible layer, optionally setting that parent's explicit formula atomically.`,
  inputSchema: external_exports.object({
    drivers: external_exports.array(addDriverInputSchema).min(2).max(defaultProgressiveBuildPolicy.maxNodesPerLayer),
    parentFormula: optionalInput(external_exports.string().min(1).max(500))
  }),
  outputSchema: external_exports.record(external_exports.unknown()),
  mutatesProject: true,
  requiresDraftProject: true,
  phase: "building_graph",
  run(context, input) {
    const builder = requireBuilder(context.builder);
    const drivers = input.drivers;
    const parentNodeIds = new Set(drivers.map((driver) => driver.parentNodeId));
    if (parentNodeIds.size > 1) {
      throw new AgentToolError("MUTATION_SCOPE_VIOLATION", "Batch driver mutations must add one visible layer under a single parent node.");
    }
    const targetNodeId = drivers[0]?.parentNodeId;
    if (!targetNodeId) throw new AgentToolError("INVALID_TOOL_ARGS", "At least one driver is required.");
    const previewBuilder = cloneBuilder(context);
    const added = [];
    const changeSets = [];
    for (const driver of drivers) {
      const project = previewBuilder.getProject();
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
      const edgeId = result.changeSet?.edgeChanges[0]?.action === "add" ? result.changeSet.edgeChanges[0].edge.id : "";
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
    const summary3 = [
      `Added ${added.length} drivers: ${added.map((driver) => `"${driver.name}"`).join(", ")}.`,
      input.parentFormula ? `Set the explicit formula for "${targetNodeId}" in the same atomic change.` : void 0
    ].filter(Boolean).join(" ");
    const mutation = proposeAndMaybeApplyMutation(context, {
      title: "Drivers added",
      summary: summary3,
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
var instantiateSubtreeTool = {
  name: "vdt.instantiate_subtree",
  description: "Clone one deterministic non-root subtree under an existing parent, with new node ids, source-id-keyed overrides, and internal formula-reference remapping.",
  inputSchema: instantiateSubtreeInputSchema,
  outputSchema: external_exports.record(external_exports.unknown()),
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
      const sourceNode = nodesById.get(sourceNodeId);
      const override = overrides[sourceNodeId];
      const incomingEdge = discovered.incomingEdgeByNodeId.get(sourceNodeId);
      const targetNodeId = sourceToTargetNodeIds[sourceNodeId];
      const parentNodeId = sourceNodeId === sourceRoot.id ? input.targetParentNodeId : sourceToTargetNodeIds[incomingEdge.sourceNodeId];
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
        nodeId: sourceToTargetNodeIds[sourceNodeId],
        patch: { status }
      }];
    });
    const changeSet2 = {
      id: `changeset_${context.runId}_instantiate_${builder.getRevision() + 1}`,
      taskType: "generate_tree",
      backendId: context.getRun().request.providerId,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      additions,
      updates: statusUpdates,
      deletions: [],
      edgeChanges: [],
      assumptions: [],
      questions: [],
      warnings: []
    };
    const targetRootNodeId = sourceToTargetNodeIds[sourceRoot.id];
    const mutation = proposeAndMaybeApplyMutation(context, {
      title: "Subtree instantiated",
      summary: `Instantiated ${additions.length} nodes from "${sourceRoot.name}" under "${input.targetParentNodeId}".`,
      changeSet: changeSet2,
      targetNodeId: input.targetParentNodeId,
      allowSkillDefinedDepth: true
    });
    return {
      sourceRootNodeId: sourceRoot.id,
      targetRootNodeId,
      sourceToTargetNodeIds,
      nodeIds: additions.map((addition2) => addition2.nodeId),
      edgeIds: additions.map((addition2) => `edge_${addition2.parentNodeId}_${addition2.nodeId}`),
      revision: mutation.revision,
      validation: mutation.validation,
      mutationProposal: { id: mutation.proposal.id, status: mutation.proposal.status }
    };
  }
};
var addEdgeTool = {
  name: "vdt.add_edge",
  description: "Add one visual or formula-dependency edge between existing nodes.",
  inputSchema: external_exports.object({
    sourceNodeId: external_exports.string().min(1).max(160),
    targetNodeId: external_exports.string().min(1).max(160),
    relation: edgeRelationInputSchema,
    label: optionalInput(external_exports.string().max(120))
  }),
  outputSchema: external_exports.record(external_exports.unknown()),
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
    const changeSet2 = requireChangeSet(result.changeSet);
    const edgeId = result.changeSet?.edgeChanges[0]?.action === "add" ? result.changeSet.edgeChanges[0].edge.id : "";
    const mutation = proposeAndMaybeApplyMutation(context, {
      title: "Edge added",
      summary: result.event.message,
      changeSet: changeSet2,
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
var updateNodeTool = {
  name: "vdt.update_node",
  description: "Update allowed fields on an existing node.",
  inputSchema: external_exports.object({ nodeId: external_exports.string().min(1), patch: nodePatchSchema2 }),
  outputSchema: external_exports.record(external_exports.unknown()),
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
    const result = previewBuilder.updateNode({ nodeId: input.nodeId, patch: input.patch });
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
var deleteNodeTool = {
  name: "vdt.delete_node",
  description: "Delete one non-root node, optionally removing connected edges.",
  inputSchema: external_exports.object({
    nodeId: external_exports.string().min(1).max(160),
    cascadeEdges: external_exports.boolean().optional()
  }),
  outputSchema: external_exports.record(external_exports.unknown()),
  mutatesProject: true,
  requiresDraftProject: true,
  phase: "building_graph",
  run(context, input) {
    const builder = requireBuilder(context.builder);
    const project = builder.getProject();
    const removedEdgeIds = project.graph.edges.filter((edge) => edge.sourceNodeId === input.nodeId || edge.targetNodeId === input.nodeId).map((edge) => edge.id);
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
var setFormulaTool = {
  name: "vdt.set_formula",
  description: "Set a formula on one node after parser and reference validation.",
  inputSchema: external_exports.object({
    nodeId: external_exports.string().min(1).max(160),
    formula: external_exports.string().min(1).max(500)
  }),
  outputSchema: external_exports.record(external_exports.unknown()),
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
var validateTool = {
  name: "vdt.validate",
  description: "Validate the current draft graph and return detailed issues.",
  inputSchema: external_exports.object({}),
  outputSchema: external_exports.record(external_exports.unknown()),
  requiresDraftProject: true,
  phase: "validating_graph",
  run(context) {
    const validation = summarizeValidation(requireBuilder(context.builder).validate().validation);
    context.store.updateRun(context.runId, { validationState: validation });
    context.emit({
      type: "graph_validation",
      phase: "validating_graph",
      title: validation.valid ? "Graph validation passed" : "Graph validation found issues",
      message: validation.valid ? `Graph validation passed with ${validation.warnings.length} warning${validation.warnings.length === 1 ? "" : "s"}.` : `Graph validation found ${validation.errors.length} error${validation.errors.length === 1 ? "" : "s"}.`,
      metadata: { errors: validation.errors.length, warnings: validation.warnings.length }
    });
    return validation;
  }
};
var layoutTool = {
  name: "vdt.layout",
  description: "Layout the current draft graph.",
  inputSchema: external_exports.object({}),
  outputSchema: external_exports.record(external_exports.unknown()),
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
var calculateTool = {
  name: "vdt.calculate",
  description: "Calculate deterministic graph values and return root/calculation details.",
  inputSchema: external_exports.object({}),
  outputSchema: external_exports.record(external_exports.unknown()),
  requiresDraftProject: true,
  phase: "validating_graph",
  run(context) {
    const calculation = summarizeCalculation(requireBuilder(context.builder).calculate().calculation);
    context.store.updateRun(context.runId, { calculationState: calculation });
    return calculation;
  }
};
function discoverDeterministicSubtree(project, sourceRootNodeId) {
  const nodesById = new Map(project.graph.nodes.map((node) => [node.id, node]));
  const outgoingBySource = /* @__PURE__ */ new Map();
  const incomingByTarget = /* @__PURE__ */ new Map();
  for (const edge of project.graph.edges) {
    if (!nodesById.has(edge.sourceNodeId) || !nodesById.has(edge.targetNodeId)) {
      throw new AgentToolError(
        "INVALID_SOURCE_GRAPH",
        `Edge "${edge.id}" references a missing node; the source subtree cannot be instantiated.`
      );
    }
    outgoingBySource.set(edge.sourceNodeId, [...outgoingBySource.get(edge.sourceNodeId) ?? [], edge]);
    incomingByTarget.set(edge.targetNodeId, [...incomingByTarget.get(edge.targetNodeId) ?? [], edge]);
  }
  for (const edges of outgoingBySource.values()) edges.sort(compareEdgesDeterministically);
  for (const edges of incomingByTarget.values()) edges.sort(compareEdgesDeterministically);
  const orderedNodeIds = [];
  const discovered = /* @__PURE__ */ new Set();
  const queue = [sourceRootNodeId];
  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (discovered.has(nodeId)) continue;
    discovered.add(nodeId);
    orderedNodeIds.push(nodeId);
    if (orderedNodeIds.length > 200) {
      throw new AgentToolError("SUBTREE_TOO_LARGE", "A subtree instantiation is limited to 200 nodes.");
    }
    for (const edge of outgoingBySource.get(nodeId) ?? []) queue.push(edge.targetNodeId);
  }
  const incomingEdgeByNodeId = /* @__PURE__ */ new Map();
  for (const nodeId of orderedNodeIds) {
    const incoming = incomingByTarget.get(nodeId) ?? [];
    const internal = incoming.filter((edge) => discovered.has(edge.sourceNodeId));
    const external = incoming.filter((edge) => !discovered.has(edge.sourceNodeId));
    if (nodeId === sourceRootNodeId) {
      if (internal.length > 0 || external.length !== 1) {
        throw ambiguousSubtreeError(sourceRootNodeId, nodeId, incoming);
      }
      incomingEdgeByNodeId.set(nodeId, external[0]);
      continue;
    }
    if (internal.length !== 1 || external.length > 0) {
      throw ambiguousSubtreeError(sourceRootNodeId, nodeId, incoming);
    }
    incomingEdgeByNodeId.set(nodeId, internal[0]);
  }
  return { orderedNodeIds, incomingEdgeByNodeId };
}
function compareEdgesDeterministically(left, right) {
  if (left.targetNodeId !== right.targetNodeId) return left.targetNodeId < right.targetNodeId ? -1 : 1;
  if (left.sourceNodeId !== right.sourceNodeId) return left.sourceNodeId < right.sourceNodeId ? -1 : 1;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}
function ambiguousSubtreeError(sourceRootNodeId, nodeId, incoming) {
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
function allocateSubtreeNodeIds(orderedSourceNodeIds, sourceNodesById, overrides, existingNodeIds, sourceRootNodeId) {
  const mapping = {};
  for (const sourceNodeId of orderedSourceNodeIds) {
    const sourceNode = sourceNodesById.get(sourceNodeId);
    const override = overrides[sourceNodeId];
    const explicitNodeId = override?.nodeId;
    let baseNodeId;
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
      const targetRootNodeId = mapping[sourceRootNodeId];
      const sourcePrefix = `${sourceRootNodeId}_`;
      const suffix = sourceNodeId.startsWith(sourcePrefix) ? sourceNodeId.slice(sourceRootNodeId.length) : `_${sourceNodeId}`;
      baseNodeId = stableSnakeId(`${targetRootNodeId}${suffix}`, "driver_copy");
    }
    const targetNodeId = explicitNodeId ? baseNodeId : uniqueId(baseNodeId, existingNodeIds);
    existingNodeIds.add(targetNodeId);
    mapping[sourceNode.id] = targetNodeId;
  }
  return mapping;
}
function remapSubtreeFormula(formula, sourceNodeId, sourceNodeIds, sourceToTargetNodeIds) {
  if (!formula?.trim()) return void 0;
  let references;
  try {
    references = extractFormulaReferences(formula);
  } catch (error2) {
    throw new AgentToolError(
      "FORMULA_PARSE_ERROR",
      `Formula for source node "${sourceNodeId}" could not be parsed: ${error2 instanceof Error ? error2.message : "invalid formula"}`
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
function subtreeAddition(input) {
  const { sourceNode, override } = input;
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
    valueStatus: override?.valueStatus ?? sourceNode.valueStatus,
    valueSource: override?.valueSource ?? sourceNode.valueSource,
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
function protectedBriefFromRun(context) {
  const input = context.getRun().request.input;
  const rootKpi = input.rootKpi?.trim();
  return {
    rootKpi: rootKpi && !isPlaceholderRootKpi(rootKpi) ? rootKpi : void 0,
    unit: input.unit?.trim() || void 0,
    timePeriod: input.timePeriod?.trim() || void 0
  };
}
function isPlaceholderRootKpi(value) {
  return /^(new vdt|untitled vdt|value driver tree)$/i.test(value.trim());
}
function sameVisibleValue(left, right) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}
function assertFormulaReferencesIfPresent(project, formula, nodeId) {
  if (!formula?.trim()) return;
  let references;
  try {
    references = extractFormulaReferences(formula);
  } catch (error2) {
    throw new AgentToolError(
      "FORMULA_PARSE_ERROR",
      error2 instanceof Error ? error2.message : "Formula could not be parsed."
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
      missingReferences.map((reference) => [reference, similarNodeIds2(reference, availableNodeIds)])
    )
  });
}
function similarNodeIds2(reference, availableNodeIds) {
  return availableNodeIds.map((nodeId) => ({ nodeId, score: similarity2(reference, nodeId) })).filter((entry) => entry.score > 0.35).sort((a, b) => b.score - a.score || a.nodeId.localeCompare(b.nodeId)).slice(0, 5).map((entry) => entry.nodeId);
}
function similarity2(left, right) {
  if (left === right) return 1;
  const leftParts = new Set(left.toLowerCase().split(/[_\W]+/).filter(Boolean));
  const rightParts = new Set(right.toLowerCase().split(/[_\W]+/).filter(Boolean));
  const intersection = [...leftParts].filter((part) => rightParts.has(part)).length;
  const union = (/* @__PURE__ */ new Set([...leftParts, ...rightParts])).size || 1;
  const tokenScore = intersection / union;
  const prefixScore = right.startsWith(left) || left.startsWith(right) ? 0.5 : 0;
  return Math.max(tokenScore, prefixScore);
}

// ../vdt-agent-runtime/src/schemas/agent-first-response.ts
var publicAgentStatusSchema2 = external_exports.object({
  phase: external_exports.enum([
    "reading_request",
    "asking_questions",
    "planning_model",
    "running_subagents",
    "building_draft",
    "checking_model",
    "waiting_user",
    "ready",
    "retryable_error"
  ]),
  message: external_exports.string().min(1).max(500),
  progress: external_exports.object({
    completed: external_exports.number().finite(),
    total: external_exports.number().finite()
  }).optional()
});
var firstResponseSchema = external_exports.object({
  assistantMessage: external_exports.string().trim().min(1).max(2e3),
  nextAction: external_exports.enum(["ask_user", "continue_building"]),
  questions: external_exports.array(agentQuestionSchema2).max(5).default([]),
  publicStatus: publicAgentStatusSchema2.default({
    phase: "planning_model",
    message: "Planning the VDT from your request."
  })
});

// ../vdt-agent-runtime/src/schemas/agent-run.ts
var boundedString = (max) => external_exports.string().trim().min(1).max(max);
var optionalBoundedString = (max) => external_exports.preprocess(
  (value) => typeof value === "string" && value.trim().length === 0 ? void 0 : value,
  boundedString(max).optional()
);
var safeId2 = (max = 128) => boundedString(max).regex(
  /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
  "Must use only letters, numbers, underscores, or hyphens."
);
var researchModeSchema = external_exports.enum(["auto", "on", "off"]);
var agentStartRequestCommonShape = {
  mode: external_exports.enum(["generate_vdt", "continue_project", "deepen_node", "review_project"]),
  input: external_exports.object({
    prompt: optionalBoundedString(2e3),
    rootKpi: optionalBoundedString(160),
    industry: optionalBoundedString(160),
    businessContext: optionalBoundedString(2e3),
    unit: optionalBoundedString(80),
    timePeriod: optionalBoundedString(80),
    goal: optionalBoundedString(1e3),
    levelOfDetail: external_exports.preprocess(
      (value) => typeof value === "string" && value.trim().length === 0 ? void 0 : value,
      external_exports.union([external_exports.enum(["low", "medium", "high"]), boundedString(40)]).optional()
    ),
    project: external_exports.unknown().optional(),
    selectedNodeId: optionalBoundedString(160)
  }),
  workspace: external_exports.object({
    projectId: safeId2(),
    projectName: optionalBoundedString(160),
    industry: optionalBoundedString(160),
    description: optionalBoundedString(1e3),
    vdtId: safeId2().optional()
  }).optional(),
  options: external_exports.object({
    autoApplyPatches: external_exports.boolean().optional(),
    askBeforeFirstPatch: external_exports.boolean().optional(),
    maxSteps: external_exports.number().int().min(1).max(60).optional(),
    maxAutoDepth: external_exports.number().int().min(1).max(8).optional(),
    continueWithAssumptions: external_exports.boolean().optional(),
    researchMode: researchModeSchema.optional()
  }).optional()
};
var executionBindingStartRequestSchema = external_exports.object({
  ...agentStartRequestCommonShape,
  executionBindingId: safeId2(160)
}).strict();
var legacyProviderStartRequestSchema = external_exports.object({
  ...agentStartRequestCommonShape,
  providerId: boundedString(120),
  providerConfig: external_exports.record(external_exports.unknown()).optional()
}).strict().superRefine((value, ctx) => {
  for (const forbidden of [
    "command",
    "executable",
    "args",
    "argsText",
    "cwd",
    "env",
    "schema",
    "systemPrompt",
    "userPrompt",
    "executionProfile",
    "engineAdapterId",
    "securityConfig"
  ]) {
    if (value.providerConfig && forbidden in value.providerConfig) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["providerConfig", forbidden],
        message: `providerConfig must not include ${forbidden}.`
      });
    }
  }
});
var agentStartRequestSchema = external_exports.union([
  executionBindingStartRequestSchema,
  legacyProviderStartRequestSchema
]);

// ../vdt-agent-runtime/src/schemas/agent-message.ts
var answerValueSchema = external_exports.union([external_exports.string(), external_exports.number(), external_exports.array(external_exports.string())]);
var agentAnswerPayloadSchema = external_exports.object({
  questionId: external_exports.string().min(1).max(120),
  selectedOptionIds: external_exports.array(external_exports.string().min(1).max(160)).max(20).optional(),
  freeText: external_exports.string().max(2e3).optional(),
  fields: external_exports.record(external_exports.union([external_exports.string(), external_exports.number()])).optional()
});
var manualProjectChangeSchema = external_exports.object({
  kind: external_exports.enum([
    "node_updated",
    "node_deleted",
    "node_position_updated",
    "edge_updated",
    "project_replaced",
    "change_set_applied"
  ]),
  nodeId: external_exports.string().max(160).optional(),
  edgeId: external_exports.string().max(160).optional(),
  patch: external_exports.record(external_exports.unknown()).optional(),
  summary: external_exports.string().max(500).optional()
});
var agentUserMessageSchema = external_exports.discriminatedUnion("type", [
  external_exports.object({
    type: external_exports.literal("user_answer"),
    answers: external_exports.record(answerValueSchema).optional(),
    structuredAnswers: external_exports.array(agentAnswerPayloadSchema).max(20).optional()
  }),
  external_exports.object({
    type: external_exports.literal("manual_project_change"),
    projectRevision: external_exports.number().int().nonnegative().optional(),
    change: manualProjectChangeSchema
  }),
  external_exports.object({
    type: external_exports.literal("user_instruction"),
    text: external_exports.string().trim().min(1).max(2e3),
    selectedNodeId: external_exports.string().max(160).optional(),
    researchMode: researchModeSchema.optional()
  }),
  external_exports.object({
    type: external_exports.literal("deepen_node"),
    selectedNodeId: external_exports.string().trim().min(1).max(160)
  }),
  external_exports.object({
    type: external_exports.literal("continue_run")
  }),
  external_exports.object({
    type: external_exports.literal("approval"),
    approved: external_exports.boolean(),
    proposalId: external_exports.string().trim().min(1).max(160).optional(),
    selectedChangeIds: external_exports.array(external_exports.string().trim().min(1).max(160)).max(200).optional()
  })
]);

// ../vdt-agent-runtime/src/schemas/agent-plan.ts
var boundedString2 = (max) => external_exports.string().trim().max(max);
var nonEmptyString4 = (max) => external_exports.string().trim().min(1).max(max);
var nodeTypeSchema2 = external_exports.enum(["root_kpi", "calculated", "input", "assumption", "external_factor", "data_mapped"]);
var edgeRelationSchema3 = external_exports.enum([
  "positive_driver",
  "negative_driver",
  "multiplicative_driver",
  "divisive_driver",
  "additive_component",
  "subtractive_component",
  "contextual_influence",
  "formula_dependency"
]);
var agentPlanSchema = external_exports.object({
  buildIntent: external_exports.object({
    rootKpi: nonEmptyString4(200),
    industry: boundedString2(160),
    businessContext: boundedString2(2e3),
    unit: boundedString2(80),
    timePeriod: boundedString2(80),
    goal: boundedString2(1e3)
  }),
  selectedSkillIds: external_exports.array(nonEmptyString4(160)).max(10),
  skillRationale: nonEmptyString4(2e3),
  extractedInputs: external_exports.array(external_exports.object({
    id: nonEmptyString4(160),
    label: nonEmptyString4(160),
    value: external_exports.union([external_exports.string().trim().max(500), external_exports.number().finite()]),
    unit: boundedString2(80),
    sourceText: boundedString2(500)
  })).max(80),
  missingInputs: external_exports.array(external_exports.object({
    id: nonEmptyString4(160),
    question: nonEmptyString4(500),
    reason: nonEmptyString4(1e3),
    required: external_exports.boolean()
  })).max(40),
  driverPlan: external_exports.array(external_exports.object({
    id: nonEmptyString4(160),
    parentNodeId: nonEmptyString4(160),
    name: nonEmptyString4(200),
    type: nodeTypeSchema2,
    unit: boundedString2(80),
    relation: edgeRelationSchema3,
    formula: boundedString2(500),
    description: boundedString2(1e3),
    value: external_exports.union([external_exports.string().trim().max(500), external_exports.number().finite()]),
    assumptions: external_exports.array(boundedString2(300)).max(20)
  })).max(80),
  rootFormula: boundedString2(500),
  assumptions: external_exports.array(boundedString2(300)).max(250),
  questionsForUser: external_exports.array(boundedString2(500)).max(250),
  warnings: external_exports.array(external_exports.object({
    severity: external_exports.enum(["info", "warning", "error"]).optional(),
    message: nonEmptyString4(1e3),
    nodeId: boundedString2(160).optional(),
    edgeId: boundedString2(160).optional()
  })).max(250),
  confidence: external_exports.number().finite().min(0).max(1)
});

// ../model-bridge/src/agent-engines/cursor-acp-engine.ts
var MAX_PROMPT_BYTES = 1024 * 1024;
var MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
var MAX_QUESTION_TEXT_BYTES = 32 * 1024;
var FORBIDDEN_TOOL_PREFIXES2 = Object.freeze([
  "browser.",
  "computer.",
  "filesystem.",
  "fs.",
  "git.",
  "shell.",
  "subagent.",
  "terminal.",
  "web."
]);

// ../model-bridge/src/agent-engines/cursor-acp-transport.ts
var DEFAULT_MAX_LINE_BYTES = 4 * 1024 * 1024;
var DEFAULT_MAX_STDERR_BYTES = 256 * 1024;
var DEFAULT_MAX_OUTGOING_BYTES = 4 * 1024 * 1024;

// ../model-bridge/src/agent-engines/cursor-resume-checkpoint-transport.ts
var DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
var DEFAULT_MAX_PROMPT_BYTES = 1024 * 1024;
var MAX_ASSISTANT_TEXT_BYTES = 64 * 1024;

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

// ../local-runner/src/timeout-limits.ts
var AGENT_DECISION_TIMEOUT_MAX_MS = 3e5;

// ../local-runner/src/server/executor.ts
import { execFile as execFile7, spawn as nodeSpawn } from "node:child_process";
import { chmod, copyFile, lstat, mkdir, mkdtemp as mkdtemp3, readFile as readFile2, realpath, rm as rm3, writeFile as writeFile2 } from "node:fs/promises";
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
  "orchestrator-first-response-v1": {
    assistantMessage: "I will use the visible brief as the source of truth and start by checking the requested VDT scope.",
    nextAction: "continue_building",
    questions: [],
    publicStatus: {
      phase: "planning_model",
      message: "Planning the VDT from your request.",
      progress: { completed: 1, total: 3 }
    }
  },
  "agent-decision-v1": {
    type: "call_tool",
    toolName: "skill.search",
    args: {
      rootKpi: "Ore haulage",
      industry: "Mining",
      maxSkills: 3
    },
    statusMessage: "Searching for the most relevant VDT skill."
  },
  "agent-decision-v2": {
    type: "call_tools",
    calls: [
      { toolName: "skill.search", args: { rootKpi: "Ore haulage", industry: "Mining", maxSkills: 3 } },
      { toolName: "project.get_subtree", args: { nodeId: "root", maxDepth: 2 } }
    ],
    statusMessage: "Inspecting the most relevant VDT context."
  },
  "agent-plan-v1": {
    buildIntent: {
      rootKpi: "Ore haulage",
      industry: "",
      businessContext: "I have 5 trucks\nAverage distance 2.7 km\nAverage load speed - 7 km/h\nAverage empty speed - 11 km/h",
      unit: "tonnes/year",
      timePeriod: "year",
      goal: ""
    },
    selectedSkillIds: ["mining.haulage_truck_cycle"],
    skillRationale: "Mock planning response for a truck haulage request.",
    extractedInputs: [
      { id: "number_of_trucks", label: "Number of trucks", value: 5, unit: "trucks", sourceText: "I have 5 trucks" },
      { id: "haul_distance_km", label: "Average haul distance", value: 2.7, unit: "km", sourceText: "Average distance 2.7 km" },
      { id: "loaded_speed_kmh", label: "Average loaded speed", value: 7, unit: "km/h", sourceText: "Average load speed - 7 km/h" },
      { id: "empty_speed_kmh", label: "Average empty speed", value: 11, unit: "km/h", sourceText: "Average empty speed - 11 km/h" }
    ],
    missingInputs: [
      {
        id: "payload_per_trip_t",
        question: "What is the average payload per truck trip in tonnes?",
        reason: "Truck haulage tonnes require payload per trip.",
        required: true
      },
      {
        id: "operating_hours",
        question: "How many operating hours should the yearly period assume?",
        reason: "Trips per truck require available operating time.",
        required: true
      }
    ],
    driverPlan: [
      {
        id: "number_of_trucks",
        parentNodeId: "root",
        name: "Number of trucks",
        type: "input",
        unit: "trucks",
        relation: "multiplicative_driver",
        formula: "",
        description: "Available truck fleet size.",
        value: 5,
        assumptions: []
      },
      {
        id: "trips_per_truck",
        parentNodeId: "root",
        name: "Trips per truck",
        type: "calculated",
        unit: "trips/truck/year",
        relation: "multiplicative_driver",
        formula: "operating_hours / ((haul_distance_km / loaded_speed_kmh) + (haul_distance_km / empty_speed_kmh))",
        description: "Trips each truck can complete from cycle time and annual operating hours.",
        value: "",
        assumptions: []
      },
      {
        id: "payload_per_trip_t",
        parentNodeId: "root",
        name: "Payload per trip",
        type: "input",
        unit: "tonnes/trip",
        relation: "multiplicative_driver",
        formula: "",
        description: "Average tonnes moved per loaded trip.",
        value: "",
        assumptions: []
      },
      {
        id: "operating_hours",
        parentNodeId: "trips_per_truck",
        name: "Operating hours",
        type: "input",
        unit: "hours/year",
        relation: "formula_dependency",
        formula: "",
        description: "Available truck operating hours during the year.",
        value: "",
        assumptions: []
      },
      {
        id: "haul_distance_km",
        parentNodeId: "trips_per_truck",
        name: "Average haul distance",
        type: "input",
        unit: "km",
        relation: "divisive_driver",
        formula: "",
        description: "Average one-way loaded haul distance.",
        value: 2.7,
        assumptions: []
      },
      {
        id: "loaded_speed_kmh",
        parentNodeId: "trips_per_truck",
        name: "Average loaded speed",
        type: "input",
        unit: "km/h",
        relation: "positive_driver",
        formula: "",
        description: "Average speed while loaded.",
        value: 7,
        assumptions: []
      },
      {
        id: "empty_speed_kmh",
        parentNodeId: "trips_per_truck",
        name: "Average empty speed",
        type: "input",
        unit: "km/h",
        relation: "positive_driver",
        formula: "",
        description: "Average return speed while empty.",
        value: 11,
        assumptions: []
      }
    ],
    rootFormula: "number_of_trucks * trips_per_truck * payload_per_trip_t",
    ...advisoryStub,
    confidence: 0.5
  },
  "data-agent-decision-v1": {
    type: "tool_call",
    toolName: "table.profile",
    rationale: "Profile the detected table before proposing semantic roles.",
    input: {
      tableId: "table_1"
    }
  },
  "analyze-raw-dataset-v1": {
    datasetId: "mock_dataset",
    summary: {
      rowCount: 2,
      tableCount: 1,
      likelyDatasetKind: "operational records",
      confidence: 0.75,
      description: "Mock raw dataset analysis."
    },
    columns: [
      {
        tableId: "table_1",
        columnName: "Minutes",
        physicalType: "number",
        logicalType: "duration",
        semanticRole: "duration",
        unit: "minute",
        confidence: 0.86,
        evidence: [
          {
            type: "column_name",
            message: "Column name suggests minutes.",
            strength: "strong"
          }
        ],
        profileRef: "table_1.minutes"
      }
    ],
    metricCandidates: [
      {
        id: "metric_total_minutes",
        name: "Total Minutes",
        description: "Sum of imported minutes.",
        sourceTableId: "table_1",
        sourceColumns: ["Minutes"],
        aggregation: "sum",
        unit: "minute",
        confidence: 0.86,
        evidence: [
          {
            type: "value_pattern",
            message: "Values parse as numbers.",
            strength: "strong"
          }
        ],
        limitations: []
      }
    ],
    assumptions: ["Minutes are treated as duration."],
    questionsForUser: ["Confirm the duration unit."],
    warnings: []
  },
  "review-dataset-proposal-v1": {
    datasetId: "mock_dataset",
    summary: {
      rowCount: 2,
      tableCount: 1,
      likelyDatasetKind: "operational records",
      confidence: 0.75,
      description: "Mock reviewed dataset proposal."
    },
    columns: [],
    metricCandidates: [],
    assumptions: [],
    questionsForUser: [],
    warnings: []
  },
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
  if (schemaId === "agent-decision-v1" || schemaId === "agent-decision-v2") return mockAgentDecision(input, schemaId);
  if (isRecord9(input) && validateRegisteredSchema(schemaId, input)) return input;
  return MOCK_STUB_OUTPUT[schemaId];
}
function mockAgentDecision(input, schemaId) {
  const context = isRecord9(input) && isRecord9(input.data) ? input.data : input;
  const record = isRecord9(context) ? context : {};
  const project = isRecord9(record.currentProject) ? record.currentProject : void 0;
  const nodes = Array.isArray(project?.nodes) ? project.nodes : [];
  const nodeIds = new Set(nodes.flatMap((node) => isRecord9(node) && typeof node.id === "string" ? [node.id] : []));
  const answers = isRecord9(record.userAnswers) ? record.userAnswers : {};
  const recentEvents = Array.isArray(record.recentEvents) ? record.recentEvents : [];
  const hasTool = (toolName) => recentEvents.some((event) => {
    if (!isRecord9(event) || !isRecord9(event.metadata)) return false;
    return event.metadata.toolName === toolName;
  });
  if (schemaId === "agent-decision-v2" && !hasTool("skill.search") && !hasTool("skill.read") && !hasTool("skill.compile_recipe")) {
    return {
      type: "call_tools",
      calls: [
        { toolName: "skill.search", args: { rootKpi: "Ore haulage", industry: "Mining", maxSkills: 3 } },
        { toolName: "skill.read", args: { skillId: "mining.haulage_truck_cycle" } },
        { toolName: "skill.compile_recipe", args: { skillId: "mining.haulage_truck_cycle" } }
      ],
      statusMessage: "Finding, reading, and compiling the truck haulage skill."
    };
  }
  if (!hasTool("skill.search")) return { type: "call_tool", toolName: "skill.search", args: { rootKpi: "Ore haulage", industry: "Mining", maxSkills: 3 }, statusMessage: "Searching for the truck haulage skill." };
  if (!hasTool("skill.read")) return { type: "call_tool", toolName: "skill.read", args: { skillId: "mining.haulage_truck_cycle" }, statusMessage: "Reading the truck haulage skill." };
  if (!hasTool("skill.compile_recipe")) return { type: "call_tool", toolName: "skill.compile_recipe", args: { skillId: "mining.haulage_truck_cycle" }, statusMessage: "Compiling the truck haulage recipe." };
  if (answers.payload_per_trip_t === void 0 || answers.operating_hours === void 0) {
    return {
      type: "ask_user",
      statusMessage: "Payload and operating hours are needed to calculate annual hauled tonnes.",
      questions: [
        { id: "payload_per_trip_t", question: "What is the average payload per truck trip in tonnes?", reason: "Annual hauled tonnes require payload per completed trip.", required: true, expectedAnswerType: "number" },
        { id: "operating_hours", question: "How many operating hours per year should the model use?", reason: "Trips per truck require an operating-hours base.", required: true, expectedAnswerType: "number" }
      ]
    };
  }
  if (!project || nodeIds.size === 0) return { type: "call_tool", toolName: "vdt.create_draft", args: { projectTitle: "Ore haulage Driver Model", rootKpi: "Ore haulage", unit: "tonnes/year", timePeriod: "year", industry: "Mining" }, statusMessage: "Creating the hauled-tonnes root." };
  const payload = parseMockNumber(answers.payload_per_trip_t) ?? 40;
  const operatingHours = parseMockNumber(answers.operating_hours) ?? 4e3;
  const add = (nodeId, name, parentNodeId, extra) => ({ type: "call_tool", toolName: "vdt.add_driver", args: { parentNodeId, nodeId, name, ...extra }, statusMessage: `Adding ${name}.` });
  if (schemaId === "agent-decision-v2" && [
    "number_of_trucks",
    "trips_per_truck",
    "payload_per_trip_t",
    "operating_hours",
    "cycle_time_h",
    "loaded_travel_time_h",
    "empty_return_time_h",
    "haul_distance_km",
    "loaded_speed_kmh",
    "empty_speed_kmh"
  ].every((nodeId) => !nodeIds.has(nodeId))) {
    return {
      type: "call_tools",
      calls: [
        {
          toolName: "vdt.add_drivers_batch",
          args: {
            drivers: [
              { parentNodeId: "ore_haulage", nodeId: "number_of_trucks", name: "Number of trucks", type: "input", unit: "trucks", relation: "multiplicative_driver", baselineValue: 5 },
              { parentNodeId: "ore_haulage", nodeId: "trips_per_truck", name: "Trips per truck", type: "calculated", unit: "trips/truck/year", relation: "multiplicative_driver" },
              { parentNodeId: "ore_haulage", nodeId: "payload_per_trip_t", name: "Payload per trip", type: "input", unit: "tonnes/trip", relation: "multiplicative_driver", baselineValue: payload }
            ],
            parentFormula: "number_of_trucks * trips_per_truck * payload_per_trip_t"
          }
        },
        {
          toolName: "vdt.add_drivers_batch",
          args: {
            drivers: [
              { parentNodeId: "trips_per_truck", nodeId: "operating_hours", name: "Operating hours", type: "input", unit: "h/year", relation: "formula_dependency", baselineValue: operatingHours },
              { parentNodeId: "trips_per_truck", nodeId: "cycle_time_h", name: "Cycle time", type: "calculated", unit: "h/trip", relation: "divisive_driver" }
            ],
            parentFormula: "operating_hours / cycle_time_h"
          }
        },
        {
          toolName: "vdt.add_drivers_batch",
          args: {
            drivers: [
              { parentNodeId: "cycle_time_h", nodeId: "loaded_travel_time_h", name: "Loaded travel time", type: "calculated", unit: "h/trip", relation: "additive_component" },
              { parentNodeId: "cycle_time_h", nodeId: "empty_return_time_h", name: "Empty return time", type: "calculated", unit: "h/trip", relation: "additive_component" }
            ],
            parentFormula: "loaded_travel_time_h + empty_return_time_h"
          }
        },
        {
          toolName: "vdt.add_drivers_batch",
          args: {
            drivers: [
              { parentNodeId: "loaded_travel_time_h", nodeId: "haul_distance_km", name: "Average haul distance", type: "input", unit: "km", relation: "formula_dependency", baselineValue: 2.7 },
              { parentNodeId: "loaded_travel_time_h", nodeId: "loaded_speed_kmh", name: "Average loaded speed", type: "input", unit: "km/h", relation: "formula_dependency", baselineValue: 7 }
            ],
            parentFormula: "haul_distance_km / loaded_speed_kmh"
          }
        },
        {
          toolName: "vdt.add_driver",
          args: { parentNodeId: "empty_return_time_h", nodeId: "empty_speed_kmh", name: "Average empty speed", type: "input", unit: "km/h", relation: "formula_dependency", baselineValue: 11 }
        },
        {
          toolName: "vdt.set_formula",
          args: { nodeId: "empty_return_time_h", formula: "haul_distance_km / empty_speed_kmh" }
        }
      ],
      statusMessage: "Building the complete truck-cycle tree and its formulas."
    };
  }
  if (!nodeIds.has("number_of_trucks")) return add("number_of_trucks", "Number of trucks", "ore_haulage", { type: "input", unit: "trucks", relation: "multiplicative_driver", baselineValue: 5 });
  if (!nodeIds.has("trips_per_truck")) return add("trips_per_truck", "Trips per truck", "ore_haulage", { type: "calculated", unit: "trips/truck/year", relation: "multiplicative_driver", formula: "operating_hours / cycle_time_h" });
  if (!nodeIds.has("payload_per_trip_t")) return add("payload_per_trip_t", "Payload per trip", "ore_haulage", { type: "input", unit: "tonnes/trip", relation: "multiplicative_driver", baselineValue: payload });
  if (!nodeIds.has("operating_hours")) return add("operating_hours", "Operating hours", "trips_per_truck", { type: "input", unit: "h/year", relation: "formula_dependency", baselineValue: operatingHours });
  if (!nodeIds.has("cycle_time_h")) return add("cycle_time_h", "Cycle time", "trips_per_truck", { type: "calculated", unit: "h/trip", relation: "divisive_driver", formula: "loaded_travel_time_h + empty_return_time_h" });
  if (!nodeIds.has("loaded_travel_time_h")) return add("loaded_travel_time_h", "Loaded travel time", "cycle_time_h", { type: "calculated", unit: "h/trip", relation: "additive_component", formula: "haul_distance_km / loaded_speed_kmh" });
  if (!nodeIds.has("empty_return_time_h")) return add("empty_return_time_h", "Empty return time", "cycle_time_h", { type: "calculated", unit: "h/trip", relation: "additive_component", formula: "haul_distance_km / empty_speed_kmh" });
  if (!nodeIds.has("haul_distance_km")) return add("haul_distance_km", "Average haul distance", "loaded_travel_time_h", { type: "input", unit: "km", relation: "formula_dependency", baselineValue: 2.7 });
  if (!nodeIds.has("loaded_speed_kmh")) return add("loaded_speed_kmh", "Average loaded speed", "loaded_travel_time_h", { type: "input", unit: "km/h", relation: "formula_dependency", baselineValue: 7 });
  if (!nodeIds.has("empty_speed_kmh")) return add("empty_speed_kmh", "Average empty speed", "empty_return_time_h", { type: "input", unit: "km/h", relation: "formula_dependency", baselineValue: 11 });
  const root = nodes.find((node) => isRecord9(node) && node.id === "ore_haulage");
  if (!isRecord9(root) || typeof root.formula !== "string" || !root.formula) return { type: "call_tool", toolName: "vdt.set_formula", args: { nodeId: "ore_haulage", formula: "number_of_trucks * trips_per_truck * payload_per_trip_t" }, statusMessage: "Setting the hauled-tonnes formula." };
  if (!hasTool("vdt.calculate")) return { type: "call_tool", toolName: "vdt.calculate", args: {}, statusMessage: "Calculating the graph." };
  return { type: "finish", summary: "Built a valid truck haulage VDT.", nextSuggestedActions: ["Review payload and operating-hours assumptions."] };
}
function parseMockNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : void 0;
  if (typeof value !== "string") return void 0;
  const match = value.replace(",", ".").match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return void 0;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : void 0;
}
var EXECUTION_LIMITS = Object.freeze({
  maxPromptBytes: 512 * 1024,
  maxLineBytes: 1024 * 1024,
  maxStdoutBytes: 4 * 1024 * 1024,
  maxStderrBytes: 1024 * 1024,
  maxResultBytes: 1024 * 1024,
  maxRepairExcerptBytes: 16 * 1024,
  repairTimeoutMs: 6e4,
  timeoutMs: AGENT_DECISION_TIMEOUT_MAX_MS,
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
function isClosedStdinError(error2) {
  const code = typeof error2 === "object" && error2 !== null && "code" in error2 ? String(error2.code) : "";
  return code === "EPIPE" || code === "ERR_STREAM_DESTROYED";
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
  const schemaInstructions = schemaId === "agent-decision-v1" || schemaId === "agent-decision-v2" ? [
    "Agent decision encoding:",
    `- Return the strict fields type, toolName, argsJson, ${schemaId === "agent-decision-v2" ? "callsJson, " : ""}statusMessage, questionsJson, summary, and nextSuggestedActions.`,
    "- For call_tool, set toolName and put the tool arguments in argsJson as a JSON object string.",
    ...schemaId === "agent-decision-v2" ? [
      "- For call_tools, put 2-6 sequential {toolName,args} objects in callsJson as a JSON array string.",
      "- Never put user.ask or user.request_approval inside call_tools."
    ] : [],
    "- For call_tool, toolName must exactly match one availableTools.name from the input context.",
    "- For ask_user, put the question array in questionsJson as a JSON array string.",
    "- Never call request_user_input, ask_user, or user.ask as a tool; use type ask_user instead.",
    "- Use {} for unused argsJson, [] for unused questionsJson, an empty summary unless finishing, and a non-empty statusMessage."
  ].join("\n") : "";
  return [
    `Return only JSON matching approved schema ${request.schemaId} for VDT task ${request.taskType}.`,
    "Do not include markdown fences or commentary.",
    "Do not use tools, run commands, inspect files, edit files, or wait for user input. Answer directly from the provided request.",
    schemaInstructions,
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
  const schemaId = request.schemaId;
  const schemaInstructions = schemaId === "agent-decision-v1" || schemaId === "agent-decision-v2" ? [
    `For ${schemaId}, return strict fields type, toolName, argsJson, ${schemaId === "agent-decision-v2" ? "callsJson, " : ""}statusMessage, questionsJson, summary, and nextSuggestedActions.`,
    "Encode tool arguments as an argsJson JSON object string and user questions as a questionsJson JSON array string.",
    ...schemaId === "agent-decision-v2" ? [
      "Encode call_tools as 2-6 sequential {toolName,args} objects in the callsJson JSON array string.",
      "Never put user.ask or user.request_approval inside call_tools."
    ] : [],
    "For call_tool, toolName must exactly match one availableTools.name from the input context.",
    "Never call request_user_input, ask_user, or user.ask as a tool; use type ask_user instead.",
    "Use {} for unused argsJson, [] for unused questionsJson, and a non-empty statusMessage."
  ].join(" ") : "";
  return [
    `Repair JSON for approved schema ${request.schemaId} and VDT task ${request.taskType}.`,
    "Return exactly one corrected JSON object.",
    "Do not include markdown fences, commentary, file paths, environment values, credentials, or tokens.",
    schemaInstructions,
    JSON.stringify({
      taskType: request.taskType,
      schemaId: request.schemaId,
      validationErrors: validationSummary(request.schemaId, parsedOutput),
      invalidJsonExcerpt: truncateForRepair(invalidJson)
    })
  ].join("\n");
}
async function probeExecutableVersion(executable, versionArgs) {
  const cacheKey = await executableProbeCacheKey(executable, `version:${versionArgs.join("\0")}`);
  const cached = executableProbeCache.get(cacheKey);
  if (cached) return cached;
  const probe = probeExecutableVersionUncached(executable, versionArgs);
  executableProbeCache.set(cacheKey, probe);
  return probe;
}
var executableProbeCache = /* @__PURE__ */ new Map();
var executableHelpCache = /* @__PURE__ */ new Map();
async function executableProbeCacheKey(executable, operation) {
  try {
    const metadata = await lstat(executable);
    return `${executable}\0${metadata.size}\0${metadata.mtimeMs}\0${operation}`;
  } catch {
    return `${executable}\0unknown\0${operation}`;
  }
}
async function probeExecutableVersionUncached(executable, versionArgs) {
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
  const cacheKey = await executableProbeCacheKey(executable, `help:${needle}`);
  const cached = executableHelpCache.get(cacheKey);
  if (cached) return cached;
  const probe = executableHelpIncludesUncached(executable, needle);
  executableHelpCache.set(cacheKey, probe);
  return probe;
}
async function executableHelpIncludesUncached(executable, needle) {
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
    const promptText = await readFile2(promptPath, "utf8");
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
    let lastStreamingParseByteLength = 0;
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
      const trySettleFromStream = (force = false) => {
        if (!adapter?.parseStreamingOutput) return;
        if (streamingResult || streamingError !== void 0) return;
        const currentByteLength = byteLength7(stdout);
        if (!force && currentByteLength - lastStreamingParseByteLength < 64 * 1024) return;
        lastStreamingParseByteLength = currentByteLength;
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
      child.stdin.on("error", (error2) => {
        if (isClosedStdinError(error2)) return;
        fail(error2);
      });
      child.stdout.on("data", (chunk) => {
        const chunkText = chunk.toString();
        stdout += chunkText;
        if (byteLength7(stdout) > EXECUTION_LIMITS.maxStdoutBytes) {
          outputLimitExceeded = true;
          terminate();
          return;
        }
        trySettleFromStream(/"type"\s*:\s*"(?:result|error|done)"/.test(chunkText));
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
        if (byteLength7(stderr) > EXECUTION_LIMITS.maxStderrBytes) {
          outputLimitExceeded = true;
          terminate();
          return;
        }
        trySettleFromStream(true);
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
      try {
        if (adapter) {
          if (adapter.spawnHints?.stdin === "prompt") {
            child.stdin.end(promptText);
          } else {
            child.stdin.end();
          }
        } else {
          child.stdin.end(requestJson);
        }
      } catch (error2) {
        if (!isClosedStdinError(error2)) throw error2;
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
      if (request.schemaId === "agent-decision-v2") throw error2;
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
function appendPath(baseUrl, pathSegment) {
  return `${baseUrl.replace(/\/+$/, "")}/${pathSegment.replace(/^\/+/, "")}`;
}
function ollamaTagsUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/v1\/?$/, "").replace(/\/+$/, "")}/api/tags`;
  url.search = "";
  url.hash = "";
  return url.toString();
}
function addModelName(models, seen, value) {
  if (typeof value !== "string") return;
  const model = value.trim();
  if (!model || model.length > 160 || model.includes("\0") || seen.has(model)) return;
  seen.add(model);
  models.push(model);
}
function collectModelNames(payload) {
  const models = [];
  const seen = /* @__PURE__ */ new Set();
  const visit = (value) => {
    if (typeof value === "string") {
      addModelName(models, seen, value);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value;
    addModelName(models, seen, record.id);
    addModelName(models, seen, record.name);
    addModelName(models, seen, record.model);
    if (Array.isArray(record.data)) visit(record.data);
    if (Array.isArray(record.models)) visit(record.models);
  };
  visit(payload);
  return models;
}
async function fetchModelList(url, signal, options) {
  let response;
  let rawResponse;
  try {
    response = await (options.fetch ?? fetch)(url, {
      method: "GET",
      redirect: "error",
      signal,
      headers: { accept: "application/json" }
    });
    rawResponse = await readBoundedResponse(response);
  } catch (error2) {
    if (signal.aborted) throw abortError("Model listing was cancelled.");
    throw Object.assign(error2 instanceof Error ? error2 : new Error("Local model endpoint could not be reached."), {
      code: "LOCAL_MODEL_LIST_FAILED"
    });
  }
  if (!response.ok) {
    throw Object.assign(new Error(`Local model list failed with status ${response.status}.`), {
      code: "LOCAL_MODEL_LIST_FAILED"
    });
  }
  try {
    return collectModelNames(JSON.parse(rawResponse));
  } catch {
    throw Object.assign(new Error("Local model list returned invalid JSON."), {
      code: "INVALID_PROVIDER_RESPONSE"
    });
  }
}
async function listLocalHttpModels(manifest, signal, options) {
  if (!manifest.localHttp) return [];
  const urls = [
    appendPath(manifest.localHttp.baseUrl, "models"),
    ...manifest.id === "ollama" ? [ollamaTagsUrl(manifest.localHttp.baseUrl)] : []
  ];
  let lastError;
  for (const url of urls) {
    try {
      const models = await fetchModelList(url, signal, options);
      if (models.length > 0 || manifest.id !== "ollama") return models;
    } catch (error2) {
      lastError = error2;
    }
  }
  if (lastError) throw lastError;
  return [];
}
async function postLocalHttpChat(manifest, messages, signal, options, request, timeoutMs) {
  if (!manifest.localHttp) throw Object.assign(new Error("Backend has no local HTTP manifest."), { code: "INVALID_MANIFEST" });
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, Math.min(timeoutMs, EXECUTION_LIMITS.timeoutMs));
  timeout.unref?.();
  let response;
  let rawResponse = "";
  const responseFormats = request.schemaId === "agent-decision-v2" ? [
    {
      type: "json_schema",
      json_schema: {
        name: "vdt_agent_decision",
        strict: true,
        schema: getStrictResponseJsonSchema(request.schemaId)
      }
    },
    { type: "json_object" }
  ] : [{ type: "json_object" }];
  try {
    for (const [index, responseFormat] of responseFormats.entries()) {
      response = await (options.fetch ?? fetch)(`${manifest.localHttp.baseUrl}/chat/completions`, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: request.model ?? manifest.localHttp.defaultModel,
          temperature: 0,
          response_format: responseFormat,
          messages
        })
      });
      rawResponse = await readBoundedResponse(response);
      assertLineLimit(rawResponse);
      const strictUnsupported = index === 0 && responseFormats.length > 1 && [400, 404, 422].includes(response.status);
      if (!strictUnsupported) break;
    }
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
  if (!response) throw Object.assign(new Error("Local provider returned no response."), { code: "INVALID_PROVIDER_RESPONSE" });
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
  if (schemaId === "agent-decision-v2") {
    throw Object.assign(new Error("Backend output failed registered schema validation."), {
      code: "SCHEMA_INVALID",
      output,
      rawText: content
    });
  }
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
  if (manifest.kind === "local_http") {
    return listLocalHttpModels(manifest, signal, options);
  }
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
var ALL_VDT_TASK_TYPES = [...new Set(
  VDT_OUTPUT_SCHEMA_IDS.map((schemaId) => schemaTasks[schemaId])
)];
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
      versionArgs: ["--version"],
      authArgs: ["login"]
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
var PROVIDER_AUTH_TIMEOUT_MS = 5 * 6e4;
var PROVIDER_AUTH_MAX_BUFFER_BYTES = 128 * 1024;
var TASK_TYPES = new Set(ALL_VDT_TASK_TYPES);
var execFileAsync5 = promisify8(execFile8);
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
    authInProgress: /* @__PURE__ */ new Set(),
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
  assertManifestSupportsContract(manifest, request);
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
function assertManifestSupportsContract(manifest, request) {
  if (!isVdtSchemaId(request.schemaId) || !schemaSupportsTask(request.schemaId, request.taskType)) {
    throw new LocalRuntimeError(
      400,
      "UNSUPPORTED_CONTRACT",
      `Backend ${manifest.id} received invalid task/schema contract ${request.taskType}/${request.schemaId}.`
    );
  }
  if (!manifest.taskTypes.includes(request.taskType) || !manifest.schemaIds.includes(request.schemaId)) {
    throw new LocalRuntimeError(
      400,
      "UNSUPPORTED_CONTRACT",
      `Backend ${manifest.id} does not advertise ${request.taskType}/${request.schemaId}. Refresh or restart the VDT local runtime so it can load the current task/schema registry.`
    );
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
  const rootKpi = boundedString3(data.rootKpi) ?? boundedString3(data.projectTitle) ?? boundedString3(data.prompt);
  if (!rootKpi) return void 0;
  const request = { rootKpi };
  const industry = boundedString3(data.industry);
  const businessContext = boundedString3(data.businessContext);
  const unit = boundedString3(data.unit);
  const timePeriod = boundedString3(data.timePeriod);
  const goal = boundedString3(data.goal);
  const levelOfDetail = boundedString3(data.levelOfDetail);
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
  const targetNodeId = boundedString3(data.targetNodeId) ?? boundedString3(data.nodeId);
  const targetName = targetNameFromDeepenInput(data);
  const rootKpi = targetName ?? targetNodeId;
  if (!rootKpi) return void 0;
  const context = isRecord10(data.context) ? data.context : void 0;
  const request = { rootKpi };
  const industry = boundedString3(data.industry) ?? boundedString3(project?.industry);
  const businessContext = boundedString3(data.businessContext) ?? boundedString3(project?.businessContext) ?? boundedString3(project?.description);
  const goal = boundedString3(context?.goal);
  const targetUnit = targetUnitFromDeepenInput(data);
  if (industry) request.industry = industry;
  if (businessContext) request.businessContext = businessContext;
  if (targetUnit) request.unit = targetUnit;
  if (goal) request.goal = goal;
  return request;
}
function targetNameFromDeepenInput(data) {
  const targetNodeId = boundedString3(data.targetNodeId) ?? boundedString3(data.nodeId);
  const excerpt = isRecord10(data.excerpt) ? data.excerpt : void 0;
  const project = projectFromDeepenInput(data);
  const graph = isRecord10(project?.graph) ? project.graph : void 0;
  const nodes = Array.isArray(excerpt?.nodes) ? excerpt.nodes : Array.isArray(graph?.nodes) ? graph.nodes : [];
  const target = nodes.find((node) => isRecord10(node) && node.id === targetNodeId);
  return boundedString3(target?.name);
}
function targetUnitFromDeepenInput(data) {
  const targetNodeId = boundedString3(data.targetNodeId) ?? boundedString3(data.nodeId);
  const excerpt = isRecord10(data.excerpt) ? data.excerpt : void 0;
  const project = projectFromDeepenInput(data);
  const graph = isRecord10(project?.graph) ? project.graph : void 0;
  const nodes = Array.isArray(excerpt?.nodes) ? excerpt.nodes : Array.isArray(graph?.nodes) ? graph.nodes : [];
  const target = nodes.find((node) => isRecord10(node) && node.id === targetNodeId);
  return boundedString3(target?.unit, 80);
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
function boundedString3(value, maxLength = 2e3) {
  if (typeof value !== "string") return void 0;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : void 0;
}
function outputProjectId(output) {
  if (!isRecord10(output)) return void 0;
  return boundedString3(output.projectId) ?? boundedString3(output.rootNodeId) ?? boundedString3(output.projectTitle);
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
async function openRuntimeProviderAuth(backendId, context) {
  const manifest = context.manifests.get(backendId);
  if (!manifest) throw new LocalRuntimeError(404, "UNKNOWN_BACKEND", "Unknown backendId.");
  if (manifest.kind !== "subscription_cli") {
    throw new LocalRuntimeError(400, "AUTH_ACTION_UNAVAILABLE", "Provider authentication is only available for subscription backends.");
  }
  if (manifest.cli?.authArgs?.length) {
    if (context.authInProgress.has(backendId)) {
      throw new LocalRuntimeError(409, "AUTH_ALREADY_IN_PROGRESS", `${manifest.label} sign-in is already in progress.`);
    }
    const agentId = subscriptionAgentIdForBackend(backendId);
    if (!agentId) {
      throw new LocalRuntimeError(501, "AUTH_ACTION_UNAVAILABLE", "Provider authentication is not available for this backend.");
    }
    context.authInProgress.add(backendId);
    try {
      const detection = await detectSubscriptionCli(agentId, context.config.detection ?? {});
      if (!detection.installed || !detection.executable) {
        throw new LocalRuntimeError(404, "BACKEND_NOT_INSTALLED", `${manifest.label} is not installed.`);
      }
      const execImpl = context.config.providerAuth?.execFile ?? execFileAsync5;
      await execImpl(detection.executable, [...manifest.cli.authArgs], {
        encoding: "utf8",
        timeout: context.config.providerAuth?.timeoutMs ?? PROVIDER_AUTH_TIMEOUT_MS,
        maxBuffer: PROVIDER_AUTH_MAX_BUFFER_BYTES,
        windowsHide: true,
        shell: false,
        env: context.config.providerAuth?.env ?? process.env
      });
      const verified = await detectRuntimeSubscriptionClis(context, agentId);
      const verifiedPayload = isRecord10(verified.payload) ? verified.payload : void 0;
      const agents = Array.isArray(verifiedPayload?.agents) ? verifiedPayload.agents : [];
      const verifiedAgent = agents.find((candidate) => isRecord10(candidate) && candidate.id === agentId);
      if (!isRecord10(verifiedAgent) || verifiedAgent.status !== "ready") {
        throw new LocalRuntimeError(
          401,
          "AUTH_NOT_VERIFIED",
          `${manifest.label} sign-in finished, but the CLI still cannot run authenticated requests.`
        );
      }
      return {
        statusCode: 200,
        payload: {
          ok: true,
          backendId,
          action: "authenticated",
          label: `${manifest.label} authenticated.`
        }
      };
    } catch (error2) {
      if (error2 instanceof LocalRuntimeError) throw error2;
      const execError = error2;
      if (execError.killed || execError.code === "ETIMEDOUT" || execError.signal === "SIGTERM") {
        throw new LocalRuntimeError(408, "AUTH_TIMEOUT", `${manifest.label} sign-in timed out before browser confirmation.`);
      }
      throw new LocalRuntimeError(
        401,
        "AUTH_LOGIN_FAILED",
        `${manifest.label} sign-in did not complete. Try again or run the provider CLI login command in a terminal.`
      );
    } finally {
      context.authInProgress.delete(backendId);
    }
  }
  const action = providerAuthAction(backendId);
  if (!action) {
    throw new LocalRuntimeError(501, "AUTH_ACTION_UNAVAILABLE", "Provider authentication is not available for this backend.");
  }
  return { statusCode: 200, payload: { ok: true, backendId, ...action } };
}
function subscriptionAgentIdForBackend(backendId) {
  if (backendId === "cursor_subscription") return "cursor-agent";
  if (backendId === "codex_subscription") return "codex";
  if (backendId === "claude_subscription") return "claude";
  if (backendId === "gemini_subscription") return "gemini";
  if (backendId === "copilot_subscription") return "copilot";
  return void 0;
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
    return await openRuntimeProviderAuth(requireBackendId(message.payload), context);
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
if (process.argv[1] && fileURLToPath3(import.meta.url) === process.argv[1]) {
  runLocalRuntimeSidecar();
}
export {
  runLocalRuntimeSidecar
};
