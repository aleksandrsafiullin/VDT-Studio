import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  isVdtSchemaId,
  schemaSupportsTask,
  type VdtAiTaskType
} from "@vdt-studio/model-bridge";
import type { AuditEvent, BackendManifest, CompletionRequest, RunSnapshot } from "../cli/types";
import { executeCompletion, EXECUTION_LIMITS, type ExecutorOptions } from "./executor";
import { createManifestRegistry, publicManifest } from "./manifests";
import { PairingManager, type PairingOptions } from "./pairing";

export const LOCAL_RUNNER_VERSION = "0.2.0";
export const DEFAULT_LOCAL_RUNNER_PORT = 8765;
export const DEFAULT_LOCAL_RUNNER_HOST = "127.0.0.1";
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_RETAINED_RUNS = 200;
const TASK_TYPES = new Set<VdtAiTaskType>([
  "generate_tree", "deepen_node", "simplify_branch", "suggest_alternative", "suggest_formula",
  "review_model", "check_units", "identify_missing_drivers", "identify_duplicate_drivers",
  "explain_node", "explain_scenario", "generate_executive_summary"
]);

export interface LocalRunnerConfig {
  host: string;
  port: number;
  allowedOrigins?: readonly string[];
  manifests?: readonly BackendManifest[];
  pairing?: PairingOptions;
  executor?: ExecutorOptions;
  auditSink?: (event: AuditEvent) => void;
}

interface ActiveRun extends RunSnapshot {
  controller: AbortController;
}

export interface LocalRunnerContext {
  config: LocalRunnerConfig;
  pairing: PairingManager;
  manifests: ReadonlyMap<string, BackendManifest>;
  runs: Map<string, ActiveRun>;
  auditSink: (event: AuditEvent) => void;
}

export type LocalRunnerServer = Server & { vdtRunnerContext: LocalRunnerContext };

interface RouteResult {
  statusCode: number;
  payload?: unknown;
}

class HttpError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
  }
}

export function readLocalRunnerConfig(env: NodeJS.ProcessEnv = process.env): LocalRunnerConfig {
  const host = env.LOCAL_RUNNER_HOST ?? DEFAULT_LOCAL_RUNNER_HOST;
  if (host !== "127.0.0.1") throw new Error("LOCAL_RUNNER_HOST must be 127.0.0.1.");
  const port = Number(env.LOCAL_RUNNER_PORT ?? DEFAULT_LOCAL_RUNNER_PORT);
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) throw new Error("LOCAL_RUNNER_PORT must be a valid TCP port.");
  const allowedOrigins = (env.VDT_LOCAL_RUNNER_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return { host, port, ...(allowedOrigins.length > 0 ? { allowedOrigins } : {}) };
}

function createContext(config: LocalRunnerConfig): LocalRunnerContext {
  if (config.host !== "127.0.0.1") throw new Error("Local runner must bind only to 127.0.0.1.");
  return {
    config,
    pairing: new PairingManager(config.pairing),
    manifests: createManifestRegistry(config.manifests),
    runs: new Map(),
    auditSink: config.auditSink ?? ((event) => process.stdout.write(`${JSON.stringify({ event: "vdt_runner_audit", ...event })}\n`))
  };
}

export function createLocalRunnerServer(config: LocalRunnerConfig): LocalRunnerServer {
  const context = createContext(config);
  const server = createServer(async (request, response) => {
    try {
      const result = await routeLocalRunnerRequest(request, context);
      sendJson(request, response, context, result.statusCode, result.payload);
    } catch (error) {
      const normalized = normalizeError(error);
      sendJson(request, response, context, normalized.statusCode, {
        ok: false,
        error: { code: normalized.code, message: normalized.message }
      });
    }
  }) as LocalRunnerServer;
  server.vdtRunnerContext = context;
  return server;
}

export function getRunnerPairingInfo(server: LocalRunnerServer) {
  return {
    code: server.vdtRunnerContext.pairing.pairingCode,
    expiresAt: new Date(server.vdtRunnerContext.pairing.pairingCodeExpiresAt).toISOString()
  };
}

function allowedOrigins(context: LocalRunnerContext): Set<string> {
  const configured = context.config.allowedOrigins ?? [];
  return new Set([
    "http://localhost:3000", "http://127.0.0.1:3000",
    "http://localhost:3001", "http://127.0.0.1:3001",
    "http://localhost:3100", "http://127.0.0.1:3100",
    ...configured
  ]);
}

function validateTransport(request: IncomingMessage, context: LocalRunnerContext): void {
  const host = request.headers.host;
  if (!host) throw new HttpError(403, "INVALID_HOST", "Host header is required.");
  let hostname: string;
  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    throw new HttpError(403, "INVALID_HOST", "Host header is invalid.");
  }
  if (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "[::1]" && hostname !== "::1") {
    throw new HttpError(403, "INVALID_HOST", "Local runner accepts localhost Host headers only.");
  }

  const origin = request.headers.origin;
  if (origin !== undefined && (typeof origin !== "string" || !allowedOrigins(context).has(origin))) {
    throw new HttpError(403, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed.");
  }
  if (request.method !== "GET" && request.method !== "OPTIONS" && origin === undefined) {
    throw new HttpError(403, "ORIGIN_REQUIRED", "Mutation requests require an allowed Origin header.");
  }

  if (request.method === "POST") {
    const contentType = request.headers["content-type"];
    const value = Array.isArray(contentType) ? contentType[0] : contentType;
    if (typeof value !== "string" || !value.toLowerCase().startsWith("application/json")) {
      throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "POST requests must use application/json.");
    }
    const declared = Number(request.headers["content-length"]);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      throw new HttpError(413, "BODY_TOO_LARGE", "Request body exceeds the configured limit.");
    }
  }
}

function bearerToken(request: IncomingMessage): string | undefined {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return undefined;
  const token = authorization.slice("Bearer ".length).trim();
  return token || undefined;
}

function requireAuthorization(request: IncomingMessage, context: LocalRunnerContext): string {
  const token = bearerToken(request);
  if (!context.pairing.authorize(token)) throw new HttpError(401, "PAIRING_REQUIRED", "A valid runner session token is required.");
  return token!;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "BODY_TOO_LARGE", "Request body exceeds the configured limit.");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertEmptyBody(value: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value) || Object.keys(value).length > 0) {
    throw new HttpError(400, "UNKNOWN_FIELD", "This endpoint accepts only an empty JSON object.");
  }
}

function parseCompletion(value: unknown): CompletionRequest {
  if (!isRecord(value)) throw new HttpError(400, "INVALID_BODY", "Completion body must be an object.");
  for (const forbidden of ["command", "args", "providerConfig", "schema", "systemPrompt", "userPrompt", "cwd", "env", "extraArgs"]) {
    if (forbidden in value) throw new HttpError(400, "FORBIDDEN_FIELD", `Completion body must not include ${forbidden}.`);
  }
  const allowed = new Set(["requestId", "backendId", "taskType", "schemaId", "input", "model", "timeoutMs"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new HttpError(400, "UNKNOWN_FIELD", `Unknown completion field: ${key}.`);
  }
  const requestId = typeof value.requestId === "string" ? value.requestId : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new HttpError(400, "INVALID_REQUEST_ID", "requestId must be a UUID.");
  }
  const backendId = typeof value.backendId === "string" ? value.backendId : "";
  const taskType = typeof value.taskType === "string" && TASK_TYPES.has(value.taskType as VdtAiTaskType)
    ? value.taskType as VdtAiTaskType
    : undefined;
  const schemaId = typeof value.schemaId === "string" && isVdtSchemaId(value.schemaId) ? value.schemaId : undefined;
  if (!backendId) throw new HttpError(400, "INVALID_BACKEND_ID", "backendId is required.");
  if (!taskType) throw new HttpError(400, "INVALID_TASK_TYPE", "taskType is not approved.");
  if (!schemaId || !schemaSupportsTask(schemaId, taskType)) throw new HttpError(400, "INVALID_SCHEMA_ID", "schemaId is not approved for this task.");
  const timeoutMs = value.timeoutMs;
  if (timeoutMs !== undefined && (typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > EXECUTION_LIMITS.timeoutMs)) {
    throw new HttpError(400, "INVALID_TIMEOUT", `timeoutMs must be at most ${EXECUTION_LIMITS.timeoutMs}.`);
  }
  if (value.model !== undefined && (typeof value.model !== "string" || value.model.length > 160 || value.model.includes("\0"))) {
    throw new HttpError(400, "INVALID_MODEL", "model must be a bounded string.");
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

function publicError(error: unknown): { code: string; message: string } {
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

async function runCompletion(request: CompletionRequest, context: LocalRunnerContext): Promise<RouteResult> {
  if (context.runs.has(request.requestId)) throw new HttpError(409, "DUPLICATE_REQUEST_ID", "requestId already exists.");
  if (context.runs.size >= MAX_RETAINED_RUNS) {
    const completedId = [...context.runs].find(([, run]) => run.status !== "running")?.[0];
    if (!completedId) throw new HttpError(503, "RUN_CAPACITY_REACHED", "Local runner is at its active run limit.");
    context.runs.delete(completedId);
  }
  const manifest = context.manifests.get(request.backendId);
  if (!manifest) throw new HttpError(404, "UNKNOWN_BACKEND", "Unknown backendId.");
  if (!manifest.taskTypes.includes(request.taskType) || !manifest.schemaIds.includes(request.schemaId)) {
    throw new HttpError(400, "UNSUPPORTED_CONTRACT", "Backend does not support this task/schema contract.");
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
    run.finishedAt = new Date().toISOString();
    run.latencyMs = Date.now() - started;
    context.auditSink({
      requestId: run.requestId, backendId: run.backendId, adapterVersion: LOCAL_RUNNER_VERSION,
      taskType: run.taskType, startedAt: run.startedAt!, latencyMs: run.latencyMs,
      outputBytes: result.outputBytes, schemaValid: result.schemaValid,
      ...(result.repaired === true ? { repaired: true } : {}),
      ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
      ...(result.executableVersion === undefined ? {} : { executableVersion: result.executableVersion })
    });
    return { statusCode: 200, payload: { ok: true, run: publicRun(run), output: result.output } };
  } catch (error) {
    const normalized = publicError(error);
    run.status = normalized.code === "CANCELLED" ? "cancelled" : "failed";
    run.error = normalized;
    run.outputBytes = 0;
    run.schemaValid = false;
    run.finishedAt = new Date().toISOString();
    run.latencyMs = Date.now() - started;
    context.auditSink({
      requestId: run.requestId, backendId: run.backendId, adapterVersion: LOCAL_RUNNER_VERSION,
      taskType: run.taskType, startedAt: run.startedAt!, latencyMs: run.latencyMs,
      outputBytes: 0, schemaValid: false, errorCode: normalized.code
    });
    return { statusCode: normalized.code === "CANCELLED" ? 409 : 502, payload: { ok: false, run: publicRun(run), error: normalized } };
  }
}

export async function routeLocalRunnerRequest(request: IncomingMessage, context: LocalRunnerContext): Promise<RouteResult> {
  validateTransport(request, context);
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  if (request.method === "OPTIONS") return { statusCode: 204 };
  if (request.method === "GET" && url.pathname === "/v1/health") {
    return { statusCode: 200, payload: { ok: true, service: "vdt-studio-local-runner", version: LOCAL_RUNNER_VERSION, pairingRequired: true } };
  }
  if (request.method === "POST" && url.pathname === "/v1/pair") {
    const body = await readJson(request);
    const code = isRecord(body) && typeof body.code === "string" ? body.code : "";
    if (!/^\d{6}$/.test(code)) throw new HttpError(400, "INVALID_PAIRING_CODE", "Pairing code must contain six digits.");
    try {
      const session = context.pairing.pair(code);
      return { statusCode: 200, payload: { ok: true, session } };
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "PAIRING_FAILED";
      throw new HttpError(code === "PAIRING_RATE_LIMITED" ? 429 : 401, code, error instanceof Error ? error.message : "Pairing failed.");
    }
  }

  const token = requireAuthorization(request, context);
  if (request.method === "POST" && url.pathname === "/v1/unpair") {
    await readJson(request);
    context.pairing.unpair(token);
    return { statusCode: 200, payload: { ok: true } };
  }
  if (request.method === "GET" && url.pathname === "/v1/backends") {
    return { statusCode: 200, payload: { ok: true, backends: [...context.manifests.values()].map(publicManifest) } };
  }
  const testMatch = url.pathname.match(/^\/v1\/backends\/([^/]+)\/test$/);
  if (request.method === "POST" && testMatch) {
    assertEmptyBody(await readJson(request));
    const backendId = decodeURIComponent(testMatch[1]!);
    return runCompletion({
      requestId: randomUUID(), backendId, taskType: "generate_tree", schemaId: "connection-test-v1", input: { probe: true }, timeoutMs: 30_000
    }, context);
  }
  if (request.method === "POST" && url.pathname === "/v1/completions") {
    return runCompletion(parseCompletion(await readJson(request)), context);
  }
  const cancelMatch = url.pathname.match(/^\/v1\/completions\/([^/]+)\/cancel$/);
  if (request.method === "POST" && cancelMatch) {
    await readJson(request);
    const requestId = decodeURIComponent(cancelMatch[1]!);
    const run = context.runs.get(requestId);
    if (!run) throw new HttpError(404, "RUN_NOT_FOUND", "Run was not found.");
    if (run.status !== "running") throw new HttpError(409, "RUN_NOT_ACTIVE", "Run is not active.");
    run.controller.abort();
    return { statusCode: 202, payload: { ok: true, requestId, status: "cancelling" } };
  }
  const runMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)$/);
  if (request.method === "GET" && runMatch) {
    const run = context.runs.get(decodeURIComponent(runMatch[1]!));
    if (!run) throw new HttpError(404, "RUN_NOT_FOUND", "Run was not found.");
    return { statusCode: 200, payload: { ok: true, run: publicRun(run) } };
  }
  throw new HttpError(404, "ROUTE_NOT_FOUND", "Local runner route was not found.");
}

function normalizeError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  return new HttpError(500, "LOCAL_RUNNER_ERROR", "Local runner failed safely.");
}

function sendJson(
  request: IncomingMessage,
  response: ServerResponse,
  context: LocalRunnerContext,
  statusCode: number,
  payload: unknown
): void {
  const origin = request.headers.origin;
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  };
  if (typeof origin === "string" && allowedOrigins(context).has(origin)) headers["access-control-allow-origin"] = origin;
  response.writeHead(statusCode, headers);
  response.end(statusCode === 204 ? undefined : JSON.stringify(payload));
}
