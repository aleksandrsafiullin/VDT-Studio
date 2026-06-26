export const SIDECAR_PROTOCOL_VERSION = 1;
export const DEFAULT_SIDECAR_MAX_FRAME_BYTES = 1024 * 1024;

export const SIDECAR_REQUEST_METHODS = [
  "list_backends",
  "detect_clis",
  "test_backend",
  "list_models",
  "complete",
  "get_run",
  "open_provider_auth",
  "get_app_mode"
] as const;

export const SIDECAR_EVENTS = [
  "backend_status_changed",
  "run_status_changed",
  "runtime_ready"
] as const;

export type SidecarRequestMethod = (typeof SIDECAR_REQUEST_METHODS)[number];
export type SidecarEventName = (typeof SIDECAR_EVENTS)[number];
export type SidecarMessageType = "hello" | "ready" | "request" | "response" | "cancel" | "event";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

export interface SidecarHelloMessage {
  readonly protocolVersion: typeof SIDECAR_PROTOCOL_VERSION;
  readonly type: "hello";
  readonly nonce: string;
}

export interface SidecarReadyMessage {
  readonly protocolVersion: typeof SIDECAR_PROTOCOL_VERSION;
  readonly type: "ready";
  readonly nonce: string;
}

export interface SidecarRequestMessage {
  readonly protocolVersion: typeof SIDECAR_PROTOCOL_VERSION;
  readonly type: "request";
  readonly requestId: string;
  readonly method: SidecarRequestMethod;
  readonly payload: JsonObject;
}

export interface SidecarResponseMessage {
  readonly protocolVersion: typeof SIDECAR_PROTOCOL_VERSION;
  readonly type: "response";
  readonly requestId: string;
  readonly ok: boolean;
  readonly payload?: JsonValue;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

export interface SidecarCancelMessage {
  readonly protocolVersion: typeof SIDECAR_PROTOCOL_VERSION;
  readonly type: "cancel";
  readonly requestId: string;
}

export interface SidecarEventMessage {
  readonly protocolVersion: typeof SIDECAR_PROTOCOL_VERSION;
  readonly type: "event";
  readonly event: SidecarEventName;
  readonly payload: JsonObject;
}

export type SidecarMessage =
  | SidecarHelloMessage
  | SidecarReadyMessage
  | SidecarRequestMessage
  | SidecarResponseMessage
  | SidecarCancelMessage
  | SidecarEventMessage;

export type SidecarProtocolErrorCode =
  | "EMPTY_FRAME"
  | "FRAME_TOO_LARGE"
  | "FRAME_CONTAINS_NEWLINE"
  | "INVALID_JSON"
  | "INVALID_MESSAGE"
  | "INVALID_PROTOCOL_VERSION"
  | "UNKNOWN_FIELD"
  | "UNKNOWN_MESSAGE_TYPE"
  | "UNKNOWN_METHOD"
  | "UNKNOWN_EVENT"
  | "INVALID_REQUEST_ID"
  | "DUPLICATE_REQUEST_ID"
  | "UNKNOWN_REQUEST_ID"
  | "STALE_REQUEST_ID"
  | "INVALID_PAYLOAD";

export class SidecarProtocolError extends Error {
  constructor(readonly code: SidecarProtocolErrorCode, message: string) {
    super(message);
    this.name = "SidecarProtocolError";
  }
}

export class SidecarRequestTracker {
  readonly #seen = new Set<string>();
  readonly #active = new Set<string>();

  registerRequest(requestId: string): void {
    if (this.#seen.has(requestId)) {
      throw new SidecarProtocolError("DUPLICATE_REQUEST_ID", `Duplicate sidecar request id: ${requestId}.`);
    }
    this.#seen.add(requestId);
    this.#active.add(requestId);
  }

  completeRequest(requestId: string): void {
    if (!this.#seen.has(requestId)) {
      throw new SidecarProtocolError("UNKNOWN_REQUEST_ID", `Sidecar response references an unknown request id: ${requestId}.`);
    }
    if (!this.#active.has(requestId)) {
      throw new SidecarProtocolError("STALE_REQUEST_ID", `Sidecar response references a completed request id: ${requestId}.`);
    }
    this.#active.delete(requestId);
  }

  assertActive(requestId: string): void {
    if (!this.#seen.has(requestId)) {
      throw new SidecarProtocolError("UNKNOWN_REQUEST_ID", `Sidecar message references an unknown request id: ${requestId}.`);
    }
    if (!this.#active.has(requestId)) {
      throw new SidecarProtocolError("STALE_REQUEST_ID", `Sidecar message references a completed request id: ${requestId}.`);
    }
  }

  isActive(requestId: string): boolean {
    return this.#active.has(requestId);
  }
}

export interface ParseSidecarFrameOptions {
  readonly maxFrameBytes?: number;
  readonly requestTracker?: SidecarRequestTracker;
  readonly direction?: "host-to-sidecar" | "sidecar-to-host";
}

export class SidecarFrameDecoder {
  readonly #options: ParseSidecarFrameOptions;
  #buffer = "";

  constructor(options: ParseSidecarFrameOptions = {}) {
    this.#options = options;
  }

  push(chunk: string | Uint8Array): SidecarMessage[] {
    this.#buffer += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    const maxFrameBytes = this.#options.maxFrameBytes ?? DEFAULT_SIDECAR_MAX_FRAME_BYTES;
    if (Buffer.byteLength(this.#buffer, "utf8") > maxFrameBytes) {
      throw new SidecarProtocolError("FRAME_TOO_LARGE", "Sidecar frame exceeds the configured byte limit.");
    }

    const messages: SidecarMessage[] = [];
    for (;;) {
      const newlineIndex = this.#buffer.indexOf("\n");
      if (newlineIndex === -1) break;
      const frame = this.#buffer.slice(0, newlineIndex).replace(/\r$/, "");
      this.#buffer = this.#buffer.slice(newlineIndex + 1);
      if (frame.length === 0) continue;
      messages.push(parseSidecarFrame(frame, this.#options));
    }
    return messages;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_METHOD_SET = new Set<string>(SIDECAR_REQUEST_METHODS);
const EVENT_SET = new Set<string>(SIDECAR_EVENTS);
const MESSAGE_TYPES = new Set<string>(["hello", "ready", "request", "response", "cancel", "event"]);
const EMPTY_PAYLOAD_METHODS = new Set<SidecarRequestMethod>(["list_backends", "get_app_mode"]);
const METHOD_PAYLOAD_KEYS = {
  list_backends: [],
  detect_clis: ["agentId"],
  test_backend: ["backendId"],
  list_models: ["backendId"],
  complete: ["backendId", "taskType", "schemaId", "input", "model", "timeoutMs"],
  get_run: ["runRequestId"],
  open_provider_auth: ["backendId"],
  get_app_mode: []
} satisfies Record<SidecarRequestMethod, readonly string[]>;

export function parseSidecarFrame(frame: string | Uint8Array, options: ParseSidecarFrameOptions = {}): SidecarMessage {
  const raw = typeof frame === "string" ? frame : Buffer.from(frame).toString("utf8");
  const maxFrameBytes = options.maxFrameBytes ?? DEFAULT_SIDECAR_MAX_FRAME_BYTES;
  if (raw.length === 0) throw new SidecarProtocolError("EMPTY_FRAME", "Sidecar frame is empty.");
  if (Buffer.byteLength(raw, "utf8") > maxFrameBytes) {
    throw new SidecarProtocolError("FRAME_TOO_LARGE", "Sidecar frame exceeds the configured byte limit.");
  }
  if (raw.includes("\n") || raw.includes("\r")) {
    throw new SidecarProtocolError("FRAME_CONTAINS_NEWLINE", "Sidecar frame must contain exactly one JSON object.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new SidecarProtocolError("INVALID_JSON", "Sidecar frame must be valid JSON.");
  }

  const message = validateSidecarMessage(parsed);
  applyTracking(message, options);
  return message;
}

export function serializeSidecarMessage(message: SidecarMessage, options: { readonly maxFrameBytes?: number } = {}): string {
  const validated = validateSidecarMessage(message);
  const serialized = `${JSON.stringify(validated)}\n`;
  const maxFrameBytes = options.maxFrameBytes ?? DEFAULT_SIDECAR_MAX_FRAME_BYTES;
  if (Buffer.byteLength(serialized, "utf8") > maxFrameBytes) {
    throw new SidecarProtocolError("FRAME_TOO_LARGE", "Sidecar frame exceeds the configured byte limit.");
  }
  return serialized;
}

function applyTracking(message: SidecarMessage, options: ParseSidecarFrameOptions): void {
  const tracker = options.requestTracker;
  if (!tracker) return;
  if (options.direction === "host-to-sidecar") {
    if (message.type === "request") tracker.registerRequest(message.requestId);
    if (message.type === "cancel") tracker.assertActive(message.requestId);
    return;
  }
  if (options.direction === "sidecar-to-host" && message.type === "response") {
    tracker.completeRequest(message.requestId);
  }
}

function validateSidecarMessage(value: unknown): SidecarMessage {
  const object = asObject(value, "Sidecar message must be a JSON object.");
  requireProtocolVersion(object);
  const type = requireString(object.type, "type");
  if (!MESSAGE_TYPES.has(type)) {
    throw new SidecarProtocolError("UNKNOWN_MESSAGE_TYPE", `Unknown sidecar message type: ${type}.`);
  }

  if (type === "hello") return validateHello(object);
  if (type === "ready") return validateReady(object);
  if (type === "request") return validateRequest(object);
  if (type === "response") return validateResponse(object);
  if (type === "cancel") return validateCancel(object);
  return validateEvent(object);
}

function validateHello(object: Record<string, unknown>): SidecarHelloMessage {
  assertKnownKeys(object, ["protocolVersion", "type", "nonce"]);
  const nonce = requireBoundedString(object.nonce, "nonce", 128);
  return { protocolVersion: SIDECAR_PROTOCOL_VERSION, type: "hello", nonce };
}

function validateReady(object: Record<string, unknown>): SidecarReadyMessage {
  assertKnownKeys(object, ["protocolVersion", "type", "nonce"]);
  const nonce = requireBoundedString(object.nonce, "nonce", 128);
  return { protocolVersion: SIDECAR_PROTOCOL_VERSION, type: "ready", nonce };
}

function validateRequest(object: Record<string, unknown>): SidecarRequestMessage {
  assertKnownKeys(object, ["protocolVersion", "type", "requestId", "method", "payload"]);
  const requestId = requireRequestId(object.requestId);
  const method = requireString(object.method, "method");
  if (!REQUEST_METHOD_SET.has(method)) {
    throw new SidecarProtocolError("UNKNOWN_METHOD", `Unknown sidecar request method: ${method}.`);
  }
  const requestMethod = method as SidecarRequestMethod;
  const payload = asJsonObject(object.payload, "Request payload must be a JSON object.");
  validateRequestPayload(requestMethod, payload);
  return { protocolVersion: SIDECAR_PROTOCOL_VERSION, type: "request", requestId, method: requestMethod, payload };
}

function validateResponse(object: Record<string, unknown>): SidecarResponseMessage {
  assertKnownKeys(object, ["protocolVersion", "type", "requestId", "ok", "payload", "error"]);
  const requestId = requireRequestId(object.requestId);
  if (typeof object.ok !== "boolean") throw new SidecarProtocolError("INVALID_MESSAGE", "Response ok must be a boolean.");
  if (object.error !== undefined) {
    const error = asObject(object.error, "Response error must be a JSON object.");
    assertKnownKeys(error, ["code", "message"]);
    const code = requireBoundedString(error.code, "error.code", 120);
    const message = requireBoundedString(error.message, "error.message", 500);
    if (object.ok) throw new SidecarProtocolError("INVALID_MESSAGE", "Successful responses must not include error.");
    return { protocolVersion: SIDECAR_PROTOCOL_VERSION, type: "response", requestId, ok: false, error: { code, message } };
  }
  if (!object.ok) throw new SidecarProtocolError("INVALID_MESSAGE", "Failed responses must include error.");
  const payload = object.payload;
  return payload === undefined
    ? { protocolVersion: SIDECAR_PROTOCOL_VERSION, type: "response", requestId, ok: true }
    : { protocolVersion: SIDECAR_PROTOCOL_VERSION, type: "response", requestId, ok: true, payload: asJsonValue(payload, "payload") };
}

function validateCancel(object: Record<string, unknown>): SidecarCancelMessage {
  assertKnownKeys(object, ["protocolVersion", "type", "requestId"]);
  return { protocolVersion: SIDECAR_PROTOCOL_VERSION, type: "cancel", requestId: requireRequestId(object.requestId) };
}

function validateEvent(object: Record<string, unknown>): SidecarEventMessage {
  assertKnownKeys(object, ["protocolVersion", "type", "event", "payload"]);
  const event = requireString(object.event, "event");
  if (!EVENT_SET.has(event)) {
    throw new SidecarProtocolError("UNKNOWN_EVENT", `Unknown sidecar event: ${event}.`);
  }
  const payload = asJsonObject(object.payload, "Event payload must be a JSON object.");
  return { protocolVersion: SIDECAR_PROTOCOL_VERSION, type: "event", event: event as SidecarEventName, payload };
}

function validateRequestPayload(method: SidecarRequestMethod, payload: JsonObject): void {
  const allowedKeys = METHOD_PAYLOAD_KEYS[method];
  assertKnownKeys(payload, allowedKeys);
  if (EMPTY_PAYLOAD_METHODS.has(method) && Object.keys(payload).length > 0) {
    throw new SidecarProtocolError("UNKNOWN_FIELD", `${method} payload must be empty.`);
  }
  for (const key of ["agentId", "backendId", "taskType", "schemaId", "model", "runRequestId"]) {
    if (key in payload) requireBoundedString(payload[key], key, 180);
  }
  if ("timeoutMs" in payload && (!Number.isSafeInteger(payload.timeoutMs) || Number(payload.timeoutMs) <= 0)) {
    throw new SidecarProtocolError("INVALID_PAYLOAD", "timeoutMs must be a positive safe integer.");
  }
}

function requireProtocolVersion(object: Record<string, unknown>): void {
  if (object.protocolVersion !== SIDECAR_PROTOCOL_VERSION) {
    throw new SidecarProtocolError("INVALID_PROTOCOL_VERSION", `Sidecar protocolVersion must be ${SIDECAR_PROTOCOL_VERSION}.`);
  }
}

function requireRequestId(value: unknown): string {
  const requestId = requireString(value, "requestId");
  if (!UUID_PATTERN.test(requestId)) {
    throw new SidecarProtocolError("INVALID_REQUEST_ID", "requestId must be a UUID.");
  }
  return requestId;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new SidecarProtocolError("INVALID_MESSAGE", `${fieldName} must be a non-empty string.`);
  }
  return value;
}

function requireBoundedString(value: unknown, fieldName: string, maxLength: number): string {
  const result = requireString(value, fieldName);
  if (result.length > maxLength || result.includes("\0")) {
    throw new SidecarProtocolError("INVALID_MESSAGE", `${fieldName} must be a bounded string.`);
  }
  return result;
}

function asObject(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SidecarProtocolError("INVALID_MESSAGE", message);
  }
  return value as Record<string, unknown>;
}

function asJsonObject(value: unknown, message: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SidecarProtocolError("INVALID_PAYLOAD", message);
  }
  for (const nestedValue of Object.values(value)) asJsonValue(nestedValue, "payload");
  return value as JsonObject;
}

function asJsonValue(value: unknown, fieldName: string): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new SidecarProtocolError("INVALID_PAYLOAD", `${fieldName} contains a non-finite number.`);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => asJsonValue(entry, fieldName));
  if (typeof value === "object") {
    for (const nestedValue of Object.values(value as Record<string, unknown>)) asJsonValue(nestedValue, fieldName);
    return value as JsonObject;
  }
  throw new SidecarProtocolError("INVALID_PAYLOAD", `${fieldName} must be JSON serializable.`);
}

function assertKnownKeys(object: Record<string, unknown> | JsonObject, allowedKeys: readonly string[]): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) throw new SidecarProtocolError("UNKNOWN_FIELD", `Unknown sidecar field: ${key}.`);
  }
}
