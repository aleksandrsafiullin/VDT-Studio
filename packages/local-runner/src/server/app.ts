import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AuditEvent, BackendManifest } from "../cli/types";
import type { ExecutorOptions } from "./executor";
import { PairingManager, type PairingOptions } from "./pairing";
import {
  LOCAL_RUNTIME_VERSION,
  LocalRuntimeError,
  cancelRuntimeRequest,
  completeRuntime,
  createLocalRuntimeContext,
  getRuntimeRun,
  listRuntimeBackends,
  parseCompletionPayload,
  testRuntimeBackend,
  type LocalRuntimeContext,
  type RuntimeResult
} from "./runtime";

export const LOCAL_RUNNER_VERSION = LOCAL_RUNTIME_VERSION;
export const DEFAULT_LOCAL_RUNNER_PORT = 8765;
export const DEFAULT_LOCAL_RUNNER_HOST = "127.0.0.1";
const MAX_BODY_BYTES = 1024 * 1024;

export interface LocalRunnerConfig {
  host: string;
  port: number;
  allowedOrigins?: readonly string[];
  manifests?: readonly BackendManifest[];
  pairing?: PairingOptions;
  executor?: ExecutorOptions;
  auditSink?: (event: AuditEvent) => void;
}

export interface LocalRunnerContext {
  config: LocalRunnerConfig;
  pairing: PairingManager;
  runtime: LocalRuntimeContext;
}

export type LocalRunnerServer = Server & { vdtRunnerContext: LocalRunnerContext };

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
  const runtimeConfig = {
    adapterVersion: LOCAL_RUNNER_VERSION,
    ...(config.manifests === undefined ? {} : { manifests: config.manifests }),
    ...(config.executor === undefined ? {} : { executor: config.executor }),
    ...(config.auditSink === undefined ? {} : { auditSink: config.auditSink })
  };
  return {
    config,
    pairing: new PairingManager(config.pairing),
    runtime: createLocalRuntimeContext(runtimeConfig)
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

export async function routeLocalRunnerRequest(request: IncomingMessage, context: LocalRunnerContext): Promise<RuntimeResult> {
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
    return listRuntimeBackends(context.runtime);
  }
  const testMatch = url.pathname.match(/^\/v1\/backends\/([^/]+)\/test$/);
  if (request.method === "POST" && testMatch) {
    assertEmptyBody(await readJson(request));
    const backendId = decodeURIComponent(testMatch[1]!);
    return testRuntimeBackend(backendId, context.runtime);
  }
  if (request.method === "POST" && url.pathname === "/v1/completions") {
    return completeRuntime(parseCompletionPayload(await readJson(request)), context.runtime);
  }
  const cancelMatch = url.pathname.match(/^\/v1\/completions\/([^/]+)\/cancel$/);
  if (request.method === "POST" && cancelMatch) {
    await readJson(request);
    const requestId = decodeURIComponent(cancelMatch[1]!);
    return cancelRuntimeRequest(requestId, context.runtime);
  }
  const runMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)$/);
  if (request.method === "GET" && runMatch) {
    return getRuntimeRun(decodeURIComponent(runMatch[1]!), context.runtime);
  }
  throw new HttpError(404, "ROUTE_NOT_FOUND", "Local runner route was not found.");
}

function normalizeError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof LocalRuntimeError) return new HttpError(error.statusCode, error.code, error.message);
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
