import { randomUUID } from "node:crypto";
import {
  LocalRuntimeError,
  cancelRuntimeRequest,
  completeRuntime,
  createLocalRuntimeContext,
  getRuntimeRun,
  listRuntimeModels,
  openRuntimeProviderAuth,
  listRuntimeBackends,
  parseCompletionPayload,
  testRuntimeBackend,
  type LocalRuntimeConfig,
  type LocalRuntimeContext,
  type RuntimeResult
} from "../server/runtime";
import {
  SIDECAR_PROTOCOL_VERSION,
  SidecarFrameDecoder,
  SidecarProtocolError,
  SidecarRequestTracker,
  serializeSidecarMessage,
  type JsonObject,
  type JsonValue,
  type SidecarCancelMessage,
  type SidecarMessage,
  type SidecarRequestMessage
} from "./protocol";

export interface SidecarRuntimeOptions {
  readonly runtimeConfig?: LocalRuntimeConfig;
  readonly stdin?: NodeJS.ReadStream;
  readonly stdout?: NodeJS.WriteStream;
  readonly stderr?: NodeJS.WriteStream;
  readonly nonce?: string;
}

export async function handleSidecarRequest(
  message: SidecarRequestMessage,
  context: LocalRuntimeContext
): Promise<{ readonly ok: true; readonly payload?: JsonValue } | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }> {
  try {
    const result = await routeSidecarRequest(message, context);
    return runtimeResultToSidecarResult(result);
  } catch (error) {
    return { ok: false, error: normalizeSidecarRuntimeError(error) };
  }
}

export function handleSidecarCancel(message: SidecarCancelMessage, context: LocalRuntimeContext): void {
  cancelRuntimeRequest(message.requestId, context);
}

export function runLocalRuntimeSidecar(options: SidecarRuntimeOptions = {}): void {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const runtimeConfig = {
    ...(options.runtimeConfig ?? {}),
    auditSink: options.runtimeConfig?.auditSink ?? ((event) => {
      stderr.write(`${JSON.stringify({ event: "vdt_sidecar_audit", audit: event })}\n`);
    })
  };
  const context = createLocalRuntimeContext(runtimeConfig);
  const tracker = new SidecarRequestTracker();
  const decoder = new SidecarFrameDecoder({ requestTracker: tracker, direction: "host-to-sidecar" });
  const nonce = options.nonce ?? randomUUID();
  let ready = false;

  function write(message: SidecarMessage): void {
    stdout.write(serializeSidecarMessage(message));
  }

  function fail(error: unknown): void {
    const normalized = error instanceof SidecarProtocolError
      ? { code: error.code, message: error.message }
      : normalizeSidecarRuntimeError(error);
    stderr.write(`${JSON.stringify({ event: "vdt_sidecar_error", error: normalized })}\n`);
    process.exitCode = 1;
  }

  write({ protocolVersion: SIDECAR_PROTOCOL_VERSION, type: "hello", nonce });

  stdin.on("data", (chunk) => {
    let messages: SidecarMessage[];
    try {
      messages = decoder.push(chunk);
    } catch (error) {
      fail(error);
      return;
    }

    for (const message of messages) {
      if (!ready) {
        if (message.type !== "ready" || message.nonce !== nonce) {
          fail(new SidecarProtocolError("INVALID_MESSAGE", "Sidecar host did not complete the expected handshake."));
          continue;
        }
        ready = true;
        write({ protocolVersion: SIDECAR_PROTOCOL_VERSION, type: "event", event: "runtime_ready", payload: {} });
        continue;
      }

      if (message.type === "cancel") {
        try {
          handleSidecarCancel(message, context);
        } catch (error) {
          fail(error);
        }
        continue;
      }

      if (message.type !== "request") continue;

      void handleSidecarRequest(message, context)
        .then((result) => {
          tracker.completeRequest(message.requestId);
          write(result.ok
            ? {
              protocolVersion: SIDECAR_PROTOCOL_VERSION,
              type: "response",
              requestId: message.requestId,
              ok: true,
              ...(result.payload === undefined ? {} : { payload: result.payload })
            }
            : {
              protocolVersion: SIDECAR_PROTOCOL_VERSION,
              type: "response",
              requestId: message.requestId,
              ok: false,
              error: result.error
            });
        })
        .catch((error) => fail(error));
    }
  });
}

async function routeSidecarRequest(message: SidecarRequestMessage, context: LocalRuntimeContext): Promise<RuntimeResult> {
  if (message.method === "list_backends") return listRuntimeBackends(context);
  if (message.method === "test_backend") return testRuntimeBackend(requireBackendId(message.payload), context);
  if (message.method === "complete") {
    return completeRuntime(parseCompletionPayload({ ...message.payload, requestId: message.requestId }), context);
  }
  if (message.method === "get_run") {
    const runRequestId = typeof message.payload.runRequestId === "string" ? message.payload.runRequestId : "";
    if (!runRequestId) throw new LocalRuntimeError(400, "INVALID_REQUEST_ID", "runRequestId is required.");
    return getRuntimeRun(runRequestId, context);
  }
  if (message.method === "list_models") {
    return listRuntimeModels(requireBackendId(message.payload), context);
  }
  if (message.method === "open_provider_auth") {
    return openRuntimeProviderAuth(requireBackendId(message.payload), context);
  }
  return { statusCode: 200, payload: { ok: true, appMode: "desktop" } };
}

function runtimeResultToSidecarResult(
  result: RuntimeResult
): { readonly ok: true; readonly payload?: JsonValue } | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } } {
  const payload = toJsonValue(result.payload);
  if (result.statusCode >= 400) {
    const error = asPayloadError(payload) ?? { code: "RUNTIME_FAILED", message: "Runtime request failed." };
    return { ok: false, error };
  }
  return payload === undefined ? { ok: true } : { ok: true, payload };
}

function asPayloadError(value: JsonValue | undefined): { readonly code: string; readonly message: string } | undefined {
  if (!isJsonObject(value)) return undefined;
  const error = value.error;
  if (!isJsonObject(error) || typeof error.code !== "string" || typeof error.message !== "string") return undefined;
  return { code: error.code, message: error.message };
}

function requireBackendId(payload: JsonObject): string {
  const backendId = payload.backendId;
  if (typeof backendId !== "string" || backendId.length === 0) {
    throw new LocalRuntimeError(400, "INVALID_BACKEND_ID", "backendId is required.");
  }
  return backendId;
}

function normalizeSidecarRuntimeError(error: unknown): { readonly code: string; readonly message: string } {
  if (error instanceof LocalRuntimeError) return { code: error.code, message: error.message };
  if (error instanceof SidecarProtocolError) return { code: error.code, message: error.message };
  return { code: "SIDECAR_RUNTIME_ERROR", message: error instanceof Error ? error.message : "Sidecar runtime failed safely." };
}

function toJsonValue(value: unknown): JsonValue | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map((entry) => toJsonValue(entry) ?? null);
  if (typeof value === "object") {
    const result: Record<string, JsonValue> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      const jsonValue = toJsonValue(nestedValue);
      if (jsonValue !== undefined) result[key] = jsonValue;
    }
    return result;
  }
  return null;
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
