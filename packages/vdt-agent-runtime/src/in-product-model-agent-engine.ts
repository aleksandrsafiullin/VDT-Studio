import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  agentActionBatchSchema,
  agentEngineCheckpointSchema,
  agentSessionBindingSchema,
  type AgentActionBatch,
  type AgentCapabilityProfile,
  type AgentEngineCheckpoint,
  type AgentEngineEvent,
  type AgentEngineHost,
  type AgentEngineStart,
  type AgentHumanInput,
  type AgentRunSession,
  type AgentSessionBinding,
  type InProductModelAgentEngine
} from "./agent-execution-contracts";
import { agentQuestionSchema } from "./schemas/agent-event";

const safeId = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const MAX_MODEL_AGENT_SESSION_STATE_BYTES = 16 * 1024;

const assistantMessageSchema = z.object({
  messageId: safeId,
  text: z.string().trim().min(1).max(8_000)
}).strict();

export const modelAgentStructuredTurnSchema = z.object({
  turnId: safeId,
  /** Server-private bounded semantic checkpoint for stateless structured HTTP
   * transports. It is fed only to the next provider turn and is never emitted
   * as a public/durable run event. */
  sessionState: z.string().trim().min(1).max(MAX_MODEL_AGENT_SESSION_STATE_BYTES).refine(
    (value) => new TextEncoder().encode(value).byteLength <= MAX_MODEL_AGENT_SESSION_STATE_BYTES,
    { message: `sessionState must be at most ${MAX_MODEL_AGENT_SESSION_STATE_BYTES} UTF-8 bytes` }
  ),
  assistantMessage: assistantMessageSchema.nullable(),
  action: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("action_batch"),
      batch: agentActionBatchSchema
    }).strict(),
    z.object({
      type: z.literal("question"),
      messageId: safeId,
      questionSetId: safeId,
      questions: z.array(agentQuestionSchema.strict()).min(1).max(5)
    }).strict(),
    z.object({
      type: z.literal("final"),
      messageId: safeId,
      finishReceiptId: safeId,
      text: z.string().trim().min(1).max(8_000)
    }).strict()
  ])
}).strict();

export type ModelAgentStructuredTurn = z.infer<typeof modelAgentStructuredTurnSchema>;

export type ModelAgentCheckpointDelta =
  | {
      type: "initial_context";
      context: Readonly<Record<string, unknown>>;
      contextHash: string;
    }
  | {
      type: "tool_results";
      batchId: string;
      results: readonly Readonly<Record<string, unknown>>[];
    }
  | {
      type: "human_input";
      input: AgentHumanInput;
    }
  | {
      type: "manual_reconciliation";
      batchId: string;
      results: readonly Readonly<Record<string, unknown>>[];
      reconciliation: Readonly<Record<string, unknown>>;
    }
  | {
      type: "recovery";
      checkpoint: AgentEngineCheckpoint;
    };

export type ModelAgentTurnDelta =
  | ModelAgentCheckpointDelta
  | {
      /** A user instruction accepted while a provider turn was in flight is
       * delivered with the next bounded checkpoint delta. The prior tool
       * result/reconciliation is retained instead of being overwritten. */
      type: "checkpoint_inputs";
      checkpointDelta: ModelAgentCheckpointDelta;
      inputs: readonly AgentHumanInput[];
    }
  | {
      /** Inputs that arrived while a provider was producing a would-be final
       * are sent through the same session before that final can be durable. */
      type: "human_inputs";
      inputs: readonly AgentHumanInput[];
    };

export interface ModelAgentTurnRequest {
  binding: AgentSessionBinding;
  exchangeId: string;
  stableCallKey: string;
  previousCursor: string | null;
  delta: ModelAgentTurnDelta;
  responseSchema: typeof modelAgentStructuredTurnSchema;
  signal: AbortSignal;
}

export interface ModelAgentTurnResponse {
  cursor: string;
  output: unknown;
  usage?: Readonly<Record<string, number | null>> | undefined;
}

/** HTTP, local inference, or another structured-turn backend. It receives the
 * initial project context once; subsequent calls receive only the prior tool
 * results, human input, or recovery checkpoint. */
export interface ModelAgentTurnTransport {
  completeTurn(request: ModelAgentTurnRequest): Promise<ModelAgentTurnResponse>;
}

export interface StructuredInProductModelAgentEngineOptions {
  capability: Extract<AgentCapabilityProfile, { executionProfile: "model_agent" }>;
  transport: ModelAgentTurnTransport;
  maxTurns?: number | undefined;
  now?: (() => string) | undefined;
  idFactory?: (() => string) | undefined;
  resolveBinding?: ((checkpoint: AgentEngineCheckpoint) => Promise<AgentSessionBinding> | AgentSessionBinding) | undefined;
}

export class StructuredInProductModelAgentEngine implements InProductModelAgentEngine {
  readonly capability: Extract<AgentCapabilityProfile, { executionProfile: "model_agent" }>;
  private readonly transport: ModelAgentTurnTransport;
  private readonly maxTurns: number;
  private readonly now: () => string;
  private readonly idFactory: () => string;
  private readonly resolveBinding?: StructuredInProductModelAgentEngineOptions["resolveBinding"];
  private lastBinding?: AgentSessionBinding;

  constructor(options: StructuredInProductModelAgentEngineOptions) {
    this.capability = options.capability;
    if (this.capability.executionProfile !== "model_agent" || this.capability.sessionStrategy !== "structured_turn") {
      throw new ModelAgentEngineError(
        "MODEL_CAPABILITY_INVALID",
        "In-product model engine requires a model_agent structured_turn capability."
      );
    }
    this.transport = options.transport;
    this.maxTurns = options.maxTurns ?? 120;
    if (!Number.isSafeInteger(this.maxTurns) || this.maxTurns < 1 || this.maxTurns > 500) {
      throw new ModelAgentEngineError("MODEL_MAX_TURNS_INVALID", "maxTurns must be between 1 and 500.");
    }
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? randomUUID;
    this.resolveBinding = options.resolveBinding;
  }

  async openSession(start: AgentEngineStart, host: AgentEngineHost): Promise<AgentRunSession> {
    const binding = agentSessionBindingSchema.parse(start.binding);
    assertBinding(binding, this.capability);
    this.lastBinding = binding;
    if (!sha256.safeParse(start.initialContextHash).success) {
      throw new ModelAgentEngineError("MODEL_INITIAL_CONTEXT_HASH_INVALID", "Initial context hash must be sha256.");
    }
    return new StructuredModelAgentSession({
      binding,
      host,
      transport: this.transport,
      maxTurns: this.maxTurns,
      now: this.now,
      idFactory: this.idFactory,
      initialDelta: {
        type: "initial_context",
        context: structuredClone(start.initialContext),
        contextHash: start.initialContextHash
      }
    });
  }

  async resumeSession(
    rawCheckpoint: AgentEngineCheckpoint,
    host: AgentEngineHost
  ): Promise<AgentRunSession> {
    if (!this.capability.supportsResume) {
      throw new ModelAgentEngineError("MODEL_RESUME_UNSUPPORTED", "This model engine does not support checkpoint resume.");
    }
    const checkpoint = agentEngineCheckpointSchema.parse(rawCheckpoint);
    const cached = this.lastBinding?.bindingId === checkpoint.bindingId
      ? this.lastBinding
      : undefined;
    const exactCached = cached?.sessionEpoch === checkpoint.sessionEpoch
      ? cached
      : undefined;
    let resolved = exactCached ?? await this.resolveBinding?.(checkpoint);
    if (
      !resolved
      && cached
      && checkpoint.sessionEpoch === cached.sessionEpoch + 1
      && checkpoint.runId === cached.runId
      && checkpoint.externalSessionId === cached.externalSessionId
    ) {
      // The Supervisor durably fences the prior process by committing exactly
      // the next epoch before asking the same in-process engine to resume. The
      // cognitive binding remains immutable; only its fencing epoch advances.
      // A skipped epoch is never synthesized here, and a restarted process
      // must still resolve the persisted effective binding explicitly.
      resolved = agentSessionBindingSchema.parse({
        ...cached,
        sessionEpoch: checkpoint.sessionEpoch
      });
    }
    if (!resolved) {
      throw new ModelAgentEngineError(
        "MODEL_RESUME_BINDING_REQUIRED",
        `Resume requires the immutable persisted binding for ${checkpoint.bindingId}.`
      );
    }
    return this.resumeBoundSession(resolved, checkpoint, host);
  }

  /** Canonical resume entrypoint used by the Supervisor adapter after it loads
   * the immutable binding alongside the checkpoint. */
  async resumeBoundSession(
    bindingInput: AgentSessionBinding,
    checkpointInput: AgentEngineCheckpoint,
    host: AgentEngineHost
  ): Promise<AgentRunSession> {
    const binding = agentSessionBindingSchema.parse(bindingInput);
    const checkpoint = agentEngineCheckpointSchema.parse(checkpointInput);
    assertBinding(binding, this.capability);
    this.lastBinding = binding;
    if (
      checkpoint.bindingId !== binding.bindingId
      || checkpoint.runId !== binding.runId
      || checkpoint.sessionEpoch !== binding.sessionEpoch
    ) {
      throw new ModelAgentEngineError("MODEL_CHECKPOINT_MISMATCH", "Checkpoint does not match the immutable model binding.");
    }
    return new StructuredModelAgentSession({
      binding,
      host,
      transport: this.transport,
      maxTurns: this.maxTurns,
      now: this.now,
      idFactory: this.idFactory,
      initialDelta: { type: "recovery", checkpoint },
      checkpoint
    });
  }
}

interface StructuredModelAgentSessionOptions {
  binding: AgentSessionBinding;
  host: AgentEngineHost;
  transport: ModelAgentTurnTransport;
  maxTurns: number;
  now: () => string;
  idFactory: () => string;
  initialDelta: ModelAgentCheckpointDelta;
  checkpoint?: AgentEngineCheckpoint | undefined;
}

class StructuredModelAgentSession implements AgentRunSession {
  readonly binding: AgentSessionBinding;
  private readonly host: AgentEngineHost;
  private readonly transport: ModelAgentTurnTransport;
  private readonly maxTurns: number;
  private readonly now: () => string;
  private readonly idFactory: () => string;
  private pendingDelta: ModelAgentCheckpointDelta | Extract<ModelAgentTurnDelta, { type: "human_inputs" }> | null;
  private readonly queuedInputs: AgentHumanInput[] = [];
  private previousCursor: string | null;
  private lastInput: AgentEngineCheckpoint["lastConfirmedInput"];
  private lastOutput: AgentEngineCheckpoint["lastConfirmedOutput"];
  private activeExchange: AgentEngineCheckpoint["activeExchange"] = null;
  private activeToolCall: AgentEngineCheckpoint["activeToolCall"] = null;
  private finishReceipt: AgentEngineCheckpoint["finishReceipt"] = null;
  private turnCount = 0;
  private firstUserFacingEvent = false;
  private paused = false;
  private terminal = false;
  private closed = false;

  constructor(options: StructuredModelAgentSessionOptions) {
    this.binding = options.binding;
    this.host = options.host;
    this.transport = options.transport;
    this.maxTurns = options.maxTurns;
    this.now = options.now;
    this.idFactory = options.idFactory;
    this.pendingDelta = options.initialDelta;
    this.previousCursor = options.checkpoint?.lastConfirmedOutput?.cursor ?? null;
    this.lastInput = options.checkpoint?.lastConfirmedInput ?? null;
    this.lastOutput = options.checkpoint?.lastConfirmedOutput ?? null;
    this.activeExchange = options.checkpoint?.activeExchange ?? null;
    this.activeToolCall = options.checkpoint?.activeToolCall ?? null;
    this.finishReceipt = options.checkpoint?.finishReceipt ?? null;
    this.queuedInputs.push(...structuredClone(options.checkpoint?.pendingHumanInputs ?? []));
  }

  async *events(): AsyncIterable<AgentEngineEvent> {
    while (!this.closed && !this.terminal && !this.paused) {
      if (this.host.signal.aborted) return;
      const pendingDelta = this.pendingDelta;
      if (!pendingDelta) return;
      const queuedInputs = this.queuedInputs.splice(0);
      const delta: ModelAgentTurnDelta = queuedInputs.length > 0
        ? pendingDelta.type === "human_inputs"
          ? { type: "human_inputs", inputs: [...pendingDelta.inputs, ...queuedInputs] }
          : { type: "checkpoint_inputs", checkpointDelta: pendingDelta, inputs: queuedInputs }
        : pendingDelta;
      if (this.turnCount >= this.maxTurns) {
        this.terminal = true;
        yield {
          type: "transport_error",
          code: "MAX_MODEL_TURNS_EXCEEDED",
          message: `Model agent exceeded ${this.maxTurns} structured turns.`,
          retryable: false
        };
        return;
      }

      this.turnCount += 1;
      const exchangeId = `exchange-${this.binding.sessionEpoch}-${this.turnCount}`;
      const stableCallKey = `turn-${this.binding.sessionEpoch}-${this.turnCount}`;
      const requestHash = hashJson({ previousCursor: this.previousCursor, delta });
      this.lastInput = { cursor: `${stableCallKey}-input`, contentHash: requestHash };
      this.activeExchange = { exchangeId, stableCallKey, state: "in_flight" };
      // The Supervisor consumes this event before the provider call begins,
      // fencing the exchange as in-flight in durable authority. A process
      // loss can therefore be reconciled by stableCallKey instead of being
      // mistaken for a never-started turn.
      yield { type: "checkpoint_requested", reason: "engine_exchange_started" };

      let response: ModelAgentTurnResponse;
      try {
        response = await this.transport.completeTurn({
          binding: this.binding,
          exchangeId,
          stableCallKey,
          previousCursor: this.previousCursor,
          delta,
          responseSchema: modelAgentStructuredTurnSchema,
          signal: this.host.signal
        });
      } catch (error) {
        this.activeExchange = { exchangeId, stableCallKey, state: "ambiguous" };
        yield { type: "checkpoint_requested", reason: "engine_exchange_ambiguous" };
        yield {
          type: "transport_error",
          code: errorCode(error, "MODEL_TURN_FAILED"),
          message: safeErrorMessage(error, "Structured model turn failed."),
          retryable: true
        };
        return;
      }

      const turn = modelAgentStructuredTurnSchema.safeParse(response.output);
      if (!turn.success || !response.cursor.trim()) {
        this.activeExchange = { exchangeId, stableCallKey, state: "failed" };
        yield { type: "checkpoint_requested", reason: "engine_exchange_failed" };
        yield {
          type: "transport_error",
          code: "MODEL_TURN_SCHEMA_INVALID",
          message: turn.success ? "Model turn did not include a continuation cursor." : turn.error.message.slice(0, 1_000),
          retryable: true
        };
        return;
      }

      this.lastOutput = { cursor: response.cursor.slice(0, 512), contentHash: hashJson(turn.data) };
      this.previousCursor = this.lastOutput.cursor;
      this.activeExchange = { exchangeId, stableCallKey, state: "completed" };
      this.pendingDelta = null;
      yield { type: "checkpoint_requested", reason: "engine_exchange_completed" };

      if (response.usage) yield { type: "usage", metrics: response.usage };
      if (turn.data.assistantMessage) {
        this.firstUserFacingEvent = true;
        yield {
          type: "assistant_message",
          messageId: turn.data.assistantMessage.messageId,
          text: turn.data.assistantMessage.text
        };
      }

      const action = turn.data.action;
      if (action.type === "question") {
        this.firstUserFacingEvent = true;
        const questionCallId = `question-call-${hashJson({
          turnId: turn.data.turnId,
          questionSetId: action.questionSetId
        }).slice("sha256:".length, "sha256:".length + 32)}`;
        const execution = await this.executeBatch({
          calls: [{
            externalCallId: questionCallId,
            toolName: "user.ask",
            args: { questions: action.questions }
          }]
        });
        this.pendingDelta = {
          type: "tool_results",
          batchId: execution.batchId,
          results: execution.results
        };
        yield { type: "checkpoint_requested", reason: "question_tool_result" };
        if (execution.pause === "waiting_user") {
          this.paused = true;
          yield {
            type: "question",
            messageId: action.messageId,
            questionSetId: action.questionSetId,
            questions: action.questions
          };
          return;
        }
        // A rejected question is a structured tool result for the same model
        // session to correct; it must not create an out-of-band pause.
        continue;
      }
      if (!this.firstUserFacingEvent) {
        this.terminal = true;
        yield {
          type: "transport_error",
          code: "MODEL_FIRST_RESPONSE_MISSING",
          message: "The first structured turn must include an assistant message or question.",
          retryable: true
        };
        return;
      }
      if (action.type === "final") {
        // An instruction can arrive while the final provider turn is in
        // flight. It wins the race: continue the same logical session and do
        // not publish a stale final that ignored accepted user input.
        if (this.queuedInputs.length > 0) {
          this.pendingDelta = {
            type: "human_inputs",
            inputs: this.queuedInputs.splice(0)
          };
          yield { type: "checkpoint_requested", reason: "queued_human_input" };
          continue;
        }
        this.terminal = true;
        yield {
          type: "final",
          messageId: action.messageId,
          finishReceiptId: action.finishReceiptId,
          text: action.text
        };
        return;
      }

      const execution = await this.executeBatch(action.batch);
      this.pendingDelta = execution.reconciliation
        ? {
            type: "manual_reconciliation",
            batchId: execution.batchId,
            results: execution.results,
            reconciliation: execution.reconciliation
          }
        : {
            type: "tool_results",
            batchId: execution.batchId,
            results: execution.results
          };
      yield {
        type: "checkpoint_requested",
        reason: execution.reconciliation ? "manual_reconciliation" : "tool_result"
      };
      if (execution.pause === "waiting_user") {
        const call = execution.pausedCall!;
        const questions = z.array(agentQuestionSchema.strict()).min(1).max(5).safeParse(call.args.questions);
        if (!questions.success) {
          this.terminal = true;
          yield {
            type: "transport_error",
            code: "MODEL_QUESTION_TOOL_INVALID",
            message: "user.ask did not contain valid VDT questions.",
            retryable: true
          };
          return;
        }
        this.paused = true;
        yield {
          type: "question",
          messageId: `question-${call.externalCallId}`,
          questionSetId: `questions-${call.externalCallId}`,
          questions: questions.data
        };
        return;
      }
      if (execution.pause === "waiting_approval") {
        this.paused = true;
        return;
      }
    }
  }

  async submit(input: AgentHumanInput): Promise<void> {
    if (this.closed || this.terminal) {
      throw new ModelAgentEngineError("MODEL_SESSION_TERMINAL", "Cannot submit input to a terminal model session.");
    }
    if (!this.paused) {
      if (input.type !== "user_instruction") {
        throw new ModelAgentEngineError(
          "MODEL_SESSION_NOT_PAUSED",
          "Question answers are accepted only while the model session is waiting for that checkpoint."
        );
      }
      if (this.queuedInputs.length >= 20) {
        throw new ModelAgentEngineError(
          "MODEL_INPUT_QUEUE_FULL",
          "The model session already has 20 instructions waiting for the next checkpoint."
        );
      }
      this.queuedInputs.push(structuredClone(input));
      return;
    }
    this.pendingDelta = { type: "human_input", input: structuredClone(input) };
    this.paused = false;
  }

  async checkpoint(): Promise<AgentEngineCheckpoint> {
    const pendingHumanInputs = [
      ...(this.pendingDelta?.type === "human_input" ? [this.pendingDelta.input] : []),
      ...(this.pendingDelta?.type === "human_inputs" ? this.pendingDelta.inputs : []),
      ...this.queuedInputs
    ];
    return agentEngineCheckpointSchema.parse({
      schemaVersion: 2,
      checkpointId: `checkpoint-${this.binding.sessionEpoch}-${this.idFactory()}`,
      bindingId: this.binding.bindingId,
      runId: this.binding.runId,
      sessionEpoch: this.binding.sessionEpoch,
      externalSessionId: this.binding.externalSessionId,
      lastConfirmedInput: this.lastInput,
      lastConfirmedOutput: this.lastOutput,
      activeExchange: this.activeExchange,
      activeToolCall: this.activeToolCall,
      finishReceipt: this.finishReceipt,
      ...(pendingHumanInputs.length > 0
        ? { pendingHumanInputs: structuredClone(pendingHumanInputs) }
        : {}),
      createdAt: this.now()
    });
  }

  async cancel(_reason: string): Promise<void> {
    this.terminal = true;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  private async executeBatch(batch: AgentActionBatch): Promise<{
    batchId: string;
    results: Readonly<Record<string, unknown>>[];
    pause: "waiting_user" | "waiting_approval" | null;
    pausedCall: AgentActionBatch["calls"][number] | null;
    reconciliation: Readonly<Record<string, unknown>> | null;
  }> {
    const batchId = `batch-${this.binding.sessionEpoch}-${this.turnCount}`;
    const results: Readonly<Record<string, unknown>>[] = [];
    let pause: "waiting_user" | "waiting_approval" | null = null;
    let pausedCall: AgentActionBatch["calls"][number] | null = null;
    let reconciliation: Readonly<Record<string, unknown>> | null = null;
    for (const call of batch.calls) {
      this.activeToolCall = {
        externalCallId: call.externalCallId,
        toolName: call.toolName,
        state: "in_flight"
      };
      const result = await this.host.executeTool(call);
      this.activeToolCall = {
        externalCallId: call.externalCallId,
        toolName: call.toolName,
        state: result.status === "failed" ? "failed" : "completed"
      };
      results.push(result as unknown as Readonly<Record<string, unknown>>);
      if (result.resultCode === "STALE_REVISION") {
        const payload = result.payload && typeof result.payload === "object"
          ? result.payload as Record<string, unknown>
          : {};
        reconciliation = payload.reconciliationDelta
          && typeof payload.reconciliationDelta === "object"
          ? payload.reconciliationDelta as Readonly<Record<string, unknown>>
          : {
              expectedRevision: payload.expectedRevision ?? null,
              currentRevision: payload.currentRevision ?? null
            };
      }
      if (result.status === "waiting_user" || result.status === "waiting_approval") {
        pause = result.status;
        pausedCall = call;
        break;
      }
      if (result.status === "failed") break;
      if (call.toolName === "run.request_finish") {
        const payload = result.payload && typeof result.payload === "object"
          ? result.payload as Record<string, unknown>
          : {};
        if (typeof payload.receiptId === "string" && sha256.safeParse(payload.receiptHash).success) {
          this.finishReceipt = {
            receiptId: payload.receiptId,
            state: "verified",
            receiptHash: payload.receiptHash as string
          };
        }
      }
    }
    this.activeToolCall = null;
    return { batchId, results, pause, pausedCall, reconciliation };
  }
}

export class ModelAgentEngineError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ModelAgentEngineError";
  }
}

function assertBinding(
  binding: AgentSessionBinding,
  capability: Extract<AgentCapabilityProfile, { executionProfile: "model_agent" }>
): void {
  if (
    binding.executionProfile !== "model_agent"
    || binding.engineId !== capability.engineId
    || binding.engineAdapterId !== capability.engineAdapterId
    || binding.backendId !== capability.backendId
    || binding.protocolVersion !== capability.protocolVersion
    || binding.cliVersion !== null
    || binding.toolIsolation !== capability.toolIsolation
    || binding.qualificationStatus !== capability.qualification.status
    || binding.capabilityEvidenceHash !== capability.qualification.evidenceHash
    || binding.toolCatalogHash !== capability.toolCatalogHash
    || binding.externalSessionId !== null
  ) {
    throw new ModelAgentEngineError("MODEL_BINDING_MISMATCH", "Binding does not match the model engine capability.");
  }
}

function hashJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(sortJson(value))).digest("hex")}`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJson(entry)])
  );
}

function errorCode(error: unknown, fallback: string): string {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code.slice(0, 160)
    : fallback;
}

function safeErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message.trim()) return fallback;
  if (/api.?key|authorization|password|secret|token/i.test(error.message)) return fallback;
  return error.message.slice(0, 1_000);
}
