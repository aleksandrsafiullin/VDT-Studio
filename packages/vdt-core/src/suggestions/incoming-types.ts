import type { FormulaExpression } from "../formula/ast";
import type { KpiSuggestionContext, KpiSuggestionExecutionIdentity, KpiSuggestionSet } from "./types";

/** FM-01 contract only. Existing live Smart callers are wired in later gates. */
export const INCOMING_KPI_DRAFT_SCHEMA = "incoming_kpi_draft.v2" as const;
export const INCOMING_KPI_APPLY_SCHEMA = "incoming_kpi_apply.v2" as const;
export const INCOMING_KPI_LIMITS = {
  newRows: 6, existingReferences: 16, modelRows: 6, alternatives: 3,
  localFormula: 1024, expandedFormula: 4096, astNodes: 128, astDepth: 24,
  functionArguments: 16, name: 160, unit: 80, description: 120
} as const;

/** Every alias is an engine-compatible identifier. p_ aliases follow the
 * ORIGINAL frozen group order; selection/renaming never renumbers them. */
export type IncomingKpiProposedAlias = `p_${number}`;
export type IncomingKpiManualKey = `m_${string}`;
export type IncomingKpiExistingKey = `e_${string}`;
export type IncomingKpiAlias = IncomingKpiProposedAlias | IncomingKpiManualKey | IncomingKpiExistingKey;
export type IncomingKpiFormulaAuthorship = "recipe" | "model" | "user_edited" | "user";
export type IncomingKpiDraftSource = { kind: "manual" } | { kind: "proposal"; proposalId: string; groupId: string };

/** Unselected blank placeholders may survive in the local draft. Selected own
 * rows require a name/unit and become unknown inputs, never numeric defaults. */
export interface IncomingKpiManualRow {
  key: IncomingKpiManualKey;
  selected: boolean;
  name: string;
  unit: string;
  description?: string;
}
export interface IncomingKpiExistingFactor {
  key: IncomingKpiExistingKey;
  nodeId: string;
  selected: boolean;
}
export interface IncomingKpiBatchDraft {
  schemaVersion: typeof INCOMING_KPI_DRAFT_SCHEMA;
  targetNodeId: string;
  contextHash: string;
  revision: number;
  source: IncomingKpiDraftSource;
  /** Original source child keys, not aliases or mutable display names. */
  childKeys: string[];
  manualChildren: IncomingKpiManualRow[];
  existingFactors: IncomingKpiExistingFactor[];
  /** Raw text is retained even while incomplete/invalid. No on-type serialize. */
  formula: string;
  formulaAuthorship: IncomingKpiFormulaAuthorship;
}
export interface IncomingKpiBatchInput {
  schemaVersion: typeof INCOMING_KPI_APPLY_SCHEMA;
  context: KpiSuggestionContext;
  /** Absent for a manual draft; immutable source evidence for a proposal draft. */
  proposal?: KpiSuggestionSet;
  draft: IncomingKpiBatchDraft;
}

/** Derived from immutable proposal.origin, never from editable authorship.
 * Editing/replacing every model row does not erase this execution requirement. */
export type IncomingKpiLineage =
  | { kind: "manual"; formulaAuthorship: "user"; requiresExecution: false }
  | { kind: "recipe"; proposalId: string; groupId: string; sourceRef: string;
      formulaAuthorship: "recipe" | "user_edited"; requiresExecution: false }
  | { kind: "model"; proposalId: string; groupId: string; requestId: string;
      formulaAuthorship: "recipe" | "model" | "user_edited"; requiresExecution: true; execution: KpiSuggestionExecutionIdentity };

export interface IncomingKpiDraftBinding {
  alias: IncomingKpiAlias;
  origin: "proposed" | "manual" | "existing";
  name: string;
  unit: string;
  /** A new row has no node ID until its accepted operation allocates one. */
  existingNodeId?: string;
  proposalChildKey?: string;
  conceptKey?: string;
  description?: string;
}
export interface IncomingKpiResolvedAlias {
  alias: IncomingKpiAlias;
  nodeId: string;
  kind: "new" | "existing";
  origin: IncomingKpiDraftBinding["origin"];
}
export interface IncomingKpiFormulaAnalysis {
  ast: FormulaExpression;
  references: IncomingKpiAlias[];
  nodes: number;
  depth: number;
}
export interface IncomingKpiDraftIssue {
  code: string;
  message: string;
  alias?: IncomingKpiAlias;
}
export interface IncomingKpiOutputPreview {
  scenarioId: string | null;
  parentBefore: number | undefined;
  parentAfter: number | undefined;
  rootBefore: number | undefined;
  rootAfter: number | undefined;
}
/** Full preview is supplied by FM-02/04, not the syntax-only FM-01 inspector.
 * Preview IDs are virtual; accepted operation IDs are allocated exactly once. */
export type IncomingKpiBatchPreview =
  | { valid: false; draftRevision: number; issues: IncomingKpiDraftIssue[] }
  | { valid: true; draftRevision: number; issues: []; bindings: IncomingKpiDraftBinding[];
      lineage: IncomingKpiLineage; parentType: "root_kpi" | "calculated";
      newNodeCount: number; existingReferenceCount: number; outputPreview: IncomingKpiOutputPreview[];
      /** Formal validity never certifies the business definition/causal model. */
      businessCertified: false };

/** A strict syntax/binding check is useful while editing, but is NOT an Add
 * authorization: full-project cycles/plan/unit/candidate checks still follow. */
export type IncomingKpiDraftInspection =
  | { readyForCompile: false; issues: IncomingKpiDraftIssue[] }
  | { readyForCompile: true; issues: []; analysis: IncomingKpiFormulaAnalysis;
      bindings: IncomingKpiDraftBinding[]; lineage: IncomingKpiLineage;
      newNodeCount: number; existingReferenceCount: number };

export const INCOMING_KPI_UNIT_POLICY = {
  version: "incoming-kpi-units.v1",
  conversion: "same_scale_only",
  /** A literal60/100 never establishes hour/minute or percent/fraction proof. */
  literalConversionProof: false,
  opaqueAtoms: "case_sensitive_exact_equality",
  periodBasis: "explicit_matching_grain",
  perTripRequiresCalendarGrain: false
} as const;
export interface IncomingKpiUnitExpression {
  dimensions: Record<string, number>;
  scales: Record<string, number>;
}
