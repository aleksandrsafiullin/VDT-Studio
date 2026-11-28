import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";

export const APPLE_FOUNDATION_MODELS_PROTOCOL_VERSION = 1;
const PROFILE = "vdt-native-guided-v1";
const MODEL = "SystemLanguageModel.default";
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 32 * 1024;
const MAX_HELPER_BYTES = 16 * 1024 * 1024;
const MAX_TIMEOUT_MS = 120_000;

export interface AppleModelIdentity {
  readonly model: typeof MODEL;
  readonly osBuild: string;
  readonly profile: typeof PROFILE;
  readonly modelRevision: null;
}

export interface AppleModelCapability {
  readonly identity: AppleModelIdentity;
  readonly locale: string;
  readonly contextSize: number;
  readonly tokenBudgetVerified: boolean;
}

type AppleGuidedObjectShape = { readonly kind: "object"; readonly fields: readonly AppleGuidedField[] };

export type AppleGuidedShape =
  | { readonly kind: "string" | "integer" | "number" | "boolean" }
  | { readonly kind: "choice"; readonly choices: readonly string[] }
  | AppleGuidedObjectShape
  | { readonly kind: "union"; readonly variants: readonly AppleGuidedObjectShape[] }
  | { readonly kind: "array"; readonly element: AppleGuidedShape; readonly maxItems: number };

export interface AppleGuidedField {
  readonly name: string;
  readonly description?: string;
  readonly optional?: boolean;
  readonly shape: AppleGuidedShape;
}

export interface AppleCompletionRequest {
  readonly locale: string;
  readonly expectedIdentity: AppleModelIdentity;
  readonly prompt: string;
  readonly schema: Extract<AppleGuidedShape, { kind: "object" }>;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface AppleCompletion<T> {
  readonly value: T;
  readonly context: {
    readonly inputTokens: number;
    readonly contextSize: number;
    readonly reservedOutputTokens: number;
  };
}

const nativeErrors = {
  unsupported_os: "The Apple model is unavailable on this macOS version.",
  unsupported_sdk: "This build has no native Apple model support.",
  device_not_eligible: "This device does not support the Apple model.",
  apple_intelligence_disabled: "Apple Intelligence is disabled.",
  model_not_ready: "The Apple model is not ready.",
  unsupported_locale: "The Apple model does not support the selected locale.",
  stale_identity: "The Apple model execution identity changed.",
  token_api_unavailable: "The Apple SDK cannot verify this request's context budget.",
  context_exceeded: "The Apple model request exceeds the available context.",
  invalid_request: "The native Apple model request is invalid.",
  invalid_guide: "The native Apple model guide is unsupported.",
  invalid_output: "The native Apple model returned invalid output.",
  refused: "The Apple model declined the request.",
  rate_limited: "The Apple model is temporarily rate limited.",
  busy: "The Apple model is already running a request.",
  timeout: "The Apple model request timed out.",
  cancelled: "The Apple model request was cancelled.",
  unavailable: "The Apple model request could not be completed.",
  helper_identity: "The bundled Apple helper is missing or its integrity check failed.",
  helper_protocol: "The Apple helper returned an invalid or uncorrelated reply.",
  helper_exit: "The Apple helper exited before completing the request."
} as const;

export type AppleTransportErrorCode = keyof typeof nativeErrors;

type AppleTimeoutOrigin = "PRE_SPAWN_BUDGET" | "PARENT_DEADLINE" | "HELPER_REPLY";

export class AppleTransportError extends Error {
  constructor(
    readonly code: AppleTransportErrorCode,
    readonly invalidOutputOrigin?: "native_output" | "canonical_validation",
    readonly timeoutOrigin?: AppleTimeoutOrigin
  ) {
    super(nativeErrors[code]);
    this.name = "AppleTransportError";
  }
}

interface AppleTransportOptions {
  /** App-owned path and digest. Neither value may come from browser frames. */
  readonly helperPath: string;
  readonly helperSha256: string;
}

type WireRequest =
  | { readonly op: "capabilities"; readonly locale: string }
  | (Pick<AppleCompletionRequest, "locale" | "expectedIdentity" | "prompt" | "schema" | "maxOutputTokens"> & { readonly op: "generate" });

/** Private single-flight owner. The helper runner accepts exactly one bounded
 * request per process, and only an exited child can release the execution slot. */
export class AppleFoundationModelsTransport {
  readonly #helperPath: string;
  readonly #helperSha256: string;
  #busy = false;

  constructor(options: AppleTransportOptions) {
    if (!isAbsolute(options.helperPath) || options.helperPath !== normalize(options.helperPath)
      || !/^[a-f0-9]{64}$/.test(options.helperSha256)) {
      throw new AppleTransportError("helper_identity");
    }
    this.#helperPath = options.helperPath;
    this.#helperSha256 = options.helperSha256;
  }

  async discover(locale: string, signal?: AbortSignal): Promise<AppleModelCapability> {
    validateLocale(locale);
    const capability = await this.#request({ op: "capabilities", locale }, 10_000, signal);
    if (!record(capability) || capability.locale !== locale || !isIdentity(capability.identity)
      || !positiveInteger(capability.contextSize, 131_072) || typeof capability.tokenBudgetVerified !== "boolean") {
      throw new AppleTransportError("helper_protocol");
    }
    return {
      locale,
      identity: capability.identity,
      contextSize: capability.contextSize,
      tokenBudgetVerified: capability.tokenBudgetVerified
    };
  }

  async complete<T>(request: AppleCompletionRequest, validateCanonical: (proposal: unknown) => T): Promise<AppleCompletion<T>> {
    validateLocale(request.locale);
    if (!isIdentity(request.expectedIdentity) || typeof request.prompt !== "string"
      || request.prompt.trim().length === 0 || Buffer.byteLength(request.prompt) > 48 * 1024
      || !positiveInteger(request.maxOutputTokens, 2_048) || !positiveInteger(request.timeoutMs, MAX_TIMEOUT_MS)
      || request.schema?.kind !== "object") {
      throw new AppleTransportError("invalid_request");
    }
    validateShape(request.schema);
    const result = await this.#request({
      op: "generate", locale: request.locale, expectedIdentity: request.expectedIdentity,
      prompt: request.prompt, schema: request.schema, maxOutputTokens: request.maxOutputTokens
    }, request.timeoutMs, request.signal);
    if (!record(result) || !isIdentity(result.identity) || result.identity.osBuild !== request.expectedIdentity.osBuild
      || !positiveInteger(result.contextSize, 131_072) || !positiveInteger(result.inputTokens, result.contextSize)
      || result.inputTokens + request.maxOutputTokens > result.contextSize || !record(result.proposal)) {
      throw new AppleTransportError("helper_protocol");
    }
    if (request.signal?.aborted) throw new AppleTransportError("cancelled");
    let value: T;
    try {
      value = validateCanonical(result.proposal);
    } catch {
      throw new AppleTransportError("invalid_output", "canonical_validation");
    }
    return { value, context: {
      inputTokens: result.inputTokens, contextSize: result.contextSize, reservedOutputTokens: request.maxOutputTokens
    } };
  }

  async #request(body: WireRequest, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) throw new AppleTransportError("cancelled");
    if (this.#busy) throw new AppleTransportError("busy");
    this.#busy = true;
    const id = randomUUID();
    const deadline = performance.now() + timeoutMs;
    try {
      const frame = Buffer.from(JSON.stringify({ version: APPLE_FOUNDATION_MODELS_PROTOCOL_VERSION, id, ...body }) + "\n");
      if (frame.length > MAX_REQUEST_BYTES) throw new AppleTransportError("invalid_request");
      await verifyAppleHelper(this.#helperPath, this.#helperSha256);
      if (signal?.aborted) throw new AppleTransportError("cancelled");
      const remainingMs = deadline - performance.now();
      if (remainingMs <= 0) throw new AppleTransportError("timeout", undefined, "PRE_SPAWN_BUDGET");
      return await runHelper(this.#helperPath, frame, id, remainingMs, signal);
    } catch (error) {
      if (body.op === "generate" && error instanceof AppleTransportError && error.code === "invalid_output") {
        throw new AppleTransportError("invalid_output", "native_output");
      }
      throw error;
    } finally {
      this.#busy = false;
    }
  }
}

export async function verifyAppleHelper(path: string, expectedHash: string): Promise<void> {
  try {
    if (await realpath(path) !== path) throw new Error();
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_HELPER_BYTES || !(stat.mode & 0o111)) throw new Error();
      const hash = createHash("sha256");
      let bytes = 0;
      for await (const chunk of handle.createReadStream({ autoClose: false })) {
        bytes += (chunk as Buffer).length;
        if (bytes > stat.size) throw new Error();
        hash.update(chunk as Buffer);
      }
      if (bytes !== stat.size || hash.digest("hex") !== expectedHash) throw new Error();
    } finally {
      await handle.close();
    }
  } catch {
    throw new AppleTransportError("helper_identity");
  }
}

function runHelper(path: string, frame: Buffer, id: string, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(path, [], {
      cwd: "/", env: { LANG: "en_US.UTF-8", NODE_ENV: "production" }, stdio: ["pipe", "pipe", "pipe"]
    });
    const output: Buffer[] = [];
    let size = 0;
    let failure: AppleTransportError | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (code: AppleTransportErrorCode) => {
      if (failure) return;
      failure = new AppleTransportError(code, undefined, code === "timeout" ? "PARENT_DEADLINE" : undefined);
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 250);
    };
    const abort = () => stop("cancelled");
    const timer = setTimeout(() => stop("timeout"), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.stderr.resume();
    child.stdout.on("data", (chunk: Buffer) => {
      if (failure) return;
      size += chunk.length;
      if (size > MAX_RESPONSE_BYTES) stop("helper_protocol");
      else output.push(chunk);
    });
    child.on("error", () => stop("helper_exit"));
    child.stdin.on("error", () => stop("helper_exit"));
    child.once("close", (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", abort);
      if (failure) return reject(failure);
      if (code !== 0) return reject(new AppleTransportError("helper_exit"));
      try {
        resolve(parseReply(Buffer.concat(output), id));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(frame);
  });
}

function parseReply(bytes: Buffer, id: string): unknown {
  let packet: unknown;
  try {
    const wire = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!wire.endsWith("\n") || wire.indexOf("\n") !== wire.length - 1) throw new Error();
    packet = JSON.parse(wire);
  } catch {
    throw new AppleTransportError("helper_protocol");
  }
  if (!record(packet) || packet.id !== id || packet.version !== APPLE_FOUNDATION_MODELS_PROTOCOL_VERSION
    || Object.keys(packet).length !== 3) throw new AppleTransportError("helper_protocol");
  if ("error" in packet && typeof packet.error === "string" && Object.hasOwn(nativeErrors, packet.error)) {
    throw new AppleTransportError(packet.error as AppleTransportErrorCode, undefined,
      packet.error === "timeout" ? "HELPER_REPLY" : undefined);
  }
  if (!("result" in packet)) throw new AppleTransportError("helper_protocol");
  return packet.result;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= max;
}

function isIdentity(value: unknown): value is AppleModelIdentity {
  return record(value) && Object.keys(value).length === 4 && value.model === MODEL && value.profile === PROFILE
    && value.modelRevision === null && typeof value.osBuild === "string" && /^[\x20-\x7e]{1,120}$/.test(value.osBuild);
}

function validateLocale(locale: string): void {
  if (typeof locale !== "string" || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(locale)) {
    throw new AppleTransportError("invalid_request");
  }
}

function validateShape(shape: AppleGuidedShape): void {
  let nodes = 0;
  const walk = (node: unknown, depth: number): boolean => {
    if (!record(node) || ++nodes > 96 || depth > 6) return false;
    switch (node.kind) {
      case "string": case "integer": case "number": case "boolean":
        return Object.keys(node).length === 1;
      case "choice":
        return Object.keys(node).length === 2 && Array.isArray(node.choices) && node.choices.length > 0
          && node.choices.length <= 24 && new Set(node.choices).size === node.choices.length
          && node.choices.every(value => typeof value === "string" && value.length > 0 && value.length <= 100);
      case "array":
        return Object.keys(node).length === 3 && positiveInteger(node.maxItems, 20) && walk(node.element, depth + 1);
      case "union":
        return Object.keys(node).length === 2 && Array.isArray(node.variants)
          && node.variants.length >= 2 && node.variants.length <= 8
          && Array.from(node.variants).every(variant => record(variant) && variant.kind === "object" && walk(variant, depth + 1));
      case "object": {
        if (Object.keys(node).length !== 2 || !Array.isArray(node.fields) || !node.fields.length || node.fields.length > 24) return false;
        const names = new Set<string>();
        return node.fields.every(field => {
          if (!record(field) || !Object.keys(field).every(key => ["name", "description", "optional", "shape"].includes(key))
            || typeof field.name !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(field.name) || names.has(field.name)
            || (field.description !== undefined && (typeof field.description !== "string" || field.description.length > 240))
            || (field.optional !== undefined && typeof field.optional !== "boolean")) return false;
          names.add(field.name);
          return walk(field.shape, depth + 1);
        });
      }
      default:
        return false;
    }
  };
  if (!walk(shape, 0)) throw new AppleTransportError("invalid_guide");
}
