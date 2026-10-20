import type { VdtChangeSet, VdtNode, VdtSemanticDatasetModel } from "@vdt-studio/vdt-core";
import { z } from "zod";
import type { AnalyzeRawDatasetInput, DataTable } from "./index";

export const INCOMING_KPI_LIMITS = { maxDepth: 4, maxNodes: 200 } as const;

export interface IncomingKpiOptions {
  tableId?: string | undefined;
  categoryColumns?: string[] | undefined;
  duration?:
    | { mode: "column"; column: string; unit: "seconds" | "minutes" | "hours" | "days" | "target" }
    | { mode: "timestamps"; startColumn: string; endColumn: string; format?: "iso" | "excel_serial" | "dmy" | "mdy" | undefined; timezoneOffsetMinutes?: number | undefined }
    | undefined;
  numberFormat?: "decimal_dot" | "decimal_comma" | undefined;
  normalization?:
    | { mode: "period_total" }
    | { mode: "per_day"; basis: "calendar_days" | "operating_days" | "entity_days"; denominator?: number | undefined }
    | undefined;
  period?: { start: string; end: string } | undefined;
  missingCategoryPolicy?: "include_unknown" | undefined;
  clarificationAnswers?: Record<string, string> | undefined;
  confirmed?: boolean | undefined;
}

export const incomingKpiOptionsSchema: z.ZodType<IncomingKpiOptions> = z.object({
  tableId: z.string().min(1).max(200).optional(),
  categoryColumns: z.array(z.string().min(1).max(500)).max(80).optional(),
  duration: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("column"), column: z.string().min(1).max(500), unit: z.enum(["seconds", "minutes", "hours", "days", "target"]) }),
    z.object({ mode: z.literal("timestamps"), startColumn: z.string().min(1).max(500), endColumn: z.string().min(1).max(500), format: z.enum(["iso", "excel_serial", "dmy", "mdy"]).optional(), timezoneOffsetMinutes: z.number().finite().int().min(-840).max(840).optional() })
  ]).optional(),
  numberFormat: z.enum(["decimal_dot", "decimal_comma"]).optional(),
  normalization: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("period_total") }),
    z.object({ mode: z.literal("per_day"), basis: z.enum(["calendar_days", "operating_days", "entity_days"]), denominator: z.number().finite().positive().optional() })
  ]).optional(),
  period: z.object({ start: z.string().max(40), end: z.string().max(40) }).optional(),
  missingCategoryPolicy: z.literal("include_unknown").optional(),
  clarificationAnswers: z.record(z.string().max(4000)).optional(),
  confirmed: z.boolean().optional()
});

export interface IncomingKpiQuestion {
  id: string;
  field: string;
  message: string;
  required: true;
}

export interface IncomingKpiReview {
  targetNodeId: string;
  options: IncomingKpiOptions;
  questions: IncomingKpiQuestion[];
  hierarchy: Array<{
    nodeId: string;
    parentNodeId: string;
    name: string;
    depth: number;
    path: Array<{ column: string; value: string }>;
    baselineValue?: number | undefined;
    unit?: string | undefined;
    description: string;
  }>;
  coverage: { totalRows: number; includedRows: number; excludedRows: number; categoryCount: number; complete: boolean };
  calculation?: string | undefined;
  blockingReasons: string[];
  clarifications?: Array<{ id: string; question: string; answer?: string | undefined }> | undefined;
}

export interface IncomingKpiBreakdown {
  review: IncomingKpiReview;
  additions: VdtChangeSet["additions"];
  updates: VdtChangeSet["updates"];
}

const DURATION_HOURS = { seconds: 1 / 3600, minutes: 1 / 60, hours: 1, days: 24, target: 1 };
const DAY_MS = 86_400_000;

/** All arithmetic and partitions use complete local rows. Model suggestions never execute code. */
export function buildIncomingKpiBreakdown(
  input: AnalyzeRawDatasetInput,
  tables: DataTable[],
  model: VdtSemanticDatasetModel,
  sourceId: string,
  targetNodeId: string
): IncomingKpiBreakdown {
  const target = input.project.graph.nodes.find((node) => node.id === targetNodeId);
  const supplied = input.incomingKpiOptions ?? {};
  const options: IncomingKpiOptions = { ...inferIncomingOptions(tables, model, target), ...supplied };
  const questions: IncomingKpiQuestion[] = [];
  const blockingReasons: string[] = [];
  const ask = (field: string, message: string) => {
    if (!questions.some((question) => question.field === field)) questions.push({ id: `incoming_${field}`, field, message, required: true });
  };
  const table = tables.find((candidate) => candidate.tableId === options.tableId);
  const excelEncoding = options.duration?.mode === "column" ? table?.columnEncodings?.[options.duration.column] : undefined;
  if (excelEncoding === "excel_duration_days" && options.duration?.mode === "column") {
    // Excel time/duration cells serialize as fractions of a day regardless of
    // their displayed hours/minutes or a model/user's suggested header unit.
    options.duration = { ...options.duration, unit: "days" };
  }
  const review: IncomingKpiReview = {
    targetNodeId, options, questions, hierarchy: [],
    coverage: { totalRows: table?.rows.length ?? 0, includedRows: 0, excludedRows: 0, categoryCount: 0, complete: false },
    blockingReasons
  };
  const result: IncomingKpiBreakdown = { review, additions: [], updates: [] };
  if (!target) blockingReasons.push("The selected KPI no longer exists. Select a KPI and analyze the file again.");
  if (!table) ask("tableId", "Choose the source table to use for this breakdown.");
  if (table?.layoutIssue) blockingReasons.push(table.layoutIssue);
  if (excelEncoding === "mixed_excel_duration") blockingReasons.push("The selected value column mixes Excel time/duration encodings with ordinary numeric or text cells. Export a consistent numeric duration unit before importing; no partial or guessed baseline will be calculated.");
  if (excelEncoding === "excel_datetime") blockingReasons.push("The selected value column contains Excel date/timestamp encodings. Choose start and end timestamp columns or export numeric durations in a consistent unit; date serials cannot be treated as ordinary values.");
  if (table?.truncated) blockingReasons.push(`Table "${table.name}" was truncated. Use a complete extract within the row and column limits; partial baselines are not calculated.`);
  if (target && (target.formula?.trim() || input.project.graph.edges.some((edge) => edge.sourceNodeId === targetNodeId))) {
    blockingReasons.push("The selected KPI already has a formula or incoming KPIs. Choose an undecomposed KPI; the existing decomposition will be preserved.");
  }
  const categoryColumns = options.categoryColumns ?? [];
  if (categoryColumns.length === 0) ask("categoryColumns", "Choose one or more category columns in parent-to-child order.");
  if (categoryColumns.length > INCOMING_KPI_LIMITS.maxDepth) blockingReasons.push(`The breakdown exceeds ${INCOMING_KPI_LIMITS.maxDepth} category levels. Choose fewer category columns; no partial hierarchy will be created.`);
  if (new Set(categoryColumns).size !== categoryColumns.length) blockingReasons.push("Each category column must appear only once in the hierarchy.");
  if (table && categoryColumns.some((column) => !table.columns.includes(column))) blockingReasons.push("A selected category column does not exist in the chosen table.");
  if (table && categoryColumns.some((column) => table.rows.some((row) => (row[column] ?? "").length > 2000))) blockingReasons.push("A category value exceeds 2,000 characters. Use concise category labels in the source extract; no categories will be shortened or omitted.");
  if (!options.duration) ask("duration", "Choose an additive numeric value column in the KPI's base unit, a duration column and unit, or start and end timestamp columns.");
  if (table && options.duration) {
    const fields = options.duration.mode === "column" ? [options.duration.column] : [options.duration.startColumn, options.duration.endColumn];
    if (fields.some((field) => !table.columns.includes(field))) blockingReasons.push("A value, duration or timestamp column does not exist in the chosen table.");
    if (fields.some((field) => categoryColumns.includes(field))) blockingReasons.push("Value, duration and timestamp columns cannot also be category columns.");
    if (options.duration.mode === "timestamps" && options.duration.startColumn === options.duration.endColumn) blockingReasons.push("Start and end must use different timestamp columns.");
    if (options.duration.mode === "timestamps" && !options.duration.format) ask("timestampFormat", "Confirm the timestamp format; ambiguous dates and Excel serial dates are not guessed.");
  }
  if (!options.normalization) ask("normalization", "Choose a period total or a per-day average, and confirm the denominator basis.");
  const perDay = options.normalization?.mode === "per_day" ? options.normalization : undefined;
  let denominator = 1;
  if (perDay) {
    if (!options.period || !validCalendarDate(options.period.start) || !validCalendarDate(options.period.end) || options.period.start > options.period.end) {
      ask("period", "Confirm the inclusive start and end dates of the reporting period (YYYY-MM-DD).");
    }
    if (!Number.isFinite(perDay.denominator) || (perDay.denominator ?? 0) <= 0) {
      ask("denominator", "Confirm a positive denominator, including zero-event days. Choose calendar days, operating days, or entity-days explicitly.");
    } else {
      denominator = perDay.denominator!;
      if (perDay.basis === "calendar_days" && options.period && validCalendarDate(options.period.start) && validCalendarDate(options.period.end)) {
        const calendarDays = (Date.parse(options.period.end) - Date.parse(options.period.start)) / DAY_MS + 1;
        if (denominator !== calendarDays) ask("denominator", `The inclusive calendar period contains ${calendarDays} days. Confirm that denominator or choose a different denominator basis.`);
      }
    }
  }
  if (options.period && (!validCalendarDate(options.period.start) || !validCalendarDate(options.period.end) || options.period.start > options.period.end)) {
    if (!questions.some((question) => question.field === "period")) ask("period", "The reporting period must contain valid inclusive YYYY-MM-DD dates in chronological order.");
  }
  if (table && categoryColumns.some((column) => table.rows.some((row) => !(row[column] ?? "").trim())) && options.missingCategoryPolicy !== "include_unknown") {
    ask("missingCategoryPolicy", "Some category cells are blank. Confirm that these rows belong in an explicit Unspecified category.");
  }
  if (!options.confirmed) ask("confirmed", "Review and confirm the detected table, hierarchy order, calculation and reporting period before staging.");
  if (!target || !table || blockingReasons.length > 0 || categoryColumns.length === 0 || !options.duration) return result;

  const values: number[] = [];
  let invalidRows = 0;
  let ambiguousNumbers = false;
  let ambiguousTimestamps = false;
  let outsidePeriodRows = 0;
  for (const row of table.rows) {
    let hours: number | undefined;
    if (options.duration.mode === "column") {
      const parsed = parseDurationNumber(row[options.duration.column] ?? "", table.numericColumns?.includes(options.duration.column) ? "decimal_dot" : options.numberFormat);
      ambiguousNumbers ||= parsed.ambiguous;
      hours = parsed.value === undefined ? undefined : parsed.value * DURATION_HOURS[options.duration.unit];
    } else {
      const start = parseTimestamp(row[options.duration.startColumn] ?? "", options.duration, table.excelDateSystem);
      const end = parseTimestamp(row[options.duration.endColumn] ?? "", options.duration, table.excelDateSystem);
      ambiguousTimestamps ||= start.ambiguous || end.ambiguous;
      if (start.value !== undefined && end.value !== undefined && end.value >= start.value) hours = (end.value - start.value) / 3_600_000;
      if (options.period && validCalendarDate(options.period.start) && validCalendarDate(options.period.end) && start.value !== undefined && end.value !== undefined) {
        const startLocal = timestampLocalTime(start.value, row[options.duration.startColumn] ?? "", options.duration);
        const endLocal = timestampLocalTime(end.value, row[options.duration.endColumn] ?? "", options.duration);
        if (startLocal < Date.parse(options.period.start) || endLocal > Date.parse(options.period.end) + DAY_MS) outsidePeriodRows += 1;
      }
    }
    const additiveNumeric = options.duration.mode === "column" && options.duration.unit === "target" && !durationUnit(target.unit?.split("/")[0]?.trim() ?? "");
    if (hours === undefined || !Number.isFinite(hours) || hours < 0 && !additiveNumeric) invalidRows += 1;
    values.push(hours ?? NaN);
  }
  review.coverage.includedRows = table.rows.length - invalidRows;
  review.coverage.excludedRows = invalidRows;
  if (ambiguousNumbers) ask("numberFormat", "Confirm decimal-dot or decimal-comma number format. Thousands separators and mixed numeric formats are not inferred.");
  if (ambiguousTimestamps) ask("timestampFormat", "Confirm the date format and timezone offset for timestamps without an explicit offset. Invalid dates and overnight rollover are not inferred.");
  if (invalidRows > 0) blockingReasons.push(`${invalidRows} of ${table.rows.length} rows have missing, invalid, negative or ambiguous duration values. Correct the file or mapping; no rows are silently excluded.`);
  if (outsidePeriodRows > 0) blockingReasons.push(`${outsidePeriodRows} events fall outside the confirmed extract period in the source's local calendar time. Choose the matching period or correct the extract. Reporting dates do not filter or clip source rows.`);
  if (table.rows.length === 0) blockingReasons.push("The selected table contains no data rows.");

  const outputUnit = resolveOutputUnit(target, options.normalization?.mode, options.duration.mode === "column" && options.duration.unit === "target");
  if (!outputUnit) ask("normalization", "The target KPI unit is incompatible with this additive calculation. Use the target base unit for numeric values or a compatible duration unit. Ratios, percentages and non-day rates require a separate calculation definition.");
  const factor = outputUnit?.factor ?? 1;
  const durationText = options.duration.mode === "column"
    ? options.duration.unit === "target"
      ? `SUM(${options.duration.column} [${target.unit?.split("/")[0]?.trim() || "target KPI base unit"}]); no unit conversion`
      : `SUM(${options.duration.column} [${options.duration.unit}]) converted to ${outputUnit?.label ?? "hours"} (factor ${DURATION_HOURS[options.duration.unit] * factor})`
    : `SUM((${options.duration.endColumn} - ${options.duration.startColumn}) / 3600000) hours converted to ${outputUnit?.label ?? "hours"} (factor ${factor}); timestamp format ${options.duration.format ?? "unconfirmed"}${options.duration.format === "excel_serial" ? `; Excel ${table.excelDateSystem ?? "1900"} date system` : ""}${options.duration.timezoneOffsetMinutes !== undefined ? `; UTC offset ${options.duration.timezoneOffsetMinutes} minutes` : ""}`;
  review.calculation = `${durationText}${perDay ? ` / ${denominator} ${perDay.basis}` : " (period total)"}${excelEncoding === "excel_duration_days" ? "; Excel duration encoding: serialized days across all relevant cells" : ""}; all source rows, reporting dates do not filter rows`;
  if (blockingReasons.length > 0 || !outputUnit || !options.normalization) return result;
  const paths = new Map<string, { path: Array<{ column: string; value: string }>; rows: number[]; parentKey: string }>();
  for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex += 1) {
    const path: Array<{ column: string; value: string }> = [];
    let parentKey = "";
    for (const column of categoryColumns) {
      path.push({ column, value: (table.rows[rowIndex]?.[column] ?? "").trim() });
      const key = JSON.stringify(path);
      if (!paths.has(key)) paths.set(key, { path: [...path], rows: [], parentKey });
      paths.get(key)!.rows.push(rowIndex);
      parentKey = key;
    }
  }
  review.coverage.categoryCount = paths.size;
  if (paths.size > INCOMING_KPI_LIMITS.maxNodes) {
    blockingReasons.push(`The complete hierarchy needs ${paths.size} KPIs, above the ${INCOMING_KPI_LIMITS.maxNodes} KPI limit. Choose fewer category columns or a grouped source extract; no categories will be omitted.`);
    return result;
  }
  if (!Number.isFinite(preciseSum(values) * factor / denominator) || [...paths.values()].some((branch) => !Number.isFinite(preciseSum(branch.rows.map((index) => values[index]!)) * factor / denominator))) {
    blockingReasons.push("The complete duration total exceeds the supported numeric range. Correct the source units or values; no partial hierarchy will be created.");
    return result;
  }
  const usedIds = new Set(input.project.graph.nodes.map((node) => node.id));
  const idByKey = new Map<string, string>();
  for (const [key] of paths) {
    const base = `file_kpi_${stableId(`${input.datasetId}:${targetNodeId}:${key}`)}`;
    let nodeId = base;
    let suffix = 1;
    while (usedIds.has(nodeId)) nodeId = `${base}_${suffix++}`;
    usedIds.add(nodeId);
    idByKey.set(key, nodeId);
  }
  for (const [key, branch] of paths) {
    const nodeId = idByKey.get(key)!;
    const name = branch.path.at(-1)?.value || "Unspecified (blank)";
    const childIds = [...paths].filter(([, child]) => child.parentKey === key).map(([childKey]) => idByKey.get(childKey)!);
    const baselineValue = preciseSum(branch.rows.map((index) => values[index]!)) * factor / denominator;
    const filters = branch.path.map((part) => ({ column: part.column, operator: "equals" as const, value: part.value }));
    const description = describeSource(input, table, branch.path, review.calculation, options, branch.rows.length, table.rows.length);
    const parentNodeId = idByKey.get(branch.parentKey) ?? targetNodeId;
    result.additions.push({
      id: `add_${nodeId}`, nodeId, parentNodeId, relation: "formula_dependency",
      name, description, type: childIds.length ? "calculated" : "data_mapped", unit: outputUnit.label,
      baselineValue: round(baselineValue), valueStatus: "calculated",
      ...(childIds.length ? { formula: childIds.join(" + ") } : {}),
      valueSource: { sourceTier: "file", confidence: "high", note: description },
      aiConfidence: 0.9,
      aiRationale: `Complete, mutually exclusive partition by ${branch.path.map((part) => part.column).join(" > ")}.`,
      tags: ["data_discovery", "incoming_kpi", "incoming_kpi_breakdown"],
      dataMapping: {
        sourceId, tableId: table.tableId,
        field: options.duration.mode === "column" ? options.duration.column : options.duration.startColumn,
        aggregation: "sum", unit: outputUnit.label, transform: review.calculation,
        filters, dimensions: categoryColumns,
        confidence: 0.9,
        evidence: [{ type: "aggregation_result", message: description, strength: "strong" }]
      }
    });
    review.hierarchy.push({ nodeId, parentNodeId, name, depth: branch.path.length, path: branch.path, baselineValue: round(baselineValue), unit: outputUnit.label, description });
  }
  review.coverage.complete = invalidRows === 0;
  const rootChildren = result.additions.filter((addition) => addition.parentNodeId === targetNodeId);
  if (rootChildren.length) result.updates.push({
    id: `update_${targetNodeId}_incoming_formula`, nodeId: targetNodeId,
    patch: { type: targetNodeId === input.project.rootNodeId ? "root_kpi" : "calculated", formula: rootChildren.map((addition) => addition.nodeId).join(" + "), ...(target.unit !== outputUnit.label ? { unit: outputUnit.label } : {}), aiRationale: `Complete file breakdown from ${input.file.fileName}.` }
  });
  return result;
}

function inferIncomingOptions(tables: DataTable[], model: VdtSemanticDatasetModel, target: VdtNode | undefined): IncomingKpiOptions {
  const options: IncomingKpiOptions = {};
  const table = tables.length === 1 ? tables[0] : undefined;
  if (!table) return options;
  options.tableId = table.tableId;
  const columns = model.tables.find((candidate) => candidate.tableId === table.tableId)?.columns ?? [];
  const categories = columns.filter((column) => ["category", "status"].includes(column.logicalType) && !/date|time|equipment|asset|machine|дата|время|экскаватор|машин/i.test(column.columnName));
  if (categories.length === 1) options.categoryColumns = [categories[0]!.columnName];
  else if (categories.length > 1 && categories.length <= INCOMING_KPI_LIMITS.maxDepth) {
    const ordered = inferNestedCategoryOrder(table, categories.map((column) => column.columnName));
    if (ordered) options.categoryColumns = ordered;
  }
  const measures = columns.filter((column) => column.logicalType === "duration" || column.physicalType === "number" && (durationUnitFromHeader(column.columnName) || table.columnEncodings?.[column.columnName] === "excel_duration_days"));
  if (measures.length === 1) {
    const measure = measures[0]!;
    const excelDurationFormat = table.columnEncodings?.[measure.columnName] === "excel_duration_days";
    const unit = excelDurationFormat ? "days" : durationUnitFromHeader(measure.columnName);
    if (unit) options.duration = { mode: "column", column: measure.columnName, unit };
  }
  if (!options.duration) {
    const starts = columns.filter((column) => column.semanticRole === "event_start" || /^(start|begin|начало)/i.test(column.columnName));
    const ends = columns.filter((column) => column.semanticRole === "event_end" || /^(end|finish|окончание|конец)/i.test(column.columnName));
    if (starts.length === 1 && ends.length === 1) {
      const allIso = table.rows.every((row) => [starts[0]!.columnName, ends[0]!.columnName].every((column) => /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d\d:\d\d)$/.test(row[column] ?? "")));
      options.duration = { mode: "timestamps", startColumn: starts[0]!.columnName, endColumn: ends[0]!.columnName, ...(allIso ? { format: "iso" } : {}) };
    }
  }
  if (!options.duration && target?.unit && !durationUnit(target.unit.split("/")[0]!.trim())) {
    const numeric = columns.filter((column) => column.physicalType === "number" && column.logicalType !== "identifier" && !/(^id$|_id$|code$|номер|код)/i.test(column.columnName));
    if (numeric.length === 1) options.duration = { mode: "column", column: numeric[0]!.columnName, unit: "target" };
  }
  if (!target || !/\/\s*(day|d|сут|день)|per\s*day|daily|в\s*сут|за\s*сут|в\s*день/i.test(`${target.unit ?? ""} ${target.name}`)) options.normalization = { mode: "period_total" };
  return options;
}

function inferNestedCategoryOrder(table: DataTable, columns: string[]): string[] | undefined {
  const uniqueCounts = new Map(columns.map((column) => [column, new Set(table.rows.map((row) => (row[column] ?? "").trim())).size]));
  const ordered = [...columns].sort((a, b) => uniqueCounts.get(a)! - uniqueCounts.get(b)!);
  for (let index = 1; index < ordered.length; index += 1) {
    if (uniqueCounts.get(ordered[index - 1]!) === uniqueCounts.get(ordered[index]!)) return undefined;
    const parentByChild = new Map<string, string>();
    for (const row of table.rows) {
      const parent = (row[ordered[index - 1]!] ?? "").trim();
      const child = (row[ordered[index]!] ?? "").trim();
      if (parentByChild.has(child) && parentByChild.get(child) !== parent) return undefined;
      parentByChild.set(child, parent);
    }
  }
  return ordered;
}

function durationUnit(unit: string): "seconds" | "minutes" | "hours" | "days" | undefined {
  if (/^(s|sec|secs|second|seconds|сек|секунд|секунда|секунды)$/i.test(unit)) return "seconds";
  if (/^(m|min|mins|minute|minutes|мин|минут|минута|минуты)$/i.test(unit)) return "minutes";
  if (/^(h|hr|hrs|hour|hours|ч|час|часа|часов|часы)$/i.test(unit)) return "hours";
  if (/^(d|day|days|сутки|суток|день|дня|дней)$/i.test(unit)) return "days";
  return undefined;
}

function durationUnitFromHeader(header: string): "seconds" | "minutes" | "hours" | "days" | undefined {
  if (/second|\bsecs?\b|сек/i.test(header)) return "seconds";
  if (/minute|\bmins?\b|мин/i.test(header)) return "minutes";
  if (/hour|\bhrs?\b|час|\(h\)/i.test(header)) return "hours";
  if (/\bdays?\b|сут|дней/i.test(header)) return "days";
  return undefined;
}

function resolveOutputUnit(target: VdtNode, normalization: string | undefined, numericInTargetUnit: boolean): { label: string; factor: number } | undefined {
  const label = target.unit?.trim();
  if (!label && numericInTargetUnit) return undefined;
  if (!label) return normalization === "per_day" ? { label: "h/day", factor: 1 } : { label: "hour", factor: 1 };
  const base = label.split("/")[0]!.trim();
  const unit = durationUnit(base);
  if (!unit && !numericInTargetUnit) return undefined;
  if (numericInTargetUnit && /%|percent|ratio|fraction|процент|доля/i.test(label)) return undefined;
  const hasRate = label.includes("/");
  if (hasRate && !/\/\s*(day|days|d|сутки|суток|день|дней)\s*$/i.test(label)) return undefined;
  if (hasRate && normalization !== "per_day") return undefined;
  return { label: normalization === "per_day" ? (hasRate ? label : `${label}/day`) : label, factor: numericInTargetUnit ? 1 : 1 / DURATION_HOURS[unit!] };
}

function parseDurationNumber(value: string, format: IncomingKpiOptions["numberFormat"]): { value?: number; ambiguous: boolean } {
  const trimmed = value.trim();
  if (!trimmed) return { ambiguous: false };
  if (!format && /,|\s/.test(trimmed)) return { ambiguous: true };
  if (!format && /^[+-]?\d{1,3}\.\d{3}$/.test(trimmed)) return { ambiguous: true };
  const pattern = format === "decimal_comma" ? /^[+-]?\d+(?:,\d+)?$/ : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  if (!pattern.test(trimmed)) return { ambiguous: false };
  const number = Number(format === "decimal_comma" ? trimmed.replace(",", ".") : trimmed);
  return Number.isFinite(number) ? { value: number, ambiguous: false } : { ambiguous: false };
}

function parseTimestamp(value: string, options: Extract<NonNullable<IncomingKpiOptions["duration"]>, { mode: "timestamps" }>, excelDateSystem: DataTable["excelDateSystem"]): { value?: number; ambiguous: boolean } {
  if (!value.trim()) return { ambiguous: false };
  if (!options.format) return { ambiguous: true };
  if (options.format === "excel_serial") {
    if (!/^\d+(?:\.\d+)?$/.test(value.trim())) return { ambiguous: false };
    const serial = Number(value);
    if (serial < (excelDateSystem === "1904" ? 0 : 61) || !Number.isFinite(serial)) return { ambiguous: false };
    if (options.timezoneOffsetMinutes === undefined) return { ambiguous: true };
    return { value: Math.round((serial - (excelDateSystem === "1904" ? 24107 : 25569)) * DAY_MS) - options.timezoneOffsetMinutes * 60_000, ambiguous: false };
  }
  let iso = value.trim();
  if (options.format === "dmy" || options.format === "mdy") {
    const match = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})[ T](\d{1,2}):(\d\d)(?::(\d\d))?$/.exec(iso);
    if (!match) return { ambiguous: false };
    const month = options.format === "dmy" ? match[2]! : match[1]!;
    const day = options.format === "dmy" ? match[1]! : match[2]!;
    iso = `${match[3]}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${match[4]!.padStart(2, "0")}:${match[5]}:${match[6] ?? "00"}`;
  }
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d\d):(\d\d)(?::(\d\d)(?:\.(\d{1,3}))?)?(Z|[+-]\d\d:\d\d)?$/.exec(iso);
  if (!match || !validCalendarDate(match[1]!) || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4] ?? 0) > 59) return { ambiguous: false };
  if (!match[6] && (options.timezoneOffsetMinutes === undefined || !Number.isFinite(options.timezoneOffsetMinutes) || Math.abs(options.timezoneOffsetMinutes) > 840)) return { ambiguous: true };
  const normalized = iso.replace(" ", "T");
  const milliseconds = Date.parse(match[6] ? normalized : `${normalized}Z`) - (match[6] ? 0 : options.timezoneOffsetMinutes! * 60_000);
  return Number.isFinite(milliseconds) ? { value: milliseconds, ambiguous: false } : { ambiguous: false };
}

function validCalendarDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}

function timestampLocalTime(milliseconds: number, original: string, options: Extract<NonNullable<IncomingKpiOptions["duration"]>, { mode: "timestamps" }>): number {
  const zone = /(Z|([+-])(\d\d):(\d\d))$/.exec(original.trim());
  const offset = zone ? zone[1] === "Z" ? 0 : (zone[2] === "-" ? -1 : 1) * (Number(zone[3]) * 60 + Number(zone[4])) : options.timezoneOffsetMinutes ?? 0;
  return milliseconds + offset * 60_000;
}

function describeSource(input: AnalyzeRawDatasetInput, table: DataTable, path: Array<{ column: string; value: string }>, calculation: string, options: IncomingKpiOptions, rows: number, totalRows: number): string {
  const duration = options.duration!;
  const columns = duration.mode === "column" ? duration.column : `${duration.startColumn}, ${duration.endColumn}`;
  const period = options.period ? `${options.period.start}–${options.period.end} inclusive` : "reporting period not specified (period total)";
  return `Source: ${input.file.fileName}; table: ${table.name} (${table.tableId}); columns: ${columns}; categories: ${path.map((part) => `${part.column} = ${part.value || "Unspecified [blank]"}`).join(" > ")}; calculation: ${calculation}; period: ${period}; rows: ${rows}/${totalRows}; dataset: ${input.file.contentHash}; stored source: ${input.file.storageRef}${input.file.sourceUrl ? `; source download: ${input.file.sourceUrl}` : ""}.`;
}

function stableId(value: string): string {
  let hash = 2166136261;
  let second = 5381;
  for (let index = 0; index < value.length; index += 1) { hash = Math.imul(hash ^ value.charCodeAt(index), 16777619); second = Math.imul(second, 33) ^ value.charCodeAt(index); }
  return `${(hash >>> 0).toString(36)}_${(second >>> 0).toString(36)}`;
}

function preciseSum(values: number[]): number {
  let sum = 0;
  let compensation = 0;
  for (const value of values) { const adjusted = value - compensation; const next = sum + adjusted; compensation = (next - sum) - adjusted; sum = next; }
  return sum;
}

function round(value: number): number { return Number(value.toPrecision(15)); }
