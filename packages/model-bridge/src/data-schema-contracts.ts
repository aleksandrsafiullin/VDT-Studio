/** Canonical, closed contracts for the three experimental data-discovery tasks. */
export const DATA_DISCOVERY_SCHEMA_IDS = ["data-agent-decision-v1", "analyze-raw-dataset-v1", "review-dataset-proposal-v1"] as const;
export type DataDiscoverySchemaId = (typeof DATA_DISCOVERY_SCHEMA_IDS)[number];
type JsonSchema = Record<string, unknown>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function object(properties: Record<string, unknown>, required: string[] = Object.keys(properties)): JsonSchema {
  return { type: "object", properties, required, additionalProperties: false };
}
const text = (maxLength = 500): JsonSchema => ({ type: "string", minLength: 1, maxLength });
const choice = (...values: string[]): JsonSchema => ({ type: "string", enum: values });
const array = (items: JsonSchema, maxItems: number, minItems = 0): JsonSchema => ({ type: "array", items, minItems, maxItems });
const integer = (minimum: number, maximum: number): JsonSchema => ({ type: "integer", minimum, maximum });
const confidence = { type: "number", minimum: 0, maximum: 1 };
const id = text(200);
const column = text(500);
const strings = array({ type: "string", maxLength: 12_000 }, 250);

// Human confirmation and clarification answers intentionally have no provider field.
const incomingKpiProposal = object({
  tableId: id,
  categoryColumns: array(column, 4, 1),
  duration: { anyOf: [
    object({ mode: { const: "column", type: "string" }, column, unit: choice("seconds", "minutes", "hours", "days", "target") }),
    object({ mode: { const: "timestamps", type: "string" }, startColumn: column, endColumn: column, format: choice("iso", "excel_serial", "dmy", "mdy"), timezoneOffsetMinutes: integer(-840, 840) }, ["mode", "startColumn", "endColumn"])
  ] },
  numberFormat: choice("decimal_dot", "decimal_comma"),
  normalization: { anyOf: [
    object({ mode: { const: "period_total", type: "string" } }),
    object({ mode: { const: "per_day", type: "string" }, basis: choice("calendar_days", "operating_days", "entity_days"), denominator: { type: "number", exclusiveMinimum: 0, maximum: Number.MAX_SAFE_INTEGER } }, ["mode", "basis"])
  ] },
  period: object({ start: { ...text(10), pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, end: { ...text(10), pattern: "^\\d{4}-\\d{2}-\\d{2}$" } }),
  missingCategoryPolicy: { type: "string", const: "include_unknown" }
}, []);

const evidence = object({
  type: choice("column_name", "value_pattern", "distribution", "aggregation_result", "data_quality", "cross_column_relationship", "user_confirmation", "model_reasoning"),
  message: text(1000), strength: choice("weak", "medium", "strong"), observationRef: text(200)
}, ["type", "message", "strength"]);
const rawColumn = object({
  tableId: id, columnName: text(200), physicalType: choice("string", "number", "date", "boolean", "mixed", "unknown"),
  logicalType: choice("identifier", "category", "text", "measure", "duration", "timestamp", "date", "currency", "percentage", "status", "other"),
  semanticRole: text(120), unit: text(80), confidence, evidence: array(evidence, 12, 1), profileRef: text(240)
}, ["tableId", "columnName", "physicalType", "logicalType", "confidence", "evidence", "profileRef"]);
const metric = object({
  id, name: text(200), description: text(800), sourceTableId: id, sourceColumns: array(text(200), 20, 1),
  aggregation: choice("sum", "count", "avg", "min", "max", "ratio", "distinct_count", "custom"), unit: text(80), formula: text(1000), dimensions: array(id, 20),
  confidence, evidence: array(evidence, 12, 1), limitations: array({ type: "string", maxLength: 500 }, 10)
}, ["id", "name", "description", "sourceTableId", "sourceColumns", "aggregation", "confidence", "evidence", "limitations"]);
const rawAnalysis = object({
  datasetId: id,
  incomingKpiOptions: incomingKpiProposal,
  summary: object({ rowCount: integer(0, Number.MAX_SAFE_INTEGER), tableCount: integer(0, 25), likelyDatasetKind: text(200), confidence, description: text(1000) }),
  columns: array(rawColumn, 500), metricCandidates: array(metric, 50), assumptions: strings, questionsForUser: strings, warnings: strings
}, ["datasetId", "summary", "columns", "metricCandidates", "assumptions", "questionsForUser", "warnings"]);

const table = object({ tableId: id });
const tablePreview = object({ tableId: id, limit: integer(1, 50) }, ["tableId"]);
const columnInput = object({ tableId: id, columnName: column });
const groupedFields = { tableId: id, dimension: column, measure: column, aggregation: choice("sum", "count", "avg", "min", "max", "distinct_count"), limit: integer(1, 100) };
const noInputTools = [
  "file.inspect", "file.preview_raw", "file.detect_tables", "table.list", "table.profile", "table.quality_report", "table.flatten_json",
  "text.suggest_taxonomy_candidates", "text.classification_diagnostics", "semantic.detect_entities", "semantic.detect_measures", "semantic.detect_dimensions", "semantic.detect_events", "semantic.build_dataset_summary",
  "vdt.project_excerpt", "vdt.find_matching_nodes", "vdt.propose_metric_bindings", "vdt.validate_formula_candidates", "vdt.validate_change_set"
];
function tool(names: string[], input: JsonSchema): JsonSchema {
  return object({ type: { type: "string", const: "tool_call" }, toolName: choice(...names), rationale: text(1000), input });
}
// The union is its own root. No empty root object can contradict its typed branches.
const decision: JsonSchema = { anyOf: [
  tool(noInputTools, object({})),
  tool(["table.preview", "table.sample"], tablePreview),
  tool(["table.select_columns"], object({ tableId: id, columns: array(column, 80, 1), limit: integer(1, 50) }, ["tableId", "columns"])),
  tool(["column.profile", "column.detect_type", "column.detect_unit", "column.semantic_role_candidates", "column.sample_values", "column.value_distribution", "column.parse_candidates", "table.outliers", "text.normalize_values", "text.cluster_values", "text.extract_keywords"], columnInput),
  tool(["table.group_by"], object(groupedFields, ["tableId", "dimension"])),
  tool(["table.pivot"], object({ ...groupedFields, pivot: column }, ["tableId", "dimension", "pivot"])),
  tool(["table.time_series"], object({ ...groupedFields, dateColumn: column, grain: choice("day", "week", "month") }, ["tableId", "dimension", "dateColumn"])),
  tool(["table.correlate"], object({ tableId: id, leftColumn: column, rightColumn: column })),
  tool(["table.duplicates"], object({ tableId: id, columns: array(column, 80) }, ["tableId"])),
  tool(["table.cardinality_matrix"], table),
  object({ type: { type: "string", const: "final_proposal" }, rationale: text(2000), result: rawAnalysis }),
  object({ type: { type: "string", const: "ask_user" }, questions: array(text(500), 5, 1), rationale: text(1000) })
] };

export const DATA_DISCOVERY_JSON_SCHEMAS: Record<DataDiscoverySchemaId, JsonSchema> = {
  "data-agent-decision-v1": decision,
  "analyze-raw-dataset-v1": rawAnalysis,
  "review-dataset-proposal-v1": rawAnalysis
};
export function isDataDiscoverySchemaId(value: string): value is DataDiscoverySchemaId {
  return (DATA_DISCOVERY_SCHEMA_IDS as readonly string[]).includes(value);
}

/** Nullable optional fields carry missing knowledge without inventing a mapping. */
export function strictDataDiscoverySchema(schemaId: DataDiscoverySchemaId): JsonSchema {
  return strictSchema(DATA_DISCOVERY_JSON_SCHEMAS[schemaId]);
}
function strictSchema(schema: JsonSchema): JsonSchema {
  if (Array.isArray(schema.anyOf)) return { ...schema, anyOf: schema.anyOf.map((branch) => strictSchema(branch as JsonSchema)) };
  if (schema.type === "array") return { ...schema, items: strictSchema(schema.items as JsonSchema) };
  if (schema.type !== "object") return { ...schema };
  const properties = schema.properties as Record<string, JsonSchema>;
  const required = new Set(schema.required as string[]);
  return object(Object.fromEntries(Object.entries(properties).map(([key, child]) => [key,
    required.has(key) ? strictSchema(child) : { anyOf: [strictSchema(child), { type: "null" }] }
  ])));
}

/** Only known optional properties may lose null; unknown and required nulls survive rejection. */
export function normalizeDataDiscoveryOutput(schemaId: DataDiscoverySchemaId, output: unknown): unknown {
  return normalizeOptionalNulls(DATA_DISCOVERY_JSON_SCHEMAS[schemaId], output);
}
function normalizeOptionalNulls(schema: JsonSchema, value: unknown): unknown {
  if (Array.isArray(schema.anyOf)) {
    const branches = (schema.anyOf as JsonSchema[]).filter((branch) => matchesDiscriminators(branch, value));
    return branches.length === 1 ? normalizeOptionalNulls(branches[0]!, value) : value;
  }
  if (schema.type === "array" && Array.isArray(value)) return value.map((item) => normalizeOptionalNulls(schema.items as JsonSchema, item));
  if (schema.type !== "object" || !record(value)) return value;
  const properties = schema.properties as Record<string, JsonSchema>;
  const required = new Set(schema.required as string[]);
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (!Object.hasOwn(properties, key)) return [[key, item]];
    const child = properties[key]!;
    if (item === null && !required.has(key)) return [];
    return [[key, normalizeOptionalNulls(child, item)]];
  }));
}
function matchesDiscriminators(schema: JsonSchema, value: unknown): boolean {
  if (!record(value) || !record(schema.properties)) return false;
  return Object.entries(schema.properties).every(([key, property]) => {
    if (!["type", "toolName", "mode"].includes(key) || !record(property)) return true;
    if ("const" in property) return Object.hasOwn(value, key) && value[key] === property.const;
    if (Array.isArray(property.enum)) return Object.hasOwn(value, key) && property.enum.includes(value[key]);
    return true;
  });
}

export function validateDataDiscoveryOutput(schemaId: DataDiscoverySchemaId, value: unknown): { valid: boolean; errors: string[] } {
  const errors = validate(DATA_DISCOVERY_JSON_SCHEMAS[schemaId], value, "$");
  return { valid: errors.length === 0, errors };
}

/** Full checks used only by these three contracts; unrelated legacy validation is unchanged. */
function validate(schema: JsonSchema, value: unknown, path: string): string[] {
  if (Array.isArray(schema.anyOf)) {
    const results = (schema.anyOf as JsonSchema[]).map((branch) => validate(branch, value, path));
    return results.some((errors) => errors.length === 0) ? [] : results.flat().slice(0, 16);
  }
  const errors: string[] = [];
  if (schema.type === "object") {
    if (!record(value)) return [`${path} must be an object.`];
    const properties = schema.properties as Record<string, JsonSchema>;
    for (const key of schema.required as string[]) if (!Object.hasOwn(value, key)) errors.push(`${path}.${key} is required.`);
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(properties, key)) errors.push(`${path}.${key} is not an approved field.`);
      else errors.push(...validate(properties[key]!, item, `${path}.${key}`));
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) return [`${path} must be an array.`];
    if (typeof schema.minItems === "number" && value.length < schema.minItems) errors.push(`${path} has too few items.`);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) errors.push(`${path} has too many items.`);
    value.forEach((item, index) => errors.push(...validate(schema.items as JsonSchema, item, `${path}[${index}]`)));
  } else if (schema.type === "string") {
    if (typeof value !== "string") return [`${path} must be a string.`];
    if (typeof schema.minLength === "number" && value.length < schema.minLength) errors.push(`${path} is too short.`);
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) errors.push(`${path} is too long.`);
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) errors.push(`${path} has an invalid format.`);
  } else if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) return [`${path} must be a finite number.`];
    if (schema.type === "integer" && !Number.isInteger(value)) errors.push(`${path} must be an integer.`);
    if (typeof schema.minimum === "number" && value < schema.minimum) errors.push(`${path} is below the minimum.`);
    if (typeof schema.maximum === "number" && value > schema.maximum) errors.push(`${path} exceeds the maximum.`);
    if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) errors.push(`${path} must be greater than ${schema.exclusiveMinimum}.`);
  }
  if ("const" in schema && schema.const !== value) errors.push(`${path} must equal ${String(schema.const)}.`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errors.push(`${path} is not an allowed value.`);
  return errors;
}
