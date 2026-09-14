/** Shared Zod-issue diagnostic for questions and tool arguments.
 * Paths, codes, and expected types only — never model-supplied values. */

const SAFE_SCHEMA_ISSUE_LABEL = /^[A-Za-z0-9_.-]{1,64}$/;
const ZOD_PARSED_TYPES = new Set([
  "string",
  "number",
  "bigint",
  "boolean",
  "symbol",
  "undefined",
  "object",
  "function",
  "map",
  "nan",
  "integer",
  "float",
  "date",
  "array",
  "unknown",
  "promise",
  "void",
  "never",
  "set",
  "null"
]);

export const SCHEMA_ISSUE_SUMMARY_MAX_ISSUES = 6;
export const SCHEMA_ISSUE_SUMMARY_MAX_CHARS = 480;

export interface SchemaIssueSummaryInput {
  readonly path: readonly PropertyKey[];
  readonly code: string;
  readonly keys?: readonly string[];
  readonly expected?: unknown;
  readonly received?: unknown;
}

function safeLabel(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_SCHEMA_ISSUE_LABEL.test(value) ? value : undefined;
}

function parsedTypeLabel(value: unknown): string | undefined {
  return typeof value === "string" && ZOD_PARSED_TYPES.has(value) ? value : undefined;
}

function pathLabel(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "<root>";
  return path
    .map((segment) => {
      const text = String(segment);
      return SAFE_SCHEMA_ISSUE_LABEL.test(text) ? text : "<unrecognized>";
    })
    .join(".");
}

function extra(issue: SchemaIssueSummaryInput): string {
  const keys = (issue.keys ?? [])
    .filter((key) => SAFE_SCHEMA_ISSUE_LABEL.test(key))
    .slice(0, 8)
    .join("|");
  if (keys) return `: ${keys}`;
  if (issue.code !== "invalid_type") return "";
  const expected = parsedTypeLabel(issue.expected);
  const received = parsedTypeLabel(issue.received);
  if (!expected && !received) return "";
  return `: ${[expected ? `expected=${expected}` : undefined, received ? `received=${received}` : undefined]
    .filter(Boolean)
    .join(" ")}`;
}

export function schemaIssueSummary(issues: readonly SchemaIssueSummaryInput[]): string {
  const seen = new Set<string>();
  for (const issue of issues) {
    if (seen.size >= SCHEMA_ISSUE_SUMMARY_MAX_ISSUES) break;
    const code = safeLabel(issue.code) ?? "<unrecognized>";
    seen.add(`${pathLabel(issue.path)} (${code}${extra(issue)})`);
  }
  const truncated = issues.length > seen.size;
  let summary = [...seen].join(", ");
  if (truncated) summary = `${summary}, …`;
  if (summary.length <= SCHEMA_ISSUE_SUMMARY_MAX_CHARS) return summary;
  return `${summary.slice(0, SCHEMA_ISSUE_SUMMARY_MAX_CHARS - 1)}…`;
}

/** Same helper as schemaIssueSummary; kept for question-payload call sites. */
export const questionSchemaIssueSummary = schemaIssueSummary;
