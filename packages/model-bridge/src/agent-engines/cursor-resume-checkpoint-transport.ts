import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { type CheckpointActionBatch } from "./action-batch";
import { omittedCheckpointStreamEvidence, recordCheckpointEventType } from "./checkpoint-protocol-reporting";
import {
  invokeCountedCheckpointRunner,
  sameCanonicalWorkspacePath,
  wrapSpawnCountingRunner,
  attachSessionIdToError,
  type SpawnCountableRunner
} from "./checkpoint-transport-common";
import { parseCheckpointTurn, type CheckpointTurn } from "./checkpoint-turn";
import {
  extractSearchQuery,
  inspectCursorStreamToolCall,
  NativeWebSearchCollector,
  attachNativeWebSearchToError,
  type NativeWebSearchRecord
} from "./native-web-search";

export const CURSOR_CHECKPOINT_PROTOCOL_VERSION = "vdt-cursor-checkpoint-v1" as const;

const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_PROMPT_BYTES = 1024 * 1024;
const DEFAULT_MAX_LINES = 100_000;
const DEFAULT_TIMEOUT_MS = 180_000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const SAFE_HASH = /^sha256:[a-f0-9]{64}$/;
const SAFE_CREDENTIAL_ENVIRONMENT = new Set([
  "CURSOR_API_KEY",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "LANG",
  "LC_ALL",
  "LOGNAME",
  "NODE_EXTRA_CA_CERTS",
  "NO_PROXY",
  "PATH",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "USER"
]);
const FORBIDDEN_ARGUMENTS = new Set([
  "--force",
  "--yolo",
  "--dangerously-skip-permissions"
]);
const ALLOWED_CURSOR_EVENT_TYPES = new Set([
  "assistant",
  "error",
  "result",
  "system",
  "thinking",
  "user"
]);

export interface CursorCheckpointCredentialEnvironmentEntry {
  readonly name: string;
  readonly value: string;
}

export interface CursorResumeProcessRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly stdin: string;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export interface CursorResumeProcessResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Injectable process boundary. Tests use fakes; production may use the
 * shell-free Node implementation below. */
export interface CursorResumeProcessRunner {
  run(request: CursorResumeProcessRequest): Promise<CursorResumeProcessResult>;
}

export interface CursorResumeCheckpointEnvironment {
  /** Stable server-owned identifier. The filesystem paths never enter a model prompt or public binding. */
  readonly environmentId: string;
  /** Empty private workspace used for every process segment in the logical session. */
  readonly privateWorkspacePath: string;
  /** Empty-on-open private HOME/config root that persists Cursor's opaque session state across resumes. */
  readonly privateStatePath: string;
  /** Development-only subscription authentication root. When present, Cursor
   * receives this server-owned HOME instead of the empty private state root.
   * The process still runs in the empty private workspace. */
  readonly trustedSubscriptionAuthHomePath?: string;
  /** Server acknowledgement for the already-verified empty private workspace.
   * This only suppresses Cursor's workspace prompt; it does not approve tools. */
  readonly preauthorizeEmptyWorkspace?: boolean;
  /** Repository, project and database roots that the private paths must not overlap. */
  readonly forbiddenRoots: readonly string[];
  /** Server-owned credentials and network trust only. Arbitrary environment inheritance is forbidden. */
  readonly credentialEnvironment?: readonly CursorCheckpointCredentialEnvironmentEntry[];
  close?(): void | Promise<void>;
}

export interface CursorCheckpointAssistantMessage {
  readonly messageId: string;
  readonly text: string;
}

export type CursorCheckpointTurn =
  | {
      readonly protocolVersion: typeof CURSOR_CHECKPOINT_PROTOCOL_VERSION;
      readonly assistantMessage: CursorCheckpointAssistantMessage | null;
      readonly action: {
        readonly type: "action_batch";
        readonly batch: CheckpointActionBatch;
      };
    }
  | {
      readonly protocolVersion: typeof CURSOR_CHECKPOINT_PROTOCOL_VERSION;
      readonly assistantMessage: null;
      readonly action: {
        readonly type: "final";
        readonly messageId: string;
        readonly finishReceiptId: string;
        readonly text: string;
      };
    };

export interface CursorResumeCheckpointSegmentInput {
  readonly mode: "open" | "resume";
  readonly environment: CursorResumeCheckpointEnvironment;
  readonly model: string;
  readonly prompt: string;
  readonly expectedSessionId?: string;
  readonly signal: AbortSignal;
}

export interface CursorResumeCheckpointSegmentResult {
  readonly sessionId: string;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly turn: CursorCheckpointTurn;
  readonly nativeWebSearch?: NativeWebSearchRecord;
  readonly processSpawnCount?: number;
  readonly inferenceMs?: number;
  readonly outputBytes?: number;
}

export interface CursorResumeCheckpointTransportOptions {
  /** Absolute server-resolved path. PATH lookup is deliberately unsupported. */
  readonly executable: string;
  /** Exact result of a trusted one-time capability probe; unknown versions are rejected. */
  readonly validatedCliVersion: string;
  readonly runner?: CursorResumeProcessRunner;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly maxPromptBytes?: number;
  readonly maxLines?: number;
}

function checkpointError(code: string, message: string, details: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { code, ...details });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function hashText(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function positiveInteger(value: number | undefined, fallback: number, field: string): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected <= 0) {
    throw checkpointError("CURSOR_CHECKPOINT_CONFIGURATION_INVALID", `${field} must be a positive integer.`);
  }
  return selected;
}

function assertSessionId(value: unknown, field: string): asserts value is string {
  if (
    typeof value !== "string"
    || !value.trim()
    || value.length > 512
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw checkpointError("CURSOR_CHECKPOINT_SESSION_INVALID", `${field} is invalid.`);
  }
}

function sanitizeProcessMessage(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed || /api.?key|authorization|cookie|password|secret|token/i.test(trimmed)) return fallback;
  return trimmed.slice(0, 500);
}

function parseTurn(raw: string, allowedToolNames: readonly string[]): CursorCheckpointTurn {
  const turn = parseCheckpointTurn(raw, {
    protocolVersion: CURSOR_CHECKPOINT_PROTOCOL_VERSION,
    allowedToolNames,
    errorPrefix: "CURSOR_CHECKPOINT"
  });
  return turn as CursorCheckpointTurn;
}

function canonicalPathContains(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function canonicalDirectory(value: string, field: string): Promise<string> {
  if (!path.isAbsolute(value) || value === path.parse(value).root || value.includes("\0")) {
    throw checkpointError("CURSOR_CHECKPOINT_UNSAFE_ENVIRONMENT", `${field} must be a non-root absolute path.`);
  }
  const stat = await lstat(value).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw checkpointError("CURSOR_CHECKPOINT_UNSAFE_ENVIRONMENT", `${field} must be an existing non-symlink directory.`);
  }
  return realpath(value);
}

async function assertPrivateEnvironment(
  environment: CursorResumeCheckpointEnvironment,
  open: boolean
): Promise<{ workspace: string; state: string; authHome?: string }> {
  if (!SAFE_ID.test(environment.environmentId)) {
    throw checkpointError("CURSOR_CHECKPOINT_UNSAFE_ENVIRONMENT", "environmentId is invalid.");
  }
  if (environment.forbiddenRoots.length === 0) {
    throw checkpointError("CURSOR_CHECKPOINT_UNSAFE_ENVIRONMENT", "At least one forbidden repository/project root is required.");
  }
  const workspace = await canonicalDirectory(environment.privateWorkspacePath, "privateWorkspacePath");
  const state = await canonicalDirectory(environment.privateStatePath, "privateStatePath");
  const authHome = environment.trustedSubscriptionAuthHomePath
    ? await canonicalDirectory(environment.trustedSubscriptionAuthHomePath, "trustedSubscriptionAuthHomePath")
    : undefined;
  if (environment.preauthorizeEmptyWorkspace && !authHome) {
    throw checkpointError(
      "CURSOR_CHECKPOINT_UNSAFE_ENVIRONMENT",
      "Preauthorizing a private workspace requires an explicit trusted subscription auth home."
    );
  }
  if (canonicalPathContains(workspace, state) || canonicalPathContains(state, workspace)) {
    throw checkpointError("CURSOR_CHECKPOINT_UNSAFE_ENVIRONMENT", "Private workspace and state directories must not overlap.");
  }
  const workspaceEntries = await readdir(workspace);
  if (workspaceEntries.length > 0) {
    throw checkpointError(
      "SECURITY_BOUNDARY_BREACH",
      "Cursor checkpoint workspace is not empty; the run was stopped before execution."
    );
  }
  if (open && (await readdir(state)).length > 0) {
    throw checkpointError(
      "CURSOR_CHECKPOINT_UNSAFE_ENVIRONMENT",
      "Cursor checkpoint state directory must be empty when the logical session opens."
    );
  }
  for (const root of environment.forbiddenRoots) {
    const canonicalRoot = await canonicalDirectory(root, "forbiddenRoots[]");
    if (
      canonicalPathContains(canonicalRoot, workspace)
      || canonicalPathContains(workspace, canonicalRoot)
      || canonicalPathContains(canonicalRoot, state)
      || canonicalPathContains(state, canonicalRoot)
    ) {
      throw checkpointError(
        "CURSOR_CHECKPOINT_UNSAFE_ENVIRONMENT",
        "Cursor checkpoint private paths overlap a forbidden repository, project or database root."
      );
    }
  }
  return { workspace, state, ...(authHome ? { authHome } : {}) };
}

function buildEnvironment(
  state: string,
  authHome: string | undefined,
  entries: readonly CursorCheckpointCredentialEnvironmentEntry[]
): Readonly<Record<string, string>> {
  const output: Record<string, string> = Object.create(null) as Record<string, string>;
  output.HOME = authHome ?? state;
  output.USERPROFILE = authHome ?? state;
  if (!authHome) {
    output.CURSOR_CONFIG_DIR = path.join(state, "cursor-config");
    output.XDG_CONFIG_HOME = path.join(state, "xdg-config");
  }
  const names = new Set<string>();
  for (const entry of entries) {
    if (
      !SAFE_CREDENTIAL_ENVIRONMENT.has(entry.name)
      || names.has(entry.name)
      || entry.value.includes("\0")
      || byteLength(entry.value) > 16 * 1024
    ) {
      throw checkpointError(
        "CURSOR_CHECKPOINT_UNSAFE_ENVIRONMENT",
        `Credential environment entry ${entry.name || "<empty>"} is not allowlisted.`
      );
    }
    names.add(entry.name);
    output[entry.name] = entry.value;
  }
  return Object.freeze(output);
}

function containsCredentialLeak(
  value: string,
  entries: readonly CursorCheckpointCredentialEnvironmentEntry[]
): boolean {
  return entries.some((entry) => entry.value.length >= 8 && value.includes(entry.value));
}

function parseCursorOutput(input: {
  result: CursorResumeProcessResult;
  workspace: string;
  expectedSessionId?: string;
  maxBytes: number;
  maxLines: number;
  allowedToolNames: readonly string[];
  credentials: readonly CursorCheckpointCredentialEnvironmentEntry[];
}): { sessionId: string; turn: CursorCheckpointTurn; nativeWebSearch?: NativeWebSearchRecord } {
  const { result } = input;
  if (containsCredentialLeak(`${result.stdout}\n${result.stderr}`, input.credentials)) {
    throw checkpointError("SECURITY_BOUNDARY_BREACH", "Cursor checkpoint output exposed a server-owned credential.");
  }
  if (byteLength(result.stdout) > input.maxBytes || byteLength(result.stderr) > input.maxBytes) {
    throw checkpointError("CURSOR_CHECKPOINT_OUTPUT_TOO_LARGE", "Cursor checkpoint process output exceeded its limit.");
  }
  if (result.exitCode !== 0 || result.signal !== null) {
    throw checkpointError(
      "CURSOR_CHECKPOINT_PROCESS_FAILED",
      sanitizeProcessMessage(result.stderr, "Cursor checkpoint process failed before a valid terminal result."),
      { exitCode: result.exitCode, signal: result.signal }
    );
  }

  let lineCount = 0;
  let terminal: Record<string, unknown> | undefined;
  let sessionId = input.expectedSessionId;
  let sawInit = false;
  let terminalSeen = false;
  const eventTypeSequence: string[] = [];
  const webSearches = new NativeWebSearchCollector();
  try {
  for (const rawLine of result.stdout.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    lineCount += 1;
    if (lineCount > input.maxLines || byteLength(rawLine) > input.maxBytes) {
      throw checkpointError("CURSOR_CHECKPOINT_OUTPUT_TOO_LARGE", "Cursor checkpoint stream exceeded its line limits.");
    }
    if (terminalSeen) {
      throw checkpointError("CURSOR_CHECKPOINT_PROTOCOL_INVALID", "Cursor emitted data after its terminal result event.");
    }
    let event: unknown;
    try {
      event = JSON.parse(rawLine) as unknown;
    } catch {
      throw checkpointError("CURSOR_CHECKPOINT_PROTOCOL_INVALID", "Cursor stream contained malformed NDJSON.");
    }
    if (isRecord(event) && event.type === "tool_call") {
      const inspection = inspectCursorStreamToolCall(event);
      if (inspection.kind === "native_web_search") {
        webSearches.observe({
          id: inspection.id,
          query: inspection.query ?? extractSearchQuery(event),
          eventType: typeof event.subtype === "string" ? event.subtype : event.type
        });
        continue;
      }
      throw checkpointError(
        "SECURITY_BOUNDARY_BREACH",
        "Cursor attempted a built-in or foreign tool during checkpoint execution."
      );
    }
    if (!isRecord(event) || typeof event.type !== "string" || !ALLOWED_CURSOR_EVENT_TYPES.has(event.type)) {
      throw checkpointError("CURSOR_CHECKPOINT_PROTOCOL_MISMATCH", "Cursor stream contained an unknown event type.");
    }
    recordCheckpointEventType(eventTypeSequence, event);
    if (event.type === "error") {
      throw checkpointError(
        "CURSOR_CHECKPOINT_PROCESS_FAILED",
        sanitizeProcessMessage(typeof event.message === "string" ? event.message : "", "Cursor reported a checkpoint error.")
      );
    }
    if (event.type === "system") {
      if (event.subtype !== "init" || sawInit) {
        throw checkpointError("CURSOR_CHECKPOINT_PROTOCOL_INVALID", "Cursor stream has an invalid system initialization event.");
      }
      sawInit = true;
      if (!sameCanonicalWorkspacePath(event.cwd, input.workspace)) {
        throw checkpointError("SECURITY_BOUNDARY_BREACH", "Cursor reported execution outside the private checkpoint workspace.");
      }
      if (
        typeof event.permissionMode === "string"
        && !new Set(["ask", "default"]).has(event.permissionMode.toLowerCase())
      ) {
        throw checkpointError("SECURITY_BOUNDARY_BREACH", "Cursor reported an unsafe permission mode.");
      }
    }
    if (
      event.type === "thinking"
      && !new Set(["delta", "completed"]).has(typeof event.subtype === "string" ? event.subtype : "")
    ) {
      throw checkpointError("CURSOR_CHECKPOINT_PROTOCOL_MISMATCH", "Cursor stream contained an unknown thinking event subtype.");
    }
    if (
      event.type === "assistant"
      || event.type === "user"
      || event.type === "system"
      || event.type === "thinking"
      || event.type === "result"
    ) {
      assertSessionId(event.session_id, `${event.type}.session_id`);
      if (sessionId === undefined) sessionId = event.session_id;
      else if (event.session_id !== sessionId) {
        throw checkpointError("CURSOR_CHECKPOINT_SESSION_MISMATCH", "Cursor changed opaque session identity during a checkpoint segment.");
      }
    }
    if (event.type === "result") {
      // Cursor print-mode exposes one terminal `result` string, not multiple
      // completed agent_message items. Envelope selection for multi-message
      // Codex turns lives in selectCheckpointTurnFromAgentMessages.
      if (event.subtype !== "success" || event.is_error !== false || typeof event.result !== "string") {
        throw checkpointError("CURSOR_CHECKPOINT_PROCESS_FAILED", "Cursor terminal result was not successful structured output.");
      }
      terminal = event;
      terminalSeen = true;
    }
  }
  if (!sawInit || !terminal || !sessionId) {
    const omitted = omittedCheckpointStreamEvidence({
      cliLabel: "Cursor",
      observation: {
        parsedLineCount: lineCount,
        eventTypeSequence,
        stdoutEmpty: !result.stdout.trim(),
        exitCode: result.exitCode,
        signal: result.signal
      },
      required: {
        init: sawInit,
        terminal: Boolean(terminal),
        session: Boolean(sessionId)
      }
    });
    throw checkpointError("CURSOR_CHECKPOINT_PROTOCOL_INVALID", omitted.message, omitted.details);
  }
  const nativeWebSearch = webSearches.snapshot();
  return {
    sessionId,
    turn: parseTurn(terminal.result as string, input.allowedToolNames),
    ...(nativeWebSearch ? { nativeWebSearch } : {})
  };
  } catch (error) {
    attachSessionIdToError(error, sessionId);
    attachNativeWebSearchToError(error, webSearches.snapshot());
  }
}

export class NodeCursorResumeProcessRunner implements CursorResumeProcessRunner {
  run(request: CursorResumeProcessRequest): Promise<CursorResumeProcessResult> {
    if (request.signal.aborted) {
      return Promise.reject(checkpointError("CURSOR_CHECKPOINT_CANCELLED", "Cursor checkpoint process was cancelled."));
    }
    return new Promise<CursorResumeProcessResult>((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(request.executable, [...request.args], {
          cwd: request.cwd,
          env: { ...request.environment } as NodeJS.ProcessEnv,
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
          windowsHide: true
        });
      } catch (error) {
        reject(checkpointError(
          "CURSOR_CHECKPOINT_PROCESS_ERROR",
          error instanceof Error ? error.message : "Cursor checkpoint process could not start."
        ));
        return;
      }

      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let settled = false;
      const terminate = (code: string, message: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
        reject(checkpointError(code, message));
      };
      const append = (target: "stdout" | "stderr", chunk: Buffer | string) => {
        const incoming = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        if ((target === "stdout" ? stdout.byteLength : stderr.byteLength) + incoming.byteLength > request.maxOutputBytes) {
          terminate("CURSOR_CHECKPOINT_OUTPUT_TOO_LARGE", "Cursor checkpoint process output exceeded its limit.");
          return;
        }
        if (target === "stdout") stdout = Buffer.concat([stdout, incoming]);
        else stderr = Buffer.concat([stderr, incoming]);
      };
      const onAbort = () => terminate("CURSOR_CHECKPOINT_CANCELLED", "Cursor checkpoint process was cancelled.");
      const timer = setTimeout(
        () => terminate("CURSOR_CHECKPOINT_TIMEOUT", "Cursor checkpoint process timed out."),
        request.timeoutMs
      );
      const cleanup = () => {
        clearTimeout(timer);
        request.signal.removeEventListener("abort", onAbort);
      };
      request.signal.addEventListener("abort", onAbort, { once: true });
      child.stdout.on("data", (chunk: Buffer | string) => append("stdout", chunk));
      child.stderr.on("data", (chunk: Buffer | string) => append("stderr", chunk));
      child.once("error", (error) => terminate("CURSOR_CHECKPOINT_PROCESS_ERROR", `Cursor checkpoint process failed: ${error.message}`));
      child.once("exit", (exitCode, exitSignal) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({
          exitCode,
          signal: exitSignal,
          stdout: stdout.toString("utf8"),
          stderr: stderr.toString("utf8")
        });
      });
      child.stdin.on("error", (error) => terminate("CURSOR_CHECKPOINT_WRITE_FAILED", `Cursor checkpoint stdin failed: ${error.message}`));
      child.stdin.end(request.stdin, "utf8");
    });
  }
}

/**
 * Shell-free Cursor `--resume` checkpoint transport. Each process executes one
 * bounded cognitive segment. A segment may return one ActionBatch (1-6 calls),
 * after which the engine executes the batch through VdtToolGateway and resumes
 * the exact opaque session with the aggregated results.
 *
 * This transport is intentionally not evidence of hard isolation: Cursor print
 * mode still ships built-in tools. Any observed tool event is therefore a
 * security breach and the external capability remains unverified/default-off.
 */
export class CursorResumeCheckpointTransport {
  readonly validatedCliVersion: string;
  readonly #executable: string;
  readonly #runner: SpawnCountableRunner<CursorResumeProcessRequest, CursorResumeProcessResult>;
  readonly #timeoutMs: number;
  readonly #maxOutputBytes: number;
  readonly #maxPromptBytes: number;
  readonly #maxLines: number;

  constructor(options: CursorResumeCheckpointTransportOptions) {
    if (!path.isAbsolute(options.executable) || options.executable === path.parse(options.executable).root || options.executable.includes("\0")) {
      throw checkpointError("CURSOR_CHECKPOINT_CONFIGURATION_INVALID", "Cursor executable must be a non-root absolute path.");
    }
    if (!options.validatedCliVersion.trim() || options.validatedCliVersion.length > 120) {
      throw checkpointError("CURSOR_CHECKPOINT_VERSION_UNKNOWN", "An exact trusted Cursor CLI version probe is required.");
    }
    this.#executable = options.executable;
    this.validatedCliVersion = options.validatedCliVersion;
    this.#runner = wrapSpawnCountingRunner(options.runner ?? new NodeCursorResumeProcessRunner());
    this.#timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs");
    this.#maxOutputBytes = positiveInteger(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES, "maxOutputBytes");
    this.#maxPromptBytes = positiveInteger(options.maxPromptBytes, DEFAULT_MAX_PROMPT_BYTES, "maxPromptBytes");
    this.#maxLines = positiveInteger(options.maxLines, DEFAULT_MAX_LINES, "maxLines");
  }

  get processSpawnCount(): number {
    return this.#runner.processSpawnCount;
  }

  async executeSegment(
    input: CursorResumeCheckpointSegmentInput,
    allowedToolNames: readonly string[]
  ): Promise<CursorResumeCheckpointSegmentResult> {
    input.signal.throwIfAborted();
    if (!input.model.trim() || input.model.startsWith("-") || input.model.includes("\0") || input.model.length > 160) {
      throw checkpointError("CURSOR_CHECKPOINT_CONFIGURATION_INVALID", "Cursor model is invalid.");
    }
    if (byteLength(input.prompt) > this.#maxPromptBytes || input.prompt.includes("\0")) {
      throw checkpointError("CURSOR_CHECKPOINT_PROMPT_TOO_LARGE", "Cursor checkpoint prompt is invalid or too large.");
    }
    if (input.mode === "open" && input.expectedSessionId !== undefined) {
      throw checkpointError("CURSOR_CHECKPOINT_SESSION_INVALID", "Open segment cannot carry a prior session ID.");
    }
    if (input.mode === "resume") assertSessionId(input.expectedSessionId, "expectedSessionId");

    const resolved = await assertPrivateEnvironment(input.environment, input.mode === "open");
    const credentials = input.environment.credentialEnvironment ?? [];
    const environment = buildEnvironment(resolved.state, resolved.authHome, credentials);
    const args = [
      "--print",
      "--output-format",
      "stream-json",
      "--stream-partial-output",
      "--mode",
      "ask",
      "--workspace",
      resolved.workspace,
      ...(input.environment.preauthorizeEmptyWorkspace ? ["--trust"] : []),
      "--model",
      input.model,
      ...(input.mode === "resume" ? ["--resume", input.expectedSessionId!] : [])
    ];
    if (args.some((arg) => FORBIDDEN_ARGUMENTS.has(arg))) {
      throw checkpointError("SECURITY_BOUNDARY_BREACH", "Cursor checkpoint arguments enabled a forbidden trust mode.");
    }
    const spawned = await invokeCountedCheckpointRunner(this.#runner, {
      executable: this.#executable,
      args: Object.freeze(args),
      cwd: resolved.workspace,
      environment,
      stdin: input.prompt,
      signal: input.signal,
      timeoutMs: this.#timeoutMs,
      maxOutputBytes: this.#maxOutputBytes
    });
    const result = spawned.result;
    if ((await readdir(resolved.workspace)).length > 0) {
      throw checkpointError(
        "SECURITY_BOUNDARY_BREACH",
        "Cursor wrote to the private checkpoint workspace; the run was stopped."
      );
    }
    const parsed = parseCursorOutput({
      result,
      workspace: resolved.workspace,
      ...(input.expectedSessionId !== undefined ? { expectedSessionId: input.expectedSessionId } : {}),
      maxBytes: this.#maxOutputBytes,
      maxLines: this.#maxLines,
      allowedToolNames,
      credentials
    });
    return Object.freeze({
      sessionId: parsed.sessionId,
      inputHash: hashText(input.prompt),
      outputHash: hashText(JSON.stringify(parsed.turn)),
      turn: parsed.turn,
      processSpawnCount: spawned.processSpawnCount,
      inferenceMs: spawned.inferenceMs,
      outputBytes: spawned.outputBytes,
      ...(parsed.nativeWebSearch ? { nativeWebSearch: parsed.nativeWebSearch } : {})
    });
  }
}

export function cursorCheckpointEnvironmentFingerprint(environmentId: string): string {
  if (!SAFE_ID.test(environmentId)) {
    throw checkpointError("CURSOR_CHECKPOINT_UNSAFE_ENVIRONMENT", "environmentId is invalid.");
  }
  return hashText(environmentId);
}

export function isCursorCheckpointHash(value: string): boolean {
  return SAFE_HASH.test(value);
}
