import { createHash, randomUUID } from "node:crypto";
import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type {
  CursorAcpCapabilityProfile,
  CursorAcpEngineCheckpoint,
  CursorAcpEngineResume,
  CursorAcpEngineStart,
  CursorAcpHumanInput,
  CursorAcpJsonRpcId,
  CursorAcpJsonRpcNotification,
  CursorAcpJsonRpcRequest,
  CursorAcpObservation,
  CursorAcpQualificationEvidence,
  CursorAcpQuestionAnswer,
  CursorAcpQuestionItem,
  CursorAcpRunSession,
  CursorAcpSessionBinding,
  CursorAcpSessionEvent,
  CursorAcpSessionState,
  CursorAcpTransport,
  CursorAcpVdtMcpServer
} from "./cursor-acp-types";

const ACP_PROTOCOL_VERSION = 1;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 15_000;
const MAX_PROMPT_BYTES = 1024 * 1024;
const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
const MAX_QUESTION_TEXT_BYTES = 32 * 1024;
const MAX_QUESTION_COUNT = 5;
const MAX_OPTIONS_PER_QUESTION = 20;
const MAX_QUESTION_ID_LENGTH = 120;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SAFE_HASH = /^sha256:[a-f0-9]{64}$/;
const SAFE_TOOL_NAME = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/;
const FORBIDDEN_TOOL_PREFIXES = Object.freeze([
  "browser.",
  "computer.",
  "filesystem.",
  "fs.",
  "git.",
  "shell.",
  "subagent.",
  "terminal.",
  "web."
]);
const FORBIDDEN_TOOL_KINDS = new Set(["delete", "edit", "execute", "fetch", "move", "read", "search"]);
const FORBIDDEN_MCP_EXECUTABLES = new Set([
  "bash",
  "cmd",
  "env",
  "fish",
  "node",
  "powershell",
  "pwsh",
  "python",
  "python3",
  "sh",
  "zsh"
]);

interface CursorAcpInitializeResult {
  readonly protocolVersion: 1;
  readonly cliVersion?: string;
  readonly loadSession: boolean;
  readonly resumeSession: boolean;
  readonly closeSession: boolean;
}

export interface CursorAcpTransportFactoryInput {
  readonly runId: string;
  readonly privateWorkspacePath: string;
  readonly model?: string;
}

export type CursorAcpTransportFactory = (
  input: CursorAcpTransportFactoryInput
) => CursorAcpTransport | Promise<CursorAcpTransport>;

export interface CursorAcpProtocolEngineOptions {
  readonly transportFactory: CursorAcpTransportFactory;
  readonly expectedCliVersion: string;
  /** Explicit development-only gate. It never upgrades the capability profile. */
  readonly enableUnverifiedCanary?: boolean;
  /** Must come from a trusted, server-owned qualification registry. */
  readonly qualificationEvidence?: CursorAcpQualificationEvidence;
  readonly onObservation?: (observation: CursorAcpObservation) => void;
  readonly now?: () => Date;
  readonly handshakeTimeoutMs?: number;
  readonly clientInfo?: {
    readonly name: string;
    readonly version: string;
  };
}

interface PendingQuestion {
  readonly requestId: CursorAcpJsonRpcId;
  readonly questions: readonly CursorAcpQuestionItem[];
}

interface SessionCapabilities {
  readonly loadSession: boolean;
  readonly resumeSession: boolean;
  readonly closeSession: boolean;
}

type CursorAcpSessionEventInput = CursorAcpSessionEvent extends infer Event
  ? Event extends CursorAcpSessionEvent
    ? Omit<Event, "sequence" | "timestamp" | "sessionId">
    : never
  : never;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textBytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function hashText(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function hashJson(value: unknown): string {
  return hashText(JSON.stringify(value));
}

function engineError(code: string, message: string, details: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { code, ...details });
}

function errorCode(error: unknown, fallback: string): string {
  if (isRecord(error) && typeof error.code === "string" && error.code) return error.code;
  return fallback;
}

function sanitizeErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message.trim()) return fallback;
  if (/token|api.?key|authorization|cookie|secret/i.test(error.message)) return fallback;
  return error.message.slice(0, 500);
}

function assertSafeId(value: string, field: string): void {
  if (!SAFE_ID.test(value)) throw engineError("CURSOR_ACP_INVALID_START", `${field} is invalid.`);
}

function assertHash(value: string, field: string): void {
  if (!SAFE_HASH.test(value)) throw engineError("CURSOR_ACP_INVALID_START", `${field} must be a sha256 hash.`);
}

function assertPrivateWorkspacePath(value: unknown, field: string): asserts value is string {
  if (
    typeof value !== "string"
    || !path.isAbsolute(value)
    || value === path.parse(value).root
    || value.includes("\0")
  ) {
    throw engineError("CURSOR_ACP_UNSAFE_WORKSPACE", `${field} must be a non-root absolute path.`);
  }
}

async function existingRealDirectory(value: unknown, field: string): Promise<string> {
  assertPrivateWorkspacePath(value, field);
  const stat = await lstat(value).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw engineError(
      "CURSOR_ACP_UNSAFE_WORKSPACE",
      `${field} must be an existing non-symlink directory.`
    );
  }
  const resolved = await realpath(value).catch(() => undefined);
  if (!resolved) {
    throw engineError("CURSOR_ACP_UNSAFE_WORKSPACE", `${field} could not be resolved.`);
  }
  return resolved;
}

function isStrictPathDescendant(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

async function assertEmptyPrivateWorkspace(value: string, trustedRoot: string): Promise<void> {
  const [resolvedWorkspace, resolvedRoot] = await Promise.all([
    existingRealDirectory(value, "Cursor ACP workspace"),
    existingRealDirectory(trustedRoot, "Cursor ACP trusted private workspace root")
  ]);
  if (!isStrictPathDescendant(resolvedWorkspace, resolvedRoot)) {
    throw engineError(
      "CURSOR_ACP_UNSAFE_WORKSPACE",
      "Cursor ACP workspace must resolve strictly inside the trusted private workspace root."
    );
  }
  const entries = await readdir(resolvedWorkspace);
  if (entries.length > 0) {
    throw engineError("CURSOR_ACP_UNSAFE_WORKSPACE", "Cursor ACP workspace must be empty before session start or resume.");
  }
}

function assertAllowedToolNames(toolNames: readonly string[]): ReadonlySet<string> {
  if (toolNames.length === 0 || toolNames.length > 100) {
    throw engineError("CURSOR_ACP_INVALID_START", "allowedToolNames must contain 1-100 VDT domain tools.");
  }
  const allowed = new Set<string>();
  for (const toolName of toolNames) {
    if (
      !SAFE_TOOL_NAME.test(toolName) ||
      FORBIDDEN_TOOL_PREFIXES.some((prefix) => toolName.startsWith(prefix))
    ) {
      throw engineError("CURSOR_ACP_INVALID_START", `Unsafe tool name in allowlist: ${toolName}.`);
    }
    if (allowed.has(toolName)) {
      throw engineError("CURSOR_ACP_INVALID_START", `Duplicate tool name in allowlist: ${toolName}.`);
    }
    allowed.add(toolName);
  }
  return allowed;
}

function assertVdtMcpServer(server: CursorAcpVdtMcpServer): void {
  if (server.name !== "vdt-tool-gateway") {
    throw engineError("CURSOR_ACP_UNSAFE_MCP", "Only the VDT Tool Gateway MCP server is allowed.");
  }
  if (!path.isAbsolute(server.command) || server.command === path.parse(server.command).root || server.command.includes("\0")) {
    throw engineError("CURSOR_ACP_UNSAFE_MCP", "VDT Tool Gateway command must be a non-root absolute path.");
  }
  const executable = path.basename(server.command).toLowerCase().replace(/\.exe$/, "");
  if (FORBIDDEN_MCP_EXECUTABLES.has(executable)) {
    throw engineError("CURSOR_ACP_UNSAFE_MCP", "VDT Tool Gateway cannot be launched through a general-purpose interpreter or shell.");
  }
  for (const arg of server.args) {
    if (arg.includes("\0")) throw engineError("CURSOR_ACP_UNSAFE_MCP", "VDT Tool Gateway argument contains a NUL byte.");
  }
  const envNames = new Set<string>();
  for (const entry of server.env ?? []) {
    if (!entry.name || entry.name.includes("=") || entry.name.includes("\0") || entry.value.includes("\0")) {
      throw engineError("CURSOR_ACP_UNSAFE_MCP", "VDT Tool Gateway environment contains an invalid entry.");
    }
    if (envNames.has(entry.name)) {
      throw engineError("CURSOR_ACP_UNSAFE_MCP", `Duplicate VDT Tool Gateway environment key: ${entry.name}.`);
    }
    envNames.add(entry.name);
  }
}

export function cursorAcpMcpServerFingerprint(server: CursorAcpVdtMcpServer): string {
  return hashJson({
    name: server.name,
    command: server.command,
    args: server.args,
    envNames: (server.env ?? []).map((entry) => entry.name).sort()
  });
}

function buildCapability(evidence?: CursorAcpQualificationEvidence): CursorAcpCapabilityProfile {
  if (!evidence) {
    return Object.freeze({
      engine: "cursor_acp",
      profile: "external_cli_agent",
      backend: "cursor",
      protocolVersion: "acp-v1",
      sessionStrategy: "native",
      supportsNativeSession: true,
      supportsResume: true,
      supportsStructuredEvents: true,
      supportsToolBridge: true,
      supportsQuestions: true,
      supportsCancellation: true,
      supportsUsageMetrics: false,
      toolIsolation: "unverified",
      qualificationStatus: "unverified"
    });
  }
  if (
    !evidence.cliVersion.trim() ||
    evidence.protocolVersion !== ACP_PROTOCOL_VERSION ||
    !evidence.platform.trim() ||
    !Number.isFinite(Date.parse(evidence.testedAt)) ||
    !SAFE_HASH.test(evidence.evidenceHash) ||
    !SAFE_HASH.test(evidence.toolCatalogHash)
  ) {
    throw engineError("CURSOR_ACP_QUALIFICATION_INVALID", "Cursor ACP qualification evidence is invalid.");
  }
  return Object.freeze({
    engine: "cursor_acp",
    profile: "external_cli_agent",
    backend: "cursor",
    cliVersion: evidence.cliVersion,
    protocolVersion: "acp-v1",
    sessionStrategy: "native",
    supportsNativeSession: true,
    supportsResume: true,
    supportsStructuredEvents: true,
    supportsToolBridge: true,
    supportsQuestions: true,
    supportsCancellation: true,
    supportsUsageMetrics: false,
    toolIsolation: "hard_verified",
    qualificationStatus: "hard_verified",
    platform: evidence.platform,
    testedAt: evidence.testedAt,
    evidenceHash: evidence.evidenceHash
  });
}

function parseInitializeResult(value: unknown): CursorAcpInitializeResult {
  if (!isRecord(value) || value.protocolVersion !== ACP_PROTOCOL_VERSION) {
    throw engineError("CURSOR_ACP_PROTOCOL_MISMATCH", "Cursor ACP did not negotiate protocol version 1.");
  }
  const capabilities = isRecord(value.agentCapabilities) ? value.agentCapabilities : {};
  const sessionCapabilities = isRecord(capabilities.sessionCapabilities) ? capabilities.sessionCapabilities : {};
  const agentInfo = isRecord(value.agentInfo) ? value.agentInfo : {};
  return {
    protocolVersion: ACP_PROTOCOL_VERSION,
    ...(typeof agentInfo.version === "string" && agentInfo.version.trim() ? { cliVersion: agentInfo.version.trim() } : {}),
    loadSession: capabilities.loadSession === true,
    resumeSession: isRecord(sessionCapabilities.resume),
    closeSession: isRecord(sessionCapabilities.close)
  };
}

function advertisedAuthMethods(value: unknown): readonly string[] {
  if (!isRecord(value) || !Array.isArray(value.authMethods)) return [];
  const output: string[] = [];
  for (const candidate of value.authMethods) {
    if (typeof candidate === "string" && candidate.trim()) output.push(candidate.trim());
    else if (isRecord(candidate)) {
      const id = candidate.id ?? candidate.methodId;
      if (typeof id === "string" && id.trim()) output.push(id.trim());
    }
  }
  return output;
}

function parseSessionId(value: unknown): string {
  if (!isRecord(value) || typeof value.sessionId !== "string" || !SAFE_ID.test(value.sessionId)) {
    throw engineError("CURSOR_ACP_PROTOCOL_INVALID", "Cursor ACP session response has no valid sessionId.");
  }
  return value.sessionId;
}

function asMcpServerPayload(server: CursorAcpVdtMcpServer): Record<string, unknown> {
  return {
    name: server.name,
    command: server.command,
    args: [...server.args],
    env: (server.env ?? []).map((entry) => ({ name: entry.name, value: entry.value }))
  };
}

function validateQualification(
  evidence: CursorAcpQualificationEvidence | undefined,
  initialized: CursorAcpInitializeResult,
  toolCatalogHash: string
): void {
  if (!evidence) return;
  if (initialized.cliVersion !== evidence.cliVersion) {
    throw engineError("CURSOR_ACP_QUALIFICATION_MISMATCH", "Cursor CLI version does not match qualification evidence.");
  }
  if (evidence.toolCatalogHash !== toolCatalogHash) {
    throw engineError("CURSOR_ACP_QUALIFICATION_MISMATCH", "VDT tool catalog does not match qualification evidence.");
  }
  if (evidence.platform !== process.platform) {
    throw engineError("CURSOR_ACP_QUALIFICATION_MISMATCH", "Current platform does not match qualification evidence.");
  }
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  readonly #values: T[] = [];
  readonly #waiters: Array<(result: IteratorResult<T>) => void> = [];
  #closed = false;

  push(value: T): void {
    if (this.#closed) return;
    const waiter = this.#waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.#values.push(value);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) waiter({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async () => {
        const value = this.#values.shift();
        if (value !== undefined) return { done: false, value };
        if (this.#closed) return { done: true, value: undefined };
        return new Promise<IteratorResult<T>>((resolve) => this.#waiters.push(resolve));
      }
    };
  }
}

class CursorAcpSession implements CursorAcpRunSession {
  readonly #transport: CursorAcpTransport;
  readonly #allowedToolNames: ReadonlySet<string>;
  readonly #mcpServerFingerprint: string;
  readonly #capabilityEvidenceHash: string | undefined;
  readonly #cliVersion: string | undefined;
  readonly #now: () => Date;
  readonly #onObservation: ((observation: CursorAcpObservation) => void) | undefined;
  readonly #events = new AsyncEventQueue<CursorAcpSessionEvent>();
  readonly #toolNamesByCallId = new Map<string, string>();
  readonly #messageTextById = new Map<string, string>();
  readonly #messageOrder: string[] = [];
  readonly #detachMessage: () => void;
  readonly #detachClose: () => void;
  readonly #capabilities: SessionCapabilities;
  #binding: CursorAcpSessionBinding;
  #state: CursorAcpSessionState;
  #eventSequence: number;
  #activeTurnId: string | undefined;
  #activeInputHash: string | undefined;
  #activePrompt = false;
  #pendingQuestion: PendingQuestion | undefined;
  #lastConfirmedInputHash: string | undefined;
  #lastConfirmedOutputHash: string | undefined;
  #replaying = false;
  #securityFailed = false;
  #closed = false;

  constructor(input: {
    transport: CursorAcpTransport;
    binding: CursorAcpSessionBinding;
    allowedToolNames: ReadonlySet<string>;
    mcpServerFingerprint: string;
    capabilities: SessionCapabilities;
    cliVersion?: string;
    checkpoint?: CursorAcpEngineCheckpoint;
    onObservation?: (observation: CursorAcpObservation) => void;
    now: () => Date;
  }) {
    this.#transport = input.transport;
    this.#binding = input.binding;
    this.#allowedToolNames = input.allowedToolNames;
    this.#mcpServerFingerprint = input.mcpServerFingerprint;
    this.#capabilityEvidenceHash = input.binding.capabilityEvidenceHash;
    this.#cliVersion = input.cliVersion;
    this.#capabilities = input.capabilities;
    this.#now = input.now;
    this.#onObservation = input.onObservation;
    this.#state = input.checkpoint?.state === "waiting_question" || input.checkpoint?.state === "running"
      ? "idle"
      : input.checkpoint?.state ?? "idle";
    this.#eventSequence = input.checkpoint?.eventSequence ?? 0;
    this.#lastConfirmedInputHash = input.checkpoint?.lastConfirmedInputHash;
    this.#lastConfirmedOutputHash = input.checkpoint?.lastConfirmedOutputHash;
    this.#detachMessage = this.#transport.onMessage((message) => this.#handleInbound(message));
    this.#detachClose = this.#transport.onClose((error) => this.#handleTransportClose(error));
  }

  get binding(): CursorAcpSessionBinding {
    return this.#binding;
  }

  events(): AsyncIterable<CursorAcpSessionEvent> {
    return this.#events;
  }

  markReplaying(value: boolean): void {
    this.#replaying = value;
  }

  emitSessionReady(resumed: boolean): void {
    this.#emit({
      type: "runtime_status",
      source: "runtime",
      status: resumed ? "session_resumed" : "session_started"
    });
  }

  emitRecoveryWarning(checkpoint: CursorAcpEngineCheckpoint): void {
    if (!checkpoint.activeExchange) return;
    this.#emit({
      type: "warning",
      source: "runtime",
      code: "CURSOR_ACP_AMBIGUOUS_EXCHANGE_RECOVERY",
      message: "The prior ACP exchange was in flight. It was not replayed automatically; the Supervisor must reconcile the durable checkpoint."
    });
  }

  completeNativeResume(result: unknown): void {
    if (this.#closed || this.#securityFailed) {
      throw engineError("CURSOR_ACP_SESSION_CLOSED", "Cursor ACP session cannot complete native resume.");
    }
    this.#flushMessages();
    const stopReason = isRecord(result) && typeof result.stopReason === "string" && result.stopReason.trim()
      ? result.stopReason.trim().slice(0, 120)
      : "native_resume";
    const inputHash = this.#lastConfirmedInputHash
      ?? hashText(`resume:${this.#binding.externalSessionId}:${this.#binding.sessionEpoch}`);
    this.#state = "idle";
    this.#emit({
      type: "checkpoint",
      source: "runtime",
      stopReason,
      inputHash,
      ...(this.#lastConfirmedOutputHash ? { outputHash: this.#lastConfirmedOutputHash } : {})
    });
  }

  launchPrompt(text: string, preparedTurnId?: string): void {
    if (this.#closed || this.#securityFailed) throw engineError("CURSOR_ACP_SESSION_CLOSED", "Cursor ACP session is not writable.");
    if (this.#activePrompt || this.#pendingQuestion || this.#state !== "idle") {
      throw engineError("CURSOR_ACP_SESSION_BUSY", "Cursor ACP session already has an active exchange.");
    }
    const prompt = text.trim();
    if (!prompt || textBytes(prompt) > MAX_PROMPT_BYTES) {
      throw engineError("CURSOR_ACP_INPUT_INVALID", `Prompt must contain 1-${MAX_PROMPT_BYTES} UTF-8 bytes.`);
    }

    const turnId = preparedTurnId ?? randomUUID();
    assertSafeId(turnId, "preparedTurnId");
    const inputHash = hashText(prompt);
    this.#activePrompt = true;
    this.#activeTurnId = turnId;
    this.#activeInputHash = inputHash;
    this.#state = "running";
    this.#toolNamesByCallId.clear();
    this.#messageTextById.clear();
    this.#messageOrder.splice(0);
    this.#emit({ type: "runtime_status", source: "runtime", status: "turn_started", turnId });

    void this.#transport.request("session/prompt", {
      sessionId: this.#binding.externalSessionId,
      prompt: [{ type: "text", text: prompt }]
    }).then(
      (result) => this.#completePrompt(result, turnId, inputHash),
      (error: unknown) => this.#failPrompt(error, turnId)
    );
  }

  async submit(input: CursorAcpHumanInput): Promise<void> {
    if (input.type === "message") {
      this.launchPrompt(input.text);
      return;
    }

    const pending = this.#pendingQuestion;
    if (!pending || String(pending.requestId) !== String(input.requestId)) {
      throw engineError("CURSOR_ACP_QUESTION_STALE", "Question response does not match the active ACP question.");
    }
    if (input.type === "question_skipped") {
      const outcome: { outcome: "skipped"; reason?: string } = { outcome: "skipped" };
      if (input.reason?.trim()) outcome.reason = input.reason.trim().slice(0, 500);
      await this.#transport.respond(pending.requestId, { outcome });
    } else {
      const answers = this.#validateQuestionAnswers(pending.questions, input.answers);
      await this.#transport.respond(pending.requestId, {
        outcome: { outcome: "answered", answers }
      });
    }
    this.#pendingQuestion = undefined;
    this.#state = "running";
  }

  async checkpoint(): Promise<CursorAcpEngineCheckpoint> {
    const checkpoint: CursorAcpEngineCheckpoint = Object.freeze({
      schemaVersion: 1,
      engineAdapterId: "cursor-acp",
      runId: this.#binding.runId,
      engineBindingId: this.#binding.engineBindingId,
      externalSessionId: this.#binding.externalSessionId,
      sessionEpoch: this.#binding.sessionEpoch,
      protocolVersion: ACP_PROTOCOL_VERSION,
      ...(this.#cliVersion ? { cliVersion: this.#cliVersion } : {}),
      ...(this.#binding.model ? { model: this.#binding.model } : {}),
      backendSettingsHash: this.#binding.backendSettingsHash,
      toolCatalogHash: this.#binding.toolCatalogHash,
      mcpServerFingerprint: this.#mcpServerFingerprint,
      ...(this.#capabilityEvidenceHash ? { capabilityEvidenceHash: this.#capabilityEvidenceHash } : {}),
      eventSequence: this.#eventSequence,
      state: this.#state,
      ...(this.#lastConfirmedInputHash ? { lastConfirmedInputHash: this.#lastConfirmedInputHash } : {}),
      ...(this.#lastConfirmedOutputHash ? { lastConfirmedOutputHash: this.#lastConfirmedOutputHash } : {}),
      ...(this.#activeTurnId && this.#activeInputHash
        ? {
            activeExchange: Object.freeze({
              turnId: this.#activeTurnId,
              inputHash: this.#activeInputHash,
              state: this.#pendingQuestion ? "waiting_question" as const : "in_flight" as const
            })
          }
        : {}),
      createdAt: this.#now().toISOString()
    });
    return checkpoint;
  }

  async cancel(_reason: string): Promise<void> {
    if (this.#closed || this.#state === "closed") return;
    this.#state = "cancelling";
    if (this.#pendingQuestion) {
      const question = this.#pendingQuestion;
      this.#pendingQuestion = undefined;
      await this.#transport.respond(question.requestId, { outcome: { outcome: "cancelled" } }).catch(() => undefined);
    }
    await this.#transport.notify("session/cancel", { sessionId: this.#binding.externalSessionId });
    this.#emit({
      type: "runtime_status",
      source: "runtime",
      status: "turn_cancelled",
      ...(this.#activeTurnId ? { turnId: this.#activeTurnId } : {})
    });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    if (this.#activePrompt || this.#pendingQuestion) await this.cancel("session_closed").catch(() => undefined);
    if (this.#capabilities.closeSession) {
      await this.#transport.request(
        "session/close",
        { sessionId: this.#binding.externalSessionId },
        { timeoutMs: 5_000 }
      ).catch(() => undefined);
    }
    this.#state = "closed";
    this.#closed = true;
    this.#emit({ type: "runtime_status", source: "runtime", status: "session_closed" });
    this.#detachMessage();
    this.#detachClose();
    await this.#transport.close();
    this.#events.close();
  }

  #emit(event: CursorAcpSessionEventInput): void {
    this.#eventSequence += 1;
    this.#events.push({
      ...event,
      sequence: this.#eventSequence,
      timestamp: this.#now().toISOString(),
      sessionId: this.#binding.externalSessionId
    } as CursorAcpSessionEvent);
  }

  #completePrompt(result: unknown, turnId: string, inputHash: string): void {
    if (this.#activeTurnId !== turnId) return;
    this.#flushMessages(turnId);
    const stopReason = isRecord(result) && typeof result.stopReason === "string"
      ? result.stopReason
      : "unknown";
    this.#lastConfirmedInputHash = inputHash;
    this.#activePrompt = false;
    this.#activeTurnId = undefined;
    this.#activeInputHash = undefined;
    if (this.#state !== "failed" && this.#state !== "closed") this.#state = "idle";
    this.#emit({
      type: "checkpoint",
      source: "runtime",
      stopReason,
      inputHash,
      ...(this.#lastConfirmedOutputHash ? { outputHash: this.#lastConfirmedOutputHash } : {}),
      turnId
    });
  }

  #failPrompt(error: unknown, turnId: string): void {
    if (this.#activeTurnId !== turnId || this.#securityFailed) return;
    const code = errorCode(error, "CURSOR_ACP_PROMPT_FAILED");
    if (code === "CURSOR_ACP_REQUEST_CANCELLED" && this.#state === "cancelling") {
      this.#activePrompt = false;
      this.#activeTurnId = undefined;
      this.#activeInputHash = undefined;
      this.#state = "idle";
      return;
    }
    this.#activePrompt = false;
    this.#state = "failed";
    this.#emit({
      type: "error",
      source: "runtime",
      code,
      message: sanitizeErrorMessage(error, "Cursor ACP prompt failed."),
      turnId
    });
  }

  #handleInbound(message: CursorAcpJsonRpcRequest | CursorAcpJsonRpcNotification): void {
    if (message.method === "session/update") {
      this.#handleSessionUpdate(message.params);
      return;
    }
    if (message.method === "cursor/ask_question" && Object.hasOwn(message, "id")) {
      this.#handleQuestion(message as CursorAcpJsonRpcRequest);
      return;
    }
    if (message.method === "session/request_permission" && Object.hasOwn(message, "id")) {
      void this.#rejectPermission(message as CursorAcpJsonRpcRequest);
      return;
    }
    if (message.method === "cursor/update_todos") return;

    const forbidden =
      message.method === "cursor/create_plan" ||
      message.method === "cursor/task" ||
      message.method === "cursor/generate_image" ||
      message.method.startsWith("fs/") ||
      message.method.startsWith("terminal/") ||
      message.method.startsWith("filesystem/");
    if (Object.hasOwn(message, "id")) {
      void this.#transport.respondError((message as CursorAcpJsonRpcRequest).id, -32601, "Method is disabled by the VDT ACP boundary.")
        .catch(() => undefined);
    }
    void this.#securityBreach(forbidden
      ? `Forbidden Cursor ACP method ${message.method} was requested.`
      : `Unknown Cursor ACP method ${message.method} was requested.`);
  }

  #handleSessionUpdate(params: unknown): void {
    if (!isRecord(params) || params.sessionId !== this.#binding.externalSessionId || !isRecord(params.update)) {
      void this.#securityBreach("Cursor ACP emitted a session update outside the bound session.");
      return;
    }
    if (this.#replaying) return;
    const update = params.update;
    const kind = update.sessionUpdate;
    if (kind === "agent_message_chunk") {
      const content = isRecord(update.content) ? update.content : undefined;
      if (content?.type !== "text" || typeof content.text !== "string") return;
      this.#appendAssistantChunk(
        typeof update.messageId === "string" && update.messageId ? update.messageId : undefined,
        content.text
      );
      return;
    }
    if (kind === "agent_thought_chunk" || kind === "user_message_chunk" || kind === "plan" || kind === "usage_update") return;
    if (kind === "tool_call") {
      this.#handleToolReported(update);
      return;
    }
    if (kind === "tool_call_update") {
      this.#handleToolUpdated(update);
      return;
    }
    if (kind === "current_mode_update" || kind === "session_info_update" || kind === "config_option_update") return;
    this.#emit({
      type: "warning",
      source: "runtime",
      code: "CURSOR_ACP_UPDATE_IGNORED",
      message: "Cursor ACP emitted an unsupported non-authoritative session update."
    });
  }

  #appendAssistantChunk(messageId: string | undefined, text: string): void {
    if (!text) return;
    const key = messageId ?? `turn:${this.#activeTurnId ?? "unknown"}`;
    const previous = this.#messageTextById.get(key) ?? "";
    const combined = `${previous}${text}`;
    if (textBytes(combined) > MAX_MESSAGE_BYTES) {
      void this.#protocolFailure("Cursor ACP assistant message exceeded the configured byte limit.");
      return;
    }
    if (!this.#messageTextById.has(key)) this.#messageOrder.push(key);
    this.#messageTextById.set(key, combined);
    this.#emit({
      type: "assistant_message",
      source: "external_agent",
      phase: "delta",
      text,
      ...(messageId ? { messageId } : {}),
      ...(this.#activeTurnId ? { turnId: this.#activeTurnId } : {})
    });
  }

  #flushMessages(turnId = this.#activeTurnId): void {
    const completed: string[] = [];
    for (const key of this.#messageOrder.splice(0)) {
      const text = this.#messageTextById.get(key);
      this.#messageTextById.delete(key);
      if (!text) continue;
      completed.push(text);
      const messageId = key.startsWith("turn:") ? undefined : key;
      this.#emit({
        type: "assistant_message",
        source: "external_agent",
        phase: "completed",
        text,
        ...(messageId ? { messageId } : {}),
        ...(turnId ? { turnId } : {})
      });
    }
    if (completed.length > 0) this.#lastConfirmedOutputHash = hashText(completed.join("\n"));
  }

  #handleToolReported(update: Record<string, unknown>): void {
    this.#flushMessages();
    const toolCallId = typeof update.toolCallId === "string" ? update.toolCallId : undefined;
    const toolName = this.#extractToolName(update);
    const kind = typeof update.kind === "string" ? update.kind : undefined;
    if (!toolCallId || !SAFE_ID.test(toolCallId) || !toolName || !this.#allowedToolNames.has(toolName)) {
      void this.#securityBreach("Cursor ACP reported a tool outside the session VDT allowlist.");
      return;
    }
    if (kind && FORBIDDEN_TOOL_KINDS.has(kind)) {
      void this.#securityBreach(`Cursor ACP reported forbidden tool kind ${kind}.`);
      return;
    }
    this.#toolNamesByCallId.set(toolCallId, toolName);
    this.#onObservation?.({
      kind: "vdt_tool_reported",
      sessionId: this.#binding.externalSessionId,
      toolCallId,
      toolName,
      ...(typeof update.status === "string" ? { status: update.status } : {}),
      timestamp: this.#now().toISOString()
    });
  }

  #handleToolUpdated(update: Record<string, unknown>): void {
    const toolCallId = typeof update.toolCallId === "string" ? update.toolCallId : undefined;
    const toolName = toolCallId ? this.#toolNamesByCallId.get(toolCallId) : undefined;
    if (!toolCallId || !toolName) {
      void this.#securityBreach("Cursor ACP updated an unknown or non-VDT tool call.");
      return;
    }
    this.#onObservation?.({
      kind: "vdt_tool_updated",
      sessionId: this.#binding.externalSessionId,
      toolCallId,
      toolName,
      ...(typeof update.status === "string" ? { status: update.status } : {}),
      timestamp: this.#now().toISOString()
    });
  }

  #extractToolName(update: Record<string, unknown>): string | undefined {
    const rawInput = isRecord(update.rawInput) ? update.rawInput : undefined;
    const meta = isRecord(update._meta) ? update._meta : undefined;
    const candidates = [update.toolName, update.name, rawInput?.toolName, rawInput?.name, meta?.toolName];
    return candidates.find((candidate): candidate is string =>
      typeof candidate === "string" && SAFE_TOOL_NAME.test(candidate)
    );
  }

  #handleQuestion(request: CursorAcpJsonRpcRequest): void {
    if (this.#pendingQuestion || !this.#activePrompt || !isRecord(request.params)) {
      void this.#transport.respondError(request.id, -32602, "Question request is not valid in the current VDT run state.")
        .catch(() => undefined);
      void this.#protocolFailure("Cursor ACP emitted an invalid or overlapping question request.");
      return;
    }
    try {
      const questions = this.#parseQuestions(request.params.questions);
      const title = typeof request.params.title === "string" && request.params.title.trim()
        ? this.#boundedQuestionText(request.params.title, "question title")
        : undefined;
      this.#flushMessages();
      this.#pendingQuestion = { requestId: request.id, questions };
      this.#state = "waiting_question";
      this.#emit({
        type: "question",
        source: "external_agent",
        requestId: request.id,
        ...(title ? { title } : {}),
        questions,
        ...(this.#activeTurnId ? { turnId: this.#activeTurnId } : {})
      });
    } catch (error) {
      void this.#transport.respondError(request.id, -32602, "Question payload is invalid.").catch(() => undefined);
      void this.#protocolFailure(sanitizeErrorMessage(error, "Cursor ACP question payload is invalid."));
    }
  }

  #parseQuestions(value: unknown): readonly CursorAcpQuestionItem[] {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_QUESTION_COUNT) {
      throw engineError("CURSOR_ACP_QUESTION_INVALID", `Question request must contain 1-${MAX_QUESTION_COUNT} questions.`);
    }
    const ids = new Set<string>();
    return Object.freeze(value.map((candidate, index) => {
      if (
        !isRecord(candidate)
        || typeof candidate.id !== "string"
        || !SAFE_ID.test(candidate.id)
        || candidate.id.length > MAX_QUESTION_ID_LENGTH
      ) {
        throw engineError("CURSOR_ACP_QUESTION_INVALID", `Question ${index} has an invalid id.`);
      }
      if (ids.has(candidate.id)) throw engineError("CURSOR_ACP_QUESTION_INVALID", `Duplicate question id ${candidate.id}.`);
      ids.add(candidate.id);
      if (typeof candidate.prompt !== "string" || !candidate.prompt.trim()) {
        throw engineError("CURSOR_ACP_QUESTION_INVALID", `Question ${candidate.id} has no prompt.`);
      }
      if (!Array.isArray(candidate.options) || candidate.options.length === 0 || candidate.options.length > MAX_OPTIONS_PER_QUESTION) {
        throw engineError("CURSOR_ACP_QUESTION_INVALID", `Question ${candidate.id} has an invalid option count.`);
      }
      const optionIds = new Set<string>();
      const options = candidate.options.map((option, optionIndex) => {
        if (
          !isRecord(option) ||
          typeof option.id !== "string" ||
          !SAFE_ID.test(option.id) ||
          option.id.length > MAX_QUESTION_ID_LENGTH ||
          typeof option.label !== "string" ||
          !option.label.trim()
        ) {
          throw engineError("CURSOR_ACP_QUESTION_INVALID", `Question ${candidate.id} option ${optionIndex} is invalid.`);
        }
        if (optionIds.has(option.id)) throw engineError("CURSOR_ACP_QUESTION_INVALID", `Duplicate option id ${option.id}.`);
        optionIds.add(option.id);
        return Object.freeze({ id: option.id, label: this.#boundedQuestionText(option.label, "option label") });
      });
      return Object.freeze({
        id: candidate.id,
        prompt: this.#boundedQuestionText(candidate.prompt, "question prompt"),
        options: Object.freeze(options),
        allowMultiple: candidate.allowMultiple === true
      });
    }));
  }

  #boundedQuestionText(value: string, field: string): string {
    const text = value.trim();
    if (!text || textBytes(text) > MAX_QUESTION_TEXT_BYTES) {
      throw engineError("CURSOR_ACP_QUESTION_INVALID", `${field} exceeds the configured byte limit.`);
    }
    return text;
  }

  #validateQuestionAnswers(
    questions: readonly CursorAcpQuestionItem[],
    answers: readonly CursorAcpQuestionAnswer[]
  ): readonly { questionId: string; selectedOptionIds: readonly string[] }[] {
    if (answers.length !== questions.length) {
      throw engineError("CURSOR_ACP_QUESTION_INVALID", "Every active question requires exactly one answer entry.");
    }
    const byId = new Map(questions.map((question) => [question.id, question]));
    const answered = new Set<string>();
    const output = answers.map((answer) => {
      const question = byId.get(answer.questionId);
      if (!question || answered.has(answer.questionId)) {
        throw engineError("CURSOR_ACP_QUESTION_INVALID", `Unknown or duplicate question answer ${answer.questionId}.`);
      }
      answered.add(answer.questionId);
      const selected = [...answer.selectedOptionIds];
      if (selected.length === 0 || (!question.allowMultiple && selected.length !== 1) || new Set(selected).size !== selected.length) {
        throw engineError("CURSOR_ACP_QUESTION_INVALID", `Question ${answer.questionId} has an invalid selection count.`);
      }
      const allowedOptions = new Set(question.options.map((option) => option.id));
      if (selected.some((optionId) => !allowedOptions.has(optionId))) {
        throw engineError("CURSOR_ACP_QUESTION_INVALID", `Question ${answer.questionId} selected an unknown option.`);
      }
      return Object.freeze({ questionId: answer.questionId, selectedOptionIds: Object.freeze(selected) });
    });
    return Object.freeze(output);
  }

  async #rejectPermission(request: CursorAcpJsonRpcRequest): Promise<void> {
    const params = isRecord(request.params) ? request.params : {};
    const options = Array.isArray(params.options) ? params.options : [];
    const rejectOption = options.find((candidate) =>
      isRecord(candidate) && candidate.kind === "reject_once" && typeof candidate.optionId === "string"
    );
    if (isRecord(rejectOption) && typeof rejectOption.optionId === "string") {
      await this.#transport.respond(request.id, {
        outcome: { outcome: "selected", optionId: rejectOption.optionId }
      }).catch(() => undefined);
    } else {
      await this.#transport.respond(request.id, { outcome: { outcome: "cancelled" } }).catch(() => undefined);
    }
    await this.#securityBreach("Cursor requested provider-side permission; approvals belong to the VDT Run Supervisor.");
  }

  async #protocolFailure(message: string): Promise<void> {
    if (this.#securityFailed || this.#closed) return;
    this.#state = "failed";
    this.#emit({ type: "error", source: "runtime", code: "CURSOR_ACP_PROTOCOL_INVALID", message });
    await this.#transport.notify("session/cancel", { sessionId: this.#binding.externalSessionId }).catch(() => undefined);
    this.#closed = true;
    await this.#transport.close().catch(() => undefined);
    this.#events.close();
  }

  async #securityBreach(message: string): Promise<void> {
    if (this.#securityFailed || this.#closed) return;
    this.#securityFailed = true;
    this.#state = "failed";
    this.#emit({ type: "error", source: "runtime", code: "SECURITY_BOUNDARY_BREACH", message });
    if (this.#pendingQuestion) {
      await this.#transport.respond(this.#pendingQuestion.requestId, { outcome: { outcome: "cancelled" } }).catch(() => undefined);
      this.#pendingQuestion = undefined;
    }
    await this.#transport.notify("session/cancel", { sessionId: this.#binding.externalSessionId }).catch(() => undefined);
    this.#closed = true;
    await this.#transport.close().catch(() => undefined);
    this.#events.close();
  }

  #handleTransportClose(error?: Error): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#state !== "closed") {
      this.#state = "failed";
      this.#emit({
        type: "error",
        source: "runtime",
        code: errorCode(error, "CURSOR_ACP_TRANSPORT_CLOSED"),
        message: sanitizeErrorMessage(error, "Cursor ACP transport closed unexpectedly.")
      });
    }
    this.#events.close();
  }
}

/** Default-off Cursor ACP engine. No profile is production-qualified by this implementation alone. */
export class CursorAcpProtocolEngine {
  readonly capability: CursorAcpCapabilityProfile;
  readonly #options: CursorAcpProtocolEngineOptions;
  readonly #now: () => Date;
  readonly #handshakeTimeoutMs: number;

  constructor(options: CursorAcpProtocolEngineOptions) {
    if (typeof options.transportFactory !== "function") {
      throw engineError("CURSOR_ACP_INVALID_CONFIGURATION", "transportFactory is required.");
    }
    if (!options.expectedCliVersion.trim() || options.expectedCliVersion.length > 120) {
      throw engineError("CURSOR_ACP_INVALID_CONFIGURATION", "expectedCliVersion is required.");
    }
    this.#options = options;
    this.#now = options.now ?? (() => new Date());
    this.#handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.#handshakeTimeoutMs) || this.#handshakeTimeoutMs <= 0) {
      throw engineError("CURSOR_ACP_INVALID_CONFIGURATION", "handshakeTimeoutMs must be a positive integer.");
    }
    this.capability = buildCapability(options.qualificationEvidence);
  }

  async openSession(start: CursorAcpEngineStart, _host?: unknown): Promise<CursorAcpRunSession> {
    this.#assertEnabled();
    const prepared = await this.#prepareStart(start);
    const transport = await this.#options.transportFactory({
      runId: start.runId,
      privateWorkspacePath: start.privateWorkspacePath,
      ...(start.model ? { model: start.model } : {})
    });
    try {
      await transport.start();
      const initializedRaw = await transport.request("initialize", {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false
        },
        clientInfo: {
          name: this.#options.clientInfo?.name ?? "vdt-studio",
          version: this.#options.clientInfo?.version ?? "0.1.0"
        }
      }, { timeoutMs: this.#handshakeTimeoutMs });
      const initialized = parseInitializeResult(initializedRaw);
      this.#assertExpectedCliVersion(initialized);
      validateQualification(this.#options.qualificationEvidence, initialized, start.toolCatalogHash);
      await this.#authenticateIfAdvertised(transport, initializedRaw);

      const sessionRaw = await transport.request("session/new", {
        cwd: start.privateWorkspacePath,
        mcpServers: [asMcpServerPayload(start.vdtMcpServer)]
      }, { timeoutMs: this.#handshakeTimeoutMs });
      const externalSessionId = parseSessionId(sessionRaw);
      const session = this.#createSession({
        transport,
        start,
        externalSessionId,
        initialized,
        allowedToolNames: prepared.allowedToolNames,
        mcpFingerprint: prepared.mcpFingerprint
      });
      session.emitSessionReady(false);
      if (start.deferInitialPrompt !== true) session.launchPrompt(start.initialPrompt);
      return session;
    } catch (error) {
      await transport.close().catch(() => undefined);
      throw error;
    }
  }

  async resumeSession(resume: CursorAcpEngineResume, _host?: unknown): Promise<CursorAcpRunSession> {
    this.#assertEnabled();
    const prepared = await this.#prepareResume(resume);
    const checkpoint = resume.checkpoint;
    const transport = await this.#options.transportFactory({
      runId: checkpoint.runId,
      privateWorkspacePath: resume.privateWorkspacePath,
      ...(checkpoint.model ? { model: checkpoint.model } : {})
    });
    try {
      await transport.start();
      const initializedRaw = await transport.request("initialize", {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false
        },
        clientInfo: {
          name: this.#options.clientInfo?.name ?? "vdt-studio",
          version: this.#options.clientInfo?.version ?? "0.1.0"
        }
      }, { timeoutMs: this.#handshakeTimeoutMs });
      const initialized = parseInitializeResult(initializedRaw);
      this.#assertExpectedCliVersion(initialized);
      validateQualification(this.#options.qualificationEvidence, initialized, checkpoint.toolCatalogHash);
      await this.#authenticateIfAdvertised(transport, initializedRaw);

      if (!initialized.resumeSession && !initialized.loadSession) {
        throw engineError("CURSOR_ACP_RESUME_UNSUPPORTED", "Cursor ACP did not advertise session resume or load support.");
      }
      if (resume.requireNativeResume === true && !initialized.resumeSession) {
        throw engineError(
          "CURSOR_ACP_NATIVE_RESUME_REQUIRED",
          "Verified finish recovery requires native session/resume and cannot start a new prompt after session/load."
        );
      }
      const session = this.#createSession({
        transport,
        start: {
          runId: checkpoint.runId,
          engineBindingId: checkpoint.engineBindingId,
          sessionEpoch: checkpoint.sessionEpoch,
          trustedPrivateWorkspaceRoot: resume.trustedPrivateWorkspaceRoot,
          privateWorkspacePath: resume.privateWorkspacePath,
          initialPrompt: "resume-placeholder",
          ...(checkpoint.model ? { model: checkpoint.model } : {}),
          backendSettingsHash: checkpoint.backendSettingsHash,
          toolCatalogHash: checkpoint.toolCatalogHash,
          allowedToolNames: resume.allowedToolNames,
          vdtMcpServer: resume.vdtMcpServer
        },
        externalSessionId: checkpoint.externalSessionId,
        initialized,
        allowedToolNames: prepared.allowedToolNames,
        mcpFingerprint: prepared.mcpFingerprint,
        checkpoint
      });
      session.markReplaying(!initialized.resumeSession);
      const method = initialized.resumeSession ? "session/resume" : "session/load";
      const resumeResult = await transport.request(method, {
        sessionId: checkpoint.externalSessionId,
        cwd: resume.privateWorkspacePath,
        mcpServers: [asMcpServerPayload(resume.vdtMcpServer)]
      }, { timeoutMs: this.#handshakeTimeoutMs });
      session.markReplaying(false);
      session.emitSessionReady(true);
      if (initialized.resumeSession && resume.requireNativeResume === true) {
        session.completeNativeResume(resumeResult);
      }
      session.emitRecoveryWarning(checkpoint);
      return session;
    } catch (error) {
      await transport.close().catch(() => undefined);
      throw error;
    }
  }

  #assertEnabled(): void {
    if (this.capability.qualificationStatus === "hard_verified") return;
    if (this.#options.enableUnverifiedCanary === true) return;
    throw engineError(
      "EXTERNAL_ENGINE_NOT_QUALIFIED",
      "Cursor ACP is an unverified default-off canary. Trusted qualification or the explicit development canary gate is required."
    );
  }

  #assertExpectedCliVersion(initialized: CursorAcpInitializeResult): void {
    if (
      initialized.cliVersion !== this.#options.expectedCliVersion
      || (
        this.#options.qualificationEvidence !== undefined
        && initialized.cliVersion !== this.#options.qualificationEvidence.cliVersion
      )
    ) {
      throw engineError(
        "CURSOR_ACP_CLI_VERSION_MISMATCH",
        "Live Cursor CLI version does not match the server-owned engine capability."
      );
    }
  }

  async #prepareStart(start: CursorAcpEngineStart): Promise<{
    allowedToolNames: ReadonlySet<string>;
    mcpFingerprint: string;
  }> {
    assertSafeId(start.runId, "runId");
    assertSafeId(start.engineBindingId, "engineBindingId");
    if (start.deferInitialPrompt !== undefined && typeof start.deferInitialPrompt !== "boolean") {
      throw engineError("CURSOR_ACP_INVALID_START", "deferInitialPrompt must be a boolean when provided.");
    }
    if (!Number.isSafeInteger(start.sessionEpoch) || start.sessionEpoch <= 0) {
      throw engineError("CURSOR_ACP_INVALID_START", "sessionEpoch must be a positive integer.");
    }
    if (start.model !== undefined && (!start.model.trim() || start.model.startsWith("-") || start.model.includes("\0") || start.model.length > 256)) {
      throw engineError("CURSOR_ACP_INVALID_START", "model is invalid.");
    }
    assertHash(start.backendSettingsHash, "backendSettingsHash");
    assertHash(start.toolCatalogHash, "toolCatalogHash");
    if (!start.initialPrompt.trim() || textBytes(start.initialPrompt) > MAX_PROMPT_BYTES) {
      throw engineError("CURSOR_ACP_INVALID_START", `initialPrompt must contain 1-${MAX_PROMPT_BYTES} UTF-8 bytes.`);
    }
    const allowedToolNames = assertAllowedToolNames(start.allowedToolNames);
    assertVdtMcpServer(start.vdtMcpServer);
    await assertEmptyPrivateWorkspace(
      start.privateWorkspacePath,
      start.trustedPrivateWorkspaceRoot
    );
    return { allowedToolNames, mcpFingerprint: cursorAcpMcpServerFingerprint(start.vdtMcpServer) };
  }

  async #prepareResume(resume: CursorAcpEngineResume): Promise<{
    allowedToolNames: ReadonlySet<string>;
    mcpFingerprint: string;
  }> {
    const checkpoint = resume.checkpoint;
    if (resume.requireNativeResume !== undefined && typeof resume.requireNativeResume !== "boolean") {
      throw engineError("CURSOR_ACP_CHECKPOINT_INVALID", "requireNativeResume must be a boolean when provided.");
    }
    if (
      checkpoint.schemaVersion !== 1 ||
      checkpoint.engineAdapterId !== "cursor-acp" ||
      checkpoint.protocolVersion !== ACP_PROTOCOL_VERSION
    ) {
      throw engineError("CURSOR_ACP_CHECKPOINT_INVALID", "Checkpoint is not a supported Cursor ACP checkpoint.");
    }
    assertSafeId(checkpoint.runId, "checkpoint.runId");
    assertSafeId(checkpoint.engineBindingId, "checkpoint.engineBindingId");
    assertSafeId(checkpoint.externalSessionId, "checkpoint.externalSessionId");
    assertHash(checkpoint.backendSettingsHash, "checkpoint.backendSettingsHash");
    assertHash(checkpoint.toolCatalogHash, "checkpoint.toolCatalogHash");
    assertHash(checkpoint.mcpServerFingerprint, "checkpoint.mcpServerFingerprint");
    if (resume.backendSettingsHash !== checkpoint.backendSettingsHash) {
      throw engineError("CURSOR_ACP_CHECKPOINT_MISMATCH", "Backend settings changed since the Cursor ACP checkpoint.");
    }
    if (resume.toolCatalogHash !== checkpoint.toolCatalogHash) {
      throw engineError("CURSOR_ACP_CHECKPOINT_MISMATCH", "VDT tool catalog changed since the Cursor ACP checkpoint.");
    }
    const allowedToolNames = assertAllowedToolNames(resume.allowedToolNames);
    assertVdtMcpServer(resume.vdtMcpServer);
    const mcpFingerprint = cursorAcpMcpServerFingerprint(resume.vdtMcpServer);
    if (mcpFingerprint !== checkpoint.mcpServerFingerprint) {
      throw engineError("CURSOR_ACP_CHECKPOINT_MISMATCH", "VDT Tool Gateway configuration changed since the Cursor ACP checkpoint.");
    }
    if ((checkpoint.capabilityEvidenceHash ?? undefined) !== (this.capability.evidenceHash ?? undefined)) {
      throw engineError("CURSOR_ACP_CHECKPOINT_MISMATCH", "Cursor ACP qualification evidence changed since the checkpoint.");
    }
    await assertEmptyPrivateWorkspace(
      resume.privateWorkspacePath,
      resume.trustedPrivateWorkspaceRoot
    );
    return { allowedToolNames, mcpFingerprint };
  }

  async #authenticateIfAdvertised(transport: CursorAcpTransport, initializedRaw: unknown): Promise<void> {
    const authMethods = advertisedAuthMethods(initializedRaw);
    if (authMethods.length === 0) return;
    if (!authMethods.includes("cursor_login")) {
      throw engineError("CURSOR_ACP_AUTH_METHOD_UNAVAILABLE", "Cursor ACP did not advertise cursor_login authentication.");
    }
    await transport.request("authenticate", { methodId: "cursor_login" }, { timeoutMs: this.#handshakeTimeoutMs });
  }

  #createSession(input: {
    transport: CursorAcpTransport;
    start: CursorAcpEngineStart;
    externalSessionId: string;
    initialized: CursorAcpInitializeResult;
    allowedToolNames: ReadonlySet<string>;
    mcpFingerprint: string;
    checkpoint?: CursorAcpEngineCheckpoint;
  }): CursorAcpSession {
    const binding: CursorAcpSessionBinding = Object.freeze({
      executionProfile: "external_cli_agent",
      engineAdapterId: "cursor-acp",
      backendId: "cursor",
      runId: input.start.runId,
      engineBindingId: input.start.engineBindingId,
      externalSessionId: input.externalSessionId,
      sessionEpoch: input.start.sessionEpoch,
      ...(input.start.model ? { model: input.start.model } : {}),
      backendSettingsHash: input.start.backendSettingsHash,
      toolCatalogHash: input.start.toolCatalogHash,
      ...(this.capability.evidenceHash ? { capabilityEvidenceHash: this.capability.evidenceHash } : {})
    });
    return new CursorAcpSession({
      transport: input.transport,
      binding,
      allowedToolNames: input.allowedToolNames,
      mcpServerFingerprint: input.mcpFingerprint,
      capabilities: {
        loadSession: input.initialized.loadSession,
        resumeSession: input.initialized.resumeSession,
        closeSession: input.initialized.closeSession
      },
      ...(input.initialized.cliVersion ? { cliVersion: input.initialized.cliVersion } : {}),
      ...(input.checkpoint ? { checkpoint: input.checkpoint } : {}),
      ...(this.#options.onObservation ? { onObservation: this.#options.onObservation } : {}),
      now: this.#now
    });
  }
}
