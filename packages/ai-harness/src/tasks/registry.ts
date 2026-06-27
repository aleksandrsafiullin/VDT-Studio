import type { VdtAiTaskType } from "@vdt-studio/vdt-core";

/** Plan §9.7 — prompt / input JSON cap. */
export const DEFAULT_MAX_INPUT_BYTES = 512 * 1024;

/** Plan §9.7 — result JSON cap. */
export const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

/** Explain tasks — max bytes per markdown/text section. */
export const EXPLAIN_TEXT_SECTION_MAX_BYTES = 8 * 1024;

/** Consistent review-array caps reused across all task output schemas. */
export const SHARED_REVIEW_ARRAY_LIMITS = {
  maxAssumptions: 30,
  maxQuestions: 30,
  maxWarnings: 30,
  maxAssumptionItemLength: 500,
  maxQuestionItemLength: 500
} as const;

export interface VdtAiTaskChangeLimits {
  maxAdditions: number;
  maxUpdates: number;
  maxDeletions: number;
  maxEdgeChanges: number;
}

export interface VdtAiTaskLimits {
  maxInputBytes: number;
  maxOutputBytes: number;
  maxNodes?: number;
  maxEdges?: number;
  maxAssumptions: number;
  maxQuestions: number;
  maxWarnings: number;
  maxAssumptionItemLength: number;
  maxQuestionItemLength: number;
  maxChanges?: VdtAiTaskChangeLimits;
  maxTextSectionBytes?: number;
  maxFindings?: number;
}

const GRAPH_MUTATION_CHANGES: VdtAiTaskChangeLimits = {
  maxAdditions: 15,
  maxUpdates: 10,
  maxDeletions: 5,
  maxEdgeChanges: 20
};

const FIELD_UPDATE_CHANGES: VdtAiTaskChangeLimits = {
  maxAdditions: 0,
  maxUpdates: 10,
  maxDeletions: 0,
  maxEdgeChanges: 0
};

function withSharedReviewArrays(
  limits: Omit<VdtAiTaskLimits, keyof typeof SHARED_REVIEW_ARRAY_LIMITS>
): VdtAiTaskLimits {
  return { ...SHARED_REVIEW_ARRAY_LIMITS, ...limits };
}

export const TASK_LIMITS: Record<VdtAiTaskType, VdtAiTaskLimits> = {
  agent_decision: withSharedReviewArrays({
    maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
    maxFindings: 30
  }),
  agent_plan: withSharedReviewArrays({
    maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
    maxFindings: 30
  }),
  generate_tree: withSharedReviewArrays({
    maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
    maxNodes: 60,
    maxEdges: 120
  }),
  deepen_node: withSharedReviewArrays({
    maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
    maxNodes: 15,
    maxEdges: 20,
    maxChanges: GRAPH_MUTATION_CHANGES
  }),
  simplify_branch: withSharedReviewArrays({
    maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
    maxChanges: GRAPH_MUTATION_CHANGES
  }),
  suggest_alternative: withSharedReviewArrays({
    maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
    maxNodes: 60,
    maxEdges: 120,
    maxChanges: GRAPH_MUTATION_CHANGES
  }),
  suggest_formula: withSharedReviewArrays({
    maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
    maxChanges: FIELD_UPDATE_CHANGES
  }),
  review_model: withSharedReviewArrays({
    maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
    maxFindings: 40,
    maxChanges: GRAPH_MUTATION_CHANGES
  }),
  check_units: withSharedReviewArrays({
    maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
    maxFindings: 40
  }),
  identify_missing_drivers: withSharedReviewArrays({
    maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
    maxFindings: 30,
    maxChanges: {
      ...GRAPH_MUTATION_CHANGES,
      maxDeletions: 0
    }
  }),
  identify_duplicate_drivers: withSharedReviewArrays({
    maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
    maxFindings: 30,
    maxChanges: {
      ...GRAPH_MUTATION_CHANGES,
      maxAdditions: 0
    }
  }),
  explain_node: withSharedReviewArrays({
    maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
    maxTextSectionBytes: EXPLAIN_TEXT_SECTION_MAX_BYTES
  }),
  explain_scenario: withSharedReviewArrays({
    maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
    maxTextSectionBytes: EXPLAIN_TEXT_SECTION_MAX_BYTES
  }),
  generate_executive_summary: withSharedReviewArrays({
    maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
    maxTextSectionBytes: EXPLAIN_TEXT_SECTION_MAX_BYTES
  })
};
