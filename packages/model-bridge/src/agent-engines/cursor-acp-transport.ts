import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import type {
  CursorAcpJsonRpcFailure,
  CursorAcpJsonRpcId,
  CursorAcpJsonRpcNotification,
  CursorAcpJsonRpcRequest,
  CursorAcpRequestOptions,
  CursorAcpTransport
} from "./cursor-acp-types";

const DEFAULT_MAX_LINE_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 256 * 1024;
const DEFAULT_MAX_OUTGOING_BYTES = 4 * 1024 * 1024;

export interface CursorAcpStdioTransportOptions {
  /** Must be an absolute, server-resolved path. PATH lookup is intentionally disabled. */
  readonly executable: string;
  /** Must be a private per-run workspace, never the VDT repository. */
  readonly cwd: string;
  /** Server-resolved model. It is passed as one argv value and never read from model output. */
  readonly model?: string;
  /** Explicit environment only. The parent process environment is never inherited implicitly. */
  readonly environment?: Readonly<Record<string, string>>;
  readonly maxLineBytes?: number;
  readonly maxStderrBytes?: number;
  readonly maxOutgoingBytes?: number;
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly cleanup: () => void;
}

type InboundMessage = CursorAcpJsonRpcRequest | CursorAcpJsonRpcNotification;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonRpcId(value: unknown): value is CursorAcpJsonRpcId {
  return typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value));
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected <= 0) throw new Error(`${name} must be a positive integer.`);
  return selected;
}

function transportError(code: string, message: string, details: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { code, ...details });
}

function validatePrivatePath(value: string, field: string): void {
  if (!path.isAbsolute(value) || value === path.parse(value).root || value.includes("\0")) {
    throw transportError("CURSOR_ACP_UNSAFE_CONFIGURATION", `${field} must be a non-root absolute path.`);
  }
}

/**
 * Persistent newline-delimited JSON-RPC transport for `agent acp`.
 *
 * It only implements transport mechanics. Capability qualification and the
 * VDT-only tool boundary are enforced by CursorAcpEngine and the host.
 */
export class CursorAcpStdioTransport implements CursorAcpTransport {
  readonly #options: CursorAcpStdioTransportOptions;
  readonly #maxLineBytes: number;
  readonly #maxStderrBytes: number;
  readonly #maxOutgoingBytes: number;
  readonly #decoder = new StringDecoder("utf8");
  readonly #pending = new Map<string, PendingRequest>();
  readonly #messageListeners = new Set<(message: InboundMessage) => void>();
  readonly #closeListeners = new Set<(error?: Error) => void>();
  #process: ChildProcessWithoutNullStreams | undefined;
  #stdoutBuffer = "";
  #stderrBuffer = Buffer.alloc(0);
  #nextRequestId = 1;
  #started = false;
  #closed = false;
  #closeEmitted = false;

  constructor(options: CursorAcpStdioTransportOptions) {
    validatePrivatePath(options.executable, "executable");
    validatePrivatePath(options.cwd, "cwd");
    if (options.model !== undefined && (!options.model.trim() || options.model.startsWith("-") || options.model.includes("\0") || options.model.length > 256)) {
      throw transportError("CURSOR_ACP_UNSAFE_CONFIGURATION", "model is invalid.");
    }
    for (const [name, value] of Object.entries(options.environment ?? {})) {
      if (!name || name.includes("=") || name.includes("\0") || value.includes("\0")) {
        throw transportError("CURSOR_ACP_UNSAFE_CONFIGURATION", "ACP environment contains an invalid entry.");
      }
    }
    this.#options = options;
    this.#maxLineBytes = positiveInteger(options.maxLineBytes, DEFAULT_MAX_LINE_BYTES, "maxLineBytes");
    this.#maxStderrBytes = positiveInteger(options.maxStderrBytes, DEFAULT_MAX_STDERR_BYTES, "maxStderrBytes");
    this.#maxOutgoingBytes = positiveInteger(options.maxOutgoingBytes, DEFAULT_MAX_OUTGOING_BYTES, "maxOutgoingBytes");
  }

  async start(): Promise<void> {
    if (this.#started) return;
    if (this.#closed) throw transportError("CURSOR_ACP_TRANSPORT_CLOSED", "Cursor ACP transport is closed.");
    this.#started = true;

    const args = [
      ...(this.#options.model ? ["--model", this.#options.model] : []),
      "--sandbox",
      "enabled",
      "acp"
    ];
    // Deliberately do not inherit process.env. The assertion only bridges a
    // Next.js ambient ProcessEnv augmentation that makes NODE_ENV required;
    // the spawned process still receives exactly the server-owned entries.
    const explicitEnvironment = { ...(this.#options.environment ?? {}) } as NodeJS.ProcessEnv;
    const child = spawn(this.#options.executable, args, {
      cwd: this.#options.cwd,
      env: explicitEnvironment,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true
    });
    this.#process = child;

    child.stdout.on("data", (chunk: Buffer | string) => this.#onStdout(chunk));
    child.stdout.on("end", () => this.#onStdoutEnd());
    child.stderr.on("data", (chunk: Buffer | string) => this.#onStderr(chunk));
    child.once("error", (error) => this.#terminate(transportError(
      "CURSOR_ACP_PROCESS_ERROR",
      `Cursor ACP process failed: ${error.message}`,
      { cause: error }
    )));
    child.once("exit", (code, signal) => {
      if (this.#closed) return;
      this.#terminate(transportError(
        "CURSOR_ACP_PROCESS_EXITED",
        `Cursor ACP process exited (code=${String(code)}, signal=${String(signal)}).`,
        { exitCode: code, signal, stderrAvailable: Boolean(this.stderrTail().trim()) }
      ));
    });
  }

  request(method: string, params: unknown, options: CursorAcpRequestOptions = {}): Promise<unknown> {
    this.#assertWritable();
    if (!method || method.includes("\0")) {
      return Promise.reject(transportError("CURSOR_ACP_PROTOCOL_INVALID", "JSON-RPC method is invalid."));
    }
    if (options.signal?.aborted) {
      return Promise.reject(transportError("CURSOR_ACP_REQUEST_CANCELLED", `Cursor ACP request ${method} was cancelled.`));
    }

    const id = `vdt-acp-${this.#nextRequestId++}`;
    const key = String(id);
    return new Promise<unknown>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onAbort = () => {
        this.#pending.delete(key);
        cleanup();
        void this.notify("$/cancel_request", { id }).catch(() => undefined);
        reject(transportError("CURSOR_ACP_REQUEST_CANCELLED", `Cursor ACP request ${method} was cancelled.`));
      };
      const cleanup = () => {
        if (timer !== undefined) clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
      };
      if (options.timeoutMs !== undefined) {
        if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
          reject(transportError("CURSOR_ACP_PROTOCOL_INVALID", "timeoutMs must be a positive integer."));
          return;
        }
        timer = setTimeout(() => {
          this.#pending.delete(key);
          cleanup();
          void this.notify("$/cancel_request", { id }).catch(() => undefined);
          reject(transportError("CURSOR_ACP_REQUEST_TIMEOUT", `Cursor ACP request ${method} timed out.`));
        }, options.timeoutMs);
      }
      options.signal?.addEventListener("abort", onAbort, { once: true });
      this.#pending.set(key, { resolve, reject, cleanup });
      void this.#write({ jsonrpc: "2.0", id, method, params }).catch((error: unknown) => {
        const pending = this.#pending.get(key);
        if (!pending) return;
        this.#pending.delete(key);
        pending.cleanup();
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  notify(method: string, params: unknown): Promise<void> {
    this.#assertWritable();
    if (!method || method.includes("\0")) {
      return Promise.reject(transportError("CURSOR_ACP_PROTOCOL_INVALID", "JSON-RPC method is invalid."));
    }
    return this.#write({ jsonrpc: "2.0", method, params });
  }

  respond(id: CursorAcpJsonRpcId, result: unknown): Promise<void> {
    this.#assertWritable();
    return this.#write({ jsonrpc: "2.0", id, result });
  }

  respondError(id: CursorAcpJsonRpcId, code: number, message: string, data?: unknown): Promise<void> {
    this.#assertWritable();
    const error: { code: number; message: string; data?: unknown } = { code, message };
    if (data !== undefined) error.data = data;
    return this.#write({ jsonrpc: "2.0", id, error });
  }

  onMessage(listener: (message: InboundMessage) => void): () => void {
    this.#messageListeners.add(listener);
    return () => this.#messageListeners.delete(listener);
  }

  onClose(listener: (error?: Error) => void): () => void {
    this.#closeListeners.add(listener);
    return () => this.#closeListeners.delete(listener);
  }

  stderrTail(): string {
    return this.#stderrBuffer.toString("utf8");
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    const error = transportError("CURSOR_ACP_TRANSPORT_CLOSED", "Cursor ACP transport closed.");
    this.#rejectPending(error);
    this.#emitClose();
    const child = this.#process;
    this.#process = undefined;
    if (child) {
      child.stdin.end();
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    }
  }

  #assertWritable(): void {
    if (!this.#started) throw transportError("CURSOR_ACP_TRANSPORT_NOT_STARTED", "Cursor ACP transport has not started.");
    if (this.#closed || !this.#process) throw transportError("CURSOR_ACP_TRANSPORT_CLOSED", "Cursor ACP transport is closed.");
  }

  #write(message: unknown): Promise<void> {
    const child = this.#process;
    if (!child || this.#closed) {
      return Promise.reject(transportError("CURSOR_ACP_TRANSPORT_CLOSED", "Cursor ACP transport is closed."));
    }
    let serialized: string;
    try {
      serialized = `${JSON.stringify(message)}\n`;
    } catch {
      return Promise.reject(transportError("CURSOR_ACP_PROTOCOL_INVALID", "JSON-RPC message is not serializable."));
    }
    if (Buffer.byteLength(serialized, "utf8") > this.#maxOutgoingBytes) {
      return Promise.reject(transportError(
        "CURSOR_ACP_MESSAGE_TOO_LARGE",
        `Outgoing Cursor ACP message exceeds ${this.#maxOutgoingBytes} bytes.`
      ));
    }
    return new Promise<void>((resolve, reject) => {
      child.stdin.write(serialized, "utf8", (error) => {
        if (error) reject(transportError("CURSOR_ACP_WRITE_FAILED", `Cursor ACP write failed: ${error.message}.`));
        else resolve();
      });
    });
  }

  #onStdout(chunk: Buffer | string): void {
    if (this.#closed) return;
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    this.#stdoutBuffer += this.#decoder.write(buffer);
    if (Buffer.byteLength(this.#stdoutBuffer, "utf8") > this.#maxLineBytes && !this.#stdoutBuffer.includes("\n")) {
      this.#protocolFailure(`Cursor ACP line exceeds ${this.#maxLineBytes} bytes.`);
      return;
    }

    let newline = this.#stdoutBuffer.indexOf("\n");
    while (newline >= 0 && !this.#closed) {
      const line = this.#stdoutBuffer.slice(0, newline).replace(/\r$/, "");
      this.#stdoutBuffer = this.#stdoutBuffer.slice(newline + 1);
      if (Buffer.byteLength(line, "utf8") > this.#maxLineBytes) {
        this.#protocolFailure(`Cursor ACP line exceeds ${this.#maxLineBytes} bytes.`);
        return;
      }
      if (line.trim()) this.#parseLine(line);
      newline = this.#stdoutBuffer.indexOf("\n");
    }
  }

  #onStdoutEnd(): void {
    if (this.#closed) return;
    this.#stdoutBuffer += this.#decoder.end();
    const trailing = this.#stdoutBuffer.trim();
    this.#stdoutBuffer = "";
    if (trailing) this.#parseLine(trailing);
  }

  #onStderr(chunk: Buffer | string): void {
    const incoming = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    const combined = Buffer.concat([this.#stderrBuffer, incoming]);
    this.#stderrBuffer = combined.byteLength <= this.#maxStderrBytes
      ? combined
      : combined.subarray(combined.byteLength - this.#maxStderrBytes);
  }

  #parseLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      this.#protocolFailure("Cursor ACP stdout contained malformed JSON-RPC.");
      return;
    }
    if (!isRecord(parsed) || parsed.jsonrpc !== "2.0") {
      this.#protocolFailure("Cursor ACP stdout contained an invalid JSON-RPC envelope.");
      return;
    }

    if (Object.hasOwn(parsed, "result") || Object.hasOwn(parsed, "error")) {
      if (!isJsonRpcId(parsed.id)) {
        this.#protocolFailure("Cursor ACP response has an invalid id.");
        return;
      }
      const pending = this.#pending.get(String(parsed.id));
      if (!pending) return;
      this.#pending.delete(String(parsed.id));
      pending.cleanup();
      if (Object.hasOwn(parsed, "error")) {
        const failure = parsed as unknown as CursorAcpJsonRpcFailure;
        const rpcError = failure.error;
        pending.reject(transportError(
          "CURSOR_ACP_RPC_ERROR",
          typeof rpcError?.message === "string" ? rpcError.message : "Cursor ACP returned an error.",
          { rpcCode: rpcError?.code, rpcData: rpcError?.data }
        ));
      } else {
        pending.resolve(parsed.result);
      }
      return;
    }

    if (typeof parsed.method !== "string" || !parsed.method) {
      this.#protocolFailure("Cursor ACP inbound message has no method.");
      return;
    }
    if (Object.hasOwn(parsed, "id") && !isJsonRpcId(parsed.id)) {
      this.#protocolFailure("Cursor ACP request has an invalid id.");
      return;
    }
    const inbound = parsed as unknown as InboundMessage;
    for (const listener of this.#messageListeners) listener(inbound);
  }

  #protocolFailure(message: string): void {
    this.#terminate(transportError("CURSOR_ACP_PROTOCOL_INVALID", message));
  }

  #terminate(error: Error): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#rejectPending(error);
    this.#emitClose(error);
    const child = this.#process;
    this.#process = undefined;
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #emitClose(error?: Error): void {
    if (this.#closeEmitted) return;
    this.#closeEmitted = true;
    for (const listener of this.#closeListeners) listener(error);
    this.#closeListeners.clear();
    this.#messageListeners.clear();
  }
}
