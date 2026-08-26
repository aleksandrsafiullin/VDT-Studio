import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  AgentRunEventOutbox,
  AgentSupervisorPersistenceError,
  agentEngineCheckpointSchema,
  agentEngineExchangeReceiptV2Schema,
  agentRunEventV2Schema,
  agentSessionBindingSchema,
  agentToolOperationReceiptV2Schema,
  finishReceiptV2Schema,
  recoveredFinishFinalizationV2Schema,
  sanitizeAgentSupervisorPersistenceState,
  summarizeAgentSupervisorPersistenceState,
  type AgentEngineCheckpoint,
  type AgentEngineExchangeReceiptV2,
  type AgentExecutionSummaryV2,
  type AgentRunEventV2,
  type AgentSessionBinding,
  type AgentSupervisorPersistence,
  type AgentSupervisorPersistenceStateV2,
  type AgentToolOperationReceiptV2,
  type FinishReceiptV2,
  type RecoveredFinishFinalizationV2
} from "@vdt-studio/vdt-agent-runtime";
import { canonicalizeJson, type JsonValue } from "@vdt-studio/storage";
import { openAgentRunPersistenceDatabase } from "./persistence";

type Row = Record<string, unknown>;

const DEFAULT_FENCE_LEASE_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_ATTEMPT_LEASE_MS = 30_000;

interface SqliteAgentSupervisorPersistenceOptions {
  now?: (() => string) | undefined;
  fenceLeaseMs?: number | undefined;
  attemptLeaseMs?: number | undefined;
  fenceTokenFactory?: (() => string) | undefined;
}

interface EpochFence {
  sessionEpoch: number;
  token: string;
  generation: number;
  expiresAt: string;
}

/**
 * Normalized Sequence 4 authority for one Supervisor lifetime. The per-instance
 * expected epoch is deliberate: an old Supervisor cannot observe a newer epoch
 * and accidentally stamp its epoch-less outbox callback with fresh authority.
 */
export class SqliteAgentSupervisorPersistence implements AgentSupervisorPersistence {
  private readonly db: DatabaseSync;
  private readonly now: () => string;
  private readonly fenceLeaseMs: number;
  private readonly attemptLeaseMs: number;
  private readonly fenceTokenFactory: () => string;
  private readonly expectedEventEpochs = new Map<string, number>();
  private closed = false;

  constructor(
    databasePath: string,
    options: SqliteAgentSupervisorPersistenceOptions = {}
  ) {
    this.db = new DatabaseSync(databasePath, { timeout: 5_000 });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.now = options.now ?? (() => new Date().toISOString());
    this.fenceLeaseMs = options.fenceLeaseMs ?? DEFAULT_FENCE_LEASE_MS;
    this.attemptLeaseMs = options.attemptLeaseMs ?? DEFAULT_ATTEMPT_LEASE_MS;
    this.fenceTokenFactory = options.fenceTokenFactory ?? (() => `agent-fence:${randomUUID()}`);
    if (!Number.isSafeInteger(this.fenceLeaseMs) || this.fenceLeaseMs <= 0) {
      this.db.close();
      throw new TypeError("fenceLeaseMs must be a positive safe integer.");
    }
    if (!Number.isSafeInteger(this.attemptLeaseMs) || this.attemptLeaseMs <= 0) {
      this.db.close();
      throw new TypeError("attemptLeaseMs must be a positive safe integer.");
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  async load(runId: string): Promise<AgentSupervisorPersistenceStateV2 | null> {
    const state = this.loadState(runId);
    if (state && !this.expectedEventEpochs.has(runId)) {
      this.expectedEventEpochs.set(
        runId,
        state.checkpoint?.sessionEpoch ?? state.binding.sessionEpoch
      );
    }
    return state ? structuredClone(state) : null;
  }

  async createBinding(
    rawBinding: AgentSessionBinding
  ): Promise<AgentSupervisorPersistenceStateV2> {
    const binding = agentSessionBindingSchema.parse(rawBinding);
    const state = this.transaction(() => {
      const stored = this.storedBindingForRun(binding.runId);
      if (stored) {
        const currentEpoch = this.currentEpoch(binding.runId).sessionEpoch;
        if (binding.sessionEpoch !== currentEpoch) {
          throw persistenceError(
            "SESSION_EPOCH_MISMATCH",
            `Binding epoch ${binding.sessionEpoch} does not match current epoch ${currentEpoch}.`
          );
        }
        const effective = { ...stored, sessionEpoch: currentEpoch };
        if (canonicalJson(binding) === canonicalJson(effective)) {
          return this.requireState(binding.runId);
        }
        if (
          stored.externalSessionId === null
          && binding.externalSessionId !== null
          && sameBindingExecutionIdentity(stored, binding)
        ) {
          const finalizedStoredBinding = {
            ...binding,
            sessionEpoch: stored.sessionEpoch
          };
          const canonical = canonicalJson(finalizedStoredBinding);
          this.db.prepare(`
            UPDATE agent_session_bindings_v2
            SET external_session_id = ?, binding_canonical_json = ?, binding_hash = ?
            WHERE run_id = ? AND binding_id = ?
          `).run(
            finalizedStoredBinding.externalSessionId,
            canonical,
            authorityHash("vdt.agent.binding.v2", canonical),
            binding.runId,
            binding.bindingId
          );
          return this.requireState(binding.runId);
        }
        throw persistenceError(
          "SESSION_BINDING_CONFLICT",
          `Run ${binding.runId} already has a different immutable engine binding.`
        );
      }

      const fence = this.newEpochFence(binding.sessionEpoch, 1);
      const canonical = canonicalJson(binding);
      this.db.prepare(`
        INSERT INTO agent_session_bindings_v2
        (run_id, schema_version, binding_id, project_id, execution_profile,
         engine_id, engine_adapter_id, backend_id, model_id, protocol_version,
         cli_version, tool_isolation, qualification_status,
         capability_evidence_hash, settings_hash, capability_profile_hash,
         tool_catalog_hash, external_session_id, session_epoch,
         binding_fence_token, binding_fence_generation,
         binding_fence_expires_at, binding_canonical_json, binding_hash,
         bound_at)
        VALUES (?, 2, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        binding.runId,
        binding.bindingId,
        binding.projectId,
        binding.executionProfile,
        binding.engineId,
        binding.engineAdapterId,
        binding.backendId,
        binding.modelId,
        binding.protocolVersion,
        binding.cliVersion,
        binding.toolIsolation,
        binding.qualificationStatus,
        binding.capabilityEvidenceHash,
        binding.settingsHash,
        binding.capabilityProfileHash,
        binding.toolCatalogHash,
        binding.externalSessionId,
        binding.sessionEpoch,
        fence.token,
        fence.generation,
        fence.expiresAt,
        canonical,
        authorityHash("vdt.agent.binding.v2", canonical),
        binding.boundAt
      );
      return this.requireState(binding.runId);
    });
    this.expectedEventEpochs.set(binding.runId, currentEpoch(state));
    return structuredClone(state);
  }

  async saveCheckpoint(rawCheckpoint: AgentEngineCheckpoint): Promise<void> {
    const checkpoint = agentEngineCheckpointSchema.parse(rawCheckpoint);
    this.transaction(() => {
      const binding = this.requireBinding(checkpoint.runId);
      assertCheckpointBinding(checkpoint, binding);
      const existing = this.db.prepare(`
        SELECT checkpoint_canonical_json
        FROM agent_engine_checkpoints_v2
        WHERE checkpoint_id = ?
      `).get(checkpoint.checkpointId) as Row | undefined;
      const canonical = canonicalJson(checkpoint);
      if (existing) {
        if (requiredString(existing.checkpoint_canonical_json) === canonical) return;
        throw persistenceError(
          "CHECKPOINT_CONFLICT",
          `Checkpoint ${checkpoint.checkpointId} is already bound to different content.`
        );
      }

      const current = this.currentEpoch(checkpoint.runId);
      if (checkpoint.sessionEpoch === current.sessionEpoch + 1) {
        this.insertRecoveryEpoch(checkpoint, current);
      } else if (checkpoint.sessionEpoch !== current.sessionEpoch) {
        throw persistenceError(
          "SESSION_EPOCH_MISMATCH",
          `Checkpoint epoch ${checkpoint.sessionEpoch} is not current or the exact next recovery epoch.`
        );
      }
      const fence = this.acquireWriteAttemptFence(checkpoint.runId, checkpoint.sessionEpoch);
      const latest = this.db.prepare(`
        SELECT checkpoint_id, created_at, checkpoint_canonical_json
        FROM agent_latest_engine_checkpoint_v2
        WHERE run_id = ?
      `).get(checkpoint.runId) as Row | undefined;
      if (latest) {
        const latestAt = requiredString(latest.created_at);
        if (compareTimestamp(checkpoint.createdAt, latestAt) < 0) {
          throw persistenceError(
            "CHECKPOINT_REGRESSION",
            `Checkpoint ${checkpoint.checkpointId} predates the durable checkpoint.`
          );
        }
        if (
          compareTimestamp(checkpoint.createdAt, latestAt) === 0
          && requiredString(latest.checkpoint_canonical_json) !== canonical
        ) {
          throw persistenceError(
            "CHECKPOINT_CONFLICT",
            `Checkpoint timestamp ${checkpoint.createdAt} is already bound to different content.`
          );
        }
      }
      this.db.prepare(`
        INSERT INTO agent_engine_checkpoints_v2
        (checkpoint_id, schema_version, run_id, binding_id, session_epoch,
         external_session_id, last_confirmed_input_cursor,
         last_confirmed_input_hash, last_confirmed_output_cursor,
         last_confirmed_output_hash, active_exchange_id,
         active_exchange_stable_call_key, active_exchange_state,
         active_tool_external_call_id, active_tool_name, active_tool_state,
         finish_receipt_id, finish_receipt_state, finish_receipt_hash,
         write_fence_token, write_fence_generation, write_fence_expires_at,
         checkpoint_canonical_json, checkpoint_hash, created_at)
        VALUES (?, 2, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        checkpoint.checkpointId,
        checkpoint.runId,
        checkpoint.bindingId,
        checkpoint.sessionEpoch,
        checkpoint.externalSessionId,
        checkpoint.lastConfirmedInput?.cursor ?? null,
        checkpoint.lastConfirmedInput?.contentHash ?? null,
        checkpoint.lastConfirmedOutput?.cursor ?? null,
        checkpoint.lastConfirmedOutput?.contentHash ?? null,
        checkpoint.activeExchange?.exchangeId ?? null,
        checkpoint.activeExchange?.stableCallKey ?? null,
        checkpoint.activeExchange?.state ?? null,
        checkpoint.activeToolCall?.externalCallId ?? null,
        checkpoint.activeToolCall?.toolName ?? null,
        checkpoint.activeToolCall?.state ?? null,
        checkpoint.finishReceipt?.receiptId ?? null,
        checkpoint.finishReceipt?.state ?? null,
        checkpoint.finishReceipt?.receiptHash ?? null,
        fence.token,
        fence.generation,
        fence.expiresAt,
        canonical,
        authorityHash("vdt.agent.checkpoint.v2", canonical),
        checkpoint.createdAt
      );
    });
    this.expectedEventEpochs.set(checkpoint.runId, checkpoint.sessionEpoch);
  }

  async appendExchangeReceipt(
    rawReceipt: AgentEngineExchangeReceiptV2
  ): Promise<void> {
    const receipt = agentEngineExchangeReceiptV2Schema.parse(rawReceipt);
    this.transaction(() => {
      this.assertReceiptAuthority(receipt);
      const previous = this.latestExchangeReceipt(receipt.runId, receipt.stableCallKey);
      if (previous) {
        assertStableIdentity(previous, receipt, [
          "receiptId", "runId", "bindingId", "exchangeId", "stableCallKey",
          "sessionEpoch", "inputHash", "startedAt"
        ]);
        assertForwardState("exchange", previous.state, receipt.state, {
          prepared: ["prepared", "in_flight", "completed", "failed", "ambiguous"],
          in_flight: ["in_flight", "completed", "failed", "ambiguous"],
          ambiguous: ["ambiguous", "completed", "failed"],
          completed: ["completed"],
          failed: ["failed"]
        });
        assertTimestampForward(previous.updatedAt, receipt.updatedAt, "exchange receipt");
        if (canonicalJson(previous) === canonicalJson(receipt)) return;
      } else {
        this.assertReceiptIdUnused("agent_engine_exchange_receipts_v2", receipt.runId, receipt.receiptId);
      }
      const sequence = this.nextTransitionSequence(
        "agent_engine_exchange_receipts_v2",
        "stable_call_key",
        receipt.runId,
        receipt.stableCallKey
      );
      const canonical = canonicalJson(receipt);
      const transitionHash = authorityHash("vdt.agent.exchange-receipt.v2", canonical);
      const fence = this.acquireWriteAttemptFence(receipt.runId, receipt.sessionEpoch);
      this.db.prepare(`
        INSERT INTO agent_engine_exchange_receipts_v2
        (transition_id, schema_version, receipt_id, run_id, binding_id,
         exchange_id, stable_call_key, transition_sequence, session_epoch,
         state, input_hash, output_hash, result_code, write_fence_token,
         write_fence_generation, write_fence_expires_at,
         receipt_canonical_json, receipt_hash, started_at, updated_at)
        VALUES (?, 2, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        transitionId("exchange", receipt.receiptId, sequence, transitionHash),
        receipt.receiptId,
        receipt.runId,
        receipt.bindingId,
        receipt.exchangeId,
        receipt.stableCallKey,
        sequence,
        receipt.sessionEpoch,
        receipt.state,
        receipt.inputHash,
        receipt.outputHash,
        receipt.resultCode,
        fence.token,
        fence.generation,
        fence.expiresAt,
        canonical,
        transitionHash,
        receipt.startedAt,
        receipt.updatedAt
      );
    });
  }

  async getExchangeReceipt(
    runId: string,
    stableCallKey: string
  ): Promise<AgentEngineExchangeReceiptV2 | null> {
    const receipt = this.latestExchangeReceipt(runId, stableCallKey);
    return receipt ? structuredClone(receipt) : null;
  }

  async appendToolOperationReceipt(
    rawReceipt: AgentToolOperationReceiptV2
  ): Promise<void> {
    const receipt = agentToolOperationReceiptV2Schema.parse(rawReceipt);
    this.transaction(() => {
      this.assertReceiptAuthority(receipt);
      const previous = this.latestToolReceipt(receipt.runId, receipt.externalCallId);
      if (previous) {
        assertStableIdentity(previous, receipt, [
          "receiptId", "runId", "bindingId", "externalCallId", "toolName",
          "idempotencyKey", "sessionEpoch", "argsHash", "expectedRevision",
          "startedAt"
        ]);
        assertForwardState("tool operation", previous.state, receipt.state, {
          reserved: ["reserved", "in_flight", "completed", "failed", "ambiguous"],
          in_flight: ["in_flight", "completed", "failed", "ambiguous"],
          ambiguous: ["ambiguous", "completed", "failed"],
          completed: ["completed"],
          failed: ["failed"]
        });
        assertTimestampForward(previous.updatedAt, receipt.updatedAt, "tool receipt");
        if (canonicalJson(previous) === canonicalJson(receipt)) return;
      } else {
        this.assertReceiptIdUnused("agent_tool_operation_receipts_v2", receipt.runId, receipt.receiptId);
      }
      const sequence = this.nextTransitionSequence(
        "agent_tool_operation_receipts_v2",
        "external_call_id",
        receipt.runId,
        receipt.externalCallId
      );
      const canonical = canonicalJson(receipt);
      const transitionHash = authorityHash("vdt.agent.tool-receipt.v2", canonical);
      const fence = this.acquireWriteAttemptFence(receipt.runId, receipt.sessionEpoch);
      this.db.prepare(`
        INSERT INTO agent_tool_operation_receipts_v2
        (transition_id, schema_version, receipt_id, run_id, binding_id,
         external_call_id, tool_name, idempotency_key, transition_sequence,
         session_epoch, state, args_hash, result_hash, result_code,
         replay_result_json, expected_revision, committed_revision,
         write_fence_token, write_fence_generation, write_fence_expires_at,
         receipt_canonical_json, receipt_hash, started_at, updated_at)
        VALUES (?, 2, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        transitionId("tool", receipt.receiptId, sequence, transitionHash),
        receipt.receiptId,
        receipt.runId,
        receipt.bindingId,
        receipt.externalCallId,
        receipt.toolName,
        receipt.idempotencyKey,
        sequence,
        receipt.sessionEpoch,
        receipt.state,
        receipt.argsHash,
        receipt.resultHash,
        receipt.resultCode,
        receipt.replayResult ? canonicalJson(receipt.replayResult) : null,
        receipt.expectedRevision,
        receipt.committedRevision,
        fence.token,
        fence.generation,
        fence.expiresAt,
        canonical,
        transitionHash,
        receipt.startedAt,
        receipt.updatedAt
      );
    });
  }

  async reserveToolOperationReceipt(
    rawReceipt: AgentToolOperationReceiptV2
  ): Promise<{ acquired: boolean; receipt: AgentToolOperationReceiptV2 }> {
    const receipt = agentToolOperationReceiptV2Schema.parse(rawReceipt);
    if (receipt.state !== "reserved") {
      throw persistenceError(
        "TOOL_RESERVATION_STATE_INVALID",
        "A tool reservation must begin in the reserved state."
      );
    }
    return this.transaction(() => {
      this.assertReceiptAuthority(receipt);
      const previous = this.latestToolReceipt(receipt.runId, receipt.externalCallId);
      if (previous) {
        return { acquired: false, receipt: structuredClone(previous) };
      }
      this.assertReceiptIdUnused(
        "agent_tool_operation_receipts_v2",
        receipt.runId,
        receipt.receiptId
      );
      const canonical = canonicalJson(receipt);
      const transitionHash = authorityHash("vdt.agent.tool-receipt.v2", canonical);
      const fence = this.acquireWriteAttemptFence(receipt.runId, receipt.sessionEpoch);
      this.db.prepare(`
        INSERT INTO agent_tool_operation_receipts_v2
        (transition_id, schema_version, receipt_id, run_id, binding_id,
         external_call_id, tool_name, idempotency_key, transition_sequence,
         session_epoch, state, args_hash, result_hash, result_code,
         replay_result_json, expected_revision, committed_revision,
         write_fence_token, write_fence_generation, write_fence_expires_at,
         receipt_canonical_json, receipt_hash, started_at, updated_at)
        VALUES (?, 2, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        transitionId("tool", receipt.receiptId, 1, transitionHash),
        receipt.receiptId,
        receipt.runId,
        receipt.bindingId,
        receipt.externalCallId,
        receipt.toolName,
        receipt.idempotencyKey,
        receipt.sessionEpoch,
        receipt.state,
        receipt.argsHash,
        receipt.resultHash,
        receipt.resultCode,
        receipt.replayResult ? canonicalJson(receipt.replayResult) : null,
        receipt.expectedRevision,
        receipt.committedRevision,
        fence.token,
        fence.generation,
        fence.expiresAt,
        canonical,
        transitionHash,
        receipt.startedAt,
        receipt.updatedAt
      );
      return { acquired: true, receipt: structuredClone(receipt) };
    });
  }

  async getToolOperationReceipt(
    runId: string,
    externalCallId: string
  ): Promise<AgentToolOperationReceiptV2 | null> {
    const receipt = this.latestToolReceipt(runId, externalCallId);
    return receipt ? structuredClone(receipt) : null;
  }

  async appendFinishReceipt(rawReceipt: FinishReceiptV2): Promise<void> {
    const receipt = finishReceiptV2Schema.parse(rawReceipt);
    this.transaction(() => {
      this.assertReceiptAuthority(receipt);
      const previous = this.latestFinishReceipt(receipt.runId);
      if (previous) {
        assertStableIdentity(previous, receipt, [
          "receiptId", "runId", "bindingId", "sessionEpoch", "receiptHash",
          "projectRevision", "projectHash", "validationHash", "calculationHash",
          "verifiedAt"
        ]);
        assertForwardState("finish", previous.state, receipt.state, {
          verified: ["verified", "final_persisted"],
          final_persisted: ["final_persisted"]
        });
        if (canonicalJson(previous) === canonicalJson(receipt)) return;
      }
      const sequence = previous ? 2 : 1;
      const canonical = canonicalJson(receipt);
      const transitionHash = authorityHash("vdt.agent.finish-receipt.v2", canonical);
      const fence = this.acquireWriteAttemptFence(receipt.runId, receipt.sessionEpoch);
      this.db.prepare(`
        INSERT INTO agent_finish_receipts_v2
        (transition_id, schema_version, receipt_id, run_id, binding_id,
         transition_sequence, session_epoch, authorization_epoch, state, receipt_hash,
         project_revision, project_hash, validation_hash, calculation_hash,
         final_message_hash, write_fence_token, write_fence_generation,
         write_fence_expires_at, receipt_canonical_json, transition_hash,
         verified_at, final_persisted_at)
        VALUES (?, 2, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        transitionId("finish", receipt.receiptId, sequence, transitionHash),
        receipt.receiptId,
        receipt.runId,
        receipt.bindingId,
        sequence,
        receipt.sessionEpoch,
        receipt.sessionEpoch,
        receipt.state,
        receipt.receiptHash,
        receipt.projectRevision,
        receipt.projectHash,
        receipt.validationHash,
        receipt.calculationHash,
        receipt.finalMessageHash,
        fence.token,
        fence.generation,
        fence.expiresAt,
        canonical,
        transitionHash,
        receipt.verifiedAt,
        receipt.finalPersistedAt
      );
    });
  }

  async finalizeRecoveredFinish(
    rawFinalization: RecoveredFinishFinalizationV2
  ): Promise<FinishReceiptV2> {
    const finalization = recoveredFinishFinalizationV2Schema.parse(rawFinalization);
    return this.transaction(() => {
      const binding = this.requireBinding(finalization.runId);
      if (binding.bindingId !== finalization.bindingId) {
        throw persistenceError(
          "FINISH_RECEIPT_MISMATCH",
          "Recovered finish finalization does not belong to the durable binding."
        );
      }
      const current = this.currentEpoch(finalization.runId);
      if (current.sessionEpoch !== finalization.recoverySessionEpoch) {
        throw persistenceError(
          "SESSION_EPOCH_MISMATCH",
          "Recovered finish finalization is not authorized by the current durable epoch."
        );
      }
      const receipt = this.latestFinishReceipt(finalization.runId);
      if (
        !receipt
        || receipt.receiptId !== finalization.receiptId
        || receipt.receiptHash !== finalization.receiptHash
        || receipt.sessionEpoch !== finalization.originSessionEpoch
      ) {
        throw persistenceError(
          "FINISH_RECEIPT_MISMATCH",
          "Recovered finish finalization does not match the immutable verified receipt."
        );
      }
      const checkpointRow = this.db.prepare(`
        SELECT checkpoint_canonical_json
        FROM agent_latest_engine_checkpoint_v2
        WHERE run_id = ?
      `).get(finalization.runId) as Row | undefined;
      const checkpoint = checkpointRow
        ? agentEngineCheckpointSchema.parse(parseJson(checkpointRow.checkpoint_canonical_json))
        : null;
      if (
        !checkpoint
        || checkpoint.sessionEpoch !== finalization.recoverySessionEpoch
        || checkpoint.finishReceipt?.receiptId !== receipt.receiptId
        || checkpoint.finishReceipt.receiptHash !== receipt.receiptHash
        || (receipt.state === "verified" && checkpoint.finishReceipt.state !== "verified")
      ) {
        throw persistenceError(
          "FINISH_CHECKPOINT_MISMATCH",
          "The exact successor checkpoint does not carry the verified finish receipt."
        );
      }
      const finalRows = this.db.prepare(`
        SELECT session_epoch, event_canonical_json
        FROM agent_run_event_outbox_v2
        WHERE run_id = ? AND event_type = 'final'
        ORDER BY sequence
      `).all(finalization.runId) as Row[];
      if (finalRows.length !== 1) {
        throw persistenceError(
          "RECOVERED_FINAL_CARDINALITY_INVALID",
          "Recovered finish finalization requires exactly one durable final event."
        );
      }
      const finalRow = finalRows[0]!;
      const finalEvent = agentRunEventV2Schema.parse(parseJson(finalRow.event_canonical_json));
      if (
        finalEvent.type !== "final"
        || requiredNumber(finalRow.session_epoch) !== finalization.recoverySessionEpoch
        || finalEvent.payload.finishReceiptId !== receipt.receiptId
        || finalEvent.payload.finishReceiptHash !== receipt.receiptHash
        || plainHash({ messageId: finalEvent.messageId, text: finalEvent.payload.text })
          !== finalization.finalMessageHash
      ) {
        throw persistenceError(
          "RECOVERED_FINAL_MISMATCH",
          "The current recovery owner did not persist the one matching final event."
        );
      }
      const completed = finishReceiptV2Schema.parse({
        ...receipt,
        state: "final_persisted",
        finalMessageHash: finalization.finalMessageHash,
        finalPersistedAt: finalization.finalPersistedAt
      });
      if (receipt.state === "final_persisted") {
        if (canonicalJson(receipt) !== canonicalJson(completed)) {
          throw persistenceError(
            "FINISH_RECEIPT_CONFLICT",
            "Recovered finish was already finalized with different terminal data."
          );
        }
        return structuredClone(receipt);
      }

      const canonical = canonicalJson(completed);
      const transitionHash = authorityHash("vdt.agent.finish-receipt.v2", canonical);
      const fence = this.acquireWriteAttemptFence(
        finalization.runId,
        finalization.recoverySessionEpoch
      );
      this.db.prepare(`
        INSERT INTO agent_finish_receipts_v2
        (transition_id, schema_version, receipt_id, run_id, binding_id,
         transition_sequence, session_epoch, authorization_epoch, state,
         receipt_hash, project_revision, project_hash, validation_hash,
         calculation_hash, final_message_hash, write_fence_token,
         write_fence_generation, write_fence_expires_at,
         receipt_canonical_json, transition_hash, verified_at,
         final_persisted_at)
        VALUES (?, 2, ?, ?, ?, 2, ?, ?, 'final_persisted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        transitionId("finish", receipt.receiptId, 2, transitionHash),
        receipt.receiptId,
        receipt.runId,
        receipt.bindingId,
        receipt.sessionEpoch,
        finalization.recoverySessionEpoch,
        receipt.receiptHash,
        receipt.projectRevision,
        receipt.projectHash,
        receipt.validationHash,
        receipt.calculationHash,
        completed.finalMessageHash,
        fence.token,
        fence.generation,
        fence.expiresAt,
        canonical,
        transitionHash,
        receipt.verifiedAt,
        completed.finalPersistedAt
      );
      return structuredClone(completed);
    });
  }

  async getFinishReceipt(runId: string): Promise<FinishReceiptV2 | null> {
    const receipt = this.latestFinishReceipt(runId);
    return receipt ? structuredClone(receipt) : null;
  }

  async appendEvent(rawEvent: AgentRunEventV2): Promise<void> {
    const event = agentRunEventV2Schema.parse(rawEvent);
    this.transaction(() => {
      const binding = this.requireBinding(event.runId);
      const events = this.eventsForRun(event.runId);
      const existing = events[event.seq - 1];
      if (existing) {
        if (canonicalJson(existing) === canonicalJson(event)) return;
        throw persistenceError(
          "EVENT_SEQUENCE_CONFLICT",
          `Sequence ${event.seq} is already bound to another durable event.`
        );
      }
      if (event.type === "final" && events.some((candidate) => candidate.type === "final")) {
        throw persistenceError(
          "DUPLICATE_DURABLE_FINAL",
          "A run may persist exactly one final event."
        );
      }
      // Hydration recalculates every hash and validates the full predecessor chain.
      new AgentRunEventOutbox(event.runId, { initialEvents: [...events, event] });
      const expectedEpoch = this.expectedEventEpochs.get(event.runId)
        ?? this.currentEpoch(event.runId).sessionEpoch;
      const fence = this.acquireWriteAttemptFence(event.runId, expectedEpoch);
      const canonical = canonicalJson(event);
      this.db.prepare(`
        INSERT INTO agent_run_event_outbox_v2
        (event_id, schema_version, run_id, binding_id, session_epoch,
         sequence, previous_hash, event_hash, event_type, source, session_id,
         turn_id, correlation_id, message_id, payload_canonical_json,
         event_canonical_json, write_fence_token, write_fence_generation,
         write_fence_expires_at, created_at)
        VALUES (?, 2, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.id,
        event.runId,
        binding.bindingId,
        expectedEpoch,
        event.seq,
        event.previousHash,
        event.hash,
        event.type,
        event.source,
        event.sessionId ?? null,
        event.turnId ?? null,
        event.correlationId ?? null,
        event.messageId ?? null,
        canonicalJson(event.payload),
        canonical,
        fence.token,
        fence.generation,
        fence.expiresAt,
        event.timestamp
      );
    });
  }

  async getEvents(runId: string): Promise<AgentRunEventV2[]> {
    return structuredClone(this.eventsForRun(runId));
  }

  async getExecutionSummary(runId: string): Promise<AgentExecutionSummaryV2 | null> {
    const state = this.loadState(runId);
    return state ? summarizeAgentSupervisorPersistenceState(state) : null;
  }

  private loadState(runId: string): AgentSupervisorPersistenceStateV2 | null {
    const binding = this.bindingForRun(runId);
    if (!binding) return null;
    const checkpointRow = this.db.prepare(`
      SELECT checkpoint_canonical_json
      FROM agent_latest_engine_checkpoint_v2
      WHERE run_id = ?
    `).get(runId) as Row | undefined;
    const checkpoint = checkpointRow
      ? agentEngineCheckpointSchema.parse(parseJson(checkpointRow.checkpoint_canonical_json))
      : null;
    const exchangeReceipts = (this.db.prepare(`
      SELECT receipt_canonical_json
      FROM agent_engine_exchange_receipts_v2
      WHERE run_id = ?
      ORDER BY rowid ASC
    `).all(runId) as Row[]).map((row) =>
      agentEngineExchangeReceiptV2Schema.parse(parseJson(row.receipt_canonical_json))
    );
    const toolOperationReceipts = (this.db.prepare(`
      SELECT receipt_canonical_json
      FROM agent_tool_operation_receipts_v2
      WHERE run_id = ?
      ORDER BY rowid ASC
    `).all(runId) as Row[]).map((row) =>
      agentToolOperationReceiptV2Schema.parse(parseJson(row.receipt_canonical_json))
    );
    const finishReceipt = this.latestFinishReceipt(runId);
    const eventOutbox = this.eventsForRun(runId);
    const updatedAt = latestTimestamp([
      binding.boundAt,
      checkpoint?.createdAt,
      ...exchangeReceipts.map((receipt) => receipt.updatedAt),
      ...toolOperationReceipts.map((receipt) => receipt.updatedAt),
      finishReceipt?.finalPersistedAt ?? finishReceipt?.verifiedAt,
      ...eventOutbox.map((event) => event.timestamp)
    ]);
    return sanitizeAgentSupervisorPersistenceState({
      schemaVersion: 2,
      binding,
      checkpoint,
      exchangeReceipts,
      toolOperationReceipts,
      finishReceipt,
      eventOutbox,
      updatedAt
    });
  }

  private requireState(runId: string): AgentSupervisorPersistenceStateV2 {
    const state = this.loadState(runId);
    if (!state) {
      throw persistenceError(
        "SESSION_BINDING_NOT_FOUND",
        `Run ${runId} has no normalized Sequence 4 binding.`
      );
    }
    return state;
  }

  private bindingForRun(runId: string): AgentSessionBinding | null {
    const stored = this.storedBindingForRun(runId);
    if (!stored) return null;
    return {
      ...stored,
      sessionEpoch: this.currentEpoch(runId).sessionEpoch
    };
  }

  private storedBindingForRun(runId: string): AgentSessionBinding | null {
    const row = this.db.prepare(`
      SELECT binding_canonical_json
      FROM agent_session_bindings_v2
      WHERE run_id = ?
    `).get(runId) as Row | undefined;
    return row
      ? agentSessionBindingSchema.parse(parseJson(row.binding_canonical_json))
      : null;
  }

  private requireBinding(runId: string): AgentSessionBinding {
    const binding = this.bindingForRun(runId);
    if (!binding) {
      throw persistenceError(
        "SESSION_BINDING_NOT_FOUND",
        `Run ${runId} has no normalized Sequence 4 binding.`
      );
    }
    return binding;
  }

  private currentEpoch(runId: string): EpochFence {
    const row = this.db.prepare(`
      SELECT session_epoch, write_fence_token, write_fence_generation,
             write_fence_expires_at
      FROM agent_current_session_epochs_v2
      WHERE run_id = ?
    `).get(runId) as Row | undefined;
    if (!row) {
      throw persistenceError("SESSION_EPOCH_NOT_FOUND", `Run ${runId} has no session epoch.`);
    }
    return {
      sessionEpoch: requiredNumber(row.session_epoch),
      token: requiredString(row.write_fence_token),
      generation: requiredNumber(row.write_fence_generation),
      expiresAt: requiredString(row.write_fence_expires_at)
    };
  }

  private acquireWriteAttemptFence(runId: string, sessionEpoch: number): EpochFence {
    const epochFence = this.currentEpoch(runId);
    if (epochFence.sessionEpoch !== sessionEpoch) {
      throw persistenceError(
        "SESSION_EPOCH_MISMATCH",
        `Callback epoch ${sessionEpoch} does not match current epoch ${epochFence.sessionEpoch}.`
      );
    }
    const now = this.now();
    if (compareTimestamp(epochFence.expiresAt, now) < 0) {
      throw persistenceError(
        "WRITE_FENCE_EXPIRED",
        `The session-epoch ownership fence for run ${runId} has expired.`
      );
    }
    return {
      sessionEpoch,
      token: this.fenceTokenFactory(),
      generation: epochFence.generation,
      expiresAt: new Date(Date.parse(now) + this.attemptLeaseMs).toISOString()
    };
  }

  private insertRecoveryEpoch(
    checkpoint: AgentEngineCheckpoint,
    previous: EpochFence
  ): void {
    const fence = this.newEpochFence(checkpoint.sessionEpoch, previous.generation + 1);
    const epochId = `epoch:${checkpoint.bindingId}:${checkpoint.sessionEpoch}`;
    const startedAt = this.now();
    const epochRecord = {
      schemaVersion: 2,
      epochId,
      runId: checkpoint.runId,
      bindingId: checkpoint.bindingId,
      sessionEpoch: checkpoint.sessionEpoch,
      predecessorEpoch: previous.sessionEpoch,
      startReason: "checkpoint_resume",
      writeFenceToken: fence.token,
      writeFenceGeneration: fence.generation,
      writeFenceExpiresAt: fence.expiresAt,
      externalSessionId: checkpoint.externalSessionId,
      startedAt
    } as const;
    const canonical = canonicalJson(epochRecord);
    this.db.prepare(`
      INSERT INTO agent_session_epochs_v2
      (epoch_id, schema_version, run_id, binding_id, session_epoch,
       predecessor_epoch, start_reason, write_fence_token,
       write_fence_generation, write_fence_expires_at,
       epoch_canonical_json, epoch_hash, started_at)
      VALUES (?, 2, ?, ?, ?, ?, 'checkpoint_resume', ?, ?, ?, ?, ?, ?)
    `).run(
      epochId,
      checkpoint.runId,
      checkpoint.bindingId,
      checkpoint.sessionEpoch,
      previous.sessionEpoch,
      fence.token,
      fence.generation,
      fence.expiresAt,
      canonical,
      authorityHash("vdt.agent.session-epoch.v2", canonical),
      startedAt
    );
  }

  private assertReceiptAuthority(receipt: {
    runId: string;
    bindingId: string;
    sessionEpoch: number;
  }): void {
    const binding = this.requireBinding(receipt.runId);
    if (binding.bindingId !== receipt.bindingId) {
      throw persistenceError(
        "RECEIPT_BINDING_MISMATCH",
        "Receipt does not belong to the immutable run binding."
      );
    }
    const current = this.currentEpoch(receipt.runId);
    if (current.sessionEpoch !== receipt.sessionEpoch) {
      throw persistenceError(
        "SESSION_EPOCH_MISMATCH",
        `Callback epoch ${receipt.sessionEpoch} does not match current epoch ${current.sessionEpoch}.`
      );
    }
  }

  private latestExchangeReceipt(
    runId: string,
    stableCallKey: string
  ): AgentEngineExchangeReceiptV2 | null {
    const row = this.db.prepare(`
      SELECT receipt_canonical_json
      FROM agent_latest_engine_exchange_receipts_v2
      WHERE run_id = ? AND stable_call_key = ?
    `).get(runId, stableCallKey) as Row | undefined;
    return row
      ? agentEngineExchangeReceiptV2Schema.parse(parseJson(row.receipt_canonical_json))
      : null;
  }

  private latestToolReceipt(
    runId: string,
    externalCallId: string
  ): AgentToolOperationReceiptV2 | null {
    const row = this.db.prepare(`
      SELECT receipt_canonical_json
      FROM agent_latest_tool_operation_receipts_v2
      WHERE run_id = ? AND external_call_id = ?
    `).get(runId, externalCallId) as Row | undefined;
    return row
      ? agentToolOperationReceiptV2Schema.parse(parseJson(row.receipt_canonical_json))
      : null;
  }

  private latestFinishReceipt(runId: string): FinishReceiptV2 | null {
    const row = this.db.prepare(`
      SELECT receipt_canonical_json
      FROM agent_latest_finish_receipts_v2
      WHERE run_id = ?
    `).get(runId) as Row | undefined;
    return row
      ? finishReceiptV2Schema.parse(parseJson(row.receipt_canonical_json))
      : null;
  }

  private eventsForRun(runId: string): AgentRunEventV2[] {
    const events = (this.db.prepare(`
      SELECT event_canonical_json
      FROM agent_run_event_outbox_v2
      WHERE run_id = ?
      ORDER BY sequence ASC
    `).all(runId) as Row[]).map((row) =>
      agentRunEventV2Schema.parse(parseJson(row.event_canonical_json))
    );
    if (events.length > 0) new AgentRunEventOutbox(runId, { initialEvents: events });
    return events;
  }

  private assertReceiptIdUnused(table: string, runId: string, receiptId: string): void {
    if (!new Set([
      "agent_engine_exchange_receipts_v2",
      "agent_tool_operation_receipts_v2"
    ]).has(table)) {
      throw new TypeError("Unsupported receipt table.");
    }
    const row = this.db.prepare(`
      SELECT 1 AS present FROM ${table}
      WHERE run_id = ? AND receipt_id = ? LIMIT 1
    `).get(runId, receiptId) as Row | undefined;
    if (row) {
      throw persistenceError(
        "RECEIPT_ID_REUSE",
        `Receipt ID ${receiptId} is already used by another stable call.`
      );
    }
  }

  private nextTransitionSequence(
    table: string,
    keyColumn: string,
    runId: string,
    key: string
  ): number {
    const allowed = new Map([
      ["agent_engine_exchange_receipts_v2", "stable_call_key"],
      ["agent_tool_operation_receipts_v2", "external_call_id"]
    ]);
    if (allowed.get(table) !== keyColumn) throw new TypeError("Unsupported transition table.");
    const row = this.db.prepare(`
      SELECT COALESCE(MAX(transition_sequence), 0) AS current_sequence
      FROM ${table}
      WHERE run_id = ? AND ${keyColumn} = ?
    `).get(runId, key) as Row;
    return requiredNumber(row.current_sequence) + 1;
  }

  private newEpochFence(sessionEpoch: number, generation: number): EpochFence {
    return {
      sessionEpoch,
      token: this.fenceTokenFactory(),
      generation,
      expiresAt: new Date(Date.parse(this.now()) + this.fenceLeaseMs).toISOString()
    };
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const result = operation();
      this.db.exec("COMMIT;");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK;");
      } catch {
        // Preserve the original authority error.
      }
      if (error instanceof AgentSupervisorPersistenceError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("agent_session_epoch_stale")) {
        throw persistenceError("SESSION_EPOCH_MISMATCH", message);
      }
      throw persistenceError("SQLITE_AGENT_AUTHORITY_WRITE_FAILED", message);
    }
  }
}

/** No-fallback dual projection: normalized SQLite is the authority and the
 * existing V1 internal-state remains a compatibility projection for old
 * readers. Event projection is reconciled from the complete authoritative
 * chain so a V1 write failure after a V2 commit cannot make the live outbox
 * reuse an already-durable sequence number. */
export class ProjectedAgentSupervisorPersistence implements AgentSupervisorPersistence {
  constructor(
    private readonly primary: AgentSupervisorPersistence,
    private readonly legacyProjection: AgentSupervisorPersistence
  ) {}

  async load(runId: string) {
    const state = await this.primary.load(runId);
    if (state) await this.tryReconcileEventProjection(runId);
    return state;
  }

  async createBinding(binding: AgentSessionBinding) {
    const state = await this.primary.createBinding(binding);
    const legacy = await this.legacyProjection.load(binding.runId);
    if (!legacy) {
      await this.legacyProjection.createBinding(binding);
    } else if (!sameBindingExecutionIdentity(legacy.binding, binding)) {
      // Delegate the conflict so the compatibility projection keeps its
      // existing error contract.
      await this.legacyProjection.createBinding(binding);
    } else if (
      legacy.binding.externalSessionId === null
      && binding.externalSessionId !== null
    ) {
      await this.legacyProjection.createBinding({
        ...binding,
        sessionEpoch: legacy.binding.sessionEpoch
      });
    }
    return state;
  }

  async saveCheckpoint(checkpoint: AgentEngineCheckpoint) {
    await this.primary.saveCheckpoint(checkpoint);
    await this.legacyProjection.saveCheckpoint(checkpoint);
  }

  async appendExchangeReceipt(receipt: AgentEngineExchangeReceiptV2) {
    await this.primary.appendExchangeReceipt(receipt);
    await this.legacyProjection.appendExchangeReceipt(receipt);
  }

  getExchangeReceipt(runId: string, stableCallKey: string) {
    return this.primary.getExchangeReceipt(runId, stableCallKey);
  }

  async appendToolOperationReceipt(receipt: AgentToolOperationReceiptV2) {
    await this.primary.appendToolOperationReceipt(receipt);
    await this.legacyProjection.appendToolOperationReceipt(receipt);
  }

  async reserveToolOperationReceipt(receipt: AgentToolOperationReceiptV2) {
    const reservation = await this.primary.reserveToolOperationReceipt(receipt);
    if (reservation.acquired) {
      await this.legacyProjection.reserveToolOperationReceipt(receipt);
    }
    return reservation;
  }

  getToolOperationReceipt(runId: string, externalCallId: string) {
    return this.primary.getToolOperationReceipt(runId, externalCallId);
  }

  async appendFinishReceipt(receipt: FinishReceiptV2) {
    await this.primary.appendFinishReceipt(receipt);
    await this.legacyProjection.appendFinishReceipt(receipt);
  }

  async finalizeRecoveredFinish(finalization: RecoveredFinishFinalizationV2) {
    const receipt = await this.primary.finalizeRecoveredFinish(finalization);
    await this.legacyProjection.finalizeRecoveredFinish(finalization);
    return receipt;
  }

  getFinishReceipt(runId: string) { return this.primary.getFinishReceipt(runId); }

  async appendEvent(event: AgentRunEventV2) {
    await this.primary.appendEvent(event);
    // The V2 commit is authoritative. Once it succeeds, surfacing a subsequent
    // compatibility-write error would keep AgentRunEventOutbox behind the
    // durable head and make its next append reuse this sequence. Reconcile the
    // complete chain instead; a replay, next append, or load retries any gap.
    await this.tryReconcileEventProjection(event.runId);
  }

  getEvents(runId: string) { return this.primary.getEvents(runId); }
  getExecutionSummary(runId: string) { return this.primary.getExecutionSummary(runId); }

  async close(): Promise<void> {
    try {
      await this.primary.close?.();
    } finally {
      await this.legacyProjection.close?.();
    }
  }

  private async tryReconcileEventProjection(runId: string): Promise<void> {
    try {
      const authorityEvents = await this.primary.getEvents(runId);
      const projectedEvents = await this.legacyProjection.getEvents(runId);
      if (projectedEvents.length > authorityEvents.length) {
        throw persistenceError(
          "COMPATIBILITY_EVENT_PROJECTION_DIVERGED",
          `Compatibility event projection for ${runId} is ahead of Sequence 4 authority.`
        );
      }
      for (let index = 0; index < projectedEvents.length; index += 1) {
        if (canonicalJson(projectedEvents[index]) !== canonicalJson(authorityEvents[index])) {
          throw persistenceError(
            "COMPATIBILITY_EVENT_PROJECTION_DIVERGED",
            `Compatibility event projection for ${runId} diverges at sequence ${index + 1}.`
          );
        }
      }
      for (let index = projectedEvents.length; index < authorityEvents.length; index += 1) {
        await this.legacyProjection.appendEvent(authorityEvents[index]!);
      }
    } catch {
      // V1 is never mutation authority. Keep the V2 commit and live outbox
      // aligned; deterministic reconciliation is retried at the next bounded
      // event append, same-event replay, or persistence load.
    }
  }
}

/** Opens/migrates the application database once on first Supervisor write.
 * Sequence 4 remains unavailable rather than silently falling back if opening
 * or normalized writes fail. */
export function createLazySqliteAgentSupervisorPersistence(
  projectRoot: string,
  options: SqliteAgentSupervisorPersistenceOptions = {}
): AgentSupervisorPersistence {
  let delegate: SqliteAgentSupervisorPersistence | undefined;
  let closed = false;
  const persistence = (): SqliteAgentSupervisorPersistence => {
    if (closed) {
      throw new AgentSupervisorPersistenceError(
        "SQLITE_AGENT_AUTHORITY_CLOSED",
        "The Supervisor persistence owner has already been closed."
      );
    }
    if (delegate) return delegate;
    const owner = openAgentRunPersistenceDatabase(projectRoot);
    const databasePath = owner.databasePath;
    owner.close();
    delegate = new SqliteAgentSupervisorPersistence(databasePath, options);
    return delegate;
  };
  return {
    load: (runId) => persistence().load(runId),
    createBinding: (binding) => persistence().createBinding(binding),
    saveCheckpoint: (checkpoint) => persistence().saveCheckpoint(checkpoint),
    appendExchangeReceipt: (receipt) => persistence().appendExchangeReceipt(receipt),
    getExchangeReceipt: (runId, stableCallKey) => persistence().getExchangeReceipt(runId, stableCallKey),
    appendToolOperationReceipt: (receipt) => persistence().appendToolOperationReceipt(receipt),
    reserveToolOperationReceipt: (receipt) => persistence().reserveToolOperationReceipt(receipt),
    getToolOperationReceipt: (runId, externalCallId) => persistence().getToolOperationReceipt(runId, externalCallId),
    appendFinishReceipt: (receipt) => persistence().appendFinishReceipt(receipt),
    finalizeRecoveredFinish: (finalization) => persistence().finalizeRecoveredFinish(finalization),
    getFinishReceipt: (runId) => persistence().getFinishReceipt(runId),
    appendEvent: (event) => persistence().appendEvent(event),
    getEvents: (runId) => persistence().getEvents(runId),
    getExecutionSummary: (runId) => persistence().getExecutionSummary(runId),
    close: () => {
      if (closed) return;
      closed = true;
      delegate?.close();
    }
  };
}

export function createLazyProjectedSqliteAgentSupervisorPersistence(
  projectRoot: string,
  legacyProjection: AgentSupervisorPersistence,
  options: SqliteAgentSupervisorPersistenceOptions = {}
): AgentSupervisorPersistence {
  let delegate: ProjectedAgentSupervisorPersistence | undefined;
  let closed = false;
  const persistence = (): ProjectedAgentSupervisorPersistence => {
    if (closed) {
      throw new AgentSupervisorPersistenceError(
        "SQLITE_AGENT_AUTHORITY_CLOSED",
        "The Supervisor persistence owner has already been closed."
      );
    }
    if (delegate) return delegate;
    const owner = openAgentRunPersistenceDatabase(projectRoot);
    const databasePath = owner.databasePath;
    owner.close();
    delegate = new ProjectedAgentSupervisorPersistence(
      new SqliteAgentSupervisorPersistence(databasePath, options),
      legacyProjection
    );
    return delegate;
  };
  return {
    load: (runId) => persistence().load(runId),
    createBinding: (binding) => persistence().createBinding(binding),
    saveCheckpoint: (checkpoint) => persistence().saveCheckpoint(checkpoint),
    appendExchangeReceipt: (receipt) => persistence().appendExchangeReceipt(receipt),
    getExchangeReceipt: (runId, stableCallKey) => persistence().getExchangeReceipt(runId, stableCallKey),
    appendToolOperationReceipt: (receipt) => persistence().appendToolOperationReceipt(receipt),
    reserveToolOperationReceipt: (receipt) => persistence().reserveToolOperationReceipt(receipt),
    getToolOperationReceipt: (runId, externalCallId) => persistence().getToolOperationReceipt(runId, externalCallId),
    appendFinishReceipt: (receipt) => persistence().appendFinishReceipt(receipt),
    finalizeRecoveredFinish: (finalization) => persistence().finalizeRecoveredFinish(finalization),
    getFinishReceipt: (runId) => persistence().getFinishReceipt(runId),
    appendEvent: (event) => persistence().appendEvent(event),
    getEvents: (runId) => persistence().getEvents(runId),
    getExecutionSummary: (runId) => persistence().getExecutionSummary(runId),
    close: async () => {
      if (closed) return;
      closed = true;
      await delegate?.close();
    }
  };
}

function assertCheckpointBinding(
  checkpoint: AgentEngineCheckpoint,
  binding: AgentSessionBinding
): void {
  if (checkpoint.runId !== binding.runId || checkpoint.bindingId !== binding.bindingId) {
    throw persistenceError(
      "CHECKPOINT_BINDING_MISMATCH",
      `Checkpoint ${checkpoint.checkpointId} does not belong to the run binding.`
    );
  }
  if (
    binding.externalSessionId !== null
    && checkpoint.externalSessionId !== binding.externalSessionId
  ) {
    throw persistenceError(
      "EXTERNAL_SESSION_MISMATCH",
      `Checkpoint ${checkpoint.checkpointId} refers to a different external session.`
    );
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

function assertStableIdentity<T extends object>(
  previous: T,
  next: T,
  keys: readonly (keyof T)[]
): void {
  for (const key of keys) {
    if (canonicalJson(previous[key]) !== canonicalJson(next[key])) {
      throw persistenceError(
        "RECEIPT_IDENTITY_CONFLICT",
        `Receipt field ${String(key)} cannot change across state transitions.`
      );
    }
  }
}

function assertForwardState<TState extends string>(
  label: string,
  previous: TState,
  next: TState,
  allowed: Record<TState, readonly TState[]>
): void {
  if (!allowed[previous].includes(next)) {
    throw persistenceError(
      "RECEIPT_STATE_REGRESSION",
      `Invalid ${label} receipt transition ${previous} -> ${next}.`
    );
  }
}

function assertTimestampForward(previous: string, next: string, label: string): void {
  if (compareTimestamp(next, previous) < 0) {
    throw persistenceError(
      "RECEIPT_TIMESTAMP_REGRESSION",
      `${label} updatedAt cannot move backwards.`
    );
  }
}

function currentEpoch(state: AgentSupervisorPersistenceStateV2): number {
  return state.checkpoint?.sessionEpoch ?? state.binding.sessionEpoch;
}

function canonicalJson(value: unknown): string {
  return canonicalizeJson(value as JsonValue);
}

function authorityHash(domain: string, canonical: string): string {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(canonical)
    .digest("hex")}`;
}

function plainHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function transitionId(
  kind: "exchange" | "tool" | "finish",
  receiptId: string,
  sequence: number,
  hash: string
): string {
  return `${kind}-transition:${receiptId}:${sequence}:${hash.slice("sha256:".length, 23)}`;
}

function persistenceError(code: string, message: string): AgentSupervisorPersistenceError {
  return new AgentSupervisorPersistenceError(code, message);
}

function parseJson(value: unknown): unknown {
  return JSON.parse(requiredString(value));
}

function requiredString(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Expected a SQLite text column.");
  return value;
}

function requiredNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError("Expected a SQLite safe-integer column.");
  }
  return value;
}

function compareTimestamp(left: string, right: string): number {
  return Date.parse(left) - Date.parse(right);
}

function latestTimestamp(values: readonly (string | null | undefined)[]): string {
  const defined = values.filter((value): value is string => typeof value === "string");
  if (defined.length === 0) throw new TypeError("Authority state has no timestamp.");
  return defined.reduce((latest, value) =>
    compareTimestamp(value, latest) > 0 ? value : latest
  );
}
