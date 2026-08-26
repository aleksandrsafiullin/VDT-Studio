import { createHash } from "node:crypto";
import {
  agentEngineCheckpointSchema,
  agentSessionBindingSchema,
  type AgentCapabilityProfile,
  type AgentEngineCheckpoint,
  type AgentEngineEvent,
  type AgentEngineStart,
  type AgentExecutionEngine,
  type AgentHumanInput,
  type AgentRunSession,
  type AgentSessionBinding,
  type VdtGatewayToolCall,
  type VdtGatewayToolResult,
  vdtGatewayToolResultSchema
} from "./agent-execution-contracts";
import {
  AgentRunEventOutbox,
  type AgentRunEventV2Draft
} from "./agent-event-outbox";
import type { AgentRunEventV2 } from "./schemas/agent-run-event-v2";
import {
  recoverAgentSupervisorPersistenceState,
  type AgentSupervisorPersistenceStateV2,
  type AgentEngineExchangeReceiptV2,
  type AgentToolOperationReceiptV2,
  type AgentSupervisorPersistence,
  type FinishReceiptV2
} from "./agent-supervisor-persistence";
import {
  VdtToolGateway,
  type VdtFinishCheckResult,
  type VdtFinishRequest,
  type VdtGatewayEventInput,
  type VdtToolGatewayOptions
} from "./tool-gateway";
import { AgentSupervisorToolGatewayLedger } from "./tool-gateway-persistence";

export type VdtRunSupervisorStatus =
  | "idle"
  | "opening"
  | "running"
  | "waiting_user"
  | "waiting_approval"
  | "finishing"
  | "recovery_required"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "closed";

export interface VdtVerifiedFinishResult extends VdtFinishCheckResult {
  receiptId?: string | undefined;
  receiptHash?: string | undefined;
  finishReceipt?: FinishReceiptV2 | undefined;
}

export interface VdtRunSupervisorOptions {
  engine: AgentExecutionEngine;
  binding: AgentSessionBinding;
  gateway: Omit<
    VdtToolGatewayOptions,
    "binding" | "capability" | "emit" | "requestFinish" | "allowUnqualifiedExternalCanary"
  >;
  outbox?: AgentRunEventOutbox | undefined;
  persistence?: AgentSupervisorPersistence | undefined;
  allowUnqualifiedExternalCanary?: boolean | undefined;
  verifyFinish: (request: VdtFinishRequest) => Promise<VdtVerifiedFinishResult>;
  onEphemeralAssistantDelta?: ((input: {
    runId: string;
    sessionId: string;
    messageId: string;
    delta: string;
  }) => void | Promise<void>) | undefined;
  onUsage?: ((metrics: Readonly<Record<string, number | null>>) => void | Promise<void>) | undefined;
  onFinal?: ((input: { text: string; receiptId: string; receiptHash: string }) => void | Promise<void>) | undefined;
}

/**
 * One supervisor instance owns exactly one immutable engine binding. The
 * engine may keep a native process alive or resume the same opaque session,
 * while correctness authority remains in the gateway, checkpoints, and event
 * outbox.
 */
export class VdtRunSupervisor {
  readonly engine: AgentExecutionEngine;
  readonly capability: AgentCapabilityProfile;
  readonly outbox: AgentRunEventOutbox;
  readonly gateway: VdtToolGateway;

  private expectedBinding: AgentSessionBinding;
  private activeBinding: AgentSessionBinding | undefined;
  private readonly persistence: AgentSupervisorPersistence | undefined;
  private readonly verifyFinish: VdtRunSupervisorOptions["verifyFinish"];
  private readonly onEphemeralAssistantDelta?: VdtRunSupervisorOptions["onEphemeralAssistantDelta"];
  private readonly onUsage?: VdtRunSupervisorOptions["onUsage"];
  private readonly onFinal?: VdtRunSupervisorOptions["onFinal"];
  private readonly abortController = new AbortController();
  private session?: AgentRunSession;
  private consumeTask?: Promise<void>;
  private consumerActive = false;
  private verifiedFinish?: { receiptId: string; receiptHash: string };
  private finalCommitStarted = false;
  private lastCheckpointTimestampMs: number | null = null;
  private statusValue: VdtRunSupervisorStatus = "idle";

  constructor(options: VdtRunSupervisorOptions) {
    this.engine = options.engine;
    this.capability = options.engine.capability;
    this.expectedBinding = agentSessionBindingSchema.parse(options.binding);
    this.persistence = options.persistence;
    this.verifyFinish = options.verifyFinish;
    this.onEphemeralAssistantDelta = options.onEphemeralAssistantDelta;
    this.onUsage = options.onUsage;
    this.onFinal = options.onFinal;
    this.outbox = options.outbox ?? new AgentRunEventOutbox(options.binding.runId, {
      ...(options.persistence
        ? { sink: { append: (event) => options.persistence!.appendEvent(event) } }
        : {})
    });

    assertBindingCapability(this.expectedBinding, this.capability);
    assertExternalAdmission(this.capability, options.allowUnqualifiedExternalCanary === true);

    const durableLedger = options.persistence && !options.gateway.ledger
      ? new AgentSupervisorToolGatewayLedger({
          binding: this.expectedBinding,
          persistence: options.persistence,
          getRevision: () => options.gateway.toolContext().builder?.getRevision() ?? null
        })
      : undefined;
    this.gateway = new VdtToolGateway({
      ...options.gateway,
      ...(durableLedger ? { ledger: durableLedger } : {}),
      binding: this.expectedBinding,
      capability: this.capability,
      allowUnqualifiedExternalCanary: options.allowUnqualifiedExternalCanary,
      emit: (event) => this.appendGatewayEvent(event),
      requestFinish: (request) => this.handleFinishRequest(request)
    });
  }

  get runId(): string {
    return this.expectedBinding.runId;
  }

  get status(): VdtRunSupervisorStatus {
    return this.statusValue;
  }

  get binding(): AgentSessionBinding {
    return structuredClone(this.activeBinding ?? this.expectedBinding);
  }

  async start(input: Omit<AgentEngineStart, "binding">): Promise<void> {
    if (this.statusValue !== "idle") {
      throw new VdtRunSupervisorError("RUN_ALREADY_BOUND", "The run supervisor can only open one engine session.");
    }
    this.statusValue = "opening";
    try {
      await this.persistence?.createBinding(this.expectedBinding);
      await this.appendRuntimeStatus("SESSION_OPENING", "Opening the bound agent execution session.", "opening");
      const session = await this.engine.openSession({ ...input, binding: this.expectedBinding }, this.engineHost());
      await this.adoptSession(session, false);
      this.statusValue = "running";
      await this.appendRuntimeStatus("SESSION_STARTED", "The bound agent execution session is running.", "running");
      await this.saveCheckpoint("engine_exchange");
      this.startConsumer();
    } catch (error) {
      this.statusValue = "failed";
      await this.appendError("SESSION_OPEN_FAILED", error, false);
      throw error;
    }
  }

  async recover(checkpointInput: AgentEngineCheckpoint): Promise<void> {
    if (!new Set<VdtRunSupervisorStatus>(["idle", "recovery_required"]).has(this.statusValue)) {
      throw new VdtRunSupervisorError("RUN_NOT_RECOVERABLE", `Cannot recover a run in ${this.statusValue} state.`);
    }
    if (!this.persistence) {
      throw new VdtRunSupervisorError(
        "RECOVERY_PERSISTENCE_REQUIRED",
        "Recovery requires a durable binding, checkpoint, receipts, and event outbox."
      );
    }
    let authorityHydrated = false;
    try {
      const suppliedCheckpoint = agentEngineCheckpointSchema.parse(checkpointInput);
      const loaded = await this.persistence.load(this.runId);
      if (!loaded?.checkpoint) {
        throw new VdtRunSupervisorError(
          "RECOVERY_CHECKPOINT_NOT_FOUND",
          "The run has no durable checkpoint that can fence a session resume."
        );
      }
      this.outbox.hydrateDurable(loaded.eventOutbox ?? []);
      authorityHydrated = true;
      assertRecoveryBinding(this.expectedBinding, loaded.binding);
      if (hashJson(suppliedCheckpoint) !== hashJson(loaded.checkpoint)) {
        throw new VdtRunSupervisorError(
          "RECOVERY_CHECKPOINT_STALE",
          "Recovery must resume from the current durable checkpoint authority."
        );
      }
      const durable = recoverAgentSupervisorPersistenceState(loaded);
      if (!durable.checkpoint) {
        throw new VdtRunSupervisorError(
          "RECOVERY_CHECKPOINT_NOT_FOUND",
          "Recovery normalization removed the required durable checkpoint."
        );
      }
      assertCheckpointBinding(durable.checkpoint, durable.binding);

      const finishRecovery = await this.hydrateFinishRecovery(durable.checkpoint);
      const durableCheckpoint = finishRecovery.checkpoint;
      this.lastCheckpointTimestampMs = Date.parse(durableCheckpoint.createdAt);
      if (finishRecovery.completed) return;
      const reconciledDurable = await this.reconcileVerifiedFinishToolReceipt({
        ...durable,
        checkpoint: durableCheckpoint
      }, finishRecovery.receipt);
      assertRecoveryOperationsSettled(reconciledDurable);
      if (
        finishRecovery.receipt?.state === "verified"
        && finishRecovery.receipt.sessionEpoch < durable.binding.sessionEpoch
      ) {
        throw new VdtRunSupervisorError(
          "FINISH_RECOVERY_RETRY_UNSAFE",
          "The exact successor epoch was already acquired for finish recovery, so another provider resume cannot be fenced safely."
        );
      }

      const nextBinding = agentSessionBindingSchema.parse({
        ...durable.binding,
        sessionEpoch: durable.binding.sessionEpoch + 1
      });
      const checkpointTimestampMs = Math.max(
        Date.now(),
        Date.parse(durableCheckpoint.createdAt) + 1
      );
      const recoveryCheckpoint = agentEngineCheckpointSchema.parse({
        ...durableCheckpoint,
        checkpointId: `recovery-${hashHex(`${durableCheckpoint.checkpointId}\u0000${nextBinding.sessionEpoch}`).slice(0, 40)}`,
        sessionEpoch: nextBinding.sessionEpoch,
        // Terminal bounded attempts remain in their origin-epoch receipts.
        // The successor session starts with clean active slots; unresolved
        // work was rejected above and can only proceed after same-key
        // reconciliation.
        activeExchange: null,
        activeToolCall: null,
        createdAt: new Date(checkpointTimestampMs).toISOString()
      });

      // The exact next durable epoch is committed before provider resume, so
      // callbacks from the prior process are fenced even while resume waits.
      await this.persistence.saveCheckpoint(recoveryCheckpoint);
      await this.persistence.createBinding(nextBinding);
      this.expectedBinding = nextBinding;
      this.activeBinding = undefined;
      this.gateway.advanceSessionBinding(nextBinding);
      this.lastCheckpointTimestampMs = checkpointTimestampMs;
      this.statusValue = "opening";
      await this.appendRuntimeStatus(
        "SESSION_RESUMING",
        "Resuming the same bound agent session from its durable checkpoint.",
        "opening"
      );
      const session = await this.engine.resumeSession(recoveryCheckpoint, this.engineHost());
      await this.adoptSession(session, true);
      this.statusValue = this.verifiedFinish ? "finishing" : "running";
      await this.appendRuntimeStatus(
        "SESSION_RESUMED",
        "Resumed the same bound agent session.",
        this.statusValue
      );
      await this.saveCheckpoint("recovery");
      this.startConsumer();
    } catch (error) {
      this.statusValue = "recovery_required";
      if (authorityHydrated) {
        try {
          await this.appendError("SESSION_RECOVERY_FAILED", error, true);
        } catch {
          // Preserve the recovery failure when the durable authority itself is
          // unavailable; callers still receive the original boundary error.
        }
      }
      throw error;
    }
  }

  async submit(input: AgentHumanInput): Promise<void> {
    const session = this.requireSession();
    const waiting = this.statusValue === "waiting_user" || this.statusValue === "waiting_approval";
    if (!waiting && (this.statusValue !== "running" || input.type !== "user_instruction")) {
      throw new VdtRunSupervisorError(
        "RUN_NOT_WAITING",
        "Question answers require a durable interaction checkpoint; instructions can be queued while the run is active."
      );
    }
    await session.submit(input);
    await this.saveCheckpoint("human_input_accepted");
    if (!waiting) {
      await this.appendRuntimeStatus(
        "HUMAN_INPUT_QUEUED",
        "The instruction will be delivered to the same agent session at its next bounded checkpoint.",
        "running"
      );
      return;
    }
    this.statusValue = "running";
    await this.appendRuntimeStatus("HUMAN_INPUT_ACCEPTED", "The saved input was delivered to the same agent session.", "running");
    this.startConsumer();
  }

  async cancel(reason = "User cancelled the run."): Promise<void> {
    if (isTerminalStatus(this.statusValue) || this.finalCommitStarted) return;
    this.abortController.abort(reason);
    try {
      await this.session?.cancel(reason);
    } finally {
      this.statusValue = "cancelled";
      await this.appendRuntimeStatus("RUN_CANCELLED", "Agent execution was cancelled.", "cancelled");
    }
  }

  async close(): Promise<void> {
    if (this.statusValue === "closed") return;
    await this.session?.close();
    if (!isTerminalStatus(this.statusValue)) this.statusValue = "closed";
  }

  async wait(): Promise<void> {
    await this.consumeTask;
  }

  eventsAfter(sequence: number, limit?: number): AgentRunEventV2[] {
    return this.outbox.readAfter(sequence, limit);
  }

  private engineHost() {
    return {
      signal: this.abortController.signal,
      executeTool: (call: VdtGatewayToolCall): Promise<VdtGatewayToolResult> => this.gateway.execute(call)
    };
  }

  private async adoptSession(session: AgentRunSession, recovery: boolean): Promise<void> {
    const binding = agentSessionBindingSchema.parse(session.binding);
    assertSessionBinding(this.expectedBinding, binding, recovery);
    this.activeBinding = binding;
    this.expectedBinding = binding;
    this.session = session;
    await this.persistence?.createBinding(binding);
  }

  private startConsumer(): void {
    if (this.consumerActive || !this.session || isTerminalStatus(this.statusValue)) return;
    this.consumerActive = true;
    this.consumeTask = this.consume(this.session).finally(() => {
      this.consumerActive = false;
    });
  }

  private async consume(session: AgentRunSession): Promise<void> {
    try {
      for await (const event of session.events()) {
        if (this.abortController.signal.aborted) return;
        await this.handleEngineEvent(event);
        if (isTerminalStatus(this.statusValue) || this.statusValue === "recovery_required") return;
      }
      if (this.statusValue === "running" || this.statusValue === "finishing") {
        this.statusValue = "recovery_required";
        await this.appendWarning(
          "ENGINE_STREAM_INTERRUPTED",
          "The engine stream ended without a durable interaction checkpoint or final event.",
          true
        );
      }
    } catch (error) {
      if (this.abortController.signal.aborted) return;
      this.statusValue = "recovery_required";
      await this.appendError("ENGINE_STREAM_FAILED", error, true);
    }
  }

  private async handleEngineEvent(event: AgentEngineEvent): Promise<void> {
    const source = this.capability.executionProfile === "external_cli_agent"
      ? "external_agent" as const
      : "vdt_agent" as const;
    const sessionId = this.binding.bindingId;

    switch (event.type) {
      case "assistant_message_delta":
        await this.onEphemeralAssistantDelta?.({
          runId: this.runId,
          sessionId,
          messageId: event.messageId,
          delta: event.delta
        });
        return;
      case "assistant_message":
        await this.outbox.append({
          type: "assistant_message",
          source,
          sessionId,
          messageId: event.messageId,
          payload: { text: event.text, format: "markdown", completed: true }
        });
        return;
      case "question": {
        const checkpoint = await this.saveCheckpoint("waiting_user");
        this.statusValue = "waiting_user";
        await this.outbox.append({
          type: "question",
          source,
          sessionId,
          messageId: event.messageId,
          payload: {
            questionSetId: event.questionSetId,
            checkpointId: checkpoint.checkpointId,
            questions: event.questions as never
          }
        });
        return;
      }
      case "tool_request":
        // Native bridges must call host.executeTool. Treat an observed request
        // event as non-authoritative to avoid double execution.
        await this.appendError(
          "ENGINE_TOOL_PROTOCOL_VIOLATION",
          new Error("Engine emitted tool_request instead of using the bound VDT gateway callback."),
          false
        );
        this.statusValue = "failed";
        return;
      case "checkpoint_requested":
        await this.saveCheckpoint(
          event.reason === "manual_reconciliation" ? "manual_reconciliation" : "engine_exchange"
        );
        return;
      case "final":
        await this.acceptFinal(event, source, sessionId);
        return;
      case "transport_error":
        if (event.code === "SECURITY_BOUNDARY_BREACH") {
          await this.stopForSecurityBreach(event.message);
          return;
        }
        this.statusValue = event.retryable ? "recovery_required" : "failed";
        await this.appendError(event.code, new Error(event.message), event.retryable);
        return;
      case "usage":
        await this.onUsage?.(event.metrics);
        return;
      default:
        return assertNever(event);
    }
  }

  private async acceptFinal(
    event: Extract<AgentEngineEvent, { type: "final" }>,
    source: "external_agent" | "vdt_agent",
    sessionId: string
  ): Promise<void> {
    if (this.finalWasCancelled()) return;
    if (!this.verifiedFinish || this.verifiedFinish.receiptId !== event.finishReceiptId) {
      this.statusValue = "recovery_required";
      await this.appendError(
        "FINAL_WITHOUT_VERIFIED_FINISH",
        new Error("Agent final did not reference the currently verified finish receipt."),
        true
      );
      return;
    }
    let durableReceipt: FinishReceiptV2 | null = null;
    if (this.persistence) {
      durableReceipt = await this.persistence.getFinishReceipt(this.runId);
      if (!durableReceipt || durableReceipt.receiptId !== this.verifiedFinish.receiptId) {
        this.statusValue = "recovery_required";
        await this.appendError(
          "FINISH_RECEIPT_NOT_DURABLE",
          new Error("Verified finish receipt is missing from durable supervisor state."),
          true
        );
        return;
      }
    }
    if (this.finalWasCancelled()) return;
    if (!this.gateway.verifiedFinishHeadMatches()) {
      this.statusValue = "recovery_required";
      await this.appendError(
        "FINISH_HEAD_CHANGED",
        new Error("The project head no longer matches the verified finish receipt; success was not committed."),
        true
      );
      return;
    }

    const existingFinals = durableFinalEvents(this.outbox.snapshot());
    if (existingFinals.length > 1) {
      this.statusValue = "recovery_required";
      await this.appendError(
        "DUPLICATE_DURABLE_FINAL",
        new Error("The durable event chain contains more than one final message."),
        true
      );
      return;
    }
    const existingFinal = existingFinals[0];
    if (this.finalWasCancelled()) return;
    // From this point the durable final commit wins over a concurrent cancel;
    // cancellation cannot produce a second contradictory terminal state.
    this.finalCommitStarted = true;
    let finalEvent: Extract<AgentRunEventV2, { type: "final" }>;
    if (existingFinal) {
      try {
        assertFinalMatches(existingFinal, event, this.verifiedFinish);
      } catch (error) {
        this.statusValue = "recovery_required";
        await this.appendError("DUPLICATE_FINAL_CONFLICT", error, true);
        return;
      }
      finalEvent = existingFinal;
    } else {
      const appended = await this.outbox.append({
        type: "final",
        source,
        sessionId,
        messageId: event.messageId,
        payload: {
          text: event.text,
          format: "markdown",
          finishReceiptId: this.verifiedFinish.receiptId,
          finishReceiptHash: this.verifiedFinish.receiptHash
        }
      });
      if (appended.type !== "final") {
        throw new VdtRunSupervisorError("FINAL_EVENT_INVALID", "The durable outbox did not return a final event.");
      }
      finalEvent = appended;
    }
    await this.completeDurableFinal(finalEvent, durableReceipt);
  }

  private async hydrateFinishRecovery(checkpoint: AgentEngineCheckpoint): Promise<{
    checkpoint: AgentEngineCheckpoint;
    completed: boolean;
    receipt: FinishReceiptV2 | null;
  }> {
    const durableEvents = this.persistence
      ? await this.persistence.getEvents(this.runId)
      : this.outbox.snapshot();
    if (this.persistence) this.outbox.hydrateDurable(durableEvents);
    const finals = durableFinalEvents(durableEvents);
    if (finals.length > 1) {
      throw new VdtRunSupervisorError(
        "DUPLICATE_DURABLE_FINAL",
        "Recovery found more than one durable final message."
      );
    }

    const receipt = this.persistence
      ? await this.persistence.getFinishReceipt(this.runId)
      : null;
    if (!receipt) {
      if (checkpoint.finishReceipt || finals.length > 0) {
        throw new VdtRunSupervisorError(
          "FINISH_RECEIPT_NOT_DURABLE",
          "Recovery found finish state without its durable FinishReceiptV2."
        );
      }
      return { checkpoint, completed: false, receipt: null };
    }
    assertFinishReceiptBinding(receipt, this.binding);
    if (checkpoint.finishReceipt) {
      if (
        checkpoint.finishReceipt.receiptId !== receipt.receiptId
        || checkpoint.finishReceipt.receiptHash !== receipt.receiptHash
        || (checkpoint.finishReceipt.state === "final_persisted" && receipt.state !== "final_persisted")
      ) {
        throw new VdtRunSupervisorError(
          "FINISH_CHECKPOINT_MISMATCH",
          "The recovery checkpoint does not match the durable finish receipt."
        );
      }
    }
    this.verifiedFinish = { receiptId: receipt.receiptId, receiptHash: receipt.receiptHash };
    this.gateway.sealVerifiedFinish({
      receiptId: receipt.receiptId,
      projectRevision: receipt.projectRevision,
      projectHash: receipt.projectHash
    });
    const hydratedCheckpoint = agentEngineCheckpointSchema.parse({
      ...checkpoint,
      finishReceipt: {
        receiptId: receipt.receiptId,
        state: receipt.state,
        receiptHash: receipt.receiptHash
      }
    });
    const finalEvent = finals[0];
    if (!finalEvent) {
      if (receipt.state === "final_persisted") {
        throw new VdtRunSupervisorError(
          "DURABLE_FINAL_MISSING",
          "The finish receipt claims a persisted final but the durable final event is missing."
        );
      }
      return { checkpoint: hydratedCheckpoint, completed: false, receipt };
    }
    assertDurableFinalReceipt(finalEvent, receipt);
    await this.completeDurableFinal(finalEvent, receipt);
    return { checkpoint: hydratedCheckpoint, completed: true, receipt };
  }

  private async completeDurableFinal(
    finalEvent: Extract<AgentRunEventV2, { type: "final" }>,
    durableReceipt: FinishReceiptV2 | null
  ): Promise<void> {
    this.finalCommitStarted = true;
    const verified = this.verifiedFinish;
    if (!verified) {
      throw new VdtRunSupervisorError(
        "FINAL_WITHOUT_VERIFIED_FINISH",
        "A durable final cannot complete without a hydrated finish receipt."
      );
    }
    const finalMessageHash = hashJson({ messageId: finalEvent.messageId, text: finalEvent.payload.text });
    if (this.persistence) {
      const receipt = durableReceipt ?? await this.persistence.getFinishReceipt(this.runId);
      if (!receipt) {
        throw new VdtRunSupervisorError(
          "FINISH_RECEIPT_NOT_DURABLE",
          "The durable finish receipt disappeared before final completion."
        );
      }
      assertDurableFinalReceipt(finalEvent, receipt);
      if (receipt.state === "final_persisted") {
        if (receipt.finalMessageHash !== finalMessageHash) {
          throw new VdtRunSupervisorError(
            "FINAL_MESSAGE_HASH_MISMATCH",
            "The persisted finish receipt refers to a different final message."
          );
        }
      } else {
        const finalPersistedAt = new Date(Math.max(
          Date.parse(receipt.verifiedAt),
          Date.parse(finalEvent.timestamp)
        )).toISOString();
        if (this.binding.sessionEpoch === receipt.sessionEpoch) {
          await this.persistence.appendFinishReceipt({
            ...receipt,
            state: "final_persisted",
            finalMessageHash,
            finalPersistedAt
          });
        } else {
          await this.persistence.finalizeRecoveredFinish({
            schemaVersion: 2,
            runId: this.runId,
            bindingId: this.binding.bindingId,
            receiptId: receipt.receiptId,
            receiptHash: receipt.receiptHash,
            originSessionEpoch: receipt.sessionEpoch,
            recoverySessionEpoch: this.binding.sessionEpoch,
            finalMessageHash,
            finalPersistedAt
          });
        }
      }
    }

    const completionAlreadyDurable = this.outbox.snapshot().some((candidate) =>
      candidate.type === "runtime_status" && candidate.payload.code === "RUN_SUCCEEDED"
    );
    if (!completionAlreadyDurable) {
      await this.onFinal?.({
        text: finalEvent.payload.text,
        receiptId: verified.receiptId,
        receiptHash: verified.receiptHash
      });
    }
    this.statusValue = "succeeded";
    if (!completionAlreadyDurable) {
      await this.appendRuntimeStatus("RUN_SUCCEEDED", "The verified VDT run completed.", "succeeded");
    }
  }

  private async handleFinishRequest(request: VdtFinishRequest): Promise<VdtFinishCheckResult> {
    const result = await this.verifyFinish(request);
    if (!result.accepted) return result;
    if (!result.receiptId || !isSha256(result.receiptHash)) {
      return {
        accepted: false,
        code: "INVALID_FINISH_RECEIPT",
        payload: { message: "The deterministic finish verifier did not return a valid receipt identity." }
      };
    }
    const finishReceipt = result.finishReceipt;
    if (this.persistence) {
      if (!finishReceipt) {
        return {
          accepted: false,
          code: "FINISH_RECEIPT_NOT_DURABLE",
          payload: { message: "The deterministic finish verifier did not provide a durable FinishReceiptV2." }
        };
      }
      if (
        finishReceipt.receiptId !== result.receiptId
        || finishReceipt.receiptHash !== result.receiptHash
        || finishReceipt.runId !== this.runId
        || finishReceipt.bindingId !== this.binding.bindingId
      ) {
        return {
          accepted: false,
          code: "FINISH_RECEIPT_MISMATCH",
          payload: { message: "FinishReceiptV2 does not match the immutable run binding." }
        };
      }
    }
    if (finishReceipt) {
      const currentHead = this.gateway.currentProjectHead();
      if (
        (currentHead.revision !== null && currentHead.revision !== finishReceipt.projectRevision)
        || (currentHead.projectHash !== null && currentHead.projectHash !== finishReceipt.projectHash)
      ) {
        return {
          accepted: false,
          code: "STALE_PROJECT_REVISION",
          payload: {
            message: "The project head changed while finish verification was in progress.",
            expectedRevision: request.expectedProjectRevision,
            currentRevision: currentHead.revision
          }
        };
      }
    }
    this.statusValue = "finishing";
    this.gateway.sealVerifiedFinish({
      receiptId: result.receiptId,
      projectRevision: finishReceipt?.projectRevision
        ?? numericField(result.payload.projectRevision),
      projectHash: finishReceipt?.projectHash ?? null
    });
    if (this.persistence && finishReceipt) {
      try {
        await this.persistence.appendFinishReceipt(finishReceipt);
      } catch (error) {
        this.statusValue = "recovery_required";
        throw error;
      }
      if (!this.gateway.verifiedFinishHeadMatches()) {
        this.statusValue = "recovery_required";
        throw new VdtRunSupervisorError(
          "FINISH_HEAD_CHANGED",
          "The project head changed after the finish receipt was persisted; same-session recovery is required."
        );
      }
    }
    this.verifiedFinish = { receiptId: result.receiptId, receiptHash: result.receiptHash };
    const checkpoint = await this.saveCheckpoint("finish_verified");
    return {
      accepted: true,
      code: result.code,
      payload: {
        ...result.payload,
        receiptId: result.receiptId,
        receiptHash: result.receiptHash,
        checkpointId: checkpoint.checkpointId
      }
    };
  }

  /** A verified FinishReceipt proves that the deterministic control tool
   * committed even when the process crashed before its gateway response was
   * receipted. Reconcile only that exact active call to a terminal replay; no
   * other ambiguous operation is inferred as successful. */
  private async reconcileVerifiedFinishToolReceipt(
    state: AgentSupervisorPersistenceStateV2,
    finishReceipt: FinishReceiptV2 | null
  ): Promise<AgentSupervisorPersistenceStateV2> {
    if (!this.persistence || finishReceipt?.state !== "verified") return state;
    const active = state.checkpoint?.activeToolCall;
    if (!active || active.toolName !== "run.request_finish") return state;
    const latest = latestToolReceiptByCallId(state.toolOperationReceipts, active.externalCallId);
    if (
      !latest
      || latest.toolName !== "run.request_finish"
      || latest.sessionEpoch !== finishReceipt.sessionEpoch
      || (latest.state !== "reserved" && latest.state !== "in_flight" && latest.state !== "ambiguous")
    ) {
      return state;
    }
    const payload = {
      receiptId: finishReceipt.receiptId,
      receiptHash: finishReceipt.receiptHash,
      projectRevision: finishReceipt.projectRevision
    };
    const replayResult = vdtGatewayToolResultSchema.parse({
      externalCallId: latest.externalCallId,
      toolName: latest.toolName,
      status: "succeeded",
      resultCode: "FINISH_VERIFIED",
      resultHash: hashJson({ resultCode: "FINISH_VERIFIED", payload }),
      payload
    });
    const reconciled: AgentToolOperationReceiptV2 = {
      ...latest,
      state: "completed",
      resultHash: replayResult.resultHash,
      resultCode: replayResult.resultCode,
      replayResult,
      committedRevision: finishReceipt.projectRevision,
      updatedAt: latest.updatedAt > finishReceipt.verifiedAt
        ? latest.updatedAt
        : finishReceipt.verifiedAt
    };
    await this.persistence.appendToolOperationReceipt(reconciled);
    return {
      ...state,
      toolOperationReceipts: [...state.toolOperationReceipts, reconciled],
      updatedAt: state.updatedAt > reconciled.updatedAt ? state.updatedAt : reconciled.updatedAt
    };
  }

  private async saveCheckpoint(
    reason: Extract<AgentRunEventV2Draft, { type: "checkpoint" }>["payload"]["reason"]
  ): Promise<AgentEngineCheckpoint> {
    const session = this.requireSession();
    const engineCheckpoint = agentEngineCheckpointSchema.parse(await session.checkpoint());
    const checkpointTimestampMs = Math.max(
      Date.parse(engineCheckpoint.createdAt),
      this.lastCheckpointTimestampMs === null ? Number.NEGATIVE_INFINITY : this.lastCheckpointTimestampMs + 1
    );
    const checkpoint = agentEngineCheckpointSchema.parse({
      ...engineCheckpoint,
      createdAt: new Date(checkpointTimestampMs).toISOString()
    });
    this.lastCheckpointTimestampMs = checkpointTimestampMs;
    assertCheckpointBinding(checkpoint, this.binding);
    if (this.persistence) {
      await this.persistence.saveCheckpoint(checkpoint);
      const exchange = checkpoint.activeExchange;
      if (exchange) {
        const previous = await this.persistence.getExchangeReceipt(this.runId, exchange.stableCallKey);
        const receipt: AgentEngineExchangeReceiptV2 = {
          schemaVersion: 2,
          receiptId: previous?.receiptId ?? `exchange-receipt-${hashHex(exchange.stableCallKey).slice(0, 32)}`,
          runId: this.runId,
          bindingId: this.binding.bindingId,
          exchangeId: exchange.exchangeId,
          stableCallKey: exchange.stableCallKey,
          sessionEpoch: checkpoint.sessionEpoch,
          state: exchange.state,
          inputHash: checkpoint.lastConfirmedInput?.contentHash ?? hashJson({
            exchangeId: exchange.exchangeId,
            stableCallKey: exchange.stableCallKey
          }),
          outputHash: exchange.state === "completed"
            ? checkpoint.lastConfirmedOutput?.contentHash ?? hashJson({ exchangeId: exchange.exchangeId })
            : null,
          resultCode: exchange.state === "failed"
            ? "ENGINE_EXCHANGE_FAILED"
            : exchange.state === "ambiguous"
              ? "AMBIGUOUS_EXCHANGE_RECOVERY"
              : exchange.state === "completed"
                ? "OK"
                : null,
          startedAt: previous?.startedAt ?? checkpoint.createdAt,
          updatedAt: checkpoint.createdAt
        };
        if (!previous || !sameExchangeReceiptContent(previous, receipt)) {
          await this.persistence.appendExchangeReceipt(receipt);
        }
      }
    }
    await this.outbox.append({
      type: "checkpoint",
      source: "runtime",
      payload: {
        checkpointId: checkpoint.checkpointId,
        checkpointHash: hashJson(checkpoint),
        reason,
        sessionEpoch: checkpoint.sessionEpoch
      }
    });
    return checkpoint;
  }

  private async appendGatewayEvent(event: VdtGatewayEventInput): Promise<void> {
    const payload = event.payload;
    if (event.type === "tool_call") {
      await this.outbox.append({
        type: "tool_call",
        source: "tool_gateway",
        correlationId: event.correlationId,
        payload: {
          externalCallId: event.correlationId,
          toolName: stringField(payload.toolName, "unknown-tool"),
          argsHash: shaField(payload.argsHash, hashJson({ externalCallId: event.correlationId })),
          replay: payload.replay === true
        }
      });
      // The engine marks activeToolCall before entering the Gateway. Persist
      // that state while the receipt is already reserved/in-flight so a crash
      // cannot make an executing callback look like it never started.
      await this.saveCheckpoint("tool_call");
      return;
    }
    if (event.type === "tool_result") {
      await this.outbox.append({
        type: "tool_result",
        source: "tool_gateway",
        correlationId: event.correlationId,
        payload: {
          externalCallId: event.correlationId,
          toolName: stringField(payload.toolName, "unknown-tool"),
          status: gatewayStatus(payload.status),
          resultCode: stringField(payload.resultCode, "UNKNOWN_RESULT"),
          resultHash: shaField(payload.resultHash, hashJson(payload)),
          retryable: payload.retryable === true
        }
      });
      const status = gatewayStatus(payload.status);
      if (status === "waiting_user" || status === "waiting_approval") {
        this.statusValue = status === "waiting_user" ? "waiting_user" : "waiting_approval";
        await this.saveCheckpoint(status);
      } else {
        await this.saveCheckpoint("tool_result");
      }
      return;
    }
    if (event.type === "approval_required") {
      await this.outbox.append({
        type: "approval_required",
        source: "tool_gateway",
        correlationId: event.correlationId,
        payload: {
          approvalId: stringField(payload.approvalId, `approval:${event.correlationId}`),
          externalCallId: event.correlationId,
          proposalId: stringField(payload.proposalId, `proposal:${event.correlationId}`),
          proposalBasisHash: shaField(payload.proposalBasisHash, hashJson(payload)),
          summary: stringField(payload.summary, "Approval is required for the proposed VDT mutation.")
        }
      });
      this.statusValue = "waiting_approval";
      return;
    }
    const code = stringField(payload.code, event.type === "warning" ? "GATEWAY_WARNING" : "GATEWAY_ERROR");
    const message = stringField(payload.message, `VDT gateway emitted ${event.type}.`);
    if (event.type === "error" && code === "SECURITY_BOUNDARY_BREACH") {
      await this.stopForSecurityBreach(message);
      return;
    }
    await this.outbox.append({
      type: event.type,
      source: "tool_gateway",
      payload: {
        code,
        message,
        retryable: payload.retryable === true,
        detailsHash: hashJson(payload)
      }
    });
  }

  private async appendRuntimeStatus(code: string, message: string, state: string): Promise<void> {
    await this.outbox.append({
      type: "runtime_status",
      source: "runtime",
      payload: { code, message, state }
    });
  }

  private async appendWarning(code: string, message: string, retryable: boolean): Promise<void> {
    await this.outbox.append({
      type: "warning",
      source: "runtime",
      payload: { code, message, retryable, detailsHash: null }
    });
  }

  private async appendError(code: string, error: unknown, retryable: boolean): Promise<void> {
    await this.outbox.append({
      type: "error",
      source: "runtime",
      payload: {
        code,
        message: error instanceof Error ? error.message.slice(0, 2_000) : "Agent execution failed.",
        retryable,
        detailsHash: null
      }
    });
  }

  private requireSession(): AgentRunSession {
    if (!this.session) throw new VdtRunSupervisorError("SESSION_NOT_OPEN", "Agent session is not open.");
    return this.session;
  }

  private finalWasCancelled(): boolean {
    return this.abortController.signal.aborted || this.statusValue === "cancelled";
  }

  private async stopForSecurityBreach(message: string): Promise<void> {
    this.abortController.abort(message);
    try {
      await this.session?.cancel(message);
    } finally {
      this.statusValue = "failed";
      await this.appendError("SECURITY_BOUNDARY_BREACH", new Error(message), false);
    }
  }
}

export class VdtRunSupervisorError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "VdtRunSupervisorError";
  }
}

function assertBindingCapability(binding: AgentSessionBinding, capability: AgentCapabilityProfile): void {
  if (
    binding.executionProfile !== capability.executionProfile
    || binding.engineId !== capability.engineId
    || binding.engineAdapterId !== capability.engineAdapterId
    || binding.backendId !== capability.backendId
    || binding.protocolVersion !== capability.protocolVersion
    || binding.cliVersion !== (capability.cli?.version ?? null)
    || binding.toolIsolation !== capability.toolIsolation
    || binding.qualificationStatus !== capability.qualification.status
    || binding.capabilityEvidenceHash !== capability.qualification.evidenceHash
    || binding.toolCatalogHash !== capability.toolCatalogHash
  ) {
    throw new VdtRunSupervisorError("ENGINE_BINDING_MISMATCH", "Run binding does not match the selected engine capability.");
  }
}

function assertExternalAdmission(capability: AgentCapabilityProfile, canary: boolean): void {
  if (capability.executionProfile !== "external_cli_agent" || canary) return;
  if (capability.toolIsolation !== "hard_verified" || capability.qualification.status !== "qualified") {
    throw new VdtRunSupervisorError(
      "EXTERNAL_CAPABILITY_UNAVAILABLE",
      "External CLI Agent profile is unavailable until hard tool isolation is qualified."
    );
  }
}

function assertSessionBinding(expected: AgentSessionBinding, actual: AgentSessionBinding, recovery: boolean): void {
  const stableFields = [
    "schemaVersion",
    "bindingId",
    "runId",
    "projectId",
    "executionProfile",
    "engineId",
    "engineAdapterId",
    "backendId",
    "modelId",
    "protocolVersion",
    "cliVersion",
    "toolIsolation",
    "qualificationStatus",
    "capabilityEvidenceHash",
    "settingsHash",
    "capabilityProfileHash",
    "toolCatalogHash",
    "sessionEpoch",
    "boundAt"
  ] as const;
  for (const field of stableFields) {
    if (actual[field] !== expected[field]) {
      throw new VdtRunSupervisorError("ENGINE_BINDING_CHANGED", `Engine changed immutable binding field ${field}.`);
    }
  }
  if (recovery && actual.externalSessionId !== expected.externalSessionId) {
    throw new VdtRunSupervisorError("SESSION_RESUME_MISMATCH", "Recovery did not resume the persisted external session ID.");
  }
  if (!recovery && expected.externalSessionId !== null && actual.externalSessionId !== expected.externalSessionId) {
    throw new VdtRunSupervisorError("SESSION_ID_MISMATCH", "Engine opened a different external session than the bound one.");
  }
  if (expected.externalSessionId === null && actual.externalSessionId === null && actual.executionProfile === "external_cli_agent") {
    throw new VdtRunSupervisorError("SESSION_ID_MISSING", "External engine did not return an opaque session ID.");
  }
}

function assertCheckpointBinding(checkpoint: AgentEngineCheckpoint, binding: AgentSessionBinding): void {
  if (
    checkpoint.runId !== binding.runId
    || checkpoint.bindingId !== binding.bindingId
    || checkpoint.sessionEpoch !== binding.sessionEpoch
    || checkpoint.externalSessionId !== binding.externalSessionId
  ) {
    throw new VdtRunSupervisorError("CHECKPOINT_BINDING_MISMATCH", "Checkpoint does not belong to the immutable run session.");
  }
}

function assertRecoveryBinding(
  configured: AgentSessionBinding,
  durable: AgentSessionBinding
): void {
  if (hashJson(configured) !== hashJson(durable)) {
    throw new VdtRunSupervisorError(
      "RECOVERY_BINDING_STALE",
      "Recovery must use the effective current-epoch durable session binding."
    );
  }
}

function assertRecoveryOperationsSettled(
  state: AgentSupervisorPersistenceStateV2
): void {
  const latestExchanges = new Map<string, AgentEngineExchangeReceiptV2>();
  for (const receipt of state.exchangeReceipts) {
    latestExchanges.set(receipt.stableCallKey, receipt);
  }
  const latestTools = new Map<string, AgentSupervisorPersistenceStateV2["toolOperationReceipts"][number]>();
  for (const receipt of state.toolOperationReceipts) {
    latestTools.set(receipt.externalCallId, receipt);
  }
  const activeToolCall = state.checkpoint?.activeToolCall;
  const activeToolReceipt = activeToolCall
    ? latestTools.get(activeToolCall.externalCallId)
    : undefined;
  const finishReplayPayload = activeToolReceipt?.replayResult?.payload;
  const recoverableVerifiedFinishCall = Boolean(
    state.finishReceipt?.state === "verified"
    && activeToolCall?.toolName === "run.request_finish"
    && activeToolReceipt?.toolName === "run.request_finish"
    && activeToolReceipt.externalCallId === activeToolCall.externalCallId
    && activeToolReceipt.sessionEpoch === state.finishReceipt.sessionEpoch
    && activeToolReceipt.state === "completed"
    && activeToolReceipt.resultCode === "FINISH_VERIFIED"
    && activeToolReceipt.replayResult?.status === "succeeded"
    && finishReplayPayload !== null
    && typeof finishReplayPayload === "object"
    && (finishReplayPayload as { receiptId?: unknown }).receiptId === state.finishReceipt.receiptId
  );
  const unresolvedExchange = [...latestExchanges.values()].find((receipt) =>
    receipt.state === "prepared"
    || receipt.state === "in_flight"
    || receipt.state === "ambiguous"
  );
  const unresolvedTool = [...latestTools.values()].find((receipt) =>
    !(
      recoverableVerifiedFinishCall
      && receipt.externalCallId === activeToolCall?.externalCallId
    ) && (
      receipt.state === "reserved"
      || receipt.state === "in_flight"
      || receipt.state === "ambiguous"
    )
  );
  if (unresolvedExchange || unresolvedTool) {
    throw new VdtRunSupervisorError(
      "AMBIGUOUS_OPERATION_RECOVERY",
      "Recovery cannot resume cognition until every non-terminal exchange and tool call is resolved by its stable key."
    );
  }

  const activeExchange = state.checkpoint?.activeExchange;
  if (activeExchange) {
    const receipt = latestExchanges.get(activeExchange.stableCallKey);
    if (
      !receipt
      || receipt.exchangeId !== activeExchange.exchangeId
      || receipt.state !== activeExchange.state
      || (receipt.state !== "completed" && receipt.state !== "failed")
    ) {
      throw new VdtRunSupervisorError(
        "EXCHANGE_RECOVERY_RECEIPT_MISSING",
        "The active exchange checkpoint has no matching terminal receipt."
      );
    }
  }

  if (activeToolCall && !recoverableVerifiedFinishCall) {
    const receipt = latestTools.get(activeToolCall.externalCallId);
    if (
      !receipt
      || receipt.toolName !== activeToolCall.toolName
      || receipt.state !== activeToolCall.state
      || (receipt.state !== "completed" && receipt.state !== "failed")
    ) {
      throw new VdtRunSupervisorError(
        "TOOL_RECOVERY_RECEIPT_MISSING",
        "The active tool checkpoint has no matching terminal receipt."
      );
    }
  }
}

function sameExchangeReceiptContent(
  left: AgentEngineExchangeReceiptV2,
  right: AgentEngineExchangeReceiptV2
): boolean {
  const { updatedAt: _leftUpdatedAt, ...leftContent } = left;
  const { updatedAt: _rightUpdatedAt, ...rightContent } = right;
  return hashJson(leftContent) === hashJson(rightContent);
}

function latestToolReceiptByCallId(
  receipts: readonly AgentToolOperationReceiptV2[],
  externalCallId: string
): AgentToolOperationReceiptV2 | undefined {
  let latest: AgentToolOperationReceiptV2 | undefined;
  for (const receipt of receipts) {
    if (receipt.externalCallId === externalCallId) latest = receipt;
  }
  return latest;
}

function durableFinalEvents(
  events: readonly AgentRunEventV2[]
): Array<Extract<AgentRunEventV2, { type: "final" }>> {
  return events.filter(
    (event): event is Extract<AgentRunEventV2, { type: "final" }> => event.type === "final"
  );
}

function assertFinalMatches(
  durable: Extract<AgentRunEventV2, { type: "final" }>,
  incoming: Extract<AgentEngineEvent, { type: "final" }>,
  verified: { receiptId: string; receiptHash: string }
): void {
  if (
    durable.messageId !== incoming.messageId
    || durable.payload.text !== incoming.text
    || durable.payload.finishReceiptId !== incoming.finishReceiptId
    || durable.payload.finishReceiptId !== verified.receiptId
    || durable.payload.finishReceiptHash !== verified.receiptHash
  ) {
    throw new VdtRunSupervisorError(
      "DUPLICATE_FINAL_CONFLICT",
      "The resumed agent final conflicts with the already durable final message."
    );
  }
}

function assertFinishReceiptBinding(receipt: FinishReceiptV2, binding: AgentSessionBinding): void {
  if (
    receipt.runId !== binding.runId
    || receipt.bindingId !== binding.bindingId
    || (
      receipt.sessionEpoch !== binding.sessionEpoch
      && receipt.sessionEpoch + 1 !== binding.sessionEpoch
    )
  ) {
    throw new VdtRunSupervisorError(
      "FINISH_RECEIPT_MISMATCH",
      "The durable finish receipt does not belong to this session or its exact recovery successor."
    );
  }
}

function assertDurableFinalReceipt(
  finalEvent: Extract<AgentRunEventV2, { type: "final" }>,
  receipt: FinishReceiptV2
): void {
  if (
    finalEvent.runId !== receipt.runId
    || finalEvent.payload.finishReceiptId !== receipt.receiptId
    || finalEvent.payload.finishReceiptHash !== receipt.receiptHash
  ) {
    throw new VdtRunSupervisorError(
      "FINAL_RECEIPT_MISMATCH",
      "The durable final event does not match FinishReceiptV2."
    );
  }
}

function gatewayStatus(value: unknown): VdtGatewayToolResult["status"] {
  if (value === "succeeded" || value === "failed" || value === "replayed" || value === "waiting_user" || value === "waiting_approval") {
    return value;
  }
  return "failed";
}

function stringField(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 1_000) : fallback;
}

function numericField(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function shaField(value: unknown, fallback: string): string {
  return isSha256(value) ? value : fallback;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function hashJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(sortJson(value))).digest("hex")}`;
}

function hashHex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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

function isTerminalStatus(status: VdtRunSupervisorStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled" || status === "closed";
}

function assertNever(value: never): never {
  throw new VdtRunSupervisorError("UNKNOWN_ENGINE_EVENT", `Unsupported engine event: ${JSON.stringify(value)}`);
}
