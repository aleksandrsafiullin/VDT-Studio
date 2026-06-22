import type { VdtProject, VdtWarning } from "@vdt-studio/vdt-core";
import { warning } from "@vdt-studio/vdt-core";
import {
  aiChangeSetDraftSchema,
  aiChangeSetDraftToVdtChangeSet
} from "../schemas/change-set-draft";
import {
  reviewModelOutputSchema,
  type ReviewModelResult,
  type ReviewModelOutput
} from "../schemas/review-model";
import { mapAiWarnings, stripInvalidSuggestedChangeSet } from "./changeset-graph";

const ALLOWED_CATEGORIES = new Set([
  "formula_validity",
  "unit_consistency",
  "business_logic",
  "duplicate_hints",
  "graph_structure",
  "data_quality"
]);

export function validateReviewModelOutput(
  project: VdtProject,
  rawOutput: unknown
): ReviewModelResult {
  const output = reviewModelOutputSchema.parse(rawOutput);
  const projectNodeIds = new Set(project.graph.nodes.map((node) => node.id));
  const projectEdgeIds = new Set(project.graph.edges.map((edge) => edge.id));
  const extraWarnings: VdtWarning[] = [...mapAiWarnings(output.warnings)];

  const findings = output.findings.map((finding) => {
    if (!ALLOWED_CATEGORIES.has(finding.category)) {
      extraWarnings.push(
        warning({
          severity: "warning",
          type: "weak_business_logic",
          message: `Finding category normalized from ${finding.category} to business_logic.`
        })
      );
      return { ...finding, category: "business_logic" as const };
    }

    if (finding.nodeId && !projectNodeIds.has(finding.nodeId)) {
      throw new Error(`Finding references unknown node id: ${finding.nodeId}`);
    }
    if (finding.edgeId && !projectEdgeIds.has(finding.edgeId)) {
      throw new Error(`Finding references unknown edge id: ${finding.edgeId}`);
    }

    return finding;
  });

  let suggestedChanges: ReviewModelResult["suggestedChanges"];
  if (output.suggestedChanges) {
    const draft = aiChangeSetDraftSchema.parse(output.suggestedChanges);
    const mapped = aiChangeSetDraftToVdtChangeSet(draft, {
      taskType: "review_model",
      backendId: "review_model_draft",
      changeSetId: draft.id ?? "changeset_review_model_draft"
    });
    const stripped = stripInvalidSuggestedChangeSet(project, mapped);
    extraWarnings.push(...stripped.warnings);
    suggestedChanges = stripped.changeSet;
  }

  return {
    findings,
    assumptions: output.assumptions,
    questionsForUser: output.questionsForUser,
    warnings: output.warnings,
    ...(suggestedChanges ? { suggestedChanges } : {})
  };
}

export type { ReviewModelOutput };
