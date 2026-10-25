import type { VdtEdgeRelation, VdtNode } from "../types";

export const KPI_SUGGESTION_SCHEMA = "kpi_suggestions.v1" as const;
export const KPI_SUGGESTION_VALIDATOR = "smart-kpi-validator.v2";
/** Invalidates rebuildable preparation outcomes when task intent changes,
 * independently of the proposal wire schema and arithmetic validator. */
export const KPI_SUGGESTION_PREPARATION_VERSION = "smart-kpi-preparation.v5";
export const KPI_SUGGESTION_TASK = "suggest_incoming_kpis" as const;
export const KPI_SUGGESTION_TASK_SCHEMA = "suggest-incoming-kpis-v1" as const;
export const KPI_SUGGESTION_LIMITS = {
  inputBytes: 24 * 1024, outputBytes: 16 * 1024, groups: 3, children: 6,
  outputTokens: 2048, apiTimeoutMs: 15_000, cliTimeoutMs: 30_000,
  contextNodes: 32, ttlMs: 7 * 24 * 60 * 60 * 1000
} as const;

/** Stable public configuration identity. Never an admission/session ID, endpoint,
 * API key/hash, pairing token, or revision head. The host owns credentialEpoch. */
export interface KpiSuggestionExecutionIdentity {
  mode: "api" | "cli" | "local_model";
  backendId: string;
  modelId: string;
  bindingVersion: string;
  credentialEpoch: string;
}

export interface KpiSuggestionPeriod {
  key: string;
  grain: "shift" | "day" | "week" | "month" | "quarter" | "year" | "custom";
}

export interface KpiContextNode {
  id: string;
  name: string;
  description?: string;
  type: VdtNode["type"];
  status: VdtNode["status"];
  unit?: string;
  formula?: string;
  valueKnown: boolean;
  valueStatus: VdtNode["valueStatus"] | null;
  provenance: "mapped" | "sourced" | "unsourced";
  mappingIdentity?: string;
}

export interface KpiSuggestionContext {
  schemaVersion: "kpi_suggestion_context.v1";
  workspaceId: string;
  projectId: string;
  vdtId: string | null;
  targetNodeId: string;
  graphFingerprint: string;
  contextHash: string;
  period: KpiSuggestionPeriod;
  business: { name: string; description?: string; industry?: string; context?: string; goal?: string };
  root: KpiContextNode;
  target: KpiContextNode;
  children: KpiContextNode[];
  ancestors: KpiContextNode[];
  siblings: KpiContextNode[];
  decompositionPlan?: VdtNode["decompositionPlan"];
  planScope?: { selection: "target_and_direct_children"; totalNodes: number; excludedUnrelatedNodes: number };
  parentRelationships: Array<{ parentNodeId: string; childNodeId: string; relation: VdtEdgeRelation }>;
  omissions: { directChildren: number; ancestors: number; siblings: number; planNodes: number; relationships: number; text: boolean; cyclic: boolean };
}

export type KpiRecipeUnitRule = "mass_time_rate" | "time_losses" | "rate_yield" | "revenue_net";
export type KpiRecipeUnitRole = "target" | "working_time" | "mass_rate" | "fraction" | "quantity" | "unit_price";

export interface KpiRecipeChild {
  key: string;
  conceptKey: string;
  name: string;
  unitRole: KpiRecipeUnitRole;
  relation: VdtEdgeRelation;
}

/** Browser-safe projection of one audited block in one canonical skill. */
export interface KpiSuggestionRecipe {
  id: string;
  title: string;
  targetRole: string;
  formula: string;
  unitRule: KpiRecipeUnitRule;
  children: KpiRecipeChild[];
  limitations: string[];
  skillId: string;
  skillVersion: number;
  skillHash: string;
  recipeHash: string;
}

export interface KpiSuggestionRecipeCatalog {
  schemaVersion: "kpi_recipe_catalog.v1";
  version: string;
  recipes: KpiSuggestionRecipe[];
}

/** Supplied by an explicit host-observed semantic decision, never inferred from
 * a display name. Binding cannot survive a relevant semantic-context change. */
export interface KpiRecipeBinding {
  id: string;
  recipeId: string;
  recipeHash: string;
  skillHash: string;
  targetRole: string;
  contextHash: string;
  basis: "selected_skill" | "accepted_smart" | "model_selection";
  sourceRef: string;
  rationale: string;
}

export interface KpiSuggestedChild {
  key: string;
  conceptKey: string;
  name: string;
  unit: string;
  description?: string;
  /** Explicit context-observed reference; primary ownership is retained. */
  existingNodeId?: string;
}

export interface KpiSuggestionGroup {
  id: string;
  title: string;
  selectionMode: "all" | "independent";
  children: KpiSuggestedChild[];
  requiredKeys: string[];
  /** Locally checked arithmetic definition; applicability remains a proposal. */
  formula?: string;
  recipeBinding?: KpiRecipeBinding;
  limitations: string[];
}

export interface KpiSuggestionSet {
  schemaVersion: typeof KPI_SUGGESTION_SCHEMA;
  validatorVersion: typeof KPI_SUGGESTION_VALIDATOR;
  catalogVersion: string;
  proposalId: string;
  targetNodeId: string;
  contextHash: string;
  createdAt: string;
  expiresAt: string;
  origin: { kind: "recipe"; sourceRef: string } | { kind: "model"; requestId: string; execution: KpiSuggestionExecutionIdentity };
  rationale: string;
  limitations: string[];
  groups: KpiSuggestionGroup[];
}

export interface KpiSuggestionSelection {
  groupId: string;
  childKeys: string[];
  mode: "contextual" | "formula";
}

/** Separate from cache identity: every application uses current local content
 * and durable CAS. Any unresolved ordinary/Smart commit must reconcile first. */
export interface KpiSuggestionApplyIdentity {
  schemaVersion: "kpi_suggestion_apply.v1";
  workspaceId: string;
  projectId: string;
  vdtId: string | null;
  projectRevision: number;
  projectContentHash: string;
  proposalId: string;
  contextHash: string;
  selectionHash: string;
  durable: null | {
    revisionId: string | null; payloadHash: string | null; commitGeneration: number;
    runtimeGeneration: "v1" | "v2"; generationVersion: number;
  };
}

export type KpiSuggestionState =
  | { status: "idle" | "preparing" }
  | { status: "ready"; proposal: KpiSuggestionSet; source: "library" | "cache" | "prepared" }
  | { status: "empty" | "unavailable" | "timeout" | "failed" | "stale"; reason: string; limitations?: string[] };

/** Read-only task boundary. Registration/transport is a separate implementation
 * stage; its response cannot contain numbers, graph writes or provider settings. */
export interface KpiSuggestionTaskInput {
  schemaVersion: typeof KPI_SUGGESTION_TASK_SCHEMA;
  context: KpiSuggestionContext;
  recipes: KpiSuggestionRecipe[];
}
