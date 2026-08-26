import { createHash } from "node:crypto";
import type {
  AgentCapabilityProfile,
  AgentSessionBinding,
  VdtGatewayToolCall,
  VdtGatewayToolResult
} from "./agent-execution-contracts";
import {
  agentSessionBindingSchema,
  vdtGatewayToolCallSchema,
  vdtGatewayToolResultSchema
} from "./agent-execution-contracts";
import type { AgentToolContext, ToolRegistry } from "./tool-registry";

const FORBIDDEN_EXTERNAL_TOOLS = new Set([
  "user.show_status",
  "shell",
  "bash",
  "git",
  "filesystem",
  "web.fetch",
  "request_user_input"
]);

const TRUSTED_CONTROL_OPERATION_NAMES = new Set([
  "control.apply_approved_proposal"
]);

export type VdtGatewayReceiptState =
  | "reserved"
  | "in_flight"
  | "completed"
  | "failed"
  | "ambiguous";

export interface VdtGatewayOperationReceipt {
  schemaVersion: 2;
  bindingId: string;
  sessionEpoch: number;
  externalCallId: string;
  toolName: string;
  callHash: string;
  state: VdtGatewayReceiptState;
  reservedAt: string;
  updatedAt: string;
  result?: VdtGatewayToolResult | undefined;
}

export interface VdtToolGatewayLedger {
  get(bindingId: string, externalCallId: string): Promise<VdtGatewayOperationReceipt | undefined>;
  reserve(receipt: VdtGatewayOperationReceipt): Promise<{
    acquired: boolean;
    receipt: VdtGatewayOperationReceipt;
  }>;
  put(receipt: VdtGatewayOperationReceipt): Promise<void>;
  advanceSessionBinding?(binding: AgentSessionBinding): void;
}

export class InMemoryVdtToolGatewayLedger implements VdtToolGatewayLedger {
  private readonly receipts = new Map<string, VdtGatewayOperationReceipt>();

  async get(bindingId: string, externalCallId: string): Promise<VdtGatewayOperationReceipt | undefined> {
    return this.receipts.get(receiptKey(bindingId, externalCallId));
  }

  async put(receipt: VdtGatewayOperationReceipt): Promise<void> {
    this.receipts.set(receiptKey(receipt.bindingId, receipt.externalCallId), structuredClone(receipt));
  }

  async reserve(receipt: VdtGatewayOperationReceipt): Promise<{
    acquired: boolean;
    receipt: VdtGatewayOperationReceipt;
  }> {
    const key = receiptKey(receipt.bindingId, receipt.externalCallId);
    const existing = this.receipts.get(key);
    if (existing) {
      return { acquired: false, receipt: structuredClone(existing) };
    }
    this.receipts.set(key, structuredClone(receipt));
    return { acquired: true, receipt: structuredClone(receipt) };
  }

  list(bindingId: string): VdtGatewayOperationReceipt[] {
    return [...this.receipts.values()]
      .filter((receipt) => receipt.bindingId === bindingId)
      .map((receipt) => structuredClone(receipt));
  }
}

export type VdtGatewayEventInput =
  | {
      type: "tool_call";
      source: "tool_gateway";
      correlationId: string;
      payload: Readonly<Record<string, unknown>>;
    }
  | {
      type: "tool_result" | "warning" | "error" | "approval_required";
      source: "tool_gateway";
      correlationId: string;
      payload: Readonly<Record<string, unknown>>;
    };

export interface VdtFinishCheckResult {
  accepted: boolean;
  code: string;
  payload: Readonly<Record<string, unknown>>;
}

export interface VdtFinishRequest {
  externalCallId: string;
  args: Readonly<Record<string, unknown>>;
  /** Server-owned project fence captured before deterministic finish
   * verification starts. It is never accepted from model-controlled args. */
  expectedProjectRevision: number | null;
}

export interface VdtTrustedControlOutcome {
  status: "succeeded" | "failed";
  resultCode: string;
  payload: Readonly<Record<string, unknown>>;
  projectChanged: boolean;
}

export interface VdtTrustedControlExecution {
  result: VdtGatewayToolResult;
  replayed: boolean;
}

export interface VdtToolGatewayOptions {
  binding: AgentSessionBinding;
  capability: AgentCapabilityProfile;
  tools: ToolRegistry;
  toolContext: () => AgentToolContext;
  allowedTools: ReadonlySet<string>;
  ledger?: VdtToolGatewayLedger | undefined;
  now?: (() => string) | undefined;
  allowUnqualifiedExternalCanary?: boolean | undefined;
  allowTool?: ((toolName: string, context: AgentToolContext) => boolean) | undefined;
  /** Builds a compact, model-visible delta after a server-derived revision
   * fence rejects stale work. Authority fields remain outside tool args. */
  revisionReconciliation?: ((input: {
    expectedRevision: number;
    currentRevision: number;
    context: AgentToolContext;
  }) => Readonly<Record<string, unknown>>) | undefined;
  emit?: ((event: VdtGatewayEventInput) => void | Promise<void>) | undefined;
  requestFinish?: ((request: VdtFinishRequest) => Promise<VdtFinishCheckResult>) | undefined;
}

/**
 * The only model-facing VDT tool authority. The gateway is already bound to a
 * run on construction, so the wire call deliberately contains no run, actor,
 * project, revision, permission, or idempotency fields.
 */
export class VdtToolGateway {
  readonly capability: AgentCapabilityProfile;

  private bindingValue: AgentSessionBinding;

  private readonly tools: ToolRegistry;
  private readonly toolContext: () => AgentToolContext;
  private readonly allowedTools: ReadonlySet<string>;
  private readonly ledger: VdtToolGatewayLedger;
  private readonly now: () => string;
  private readonly allowTool: (toolName: string, context: AgentToolContext) => boolean;
  private readonly revisionReconciliation?: VdtToolGatewayOptions["revisionReconciliation"];
  private readonly emit?: VdtToolGatewayOptions["emit"];
  private readonly requestFinish?: VdtToolGatewayOptions["requestFinish"];
  private expectedProjectRevision: number | null;
  private verifiedFinishSeal: {
    receiptId: string;
    projectRevision: number | null;
    projectHash: string | null;
  } | null = null;
  private executionTail: Promise<void> = Promise.resolve();

  constructor(options: VdtToolGatewayOptions) {
    this.bindingValue = structuredClone(options.binding);
    this.capability = options.capability;
    this.tools = options.tools;
    this.toolContext = options.toolContext;
    this.allowedTools = new Set(options.allowedTools);
    this.ledger = options.ledger ?? new InMemoryVdtToolGatewayLedger();
    this.now = options.now ?? (() => new Date().toISOString());
    this.allowTool = options.allowTool ?? (() => true);
    this.revisionReconciliation = options.revisionReconciliation;
    this.emit = options.emit;
    this.requestFinish = options.requestFinish;
    this.expectedProjectRevision = options.toolContext().builder?.getRevision() ?? null;

    assertBindingMatchesCapability(this.bindingValue, this.capability);
    if (
      this.capability.executionProfile === "external_cli_agent"
      && !options.allowUnqualifiedExternalCanary
      && (
        this.capability.toolIsolation !== "hard_verified"
        || this.capability.qualification.status !== "qualified"
      )
    ) {
      throw new VdtToolGatewayError(
        "EXTERNAL_CAPABILITY_UNAVAILABLE",
        "External agent tool access requires a currently qualified hard_verified capability."
      );
    }
  }

  get binding(): AgentSessionBinding {
    return structuredClone(this.bindingValue);
  }

  /** Trusted recovery control-plane operation. Execution identity and opaque
   * session stay fixed; only the exact next durable epoch may be adopted. */
  advanceSessionBinding(rawBinding: AgentSessionBinding): void {
    const binding = agentSessionBindingSchema.parse(rawBinding);
    assertBindingMatchesCapability(binding, this.capability);
    assertRecoveryBindingAdvance(this.bindingValue, binding);
    this.ledger.advanceSessionBinding?.(binding);
    this.bindingValue = binding;
  }

  execute(rawCall: VdtGatewayToolCall): Promise<VdtGatewayToolResult> {
    let call: VdtGatewayToolCall;
    try {
      call = vdtGatewayToolCallSchema.parse(rawCall);
    } catch (error) {
      return Promise.resolve(failedResult(
        safeExternalCallId(rawCall),
        safeToolName(rawCall),
        "INVALID_GATEWAY_CALL",
        { message: error instanceof Error ? error.message : "Invalid VDT gateway call." }
      ));
    }

    const execution = this.executionTail.then(() => this.executeSerialized(call));
    this.executionTail = execution.then(() => undefined, () => undefined);
    return execution;
  }

  /** Server-only control-plane mutation. The operation shares the model tool
   * serialization tail and Sequence 4 ledger, but its callback and authority
   * never cross the model-facing gateway wire. */
  executeTrustedControlOperation(
    rawCall: VdtGatewayToolCall,
    apply: () => VdtTrustedControlOutcome | Promise<VdtTrustedControlOutcome>
  ): Promise<VdtTrustedControlExecution> {
    const parsed = vdtGatewayToolCallSchema.safeParse(rawCall);
    if (!parsed.success || !TRUSTED_CONTROL_OPERATION_NAMES.has(parsed.data.toolName)) {
      return Promise.reject(new VdtToolGatewayError(
        "TRUSTED_CONTROL_CALL_INVALID",
        "Trusted control operation has an invalid server-owned identity."
      ));
    }
    const call = parsed.data;
    const execution = this.executionTail.then(() => this.executeTrustedControlSerialized(call, apply));
    this.executionTail = execution.then(() => undefined, () => undefined);
    return execution;
  }

  /** A trusted control-plane mutation (for example, applying an approved
   * proposal) advances the same server-side fence without exposing revision
   * authority to the model. */
  acknowledgeTrustedProjectRevision(): void {
    if (this.verifiedFinishSeal) {
      throw new VdtToolGatewayError(
        "FINISH_HEAD_SEALED",
        "The verified finish head is sealed; trusted mutations require a new run or explicit recovery."
      );
    }
    this.expectedProjectRevision = this.toolContext().builder?.getRevision() ?? null;
  }

  /** Once deterministic finish succeeds, the gateway accepts only replay of
   * already-receipted calls. New cognitive tool work cannot mutate or replace
   * the head cited by FinishReceiptV2. */
  sealVerifiedFinish(input: {
    receiptId: string;
    projectRevision?: number | null | undefined;
    projectHash?: string | null | undefined;
  }): void {
    const next = {
      receiptId: input.receiptId,
      projectRevision: input.projectRevision ?? null,
      projectHash: input.projectHash ?? null
    };
    if (this.verifiedFinishSeal) {
      const current = this.verifiedFinishSeal;
      if (
        current.receiptId !== next.receiptId
        || (current.projectRevision !== null && next.projectRevision !== null
          && current.projectRevision !== next.projectRevision)
        || (current.projectHash !== null && next.projectHash !== null
          && current.projectHash !== next.projectHash)
      ) {
        throw new VdtToolGatewayError(
          "FINISH_RECEIPT_CONFLICT",
          "The run is already sealed by a different verified finish receipt."
        );
      }
      this.verifiedFinishSeal = {
        receiptId: current.receiptId,
        projectRevision: current.projectRevision ?? next.projectRevision,
        projectHash: current.projectHash ?? next.projectHash
      };
      return;
    }
    this.verifiedFinishSeal = next;
  }

  currentProjectHead(): { revision: number | null; projectHash: string | null } {
    const builder = this.toolContext().builder;
    return {
      revision: builder?.getRevision() ?? null,
      projectHash: builder ? hashJson(builder.getProject()) : null
    };
  }

  verifiedFinishHeadMatches(): boolean {
    const seal = this.verifiedFinishSeal;
    if (!seal) return false;
    const current = this.currentProjectHead();
    return (seal.projectRevision === null || current.revision === null || current.revision === seal.projectRevision)
      && (seal.projectHash === null || current.projectHash === null || current.projectHash === seal.projectHash);
  }

  private async executeSerialized(call: VdtGatewayToolCall): Promise<VdtGatewayToolResult> {
    const callHash = hashJson({ toolName: call.toolName, args: call.args });
    const binding = this.bindingValue;
    const existing = await this.ledger.get(binding.bindingId, call.externalCallId);
    if (existing) {
      return this.resultForExistingReceipt(call, callHash, existing);
    }

    const reservedAt = this.now();
    const baseReceipt: VdtGatewayOperationReceipt = {
      schemaVersion: 2,
      bindingId: binding.bindingId,
      sessionEpoch: binding.sessionEpoch,
      externalCallId: call.externalCallId,
      toolName: call.toolName,
      callHash,
      state: "reserved",
      reservedAt,
      updatedAt: reservedAt
    };
    const reservation = await this.ledger.reserve(baseReceipt);
    if (!reservation.acquired) {
      return this.resultForExistingReceipt(call, callHash, reservation.receipt);
    }

    const context = this.toolContext();
    const policyFailure = this.policyFailure(call, context);
    if (policyFailure) {
      const result = failedResult(call.externalCallId, call.toolName, policyFailure.code, {
        message: policyFailure.message,
        ...(policyFailure.details ?? {})
      });
      await this.finishReceipt(baseReceipt, result, "failed");
      const retryable = isRetryableResultCode(policyFailure.code);
      await this.publish(retryable ? "warning" : "error", call, {
        code: policyFailure.code,
        message: policyFailure.message,
        retryable
      });
      return result;
    }

    await this.ledger.put({ ...baseReceipt, state: "in_flight", updatedAt: this.now() });
    await this.publish("tool_call", call, {
      argsHash: callHash,
      replay: false,
      toolName: call.toolName,
      mutatesProject: this.tools.getSpec(canonicalToolName(call.toolName))?.mutatesProject === true
    });

    let result: VdtGatewayToolResult;
    try {
      result = call.toolName === "run.request_finish"
        ? await this.executeFinish(call)
        : await this.executeRegistryTool(call, context);
      if (
        result.status !== "failed"
        && this.tools.getSpec(canonicalToolName(call.toolName))?.mutatesProject === true
      ) {
        this.expectedProjectRevision = context.builder?.getRevision() ?? this.expectedProjectRevision;
      }
    } catch (error) {
      return await this.stopOnAmbiguousExecution(baseReceipt, call, error);
    }

    await this.persistTerminalReceipt(
      baseReceipt,
      call,
      result,
      result.status === "failed" ? "failed" : "completed"
    );
    try {
      await this.publish("tool_result", call, {
        status: result.status,
        resultCode: result.resultCode,
        resultHash: result.resultHash,
        retryable: isRetryableResultCode(result.resultCode)
      });
      if (result.status === "waiting_approval") {
        await this.publish("approval_required", call, approvalEventFields(call, result));
      }
    } catch (error) {
      // The terminal receipt is already authoritative. A later outbox or
      // checkpoint failure must never rewrite a committed success as failed;
      // recovery replays the same terminal result by externalCallId.
      throw new VdtToolGatewayError(
        "GATEWAY_EVENT_PERSIST_FAILED",
        error instanceof Error
          ? `The terminal tool receipt was saved, but its durable event/checkpoint failed: ${error.message}`
          : "The terminal tool receipt was saved, but its durable event/checkpoint failed."
      );
    }
    return result;
  }

  private async executeTrustedControlSerialized(
    call: VdtGatewayToolCall,
    apply: () => VdtTrustedControlOutcome | Promise<VdtTrustedControlOutcome>
  ): Promise<VdtTrustedControlExecution> {
    const callHash = hashJson({ toolName: call.toolName, args: call.args });
    const binding = this.bindingValue;
    const existing = await this.ledger.get(binding.bindingId, call.externalCallId);
    if (existing) {
      return {
        result: await this.resultForExistingReceipt(call, callHash, existing),
        replayed: true
      };
    }

    const reservedAt = this.now();
    const baseReceipt: VdtGatewayOperationReceipt = {
      schemaVersion: 2,
      bindingId: binding.bindingId,
      sessionEpoch: binding.sessionEpoch,
      externalCallId: call.externalCallId,
      toolName: call.toolName,
      callHash,
      state: "reserved",
      reservedAt,
      updatedAt: reservedAt
    };
    const reservation = await this.ledger.reserve(baseReceipt);
    if (!reservation.acquired) {
      return {
        result: await this.resultForExistingReceipt(call, callHash, reservation.receipt),
        replayed: true
      };
    }

    const context = this.toolContext();
    if (context.signal.aborted || this.verifiedFinishSeal) {
      const result = failedResult(
        call.externalCallId,
        call.toolName,
        context.signal.aborted ? "RUN_CANCELLED" : "FINISH_ALREADY_VERIFIED",
        {
          message: context.signal.aborted
            ? "The run was cancelled before the trusted control operation."
            : "The verified finish head cannot be changed by an approval operation."
        }
      );
      await this.finishReceipt(baseReceipt, result, "failed");
      return { result, replayed: false };
    }

    await this.ledger.put({ ...baseReceipt, state: "in_flight", updatedAt: this.now() });
    await this.publish("tool_call", call, {
      argsHash: callHash,
      replay: false,
      toolName: call.toolName,
      mutatesProject: true,
      trustedControl: true
    });

    let outcome: VdtTrustedControlOutcome;
    try {
      outcome = await apply();
    } catch (error) {
      return await this.stopOnAmbiguousExecution(baseReceipt, call, error);
    }
    const result = resultEnvelope(
      call.externalCallId,
      call.toolName,
      outcome.status,
      outcome.resultCode,
      outcome.payload
    );
    // The callback is the serialized trusted reconciliation boundary. Even a
    // stale/failed approval observes the current server head for the next
    // model checkpoint; no revision value came from control-call arguments.
    this.expectedProjectRevision = context.builder?.getRevision() ?? this.expectedProjectRevision;
    await this.persistTerminalReceipt(
      baseReceipt,
      call,
      result,
      outcome.status === "failed" ? "failed" : "completed"
    );
    try {
      await this.publish("tool_result", call, {
        status: result.status,
        resultCode: result.resultCode,
        resultHash: result.resultHash,
        retryable: isRetryableResultCode(result.resultCode),
        trustedControl: true
      });
    } catch (error) {
      throw new VdtToolGatewayError(
        "GATEWAY_EVENT_PERSIST_FAILED",
        error instanceof Error
          ? `The terminal control receipt was saved, but its durable event failed: ${error.message}`
          : "The terminal control receipt was saved, but its durable event failed."
      );
    }
    return { result, replayed: false };
  }

  private async resultForExistingReceipt(
    call: VdtGatewayToolCall,
    callHash: string,
    existing: VdtGatewayOperationReceipt
  ): Promise<VdtGatewayToolResult> {
    if (existing.callHash !== callHash || existing.toolName !== call.toolName) {
      return failedResult(call.externalCallId, call.toolName, "CALL_ID_REUSE", {
        message: "externalCallId was already reserved for a different canonical tool call."
      });
    }
    if (existing.result) {
      // Return the exact terminal outcome. Re-labelling a failed or paused
      // call as `replayed` would let an ActionBatch continue past the
      // original stop boundary after recovery.
      const replayed = vdtGatewayToolResultSchema.parse(structuredClone(existing.result));
      await this.publish("tool_call", call, { argsHash: callHash, replay: true });
      await this.publish("tool_result", call, {
        status: replayed.status,
        resultCode: replayed.resultCode,
        resultHash: replayed.resultHash,
        retryable: false
      });
      return replayed;
    }
    return failedResult(call.externalCallId, call.toolName, "AMBIGUOUS_TOOL_CALL", {
      message: "The matching call is not terminal and cannot be executed again automatically."
    });
  }

  private policyFailure(
    call: VdtGatewayToolCall,
    context: AgentToolContext
  ): { code: string; message: string; details?: Readonly<Record<string, unknown>> | undefined } | undefined {
    if (context.signal.aborted) {
      return { code: "RUN_CANCELLED", message: "The run was cancelled before tool execution." };
    }
    if (FORBIDDEN_EXTERNAL_TOOLS.has(call.toolName) || forbiddenToolPattern(call.toolName)) {
      return {
        code: "SECURITY_BOUNDARY_BREACH",
        message: `Tool "${call.toolName}" is outside the VDT domain-tool boundary.`
      };
    }
    if (this.verifiedFinishSeal) {
      return {
        code: "FINISH_ALREADY_VERIFIED",
        message: `Finish receipt "${this.verifiedFinishSeal.receiptId}" sealed the project head; only the agent final is allowed.`
      };
    }
    if (!this.allowedTools.has(call.toolName)) {
      return { code: "TOOL_NOT_ALLOWLISTED", message: `Tool "${call.toolName}" is not in this session catalog.` };
    }
    const canonical = canonicalToolName(call.toolName);
    if (canonical !== "run.request_finish" && !this.tools.has(canonical)) {
      return { code: "UNKNOWN_TOOL", message: `Unknown VDT tool "${call.toolName}".` };
    }
    const currentRevision = context.builder?.getRevision() ?? null;
    const requiresRevisionFence = canonical === "run.request_finish"
      || this.tools.getSpec(canonical)?.mutatesProject === true;
    if (
      requiresRevisionFence
      && this.expectedProjectRevision !== null
      && currentRevision !== null
      && currentRevision !== this.expectedProjectRevision
    ) {
      const expectedRevision = this.expectedProjectRevision;
      // The rejected call did not mutate. Advancing here makes the compact
      // reconciliation delta the basis of the next turn in the same session.
      this.expectedProjectRevision = currentRevision;
      return {
        code: "STALE_REVISION",
        message: "The project changed after this engine exchange began; stale work was not executed.",
        details: {
          expectedRevision,
          currentRevision,
          reconciliationDelta: this.revisionReconciliation?.({
            expectedRevision,
            currentRevision,
            context
          }) ?? { expectedRevision, currentRevision }
        }
      };
    }
    if (!this.allowTool(call.toolName, context)) {
      return { code: "TOOL_NOT_ALLOWED_IN_PHASE", message: `Tool "${call.toolName}" is not allowed in the current run phase.` };
    }
    return undefined;
  }

  private async executeRegistryTool(
    call: VdtGatewayToolCall,
    context: AgentToolContext
  ): Promise<VdtGatewayToolResult> {
    const envelope = await this.tools.run(canonicalToolName(call.toolName), call.args, context);
    const runStatus = context.getRun().status;
    const status = runStatus === "needs_user_input"
      ? "waiting_user"
      : runStatus === "waiting_approval"
        ? "waiting_approval"
        : envelope.ok
          ? "succeeded"
          : "failed";
    const payload = envelope.ok
      ? compactToolPayload(envelope.output, envelope)
      : {
          error: envelope.error ?? { code: "TOOL_FAILED", message: "Tool failed." },
          validation: envelope.validation
        };
    return resultEnvelope(
      call.externalCallId,
      call.toolName,
      status,
      envelope.ok ? "OK" : envelope.error?.code ?? "TOOL_FAILED",
      payload
    );
  }

  private async executeFinish(call: VdtGatewayToolCall): Promise<VdtGatewayToolResult> {
    if (!this.requestFinish) {
      return failedResult(call.externalCallId, call.toolName, "FINISH_UNAVAILABLE", {
        message: "The run supervisor did not install a deterministic finish checker."
      });
    }
    const check = await this.requestFinish({
      externalCallId: call.externalCallId,
      args: call.args,
      expectedProjectRevision: this.expectedProjectRevision
    });
    if (check.accepted) {
      const receiptId = typeof check.payload.receiptId === "string"
        ? check.payload.receiptId
        : null;
      if (!receiptId) {
        return failedResult(call.externalCallId, call.toolName, "INVALID_FINISH_RECEIPT", {
          message: "A successful finish check did not return its receipt ID."
        });
      }
      this.sealVerifiedFinish({
        receiptId,
        projectRevision: typeof check.payload.projectRevision === "number"
          ? check.payload.projectRevision
          : null
      });
    }
    return resultEnvelope(
      call.externalCallId,
      call.toolName,
      check.accepted ? "succeeded" : "failed",
      check.code,
      check.payload
    );
  }

  private async finishReceipt(
    receipt: VdtGatewayOperationReceipt,
    result: VdtGatewayToolResult,
    state: "completed" | "failed"
  ): Promise<void> {
    await this.ledger.put({
      ...receipt,
      state,
      result,
      updatedAt: this.now()
    });
  }

  private async persistTerminalReceipt(
    receipt: VdtGatewayOperationReceipt,
    call: VdtGatewayToolCall,
    result: VdtGatewayToolResult,
    state: "completed" | "failed"
  ): Promise<void> {
    try {
      await this.finishReceipt(receipt, result, state);
      return;
    } catch (error) {
      const observed = await this.ledger.get(receipt.bindingId, receipt.externalCallId)
        .catch(() => undefined);
      if (
        observed
        && (observed.state === "completed" || observed.state === "failed")
        && observed.callHash === receipt.callHash
        && observed.toolName === receipt.toolName
        && observed.result?.resultHash === result.resultHash
        && observed.result.resultCode === result.resultCode
        && observed.result.status === result.status
      ) {
        // Crash/throw after commit but before acknowledgement: the exact
        // terminal receipt won and is safe to replay.
        return;
      }
      await this.stopOnAmbiguousExecution(receipt, call, error);
    }
  }

  private async stopOnAmbiguousExecution(
    receipt: VdtGatewayOperationReceipt,
    call: VdtGatewayToolCall,
    _cause: unknown
  ): Promise<never> {
    try {
      await this.ledger.put({
        ...receipt,
        state: "ambiguous",
        updatedAt: this.now()
      });
    } catch {
      // A lookup on recovery remains authoritative when the persistence
      // boundary itself is unavailable or committed without acknowledgement.
    }
    try {
      await this.publish("error", call, {
        code: "AMBIGUOUS_TOOL_CALL",
        message: "The tool commit/response boundary is ambiguous and requires same-key reconciliation.",
        retryable: false
      });
    } catch {
      // The thrown control-plane error below still stops cognition.
    }
    throw new VdtToolGatewayError(
      "AMBIGUOUS_TOOL_CALL",
      "The tool commit/response boundary is ambiguous; automatic execution has stopped."
    );
  }

  private async publish(
    type: VdtGatewayEventInput["type"],
    call: VdtGatewayToolCall,
    payload: Readonly<Record<string, unknown>>
  ): Promise<void> {
    await this.emit?.({
      type,
      source: "tool_gateway",
      correlationId: call.externalCallId,
      payload: {
        externalCallId: call.externalCallId,
        toolName: call.toolName,
        ...payload
      }
    } as VdtGatewayEventInput);
  }
}

export class VdtToolGatewayError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "VdtToolGatewayError";
  }
}

function assertBindingMatchesCapability(
  binding: AgentSessionBinding,
  capability: AgentCapabilityProfile
): void {
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
    throw new VdtToolGatewayError(
      "ENGINE_BINDING_MISMATCH",
      "The immutable run binding does not match the selected engine capability."
    );
  }
}

function assertRecoveryBindingAdvance(
  previous: AgentSessionBinding,
  next: AgentSessionBinding
): void {
  const { sessionEpoch: _previousEpoch, ...previousIdentity } = previous;
  const { sessionEpoch: _nextEpoch, ...nextIdentity } = next;
  if (hashJson(previousIdentity) !== hashJson(nextIdentity)) {
    throw new VdtToolGatewayError(
      "ENGINE_BINDING_CHANGED",
      "Recovery cannot change the immutable engine or opaque session binding."
    );
  }
  if (next.sessionEpoch !== previous.sessionEpoch + 1) {
    throw new VdtToolGatewayError(
      "SESSION_EPOCH_MISMATCH",
      "Recovery must advance the gateway to exactly the next durable session epoch."
    );
  }
}

function resultEnvelope(
  externalCallId: string,
  toolName: string,
  status: VdtGatewayToolResult["status"],
  resultCode: string,
  payload: unknown
): VdtGatewayToolResult {
  return vdtGatewayToolResultSchema.parse({
    externalCallId,
    toolName,
    status,
    resultCode,
    resultHash: hashJson({ resultCode, payload }),
    payload
  });
}

function failedResult(
  externalCallId: string,
  toolName: string,
  resultCode: string,
  payload: unknown
): VdtGatewayToolResult {
  return resultEnvelope(externalCallId, toolName, "failed", resultCode, payload);
}

function compactToolPayload(output: unknown, envelope: {
  projectChanged: boolean;
  validation?: unknown;
  mutationProposal?: unknown;
}): unknown {
  return {
    output,
    projectChanged: envelope.projectChanged,
    validation: envelope.validation,
    mutationProposal: envelope.mutationProposal
  };
}

function canonicalToolName(toolName: string): string {
  if (toolName === "approval.request") return "user.request_approval";
  return toolName;
}

function isRetryableResultCode(code: string): boolean {
  return /(?:TIMEOUT|RATE_LIMIT|STALE|CONFLICT|RETRY|UNAVAILABLE|INTERRUPTED)/i.test(code);
}

function approvalEventFields(
  call: VdtGatewayToolCall,
  result: VdtGatewayToolResult
): Record<string, unknown> {
  const payload = result.payload && typeof result.payload === "object"
    ? result.payload as Record<string, unknown>
    : {};
  const proposal = payload.mutationProposal && typeof payload.mutationProposal === "object"
    ? payload.mutationProposal as Record<string, unknown>
    : {};
  const proposalId = typeof proposal.id === "string" && proposal.id
    ? proposal.id
    : `proposal:${call.externalCallId}`;
  return {
    approvalId: `approval:${call.externalCallId}`,
    proposalId,
    proposalBasisHash: hashJson({ proposalId, resultHash: result.resultHash }),
    summary: typeof proposal.summary === "string" && proposal.summary
      ? proposal.summary.slice(0, 1_000)
      : `Approval is required for ${call.toolName}.`
  };
}

function forbiddenToolPattern(toolName: string): boolean {
  return /(^|\.)(?:shell|exec|command|file|filesystem|git|web|browser|subagent|mcp)(?:\.|$)/i.test(toolName);
}

function safeExternalCallId(call: unknown): string {
  if (call && typeof call === "object" && "externalCallId" in call) {
    const value = (call as { externalCallId?: unknown }).externalCallId;
    if (typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value)) return value;
  }
  return "invalid-call";
}

function safeToolName(call: unknown): string {
  if (call && typeof call === "object" && "toolName" in call) {
    const value = (call as { toolName?: unknown }).toolName;
    if (typeof value === "string" && value.trim()) return value.slice(0, 160);
  }
  return "invalid-tool";
}

function receiptKey(bindingId: string, externalCallId: string): string {
  return `${bindingId}\u0000${externalCallId}`;
}

function hashJson(value: unknown): string {
  const canonical = JSON.stringify(sortJson(normalizeJson(value)));
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function normalizeJson(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((entry) => normalizeJson(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, normalizeJson(entry)])
    );
  }
  return value;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => sortJson(entry));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJson(entry)])
  );
}
