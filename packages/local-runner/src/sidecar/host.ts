import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  SIDECAR_PROTOCOL_VERSION,
  SidecarFrameDecoder,
  SidecarProtocolError,
  SidecarRequestTracker,
  serializeSidecarMessage,
  type JsonObject,
  type JsonValue,
  type SidecarMessage,
  type SidecarRequestMethod
} from "./protocol";

export type SidecarHostErrorCode =
  | "SIDECAR_NOT_STARTED"
  | "SIDECAR_START_TIMEOUT"
  | "SIDECAR_PROTOCOL_ERROR"
  | "SIDECAR_WRITE_FAILED"
  | "SIDECAR_EXITED"
  | "SIDECAR_STOPPED"
  | "SIDECAR_REQUEST_FAILED"
  | "SIDECAR_CRASH_LOOP";

export class SidecarHostError extends Error {
  constructor(readonly code: SidecarHostErrorCode, message: string) {
    super(message);
    this.name = "SidecarHostError";
  }
}

export interface SidecarHostOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly maxFrameBytes?: number;
  readonly handshakeTimeoutMs?: number;
  readonly maxCrashRestarts?: number;
  readonly crashWindowMs?: number;
  readonly stderrSink?: (line: string) => void;
}

interface PendingRequest {
  readonly resolve: (value: JsonValue | undefined) => void;
  readonly reject: (error: Error) => void;
}

export interface StartedSidecarRequest {
  readonly requestId: string;
  readonly response: Promise<JsonValue | undefined>;
}

export class SidecarProcessHost {
  readonly #options: SidecarHostOptions;
  readonly #tracker = new SidecarRequestTracker();
  readonly #pending = new Map<string, PendingRequest>();
  #child: ChildProcessWithoutNullStreams | undefined;
  #decoder: SidecarFrameDecoder | undefined;
  #startPromise: Promise<void> | undefined;
  #resolveStart: (() => void) | undefined;
  #rejectStart: ((error: Error) => void) | undefined;
  #handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  #crashTimestamps: number[] = [];
  #stopping = false;
  #ready = false;

  constructor(options: SidecarHostOptions) {
    this.#options = options;
  }

  get ready(): boolean {
    return this.#ready;
  }

  get pid(): number | undefined {
    return this.#child?.pid;
  }

  async start(): Promise<void> {
    if (this.#ready) return;
    if (this.#startPromise) return this.#startPromise;
    this.#assertCrashBudget();

    this.#stopping = false;
    this.#ready = false;
    const decoderOptions = {
      requestTracker: this.#tracker,
      direction: "sidecar-to-host"
    } satisfies ConstructorParameters<typeof SidecarFrameDecoder>[0];
    this.#decoder = new SidecarFrameDecoder(this.#options.maxFrameBytes === undefined
      ? decoderOptions
      : { ...decoderOptions, maxFrameBytes: this.#options.maxFrameBytes });

    this.#startPromise = new Promise<void>((resolve, reject) => {
      this.#resolveStart = resolve;
      this.#rejectStart = reject;
      this.#handshakeTimer = setTimeout(() => {
        this.#failProcess(new SidecarHostError("SIDECAR_START_TIMEOUT", "Sidecar did not complete the startup handshake in time."));
      }, this.#options.handshakeTimeoutMs ?? 5000);
    });

    try {
      const child = spawn(this.#options.command, this.#options.args ?? [], {
        cwd: this.#options.cwd,
        env: this.#options.env ?? process.env,
        stdio: ["pipe", "pipe", "pipe"]
      });
      this.#child = child;
      child.stdout.on("data", (chunk: Buffer) => this.#handleStdout(chunk));
      child.stderr.on("data", (chunk: Buffer) => this.#handleStderr(chunk));
      child.once("error", (error) => this.#failProcess(new SidecarHostError("SIDECAR_EXITED", error.message)));
      child.once("exit", (code, signal) => this.#handleExit(code, signal));
    } catch (error) {
      this.#failProcess(error instanceof Error ? error : new Error(String(error)));
    }

    return this.#startPromise;
  }

  async request(method: SidecarRequestMethod, payload: JsonObject = {}): Promise<JsonValue | undefined> {
    return (await this.beginRequest(method, payload)).response;
  }

  async beginRequest(method: SidecarRequestMethod, payload: JsonObject = {}): Promise<StartedSidecarRequest> {
    await this.start();
    const child = this.#requireChild();
    const requestId = randomUUID();
    this.#tracker.registerRequest(requestId);
    const response: Promise<JsonValue | undefined> = new Promise((resolve, reject) => {
      this.#pending.set(requestId, { resolve, reject });
    });
    this.#write(child, {
      protocolVersion: SIDECAR_PROTOCOL_VERSION,
      type: "request",
      requestId,
      method,
      payload
    });
    return { requestId, response };
  }

  cancel(requestId: string): void {
    const child = this.#requireChild();
    this.#tracker.assertActive(requestId);
    this.#write(child, {
      protocolVersion: SIDECAR_PROTOCOL_VERSION,
      type: "cancel",
      requestId
    });
  }

  async stop(): Promise<void> {
    const child = this.#child;
    this.#stopping = true;
    this.#clearHandshakeTimer();
    this.#ready = false;
    this.#rejectStart?.(new SidecarHostError("SIDECAR_STOPPED", "Sidecar was stopped before becoming ready."));
    this.#rejectStart = undefined;
    this.#resolveStart = undefined;
    this.#startPromise = undefined;
    this.#rejectPending(new SidecarHostError("SIDECAR_STOPPED", "Sidecar was stopped."));
    if (!child) return;

    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      const timeout = setTimeout(resolve, 1000);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
      child.kill();
    });
    if (this.#child === child) this.#child = undefined;
    this.#decoder = undefined;
  }

  #handleStdout(chunk: Buffer): void {
    if (!this.#decoder) return;
    try {
      const messages = this.#decoder.push(chunk);
      for (const message of messages) this.#handleMessage(message);
    } catch (error) {
      const message = error instanceof SidecarProtocolError
        ? new SidecarHostError("SIDECAR_PROTOCOL_ERROR", `${error.code}: ${error.message}`)
        : error instanceof Error
          ? error
          : new Error(String(error));
      this.#failProcess(message);
    }
  }

  #handleStderr(chunk: Buffer): void {
    const sink = this.#options.stderrSink;
    if (!sink) return;
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (line.length > 0) sink(line);
    }
  }

  #handleMessage(message: SidecarMessage): void {
    if (message.type === "hello") {
      const child = this.#child;
      if (!child) throw new SidecarHostError("SIDECAR_NOT_STARTED", "Sidecar process is not available.");
      this.#write(child, {
        protocolVersion: SIDECAR_PROTOCOL_VERSION,
        type: "ready",
        nonce: message.nonce
      });
      this.#ready = true;
      this.#clearHandshakeTimer();
      this.#resolveStart?.();
      this.#resolveStart = undefined;
      this.#rejectStart = undefined;
      return;
    }

    if (message.type !== "response") return;
    const pending = this.#pending.get(message.requestId);
    if (!pending) return;
    this.#pending.delete(message.requestId);
    if (message.ok) {
      pending.resolve(message.payload);
    } else {
      const responseError = message.error;
      pending.reject(new SidecarHostError(
        "SIDECAR_REQUEST_FAILED",
        responseError ? `${responseError.code}: ${responseError.message}` : "Sidecar request failed without a structured error."
      ));
    }
  }

  #handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    const description = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
    const error = this.#stopping
      ? new SidecarHostError("SIDECAR_STOPPED", "Sidecar was stopped.")
      : new SidecarHostError("SIDECAR_EXITED", `Sidecar exited with ${description}.`);
    this.#failProcess(error);
  }

  #write(child: ChildProcessWithoutNullStreams, message: SidecarMessage): void {
    const serialized = this.#options.maxFrameBytes === undefined
      ? serializeSidecarMessage(message)
      : serializeSidecarMessage(message, { maxFrameBytes: this.#options.maxFrameBytes });
    if (!child.stdin.writable || !child.stdin.write(serialized)) {
      throw new SidecarHostError("SIDECAR_WRITE_FAILED", "Failed to write to sidecar stdin.");
    }
  }

  #requireChild(): ChildProcessWithoutNullStreams {
    if (!this.#child || !this.#ready) {
      throw new SidecarHostError("SIDECAR_NOT_STARTED", "Sidecar is not ready.");
    }
    return this.#child;
  }

  #failProcess(error: Error): void {
    this.#recordCrash(error);
    this.#clearHandshakeTimer();
    this.#ready = false;
    this.#rejectStart?.(error);
    this.#resolveStart = undefined;
    this.#rejectStart = undefined;
    this.#startPromise = undefined;
    this.#rejectPending(error);
    const child = this.#child;
    this.#child = undefined;
    this.#decoder = undefined;
    if (child && child.exitCode === null && child.signalCode === null) child.kill();
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  #clearHandshakeTimer(): void {
    if (this.#handshakeTimer) clearTimeout(this.#handshakeTimer);
    this.#handshakeTimer = undefined;
  }

  #recordCrash(error: Error): void {
    if (this.#stopping) return;
    if (error instanceof SidecarHostError && (error.code === "SIDECAR_STOPPED" || error.code === "SIDECAR_CRASH_LOOP")) return;
    this.#pruneCrashTimestamps();
    this.#crashTimestamps.push(Date.now());
  }

  #assertCrashBudget(): void {
    this.#pruneCrashTimestamps();
    const maxCrashRestarts = this.#options.maxCrashRestarts ?? 3;
    if (this.#crashTimestamps.length >= maxCrashRestarts) {
      throw new SidecarHostError(
        "SIDECAR_CRASH_LOOP",
        `Sidecar restart limit reached after ${this.#crashTimestamps.length} failure(s).`
      );
    }
  }

  #pruneCrashTimestamps(): void {
    const crashWindowMs = this.#options.crashWindowMs ?? 60_000;
    const cutoff = Date.now() - crashWindowMs;
    this.#crashTimestamps = this.#crashTimestamps.filter((timestamp) => timestamp >= cutoff);
  }
}
