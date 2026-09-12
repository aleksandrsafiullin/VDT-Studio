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
import type { CheckpointTurn } from "./checkpoint-turn";
import { SAFE_HASH, environmentFingerprint } from "./checkpoint-transport-common";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const MAX_SEGMENTS = 240;

export interface ResumeCheckpointProviderDescriptor {
  readonly engineId: string;
  readonly engineAdapterId: string;
  readonly backendId: string;
  readonly cliName: string;
  readonly sessionSlug: string;
  readonly protocolVersion: string;
  readonly turnProtocolVersion: string;
  readonly errorPrefix: string;
  readonly cliLabel: string;
  readonly supportsUsageMetrics: boolean;
  readonly securityConstraint: string;
}

export interface ResumeCheckpointEnvironment {
  readonly environmentId: string;
  readonly privateWorkspacePath: string;
  readonly privateStatePath: string;
  readonly trustedSubscriptionAuthHomePath?: string;
  readonly preauthorizeEmptyWorkspace?: boolean;
  readonly forbiddenRoots: readonly string[];
  readonly credentialEnvironment?: readonly { readonly name: string; readonly value: string }[];
  close?(): void | Promise<void>;
}

export interface ResumeCheckpointSegmentInput {
  readonly mode: "open" | "resume";
  readonly environment: ResumeCheckpointEnvironment;
  readonly model: string;
  readonly prompt: string;
  readonly expectedSessionId?: string;
  readonly signal: AbortSignal;
}

export interface ResumeCheckpointSegmentResult {
  readonly sessionId: string;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly turn: CheckpointTurn;
}

export interface ResumeCheckpointTransport {
  readonly validatedCliVersion: string;
  executeSegment(
    input: ResumeCheckpointSegmentInput,
    allowedToolNames: readonly string[]
  ): Promise<ResumeCheckpointSegmentResult>;
}

export interface ResumeCheckpointEnvironmentFactoryInput {
  readonly binding: AgentSessionBinding;
  readonly recovery: boolean;
  readonly signal: AbortSignal;
}

export type ResumeCheckpointEnvironmentFactory = (
  input: ResumeCheckpointEnvironmentFactoryInput
) => ResumeCheckpointEnvironment | Promise<ResumeCheckpointEnvironment>;

export interface ResumeCheckpointEngineOptions {
  readonly descriptor: ResumeCheckpointProviderDescriptor;
  readonly transport: ResumeCheckpointTransport;
  readonly cliVersion: string;
  readonly toolCatalogHash: string;
  readonly allowedToolNames: readonly string[];
  readonly sessionEnvironmentFactory: ResumeCheckpointEnvironmentFactory;
  readonly resolveBinding: (checkpoint: AgentEngineCheckpoint) => AgentSessionBinding | Promise<AgentSessionBinding>;
  readonly enableUnverifiedCanary?: boolean;
  readonly now?: () => string;
  readonly idFactory?: () => string;
  readonly maxSegments?: number;
  readonly isCheckpointHash?: (value: string) => boolean;
}

type CheckpointCapability = Extract<AgentCapabilityProfile, { executionProfile: "external_cli_agent" }>;

type CheckpointDelta =
  | {
      readonly type: "tool_results";
      readonly batchId: string;
      readonly results: readonly VdtGatewayToolResult[];
    }
  | {
      readonly type: "human_checkpoint";
      readonly prior: CheckpointDelta;
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

function engineError(prefix: string, code: string, message: string, details: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { code: `${prefix}_${code}`.replace(/__/g, "_"), ...details });
}

function prefixedError(descriptor: ResumeCheckpointProviderDescriptor, code: string, message: string, details?: Record<string, unknown>): Error {
  return engineError(descriptor.errorPrefix, code, message, details);
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
    if (!Number.isFinite(value)) throw new Error("JSON contains a non-finite number.");
    return value;
  }
  if (!isRecord(value)) throw new Error("JSON value is unsupported.");
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("JSON objects must use a plain prototype.");
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
  if (serialized === undefined) throw new Error("JSON value is not serializable.");
  return serialized;
}

function toGatewayWireResult(value: VdtGatewayToolResult, descriptor: ResumeCheckpointProviderDescriptor): VdtGatewayToolResult {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw prefixedError(descriptor, "GATEWAY_RESULT_INVALID", "VDT Tool Gateway result is not JSON-serializable.");
  }
  const parsed = vdtGatewayToolResultSchema.safeParse(JSON.parse(serialized) as unknown);
  if (!parsed.success) {
    throw prefixedError(descriptor, "GATEWAY_RESULT_INVALID", "VDT Tool Gateway result changed during wire normalization.");
  }
  return parsed.data;
}

function hashText(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function hashJson(value: unknown): string {
  return hashText(canonicalJson(value));
}

function buildCapability(options: ResumeCheckpointEngineOptions): CheckpointCapability {
  const { descriptor, cliVersion, transport, toolCatalogHash } = options;
  if (!cliVersion.trim() || cliVersion.length > 120 || transport.validatedCliVersion !== cliVersion) {
    throw prefixedError(descriptor, "VERSION_MISMATCH", `Engine and transport must pin the same exact trusted ${descriptor.cliLabel} CLI version.`);
  }
  if (!SAFE_HASH.test(toolCatalogHash)) {
    throw prefixedError(descriptor, "CONFIGURATION_INVALID", "toolCatalogHash must be a sha256 hash.");
  }
  return Object.freeze({
    schemaVersion: 1,
    executionProfile: "external_cli_agent",
    engineId: descriptor.engineId,
    engineAdapterId: descriptor.engineAdapterId,
    backendId: descriptor.backendId,
    cli: Object.freeze({ name: descriptor.cliName, version: cliVersion }),
    protocolVersion: descriptor.protocolVersion,
    sessionStrategy: "checkpoint_resume",
    toolCatalogHash,
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
    supportsUsageMetrics: descriptor.supportsUsageMetrics
  });
}

export function resumeCheckpointCapabilityHash(capability: CheckpointCapability): string {
  return hashJson(capability);
}

function assertBinding(bindingInput: AgentSessionBinding, capability: CheckpointCapability, descriptor: ResumeCheckpointProviderDescriptor): AgentSessionBinding {
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
    || binding.capabilityProfileHash !== resumeCheckpointCapabilityHash(capability)
  ) {
    throw prefixedError(descriptor, "BINDING_MISMATCH", `Agent session binding does not match the ${descriptor.cliLabel} checkpoint capability.`);
  }
  return binding;
}

function assertCheckpointBinding(checkpoint: AgentEngineCheckpoint, binding: AgentSessionBinding, descriptor: ResumeCheckpointProviderDescriptor): void {
  if (
    checkpoint.bindingId !== binding.bindingId
    || checkpoint.runId !== binding.runId
    || checkpoint.sessionEpoch !== binding.sessionEpoch
    || checkpoint.externalSessionId !== binding.externalSessionId
    || checkpoint.externalSessionId === null
  ) {
    throw prefixedError(descriptor, "BINDING_MISMATCH", `Checkpoint does not match the immutable ${descriptor.cliLabel} session binding.`);
  }
  if (checkpoint.activeExchange?.state === "ambiguous" || checkpoint.activeExchange?.state === "in_flight") {
    throw prefixedError(descriptor, "AMBIGUOUS_EXCHANGE", `An ambiguous ${descriptor.cliLabel} process exchange cannot be replayed without a stable terminal receipt.`);
  }
}

function environmentPrefix(environment: ResumeCheckpointEnvironment, descriptor: ResumeCheckpointProviderDescriptor): string {
  const slug = descriptor.cliName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return `${slug}-env-${environmentFingerprint(environment.environmentId, descriptor.errorPrefix).slice("sha256:".length, 39)}`;
}

function assertCheckpointEnvironment(
  checkpoint: AgentEngineCheckpoint,
  environment: ResumeCheckpointEnvironment,
  descriptor: ResumeCheckpointProviderDescriptor
): void {
  const prefix = environmentPrefix(environment, descriptor);
  if (!checkpoint.lastConfirmedInput?.cursor.startsWith(`${prefix}:`)) {
    throw prefixedError(
      descriptor,
      "ENVIRONMENT_MISMATCH",
      `Resume environment does not match the private environment that owns the opaque ${descriptor.cliLabel} session.`
    );
  }
}

function segmentCursor(
  environment: ResumeCheckpointEnvironment,
  descriptor: ResumeCheckpointProviderDescriptor,
  direction: "input" | "output",
  segment: number
): string {
  return `${environmentPrefix(environment, descriptor)}:${direction}:${segment}`;
}

function parseSegmentNumber(checkpoint: AgentEngineCheckpoint, descriptor: ResumeCheckpointProviderDescriptor): number {
  const match = checkpoint.lastConfirmedOutput?.cursor.match(/:output:(\d+)$/);
  const parsed = match ? Number(match[1]) : 0;
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw prefixedError(descriptor, "CURSOR_INVALID", "Checkpoint output cursor is invalid.");
  }
  return parsed;
}

const SHARED_PROMPT_RULES = Object.freeze({
  openingSummary: "The first user-facing assistant message must restate the accepted task in the user's language and outline the intended plan in 3-6 short steps before or alongside the first tool batch.",
  research: "When the domain, KPI, or decomposition boundary is unfamiliar, or the user asks for standards/best practice, use research.search_web (purpose standards, best_practices, process_components, benchmarks, or regulations) before building. Respect options.researchMode from the brief: never call research.search_web when it is off. Surface sources used; never fabricate citations.",
  questions: "Ask only for missing data, a required business choice, scope conflict, ambiguous logic, low confidence, or formula ambiguity. When one of those applies, use user.ask with 1-5 precise questions. Prefer single_choice/multi_choice with concrete labelled options and always leave an escape hatch via freeTextAllowed:true or an option with requiresFreeText:true. Use fields/revealsFields for follow-up numbers. Mark required honestly and give a short reason.",
  fullCatalog: "Use the whole tool catalog — skills, excavation, research, validation, calculation, layout, repair, memory — not only vdt.* mutations."
});

function buildInitialPrompt(
  descriptor: ResumeCheckpointProviderDescriptor,
  start: AgentEngineStart,
  allowedToolNames: readonly string[]
): string {
  return canonicalJson({
    protocolVersion: descriptor.turnProtocolVersion,
    constraints: {
      response: "Return exactly one JSON object with protocolVersion, assistantMessage, and action.",
      actionBatch: "Use action.type=action_batch with 1-6 sequential VDT calls. Never mix user.ask, approval.request, or run.request_finish with another call.",
      final: "Call run.request_finish first. Only after its successful receipt may action.type=final cite that exact finishReceiptId.",
      authority: "Tool calls contain only externalCallId, toolName, and args. Never include run/project/revision/actor/permission/idempotency authority.",
      security: descriptor.securityConstraint,
      openingSummary: SHARED_PROMPT_RULES.openingSummary,
      research: SHARED_PROMPT_RULES.research,
      questions: SHARED_PROMPT_RULES.questions,
      fullCatalog: SHARED_PROMPT_RULES.fullCatalog
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

function buildResumePrompt(descriptor: ResumeCheckpointProviderDescriptor, delta: CheckpointDelta): string {
  return canonicalJson({
    protocolVersion: descriptor.turnProtocolVersion,
    delta
  });
}

function validateAllowedToolNames(names: readonly string[], descriptor: ResumeCheckpointProviderDescriptor): readonly string[] {
  if (names.length === 0 || names.length > 100) {
    throw prefixedError(descriptor, "CONFIGURATION_INVALID", "allowedToolNames must contain 1-100 tools.");
  }
  const seen = new Set<string>();
  for (const name of names) {
    if (!/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/.test(name) || seen.has(name)) {
      throw prefixedError(descriptor, "CONFIGURATION_INVALID", `Invalid or duplicate tool name: ${name}.`);
    }
    seen.add(name);
  }
  return Object.freeze([...names]);
}

class ResumeCheckpointSession implements AgentRunSession {
  #binding: AgentSessionBinding;
  readonly #descriptor: ResumeCheckpointProviderDescriptor;
  readonly #transport: ResumeCheckpointTransport;
  readonly #environment: ResumeCheckpointEnvironment;
  readonly #host: AgentEngineHost;
  readonly #allowedToolNames: readonly string[];
  readonly #now: () => string;
  readonly #idFactory: () => string;
  readonly #maxSegments: number;
  readonly #isCheckpointHash: (value: string) => boolean;
  readonly #abortController = new AbortController();
  readonly #hostAbortListener: () => void;
  #pendingTurn: CheckpointTurn | null;
  #pendingDelta: CheckpointDelta | null;
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
    descriptor: ResumeCheckpointProviderDescriptor;
    binding: AgentSessionBinding;
    transport: ResumeCheckpointTransport;
    environment: ResumeCheckpointEnvironment;
    host: AgentEngineHost;
    allowedToolNames: readonly string[];
    now: () => string;
    idFactory: () => string;
    maxSegments: number;
    isCheckpointHash: (value: string) => boolean;
    pendingTurn?: CheckpointTurn;
    pendingDelta?: CheckpointDelta;
    lastInput: AgentEngineCheckpoint["lastConfirmedInput"];
    lastOutput: AgentEngineCheckpoint["lastConfirmedOutput"];
    activeExchange?: AgentEngineCheckpoint["activeExchange"];
    activeToolCall?: AgentEngineCheckpoint["activeToolCall"];
    finishReceipt?: AgentEngineCheckpoint["finishReceipt"];
    segmentCount: number;
    firstUserFacingEvent: boolean;
  }) {
    this.#descriptor = input.descriptor;
    this.#binding = input.binding;
    this.#transport = input.transport;
    this.#environment = input.environment;
    this.#host = input.host;
    this.#allowedToolNames = input.allowedToolNames;
    this.#now = input.now;
    this.#idFactory = input.idFactory;
    this.#maxSegments = input.maxSegments;
    this.#isCheckpointHash = input.isCheckpointHash;
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
    descriptor: ResumeCheckpointProviderDescriptor;
    start: AgentEngineStart;
    transport: ResumeCheckpointTransport;
    environment: ResumeCheckpointEnvironment;
    host: AgentEngineHost;
    allowedToolNames: readonly string[];
    now: () => string;
    idFactory: () => string;
    maxSegments: number;
    isCheckpointHash: (value: string) => boolean;
  }): Promise<ResumeCheckpointSession> {
    const result = await input.transport.executeSegment({
      mode: "open",
      environment: input.environment,
      model: input.start.binding.modelId,
      prompt: buildInitialPrompt(input.descriptor, input.start, input.allowedToolNames),
      signal: input.host.signal
    }, input.allowedToolNames);
    const binding = Object.freeze({ ...input.start.binding, externalSessionId: result.sessionId });
    return new ResumeCheckpointSession({
      descriptor: input.descriptor,
      binding,
      transport: input.transport,
      environment: input.environment,
      host: input.host,
      allowedToolNames: input.allowedToolNames,
      now: input.now,
      idFactory: input.idFactory,
      maxSegments: input.maxSegments,
      isCheckpointHash: input.isCheckpointHash,
      pendingTurn: result.turn,
      lastInput: {
        cursor: segmentCursor(input.environment, input.descriptor, "input", 1),
        contentHash: result.inputHash
      },
      lastOutput: {
        cursor: segmentCursor(input.environment, input.descriptor, "output", 1),
        contentHash: result.outputHash
      },
      activeExchange: {
        exchangeId: `${input.descriptor.cliName}-segment-1`,
        stableCallKey: `${input.descriptor.cliName}-segment-1`,
        state: "completed"
      },
      segmentCount: 1,
      firstUserFacingEvent: false
    });
  }

  static resume(input: {
    descriptor: ResumeCheckpointProviderDescriptor;
    binding: AgentSessionBinding;
    checkpoint: AgentEngineCheckpoint;
    transport: ResumeCheckpointTransport;
    environment: ResumeCheckpointEnvironment;
    host: AgentEngineHost;
    allowedToolNames: readonly string[];
    now: () => string;
    idFactory: () => string;
    maxSegments: number;
    isCheckpointHash: (value: string) => boolean;
  }): ResumeCheckpointSession {
    return new ResumeCheckpointSession({
      descriptor: input.descriptor,
      binding: input.binding,
      transport: input.transport,
      environment: input.environment,
      host: input.host,
      allowedToolNames: input.allowedToolNames,
      now: input.now,
      idFactory: input.idFactory,
      maxSegments: input.maxSegments,
      isCheckpointHash: input.isCheckpointHash,
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
      segmentCount: parseSegmentNumber(input.checkpoint, input.descriptor),
      firstUserFacingEvent: input.checkpoint.lastConfirmedOutput !== null
    });
  }

  get binding(): AgentSessionBinding {
    return this.#binding;
  }

  events(): AsyncIterable<AgentEngineEvent> {
    if (this.#streamActive) {
      throw prefixedError(this.#descriptor, "STREAM_ACTIVE", `${this.#descriptor.cliLabel} checkpoint event stream already has a consumer.`);
    }
    this.#streamActive = true;
    return this.#events();
  }

  async submit(input: AgentHumanInput): Promise<void> {
    if (this.#closed || this.#terminal) {
      throw prefixedError(this.#descriptor, "SESSION_TERMINAL", `Cannot submit to a terminal ${this.#descriptor.cliLabel} checkpoint session.`);
    }
    if (!this.#paused || !this.#pendingDelta) {
      throw prefixedError(this.#descriptor, "SESSION_NOT_PAUSED", `${this.#descriptor.cliLabel} checkpoint session is not waiting for human input.`);
    }
    if (input.type === "user_answer" && this.#questionSetId && input.questionSetId !== this.#questionSetId) {
      throw prefixedError(this.#descriptor, "QUESTION_STALE", `Answer does not match the active ${this.#descriptor.cliLabel} question checkpoint.`);
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
    const slug = this.#descriptor.cliName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    return Promise.resolve(agentEngineCheckpointSchema.parse({
      schemaVersion: 2,
      checkpointId: `${slug}-checkpoint-${this.#binding.sessionEpoch}-${this.#idFactory()}`,
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
    const d = this.#descriptor;
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
              code: `MAX_${d.errorPrefix}_SEGMENTS_EXCEEDED`,
              message: `${d.cliLabel} checkpoint session exceeded ${this.#maxSegments} bounded process segments.`,
              retryable: false
            };
            return;
          }
          const nextSegment = this.#segmentCount + 1;
          const exchangeId = `${d.cliName}-segment-${nextSegment}`;
          this.#activeExchange = { exchangeId, stableCallKey: exchangeId, state: "in_flight" };
          try {
            const result = await this.#transport.executeSegment({
              mode: "resume",
              environment: this.#environment,
              model: this.#binding.modelId,
              prompt: buildResumePrompt(d, delta),
              expectedSessionId: this.#binding.externalSessionId!,
              signal: this.#abortController.signal
            }, this.#allowedToolNames);
            if (result.sessionId !== this.#binding.externalSessionId) {
              throw prefixedError(d, "SESSION_MISMATCH", `${d.cliLabel} resume returned a different opaque session ID.`);
            }
            this.#segmentCount = nextSegment;
            this.#lastInput = {
              cursor: segmentCursor(this.#environment, d, "input", nextSegment),
              contentHash: result.inputHash
            };
            this.#lastOutput = {
              cursor: segmentCursor(this.#environment, d, "output", nextSegment),
              contentHash: result.outputHash
            };
            this.#activeExchange = { exchangeId, stableCallKey: exchangeId, state: "completed" };
            this.#pendingDelta = null;
            turn = result.turn;
          } catch (error) {
            this.#activeExchange = { exchangeId, stableCallKey: exchangeId, state: "ambiguous" };
            const code = errorCode(error, `${d.errorPrefix}_PROCESS_FAILED`);
            if (code === "SECURITY_BOUNDARY_BREACH") this.#terminal = true;
            yield {
              type: "transport_error",
              code,
              message: safeErrorMessage(error, `${d.cliLabel} checkpoint process failed.`),
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
              code: `${d.errorPrefix}_FINAL_WITHOUT_RECEIPT`,
              message: `${d.cliLabel} final did not cite the verified finish receipt from this logical session.`,
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
            code: `${d.errorPrefix}_FIRST_RESPONSE_MISSING`,
            message: `The first ${d.cliLabel} checkpoint response must include agent-authored user-facing prose.`,
            retryable: true
          };
          return;
        }

        const execution = await this.#executeBatch(turn.action.batch);
        this.#pendingDelta = {
          type: "tool_results",
          batchId: `${d.cliName}-batch-${this.#segmentCount}`,
          results: execution.results
        };
        yield { type: "checkpoint_requested", reason: `${d.sessionSlug}_action_batch_completed` };

        if (execution.pause === "waiting_user") {
          const call = execution.pausedCall;
          if (!call || call.toolName !== "user.ask") {
            this.#terminal = true;
            yield {
              type: "transport_error",
              code: `${d.errorPrefix}_QUESTION_INVALID`,
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
              code: `${d.errorPrefix}_QUESTION_INVALID`,
              message: "user.ask did not contain a valid VDT question checkpoint.",
              retryable: false
            };
            return;
          }
          const questionSetId = `${d.sessionSlug}-question-${call.externalCallId}`;
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

  async #executeBatch(batch: Extract<CheckpointTurn, { action: { type: "action_batch" } }>["action"]["batch"]): Promise<{
    results: readonly VdtGatewayToolResult[];
    pause: "waiting_user" | "waiting_approval" | null;
    pausedCall: VdtGatewayToolCall | null;
  }> {
    const d = this.#descriptor;
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
          throw prefixedError(d, "GATEWAY_RESULT_INVALID", `VDT Tool Gateway result does not match the reserved ${d.cliLabel} checkpoint call.`);
        }
        result = toGatewayWireResult(parsed.data, d);
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
        if (
          typeof payload.receiptId === "string"
          && SAFE_ID.test(payload.receiptId)
          && typeof payload.receiptHash === "string"
          && this.#isCheckpointHash(payload.receiptHash)
        ) {
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

export class ResumeCheckpointEngine implements ExternalCliAgentEngine {
  readonly capability: CheckpointCapability;
  readonly #options: ResumeCheckpointEngineOptions;
  readonly #descriptor: ResumeCheckpointProviderDescriptor;
  readonly #allowedToolNames: readonly string[];
  readonly #now: () => string;
  readonly #idFactory: () => string;
  readonly #maxSegments: number;
  readonly #isCheckpointHash: (value: string) => boolean;

  constructor(options: ResumeCheckpointEngineOptions) {
    this.#descriptor = options.descriptor;
    this.#allowedToolNames = validateAllowedToolNames(options.allowedToolNames, options.descriptor);
    this.#maxSegments = options.maxSegments ?? MAX_SEGMENTS;
    if (!Number.isSafeInteger(this.#maxSegments) || this.#maxSegments < 1 || this.#maxSegments > 500) {
      throw prefixedError(options.descriptor, "CONFIGURATION_INVALID", "maxSegments must be between 1 and 500.");
    }
    this.#options = options;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#idFactory = options.idFactory ?? randomUUID;
    this.#isCheckpointHash = options.isCheckpointHash ?? ((value) => SAFE_HASH.test(value));
    this.capability = buildCapability(options);
  }

  async openSession(startInput: AgentEngineStart, host: AgentEngineHost): Promise<AgentRunSession> {
    this.#assertEnabled();
    host.signal.throwIfAborted();
    const binding = assertBinding(startInput.binding, this.capability, this.#descriptor);
    if (binding.externalSessionId !== null) {
      throw prefixedError(this.#descriptor, "BINDING_ALREADY_OPENED", `New ${this.#descriptor.cliLabel} checkpoint binding already has a session ID.`);
    }
    if (!SAFE_HASH.test(startInput.initialContextHash) || hashJson(startInput.initialContext) !== startInput.initialContextHash) {
      throw prefixedError(this.#descriptor, "INITIAL_CONTEXT_MISMATCH", "Initial context does not match its immutable hash.");
    }
    const start = { ...startInput, binding };
    const environment = await this.#options.sessionEnvironmentFactory({
      binding: structuredClone(binding),
      recovery: false,
      signal: host.signal
    });
    try {
      return await ResumeCheckpointSession.open({
        descriptor: this.#descriptor,
        start,
        transport: this.#options.transport,
        environment,
        host,
        allowedToolNames: this.#allowedToolNames,
        now: this.#now,
        idFactory: this.#idFactory,
        maxSegments: this.#maxSegments,
        isCheckpointHash: this.#isCheckpointHash
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
    const binding = assertBinding(await this.#options.resolveBinding(checkpoint), this.capability, this.#descriptor);
    assertCheckpointBinding(checkpoint, binding, this.#descriptor);
    const environment = await this.#options.sessionEnvironmentFactory({
      binding: structuredClone(binding),
      recovery: true,
      signal: host.signal
    });
    try {
      assertCheckpointEnvironment(checkpoint, environment, this.#descriptor);
      return ResumeCheckpointSession.resume({
        descriptor: this.#descriptor,
        binding,
        checkpoint,
        transport: this.#options.transport,
        environment,
        host,
        allowedToolNames: this.#allowedToolNames,
        now: this.#now,
        idFactory: this.#idFactory,
        maxSegments: this.#maxSegments,
        isCheckpointHash: this.#isCheckpointHash
      });
    } catch (error) {
      await environment.close?.();
      throw error;
    }
  }

  #assertEnabled(): void {
    if (this.#options.enableUnverifiedCanary === true) return;
    throw Object.assign(
      new Error(`${this.#descriptor.cliLabel} checkpoint/resume is an unverified default-off canary and has no public fallback authority.`),
      { code: "EXTERNAL_ENGINE_NOT_QUALIFIED" }
    );
  }
}
