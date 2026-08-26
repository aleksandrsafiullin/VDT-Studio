import { createHash } from "node:crypto";
import { z } from "zod";
import {
  agentEngineCheckpointSchema,
  agentSessionBindingSchema,
  vdtGatewayToolResultSchema,
  type AgentEngineCheckpoint,
  type AgentSessionBinding
} from "./agent-execution-contracts";
import type { AgentRunStore } from "./run-store";
import { AgentRunEventOutbox } from "./agent-event-outbox";
import {
  agentRunEventV2Schema,
  type AgentRunEventV2
} from "./schemas/agent-run-event-v2";

const nonEmptyString = (max: number) => z.string().trim().min(1).max(max);
const safeIdSchema = nonEmptyString(200).regex(
  /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/,
  "Must use only letters, numbers, dots, colons, underscores, or hyphens."
);
const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const timestampSchema = z.string().datetime({ offset: true });

const exchangeStateSchema = z.enum([
  "prepared",
  "in_flight",
  "completed",
  "failed",
  "ambiguous"
]);

const toolOperationStateSchema = z.enum([
  "reserved",
  "in_flight",
  "completed",
  "failed",
  "ambiguous"
]);

export const agentEngineExchangeReceiptV2Schema = z.object({
  schemaVersion: z.literal(2),
  receiptId: safeIdSchema,
  runId: safeIdSchema,
  bindingId: safeIdSchema,
  exchangeId: safeIdSchema,
  stableCallKey: safeIdSchema,
  sessionEpoch: z.number().int().positive(),
  state: exchangeStateSchema,
  inputHash: sha256Schema,
  outputHash: sha256Schema.nullable(),
  resultCode: safeIdSchema.nullable(),
  startedAt: timestampSchema,
  updatedAt: timestampSchema
}).strict().superRefine((value, ctx) => {
  if (value.updatedAt < value.startedAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["updatedAt"],
      message: "updatedAt must not precede startedAt."
    });
  }
  if (value.state === "completed" && value.outputHash === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["outputHash"],
      message: "A completed exchange must include outputHash."
    });
  }
  if ((value.state === "failed" || value.state === "ambiguous") && value.resultCode === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["resultCode"],
      message: "A failed or ambiguous exchange must include resultCode."
    });
  }
});

export const agentToolOperationReceiptV2Schema = z.object({
  schemaVersion: z.literal(2),
  receiptId: safeIdSchema,
  runId: safeIdSchema,
  bindingId: safeIdSchema,
  externalCallId: safeIdSchema,
  toolName: nonEmptyString(160),
  idempotencyKey: safeIdSchema,
  sessionEpoch: z.number().int().positive(),
  state: toolOperationStateSchema,
  argsHash: sha256Schema,
  resultHash: sha256Schema.nullable(),
  resultCode: safeIdSchema.nullable(),
  /** Exact bounded gateway response used for terminal same-key replay. It is
   * internal authority state and is never included in the public summary. */
  replayResult: vdtGatewayToolResultSchema.nullable().optional(),
  expectedRevision: z.number().int().nonnegative().nullable(),
  committedRevision: z.number().int().nonnegative().nullable(),
  startedAt: timestampSchema,
  updatedAt: timestampSchema
}).strict().superRefine((value, ctx) => {
  if (value.updatedAt < value.startedAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["updatedAt"],
      message: "updatedAt must not precede startedAt."
    });
  }
  if (value.state === "completed" && (value.resultHash === null || value.resultCode === null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["resultHash"],
      message: "A completed tool operation must include resultHash and resultCode."
    });
  }
  if (value.replayResult) {
    if (
      value.replayResult.externalCallId !== value.externalCallId
      || value.replayResult.toolName !== value.toolName
      || value.replayResult.resultHash !== value.resultHash
      || value.replayResult.resultCode !== value.resultCode
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["replayResult"],
        message: "replayResult must match the stable tool receipt identity and result hashes."
      });
    }
    if (new TextEncoder().encode(JSON.stringify(value.replayResult)).byteLength > 256 * 1024) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["replayResult"],
        message: "replayResult exceeds the 256 KiB durable replay limit."
      });
    }
  }
  if ((value.state === "failed" || value.state === "ambiguous") && value.resultCode === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["resultCode"],
      message: "A failed or ambiguous tool operation must include resultCode."
    });
  }
  if (
    value.committedRevision !== null
    && value.expectedRevision !== null
    && value.committedRevision < value.expectedRevision
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["committedRevision"],
      message: "committedRevision must not precede expectedRevision."
    });
  }
});

export const finishReceiptV2Schema = z.object({
  schemaVersion: z.literal(2),
  receiptId: safeIdSchema,
  runId: safeIdSchema,
  bindingId: safeIdSchema,
  sessionEpoch: z.number().int().positive(),
  state: z.enum(["verified", "final_persisted"]),
  receiptHash: sha256Schema,
  projectRevision: z.number().int().nonnegative(),
  projectHash: sha256Schema,
  validationHash: sha256Schema,
  calculationHash: sha256Schema,
  finalMessageHash: sha256Schema.nullable(),
  verifiedAt: timestampSchema,
  finalPersistedAt: timestampSchema.nullable()
}).strict().superRefine((value, ctx) => {
  if (value.state === "verified") {
    if (value.finalMessageHash !== null || value.finalPersistedAt !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["state"],
        message: "A verified finish receipt cannot claim a persisted final message."
      });
    }
    return;
  }
  if (value.finalMessageHash === null || value.finalPersistedAt === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["finalMessageHash"],
      message: "A final_persisted receipt must include the final message hash and timestamp."
    });
  } else if (value.finalPersistedAt < value.verifiedAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["finalPersistedAt"],
      message: "finalPersistedAt must not precede verifiedAt."
    });
  }
});

export type AgentEngineExchangeReceiptV2 = z.infer<
  typeof agentEngineExchangeReceiptV2Schema
>;
export type AgentToolOperationReceiptV2 = z.infer<
  typeof agentToolOperationReceiptV2Schema
>;
export type FinishReceiptV2 = z.infer<typeof finishReceiptV2Schema>;

export const recoveredFinishFinalizationV2Schema = z.object({
  schemaVersion: z.literal(2),
  runId: safeIdSchema,
  bindingId: safeIdSchema,
  receiptId: safeIdSchema,
  receiptHash: sha256Schema,
  originSessionEpoch: z.number().int().positive(),
  recoverySessionEpoch: z.number().int().positive(),
  finalMessageHash: sha256Schema,
  finalPersistedAt: timestampSchema
}).strict().superRefine((value, ctx) => {
  if (value.recoverySessionEpoch !== value.originSessionEpoch + 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["recoverySessionEpoch"],
      message: "Recovered finish finalization requires the exact successor session epoch."
    });
  }
});

export type RecoveredFinishFinalizationV2 = z.infer<
  typeof recoveredFinishFinalizationV2Schema
>;

export const agentSupervisorPersistenceStateV2Schema = z.object({
  schemaVersion: z.literal(2),
  binding: agentSessionBindingSchema,
  checkpoint: agentEngineCheckpointSchema.nullable(),
  exchangeReceipts: z.array(agentEngineExchangeReceiptV2Schema),
  toolOperationReceipts: z.array(agentToolOperationReceiptV2Schema),
  finishReceipt: finishReceiptV2Schema.nullable(),
  eventOutbox: z.array(agentRunEventV2Schema).optional(),
  updatedAt: timestampSchema
}).strict();

export type AgentSupervisorPersistenceStateV2 = z.infer<
  typeof agentSupervisorPersistenceStateV2Schema
>;

export type AgentExecutionSessionStatus =
  | "bound"
  | "active"
  | "checkpointed"
  | "finishing"
  | "completed"
  | "recovery_required";

export type AgentExecutionRecoveryStatus =
  | "ready"
  | "resumable"
  | "ambiguous"
  | "recovery_required"
  | "complete";

/** Compact, read-only projection. Opaque session IDs, settings hashes,
 * checkpoints, receipts, and model/tool payloads are deliberately absent. */
export interface AgentExecutionSummaryV2 {
  readonly schemaVersion: 2;
  readonly executionProfile: AgentSessionBinding["executionProfile"];
  readonly engineId: string;
  readonly engineAdapterId: string;
  readonly backendId: string;
  readonly modelId: string;
  readonly protocolVersion: string;
  readonly cliVersion: string | null;
  readonly toolIsolation: AgentSessionBinding["toolIsolation"];
  readonly qualificationStatus: AgentSessionBinding["qualificationStatus"];
  readonly capabilityEvidenceHash: string | null;
  readonly capabilityProfileHash: string;
  readonly toolCatalogHash: string;
  readonly sessionStatus: AgentExecutionSessionStatus;
  readonly recoveryStatus: AgentExecutionRecoveryStatus;
  readonly sessionEpoch: number;
  readonly externalSessionBound: boolean;
  readonly lastCheckpointId: string | null;
  readonly pendingOperation: "engine_exchange" | "tool_call" | "final_message" | null;
  readonly finishState: FinishReceiptV2["state"] | null;
  readonly boundAt: string;
  readonly updatedAt: string;
}

export interface AgentSupervisorPersistence {
  load(runId: string): Promise<AgentSupervisorPersistenceStateV2 | null>;
  createBinding(binding: AgentSessionBinding): Promise<AgentSupervisorPersistenceStateV2>;
  saveCheckpoint(checkpoint: AgentEngineCheckpoint): Promise<void>;
  appendExchangeReceipt(receipt: AgentEngineExchangeReceiptV2): Promise<void>;
  getExchangeReceipt(
    runId: string,
    stableCallKey: string
  ): Promise<AgentEngineExchangeReceiptV2 | null>;
  appendToolOperationReceipt(receipt: AgentToolOperationReceiptV2): Promise<void>;
  reserveToolOperationReceipt(receipt: AgentToolOperationReceiptV2): Promise<{
    acquired: boolean;
    receipt: AgentToolOperationReceiptV2;
  }>;
  getToolOperationReceipt(
    runId: string,
    externalCallId: string
  ): Promise<AgentToolOperationReceiptV2 | null>;
  appendFinishReceipt(receipt: FinishReceiptV2): Promise<void>;
  finalizeRecoveredFinish(
    finalization: RecoveredFinishFinalizationV2
  ): Promise<FinishReceiptV2>;
  getFinishReceipt(runId: string): Promise<FinishReceiptV2 | null>;
  appendEvent(event: AgentRunEventV2): Promise<void>;
  getEvents(runId: string): Promise<AgentRunEventV2[]>;
  getExecutionSummary(runId: string): Promise<AgentExecutionSummaryV2 | null>;
  /** Releases process-local handles after the owning Supervisor has stopped.
   * Durable state remains available to a new persistence instance. */
  close?(): void | Promise<void>;
}

interface AgentSupervisorStateBackend {
  read(runId: string): AgentSupervisorPersistenceStateV2 | null;
  write(runId: string, state: AgentSupervisorPersistenceStateV2): void;
}

class AgentSupervisorPersistenceCore implements AgentSupervisorPersistence {
  constructor(private readonly backend: AgentSupervisorStateBackend) {}

  async load(runId: string): Promise<AgentSupervisorPersistenceStateV2 | null> {
    const state = this.backend.read(runId);
    return state ? cloneState(effectiveSupervisorState(state)) : null;
  }

  async createBinding(
    rawBinding: AgentSessionBinding
  ): Promise<AgentSupervisorPersistenceStateV2> {
    const binding = agentSessionBindingSchema.parse(rawBinding);
    const existing = this.backend.read(binding.runId);
    if (existing) {
      const effective = effectiveSupervisorState(existing);
      if (binding.sessionEpoch !== effective.binding.sessionEpoch) {
        throw new AgentSupervisorPersistenceError(
          "SESSION_EPOCH_MISMATCH",
          `Binding epoch ${binding.sessionEpoch} does not match current epoch ${effective.binding.sessionEpoch}.`
        );
      }
      if (!sameBindingExecutionIdentity(effective.binding, binding)) {
        throw new AgentSupervisorPersistenceError(
          "SESSION_BINDING_CONFLICT",
          `Run ${binding.runId} already has a different immutable engine binding.`
        );
      }
      if (canonicalJson(effective.binding) === canonicalJson(binding)) {
        return cloneState(effective);
      }
      if (
        existing.binding.externalSessionId === null
        && binding.externalSessionId !== null
        && (existing.checkpoint?.externalSessionId ?? binding.externalSessionId) === binding.externalSessionId
      ) {
        const finalized = sanitizeAgentSupervisorPersistenceState({
          ...existing,
          binding: {
            ...binding,
            sessionEpoch: existing.binding.sessionEpoch
          },
          updatedAt: maxTimestamp(existing.updatedAt, binding.boundAt)
        });
        this.backend.write(binding.runId, finalized);
        return cloneState(effectiveSupervisorState(finalized));
      }
      throw new AgentSupervisorPersistenceError(
        "SESSION_BINDING_CONFLICT",
        `Run ${binding.runId} already has a different opaque engine session.`
      );
    }
    const state: AgentSupervisorPersistenceStateV2 = {
      schemaVersion: 2,
      binding,
      checkpoint: null,
      exchangeReceipts: [],
      toolOperationReceipts: [],
      finishReceipt: null,
      eventOutbox: [],
      updatedAt: binding.boundAt
    };
    this.backend.write(binding.runId, state);
    return cloneState(state);
  }

  async saveCheckpoint(rawCheckpoint: AgentEngineCheckpoint): Promise<void> {
    const checkpoint = agentEngineCheckpointSchema.parse(rawCheckpoint);
    const state = this.requireState(checkpoint.runId);
    assertCheckpointMatchesBinding(checkpoint, state.binding);
    const currentEpoch = state.checkpoint?.sessionEpoch ?? state.binding.sessionEpoch;
    if (checkpoint.sessionEpoch > currentEpoch + 1) {
      throw new AgentSupervisorPersistenceError(
        "SESSION_EPOCH_MISMATCH",
        `Checkpoint ${checkpoint.checkpointId} skips the next durable session epoch.`
      );
    }
    if (state.checkpoint && checkpoint.sessionEpoch < state.checkpoint.sessionEpoch) {
      throw new AgentSupervisorPersistenceError(
        "SESSION_EPOCH_REGRESSION",
        `Checkpoint ${checkpoint.checkpointId} regresses the durable checkpoint epoch.`
      );
    }
    if (state.checkpoint && checkpoint.createdAt < state.checkpoint.createdAt) {
      throw new AgentSupervisorPersistenceError(
        "CHECKPOINT_REGRESSION",
        `Checkpoint ${checkpoint.checkpointId} predates the durable checkpoint.`
      );
    }
    if (
      state.checkpoint
      && checkpoint.createdAt === state.checkpoint.createdAt
      && canonicalJson(checkpoint) !== canonicalJson(state.checkpoint)
    ) {
      throw new AgentSupervisorPersistenceError(
        "CHECKPOINT_CONFLICT",
        `Checkpoint timestamp ${checkpoint.createdAt} is already bound to different content.`
      );
    }
    this.write({
      ...state,
      checkpoint,
      updatedAt: maxTimestamp(state.updatedAt, checkpoint.createdAt)
    });
  }

  async appendExchangeReceipt(rawReceipt: AgentEngineExchangeReceiptV2): Promise<void> {
    const receipt = agentEngineExchangeReceiptV2Schema.parse(rawReceipt);
    const state = this.requireState(receipt.runId);
    assertReceiptMatchesBinding(receipt, state.binding);
    assertCurrentSessionEpoch(receipt.sessionEpoch, state);
    const previous = latestExchangeReceipt(state.exchangeReceipts, receipt.stableCallKey);
    if (previous) {
      assertStableReceiptIdentity(previous, receipt, [
        "receiptId",
        "runId",
        "bindingId",
        "exchangeId",
        "stableCallKey",
        "sessionEpoch",
        "inputHash",
        "startedAt"
      ]);
      assertForwardTransition("exchange", previous.state, receipt.state, {
        prepared: ["prepared", "in_flight", "completed", "failed", "ambiguous"],
        in_flight: ["in_flight", "completed", "failed", "ambiguous"],
        ambiguous: ["ambiguous", "completed", "failed"],
        completed: ["completed"],
        failed: ["failed"]
      });
      assertNonRegressingTimestamp(previous.updatedAt, receipt.updatedAt, "exchange receipt");
      if (canonicalJson(previous) === canonicalJson(receipt)) return;
    } else {
      assertUniqueReceiptId(
        state.exchangeReceipts,
        receipt.receiptId,
        "exchange receipt"
      );
    }
    this.write({
      ...state,
      exchangeReceipts: [...state.exchangeReceipts, receipt],
      updatedAt: maxTimestamp(state.updatedAt, receipt.updatedAt)
    });
  }

  async getExchangeReceipt(
    runId: string,
    stableCallKey: string
  ): Promise<AgentEngineExchangeReceiptV2 | null> {
    const state = this.backend.read(runId);
    const receipt = state
      ? latestExchangeReceipt(state.exchangeReceipts, stableCallKey)
      : undefined;
    return receipt ? structuredClone(receipt) : null;
  }

  async appendToolOperationReceipt(rawReceipt: AgentToolOperationReceiptV2): Promise<void> {
    const receipt = agentToolOperationReceiptV2Schema.parse(rawReceipt);
    const state = this.requireState(receipt.runId);
    assertReceiptMatchesBinding(receipt, state.binding);
    assertCurrentSessionEpoch(receipt.sessionEpoch, state);
    const previous = latestToolReceipt(state.toolOperationReceipts, receipt.externalCallId);
    if (previous) {
      assertStableReceiptIdentity(previous, receipt, [
        "receiptId",
        "runId",
        "bindingId",
        "externalCallId",
        "toolName",
        "idempotencyKey",
        "sessionEpoch",
        "argsHash",
        "expectedRevision",
        "startedAt"
      ]);
      assertForwardTransition("tool operation", previous.state, receipt.state, {
        reserved: ["reserved", "in_flight", "completed", "failed", "ambiguous"],
        in_flight: ["in_flight", "completed", "failed", "ambiguous"],
        ambiguous: ["ambiguous", "completed", "failed"],
        completed: ["completed"],
        failed: ["failed"]
      });
      assertNonRegressingTimestamp(previous.updatedAt, receipt.updatedAt, "tool receipt");
      if (canonicalJson(previous) === canonicalJson(receipt)) return;
    } else {
      assertUniqueReceiptId(
        state.toolOperationReceipts,
        receipt.receiptId,
        "tool operation receipt"
      );
    }
    this.write({
      ...state,
      toolOperationReceipts: [...state.toolOperationReceipts, receipt],
      updatedAt: maxTimestamp(state.updatedAt, receipt.updatedAt)
    });
  }

  async reserveToolOperationReceipt(rawReceipt: AgentToolOperationReceiptV2): Promise<{
    acquired: boolean;
    receipt: AgentToolOperationReceiptV2;
  }> {
    const receipt = agentToolOperationReceiptV2Schema.parse(rawReceipt);
    if (receipt.state !== "reserved") {
      throw new AgentSupervisorPersistenceError(
        "TOOL_RESERVATION_STATE_INVALID",
        "A tool reservation must begin in the reserved state."
      );
    }
    const state = this.requireState(receipt.runId);
    assertReceiptMatchesBinding(receipt, state.binding);
    assertCurrentSessionEpoch(receipt.sessionEpoch, state);
    const previous = latestToolReceipt(state.toolOperationReceipts, receipt.externalCallId);
    if (previous) {
      return { acquired: false, receipt: structuredClone(previous) };
    }
    assertUniqueReceiptId(
      state.toolOperationReceipts,
      receipt.receiptId,
      "tool operation receipt"
    );
    this.write({
      ...state,
      toolOperationReceipts: [...state.toolOperationReceipts, receipt],
      updatedAt: maxTimestamp(state.updatedAt, receipt.updatedAt)
    });
    return { acquired: true, receipt: structuredClone(receipt) };
  }

  async getToolOperationReceipt(
    runId: string,
    externalCallId: string
  ): Promise<AgentToolOperationReceiptV2 | null> {
    const state = this.backend.read(runId);
    const receipt = state
      ? latestToolReceipt(state.toolOperationReceipts, externalCallId)
      : undefined;
    return receipt ? structuredClone(receipt) : null;
  }

  async appendFinishReceipt(rawReceipt: FinishReceiptV2): Promise<void> {
    const receipt = finishReceiptV2Schema.parse(rawReceipt);
    const state = this.requireState(receipt.runId);
    assertReceiptMatchesBinding(receipt, state.binding);
    assertCurrentSessionEpoch(receipt.sessionEpoch, state);
    const previous = state.finishReceipt;
    if (previous) {
      assertStableReceiptIdentity(previous, receipt, [
        "receiptId",
        "runId",
        "bindingId",
        "sessionEpoch",
        "receiptHash",
        "projectRevision",
        "projectHash",
        "validationHash",
        "calculationHash",
        "verifiedAt"
      ]);
      assertForwardTransition("finish", previous.state, receipt.state, {
        verified: ["verified", "final_persisted"],
        final_persisted: ["final_persisted"]
      });
      if (canonicalJson(previous) === canonicalJson(receipt)) return;
    }
    const updatedAt = receipt.finalPersistedAt ?? receipt.verifiedAt;
    this.write({
      ...state,
      finishReceipt: receipt,
      updatedAt: maxTimestamp(state.updatedAt, updatedAt)
    });
  }

  async finalizeRecoveredFinish(
    rawFinalization: RecoveredFinishFinalizationV2
  ): Promise<FinishReceiptV2> {
    const finalization = recoveredFinishFinalizationV2Schema.parse(rawFinalization);
    const state = this.requireState(finalization.runId);
    const completed = recoveredFinishReceipt(state, finalization);
    if (state.finishReceipt?.state === "final_persisted") return structuredClone(completed);
    this.write({
      ...state,
      finishReceipt: completed,
      updatedAt: maxTimestamp(state.updatedAt, completed.finalPersistedAt!)
    });
    return structuredClone(completed);
  }

  async getFinishReceipt(runId: string): Promise<FinishReceiptV2 | null> {
    const receipt = this.backend.read(runId)?.finishReceipt;
    return receipt ? structuredClone(receipt) : null;
  }

  async appendEvent(rawEvent: AgentRunEventV2): Promise<void> {
    const event = agentRunEventV2Schema.parse(rawEvent);
    const state = this.requireState(event.runId);
    const events = state.eventOutbox ?? [];
    const existing = events[event.seq - 1];
    if (existing) {
      if (existing.hash === event.hash && existing.id === event.id) return;
      throw new AgentSupervisorPersistenceError(
        "EVENT_SEQUENCE_CONFLICT",
        `Sequence ${event.seq} is already bound to another durable event.`
      );
    }
    if (event.type === "final" && events.some((candidate) => candidate.type === "final")) {
      throw new AgentSupervisorPersistenceError(
        "DUPLICATE_DURABLE_FINAL",
        "A run may persist exactly one final event."
      );
    }
    if (event.seq !== events.length + 1 || event.previousHash !== (events.at(-1)?.hash ?? null)) {
      throw new AgentSupervisorPersistenceError(
        "EVENT_CHAIN_CONFLICT",
        `Event ${event.id} does not extend the durable outbox head.`
      );
    }
    this.write({
      ...state,
      eventOutbox: [...events, event],
      updatedAt: maxTimestamp(state.updatedAt, event.timestamp)
    });
  }

  async getEvents(runId: string): Promise<AgentRunEventV2[]> {
    return structuredClone(this.backend.read(runId)?.eventOutbox ?? []);
  }

  async getExecutionSummary(runId: string): Promise<AgentExecutionSummaryV2 | null> {
    const state = this.backend.read(runId);
    return state ? summarizeAgentSupervisorPersistenceState(state) : null;
  }

  private requireState(runId: string): AgentSupervisorPersistenceStateV2 {
    const state = this.backend.read(runId);
    if (!state) {
      throw new AgentSupervisorPersistenceError(
        "SESSION_BINDING_NOT_FOUND",
        `Run ${runId} has no durable engine binding.`
      );
    }
    return state;
  }

  private write(state: AgentSupervisorPersistenceStateV2): void {
    this.backend.write(state.binding.runId, sanitizeAgentSupervisorPersistenceState(state));
  }
}

function sameBindingExecutionIdentity(
  left: AgentSessionBinding,
  right: AgentSessionBinding
): boolean {
  const {
    externalSessionId: _leftSession,
    sessionEpoch: _leftEpoch,
    ...leftStable
  } = left;
  const {
    externalSessionId: _rightSession,
    sessionEpoch: _rightEpoch,
    ...rightStable
  } = right;
  return canonicalJson(leftStable) === canonicalJson(rightStable);
}

function effectiveSupervisorState(
  state: AgentSupervisorPersistenceStateV2
): AgentSupervisorPersistenceStateV2 {
  const checkpoint = state.checkpoint;
  if (!checkpoint) return state;
  return {
    ...state,
    binding: {
      ...state.binding,
      sessionEpoch: checkpoint.sessionEpoch,
      externalSessionId: checkpoint.externalSessionId ?? state.binding.externalSessionId
    }
  };
}

/** Test/local implementation. Passing initial states simulates loading durable
 * JSON after a process restart and therefore runs the recovery transform. */
export class InMemoryAgentSupervisorPersistence implements AgentSupervisorPersistence {
  private readonly states = new Map<string, AgentSupervisorPersistenceStateV2>();
  private readonly core: AgentSupervisorPersistenceCore;

  constructor(initialStates: readonly AgentSupervisorPersistenceStateV2[] = []) {
    for (const state of initialStates) {
      const recovered = recoverAgentSupervisorPersistenceState(state);
      this.states.set(recovered.binding.runId, recovered);
    }
    this.core = new AgentSupervisorPersistenceCore({
      read: (runId) => this.states.get(runId) ?? null,
      write: (runId, state) => {
        this.states.set(runId, cloneState(state));
      }
    });
  }

  load(runId: string) { return this.core.load(runId); }
  createBinding(binding: AgentSessionBinding) { return this.core.createBinding(binding); }
  saveCheckpoint(checkpoint: AgentEngineCheckpoint) { return this.core.saveCheckpoint(checkpoint); }
  appendExchangeReceipt(receipt: AgentEngineExchangeReceiptV2) {
    return this.core.appendExchangeReceipt(receipt);
  }
  getExchangeReceipt(runId: string, stableCallKey: string) {
    return this.core.getExchangeReceipt(runId, stableCallKey);
  }
  appendToolOperationReceipt(receipt: AgentToolOperationReceiptV2) {
    return this.core.appendToolOperationReceipt(receipt);
  }
  reserveToolOperationReceipt(receipt: AgentToolOperationReceiptV2) {
    return this.core.reserveToolOperationReceipt(receipt);
  }
  getToolOperationReceipt(runId: string, externalCallId: string) {
    return this.core.getToolOperationReceipt(runId, externalCallId);
  }
  appendFinishReceipt(receipt: FinishReceiptV2) {
    return this.core.appendFinishReceipt(receipt);
  }
  finalizeRecoveredFinish(finalization: RecoveredFinishFinalizationV2) {
    return this.core.finalizeRecoveredFinish(finalization);
  }
  getFinishReceipt(runId: string) { return this.core.getFinishReceipt(runId); }
  appendEvent(event: AgentRunEventV2) { return this.core.appendEvent(event); }
  getEvents(runId: string) { return this.core.getEvents(runId); }
  getExecutionSummary(runId: string) { return this.core.getExecutionSummary(runId); }
}

/** Adapter over AgentRunStore. AgentRunStore.updateRun invokes the configured
 * AgentRunPersistence, so the full V2 record travels inside the existing
 * internal-state JSON without a Sequence 3 schema or manifest change. */
export class AgentRunStateSupervisorPersistence implements AgentSupervisorPersistence {
  private readonly core: AgentSupervisorPersistenceCore;

  constructor(private readonly store: Pick<AgentRunStore, "has" | "getState" | "updateRun">) {
    this.core = new AgentSupervisorPersistenceCore({
      read: (runId) => {
        if (!this.store.has(runId)) return null;
        return this.store.getState(runId).supervisorPersistenceV2 ?? null;
      },
      write: (runId, state) => {
        this.store.updateRun(runId, {
          supervisorPersistenceV2: cloneState(state),
          executionSummary: summarizeAgentSupervisorPersistenceState(state)
        });
      }
    });
  }

  load(runId: string) { return this.core.load(runId); }
  createBinding(binding: AgentSessionBinding) { return this.core.createBinding(binding); }
  saveCheckpoint(checkpoint: AgentEngineCheckpoint) { return this.core.saveCheckpoint(checkpoint); }
  appendExchangeReceipt(receipt: AgentEngineExchangeReceiptV2) {
    return this.core.appendExchangeReceipt(receipt);
  }
  getExchangeReceipt(runId: string, stableCallKey: string) {
    return this.core.getExchangeReceipt(runId, stableCallKey);
  }
  appendToolOperationReceipt(receipt: AgentToolOperationReceiptV2) {
    return this.core.appendToolOperationReceipt(receipt);
  }
  reserveToolOperationReceipt(receipt: AgentToolOperationReceiptV2) {
    return this.core.reserveToolOperationReceipt(receipt);
  }
  getToolOperationReceipt(runId: string, externalCallId: string) {
    return this.core.getToolOperationReceipt(runId, externalCallId);
  }
  appendFinishReceipt(receipt: FinishReceiptV2) {
    return this.core.appendFinishReceipt(receipt);
  }
  finalizeRecoveredFinish(finalization: RecoveredFinishFinalizationV2) {
    return this.core.finalizeRecoveredFinish(finalization);
  }
  getFinishReceipt(runId: string) { return this.core.getFinishReceipt(runId); }
  appendEvent(event: AgentRunEventV2) { return this.core.appendEvent(event); }
  getEvents(runId: string) { return this.core.getEvents(runId); }
  getExecutionSummary(runId: string) { return this.core.getExecutionSummary(runId); }
}

export function sanitizeAgentSupervisorPersistenceState(
  state: AgentSupervisorPersistenceStateV2
): AgentSupervisorPersistenceStateV2 {
  const parsed = agentSupervisorPersistenceStateV2Schema.parse(structuredClone(state));
  if (parsed.eventOutbox && parsed.eventOutbox.length > 0) {
    new AgentRunEventOutbox(parsed.binding.runId, { initialEvents: parsed.eventOutbox });
  }
  return parsed;
}

/** Process-restart recovery is fail-closed: work that was in flight has an
 * unknown commit/response boundary until its stable key is reconciled. */
export function recoverAgentSupervisorPersistenceState(
  rawState: AgentSupervisorPersistenceStateV2
): AgentSupervisorPersistenceStateV2 {
  const state = sanitizeAgentSupervisorPersistenceState(rawState);
  const recoveredExchangeReceipts = [...state.exchangeReceipts];
  for (const receipt of latestReceiptsByKey(
    state.exchangeReceipts,
    (entry) => entry.stableCallKey
  )) {
    if (receipt.state === "in_flight") {
      recoveredExchangeReceipts.push({
        ...receipt,
        state: "ambiguous",
        resultCode: "AMBIGUOUS_EXCHANGE_RECOVERY"
      });
    }
  }
  const recoveredToolReceipts = [...state.toolOperationReceipts];
  for (const receipt of latestReceiptsByKey(
    state.toolOperationReceipts,
    (entry) => entry.externalCallId
  )) {
    if (receipt.state === "in_flight") {
      recoveredToolReceipts.push({
        ...receipt,
        state: "ambiguous",
        resultCode: "AMBIGUOUS_TOOL_RECOVERY"
      });
    }
  }
  const checkpoint = recoverCheckpoint(
    state.checkpoint,
    recoveredExchangeReceipts,
    recoveredToolReceipts
  );
  return sanitizeAgentSupervisorPersistenceState({
    ...state,
    checkpoint,
    exchangeReceipts: recoveredExchangeReceipts,
    toolOperationReceipts: recoveredToolReceipts
  });
}

export function summarizeAgentSupervisorPersistenceState(
  rawState: AgentSupervisorPersistenceStateV2
): AgentExecutionSummaryV2 {
  const state = sanitizeAgentSupervisorPersistenceState(rawState);
  const latestExchange = latestReceiptByUpdatedAt(state.exchangeReceipts);
  const latestTool = latestReceiptByUpdatedAt(state.toolOperationReceipts);
  const hasAmbiguousExchange = latestReceiptsByKey(
    state.exchangeReceipts,
    (receipt) => receipt.stableCallKey
  ).some((receipt) => receipt.state === "ambiguous")
    || state.checkpoint?.activeExchange?.state === "ambiguous";
  const hasAmbiguousTool = latestReceiptsByKey(
    state.toolOperationReceipts,
    (receipt) => receipt.externalCallId
  ).some((receipt) => receipt.state === "ambiguous")
    || state.checkpoint?.activeToolCall?.state === "ambiguous";
  const activeExchange = latestExchange?.state === "prepared" || latestExchange?.state === "in_flight";
  const activeTool = latestTool?.state === "reserved" || latestTool?.state === "in_flight";
  const finishState = state.finishReceipt?.state ?? null;

  let sessionStatus: AgentExecutionSessionStatus;
  let recoveryStatus: AgentExecutionRecoveryStatus;
  let pendingOperation: AgentExecutionSummaryV2["pendingOperation"] = null;
  if (finishState === "final_persisted") {
    sessionStatus = "completed";
    recoveryStatus = "complete";
  } else if (hasAmbiguousExchange || hasAmbiguousTool) {
    sessionStatus = "recovery_required";
    recoveryStatus = "ambiguous";
  } else if (finishState === "verified") {
    sessionStatus = "finishing";
    recoveryStatus = canResume(state) ? "resumable" : "recovery_required";
    pendingOperation = "final_message";
  } else if (activeTool) {
    sessionStatus = "active";
    recoveryStatus = "ready";
    pendingOperation = "tool_call";
  } else if (activeExchange) {
    sessionStatus = "active";
    recoveryStatus = "ready";
    pendingOperation = "engine_exchange";
  } else if (state.checkpoint) {
    sessionStatus = "checkpointed";
    recoveryStatus = canResume(state) ? "resumable" : "ready";
  } else {
    sessionStatus = "bound";
    recoveryStatus = "ready";
  }

  return {
    schemaVersion: 2,
    executionProfile: state.binding.executionProfile,
    engineId: state.binding.engineId,
    engineAdapterId: state.binding.engineAdapterId,
    backendId: state.binding.backendId,
    modelId: state.binding.modelId,
    protocolVersion: state.binding.protocolVersion,
    cliVersion: state.binding.cliVersion,
    toolIsolation: state.binding.toolIsolation,
    qualificationStatus: state.binding.qualificationStatus,
    capabilityEvidenceHash: state.binding.capabilityEvidenceHash,
    capabilityProfileHash: state.binding.capabilityProfileHash,
    toolCatalogHash: state.binding.toolCatalogHash,
    sessionStatus,
    recoveryStatus,
    sessionEpoch: state.checkpoint?.sessionEpoch ?? state.binding.sessionEpoch,
    externalSessionBound: Boolean(
      state.checkpoint?.externalSessionId ?? state.binding.externalSessionId
    ),
    lastCheckpointId: state.checkpoint?.checkpointId ?? null,
    pendingOperation,
    finishState,
    boundAt: state.binding.boundAt,
    updatedAt: state.updatedAt
  };
}

export class AgentSupervisorPersistenceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AgentSupervisorPersistenceError";
  }
}

function recoverCheckpoint(
  checkpoint: AgentEngineCheckpoint | null,
  exchangeReceipts: readonly AgentEngineExchangeReceiptV2[],
  toolReceipts: readonly AgentToolOperationReceiptV2[]
): AgentEngineCheckpoint | null {
  if (!checkpoint) return null;
  const exchangeReceipt = checkpoint.activeExchange
    ? latestExchangeReceipt(exchangeReceipts, checkpoint.activeExchange.stableCallKey)
    : undefined;
  const toolReceipt = checkpoint.activeToolCall
    ? latestToolReceipt(toolReceipts, checkpoint.activeToolCall.externalCallId)
    : undefined;
  return {
    ...checkpoint,
    activeExchange: checkpoint.activeExchange?.state === "in_flight"
      ? {
          ...checkpoint.activeExchange,
          state: terminalExchangeState(exchangeReceipt) ?? "ambiguous"
        }
      : checkpoint.activeExchange,
    activeToolCall: checkpoint.activeToolCall?.state === "in_flight"
      ? {
          ...checkpoint.activeToolCall,
          state: terminalToolState(toolReceipt) ?? "ambiguous"
        }
      : checkpoint.activeToolCall
  };
}

function terminalExchangeState(
  receipt: AgentEngineExchangeReceiptV2 | undefined
): "completed" | "failed" | undefined {
  return receipt?.state === "completed" || receipt?.state === "failed"
    ? receipt.state
    : undefined;
}

function terminalToolState(
  receipt: AgentToolOperationReceiptV2 | undefined
): "completed" | "failed" | undefined {
  return receipt?.state === "completed" || receipt?.state === "failed"
    ? receipt.state
    : undefined;
}

function canResume(state: AgentSupervisorPersistenceStateV2): boolean {
  return Boolean(state.checkpoint?.externalSessionId ?? state.binding.externalSessionId);
}

function recoveredFinishReceipt(
  state: AgentSupervisorPersistenceStateV2,
  finalization: RecoveredFinishFinalizationV2
): FinishReceiptV2 {
  const currentEpoch = state.checkpoint?.sessionEpoch ?? state.binding.sessionEpoch;
  if (
    state.binding.runId !== finalization.runId
    || state.binding.bindingId !== finalization.bindingId
  ) {
    throw new AgentSupervisorPersistenceError(
      "FINISH_RECEIPT_MISMATCH",
      "Recovered finish finalization does not belong to the durable binding."
    );
  }
  if (currentEpoch !== finalization.recoverySessionEpoch) {
    throw new AgentSupervisorPersistenceError(
      "SESSION_EPOCH_MISMATCH",
      "Recovered finish finalization is not authorized by the current durable epoch."
    );
  }
  const receipt = state.finishReceipt;
  if (
    !receipt
    || receipt.receiptId !== finalization.receiptId
    || receipt.receiptHash !== finalization.receiptHash
    || receipt.sessionEpoch !== finalization.originSessionEpoch
  ) {
    throw new AgentSupervisorPersistenceError(
      "FINISH_RECEIPT_MISMATCH",
      "Recovered finish finalization does not match the immutable verified receipt."
    );
  }
  const finishCheckpoint = state.checkpoint?.finishReceipt;
  if (
    !finishCheckpoint
    || finishCheckpoint.receiptId !== receipt.receiptId
    || finishCheckpoint.receiptHash !== receipt.receiptHash
    || (receipt.state === "verified" && finishCheckpoint.state !== "verified")
  ) {
    throw new AgentSupervisorPersistenceError(
      "FINISH_CHECKPOINT_MISMATCH",
      "The exact successor checkpoint does not carry the verified finish receipt."
    );
  }
  const finals = (state.eventOutbox ?? []).filter(
    (event): event is Extract<AgentRunEventV2, { type: "final" }> => event.type === "final"
  );
  if (finals.length !== 1) {
    throw new AgentSupervisorPersistenceError(
      "RECOVERED_FINAL_CARDINALITY_INVALID",
      "Recovered finish finalization requires exactly one durable final event."
    );
  }
  const finalEvent = finals[0]!;
  if (
    finalEvent.payload.finishReceiptId !== receipt.receiptId
    || finalEvent.payload.finishReceiptHash !== receipt.receiptHash
    || hashFinalMessage(finalEvent) !== finalization.finalMessageHash
  ) {
    throw new AgentSupervisorPersistenceError(
      "RECOVERED_FINAL_MISMATCH",
      "The durable final event does not match the verified finish receipt."
    );
  }
  if (receipt.state === "final_persisted") {
    if (
      receipt.finalMessageHash !== finalization.finalMessageHash
      || receipt.finalPersistedAt !== finalization.finalPersistedAt
    ) {
      throw new AgentSupervisorPersistenceError(
        "FINISH_RECEIPT_CONFLICT",
        "Recovered finish was already finalized with different terminal data."
      );
    }
    return receipt;
  }
  return finishReceiptV2Schema.parse({
    ...receipt,
    state: "final_persisted",
    finalMessageHash: finalization.finalMessageHash,
    finalPersistedAt: finalization.finalPersistedAt
  });
}

function hashFinalMessage(
  event: Extract<AgentRunEventV2, { type: "final" }>
): string {
  const canonical = canonicalJson({ messageId: event.messageId, text: event.payload.text });
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function assertCheckpointMatchesBinding(
  checkpoint: AgentEngineCheckpoint,
  binding: AgentSessionBinding
): void {
  if (checkpoint.runId !== binding.runId || checkpoint.bindingId !== binding.bindingId) {
    throw new AgentSupervisorPersistenceError(
      "CHECKPOINT_BINDING_MISMATCH",
      `Checkpoint ${checkpoint.checkpointId} does not belong to the run binding.`
    );
  }
  if (checkpoint.sessionEpoch < binding.sessionEpoch) {
    throw new AgentSupervisorPersistenceError(
      "SESSION_EPOCH_REGRESSION",
      `Checkpoint ${checkpoint.checkpointId} regresses the session epoch.`
    );
  }
  if (
    binding.externalSessionId !== null
    && checkpoint.externalSessionId !== binding.externalSessionId
  ) {
    throw new AgentSupervisorPersistenceError(
      "EXTERNAL_SESSION_MISMATCH",
      `Checkpoint ${checkpoint.checkpointId} refers to a different external session.`
    );
  }
}

function assertReceiptMatchesBinding(
  receipt: {
    runId: string;
    bindingId: string;
    sessionEpoch: number;
  },
  binding: AgentSessionBinding
): void {
  if (receipt.runId !== binding.runId || receipt.bindingId !== binding.bindingId) {
    throw new AgentSupervisorPersistenceError(
      "RECEIPT_BINDING_MISMATCH",
      "Receipt does not belong to the durable run binding."
    );
  }
  if (receipt.sessionEpoch < binding.sessionEpoch) {
    throw new AgentSupervisorPersistenceError(
      "SESSION_EPOCH_REGRESSION",
      "Receipt regresses the durable session epoch."
    );
  }
}

function assertCurrentSessionEpoch(
  sessionEpoch: number,
  state: AgentSupervisorPersistenceStateV2
): void {
  const currentEpoch = state.checkpoint?.sessionEpoch ?? state.binding.sessionEpoch;
  if (sessionEpoch !== currentEpoch) {
    throw new AgentSupervisorPersistenceError(
      "SESSION_EPOCH_MISMATCH",
      "Receipt does not belong to the current durable session epoch."
    );
  }
}

function assertStableReceiptIdentity<T extends object>(
  previous: T,
  next: T,
  keys: readonly (keyof T)[]
): void {
  for (const key of keys) {
    if (canonicalJson(previous[key]) !== canonicalJson(next[key])) {
      throw new AgentSupervisorPersistenceError(
        "RECEIPT_IDENTITY_CONFLICT",
        `Receipt field ${String(key)} cannot change across state transitions.`
      );
    }
  }
}

function assertForwardTransition<TState extends string>(
  label: string,
  previous: TState,
  next: TState,
  allowed: Record<TState, readonly TState[]>
): void {
  if (!allowed[previous].includes(next)) {
    throw new AgentSupervisorPersistenceError(
      "RECEIPT_STATE_REGRESSION",
      `Invalid ${label} receipt transition ${previous} -> ${next}.`
    );
  }
}

function assertNonRegressingTimestamp(
  previous: string,
  next: string,
  label: string
): void {
  if (next < previous) {
    throw new AgentSupervisorPersistenceError(
      "RECEIPT_TIMESTAMP_REGRESSION",
      `${label} updatedAt cannot move backwards.`
    );
  }
}

function assertUniqueReceiptId(
  receipts: readonly { receiptId: string }[],
  receiptId: string,
  label: string
): void {
  if (receipts.some((receipt) => receipt.receiptId === receiptId)) {
    throw new AgentSupervisorPersistenceError(
      "RECEIPT_ID_REUSE",
      `${label} ID ${receiptId} is already used by another stable call.`
    );
  }
}

function latestExchangeReceipt(
  receipts: readonly AgentEngineExchangeReceiptV2[],
  stableCallKey: string
): AgentEngineExchangeReceiptV2 | undefined {
  for (let index = receipts.length - 1; index >= 0; index -= 1) {
    const receipt = receipts[index];
    if (receipt?.stableCallKey === stableCallKey) return receipt;
  }
  return undefined;
}

function latestToolReceipt(
  receipts: readonly AgentToolOperationReceiptV2[],
  externalCallId: string
): AgentToolOperationReceiptV2 | undefined {
  for (let index = receipts.length - 1; index >= 0; index -= 1) {
    const receipt = receipts[index];
    if (receipt?.externalCallId === externalCallId) return receipt;
  }
  return undefined;
}

function latestReceiptByUpdatedAt<T extends { updatedAt: string }>(
  receipts: readonly T[]
): T | undefined {
  return receipts.reduce<T | undefined>(
    (latest, receipt) => !latest || receipt.updatedAt >= latest.updatedAt ? receipt : latest,
    undefined
  );
}

function latestReceiptsByKey<T>(
  receipts: readonly T[],
  keyFor: (receipt: T) => string
): T[] {
  const latest = new Map<string, T>();
  for (const receipt of receipts) latest.set(keyFor(receipt), receipt);
  return [...latest.values()];
}

function maxTimestamp(left: string, right: string): string {
  return left >= right ? left : right;
}

function cloneState(
  state: AgentSupervisorPersistenceStateV2
): AgentSupervisorPersistenceStateV2 {
  return structuredClone(state);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
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
