import { createHash, randomUUID } from "node:crypto";
import {
  agentEngineCheckpointSchema,
  agentQuestionSchema,
  agentSessionBindingSchema,
  vdtGatewayToolResultSchema,
  type AgentCapabilityProfile,
  type AgentEngineCheckpoint,
  type AgentEngineEvent,
  type AgentEngineHost,
  type AgentEngineStart,
  type AgentHumanInput,
  type AgentRunSession,
  type AgentSessionBinding,
  type ExternalCliAgentEngine,
  type VdtGatewayToolCall,
  type VdtGatewayToolResult
} from "@vdt-studio/vdt-agent-runtime";
import {
  CURSOR_CHECKPOINT_PROTOCOL_VERSION,
  CursorResumeCheckpointTransport,
  cursorCheckpointEnvironmentFingerprint,
  isCursorCheckpointHash,
  type CursorCheckpointTurn,
  type CursorResumeCheckpointEnvironment
} from "./cursor-resume-checkpoint-transport";

const SAFE_HASH = /^sha256:[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const MAX_SEGMENTS = 240;

type CursorCheckpointCapability = Extract<AgentCapabilityProfile, { executionProfile: "external_cli_agent" }>;

export interface CursorResumeCheckpointEnvironmentFactoryInput {
  readonly binding: AgentSessionBinding;
  readonly recovery: boolean;
  readonly signal: AbortSignal;
}

export type CursorResumeCheckpointEnvironmentFactory = (
  input: CursorResumeCheckpointEnvironmentFactoryInput
) => CursorResumeCheckpointEnvironment | Promise<CursorResumeCheckpointEnvironment>;

export interface CursorResumeCheckpointEngineOptions {
  readonly transport: CursorResumeCheckpointTransport;
  readonly cliVersion: string;
  readonly toolCatalogHash: string;
  readonly allowedToolNames: readonly string[];
  readonly sessionEnvironmentFactory: CursorResumeCheckpointEnvironmentFactory;
  readonly resolveBinding: (checkpoint: AgentEngineCheckpoint) => AgentSessionBinding | Promise<AgentSessionBinding>;
  /** Development-only gate. It never upgrades qualification or tool isolation. */
  readonly enableUnverifiedCanary?: boolean;
  readonly now?: () => string;
  readonly idFactory?: () => string;
  readonly maxSegments?: number;
}

type CursorCheckpointDelta =
  | {
      readonly type: "tool_results";
      readonly batchId: string;
      readonly results: readonly VdtGatewayToolResult[];
    }
  | {
      readonly type: "human_checkpoint";
      readonly prior: CursorCheckpointDelta;
      readonly input: AgentHumanInput;
    }
  | {
      readonly type: "recovery";
      readonly checkpoint: {
        readonly checkpointId: string;
        readonly lastConfirmedInput: AgentEngineCheckpoint["lastConfirmedInput"];
        readonly lastConfirmedOutput: AgentEngineCheckpoint["lastConfirmedOutput"];
        readonly finishReceipt: AgentEngineCheckpoint["finishReceipt"];
      };
    };

function engineError(code: string, message: string, details: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { code, ...details });
}

function errorCode(error: unknown, fallback: string): string {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code.slice(0, 160)
    : fallback;
}

function safeErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message.trim()) return fallback;
  if (/api.?key|authorization|cookie|password|secret|token/i.test(error.message)) return fallback;
  return error.message.slice(0, 1_000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw engineError("CURSOR_CHECKPOINT_JSON_INVALID", "JSON contains a non-finite number.");
    return value;
  }
  if (!isRecord(value)) throw engineError("CURSOR_CHECKPOINT_JSON_INVALID", "JSON value is unsupported.");
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw engineError("CURSOR_CHECKPOINT_JSON_INVALID", "JSON objects must use a plain prototype.");
  }
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => [key, sortJson(value[key])])
  );
}

function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(sortJson(value));
  if (serialized === undefined) throw engineError("CURSOR_CHECKPOINT_JSON_INVALID", "JSON value is not serializable.");
  return serialized;
}

function hashText(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function hashJson(value: unknown): string {
  return hashText(canonicalJson(value));
}

function buildCapability(options: CursorResumeCheckpointEngineOptions): CursorCheckpointCapability {
  if (!options.cliVersion.trim() || options.cliVersion.length > 120 || options.transport.validatedCliVersion !== options.cliVersion) {
    throw engineError(
      "CURSOR_CHECKPOINT_VERSION_MISMATCH",
      "Engine and transport must pin the same exact trusted Cursor CLI version."
    );
  }
  if (!SAFE_HASH.test(options.toolCatalogHash)) {
    throw engineError("CURSOR_CHECKPOINT_CONFIGURATION_INVALID", "toolCatalogHash must be a sha256 hash.");
  }
  return Object.freeze({
    schemaVersion: 1,
    executionProfile: "external_cli_agent",
    engineId: "cursor-resume-checkpoint",
    engineAdapterId: "cursor-resume-checkpoint-v1",
    backendId: "cursor",
    cli: Object.freeze({ name: "cursor-agent", version: options.cliVersion }),
    protocolVersion: CURSOR_CHECKPOINT_PROTOCOL_VERSION,
    sessionStrategy: "checkpoint_resume",
    toolCatalogHash: options.toolCatalogHash,
    toolIsolation: "unverified",
    qualification: Object.freeze({
      status: "unverified",
      platform: Object.freeze({ os: process.platform, arch: process.arch, runtimeVersion: process.version }),
      testedAt: null,
      evidenceHash: null
    }),
    supportsNativeSession: false,
    supportsResume: true,
    supportsStructuredEvents: true,
    supportsToolBridge: true,
    supportsQuestions: true,
    supportsCancellation: true,
    supportsUsageMetrics: false
  });
}

export function cursorResumeCheckpointCapabilityHash(capability: CursorCheckpointCapability): string {
  return hashJson(capability);
}

function assertBinding(bindingInput: AgentSessionBinding, capability: CursorCheckpointCapability): AgentSessionBinding {
  const binding = agentSessionBindingSchema.parse(bindingInput);
  if (
    binding.executionProfile !== capability.executionProfile
    || binding.engineId !== capability.engineId
    || binding.engineAdapterId !== capability.engineAdapterId
    || binding.backendId !== capability.backendId
    || binding.protocolVersion !== capability.protocolVersion
    || binding.cliVersion !== capability.cli.version
    || binding.toolIsolation !== capability.toolIsolation
    || binding.qualificationStatus !== capability.qualification.status
    || binding.capabilityEvidenceHash !== null
    || binding.toolCatalogHash !== capability.toolCatalogHash
    || binding.capabilityProfileHash !== cursorResumeCheckpointCapabilityHash(capability)
  ) {
    throw engineError(
      "CURSOR_CHECKPOINT_BINDING_MISMATCH",
      "Agent session binding does not match the Cursor checkpoint capability."
    );
  }
  return binding;
}

function assertCheckpointBinding(checkpoint: AgentEngineCheckpoint, binding: AgentSessionBinding): void {
  if (
    checkpoint.bindingId !== binding.bindingId
    || checkpoint.runId !== binding.runId
    || checkpoint.sessionEpoch !== binding.sessionEpoch
    || checkpoint.externalSessionId !== binding.externalSessionId
    || checkpoint.externalSessionId === null
  ) {
    throw engineError(
      "CURSOR_CHECKPOINT_BINDING_MISMATCH",
      "Checkpoint does not match the immutable Cursor session binding."
    );
  }
  if (checkpoint.activeExchange?.state === "ambiguous" || checkpoint.activeExchange?.state === "in_flight") {
    throw engineError(
      "CURSOR_CHECKPOINT_AMBIGUOUS_EXCHANGE",
      "An ambiguous Cursor process exchange cannot be replayed without a stable terminal receipt."
    );
  }
}

function environmentCursorPrefix(environment: CursorResumeCheckpointEnvironment): string {
  return `cursor-env-${cursorCheckpointEnvironmentFingerprint(environment.environmentId).slice("sha256:".length, 39)}`;
}

function assertCheckpointEnvironment(checkpoint: AgentEngineCheckpoint, environment: CursorResumeCheckpointEnvironment): void {
  const prefix = environmentCursorPrefix(environment);
  if (!checkpoint.lastConfirmedInput?.cursor.startsWith(`${prefix}:`)) {
    throw engineError(
      "CURSOR_CHECKPOINT_ENVIRONMENT_MISMATCH",
      "Resume environment does not match the private environment that owns the opaque Cursor session."
    );
  }
}

function segmentCursor(
  environment: CursorResumeCheckpointEnvironment,
  direction: "input" | "output",
  segment: number
): string {
  return `${environmentCursorPrefix(environment)}:${direction}:${segment}`;
}

function parseSegmentNumber(checkpoint: AgentEngineCheckpoint): number {
  const match = checkpoint.lastConfirmedOutput?.cursor.match(/:output:(\d+)$/);
  const parsed = match ? Number(match[1]) : 0;
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw engineError("CURSOR_CHECKPOINT_CURSOR_INVALID", "Cursor checkpoint output cursor is invalid.");
  }
  return parsed;
}

function buildInitialPrompt(
  start: AgentEngineStart,
  allowedToolNames: readonly string[]
): string {
  return canonicalJson({
    protocolVersion: CURSOR_CHECKPOINT_PROTOCOL_VERSION,
    constraints: {
      response: "Return exactly one JSON object with protocolVersion, assistantMessage, and action.",
      actionBatch: "Use action.type=action_batch with 1-6 sequential VDT calls. Never mix user.ask, approval.request, or run.request_finish with another call.",
      final: "Call run.request_finish first. Only after its successful receipt may action.type=final cite that exact finishReceiptId.",
      authority: "Tool calls contain only externalCallId, toolName, and args. Never include run/project/revision/actor/permission/idempotency authority.",
      security: "Do not use Cursor shell, file, Git, web, browser, subagent, project-instruction, plugin, global MCP, or approval capabilities. Use only the returned ActionBatch JSON protocol."
    },
    toolCatalog: {
      hash: start.binding.toolCatalogHash,
      names: allowedToolNames
    },
    delta: {
      type: "initial_context",
      contextHash: start.initialContextHash,
      context: start.initialContext
    }
  });
}

function buildResumePrompt(delta: CursorCheckpointDelta): string {
  return canonicalJson({
    protocolVersion: CURSOR_CHECKPOINT_PROTOCOL_VERSION,
    delta
  });
}

function validateAllowedToolNames(names: readonly string[]): readonly string[] {
  if (names.length === 0 || names.length > 100) {
    throw engineError("CURSOR_CHECKPOINT_CONFIGURATION_INVALID", "allowedToolNames must contain 1-100 tools.");
  }
  const seen = new Set<string>();
  for (const name of names) {
    if (!/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/.test(name) || seen.has(name)) {
      throw engineError("CURSOR_CHECKPOINT_CONFIGURATION_INVALID", `Invalid or duplicate tool name: ${name}.`);
    }
    seen.add(name);
  }
  return Object.freeze([...names]);
}

class CursorResumeCheckpointSession implements AgentRunSession {
  #binding: AgentSessionBinding;
  readonly #transport: CursorResumeCheckpointTransport;
  readonly #environment: CursorResumeCheckpointEnvironment;
  readonly #host: AgentEngineHost;
  readonly #allowedToolNames: readonly string[];
  readonly #now: () => string;
  readonly #idFactory: () => string;
  readonly #maxSegments: number;
  readonly #abortController = new AbortController();
  readonly #hostAbortListener: () => void;
  #pendingTurn: CursorCheckpointTurn | null;
  #pendingDelta: CursorCheckpointDelta | null;
  #lastInput: AgentEngineCheckpoint["lastConfirmedInput"];
  #lastOutput: AgentEngineCheckpoint["lastConfirmedOutput"];
  #activeExchange: AgentEngineCheckpoint["activeExchange"] = null;
  #activeToolCall: AgentEngineCheckpoint["activeToolCall"] = null;
  #finishReceipt: AgentEngineCheckpoint["finishReceipt"] = null;
  #segmentCount: number;
  #firstUserFacingEvent: boolean;
  #paused = false;
  #terminal = false;
  #closed = false;
  #streamActive = false;
  #questionSetId: string | null = null;

  private constructor(input: {
    binding: AgentSessionBinding;
    transport: CursorResumeCheckpointTransport;
    environment: CursorResumeCheckpointEnvironment;
    host: AgentEngineHost;
    allowedToolNames: readonly string[];
    now: () => string;
    idFactory: () => string;
    maxSegments: number;
    pendingTurn?: CursorCheckpointTurn;
    pendingDelta?: CursorCheckpointDelta;
    lastInput: AgentEngineCheckpoint["lastConfirmedInput"];
    lastOutput: AgentEngineCheckpoint["lastConfirmedOutput"];
    activeExchange?: AgentEngineCheckpoint["activeExchange"];
    activeToolCall?: AgentEngineCheckpoint["activeToolCall"];
    finishReceipt?: AgentEngineCheckpoint["finishReceipt"];
    segmentCount: number;
    firstUserFacingEvent: boolean;
  }) {
    this.#binding = input.binding;
    this.#transport = input.transport;
    this.#environment = input.environment;
    this.#host = input.host;
    this.#allowedToolNames = input.allowedToolNames;
    this.#now = input.now;
    this.#idFactory = input.idFactory;
    this.#maxSegments = input.maxSegments;
    this.#pendingTurn = input.pendingTurn ?? null;
    this.#pendingDelta = input.pendingDelta ?? null;
    this.#lastInput = input.lastInput;
    this.#lastOutput = input.lastOutput;
    this.#activeExchange = input.activeExchange ?? null;
    this.#activeToolCall = input.activeToolCall ?? null;
    this.#finishReceipt = input.finishReceipt ?? null;
    this.#segmentCount = input.segmentCount;
    this.#firstUserFacingEvent = input.firstUserFacingEvent;
    this.#hostAbortListener = () => this.#abortController.abort(this.#host.signal.reason);
    if (this.#host.signal.aborted) this.#hostAbortListener();
    else this.#host.signal.addEventListener("abort", this.#hostAbortListener, { once: true });
  }

  static async open(input: {
    start: AgentEngineStart;
    transport: CursorResumeCheckpointTransport;
    environment: CursorResumeCheckpointEnvironment;
    host: AgentEngineHost;
    allowedToolNames: readonly string[];
    now: () => string;
    idFactory: () => string;
    maxSegments: number;
  }): Promise<CursorResumeCheckpointSession> {
    const result = await input.transport.executeSegment({
      mode: "open",
      environment: input.environment,
      model: input.start.binding.modelId,
      prompt: buildInitialPrompt(input.start, input.allowedToolNames),
      signal: input.host.signal
    }, input.allowedToolNames);
    const binding = Object.freeze({ ...input.start.binding, externalSessionId: result.sessionId });
    return new CursorResumeCheckpointSession({
      binding,
      transport: input.transport,
      environment: input.environment,
      host: input.host,
      allowedToolNames: input.allowedToolNames,
      now: input.now,
      idFactory: input.idFactory,
      maxSegments: input.maxSegments,
      pendingTurn: result.turn,
      lastInput: {
        cursor: segmentCursor(input.environment, "input", 1),
        contentHash: result.inputHash
      },
      lastOutput: {
        cursor: segmentCursor(input.environment, "output", 1),
        contentHash: result.outputHash
      },
      activeExchange: {
        exchangeId: "cursor-segment-1",
        stableCallKey: "cursor-segment-1",
        state: "completed"
      },
      segmentCount: 1,
      firstUserFacingEvent: false
    });
  }

  static resume(input: {
    binding: AgentSessionBinding;
    checkpoint: AgentEngineCheckpoint;
    transport: CursorResumeCheckpointTransport;
    environment: CursorResumeCheckpointEnvironment;
    host: AgentEngineHost;
    allowedToolNames: readonly string[];
    now: () => string;
    idFactory: () => string;
    maxSegments: number;
  }): CursorResumeCheckpointSession {
    return new CursorResumeCheckpointSession({
      binding: input.binding,
      transport: input.transport,
      environment: input.environment,
      host: input.host,
      allowedToolNames: input.allowedToolNames,
      now: input.now,
      idFactory: input.idFactory,
      maxSegments: input.maxSegments,
      pendingDelta: {
        type: "recovery",
        checkpoint: {
          checkpointId: input.checkpoint.checkpointId,
          lastConfirmedInput: input.checkpoint.lastConfirmedInput,
          lastConfirmedOutput: input.checkpoint.lastConfirmedOutput,
          finishReceipt: input.checkpoint.finishReceipt
        }
      },
      lastInput: input.checkpoint.lastConfirmedInput,
      lastOutput: input.checkpoint.lastConfirmedOutput,
      activeExchange: input.checkpoint.activeExchange,
      activeToolCall: input.checkpoint.activeToolCall,
      finishReceipt: input.checkpoint.finishReceipt,
      segmentCount: parseSegmentNumber(input.checkpoint),
      firstUserFacingEvent: input.checkpoint.lastConfirmedOutput !== null
    });
  }

  get binding(): AgentSessionBinding {
    return this.#binding;
  }

  events(): AsyncIterable<AgentEngineEvent> {
    if (this.#streamActive) {
      throw engineError("CURSOR_CHECKPOINT_STREAM_ACTIVE", "Cursor checkpoint event stream already has a consumer.");
    }
    this.#streamActive = true;
    return this.#events();
  }

  async submit(input: AgentHumanInput): Promise<void> {
    if (this.#closed || this.#terminal) {
      throw engineError("CURSOR_CHECKPOINT_SESSION_TERMINAL", "Cannot submit to a terminal Cursor checkpoint session.");
    }
    if (!this.#paused || !this.#pendingDelta) {
      throw engineError("CURSOR_CHECKPOINT_SESSION_NOT_PAUSED", "Cursor checkpoint session is not waiting for human input.");
    }
    if (input.type === "user_answer" && this.#questionSetId && input.questionSetId !== this.#questionSetId) {
      throw engineError("CURSOR_CHECKPOINT_QUESTION_STALE", "Answer does not match the active Cursor question checkpoint.");
    }
    this.#pendingDelta = {
      type: "human_checkpoint",
      prior: this.#pendingDelta,
      input: structuredClone(input)
    };
    this.#questionSetId = null;
    this.#paused = false;
  }

  checkpoint(): Promise<AgentEngineCheckpoint> {
    return Promise.resolve(agentEngineCheckpointSchema.parse({
      schemaVersion: 2,
      checkpointId: `cursor-checkpoint-${this.#binding.sessionEpoch}-${this.#idFactory()}`,
      bindingId: this.#binding.bindingId,
      runId: this.#binding.runId,
      sessionEpoch: this.#binding.sessionEpoch,
      externalSessionId: this.#binding.externalSessionId,
      lastConfirmedInput: this.#lastInput,
      lastConfirmedOutput: this.#lastOutput,
      activeExchange: this.#activeExchange,
      activeToolCall: this.#activeToolCall,
      finishReceipt: this.#finishReceipt,
      createdAt: this.#now()
    }));
  }

  async cancel(reason: string): Promise<void> {
    if (!this.#abortController.signal.aborted) this.#abortController.abort(reason);
    this.#terminal = true;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (!this.#abortController.signal.aborted) this.#abortController.abort("session_closed");
    this.#host.signal.removeEventListener("abort", this.#hostAbortListener);
    await this.#environment.close?.();
  }

  async *#events(): AsyncGenerator<AgentEngineEvent> {
    try {
      while (!this.#closed && !this.#terminal && !this.#paused) {
        if (this.#abortController.signal.aborted) return;
        let turn = this.#pendingTurn;
        this.#pendingTurn = null;
        if (!turn) {
          const delta = this.#pendingDelta;
          if (!delta) return;
          if (this.#segmentCount >= this.#maxSegments) {
            this.#terminal = true;
            yield {
              type: "transport_error",
              code: "MAX_CURSOR_CHECKPOINT_SEGMENTS_EXCEEDED",
              message: `Cursor checkpoint session exceeded ${this.#maxSegments} bounded process segments.`,
              retryable: false
            };
            return;
          }
          const nextSegment = this.#segmentCount + 1;
          const exchangeId = `cursor-segment-${nextSegment}`;
          this.#activeExchange = { exchangeId, stableCallKey: exchangeId, state: "in_flight" };
          try {
            const result = await this.#transport.executeSegment({
              mode: "resume",
              environment: this.#environment,
              model: this.#binding.modelId,
              prompt: buildResumePrompt(delta),
              expectedSessionId: this.#binding.externalSessionId!,
              signal: this.#abortController.signal
            }, this.#allowedToolNames);
            if (result.sessionId !== this.#binding.externalSessionId) {
              throw engineError("CURSOR_CHECKPOINT_SESSION_MISMATCH", "Cursor resume returned a different opaque session ID.");
            }
            this.#segmentCount = nextSegment;
            this.#lastInput = {
              cursor: segmentCursor(this.#environment, "input", nextSegment),
              contentHash: result.inputHash
            };
            this.#lastOutput = {
              cursor: segmentCursor(this.#environment, "output", nextSegment),
              contentHash: result.outputHash
            };
            this.#activeExchange = { exchangeId, stableCallKey: exchangeId, state: "completed" };
            this.#pendingDelta = null;
            turn = result.turn;
          } catch (error) {
            this.#activeExchange = { exchangeId, stableCallKey: exchangeId, state: "ambiguous" };
            const code = errorCode(error, "CURSOR_CHECKPOINT_PROCESS_FAILED");
            if (code === "SECURITY_BOUNDARY_BREACH") this.#terminal = true;
            yield {
              type: "transport_error",
              code,
              message: safeErrorMessage(error, "Cursor checkpoint process failed."),
              retryable: code !== "SECURITY_BOUNDARY_BREACH"
            };
            return;
          }
        }

        if (turn.assistantMessage) {
          this.#firstUserFacingEvent = true;
          yield {
            type: "assistant_message",
            messageId: turn.assistantMessage.messageId,
            text: turn.assistantMessage.text
          };
        }

        if (turn.action.type === "final") {
          if (!this.#finishReceipt || turn.action.finishReceiptId !== this.#finishReceipt.receiptId) {
            this.#terminal = true;
            yield {
              type: "transport_error",
              code: "CURSOR_CHECKPOINT_FINAL_WITHOUT_RECEIPT",
              message: "Cursor final did not cite the verified finish receipt from this logical session.",
              retryable: false
            };
            return;
          }
          this.#terminal = true;
          yield {
            type: "final",
            messageId: turn.action.messageId,
            finishReceiptId: turn.action.finishReceiptId,
            text: turn.action.text
          };
          return;
        }

        if (!this.#firstUserFacingEvent) {
          this.#terminal = true;
          yield {
            type: "transport_error",
            code: "CURSOR_CHECKPOINT_FIRST_RESPONSE_MISSING",
            message: "The first Cursor checkpoint response must include agent-authored user-facing prose.",
            retryable: true
          };
          return;
        }

        const execution = await this.#executeBatch(turn.action.batch);
        this.#pendingDelta = {
          type: "tool_results",
          batchId: `cursor-batch-${this.#segmentCount}`,
          results: execution.results
        };
        yield { type: "checkpoint_requested", reason: "cursor_action_batch_completed" };

        if (execution.pause === "waiting_user") {
          const call = execution.pausedCall;
          if (!call || call.toolName !== "user.ask") {
            this.#terminal = true;
            yield {
              type: "transport_error",
              code: "CURSOR_CHECKPOINT_QUESTION_INVALID",
              message: "A waiting-user result must come from the user.ask control tool.",
              retryable: false
            };
            return;
          }
          const parsed = agentQuestionSchema.strict().array().min(1).max(5).safeParse(call.args.questions);
          if (!parsed.success) {
            this.#terminal = true;
            yield {
              type: "transport_error",
              code: "CURSOR_CHECKPOINT_QUESTION_INVALID",
              message: "user.ask did not contain a valid VDT question checkpoint.",
              retryable: false
            };
            return;
          }
          const questionSetId = `cursor-question-${call.externalCallId}`;
          this.#questionSetId = questionSetId;
          this.#paused = true;
          yield {
            type: "question",
            messageId: questionSetId,
            questionSetId,
            questions: parsed.data
          };
          return;
        }
        if (execution.pause === "waiting_approval") {
          this.#paused = true;
          return;
        }
      }
    } finally {
      this.#streamActive = false;
    }
  }

  async #executeBatch(batch: Extract<CursorCheckpointTurn, { action: { type: "action_batch" } }>["action"]["batch"]): Promise<{
    results: readonly VdtGatewayToolResult[];
    pause: "waiting_user" | "waiting_approval" | null;
    pausedCall: VdtGatewayToolCall | null;
  }> {
    const results: VdtGatewayToolResult[] = [];
    let pause: "waiting_user" | "waiting_approval" | null = null;
    let pausedCall: VdtGatewayToolCall | null = null;
    for (const call of batch.calls) {
      this.#activeToolCall = {
        externalCallId: call.externalCallId,
        toolName: call.toolName,
        state: "in_flight"
      };
      let result: VdtGatewayToolResult;
      try {
        const raw = await this.#host.executeTool(call);
        const parsed = vdtGatewayToolResultSchema.safeParse(raw);
        if (
          !parsed.success
          || parsed.data.externalCallId !== call.externalCallId
          || parsed.data.toolName !== call.toolName
        ) {
          throw engineError(
            "CURSOR_CHECKPOINT_GATEWAY_RESULT_INVALID",
            "VDT Tool Gateway result does not match the reserved Cursor checkpoint call."
          );
        }
        result = parsed.data;
        this.#activeToolCall = {
          externalCallId: call.externalCallId,
          toolName: call.toolName,
          state: result.status === "failed" ? "failed" : "completed"
        };
      } catch (error) {
        this.#activeToolCall = {
          externalCallId: call.externalCallId,
          toolName: call.toolName,
          state: "ambiguous"
        };
        throw error;
      }
      results.push(result);
      if (call.toolName === "run.request_finish" && (result.status === "succeeded" || result.status === "replayed")) {
        const payload = isRecord(result.payload) ? result.payload : {};
        if (typeof payload.receiptId === "string" && SAFE_ID.test(payload.receiptId) && typeof payload.receiptHash === "string" && isCursorCheckpointHash(payload.receiptHash)) {
          this.#finishReceipt = {
            receiptId: payload.receiptId,
            state: "verified",
            receiptHash: payload.receiptHash
          };
        }
      }
      if (result.status === "waiting_user" || result.status === "waiting_approval") {
        pause = result.status;
        pausedCall = call;
        break;
      }
      if (result.status === "failed") break;
    }
    this.#activeToolCall = null;
    return { results: Object.freeze(results), pause, pausedCall };
  }
}

/** Default-off ExternalCliAgentEngine using Cursor's opaque `--resume` session
 * across bounded ActionBatch checkpoints. It is never a public or automatic
 * fallback and always reports unverified isolation until separately qualified. */
export class CursorResumeCheckpointEngine implements ExternalCliAgentEngine {
  readonly capability: CursorCheckpointCapability;
  readonly #options: CursorResumeCheckpointEngineOptions;
  readonly #allowedToolNames: readonly string[];
  readonly #now: () => string;
  readonly #idFactory: () => string;
  readonly #maxSegments: number;

  constructor(options: CursorResumeCheckpointEngineOptions) {
    this.#allowedToolNames = validateAllowedToolNames(options.allowedToolNames);
    this.#maxSegments = options.maxSegments ?? MAX_SEGMENTS;
    if (!Number.isSafeInteger(this.#maxSegments) || this.#maxSegments < 1 || this.#maxSegments > 500) {
      throw engineError("CURSOR_CHECKPOINT_CONFIGURATION_INVALID", "maxSegments must be between 1 and 500.");
    }
    this.#options = options;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#idFactory = options.idFactory ?? randomUUID;
    this.capability = buildCapability(options);
  }

  async openSession(startInput: AgentEngineStart, host: AgentEngineHost): Promise<AgentRunSession> {
    this.#assertEnabled();
    host.signal.throwIfAborted();
    const binding = assertBinding(startInput.binding, this.capability);
    if (binding.externalSessionId !== null) {
      throw engineError("CURSOR_CHECKPOINT_BINDING_ALREADY_OPENED", "New Cursor checkpoint binding already has a session ID.");
    }
    if (!SAFE_HASH.test(startInput.initialContextHash) || hashJson(startInput.initialContext) !== startInput.initialContextHash) {
      throw engineError("CURSOR_CHECKPOINT_INITIAL_CONTEXT_MISMATCH", "Initial context does not match its immutable hash.");
    }
    const start = { ...startInput, binding };
    const environment = await this.#options.sessionEnvironmentFactory({
      binding: structuredClone(binding),
      recovery: false,
      signal: host.signal
    });
    try {
      return await CursorResumeCheckpointSession.open({
        start,
        transport: this.#options.transport,
        environment,
        host,
        allowedToolNames: this.#allowedToolNames,
        now: this.#now,
        idFactory: this.#idFactory,
        maxSegments: this.#maxSegments
      });
    } catch (error) {
      await environment.close?.();
      throw error;
    }
  }

  async resumeSession(checkpointInput: AgentEngineCheckpoint, host: AgentEngineHost): Promise<AgentRunSession> {
    this.#assertEnabled();
    host.signal.throwIfAborted();
    const checkpoint = agentEngineCheckpointSchema.parse(checkpointInput);
    const binding = assertBinding(await this.#options.resolveBinding(checkpoint), this.capability);
    assertCheckpointBinding(checkpoint, binding);
    const environment = await this.#options.sessionEnvironmentFactory({
      binding: structuredClone(binding),
      recovery: true,
      signal: host.signal
    });
    try {
      assertCheckpointEnvironment(checkpoint, environment);
      return CursorResumeCheckpointSession.resume({
        binding,
        checkpoint,
        transport: this.#options.transport,
        environment,
        host,
        allowedToolNames: this.#allowedToolNames,
        now: this.#now,
        idFactory: this.#idFactory,
        maxSegments: this.#maxSegments
      });
    } catch (error) {
      await environment.close?.();
      throw error;
    }
  }

  #assertEnabled(): void {
    if (this.#options.enableUnverifiedCanary === true) return;
    throw engineError(
      "EXTERNAL_ENGINE_NOT_QUALIFIED",
      "Cursor checkpoint/resume is an unverified default-off canary and has no public fallback authority."
    );
  }
}
