import { readdir } from "node:fs/promises";
import path from "node:path";
import { parseCheckpointTurn } from "./checkpoint-turn";
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
  positiveInteger,
  sanitizeProcessMessage,
  type CheckpointCredentialEnvironmentEntry,
  type CheckpointProcessRunner,
  type CheckpointPrivateEnvironment
} from "./checkpoint-transport-common";
import {
  CLAUDE_CHECKPOINT_PROTOCOL_VERSION,
  VDT_CHECKPOINT_TURN_PROTOCOL_VERSION
} from "./persistent-cli-checkpoint-canaries";
import type { CheckpointTurn } from "./checkpoint-turn";
import type { ResumeCheckpointSegmentInput, ResumeCheckpointSegmentResult } from "./resume-checkpoint-engine-core";

const ERROR_PREFIX = "CLAUDE_CHECKPOINT";
const CLI_LABEL = "Claude";

const FORBIDDEN_ARGUMENTS = new Set([
  "--dangerously-skip-permissions",
  "--force",
  "--yolo",
  "--no-session-persistence",
  "--fallback-model",
  "--disallowedTools"
]);

/** @internal Exported for unit tests validating the pre-spawn argument guard. */
export function assertClaudeCheckpointArgumentsAllowed(args: readonly string[]): void {
  if (args.some((arg) => FORBIDDEN_ARGUMENTS.has(arg))) {
    throw checkpointTransportError("SECURITY_BOUNDARY_BREACH", "Claude checkpoint arguments enabled a forbidden trust or persistence mode.");
  }
}

const SAFE_CLAUDE_CREDENTIAL_ENVIRONMENT = new Set([
  "ANTHROPIC_API_KEY",
  "CLAUDE_API_KEY",
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

export interface ClaudeResumeCheckpointEnvironment extends CheckpointPrivateEnvironment {}

export interface ClaudeResumeCheckpointTransportOptions {
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

function parseClaudeStreamOutput(input: {
  stdout: string;
  workspace: string;
  expectedSessionId?: string;
  maxBytes: number;
  maxLines: number;
  allowedToolNames: readonly string[];
}): { sessionId: string; turn: CheckpointTurn } {
  if (byteLength(input.stdout) > input.maxBytes) {
    throw checkpointTransportError(`${ERROR_PREFIX}_OUTPUT_TOO_LARGE`, "Claude output is too large.");
  }
  let sessionId = input.expectedSessionId;
  let initialized = false;
  let turn: CheckpointTurn | undefined;
  let lineCount = 0;
  for (const line of input.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    lineCount += 1;
    if (lineCount > input.maxLines) {
      throw checkpointTransportError(`${ERROR_PREFIX}_OUTPUT_TOO_LARGE`, "Claude output has too many lines.");
    }
    let event: unknown;
    try {
      event = JSON.parse(line) as unknown;
    } catch {
      throw checkpointTransportError(`${ERROR_PREFIX}_PROTOCOL_INVALID`, "Claude output contains malformed JSONL.");
    }
    if (!isRecord(event) || typeof event.type !== "string") {
      throw checkpointTransportError(`${ERROR_PREFIX}_PROTOCOL_INVALID`, "Claude output event is invalid.");
    }
    if (event.type === "system") {
      if (event.subtype !== "init" || initialized) {
        throw checkpointTransportError(`${ERROR_PREFIX}_PROTOCOL_INVALID`, "Claude initialization event is invalid.");
      }
      initialized = true;
      assertSessionId(event.session_id, "system.session_id", ERROR_PREFIX);
      if (sessionId !== undefined && event.session_id !== sessionId) {
        throw checkpointTransportError(`${ERROR_PREFIX}_SESSION_MISMATCH`, "Claude resumed a different session.");
      }
      sessionId = event.session_id;
      if (typeof event.cwd !== "string" || path.resolve(event.cwd) !== input.workspace) {
        throw checkpointTransportError("SECURITY_BOUNDARY_BREACH", "Claude reported execution outside the private checkpoint workspace.");
      }
      continue;
    }
    if (event.type === "assistant") {
      assertSessionId(event.session_id, "assistant.session_id", ERROR_PREFIX);
      if (sessionId !== event.session_id) throw checkpointTransportError(`${ERROR_PREFIX}_SESSION_MISMATCH`, "Claude changed session ID.");
      if (isRecord(event.message) && Array.isArray(event.message.content)) {
        for (const block of event.message.content) {
          if (isRecord(block) && block.type === "tool_use") {
            throw checkpointTransportError("SECURITY_BOUNDARY_BREACH", "Claude attempted a built-in or foreign tool during checkpoint execution.");
          }
        }
      }
      continue;
    }
    if (event.type === "user") {
      assertSessionId(event.session_id, "user.session_id", ERROR_PREFIX);
      if (sessionId !== event.session_id) throw checkpointTransportError(`${ERROR_PREFIX}_SESSION_MISMATCH`, "Claude changed session ID.");
      continue;
    }
    if (event.type === "result") {
      if (turn !== undefined) throw checkpointTransportError(`${ERROR_PREFIX}_PROTOCOL_INVALID`, "Claude emitted duplicate terminal results.");
      assertSessionId(event.session_id, "result.session_id", ERROR_PREFIX);
      if (sessionId !== event.session_id) throw checkpointTransportError(`${ERROR_PREFIX}_SESSION_MISMATCH`, "Claude changed session ID.");
      if (event.subtype !== "success" || event.is_error === true) {
        throw checkpointTransportError(`${ERROR_PREFIX}_PROCESS_FAILED`, "Claude reported a failed checkpoint result.");
      }
      const raw = event.structured_output ?? event.result;
      const text = typeof raw === "string" ? raw : JSON.stringify(raw);
      turn = parseCheckpointTurn(text, {
        protocolVersion: VDT_CHECKPOINT_TURN_PROTOCOL_VERSION,
        allowedToolNames: input.allowedToolNames,
        errorPrefix: ERROR_PREFIX
      });
      continue;
    }
    throw checkpointTransportError(`${ERROR_PREFIX}_PROTOCOL_MISMATCH`, "Claude emitted an unknown stream event.");
  }
  if (!initialized || !sessionId || !turn) {
    throw checkpointTransportError(`${ERROR_PREFIX}_PROTOCOL_INVALID`, "Claude output omitted initialization or terminal result evidence.");
  }
  return { sessionId, turn };
}

function buildClaudeEnvironment(
  state: string,
  authHome: string | undefined,
  entries: readonly CheckpointCredentialEnvironmentEntry[]
): Readonly<Record<string, string>> {
  const output: Record<string, string> = Object.create(null) as Record<string, string>;
  output.HOME = authHome ?? state;
  output.USERPROFILE = authHome ?? state;
  output.CLAUDE_CONFIG_DIR = authHome ?? state;
  const names = new Set<string>();
  for (const entry of entries) {
    if (
      !SAFE_CLAUDE_CREDENTIAL_ENVIRONMENT.has(entry.name)
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

export class ClaudeResumeCheckpointTransport {
  readonly validatedCliVersion: string;
  readonly #executable: string;
  readonly #runner: CheckpointProcessRunner;
  readonly #timeoutMs: number;
  readonly #maxOutputBytes: number;
  readonly #maxPromptBytes: number;
  readonly #maxLines: number;

  constructor(options: ClaudeResumeCheckpointTransportOptions) {
    if (!path.isAbsolute(options.executable) || options.executable === path.parse(options.executable).root || options.executable.includes("\0")) {
      throw checkpointTransportError(`${ERROR_PREFIX}_CONFIGURATION_INVALID`, "Claude executable must be a non-root absolute path.");
    }
    if (!options.validatedCliVersion.trim() || options.validatedCliVersion.length > 120) {
      throw checkpointTransportError(`${ERROR_PREFIX}_VERSION_UNKNOWN`, "An exact trusted Claude CLI version probe is required.");
    }
    this.#executable = options.executable;
    this.validatedCliVersion = options.validatedCliVersion;
    this.#runner = options.runner ?? new NodeCheckpointProcessRunner(ERROR_PREFIX, CLI_LABEL);
    this.#timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs", ERROR_PREFIX);
    this.#maxOutputBytes = positiveInteger(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES, "maxOutputBytes", ERROR_PREFIX);
    this.#maxPromptBytes = positiveInteger(options.maxPromptBytes, DEFAULT_MAX_PROMPT_BYTES, "maxPromptBytes", ERROR_PREFIX);
    this.#maxLines = positiveInteger(options.maxLines, DEFAULT_MAX_LINES, "maxLines", ERROR_PREFIX);
  }

  async executeSegment(
    input: ResumeCheckpointSegmentInput,
    allowedToolNames: readonly string[]
  ): Promise<ResumeCheckpointSegmentResult> {
    input.signal.throwIfAborted();
    if (!input.model.trim() || input.model.startsWith("-") || input.model.includes("\0") || input.model.length > 160) {
      throw checkpointTransportError(`${ERROR_PREFIX}_CONFIGURATION_INVALID`, "Claude model is invalid.");
    }
    if (byteLength(input.prompt) > this.#maxPromptBytes || input.prompt.includes("\0")) {
      throw checkpointTransportError(`${ERROR_PREFIX}_PROMPT_TOO_LARGE`, "Claude checkpoint prompt is invalid or too large.");
    }
    if (input.mode === "open" && input.expectedSessionId !== undefined) {
      throw checkpointTransportError(`${ERROR_PREFIX}_SESSION_INVALID`, "Open segment cannot carry a prior session ID.");
    }
    if (input.mode === "resume") assertSessionId(input.expectedSessionId, "expectedSessionId", ERROR_PREFIX);

    const resolved = await assertPrivateCheckpointEnvironment(input.environment, input.mode === "open", ERROR_PREFIX, CLI_LABEL);
    const credentials = input.environment.credentialEnvironment ?? [];
    const environment = buildClaudeEnvironment(resolved.state, resolved.authHome, credentials);
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--tools",
      "",
      "--permission-mode",
      "dontAsk",
      "--no-chrome",
      "--model",
      input.model,
      ...(input.mode === "resume" ? ["--resume", input.expectedSessionId!] : [])
    ];
    assertClaudeCheckpointArgumentsAllowed(args);
    const result = await this.#runner.run({
      executable: this.#executable,
      args: Object.freeze(args),
      cwd: resolved.workspace,
      environment,
      stdin: input.prompt,
      signal: input.signal,
      timeoutMs: this.#timeoutMs,
      maxOutputBytes: this.#maxOutputBytes
    });
    if (containsCredentialLeak(`${result.stdout}\n${result.stderr}`, credentials)) {
      throw checkpointTransportError("SECURITY_BOUNDARY_BREACH", "Claude checkpoint output exposed a server-owned credential.");
    }
    if (byteLength(result.stdout) > this.#maxOutputBytes || byteLength(result.stderr) > this.#maxOutputBytes) {
      throw checkpointTransportError(`${ERROR_PREFIX}_OUTPUT_TOO_LARGE`, "Claude checkpoint process output exceeded its limit.");
    }
    if (result.exitCode !== 0 || result.signal !== null) {
      throw checkpointTransportError(
        `${ERROR_PREFIX}_PROCESS_FAILED`,
        sanitizeProcessMessage(result.stderr, "Claude checkpoint process failed before a valid terminal result."),
        { exitCode: result.exitCode, signal: result.signal }
      );
    }
    if ((await readdir(resolved.workspace)).length > 0) {
      throw checkpointTransportError(
        "SECURITY_BOUNDARY_BREACH",
        "Claude wrote to the private checkpoint workspace; the run was stopped."
      );
    }
    const parsed = parseClaudeStreamOutput({
      stdout: result.stdout,
      workspace: resolved.workspace,
      ...(input.expectedSessionId !== undefined ? { expectedSessionId: input.expectedSessionId } : {}),
      maxBytes: this.#maxOutputBytes,
      maxLines: this.#maxLines,
      allowedToolNames
    });
    return Object.freeze({
      sessionId: parsed.sessionId,
      inputHash: hashText(input.prompt),
      outputHash: hashText(JSON.stringify(parsed.turn)),
      turn: parsed.turn
    });
  }
}

export { CLAUDE_CHECKPOINT_PROTOCOL_VERSION };
