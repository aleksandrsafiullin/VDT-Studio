import type { AppleGuidedShape } from "@vdt-studio/local-runner/apple-foundation-models";
import type { ZodError } from "zod";

type FieldPath = readonly (string | number)[];

export const APPLE_TOOL_ARGUMENT_MAX_BYTES = 12_288;

export interface AppleFormatIssue {
  readonly field: FieldPath;
  readonly requirement: string;
}

export const formatRepairDecision = {
  name: "repairDecision",
  shape: { kind: "choice", choices: ["repair", "decline"] },
  description: "Choose repair to submit the corrected fragment or decline if it cannot preserve the request."
} as const;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safePath(path: readonly PropertyKey[]): path is FieldPath {
  return path.length <= 8 && path.every(part => typeof part === "number"
    ? Number.isSafeInteger(part) && part >= 0
    : typeof part === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(part)
      && part !== "constructor" && part !== "prototype");
}

function canReplace(value: unknown, path: FieldPath): boolean {
  const [key, ...rest] = path;
  if (key === undefined) return false;
  if (typeof key === "number" ? !Array.isArray(value) || key >= value.length : !object(value)) return false;
  const own = Object.hasOwn(value as object, key);
  const child = own ? (value as Record<string | number, unknown>)[key] : undefined;
  if (rest.length) return own && canReplace(child, rest);
  // A collection error cannot authorize replacing its valid members.
  return child === null || typeof child !== "object" || !Object.keys(child).length;
}

function updateField(value: unknown, path: FieldPath, replacement: unknown, omit = false): unknown {
  const [key, ...rest] = path;
  if (key === undefined) return replacement;
  if (Array.isArray(value)) return value.map((child, index) => index === key ? updateField(child, rest, replacement, omit) : child);
  const record = value as Record<string, unknown>;
  const updated = { ...record };
  if (omit && !rest.length) delete updated[key];
  else updated[key] = updateField(Object.hasOwn(record, key) ? record[key] : undefined, rest, replacement, omit);
  return updated;
}

export interface AppleArgumentFormatRepair {
  readonly issues: readonly AppleFormatIssue[];
  /** A replacement at the empty path regenerates undecodable arguments for this tool alone. */
  readonly replacePaths: readonly FieldPath[];
  readonly omitPaths: readonly FieldPath[];
  readonly replacementShape?: AppleGuidedShape;
  readonly retainedArguments?: Readonly<Record<string, unknown>>;
}

export function repairToolArgumentDecoding(error: unknown): AppleArgumentFormatRepair {
  return { replacePaths: [[]], omitPaths: [], issues: [{ field: [], requirement: error instanceof SyntaxError
    ? "Return valid JSON for this tool's arguments."
    : "Return a JSON object within the argument size limit." }] };
}

export function repairToolArgumentFields(args: Readonly<Record<string, unknown>>, error: ZodError): AppleArgumentFormatRepair | undefined {
  if (!error.issues.length || error.issues.length > 8 || Buffer.byteLength(JSON.stringify(args)) > 2_400) return;
  const issues: AppleFormatIssue[] = [];
  const replacePaths = new Map<string, FieldPath>();
  const omitPaths: FieldPath[] = [];
  let replacementShape: AppleGuidedShape | undefined;
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        const field = [...issue.path, key];
        if (!safePath(field) || omitPaths.length === 8) return;
        omitPaths.push(field);
        issues.push({ field, requirement: "Omit this field. The tool schema does not allow it." });
      }
    } else {
      const field = issue.path;
      if (!field.length || !safePath(field) || !canReplace(args, field)) return;
      replacePaths.set(JSON.stringify(field), field);
      if (issue.code === "invalid_type") {
        const type = issue.expected;
        if (type === "string") replacementShape = { kind: "string" };
        else if (type === "boolean") replacementShape = { kind: "boolean" };
        else if (type === "number") replacementShape = { kind: "number" };
        else if (type === "int") replacementShape = { kind: "integer" };
      }
      issues.push({ field, requirement: issue.code === "invalid_type"
        ? `Required type: ${issue.expected}.`
        : `Satisfy the tool schema constraint (${issue.code}).` });
    }
  }
  const paths = [...replacePaths.values(), ...omitPaths];
  if (paths.length > 8 || paths.some((path, index) => paths.some((other, otherIndex) => index !== otherIndex
    && path.length <= other.length && path.every((part, offset) => part === other[offset])))) return;
  return { issues, replacePaths: [...replacePaths.values()], omitPaths,
    ...(replacePaths.size === 1 && replacementShape ? { replacementShape } : {}), retainedArguments: args };
}

export function applyToolArgumentRepair(repair: AppleArgumentFormatRepair, replacement: unknown): Readonly<Record<string, unknown>> {
  const { replacePaths, omitPaths, retainedArguments } = repair;
  let result: unknown = retainedArguments;
  for (const path of omitPaths) result = updateField(result, path, undefined, true);
  if (replacePaths.length) {
    let fragment = replacement;
    if (!repair.replacementShape) {
      if (typeof replacement !== "string" || Buffer.byteLength(replacement) > APPLE_TOOL_ARGUMENT_MAX_BYTES) throw new Error("Invalid repair fragment.");
      fragment = JSON.parse(replacement);
    }
    const replacements = replacePaths.length === 1 ? [fragment] : fragment;
    if (!Array.isArray(replacements) || replacements.length !== replacePaths.length) throw new Error("Invalid repair fragments.");
    result = replacePaths.reduce<unknown>((candidate, path, index) => updateField(candidate, path, replacements[index]), result);
  } else if (replacement !== undefined) {
    throw new Error("An omission approval takes no replacement.");
  }
  if (!object(result) || Buffer.byteLength(JSON.stringify(result)) > APPLE_TOOL_ARGUMENT_MAX_BYTES) throw new Error("Invalid repaired arguments.");
  return result;
}
