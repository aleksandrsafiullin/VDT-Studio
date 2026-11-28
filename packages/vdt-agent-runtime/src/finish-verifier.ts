import { createHash } from "node:crypto";
import { DERIVED_ROOT_REQUIREMENT } from "./model-acceptance-contract";
import {
  calculateGraph,
  WORKSPACE_MODEL_READINESS_POLICY_VERSION,
  evaluateModelReadiness,
  type ModelReadinessPurpose,
  validateIncomingKpiLayer,
  type GraphCalculationResult,
  type VdtProject
} from "@vdt-studio/vdt-core";
import type { AgentSessionBinding } from "./agent-execution-contracts";
import type { ConstructionSourceIssue } from "./construction-source-facts";
import type {
  AgentSupervisorPersistenceStateV2,
  FinishReceiptV2
} from "./agent-supervisor-persistence";
import { buildFormulaBacklog, summarizeCalculation, summarizeValidation } from "./summaries";
import type { AgentFinishOutcome, VdtAgentMode, VdtAgentOutcome } from "./types";

export interface DeterministicFinishVerificationInput {
  binding: AgentSessionBinding;
  project: VdtProject | null;
  currentRevision: number;
  expectedHeadRevision: number;
  mode: VdtAgentMode;
  artifactDelivery?: FinishReceiptV2["artifactDelivery"];
  outcome?: VdtAgentOutcome | undefined;
  /** Server-derived for a run that started from an empty placeholder KPI. */
  requireDerivedRoot?: boolean | undefined;
  requireHierarchy?: boolean | undefined;
  purpose?: ModelReadinessPurpose | undefined;
  unboundSourceFacts?: readonly { quote: string }[] | undefined;
  sourceGroundingIssues?: readonly ConstructionSourceIssue[] | undefined;
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
    selectedNodeId?: string | undefined;
    createdNodeIds?: string[] | undefined;
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
  /** Host-only evidence. The tool receives the bounded payload. */
  calculation?: GraphCalculationResult | undefined;
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
  if (input.outcome === "answer") {
    if (blockers.length) return rejected(blockers);
    return issueReceipt(input, hashJson(null), hashJson(null));
  }
  if (!input.project) blockers.push({ code: "PROJECT_MISSING", detail: "No draft VDT exists." });
  if (input.unboundSourceFacts?.length) blockers.push({
    code: "SOURCE_PROVENANCE_INCOMPLETE",
    detail: `Use each quoted measurement as an input leaf in the result's dependency tree. ${input.unboundSourceFacts.map(({ quote }) => quote).join(". ")}`
  });
  if (input.sourceGroundingIssues?.length) blockers.push({
    code: "SOURCE_GROUNDING_CONFLICT", detail: input.sourceGroundingIssues.slice(0, 8).map(({ detail }) => detail).join(" ")
  });
  if (input.mode === "deepen_node" && input.modeCompletion?.immediateChildCreated !== true) {
    blockers.push({ code: "MODE_COMPLETION_MISSING", detail: "The selected KPI has no newly created immediate child layer." });
  }
  if (blockers.length > 0 || !input.project) return rejected(blockers, input.sourceGroundingIssues?.length
    ? { sourceGroundingIssues: input.sourceGroundingIssues.slice(0, 8) } : undefined);

  const project = input.project;
  const purpose = input.outcome ?? input.purpose ?? finishReadinessPurpose(input.mode);
  const readiness = evaluateModelReadiness(project, {
    purpose, requireDerivedRoot: input.requireDerivedRoot, requireHierarchy: input.requireHierarchy
  });
  const { hierarchy, validation } = readiness;
  if (hierarchy && !hierarchy.valid) {
    return rejected([{ code: "HIERARCHY_INCOMPLETE", detail: hierarchy.errors.slice(0, 12).join(" ") }], {
      hierarchy: { ...hierarchy, errors: hierarchy.errors.slice(0, 20), errorCount: hierarchy.errors.length }
    });
  }
  const backlog = buildFormulaBacklog(project);
  if (backlog.length > 0) {
    return rejected([{
      code: "FORMULA_BACKLOG_NOT_EMPTY",
      detail: `Calculated nodes still need formulas: ${backlog.slice(0, 12).map((item) => item.nodeId).join(", ")}.`
    }], { formulaBacklogCount: backlog.length });
  }
  if (input.mode === "deepen_node") {
    try { validateIncomingKpiLayer(project, input.modeCompletion?.selectedNodeId ?? "", input.modeCompletion?.createdNodeIds ?? []); }
    catch (error) { return rejected([{ code: "TARGET_FORMULA_REQUIRED", detail: error instanceof Error ? error.message : "Check the selected incoming formula." }]); }
  }

  const validationSummary = summarizeValidation(validation);
  if (!validation.valid) {
    return rejected([{
      code: "GRAPH_INVALID",
      detail: validation.errors.slice(0, 8).map((error) => error.message).join("; ") || "Graph validation failed."
    }], { validation: validationSummary, readinessIssues: readiness.issues.filter(issue => issue.severity === "error").slice(0, 8) });
  }

  if (readiness.issues.some(issue => issue.code === "ROOT_NOT_DERIVED")) {
    return rejected([{ code: "ROOT_NOT_DERIVED", detail: DERIVED_ROOT_REQUIREMENT }]);
  }

  if (input.outcome === "structural_model") {
    if (!readiness.accepted) return rejected(readiness.issues.filter(issue => issue.severity === "error")
      .map(issue => ({ code: issue.code, detail: issue.message })));
    const missingInputs = readiness.missingInputs
      .slice()
      .sort((left, right) => Number(right.requiredForRoot) - Number(left.requiredForRoot));
    return issueReceipt(input, hashJson(validationSummary), hashJson(null), {
      missingInputs: missingInputs.slice(0, 24),
      missingInputCount: missingInputs.length
    });
  }

  const calculation = readiness.calculation ?? calculateGraph(project);
  const calculationSummary = summarizeCalculation(calculation);
  const errors = readiness.issues.filter(issue => issue.severity === "error" && issue.code !== "ROOT_VALUE_NOT_FINITE");
  if (errors.length || (input.mode === "deepen_node" && calculation.errors.some(error => error.type !== "missing_value"))) {
    return rejected([{
      code: "CALCULATION_ERRORS",
      detail: (errors.length ? errors : calculation.errors).slice(0, 8).map(error => error.message).join("; ")
    }], { calculation: calculationSummary, readinessIssues: errors.slice(0, 8) });
  }
  if (!readiness.accepted) {
    return rejected([{ code: "ROOT_VALUE_NOT_FINITE", detail: "Calculated root value is missing or non-finite." }]);
  }

  return issueReceipt(input, hashJson(validationSummary), hashJson(calculationSummary),
    input.outcome === "calculated_baseline" ? { rootValue: calculation.rootValue } : {}, calculation);
}

function issueReceipt(
  input: DeterministicFinishVerificationInput,
  validationHash: string,
  calculationHash: string,
  evidence: Pick<AgentFinishOutcome, "missingInputs" | "missingInputCount" | "rootValue"> = {},
  calculation?: GraphCalculationResult
): DeterministicFinishVerificationResult {
  const projectHash = hashJson(input.project);
  const policyVersion = input.outcome ? WORKSPACE_MODEL_READINESS_POLICY_VERSION : undefined;
  const outcomeFields = policyVersion ? { outcome: input.outcome, policyVersion, ...evidence } : {};
  const artifactFields = input.artifactDelivery ? { artifactDelivery: input.artifactDelivery } : {};
  const existing = input.existingFinishReceipt;
  if (
    existing
    && existing.bindingId === input.binding.bindingId
    && existing.sessionEpoch === input.binding.sessionEpoch
    && existing.projectRevision === input.currentRevision
    && existing.projectHash === projectHash
    && existing.validationHash === validationHash
    && existing.calculationHash === calculationHash
    && existing.outcome === input.outcome
    && existing.policyVersion === policyVersion
    && hashJson(existing.artifactDelivery ?? null) === hashJson(input.artifactDelivery ?? null)
  ) {
    return accepted(existing, calculation);
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
    ...outcomeFields,
    ...artifactFields,
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
    ...outcomeFields,
    ...artifactFields,
    finalMessageHash: null,
    verifiedAt,
    finalPersistedAt: null
  };
  return accepted(finishReceipt, calculation);
}

export function finishReadinessPurpose(mode: VdtAgentMode): ModelReadinessPurpose {
  return mode === "deepen_node" || mode === "review_project" ? "structural_model" : "calculated_baseline";
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
  calculation?: GraphCalculationResult
): DeterministicFinishVerificationResult {
  const rootValue = calculation?.rootValue;
  return {
    accepted: true,
    code: "FINISH_VERIFIED",
    receiptId: receipt.receiptId,
    receiptHash: receipt.receiptHash,
    finishReceipt: receipt,
    calculation,
    payload: {
      receiptId: receipt.receiptId,
      receiptHash: receipt.receiptHash,
      projectRevision: receipt.projectRevision,
      ...(receipt.artifactDelivery ? { artifactDelivery: receipt.artifactDelivery } : {}),
      ...(receipt.outcome ? { outcome: receipt.outcome, policyVersion: receipt.policyVersion, projectHash: receipt.projectHash } : {}),
      ...(receipt.missingInputs ? { missingInputs: receipt.missingInputs, missingInputCount: receipt.missingInputCount } : {}),
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
