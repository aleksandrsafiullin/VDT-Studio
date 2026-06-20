import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { describeCliProvider } from "../adapters/cli-provider";
import type {
  CliProviderConfig,
  LocalHttpProviderConfig,
  LocalRunnerProvider,
  LocalRunnerProviderPreset,
  LocalRunnerRunRequest,
  LocalRunnerRunSummary
} from "../cli/types";

export const LOCAL_RUNNER_VERSION = "0.1.0";
export const DEFAULT_LOCAL_RUNNER_PORT = 8765;
export const DEFAULT_LOCAL_RUNNER_HOST = "127.0.0.1";
const DEFAULT_RUN_TIMEOUT_SEC = 30;
const MAX_RUN_TIMEOUT_SEC = 120;
const MAX_PROVIDER_RESPONSE_BYTES = 1_000_000;

export const stubProviders: LocalRunnerProvider[] = [
  {
    id: "cli_stub",
    name: "CLI Provider Stub",
    kind: "cli",
    status: "configurable",
    runMode: "cli",
    taskTypes: ["*"],
    description: "CLI adapter. Disabled unless VDT_LOCAL_RUNNER_ENABLE_CLI=true. Uses command + args with JSON stdin/stdout only.",
    safety: {
      executesShell: true,
      performsNetworkRequests: false,
      returnsMockDataOnly: false
    }
  },
  {
    id: "local_http_stub",
    name: "Local HTTP Provider Stub",
    kind: "local_http",
    status: "configurable",
    runMode: "local_http",
    taskTypes: ["*"],
    description: "Local HTTP OpenAI-compatible adapter for Ollama, LM Studio, vLLM and similar localhost model servers.",
    safety: {
      executesShell: false,
      performsNetworkRequests: true,
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

export const localRunnerProviderPresets: LocalRunnerProviderPreset[] = [
  {
    id: "ollama_openai",
    label: "Ollama OpenAI-compatible",
    providerId: "local_http_stub",
    kind: "local_http",
    description: "Connects to Ollama's OpenAI-compatible local endpoint.",
    providerConfig: {
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "qwen3"
    },
    notes: ["Run Ollama locally and pull the selected model before generation."]
  },
  {
    id: "lm_studio_openai",
    label: "LM Studio local server",
    providerId: "local_http_stub",
    kind: "local_http",
    description: "Connects to LM Studio's local OpenAI-compatible server.",
    providerConfig: {
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "local-model"
    },
    notes: ["Start the LM Studio local server and load a chat model."]
  },
  {
    id: "vllm_openai",
    label: "vLLM OpenAI-compatible",
    providerId: "local_http_stub",
    kind: "local_http",
    description: "Connects to a local vLLM OpenAI-compatible server.",
    providerConfig: {
      baseUrl: "http://127.0.0.1:8000/v1",
      model: "local-model"
    },
    notes: ["Start vLLM with its OpenAI-compatible API server."]
  },
  {
    id: "custom_cli_json",
    label: "Custom CLI JSON stdout",
    providerId: "cli_stub",
    kind: "cli",
    description: "Runs a local CLI adapter that reads request JSON from stdin and writes structured JSON to stdout.",
    providerConfig: {
      name: "Custom CLI JSON stdout",
      command: "vdt-model-adapter",
      args: [],
      inputMode: "stdin",
      outputMode: "stdout_json",
      timeoutSec: 60
    },
    notes: ["CLI execution is disabled unless VDT_LOCAL_RUNNER_ENABLE_CLI=true.", "Commands must be binary names on PATH."]
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
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const safetyFailure = validateInboundRequest(request, url);
  if (safetyFailure) {
    return safetyFailure;
  }

  if (request.method === "OPTIONS") {
    return {
      statusCode: 204,
      payload: {}
    };
  }

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
        providers: stubProviders,
        presets: localRunnerProviderPresets
      }
    };
  }

  if (request.method === "POST" && url.pathname === "/test-provider") {
    const body = await readJson<unknown>(request);
    return handleTestProvider(body);
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

export async function handleRun(body: unknown): Promise<RouteResult> {
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

  if (provider.runMode === "local_http") {
    return runLocalHttpProvider(request, timeoutSec);
  }

  if (provider.runMode === "cli") {
    return runCliProvider(request, timeoutSec);
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

export async function handleTestProvider(body: unknown): Promise<RouteResult> {
  const legacyProvider = isRecord(body) ? body.provider : undefined;
  if (legacyProvider !== undefined) {
    return handleLegacyCliProviderTest(legacyProvider);
  }

  const parsed = parseTestProviderRequest(body);
  if (!parsed.ok) {
    return {
      statusCode: 400,
      payload: withNoExecutionDiagnostics({
        ok: false,
        error: parsed.error
      })
    };
  }

  const { providerId, providerConfig, timeoutSec } = parsed.request;
  const provider = stubProviders.find((candidate) => candidate.id === providerId);
  if (!provider) {
    return {
      statusCode: 404,
      payload: withNoExecutionDiagnostics({
        ok: false,
        providerId,
        taskType: "connection_test",
        error: {
          code: "UNKNOWN_PROVIDER",
          message: `Unknown providerId "${providerId}". Use GET /providers for available adapters.`
        }
      }, timeoutSec)
    };
  }

  if (provider.runMode === "local_http") {
    return testLocalHttpProvider(providerId, providerConfig, timeoutSec);
  }

  if (provider.runMode === "cli") {
    return testCliProvider(providerId, providerConfig, timeoutSec);
  }

  return {
    statusCode: 200,
    payload: withNoExecutionDiagnostics({
      ok: true,
      providerId,
      taskType: "connection_test",
      result: {
        mode: "stub",
        message: "Mock provider is available. No model execution was attempted."
      }
    }, timeoutSec)
  };
}

function handleLegacyCliProviderTest(value: unknown): RouteResult {
  const parsed = parseCliProviderConfig(value);
  if (!parsed.ok) {
    return {
      statusCode: 400,
      payload: withNoExecutionDiagnostics({
        ok: false,
        error: parsed.error
      })
    };
  }

  return {
    statusCode: 200,
    payload: describeCliProvider(parsed.config)
  };
}

async function testLocalHttpProvider(providerId: string, providerConfig: unknown, timeoutSec: number): Promise<RouteResult> {
  const parsed = parseLocalHttpProviderConfig(providerConfig);
  if (!parsed.ok) {
    return {
      statusCode: 400,
      payload: withDiagnostics(
        {
          ok: false,
          providerId,
          taskType: "connection_test",
          error: parsed.error
        },
        { executed: false, shellExecution: false, remoteExecution: false, timeoutSec }
      )
    };
  }

  const startedAt = Date.now();
  try {
    const models = await fetchLocalHttpModels(parsed.config, timeoutSec);
    return {
      statusCode: 200,
      payload: withDiagnostics(
        {
          ok: true,
          providerId,
          taskType: "connection_test",
          result: {
            mode: "local_http",
            message: "Local HTTP provider responded to /models."
          },
          models,
          latencyMs: Date.now() - startedAt
        },
        { executed: true, shellExecution: false, remoteExecution: true, timeoutSec }
      )
    };
  } catch (error) {
    return {
      statusCode: 502,
      payload: withDiagnostics(
        {
          ok: false,
          providerId,
          taskType: "connection_test",
          error: {
            code: "LOCAL_HTTP_PROVIDER_TEST_FAILED",
            message: error instanceof Error ? error.message : "Local HTTP provider test failed."
          },
          latencyMs: Date.now() - startedAt
        },
        { executed: true, shellExecution: false, remoteExecution: true, timeoutSec }
      )
    };
  }
}

async function testCliProvider(providerId: string, providerConfig: unknown, timeoutSec: number): Promise<RouteResult> {
  if (process.env.VDT_LOCAL_RUNNER_ENABLE_CLI !== "true") {
    return {
      statusCode: 403,
      payload: withDiagnostics(
        {
          ok: false,
          providerId,
          taskType: "connection_test",
          error: {
            code: "CLI_EXECUTION_DISABLED",
            message: "CLI execution is disabled. Set VDT_LOCAL_RUNNER_ENABLE_CLI=true after reviewing the command configuration."
          }
        },
        { executed: false, shellExecution: false, remoteExecution: false, timeoutSec }
      )
    };
  }

  const parsed = parseCliProviderConfig(providerConfig, { enforceAllowlist: true });
  if (!parsed.ok) {
    return {
      statusCode: 400,
      payload: withDiagnostics(
        {
          ok: false,
          providerId,
          taskType: "connection_test",
          error: parsed.error
        },
        { executed: false, shellExecution: false, remoteExecution: false, timeoutSec }
      )
    };
  }

  const startedAt = Date.now();
  try {
    const { output, rawOutput } = await completeViaCli(
      parsed.config,
      {
        providerId,
        taskType: "connection_test",
        input: { probe: "vdt-studio-local-runner" },
        schema: { type: "object" }
      },
      timeoutSec
    );

    return {
      statusCode: 200,
      payload: withDiagnostics(
        {
          ok: true,
          providerId,
          taskType: "connection_test",
          result: {
            mode: "cli",
            message: "CLI provider returned structured JSON output."
          },
          output,
          rawOutput,
          latencyMs: Date.now() - startedAt
        },
        { executed: true, shellExecution: false, remoteExecution: false, timeoutSec }
      )
    };
  } catch (error) {
    return {
      statusCode: 502,
      payload: withDiagnostics(
        {
          ok: false,
          providerId,
          taskType: "connection_test",
          error: {
            code: "CLI_PROVIDER_TEST_FAILED",
            message: error instanceof Error ? error.message : "CLI provider test failed."
          },
          latencyMs: Date.now() - startedAt
        },
        { executed: true, shellExecution: false, remoteExecution: false, timeoutSec }
      )
    };
  }
}

async function runLocalHttpProvider(request: LocalRunnerRunRequest, timeoutSec: number): Promise<RouteResult> {
  const parsed = parseLocalHttpProviderConfig(request.providerConfig);
  if (!parsed.ok) {
    return {
      statusCode: 400,
      payload: withDiagnostics(
        {
          ok: false,
          providerId: request.providerId,
          taskType: request.taskType,
          error: parsed.error
        },
        { executed: false, shellExecution: false, remoteExecution: false, timeoutSec }
      )
    };
  }

  const startedAt = Date.now();
  try {
    const output = await completeViaLocalHttp(parsed.config, request, timeoutSec);
    return {
      statusCode: 200,
      payload: withDiagnostics(
        {
          ok: true,
          providerId: request.providerId,
          taskType: request.taskType,
          result: {
            mode: "local_http",
            message: "Local HTTP provider returned structured output."
          },
          output,
          latencyMs: Date.now() - startedAt
        },
        { executed: true, shellExecution: false, remoteExecution: true, timeoutSec }
      )
    };
  } catch (error) {
    return {
      statusCode: 502,
      payload: withDiagnostics(
        {
          ok: false,
          providerId: request.providerId,
          taskType: request.taskType,
          error: {
            code: "LOCAL_HTTP_PROVIDER_FAILED",
            message: error instanceof Error ? error.message : "Local HTTP provider failed."
          }
        },
        { executed: true, shellExecution: false, remoteExecution: true, timeoutSec }
      )
    };
  }
}

async function runCliProvider(request: LocalRunnerRunRequest, timeoutSec: number): Promise<RouteResult> {
  if (process.env.VDT_LOCAL_RUNNER_ENABLE_CLI !== "true") {
    return {
      statusCode: 403,
      payload: withDiagnostics(
        {
          ok: false,
          providerId: request.providerId,
          taskType: request.taskType,
          error: {
            code: "CLI_EXECUTION_DISABLED",
            message: "CLI execution is disabled. Set VDT_LOCAL_RUNNER_ENABLE_CLI=true after reviewing the command configuration."
          }
        },
        { executed: false, shellExecution: false, remoteExecution: false, timeoutSec }
      )
    };
  }

  const parsed = parseCliProviderConfig(request.providerConfig, { enforceAllowlist: true });
  if (!parsed.ok) {
    return {
      statusCode: 400,
      payload: withDiagnostics(
        {
          ok: false,
          providerId: request.providerId,
          taskType: request.taskType,
          error: parsed.error
        },
        { executed: false, shellExecution: false, remoteExecution: false, timeoutSec }
      )
    };
  }

  const startedAt = Date.now();
  try {
    const { output, rawOutput } = await completeViaCli(parsed.config, request, timeoutSec);
    return {
      statusCode: 200,
      payload: withDiagnostics(
        {
          ok: true,
          providerId: request.providerId,
          taskType: request.taskType,
          result: {
            mode: "cli",
            message: "CLI provider returned structured JSON output."
          },
          output,
          rawOutput,
          latencyMs: Date.now() - startedAt
        },
        { executed: true, shellExecution: false, remoteExecution: false, timeoutSec }
      )
    };
  } catch (error) {
    return {
      statusCode: 502,
      payload: withDiagnostics(
        {
          ok: false,
          providerId: request.providerId,
          taskType: request.taskType,
          error: {
            code: "CLI_PROVIDER_FAILED",
            message: error instanceof Error ? error.message : "CLI provider failed."
          }
        },
        { executed: true, shellExecution: false, remoteExecution: false, timeoutSec }
      )
    };
  }
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
  const configuredOrigins = [
    process.env.VDT_WEB_ORIGIN,
    ...(process.env.VDT_LOCAL_RUNNER_ALLOWED_ORIGINS?.split(",") ?? [])
  ]
    .map((origin) => origin?.trim())
    .filter((origin): origin is string => Boolean(origin));

  return new Set([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    ...configuredOrigins
  ]);
}

function validateInboundRequest(request: IncomingMessage, url: URL): RouteResult | undefined {
  const hostHeader = request.headers.host;
  if (!hostHeader) {
    return forbiddenRequest("INVALID_HOST", "Local runner requests must include a Host header.");
  }

  let hostName: string;
  try {
    hostName = new URL(`http://${hostHeader}`).hostname;
  } catch {
    return forbiddenRequest("INVALID_HOST", "Local runner Host header must be valid.");
  }

  if (!isPrivateOrLocalHost(hostName)) {
    return forbiddenRequest("INVALID_HOST", "Local runner only accepts localhost or private-network Host headers.");
  }

  const origin = request.headers.origin;
  if (typeof origin === "string") {
    const port = Number(url.port || DEFAULT_LOCAL_RUNNER_PORT);
    if (!getAllowedOrigins(port).has(origin)) {
      return forbiddenRequest("ORIGIN_NOT_ALLOWED", "Local runner request origin is not allowed.");
    }
  }

  if (request.method === "POST") {
    const contentType = request.headers["content-type"];
    const header = Array.isArray(contentType) ? contentType[0] : contentType;
    if (typeof header !== "string" || !header.toLowerCase().startsWith("application/json")) {
      return {
        statusCode: 415,
        payload: withNoExecutionDiagnostics({
          ok: false,
          error: {
            code: "UNSUPPORTED_MEDIA_TYPE",
            message: "Local runner POST requests must use application/json."
          }
        })
      };
    }
  }

  return undefined;
}

function forbiddenRequest(code: string, message: string): RouteResult {
  return {
    statusCode: 403,
    payload: withNoExecutionDiagnostics({
      ok: false,
      error: {
        code,
        message
      }
    })
  };
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
      ...(typeof body.systemPrompt === "string" ? { systemPrompt: body.systemPrompt } : {}),
      ...(typeof body.userPrompt === "string" ? { userPrompt: body.userPrompt } : {}),
      ...(typeof body.model === "string" ? { model: body.model } : {}),
      ...(body.providerConfig === undefined ? {} : { providerConfig: body.providerConfig }),
      ...(timeoutSec === undefined ? {} : { timeoutSec })
    }
  };
}

function parseTestProviderRequest(body: unknown):
  | { ok: true; request: { providerId: string; providerConfig?: unknown; timeoutSec: number } }
  | { ok: false; error: { code: string; message: string } } {
  if (body === undefined) {
    return {
      ok: true,
      request: {
        providerId: "mock_stub",
        timeoutSec: 10
      }
    };
  }

  if (!isRecord(body)) {
    return {
      ok: false,
      error: {
        code: "INVALID_BODY",
        message: "POST /test-provider expects a JSON object body."
      }
    };
  }

  const providerId = readRequiredString(body, "providerId") ?? "mock_stub";
  const timeoutSec = readTimeoutSec(body.timeoutSec, 10);
  if (!timeoutSec.ok) {
    return {
      ok: false,
      error: timeoutSec.error
    };
  }

  return {
    ok: true,
    request: {
      providerId,
      ...(body.providerConfig === undefined ? {} : { providerConfig: body.providerConfig }),
      timeoutSec: timeoutSec.value
    }
  };
}

function readTimeoutSec(
  value: unknown,
  fallback: number
): { ok: true; value: number } | { ok: false; error: { code: string; message: string } } {
  if (value === undefined) {
    return { ok: true, value: fallback };
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > MAX_RUN_TIMEOUT_SEC) {
    return {
      ok: false,
      error: {
        code: "INVALID_TIMEOUT",
        message: `timeoutSec must be a positive number up to ${MAX_RUN_TIMEOUT_SEC}.`
      }
    };
  }
  return { ok: true, value };
}

function parseLocalHttpProviderConfig(value: unknown):
  | { ok: true; config: LocalHttpProviderConfig }
  | { ok: false; error: { code: string; message: string } } {
  if (!isRecord(value)) {
    return {
      ok: false,
      error: { code: "INVALID_PROVIDER_CONFIG", message: "local_http providerConfig must be an object." }
    };
  }

  const baseUrl = readRequiredString(value, "baseUrl");
  const model = readRequiredString(value, "model");
  if (!baseUrl || !model) {
    return {
      ok: false,
      error: { code: "INVALID_PROVIDER_CONFIG", message: "local_http providerConfig requires baseUrl and model." }
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return {
      ok: false,
      error: { code: "INVALID_PROVIDER_CONFIG", message: "local_http baseUrl must be a valid URL." }
    };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      error: { code: "INVALID_PROVIDER_CONFIG", message: "local_http baseUrl must use http or https." }
    };
  }

  if (!isPrivateOrLocalHost(parsed.hostname) && process.env.VDT_LOCAL_RUNNER_ALLOW_REMOTE_HTTP !== "true") {
    return {
      ok: false,
      error: {
        code: "REMOTE_HTTP_DISABLED",
        message: "Local runner HTTP adapters only allow localhost/private model servers unless VDT_LOCAL_RUNNER_ALLOW_REMOTE_HTTP=true."
      }
    };
  }

  return {
    ok: true,
    config: {
      baseUrl: parsed.toString().replace(/\/$/, ""),
      model,
      ...(typeof value.apiKey === "string" && value.apiKey ? { apiKey: value.apiKey } : {}),
      ...(typeof value.timeoutSec === "number" && Number.isFinite(value.timeoutSec) ? { timeoutSec: value.timeoutSec } : {})
    }
  };
}

function parseCliProviderConfig(
  value: unknown,
  options: { enforceAllowlist?: boolean } = {}
):
  | { ok: true; config: CliProviderConfig }
  | { ok: false; error: { code: string; message: string } } {
  if (!isRecord(value)) {
    return {
      ok: false,
      error: { code: "INVALID_PROVIDER_CONFIG", message: "cli providerConfig must be an object." }
    };
  }

  const name = readRequiredString(value, "name") ?? "Local CLI";
  const command = readRequiredString(value, "command");
  if (!command) {
    return {
      ok: false,
      error: { code: "INVALID_PROVIDER_CONFIG", message: "cli providerConfig requires command." }
    };
  }
  if (command.includes("/") || command.includes("\\") || command.includes("\0")) {
    return {
      ok: false,
      error: {
        code: "UNSAFE_CLI_COMMAND",
        message: "CLI command must be a binary name on PATH, not a path or shell expression."
      }
    };
  }
  if (options.enforceAllowlist && !getAllowedCliCommands().has(command)) {
    return {
      ok: false,
      error: {
        code: "CLI_COMMAND_NOT_ALLOWED",
        message:
          "CLI command is not allowed. Add the reviewed binary name to VDT_LOCAL_RUNNER_ALLOWED_CLI_COMMANDS before enabling execution."
      }
    };
  }

  const args = Array.isArray(value.args) && value.args.every((item) => typeof item === "string") ? value.args : undefined;
  const timeoutSec = typeof value.timeoutSec === "number" && Number.isFinite(value.timeoutSec) ? value.timeoutSec : DEFAULT_RUN_TIMEOUT_SEC;
  if (timeoutSec <= 0 || timeoutSec > MAX_RUN_TIMEOUT_SEC) {
    return {
      ok: false,
      error: { code: "INVALID_TIMEOUT", message: `CLI timeoutSec must be a positive number up to ${MAX_RUN_TIMEOUT_SEC}.` }
    };
  }

  return {
    ok: true,
    config: {
      name,
      command,
      ...(args === undefined ? {} : { args }),
      inputMode: "stdin",
      outputMode: "stdout_json",
      timeoutSec
    }
  };
}

function getAllowedCliCommands(): Set<string> {
  return new Set(
    (process.env.VDT_LOCAL_RUNNER_ALLOWED_CLI_COMMANDS ?? "")
      .split(",")
      .map((command) => command.trim())
      .filter(Boolean)
  );
}

async function completeViaLocalHttp(
  config: LocalHttpProviderConfig,
  request: LocalRunnerRunRequest,
  timeoutSec: number
): Promise<unknown> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {})
    },
    signal: AbortSignal.timeout(timeoutSec * 1000),
    body: JSON.stringify({
      model: request.model ?? config.model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: request.systemPrompt ?? "Return valid JSON only." },
        { role: "user", content: request.userPrompt ?? JSON.stringify(request.input ?? {}) }
      ]
    })
  });

  const body = await readLimitedResponseText(response);
  if (!response.ok) {
    throw new Error(`Local HTTP provider failed with ${response.status}: ${body.slice(0, 300)}`);
  }

  const parsed = JSON.parse(body) as unknown;
  const content = extractChatCompletionContent(parsed);
  return parseStructuredOutput(content);
}

async function fetchLocalHttpModels(config: LocalHttpProviderConfig, timeoutSec: number): Promise<string[]> {
  const response = await fetch(`${config.baseUrl}/models`, {
    method: "GET",
    headers: {
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {})
    },
    signal: AbortSignal.timeout(timeoutSec * 1000)
  });

  const body = await readLimitedResponseText(response);
  if (!response.ok) {
    throw new Error(`Local HTTP provider /models failed with ${response.status}: ${body.slice(0, 300)}`);
  }

  const parsed = JSON.parse(body) as unknown;
  if (!isRecord(parsed)) {
    return [];
  }

  const data = parsed.data;
  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (isRecord(item) && typeof item.id === "string") {
        return item.id;
      }
      return undefined;
    })
    .filter((item): item is string => Boolean(item))
    .slice(0, 50);
}

async function completeViaCli(
  config: CliProviderConfig,
  request: LocalRunnerRunRequest,
  timeoutSec: number
): Promise<{ output: unknown; rawOutput: string }> {
  const payload = JSON.stringify({
    taskType: request.taskType,
    input: request.input,
    schema: request.schema,
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
    model: request.model
  });

  const rawOutput = await new Promise<string>((resolve, reject) => {
    const child = spawn(config.command, config.args ?? [], {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGTERM");
        reject(new Error(`CLI provider timed out after ${timeoutSec} seconds.`));
      }
    }, timeoutSec * 1000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (Buffer.byteLength(stdout, "utf8") > MAX_PROVIDER_RESPONSE_BYTES) {
        child.kill("SIGTERM");
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error("CLI provider response exceeded the maximum allowed size."));
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });
    child.on("exit", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`CLI provider exited with ${code ?? "unknown"}: ${stderr.slice(0, 300)}`));
        return;
      }
      resolve(stdout);
    });
    child.stdin.end(payload);
  });

  return {
    rawOutput,
    output: parseStructuredOutput(rawOutput)
  };
}

async function readLimitedResponseText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return response.text();
  }

  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      size += value.byteLength;
      if (size > MAX_PROVIDER_RESPONSE_BYTES) {
        throw new Error("Local HTTP provider response exceeded the maximum allowed size.");
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

function extractChatCompletionContent(payload: unknown): string {
  if (!isRecord(payload)) {
    throw new Error("Local HTTP provider response must be a JSON object.");
  }
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0 || !isRecord(choices[0])) {
    throw new Error("Local HTTP provider response did not include choices.");
  }
  const message = choices[0].message;
  if (!isRecord(message) || typeof message.content !== "string") {
    throw new Error("Local HTTP provider response did not include message content.");
  }
  return message.content;
}

function parseStructuredOutput(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced?.[1] ?? trimmed);
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1" || normalized.endsWith(".local")) {
    return true;
  }
  if (/^127\./.test(normalized) || /^10\./.test(normalized) || /^169\.254\./.test(normalized)) {
    return true;
  }
  if (/^192\.168\./.test(normalized)) {
    return true;
  }
  const match172 = normalized.match(/^172\.(\d+)\./);
  if (match172) {
    const secondOctet = Number(match172[1]);
    return secondOctet >= 16 && secondOctet <= 31;
  }
  return false;
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

function withNoExecutionDiagnostics<T extends object>(payload: T, timeoutSec?: number): T {
  return withDiagnostics(payload, {
    executed: false,
    shellExecution: false,
    remoteExecution: false,
    ...(timeoutSec === undefined ? {} : { timeoutSec })
  });
}

function withDiagnostics<T extends object>(
  payload: T,
  diagnostics: {
    executed: boolean;
    shellExecution: boolean;
    remoteExecution: boolean;
    timeoutSec?: number;
  }
): T {
  return {
    ...payload,
    diagnostics
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class InvalidJsonError extends Error {}
