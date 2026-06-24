import { randomUUID } from "node:crypto";
import {
  isVdtSchemaId,
  schemaSupportsTask,
  type VdtAiTaskType
} from "@vdt-studio/model-bridge";
import type { AuditEvent, BackendManifest, CompletionRequest, RunSnapshot } from "../cli/types";
import { executeCompletion, EXECUTION_LIMITS, listBackendModels, type ExecutorOptions } from "./executor";
import { createManifestRegistry, publicManifest } from "./manifests";

export const LOCAL_RUNTIME_VERSION = "0.2.0";
const MAX_RETAINED_RUNS = 200;
const TASK_TYPES = new Set<VdtAiTaskType>([
  "generate_tree", "deepen_node", "simplify_branch", "suggest_alternative", "suggest_formula",
  "review_model", "check_units", "identify_missing_drivers", "identify_duplicate_drivers",
  "explain_node", "explain_scenario", "generate_executive_summary"
]);

export interface LocalRuntimeConfig {
  manifests?: readonly BackendManifest[];
  executor?: ExecutorOptions;
  auditSink?: (event: AuditEvent) => void;
  adapterVersion?: string;
}

interface ActiveRun extends RunSnapshot {
  controller: AbortController;
}

export interface LocalRuntimeContext {
  config: LocalRuntimeConfig;
  manifests: ReadonlyMap<string, BackendManifest>;
  runs: Map<string, ActiveRun>;
  auditSink: (event: AuditEvent) => void;
  adapterVersion: string;
}

export interface RuntimeResult {
  statusCode: number;
  payload?: unknown;
}

export class LocalRuntimeError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
    this.name = "LocalRuntimeError";
  }
}

export function createLocalRuntimeContext(config: LocalRuntimeConfig = {}): LocalRuntimeContext {
  return {
    config,
    manifests: createManifestRegistry(config.manifests),
    runs: new Map(),
    auditSink: config.auditSink ?? ((event) => process.stdout.write(`${JSON.stringify({ event: "vdt_runner_audit", ...event })}\n`)),
    adapterVersion: config.adapterVersion ?? LOCAL_RUNTIME_VERSION
  };
}

export function listRuntimeBackends(context: LocalRuntimeContext): RuntimeResult {
  return { statusCode: 200, payload: { ok: true, backends: [...context.manifests.values()].map(publicManifest) } };
}

export async function listRuntimeModels(backendId: string, context: LocalRuntimeContext): Promise<RuntimeResult> {
  const manifest = context.manifests.get(backendId);
  if (!manifest) throw new LocalRuntimeError(404, "UNKNOWN_BACKEND", "Unknown backendId.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  timeout.unref?.();
  try {
    const models = await listBackendModels(manifest, controller.signal, context.config.executor);
    return { statusCode: 200, payload: { ok: true, backendId, models } };
  } catch (error) {
    if (isSoftModelListFailure(error)) {
      return { statusCode: 200, payload: { ok: true, backendId, models: [] } };
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function testRuntimeBackend(backendId: string, context: LocalRuntimeContext): Promise<RuntimeResult> {
  return completeRuntime({
    requestId: randomUUID(),
    backendId,
    taskType: "generate_tree",
    schemaId: "connection-test-v1",
    input: { probe: true },
    timeoutMs: 30_000
  }, context);
}

export async function completeRuntime(request: CompletionRequest, context: LocalRuntimeContext): Promise<RuntimeResult> {
  if (context.runs.has(request.requestId)) throw new LocalRuntimeError(409, "DUPLICATE_REQUEST_ID", "requestId already exists.");
  if (context.runs.size >= MAX_RETAINED_RUNS) {
    const completedId = [...context.runs].find(([, run]) => run.status !== "running")?.[0];
    if (!completedId) throw new LocalRuntimeError(503, "RUN_CAPACITY_REACHED", "Local runner is at its active run limit.");
    context.runs.delete(completedId);
  }
  const manifest = context.manifests.get(request.backendId);
  if (!manifest) throw new LocalRuntimeError(404, "UNKNOWN_BACKEND", "Unknown backendId.");
  if (!manifest.taskTypes.includes(request.taskType) || !manifest.schemaIds.includes(request.schemaId)) {
    throw new LocalRuntimeError(400, "UNSUPPORTED_CONTRACT", "Backend does not support this task/schema contract.");
  }
  const createdAt = new Date().toISOString();
  const controller = new AbortController();
  const run: ActiveRun = {
    requestId: request.requestId,
    backendId: request.backendId,
    taskType: request.taskType,
    schemaId: request.schemaId,
    status: "running",
    createdAt,
    startedAt: createdAt,
    controller
  };
  context.runs.set(request.requestId, run);
  const started = Date.now();
  try {
    const result = await executeCompletion(manifest, request, controller.signal, context.config.executor);
    run.status = "succeeded";
    run.output = result.output;
    run.outputBytes = result.outputBytes;
    run.schemaValid = result.schemaValid;
    if (result.repaired === true) run.repaired = true;
    if (result.repairAttempted === true) run.repairAttempted = true;
    if (result.repairSucceeded === true) run.repairSucceeded = true;
    run.finishedAt = new Date().toISOString();
    run.latencyMs = Date.now() - started;
    context.auditSink({
      requestId: run.requestId, backendId: run.backendId, adapterVersion: context.adapterVersion,
      taskType: run.taskType, startedAt: run.startedAt!, latencyMs: run.latencyMs,
      outputBytes: result.outputBytes, schemaValid: result.schemaValid,
      ...(result.repaired === true ? { repaired: true } : {}),
      ...(result.repairAttempted === true ? { repairAttempted: true } : {}),
      ...(result.repairSucceeded === true ? { repairSucceeded: true } : {}),
      ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
      ...(result.executableVersion === undefined ? {} : { executableVersion: result.executableVersion })
    });
    return { statusCode: 200, payload: { ok: true, run: publicRun(run), output: result.output } };
  } catch (error) {
    const normalized = publicRuntimeError(error);
    run.status = normalized.code === "CANCELLED" ? "cancelled" : "failed";
    run.error = normalized;
    run.outputBytes = 0;
    run.schemaValid = false;
    if (hasRepairAttempt(error)) {
      run.repairAttempted = true;
      run.repairSucceeded = false;
    }
    run.finishedAt = new Date().toISOString();
    run.latencyMs = Date.now() - started;
    context.auditSink({
      requestId: run.requestId, backendId: run.backendId, adapterVersion: context.adapterVersion,
      taskType: run.taskType, startedAt: run.startedAt!, latencyMs: run.latencyMs,
      outputBytes: 0, schemaValid: false,
      ...(hasRepairAttempt(error) ? { repairAttempted: true, repairSucceeded: false } : {}),
      errorCode: normalized.code
    });
    return { statusCode: normalized.code === "CANCELLED" ? 409 : 502, payload: { ok: false, run: publicRun(run), error: normalized } };
  }
}

function hasRepairAttempt(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { repairAttempted?: unknown }).repairAttempted === true;
}

function isSoftModelListFailure(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  return code === "BACKEND_NOT_INSTALLED" || code === "AUTH_REQUIRED" || code === "CANCELLED";
}

export function cancelRuntimeRequest(requestId: string, context: LocalRuntimeContext): RuntimeResult {
  const run = context.runs.get(requestId);
  if (!run) throw new LocalRuntimeError(404, "RUN_NOT_FOUND", "Run was not found.");
  if (run.status !== "running") throw new LocalRuntimeError(409, "RUN_NOT_ACTIVE", "Run is not active.");
  run.controller.abort();
  return { statusCode: 202, payload: { ok: true, requestId, status: "cancelling" } };
}

export function getRuntimeRun(requestId: string, context: LocalRuntimeContext): RuntimeResult {
  const run = context.runs.get(requestId);
  if (!run) throw new LocalRuntimeError(404, "RUN_NOT_FOUND", "Run was not found.");
  return { statusCode: 200, payload: { ok: true, run: publicRun(run) } };
}

export function openRuntimeProviderAuth(backendId: string, context: LocalRuntimeContext): RuntimeResult {
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

export function parseCompletionPayload(value: unknown): CompletionRequest {
  if (!isRecord(value)) throw new LocalRuntimeError(400, "INVALID_BODY", "Completion body must be an object.");
  for (const forbidden of ["command", "args", "providerConfig", "schema", "systemPrompt", "userPrompt", "cwd", "env", "extraArgs"]) {
    if (forbidden in value) throw new LocalRuntimeError(400, "FORBIDDEN_FIELD", `Completion body must not include ${forbidden}.`);
  }
  const allowed = new Set(["requestId", "backendId", "taskType", "schemaId", "input", "model", "timeoutMs"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new LocalRuntimeError(400, "UNKNOWN_FIELD", `Unknown completion field: ${key}.`);
  }
  const requestId = typeof value.requestId === "string" ? value.requestId : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new LocalRuntimeError(400, "INVALID_REQUEST_ID", "requestId must be a UUID.");
  }
  const backendId = typeof value.backendId === "string" ? value.backendId : "";
  const taskType = typeof value.taskType === "string" && TASK_TYPES.has(value.taskType as VdtAiTaskType)
    ? value.taskType as VdtAiTaskType
    : undefined;
  const schemaId = typeof value.schemaId === "string" && isVdtSchemaId(value.schemaId) ? value.schemaId : undefined;
  if (!backendId) throw new LocalRuntimeError(400, "INVALID_BACKEND_ID", "backendId is required.");
  if (!taskType) throw new LocalRuntimeError(400, "INVALID_TASK_TYPE", "taskType is not approved.");
  if (!schemaId || !schemaSupportsTask(schemaId, taskType)) {
    throw new LocalRuntimeError(400, "INVALID_SCHEMA_ID", "schemaId is not approved for this task.");
  }
  const timeoutMs = value.timeoutMs;
  if (timeoutMs !== undefined && (typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > EXECUTION_LIMITS.timeoutMs)) {
    throw new LocalRuntimeError(400, "INVALID_TIMEOUT", `timeoutMs must be at most ${EXECUTION_LIMITS.timeoutMs}.`);
  }
  if (value.model !== undefined && (typeof value.model !== "string" || value.model.length > 160 || value.model.includes("\0"))) {
    throw new LocalRuntimeError(400, "INVALID_MODEL", "model must be a bounded string.");
  }
  return {
    requestId,
    backendId,
    taskType,
    schemaId,
    input: value.input,
    ...(typeof value.model === "string" ? { model: value.model } : {}),
    ...(typeof timeoutMs === "number" ? { timeoutMs } : {})
  };
}

function publicRun(run: ActiveRun): RunSnapshot {
  const { controller: _controller, ...snapshot } = run;
  return snapshot;
}

function publicRuntimeError(error: unknown): { code: string; message: string } {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "EXECUTION_FAILED";
  const messages: Record<string, string> = {
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

function providerAuthAction(backendId: string): { action: "instructions"; label: string; instructions: string; docsUrl: string } | undefined {
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
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
