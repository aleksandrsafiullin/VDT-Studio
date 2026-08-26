import { extractBoundedJson } from "../safe-json";

export const ACTION_BATCH_MIN_CALLS = 1;
export const ACTION_BATCH_MAX_CALLS = 6;
export const DEFAULT_ACTION_BATCH_MAX_BYTES = 128 * 1024;

const CONTROL_TOOL_NAMES = new Set([
  "user.ask",
  "approval.request",
  "user.request_approval",
  "run.request_finish"
]);

const FORBIDDEN_TOOL_PREFIXES = Object.freeze([
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

const FORBIDDEN_TOOL_EXACT_NAMES = new Set([
  "bash",
  "edit",
  "exec",
  "fetch",
  "glob",
  "grep",
  "read",
  "shell",
  "subagent",
  "task",
  "terminal",
  "webfetch",
  "websearch",
  "write"
]);

const FORBIDDEN_AUTHORITY_KEYS = new Set([
  "actor",
  "actorid",
  "backend",
  "backendid",
  "bindingid",
  "capability",
  "capabilitytoken",
  "cwd",
  "database",
  "databasepath",
  "dbpath",
  "engineadapterid",
  "executable",
  "executionepoch",
  "expectedrevision",
  "idempotencykey",
  "leasegeneration",
  "model",
  "ownertoken",
  "permissions",
  "profile",
  "projectid",
  "provider",
  "providerid",
  "runid",
  "sessionid",
  "sqlitepath",
  "toolcataloghash"
]);

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_TOOL_NAME = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/;
const MAX_VALUE_DEPTH = 16;
const MAX_VALUE_NODES = 10_000;

export interface CheckpointActionCall {
  readonly externalCallId: string;
  readonly toolName: string;
  readonly args: Readonly<Record<string, unknown>>;
}

export interface CheckpointActionBatch {
  readonly calls: readonly CheckpointActionCall[];
}

export interface ParseCheckpointActionBatchOptions {
  readonly allowedToolNames: ReadonlySet<string> | readonly string[];
  readonly maxBytes?: number;
}

export type ActionBatchContractErrorCode =
  | "ACTION_BATCH_AUTHORITY_FIELD_FORBIDDEN"
  | "ACTION_BATCH_CONTROL_TOOL_MIXED"
  | "ACTION_BATCH_INVALID"
  | "ACTION_BATCH_TOO_LARGE"
  | "ACTION_BATCH_TOOL_NOT_ALLOWED"
  | "SECURITY_BOUNDARY_BREACH";

export class ActionBatchContractError extends Error {
  readonly code: ActionBatchContractErrorCode;
  readonly path?: string;

  constructor(code: ActionBatchContractErrorCode, message: string, path?: string) {
    super(message);
    this.name = "ActionBatchContractError";
    this.code = code;
    if (path !== undefined) this.path = path;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function normalizedKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isSecurityBoundaryToolName(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return FORBIDDEN_TOOL_EXACT_NAMES.has(normalized)
    || FORBIDDEN_TOOL_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    || normalized.startsWith("mcp__");
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
  const expectedKeys = new Set(expected);
  for (const key of Object.keys(value)) {
    if (!expectedKeys.has(key)) {
      throw new ActionBatchContractError(
        "ACTION_BATCH_INVALID",
        `Unexpected field ${path}.${key}.`,
        `${path}.${key}`
      );
    }
  }
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) {
      throw new ActionBatchContractError(
        "ACTION_BATCH_INVALID",
        `Missing required field ${path}.${key}.`,
        `${path}.${key}`
      );
    }
  }
}

function validateAndFreezeValue(value: unknown, path: string, state: { nodes: number }, depth = 0): unknown {
  state.nodes += 1;
  if (state.nodes > MAX_VALUE_NODES) {
    throw new ActionBatchContractError(
      "ACTION_BATCH_TOO_LARGE",
      `Action batch arguments exceed ${MAX_VALUE_NODES} values.`,
      path
    );
  }
  if (depth > MAX_VALUE_DEPTH) {
    throw new ActionBatchContractError(
      "ACTION_BATCH_TOO_LARGE",
      `Action batch arguments exceed nesting depth ${MAX_VALUE_DEPTH}.`,
      path
    );
  }

  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ActionBatchContractError("ACTION_BATCH_INVALID", `Non-finite number at ${path}.`, path);
    }
    return value;
  }
  if (Array.isArray(value)) {
    const items = value.map((item, index) => validateAndFreezeValue(item, `${path}[${index}]`, state, depth + 1));
    return Object.freeze(items);
  }
  if (!isRecord(value)) {
    throw new ActionBatchContractError("ACTION_BATCH_INVALID", `Unsupported value at ${path}.`, path);
  }

  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, item] of Object.entries(value)) {
    const keyPath = `${path}.${key}`;
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      throw new ActionBatchContractError("ACTION_BATCH_INVALID", `Unsafe object key at ${keyPath}.`, keyPath);
    }
    if (FORBIDDEN_AUTHORITY_KEYS.has(normalizedKey(key))) {
      throw new ActionBatchContractError(
        "ACTION_BATCH_AUTHORITY_FIELD_FORBIDDEN",
        `Server-owned authority field is forbidden at ${keyPath}.`,
        keyPath
      );
    }
    output[key] = validateAndFreezeValue(item, keyPath, state, depth + 1);
  }
  return Object.freeze(output);
}

function parseInput(raw: unknown, maxBytes: number): unknown {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new ActionBatchContractError("ACTION_BATCH_INVALID", "maxBytes must be a positive integer.");
  }
  if (typeof raw !== "string") return raw;
  try {
    return extractBoundedJson(raw, maxBytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Action batch JSON is invalid.";
    const code = /exceeds/i.test(message) ? "ACTION_BATCH_TOO_LARGE" : "ACTION_BATCH_INVALID";
    throw new ActionBatchContractError(code, message);
  }
}

/**
 * Strictly decodes the checkpoint protocol. Authority fields are deliberately
 * absent: the VDT Tool Gateway derives them from its server-owned run binding.
 */
export function parseCheckpointActionBatch(
  raw: unknown,
  options: ParseCheckpointActionBatchOptions
): CheckpointActionBatch {
  const maxBytes = options.maxBytes ?? DEFAULT_ACTION_BATCH_MAX_BYTES;
  const parsed = parseInput(raw, maxBytes);
  if (!isRecord(parsed)) {
    throw new ActionBatchContractError("ACTION_BATCH_INVALID", "Action batch must be a JSON object.");
  }
  assertExactKeys(parsed, ["calls"], "batch");
  if (!Array.isArray(parsed.calls)) {
    throw new ActionBatchContractError("ACTION_BATCH_INVALID", "batch.calls must be an array.", "batch.calls");
  }
  if (parsed.calls.length < ACTION_BATCH_MIN_CALLS || parsed.calls.length > ACTION_BATCH_MAX_CALLS) {
    throw new ActionBatchContractError(
      "ACTION_BATCH_INVALID",
      `batch.calls must contain ${ACTION_BATCH_MIN_CALLS}-${ACTION_BATCH_MAX_CALLS} calls.`,
      "batch.calls"
    );
  }

  const allowedToolNames = options.allowedToolNames instanceof Set
    ? options.allowedToolNames
    : new Set(options.allowedToolNames);
  const externalCallIds = new Set<string>();
  const calls: CheckpointActionCall[] = [];

  for (let index = 0; index < parsed.calls.length; index += 1) {
    const path = `batch.calls[${index}]`;
    const candidate = parsed.calls[index];
    if (!isRecord(candidate)) {
      throw new ActionBatchContractError("ACTION_BATCH_INVALID", `${path} must be an object.`, path);
    }
    assertExactKeys(candidate, ["externalCallId", "toolName", "args"], path);
    if (typeof candidate.externalCallId !== "string" || !SAFE_IDENTIFIER.test(candidate.externalCallId)) {
      throw new ActionBatchContractError(
        "ACTION_BATCH_INVALID",
        `${path}.externalCallId is invalid.`,
        `${path}.externalCallId`
      );
    }
    if (externalCallIds.has(candidate.externalCallId)) {
      throw new ActionBatchContractError(
        "ACTION_BATCH_INVALID",
        `Duplicate externalCallId ${candidate.externalCallId}.`,
        `${path}.externalCallId`
      );
    }
    externalCallIds.add(candidate.externalCallId);

    if (typeof candidate.toolName !== "string") {
      throw new ActionBatchContractError("ACTION_BATCH_INVALID", `${path}.toolName is invalid.`, `${path}.toolName`);
    }
    if (isSecurityBoundaryToolName(candidate.toolName)) {
      throw new ActionBatchContractError(
        "SECURITY_BOUNDARY_BREACH",
        `Tool ${candidate.toolName} attempted a forbidden execution or foreign-tool capability.`,
        `${path}.toolName`
      );
    }
    if (!SAFE_TOOL_NAME.test(candidate.toolName)) {
      throw new ActionBatchContractError("ACTION_BATCH_INVALID", `${path}.toolName is invalid.`, `${path}.toolName`);
    }
    const toolName = candidate.toolName;
    if (!allowedToolNames.has(toolName)) {
      throw new ActionBatchContractError(
        "ACTION_BATCH_TOOL_NOT_ALLOWED",
        `Tool ${toolName} is not in this session's VDT allowlist.`,
        `${path}.toolName`
      );
    }
    if (!isRecord(candidate.args)) {
      throw new ActionBatchContractError("ACTION_BATCH_INVALID", `${path}.args must be an object.`, `${path}.args`);
    }

    const args = validateAndFreezeValue(candidate.args, `${path}.args`, { nodes: 0 });
    calls.push(Object.freeze({
      externalCallId: candidate.externalCallId,
      toolName,
      args: args as Readonly<Record<string, unknown>>
    }));
  }

  if (calls.length > 1) {
    const controlCall = calls.find((call) => CONTROL_TOOL_NAMES.has(call.toolName));
    if (controlCall) {
      throw new ActionBatchContractError(
        "ACTION_BATCH_CONTROL_TOOL_MIXED",
        `${controlCall.toolName} must be the only call in an action batch.`,
        "batch.calls"
      );
    }
  }

  return Object.freeze({
    calls: Object.freeze(calls)
  });
}
