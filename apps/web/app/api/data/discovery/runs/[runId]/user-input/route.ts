import {
  applyDiscoveryUserEdits,
  type DataDiscoveryUserEdits
} from "@vdt-studio/data-harness";
import type { SemanticLogicalType } from "@vdt-studio/vdt-core";
import { jsonError, readJsonObject } from "../../../../../vdt/storage-response";
import { readDiscoveryRun, saveDiscoveryRun } from "../../../../store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOGICAL_TYPES = new Set<SemanticLogicalType>([
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
]);

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const snapshot = await readDiscoveryRun(runId);
  if (!snapshot) {
    return jsonError("Discovery run was not found.", 404, "DATA_DISCOVERY_RUN_NOT_FOUND");
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(request);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "User input request could not be parsed.");
  }

  const edits = readUserEdits(body.edits ?? body);
  const next = applyDiscoveryUserEdits(snapshot, edits);
  await saveDiscoveryRun(next);
  return Response.json({ ok: true, snapshot: next });
}

function readUserEdits(value: unknown): DataDiscoveryUserEdits {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    disabledColumns: arrayOfRecords(input.disabledColumns).map((entry) => ({
      tableId: readString(entry.tableId),
      columnName: readString(entry.columnName)
    })).filter((entry) => entry.tableId && entry.columnName),
    columnRoles: arrayOfRecords(input.columnRoles).map((entry) => {
      const logicalType = readString(entry.logicalType);
      return {
        tableId: readString(entry.tableId),
        columnName: readString(entry.columnName),
        ...(LOGICAL_TYPES.has(logicalType as SemanticLogicalType) ? { logicalType: logicalType as SemanticLogicalType } : {}),
        ...(typeof entry.semanticRole === "string" ? { semanticRole: entry.semanticRole.trim().slice(0, 120) } : {}),
        ...(typeof entry.unit === "string" ? { unit: entry.unit.trim().slice(0, 80) } : {})
      };
    }).filter((entry) => entry.tableId && entry.columnName),
    metricEdits: arrayOfRecords(input.metricEdits).map((entry) => ({
      metricId: readString(entry.metricId),
      ...(typeof entry.name === "string" ? { name: entry.name.trim().slice(0, 200) } : {}),
      ...(Array.isArray(entry.sourceColumns) ? { sourceColumns: entry.sourceColumns.filter((item): item is string => typeof item === "string").slice(0, 20) } : {}),
      ...(isAggregation(entry.aggregation) ? { aggregation: entry.aggregation } : {}),
      ...(typeof entry.unit === "string" ? { unit: entry.unit.trim().slice(0, 80) } : {}),
      ...(typeof entry.enabled === "boolean" ? { enabled: entry.enabled } : {})
    })).filter((entry) => entry.metricId),
    taxonomyEdits: arrayOfRecords(input.taxonomyEdits).map((entry) => {
      const categories = readCategories(entry.categories);
      return {
        taxonomyId: readString(entry.taxonomyId),
        ...(typeof entry.name === "string" ? { name: entry.name.trim().slice(0, 200) } : {}),
        ...(categories ? { categories } : {})
      };
    }).filter((entry) => entry.taxonomyId)
  };
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 200) : "";
}

function isAggregation(value: unknown): value is NonNullable<DataDiscoveryUserEdits["metricEdits"]>[number]["aggregation"] {
  return value === "sum" ||
    value === "count" ||
    value === "avg" ||
    value === "min" ||
    value === "max" ||
    value === "ratio" ||
    value === "distinct_count" ||
    value === "custom";
}

function readCategories(value: unknown): NonNullable<NonNullable<DataDiscoveryUserEdits["taxonomyEdits"]>[number]["categories"]> | undefined {
  const categories = arrayOfRecords(value).map((entry) => ({
    id: readString(entry.id),
    name: readString(entry.name),
    matchRules: readMatchRules(entry.matchRules),
    subcategories: [],
    examples: Array.isArray(entry.examples)
      ? entry.examples.filter((item): item is string => typeof item === "string").slice(0, 10)
      : [],
    ...(typeof entry.rowCount === "number" && Number.isFinite(entry.rowCount) ? { rowCount: Math.max(0, Math.floor(entry.rowCount)) } : {}),
    ...(typeof entry.measureShare === "number" && Number.isFinite(entry.measureShare) ? { measureShare: clamp01(entry.measureShare) } : {}),
    confidence: typeof entry.confidence === "number" && Number.isFinite(entry.confidence) ? clamp01(entry.confidence) : 0.85
  })).filter((entry) => entry.id && entry.name && entry.matchRules.length > 0);

  return categories.length > 0 ? categories : undefined;
}

function readMatchRules(value: unknown): NonNullable<NonNullable<DataDiscoveryUserEdits["taxonomyEdits"]>[number]["categories"]>[number]["matchRules"] {
  const rules: NonNullable<NonNullable<DataDiscoveryUserEdits["taxonomyEdits"]>[number]["categories"]>[number]["matchRules"] = [];
  for (const entry of arrayOfRecords(value)) {
    const type = readString(entry.type);
    if (type === "equals" || type === "contains") {
      const ruleValue = readString(entry.value);
      if (ruleValue) rules.push({ type, value: ruleValue });
      continue;
    }
    if (type === "regex") {
      const pattern = readString(entry.pattern);
      if (pattern) rules.push({ type, pattern });
      continue;
    }
    if (type === "cluster") {
      const clusterId = readString(entry.clusterId);
      if (clusterId) rules.push({ type, clusterId });
      continue;
    }
    if (type === "manual_list") {
      const values = Array.isArray(entry.values)
        ? entry.values.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 50)
        : [];
      if (values.length > 0) rules.push({ type, values });
    }
  }
  return rules.slice(0, 20);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
