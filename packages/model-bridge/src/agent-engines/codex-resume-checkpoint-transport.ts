import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  codexItemDiagnosticText,
  omittedCheckpointStreamEvidence,
  recordCheckpointEventType,
  resolveCodexItemType,
  safeProtocolLabel,
  summarizeCodexItemDiagnostics
} from "./checkpoint-protocol-reporting";
import { selectCheckpointTurnFromAgentMessages } from "./checkpoint-turn";
import {
  DEFAULT_MAX_LINES,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_MAX_PROMPT_BYTES,
  DEFAULT_TIMEOUT_MS,
  NodeCheckpointProcessRunner,
  assertPrivateCheckpointEnvironment,
  assertSessionId,
  byteLength,
  checkpointTransportError,
  containsCredentialLeak,
  hashText,
  attachSessionIdToError,
  invokeCountedCheckpointRunner,
  positiveInteger,
  sanitizeProcessMessage,
  wrapSpawnCountingRunner,
  type CheckpointCredentialEnvironmentEntry,
  type CheckpointProcessRequest,
  type CheckpointProcessResult,
  type CheckpointProcessRunner,
  type CheckpointPrivateEnvironment,
  type SpawnCountableRunner
} from "./checkpoint-transport-common";
import {
  CODEX_CHECKPOINT_PROTOCOL_VERSION,
  VDT_CHECKPOINT_TURN_PROTOCOL_VERSION
} from "./persistent-cli-checkpoint-canaries";
import type { CheckpointTurn } from "./checkpoint-turn";
import type { ResumeCheckpointSegmentInput, ResumeCheckpointSegmentResult } from "./resume-checkpoint-engine-core";
import {
  extractSearchQuery,
  isForbiddenCodexNativeItemType,
  NativeWebSearchCollector,
  attachNativeWebSearchToError,
  withForcedCodexSearchFlag,
  type NativeWebSearchRecord
} from "./native-web-search";

const ERROR_PREFIX = "CODEX_CHECKPOINT";
const CLI_LABEL = "Codex";

const FORBIDDEN_ARGUMENTS = new Set([
  "--ephemeral",
  "--yolo",
  "--dangerously-bypass-approvals-and-sandbox"
]);

const SAFE_CODEX_CREDENTIAL_ENVIRONMENT = new Set([
  "CODEX_API_KEY",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "LANG",
  "LC_ALL",
  "LOGNAME",
  "NODE_EXTRA_CA_CERTS",
  "NO_PROXY",
  "OPENAI_API_KEY",
  "PATH",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "USER"
]);

export interface CodexResumeCheckpointEnvironment extends CheckpointPrivateEnvironment {}

export interface CodexResumeCheckpointTransportOptions {
  readonly executable: string;
  readonly validatedCliVersion: string;
  readonly runner?: CheckpointProcessRunner;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly maxPromptBytes?: number;
  readonly maxLines?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function codexItemType(item: Record<string, unknown>): string | undefined {
  const resolved = resolveCodexItemType(item);
  if (!resolved.agreed) {
    throw checkpointTransportError(
      "SECURITY_BOUNDARY_BREACH",
      "Codex item type fields disagreed."
    );
  }
  return resolved.type;
}

function parseCodexStreamOutput(input: {
  stdout: string;
  expectedSessionId?: string;
  maxBytes: number;
  maxLines: number;
  allowedToolNames: readonly string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}): { sessionId: string; turn: CheckpointTurn; segmentDiagnosticSummary?: string; nativeWebSearch?: NativeWebSearchRecord } {
  if (byteLength(input.stdout) > input.maxBytes) {
    throw checkpointTransportError(`${ERROR_PREFIX}_OUTPUT_TOO_LARGE`, "Codex output is too large.");
  }
  let sessionId = input.expectedSessionId;
  let started = false;
  let completed = false;
  const agentMessages: string[] = [];
  const itemDiagnostics: string[] = [];
  const webSearches = new NativeWebSearchCollector();
  let lineCount = 0;
  const eventTypeSequence: string[] = [];
  try {
  for (const line of input.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    lineCount += 1;
    if (lineCount > input.maxLines) {
      throw checkpointTransportError(`${ERROR_PREFIX}_OUTPUT_TOO_LARGE`, "Codex output has too many lines.");
    }
    let event: unknown;
    try {
      event = JSON.parse(line) as unknown;
    } catch {
      throw checkpointTransportError(`${ERROR_PREFIX}_PROTOCOL_INVALID`, "Codex output contains malformed JSONL.");
    }
    if (!isRecord(event) || typeof event.type !== "string") {
      throw checkpointTransportError(`${ERROR_PREFIX}_PROTOCOL_INVALID`, "Codex output event is invalid.");
    }
    recordCheckpointEventType(eventTypeSequence, event);
    if (event.type === "thread.started") {
      if (started) throw checkpointTransportError(`${ERROR_PREFIX}_PROTOCOL_INVALID`, "Codex emitted duplicate thread.started.");
      assertSessionId(event.thread_id, "thread.started.thread_id", ERROR_PREFIX);
      if (sessionId !== undefined && event.thread_id !== sessionId) {
        throw checkpointTransportError(`${ERROR_PREFIX}_SESSION_MISMATCH`, "Codex resumed a different thread.");
      }
      sessionId = event.thread_id;
      started = true;
      continue;
    }
    if (event.type === "error" || event.type === "turn.failed") {
      throw checkpointTransportError(`${ERROR_PREFIX}_PROCESS_FAILED`, "Codex reported a failed checkpoint turn.");
    }
    if (event.type === "turn.started") continue;
    if (event.type === "turn.completed") {
      completed = true;
      continue;
    }
    if (event.type === "item.started" || event.type === "item.updated" || event.type === "item.completed") {
      if (!isRecord(event.item)) throw checkpointTransportError(`${ERROR_PREFIX}_PROTOCOL_INVALID`, "Codex item event is invalid.");
      const type = codexItemType(event.item);
      if (isForbiddenCodexNativeItemType(type) || type === "mcp_tool_call") {
        throw checkpointTransportError("SECURITY_BOUNDARY_BREACH", `Codex attempted forbidden ${type ?? "foreign tool"}.`);
      }
      if (type === "web_search") {
        webSearches.observe({
          id: typeof event.item.id === "string" ? event.item.id : undefined,
          query: extractSearchQuery(event.item),
          eventType: event.type
        });
        continue;
      }
      if (type === "agent_message" || type === "assistant_message") {
        if (event.type === "item.completed" && typeof event.item.text === "string") {
          agentMessages.push(event.item.text);
        }
        continue;
      }
      if (type === "reasoning" || type === "todo_list") continue;
      if (type === "error") {
        const diagnostic = codexItemDiagnosticText(event.item);
        if (diagnostic && itemDiagnostics.length < 3) itemDiagnostics.push(diagnostic);
        continue;
      }
      throw checkpointTransportError(
        `${ERROR_PREFIX}_PROTOCOL_MISMATCH`,
        `Codex emitted an unknown item type: ${safeProtocolLabel(type)}.`
      );
    }
    throw checkpointTransportError(
      `${ERROR_PREFIX}_PROTOCOL_MISMATCH`,
      `Codex emitted an unknown stream event: ${safeProtocolLabel(event.type)}.`
    );
  }
  if (!started || !completed || !sessionId || agentMessages.length === 0) {
    const omitted = omittedCheckpointStreamEvidence({
      cliLabel: CLI_LABEL,
      observation: {
        parsedLineCount: lineCount,
        eventTypeSequence,
        stdoutEmpty: !input.stdout.trim(),
        exitCode: input.exitCode,
        signal: input.signal
      },
      required: {
        init: started,
        terminal: completed,
        session: Boolean(sessionId),
        agentMessage: agentMessages.length > 0
      }
    });
    throw checkpointTransportError(`${ERROR_PREFIX}_PROTOCOL_INVALID`, omitted.message, omitted.details);
  }
  const segmentDiagnosticSummary = summarizeCodexItemDiagnostics(itemDiagnostics);
  const nativeWebSearch = webSearches.snapshot();
  return {
    sessionId,
    turn: selectCheckpointTurnFromAgentMessages(agentMessages, {
      protocolVersion: VDT_CHECKPOINT_TURN_PROTOCOL_VERSION,
      allowedToolNames: input.allowedToolNames,
      errorPrefix: ERROR_PREFIX
    }),
    ...(segmentDiagnosticSummary ? { segmentDiagnosticSummary } : {}),
    ...(nativeWebSearch ? { nativeWebSearch } : {})
  };
  } catch (error) {
    attachSessionIdToError(error, sessionId);
    attachNativeWebSearchToError(error, webSearches.snapshot());
  }
}

function buildCodexEnvironment(
  state: string,
  authHome: string | undefined,
  entries: readonly CheckpointCredentialEnvironmentEntry[]
): Readonly<Record<string, string>> {
  const output: Record<string, string> = Object.create(null) as Record<string, string>;
  output.HOME = authHome ?? state;
  output.USERPROFILE = authHome ?? state;
  output.CODEX_HOME = authHome ? path.join(authHome, ".codex") : state;
  const names = new Set<string>();
  for (const entry of entries) {
    if (
      !SAFE_CODEX_CREDENTIAL_ENVIRONMENT.has(entry.name)
      || names.has(entry.name)
      || entry.value.includes("\0")
      || byteLength(entry.value) > 16 * 1024
    ) {
      throw checkpointTransportError(
        `${ERROR_PREFIX}_UNSAFE_ENVIRONMENT`,
        `Credential environment entry ${entry.name || "<empty>"} is not allowlisted.`
      );
    }
    names.add(entry.name);
    output[entry.name] = entry.value;
  }
  return Object.freeze(output);
}

export class CodexResumeCheckpointTransport {
  readonly validatedCliVersion: string;
  readonly #executable: string;
  readonly #runner: SpawnCountableRunner<CheckpointProcessRequest, CheckpointProcessResult>;
  readonly #timeoutMs: number;
  readonly #maxOutputBytes: number;
  readonly #maxPromptBytes: number;
  readonly #maxLines: number;

  constructor(options: CodexResumeCheckpointTransportOptions) {
    if (!path.isAbsolute(options.executable) || options.executable === path.parse(options.executable).root || options.executable.includes("\0")) {
      throw checkpointTransportError(`${ERROR_PREFIX}_CONFIGURATION_INVALID`, "Codex executable must be a non-root absolute path.");
    }
    if (!options.validatedCliVersion.trim() || options.validatedCliVersion.length > 120) {
      throw checkpointTransportError(`${ERROR_PREFIX}_VERSION_UNKNOWN`, "An exact trusted Codex CLI version probe is required.");
    }
    this.#executable = options.executable;
    this.validatedCliVersion = options.validatedCliVersion;
    this.#runner = wrapSpawnCountingRunner(options.runner ?? new NodeCheckpointProcessRunner(ERROR_PREFIX, CLI_LABEL));
    this.#timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs", ERROR_PREFIX);
    this.#maxOutputBytes = positiveInteger(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES, "maxOutputBytes", ERROR_PREFIX);
    this.#maxPromptBytes = positiveInteger(options.maxPromptBytes, DEFAULT_MAX_PROMPT_BYTES, "maxPromptBytes", ERROR_PREFIX);
    this.#maxLines = positiveInteger(options.maxLines, DEFAULT_MAX_LINES, "maxLines", ERROR_PREFIX);
  }

  get processSpawnCount(): number {
    return this.#runner.processSpawnCount;
  }

  async executeSegment(
    input: ResumeCheckpointSegmentInput,
    allowedToolNames: readonly string[]
  ): Promise<ResumeCheckpointSegmentResult> {
    input.signal.throwIfAborted();
    if (!input.model.trim() || input.model.startsWith("-") || input.model.includes("\0") || input.model.length > 160) {
      throw checkpointTransportError(`${ERROR_PREFIX}_CONFIGURATION_INVALID`, "Codex model is invalid.");
    }
    if (byteLength(input.prompt) > this.#maxPromptBytes || input.prompt.includes("\0")) {
      throw checkpointTransportError(`${ERROR_PREFIX}_PROMPT_TOO_LARGE`, "Codex checkpoint prompt is invalid or too large.");
    }
    if (input.mode === "open" && input.expectedSessionId !== undefined) {
      throw checkpointTransportError(`${ERROR_PREFIX}_SESSION_INVALID`, "Open segment cannot carry a prior session ID.");
    }
    if (input.mode === "resume") assertSessionId(input.expectedSessionId, "expectedSessionId", ERROR_PREFIX);

    const resolved = await assertPrivateCheckpointEnvironment(input.environment, input.mode === "open", ERROR_PREFIX, CLI_LABEL);
    const credentials = input.environment.credentialEnvironment ?? [];
    const environment = buildCodexEnvironment(resolved.state, resolved.authHome, credentials);
    const args = withForcedCodexSearchFlag(input.mode === "open"
      ? [
        "exec",
        "--json",
        "--color",
        "never",
        "--skip-git-repo-check",
        "--ignore-user-config",
        "--sandbox",
        "read-only",
        "--model",
        input.model,
        "-C",
        resolved.workspace,
        "-"
      ]
      : [
        "exec",
        "resume",
        "--json",
        "--skip-git-repo-check",
        "--ignore-user-config",
        "-c",
        'sandbox_mode="read-only"',
        "--model",
        input.model,
        input.expectedSessionId!,
        "-"
      ], input.forceNativeWebSearch === true);
    if (args.some((arg) => FORBIDDEN_ARGUMENTS.has(arg))) {
      throw checkpointTransportError("SECURITY_BOUNDARY_BREACH", "Codex checkpoint arguments enabled a forbidden trust mode.");
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
    if (containsCredentialLeak(`${result.stdout}\n${result.stderr}`, credentials)) {
      throw checkpointTransportError("SECURITY_BOUNDARY_BREACH", "Codex checkpoint output exposed a server-owned credential.");
    }
    if (byteLength(result.stdout) > this.#maxOutputBytes || byteLength(result.stderr) > this.#maxOutputBytes) {
      throw checkpointTransportError(`${ERROR_PREFIX}_OUTPUT_TOO_LARGE`, "Codex checkpoint process output exceeded its limit.");
    }
    if (result.exitCode !== 0 || result.signal !== null) {
      throw checkpointTransportError(
        `${ERROR_PREFIX}_PROCESS_FAILED`,
        sanitizeProcessMessage(result.stderr, "Codex checkpoint process failed before a valid terminal result."),
        { exitCode: result.exitCode, signal: result.signal }
      );
    }
    if ((await readdir(resolved.workspace)).length > 0) {
      throw checkpointTransportError(
        "SECURITY_BOUNDARY_BREACH",
        "Codex wrote to the private checkpoint workspace; the run was stopped."
      );
    }
    const parsed = parseCodexStreamOutput({
      stdout: result.stdout,
      ...(input.expectedSessionId !== undefined ? { expectedSessionId: input.expectedSessionId } : {}),
      maxBytes: this.#maxOutputBytes,
      maxLines: this.#maxLines,
      allowedToolNames,
      exitCode: result.exitCode,
      signal: result.signal
    });
    return Object.freeze({
      sessionId: parsed.sessionId,
      inputHash: hashText(input.prompt),
      outputHash: hashText(JSON.stringify(parsed.turn)),
      turn: parsed.turn,
      processSpawnCount: spawned.processSpawnCount,
      inferenceMs: spawned.inferenceMs,
      outputBytes: spawned.outputBytes,
      ...(parsed.segmentDiagnosticSummary ? { segmentDiagnosticSummary: parsed.segmentDiagnosticSummary } : {}),
      ...(parsed.nativeWebSearch ? { nativeWebSearch: parsed.nativeWebSearch } : {})
    });
  }
}

export { CODEX_CHECKPOINT_PROTOCOL_VERSION };
