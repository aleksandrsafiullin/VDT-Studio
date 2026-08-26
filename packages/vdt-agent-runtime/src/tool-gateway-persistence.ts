import { createHash } from "node:crypto";
import type { AgentSessionBinding, VdtGatewayToolResult } from "./agent-execution-contracts";
import type {
  AgentSupervisorPersistence,
  AgentToolOperationReceiptV2
} from "./agent-supervisor-persistence";
import type {
  VdtGatewayOperationReceipt,
  VdtToolGatewayLedger
} from "./tool-gateway";

export interface AgentSupervisorToolGatewayLedgerOptions {
  binding: AgentSessionBinding;
  persistence: Pick<
    AgentSupervisorPersistence,
    "appendToolOperationReceipt" | "reserveToolOperationReceipt" | "getToolOperationReceipt"
  >;
  getRevision?: (() => number | null) | undefined;
}

/** Bridges the gateway's reserve-before-execute protocol to append-only
 * Sequence 4 receipts. New terminal receipts retain the exact bounded result,
 * so crash recovery can replay a stable call without mutating twice. */
export class AgentSupervisorToolGatewayLedger implements VdtToolGatewayLedger {
  private binding: AgentSessionBinding;
  private readonly persistence: AgentSupervisorToolGatewayLedgerOptions["persistence"];
  private readonly getRevision: () => number | null;

  constructor(options: AgentSupervisorToolGatewayLedgerOptions) {
    this.binding = options.binding;
    this.persistence = options.persistence;
    this.getRevision = options.getRevision ?? (() => null);
  }

  async get(bindingId: string, externalCallId: string): Promise<VdtGatewayOperationReceipt | undefined> {
    if (bindingId !== this.binding.bindingId) return undefined;
    const receipt = await this.persistence.getToolOperationReceipt(this.binding.runId, externalCallId);
    if (!receipt) return undefined;
    return gatewayReceiptFromPersistence(receipt);
  }

  async reserve(receipt: VdtGatewayOperationReceipt): Promise<{
    acquired: boolean;
    receipt: VdtGatewayOperationReceipt;
  }> {
    this.assertBinding(receipt);
    const reservation = await this.persistence.reserveToolOperationReceipt(
      this.persistenceReceipt(receipt)
    );
    return {
      acquired: reservation.acquired,
      receipt: gatewayReceiptFromPersistence(reservation.receipt)
    };
  }

  async put(receipt: VdtGatewayOperationReceipt): Promise<void> {
    this.assertBinding(receipt);
    const previous = await this.persistence.getToolOperationReceipt(
      this.binding.runId,
      receipt.externalCallId
    );
    await this.persistence.appendToolOperationReceipt(this.persistenceReceipt(receipt, previous));
  }

  advanceSessionBinding(binding: AgentSessionBinding): void {
    if (
      binding.bindingId !== this.binding.bindingId
      || binding.runId !== this.binding.runId
      || binding.sessionEpoch !== this.binding.sessionEpoch + 1
    ) {
      throw new Error("Gateway ledger recovery must advance the same run binding by one epoch.");
    }
    this.binding = structuredClone(binding);
  }

  private persistenceReceipt(
    receipt: VdtGatewayOperationReceipt,
    previous?: AgentToolOperationReceiptV2 | null
  ): AgentToolOperationReceiptV2 {
    const currentRevision = this.getRevision();
    return {
      schemaVersion: 2,
      receiptId: previous?.receiptId ?? stableReceiptId(receipt.bindingId, receipt.externalCallId),
      runId: this.binding.runId,
      bindingId: receipt.bindingId,
      externalCallId: receipt.externalCallId,
      toolName: receipt.toolName,
      idempotencyKey: previous?.idempotencyKey ?? stableIdempotencyKey(receipt.bindingId, receipt.externalCallId),
      sessionEpoch: receipt.sessionEpoch,
      state: receipt.state,
      argsHash: receipt.callHash,
      resultHash: receipt.result?.resultHash ?? null,
      resultCode: receipt.result?.resultCode ?? (
        receipt.state === "ambiguous" ? "AMBIGUOUS_TOOL_RECOVERY" : null
      ),
      ...(receipt.result ? { replayResult: compactReplayResult(receipt.result) } : {}),
      expectedRevision: previous?.expectedRevision ?? currentRevision,
      committedRevision: receipt.state === "completed" && receipt.result?.status !== "failed"
        ? currentRevision
        : null,
      startedAt: receipt.reservedAt,
      updatedAt: receipt.updatedAt
    };
  }

  private assertBinding(receipt: VdtGatewayOperationReceipt): void {
    if (receipt.bindingId !== this.binding.bindingId) {
      throw new Error("Gateway receipt does not belong to the immutable supervisor binding.");
    }
  }
}

function gatewayReceiptFromPersistence(
  receipt: AgentToolOperationReceiptV2
): VdtGatewayOperationReceipt {
  return {
    schemaVersion: 2,
    bindingId: receipt.bindingId,
    sessionEpoch: receipt.sessionEpoch,
    externalCallId: receipt.externalCallId,
    toolName: receipt.toolName,
    callHash: receipt.argsHash,
    state: receipt.state,
    reservedAt: receipt.startedAt,
    updatedAt: receipt.updatedAt,
    ...(receipt.replayResult ? { result: receipt.replayResult } : {})
  };
}

function compactReplayResult(result: VdtGatewayToolResult): VdtGatewayToolResult {
  const bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  if (bytes > 256 * 1024) {
    throw new Error("Gateway replay result exceeds the 256 KiB durable replay limit.");
  }
  return structuredClone(result);
}

function stableReceiptId(bindingId: string, externalCallId: string): string {
  return `tool-receipt-${digest(`${bindingId}\u0000${externalCallId}`).slice(0, 32)}`;
}

function stableIdempotencyKey(bindingId: string, externalCallId: string): string {
  return `tool-key-${digest(`${bindingId}\u0000${externalCallId}`).slice(0, 32)}`;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
