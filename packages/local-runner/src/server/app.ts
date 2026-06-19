import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { describeCliProvider } from "../adapters/cli-provider";
import type {
  CliProviderConfig,
  LocalRunnerProvider,
  LocalRunnerRunRequest,
  LocalRunnerRunResult,
  LocalRunnerRunSummary
} from "../cli/types";

export const LOCAL_RUNNER_VERSION = "0.1.0";
export const DEFAULT_LOCAL_RUNNER_PORT = 8765;
export const DEFAULT_LOCAL_RUNNER_HOST = "127.0.0.1";
const DEFAULT_RUN_TIMEOUT_SEC = 30;
const MAX_RUN_TIMEOUT_SEC = 120;

export const stubProviders: LocalRunnerProvider[] = [
  {
    id: "cli_stub",
    name: "CLI Provider Stub",
    kind: "cli",
    status: "stub",
    runMode: "disabled",
    taskTypes: [],
    description: "CLI adapter interface only. MVP /run never starts shell commands or local binaries.",
    safety: {
      executesShell: false,
      performsNetworkRequests: false,
      returnsMockDataOnly: false
    }
  },
  {
    id: "local_http_stub",
    name: "Local HTTP Provider Stub",
    kind: "local_http",
    status: "stub",
    runMode: "disabled",
    taskTypes: [],
    description: "Local HTTP adapter interface only. MVP /run never forwards requests to model servers.",
    safety: {
      executesShell: false,
      performsNetworkRequests: false,
      returnsMockDataOnly: false
    }
  },
  {
    id: "mock_stub",
    name: "Safe Mock Provider",
    kind: "mock",
    status: "stub",
    runMode: "mock",
    taskTypes: ["*"],
    description: "Safe deterministic MVP mock. It accepts any taskType as a dry run and returns summaries without echoing input.",
    safety: {
      executesShell: false,
      performsNetworkRequests: false,
      returnsMockDataOnly: true
    }
  }
];

export interface LocalRunnerConfig {
  host: string;
  port: number;
}

interface RouteResult {
  statusCode: number;
  payload: unknown;
}

export function readLocalRunnerConfig(env: NodeJS.ProcessEnv = process.env): LocalRunnerConfig {
  return {
    port: Number(env.LOCAL_RUNNER_PORT ?? DEFAULT_LOCAL_RUNNER_PORT),
    host: env.LOCAL_RUNNER_HOST ?? DEFAULT_LOCAL_RUNNER_HOST
  };
}

export function createLocalRunnerServer(config: LocalRunnerConfig): Server {
  return createServer(async (request, response) => {
    try {
      const result = await routeLocalRunnerRequest(request);
      sendJson(request, response, config, result.statusCode, result.payload);
    } catch (error) {
      const invalidJson = error instanceof InvalidJsonError;
      sendJson(request, response, config, invalidJson ? 400 : 500, {
        ok: false,
        error: {
          code: invalidJson ? "INVALID_JSON" : "LOCAL_RUNNER_ERROR",
          message: error instanceof Error ? error.message : "Unknown local-runner error"
        },
        diagnostics: {
          executed: false,
          shellExecution: false,
          remoteExecution: false
        }
      });
    }
  });
}

export async function routeLocalRunnerRequest(request: IncomingMessage): Promise<RouteResult> {
  if (request.method === "OPTIONS") {
    return {
      statusCode: 204,
      payload: {}
    };
  }

  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "GET" && url.pathname === "/health") {
    return {
      statusCode: 200,
      payload: {
        ok: true,
        service: "vdt-studio-local-runner",
        version: LOCAL_RUNNER_VERSION,
        adapters: stubProviders.map((provider) => provider.id)
      }
    };
  }

  if (request.method === "GET" && url.pathname === "/providers") {
    return {
      statusCode: 200,
      payload: {
        ok: true,
        providers: stubProviders
      }
    };
  }

  if (request.method === "POST" && url.pathname === "/test-provider") {
    const body = await readJson<{ provider?: CliProviderConfig }>(request);
    const provider = body?.provider ?? {
      name: "Local CLI Stub",
      command: "echo",
      args: ["{\"ok\":true}"],
      inputMode: "stdin",
      outputMode: "stdout_json",
      timeoutSec: 30
    };

    return {
      statusCode: 200,
      payload: describeCliProvider(provider)
    };
  }

  if (request.method === "POST" && url.pathname === "/run") {
    const body = await readJson<unknown>(request);
    return handleRun(body);
  }

  return {
    statusCode: 404,
    payload: {
      ok: false,
      error: {
        code: "ROUTE_NOT_FOUND",
        message: `No local-runner route for ${request.method ?? "UNKNOWN"} ${url.pathname}`
      }
    }
  };
}

export function handleRun(body: unknown): RouteResult {
  const parsed = parseRunRequest(body);

  if (!parsed.ok) {
    return {
      statusCode: 400,
      payload: withNoExecutionDiagnostics({
        ok: false,
        error: parsed.error
      })
    };
  }

  const request = parsed.request;
  const provider = stubProviders.find((candidate) => candidate.id === request.providerId);
  const timeoutSec = request.timeoutSec ?? DEFAULT_RUN_TIMEOUT_SEC;

  if (!provider) {
    return {
      statusCode: 404,
      payload: withNoExecutionDiagnostics({
        ok: false,
        providerId: request.providerId,
        taskType: request.taskType,
        error: {
          code: "UNKNOWN_PROVIDER",
          message: `Unknown providerId "${request.providerId}". Use GET /providers for available MVP stubs.`
        }
      }, timeoutSec)
    };
  }

  if (provider.runMode !== "mock") {
    return {
      statusCode: 501,
      payload: withNoExecutionDiagnostics({
        ok: false,
        providerId: request.providerId,
        taskType: request.taskType,
        error: {
          code: "PROVIDER_EXECUTION_DISABLED",
          message: `${provider.id} is registered as an MVP interface stub. /run will not execute shell, CLI, HTTP, or remote adapter work.`
        }
      }, timeoutSec)
    };
  }

  return {
    statusCode: 200,
    payload: withNoExecutionDiagnostics({
      ok: true,
      providerId: provider.id,
      taskType: request.taskType,
      result: {
        mode: "stub",
        message: "Safe mock response only. No shell, CLI, HTTP, or remote model execution was attempted.",
        input: summarizeValue(request.input),
        schema: summarizeValue(request.schema)
      }
    }, timeoutSec)
  };
}

async function readJson<T>(request: IncomingMessage): Promise<T | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    throw new InvalidJsonError("Request body must be valid JSON.");
  }
}

function sendJson(
  request: IncomingMessage,
  response: ServerResponse,
  config: LocalRunnerConfig,
  statusCode: number,
  payload: unknown
) {
  const origin = request.headers.origin;
  const allowedOrigins = getAllowedOrigins(config.port);
  const allowOrigin =
    typeof origin === "string" && allowedOrigins.has(origin) ? origin : `http://${config.host}:${config.port}`;

  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  response.end(statusCode === 204 ? undefined : JSON.stringify(payload, null, 2));
}

function getAllowedOrigins(port: number): Set<string> {
  return new Set([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    "http://localhost:3000",
    "http://127.0.0.1:3000"
  ]);
}

function parseRunRequest(body: unknown):
  | { ok: true; request: LocalRunnerRunRequest }
  | { ok: false; error: { code: string; message: string } } {
  if (!isRecord(body)) {
    return {
      ok: false,
      error: {
        code: "INVALID_BODY",
        message: "POST /run expects a JSON object body."
      }
    };
  }

  const providerId = readRequiredString(body, "providerId");
  if (!providerId) {
    return {
      ok: false,
      error: {
        code: "INVALID_PROVIDER_ID",
        message: "POST /run requires a non-empty string providerId."
      }
    };
  }

  const taskType = readRequiredString(body, "taskType");
  if (!taskType) {
    return {
      ok: false,
      error: {
        code: "INVALID_TASK_TYPE",
        message: "POST /run requires a non-empty string taskType."
      }
    };
  }

  const timeoutSec = body.timeoutSec;
  if (timeoutSec !== undefined) {
    if (typeof timeoutSec !== "number" || !Number.isFinite(timeoutSec) || timeoutSec <= 0 || timeoutSec > MAX_RUN_TIMEOUT_SEC) {
      return {
        ok: false,
        error: {
          code: "INVALID_TIMEOUT",
          message: `timeoutSec must be a positive number up to ${MAX_RUN_TIMEOUT_SEC}.`
        }
      };
    }
  }

  return {
    ok: true,
    request: {
      providerId,
      taskType,
      input: body.input,
      schema: body.schema,
      ...(timeoutSec === undefined ? {} : { timeoutSec })
    }
  };
}

function readRequiredString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function summarizeValue(value: unknown): LocalRunnerRunSummary {
  if (Array.isArray(value)) {
    return {
      provided: true,
      type: "array",
      itemCount: value.length
    };
  }

  if (isRecord(value)) {
    const keys = Object.keys(value);
    return {
      provided: true,
      type: "object",
      keys: keys.slice(0, 20),
      truncated: keys.length > 20
    };
  }

  if (value === undefined) {
    return {
      provided: false,
      type: "undefined"
    };
  }

  if (value === null) {
    return {
      provided: true,
      type: "null"
    };
  }

  return {
    provided: true,
    type: typeof value
  };
}

function withNoExecutionDiagnostics<T extends LocalRunnerRunResult>(payload: T, timeoutSec?: number): T {
  return {
    ...payload,
    diagnostics: {
      executed: false,
      shellExecution: false,
      remoteExecution: false,
      ...(timeoutSec === undefined ? {} : { timeoutSec })
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class InvalidJsonError extends Error {}
