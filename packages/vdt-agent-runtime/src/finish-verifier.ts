import { createHash } from "node:crypto";
import {
  calculateGraph,
  validateGraph,
  type VdtProject
} from "@vdt-studio/vdt-core";
import type { AgentSessionBinding } from "./agent-execution-contracts";
import type {
  AgentSupervisorPersistenceStateV2,
  FinishReceiptV2
} from "./agent-supervisor-persistence";
import { buildFormulaBacklog, summarizeCalculation, summarizeValidation } from "./summaries";
import type { VdtAgentMode } from "./types";

export interface DeterministicFinishVerificationInput {
  binding: AgentSessionBinding;
  project: VdtProject | null;
  currentRevision: number;
  expectedHeadRevision: number;
  mode: VdtAgentMode;
  pendingQuestion: boolean;
  pendingApproval: boolean;
  pendingProposal: boolean;
  ambiguousOperation: boolean;
  /** The Gateway call that is synchronously asking for this verification.
   * Only this exact in-flight run.request_finish callback is excluded from the
   * unsettled-operation check. */
  currentFinishCallId?: string | undefined;
  modeCompletion?: {
    immediateChildCreated?: boolean | undefined;
  } | undefined;
  supervisorState?: AgentSupervisorPersistenceStateV2 | null | undefined;
  existingFinishReceipt?: FinishReceiptV2 | null | undefined;
  now?: (() => string) | undefined;
}

export interface DeterministicFinishVerificationResult {
  accepted: boolean;
  code: string;
  payload: Readonly<Record<string, unknown>>;
  receiptId?: string | undefined;
  receiptHash?: string | undefined;
  finishReceipt?: FinishReceiptV2 | undefined;
}

/** The model can request finish, but only deterministic VDT authority can
 * verify it. No user-facing final is synthesized here. */
export function verifyDeterministicRunFinish(
  input: DeterministicFinishVerificationInput
): DeterministicFinishVerificationResult {
  const blockers: Array<{ code: string; detail: string }> = [];
  if (input.currentRevision !== input.expectedHeadRevision) {
    blockers.push({ code: "STALE_PROJECT_REVISION", detail: "Project head changed after the last confirmed checkpoint." });
  }
  if (input.pendingQuestion) blockers.push({ code: "PENDING_QUESTION", detail: "A user question is still pending." });
  if (input.pendingApproval) blockers.push({ code: "PENDING_APPROVAL", detail: "A mutation approval is still pending." });
  if (input.pendingProposal) blockers.push({ code: "PENDING_PROPOSAL", detail: "A mutation proposal is not terminal." });
  if (input.ambiguousOperation || hasUnsettledOperation(
    input.supervisorState,
    input.currentFinishCallId
  )) {
    blockers.push({ code: "OPERATION_LEDGER_NOT_SETTLED", detail: "An engine or tool operation is unfinished or ambiguous." });
  }
  if (!input.project) blockers.push({ code: "PROJECT_MISSING", detail: "No draft VDT exists." });
  if (input.mode === "deepen_node" && input.modeCompletion?.immediateChildCreated !== true) {
    blockers.push({ code: "MODE_COMPLETION_MISSING", detail: "The selected KPI has no newly created immediate child layer." });
  }
  if (blockers.length > 0 || !input.project) return rejected(blockers);

  const project = input.project;
  const backlog = buildFormulaBacklog(project);
  if (backlog.length > 0) {
    return rejected([{
      code: "FORMULA_BACKLOG_NOT_EMPTY",
      detail: `Calculated nodes still need formulas: ${backlog.slice(0, 12).map((item) => item.nodeId).join(", ")}.`
    }], { formulaBacklogCount: backlog.length });
  }

  const validation = validateGraph(project);
  const validationSummary = summarizeValidation(validation);
  if (!validation.valid) {
    return rejected([{
      code: "GRAPH_INVALID",
      detail: validation.errors.slice(0, 8).map((error) => error.message).join("; ") || "Graph validation failed."
    }], { validation: validationSummary });
  }

  const calculation = calculateGraph(project);
  const calculationSummary = summarizeCalculation(calculation);
  if (calculation.errors.length > 0) {
    return rejected([{
      code: "CALCULATION_ERRORS",
      detail: calculation.errors.slice(0, 8).map((error) => error.message).join("; ")
    }], { calculation: calculationSummary });
  }
  if (
    calculation.rootValue === undefined || !Number.isFinite(calculation.rootValue)
  ) {
    return rejected([{ code: "ROOT_VALUE_NOT_FINITE", detail: "Calculated root value is missing or non-finite." }]);
  }

  const projectHash = hashJson(project);
  const validationHash = hashJson(validationSummary);
  const calculationHash = hashJson(calculationSummary);
  const existing = input.existingFinishReceipt;
  if (
    existing
    && existing.bindingId === input.binding.bindingId
    && existing.sessionEpoch === input.binding.sessionEpoch
    && existing.projectRevision === input.currentRevision
    && existing.projectHash === projectHash
    && existing.validationHash === validationHash
    && existing.calculationHash === calculationHash
  ) {
    return accepted(existing, calculation.rootValue);
  }

  const verifiedAt = (input.now ?? (() => new Date().toISOString()))();
  const receiptSeed = {
    schemaVersion: 2 as const,
    runId: input.binding.runId,
    bindingId: input.binding.bindingId,
    sessionEpoch: input.binding.sessionEpoch,
    projectRevision: input.currentRevision,
    projectHash,
    validationHash,
    calculationHash,
    verifiedAt
  };
  const receiptHash = hashJson(receiptSeed);
  const finishReceipt: FinishReceiptV2 = {
    schemaVersion: 2,
    receiptId: `finish-receipt-${receiptHash.slice("sha256:".length, "sha256:".length + 32)}`,
    runId: input.binding.runId,
    bindingId: input.binding.bindingId,
    sessionEpoch: input.binding.sessionEpoch,
    state: "verified",
    receiptHash,
    projectRevision: input.currentRevision,
    projectHash,
    validationHash,
    calculationHash,
    finalMessageHash: null,
    verifiedAt,
    finalPersistedAt: null
  };
  return accepted(finishReceipt, calculation.rootValue);
}

function hasUnsettledOperation(
  state: AgentSupervisorPersistenceStateV2 | null | undefined,
  currentFinishCallId: string | undefined
): boolean {
  if (!state) return false;
  const latestExchanges = latestReceiptsByKey(
    state.exchangeReceipts,
    (receipt) => receipt.stableCallKey
  );
  const latestTools = latestReceiptsByKey(
    state.toolOperationReceipts,
    (receipt) => receipt.externalCallId
  );
  const currentFinishReceipt = currentFinishCallId
    ? latestTools.find((receipt) =>
        receipt.externalCallId === currentFinishCallId
        && receipt.toolName === "run.request_finish"
        && (receipt.state === "reserved" || receipt.state === "in_flight")
      )
    : undefined;
  const activeToolCall = state.checkpoint?.activeToolCall;
  const activeToolIsCurrentFinish = Boolean(
    currentFinishReceipt
    && activeToolCall?.externalCallId === currentFinishCallId
    && activeToolCall?.toolName === "run.request_finish"
  );
  return latestExchanges.some((receipt) =>
    receipt.state === "prepared" || receipt.state === "in_flight" || receipt.state === "ambiguous"
  ) || latestTools.some((receipt) =>
    receipt.state === "ambiguous"
    || (
      !(
        currentFinishReceipt
        && receipt.externalCallId === currentFinishCallId
        && receipt.toolName === "run.request_finish"
      )
      && (receipt.state === "reserved" || receipt.state === "in_flight")
    )
  ) || state.checkpoint?.activeExchange?.state === "in_flight"
    || state.checkpoint?.activeExchange?.state === "ambiguous"
    || (!activeToolIsCurrentFinish && (
      activeToolCall?.state === "in_flight"
      || activeToolCall?.state === "ambiguous"
    ));
}

function latestReceiptsByKey<T>(
  receipts: readonly T[],
  keyFor: (receipt: T) => string
): T[] {
  const latest = new Map<string, T>();
  for (const receipt of receipts) latest.set(keyFor(receipt), receipt);
  return [...latest.values()];
}

function rejected(
  blockers: Array<{ code: string; detail: string }>,
  extra: Readonly<Record<string, unknown>> = {}
): DeterministicFinishVerificationResult {
  return {
    accepted: false,
    code: blockers[0]?.code ?? "FINISH_REJECTED",
    payload: {
      blockers: blockers.slice(0, 12),
      ...extra
    }
  };
}

function accepted(
  receipt: FinishReceiptV2,
  rootValue: number | undefined
): DeterministicFinishVerificationResult {
  return {
    accepted: true,
    code: "FINISH_VERIFIED",
    receiptId: receipt.receiptId,
    receiptHash: receipt.receiptHash,
    finishReceipt: receipt,
    payload: {
      receiptId: receipt.receiptId,
      receiptHash: receipt.receiptHash,
      projectRevision: receipt.projectRevision,
      ...(rootValue !== undefined && Number.isFinite(rootValue) ? { rootValue } : {})
    }
  };
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
