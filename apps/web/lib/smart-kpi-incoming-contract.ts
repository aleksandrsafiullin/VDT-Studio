import type { IncomingKpiBatchInput, IncomingKpiBatchDraft, IncomingKpiBatchPreview,
  IncomingKpiLineage, IncomingKpiResolvedAlias, IncomingKpiValueResolution, KpiSuggestionContext, KpiSuggestionSet, VdtProject } from "@vdt-studio/vdt-core";
import type { SmartKpiApplyResult,
  SmartKpiOperationV1 as SmartKpiLegacyOperation, SmartKpiMutationView } from "./smart-kpi-transaction";

/** FM-01 public API freeze. These ports are wired by FM-04; no live store
 * method is added/stubbed by this contract-only module. */
export interface SmartKpiIncomingActions {
  buildIncomingKpiContext(targetNodeId: string): Promise<KpiSuggestionContext>;
  previewIncomingKpiBatch(input: IncomingKpiBatchInput): Promise<IncomingKpiBatchPreview>;
  applySmartKpiSuggestion(input: IncomingKpiBatchInput): Promise<SmartKpiApplyResult>;
  undoSmartKpiSuggestion(): Promise<boolean>;
  reconcilePendingSmartKpiCommit(): Promise<boolean>;
}
export interface SmartKpiIncomingView {
  smartKpiMutation: SmartKpiMutationView;
  smartKpiBlockedReason?: string;
}

type OperationBase = Omit<SmartKpiLegacyOperation, "schemaVersion" | "kind" | "phase" | "context" | "proposal" | "selection" | "candidate" | "input" | "checkpointVersionId"> & {
  schemaVersion: "smart_kpi_operation.v2";
  kind: "add";
  context: KpiSuggestionContext;
  proposal?: KpiSuggestionSet;
  draft: IncomingKpiBatchDraft;
  lineage: IncomingKpiLineage;
};
export type SmartKpiMixedOperation =
  | OperationBase & { phase: "preparing"; resolved?: never; candidate?: never; input?: never; checkpointVersionId?: never }
  | OperationBase & { phase: "committing";
      resolved: { aliases: IncomingKpiResolvedAlias[]; formula: string; values?: IncomingKpiValueResolution };
      candidate: VdtProject; input?: NonNullable<SmartKpiLegacyOperation["input"]>; checkpointVersionId: string };

/** Historical v1 committing Add/replay/Undo is never recompiled/reinterpreted.
 * New mixed additions use v2; exact checkpoint-restoring Undo keeps the existing
 * v1 undo receipt/body contract, which contains no proposal-selection policy. */
export type SmartKpiRetainedOperation = SmartKpiLegacyOperation | SmartKpiMixedOperation;
