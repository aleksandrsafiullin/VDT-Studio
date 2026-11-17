import type { ChildProcessWithoutNullStreams } from "node:child_process";

type WorkerRequest = {
  readonly op: "measure" | "open" | "run";
  readonly id?: string;
} & Record<string, unknown>;
type JsonObject = Record<string, unknown>;
type Pending = {
  readonly request: WorkerRequest;
  readonly accept: (body: JsonObject) => void;
  readonly refuse: (reason: Error) => void;
  readonly settled: Promise<void>;
};

const MAX_FRAME = 26 * 1024 * 1024;
const SHUTDOWN_MS = 3_000;
const SAFE_WORKER_ERRORS = new Set([
  "CURSOR_CHECKPOINT_CANCELLED",
  "CURSOR_CHECKPOINT_TIMEOUT",
  "CURSOR_CHECKPOINT_PROCESS_ERROR",
  "CURSOR_CHECKPOINT_OUTPUT_TOO_LARGE",
  "CURSOR_CHECKPOINT_QUALIFICATION_MISMATCH",
  "CURSOR_CHECKPOINT_UNSAFE_ENVIRONMENT",
  "CURSOR_CHECKPOINT_CLEANUP_UNCONFIRMED",
  "SECURITY_BOUNDARY_BREACH"
]);

export function workerError(code: string, message = "The Windows Cursor worker could not complete the bounded operation."): Error {
  return Object.assign(new Error(message), { code });
}

export function wireObject(input: unknown, keys: readonly string[]): input is JsonObject {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    && Object.keys(input).length === keys.length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(input, key));
}

/** One worker owns the Job Object and at most one active request. The run
 * request also owns a cancellation signal. No cancellation acknowledgement is
 * trusted in place of the reaped run response. */
export class WindowsCursorWorkerClient {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #exited: Promise<number | null>;
  #active: Pending | undefined;
  #parts: Buffer[] = [];
  #bytes = 0;
  #unusable = false;
  #couldOwnScope = false;
  #cancelTimer: NodeJS.Timeout | undefined;
  #shutdown: Promise<void> | undefined;

  constructor(child: ChildProcessWithoutNullStreams) {
    this.#child = child;
    this.#exited = new Promise((resolve) => child.once("close", (exitCode) => {
      this.#unusable = true;
      this.#rejectPending(workerError("CURSOR_CHECKPOINT_PROCESS_ERROR"));
      resolve(exitCode);
    }));
    child.stdout.on("data", (bytes: Buffer) => this.#read(bytes));
    // Raw helper diagnostics do not become route output.
    child.stderr.resume();
    child.stdin.on("error", () => this.#fail("CURSOR_CHECKPOINT_PROCESS_ERROR"));
    child.on("error", () => this.#fail("CURSOR_CHECKPOINT_PROCESS_ERROR"));
  }

  async request(request: WorkerRequest, signal: AbortSignal): Promise<JsonObject> {
    if (signal.aborted) throw workerError("CURSOR_CHECKPOINT_CANCELLED");
    if (this.#unusable || this.#shutdown || this.#active) {
      throw workerError("CURSOR_CHECKPOINT_PROCESS_ERROR");
    }
    let accept!: Pending["accept"];
    let refuse!: Pending["refuse"];
    const result = new Promise<JsonObject>((resolve, reject) => { accept = resolve; refuse = reject; });
    this.#active = { request, accept, refuse, settled: result.then(() => undefined, () => undefined) };
    if (request.op === "open") this.#couldOwnScope = true;
    this.#write(request);
    const interrupt = () => this.#interrupt(request);
    signal.addEventListener("abort", interrupt, { once: true });
    if (signal.aborted) interrupt();
    try {
      const response = await result;
      if (signal.aborted) throw workerError("CURSOR_CHECKPOINT_CANCELLED");
      return response;
    } finally {
      signal.removeEventListener("abort", interrupt);
    }
  }

  close(): Promise<void> {
    this.#shutdown ??= this.#close();
    return this.#shutdown;
  }

  async #close(): Promise<void> {
    if (this.#active) {
      const active = this.#active;
      this.#interrupt(active.request);
      await active.settled;
    }
    const timer = setTimeout(() => this.#fail("CURSOR_CHECKPOINT_PROCESS_ERROR"), SHUTDOWN_MS);
    timer.unref();
    try {
      // EOF is a native close operation for both measurement and open scopes.
      this.#child.stdin.end();
      const exitCode = await this.#exited;
      if (this.#couldOwnScope && exitCode !== 0) {
        throw workerError(
          "CURSOR_CHECKPOINT_CLEANUP_UNCONFIRMED",
          "The Windows Cursor worker exited without confirming private session cleanup."
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }

  #interrupt(request: WorkerRequest): void {
    if (this.#unusable || this.#active?.request !== request) return;
    if (request.op !== "run" || !request.id) {
      this.#fail("CURSOR_CHECKPOINT_CANCELLED");
      return;
    }
    if (this.#cancelTimer) return;
    this.#write({ op: "cancel", id: request.id });
    this.#cancelTimer = setTimeout(() => this.#fail("CURSOR_CHECKPOINT_CANCELLED"), SHUTDOWN_MS);
    this.#cancelTimer.unref();
  }

  #write(request: JsonObject): void {
    this.#child.stdin.write(JSON.stringify(request) + "\n");
  }

  #read(chunk: Buffer): void {
    if (this.#unusable) return;
    for (let start = 0; start < chunk.length && !this.#unusable;) {
      const end = chunk.indexOf(10, start);
      const part = chunk.subarray(start, end < 0 ? chunk.length : end);
      if (this.#bytes + part.length > MAX_FRAME) {
        this.#fail("CURSOR_CHECKPOINT_OUTPUT_TOO_LARGE");
        return;
      }
      this.#parts.push(part);
      this.#bytes += part.length;
      if (end < 0) return;
      const complete = Buffer.concat(this.#parts, this.#bytes);
      this.#parts = [];
      this.#bytes = 0;
      this.#decode(complete);
      start = end + 1;
    }
  }

  #decode(bytes: Buffer): void {
    let response: unknown;
    try {
      response = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      this.#fail("SECURITY_BOUNDARY_BREACH");
      return;
    }
    const active = this.#active;
    if (!active || typeof response !== "object" || response === null || Array.isArray(response)) {
      this.#fail("SECURITY_BOUNDARY_BREACH");
      return;
    }
    const frame = response as JsonObject;
    if (frame.op !== active.request.op || frame.id !== active.request.id || typeof frame.ok !== "boolean") {
      this.#fail("SECURITY_BOUNDARY_BREACH");
      return;
    }
    const failureKeys = ["op", "ok", "code", ...(active.request.id === undefined ? [] : ["id"])];
    if (frame.ok === false && (!wireObject(frame, failureKeys) || typeof frame.code !== "string")) {
      this.#fail("SECURITY_BOUNDARY_BREACH");
      return;
    }
    this.#active = undefined;
    clearTimeout(this.#cancelTimer);
    this.#cancelTimer = undefined;
    if (frame.ok) active.accept(frame);
    else active.refuse(workerError(SAFE_WORKER_ERRORS.has(frame.code as string)
      ? frame.code as string : "CURSOR_CHECKPOINT_PROCESS_ERROR"));
  }

  #rejectPending(error: Error): void {
    clearTimeout(this.#cancelTimer);
    this.#cancelTimer = undefined;
    this.#active?.refuse(error);
    this.#active = undefined;
  }

  #fail(code: string): void {
    if (this.#unusable) return;
    this.#unusable = true;
    this.#parts = [];
    this.#child.stdin.destroy();
    this.#child.kill();
    this.#rejectPending(workerError(code));
  }
}
