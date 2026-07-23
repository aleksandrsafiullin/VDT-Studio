import { z } from "zod";

export const dataDiscoveryToolNameSchema = z.enum([
  "file.inspect",
  "file.preview_raw",
  "file.detect_tables",
  "table.list",
  "table.preview",
  "table.sample",
  "table.profile",
  "table.quality_report",
  "table.flatten_json",
  "table.select_columns",
  "column.profile",
  "column.detect_type",
  "column.detect_unit",
  "column.sample_values",
  "column.value_distribution",
  "column.parse_candidates",
  "column.semantic_role_candidates",
  "table.group_by",
  "table.pivot",
  "table.time_series",
  "table.correlate",
  "table.outliers",
  "table.duplicates",
  "table.cardinality_matrix",
  "text.normalize_values",
  "text.cluster_values",
  "text.extract_keywords",
  "text.suggest_taxonomy_candidates",
  "text.classification_diagnostics",
  "semantic.detect_entities",
  "semantic.detect_measures",
  "semantic.detect_dimensions",
  "semantic.detect_events",
  "semantic.build_dataset_summary",
  "vdt.project_excerpt",
  "vdt.find_matching_nodes",
  "vdt.propose_metric_bindings",
  "vdt.validate_formula_candidates",
  "vdt.validate_change_set"
]);

export const dataAgentDecisionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("tool_call"),
    toolName: dataDiscoveryToolNameSchema,
    rationale: z.string().min(1).max(1000),
    input: z.record(z.unknown())
  }),
  z.object({
    type: z.literal("final_proposal"),
    rationale: z.string().min(1).max(2000),
    result: z.record(z.unknown())
  }),
  z.object({
    type: z.literal("ask_user"),
    questions: z.array(z.string().min(1).max(500)).min(1).max(5),
    rationale: z.string().min(1).max(1000)
  })
]);

export type DataAgentDecision = z.infer<typeof dataAgentDecisionSchema>;
