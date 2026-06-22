import type { VdtChangeSet } from "@vdt-studio/vdt-core";
import { nowIso } from "@vdt-studio/vdt-core";
import type { SuggestFormulaOutput } from "../../schemas/suggest-formula";
import { mapAiWarnings } from "../changeset-graph";

export function suggestFormulaOutputToChangeSet(
  output: SuggestFormulaOutput,
  options: { backendId: string; changeSetId?: string }
): VdtChangeSet {
  return {
    id: options.changeSetId ?? `changeset_formula_${output.nodeId}`,
    taskType: "suggest_formula",
    backendId: options.backendId,
    createdAt: nowIso(),
    additions: [],
    updates: [
      {
        id: `update_formula_${output.nodeId}`,
        nodeId: output.nodeId,
        patch: {
          formula: output.proposedFormula,
          ...(output.proposedUnit ? { unit: output.proposedUnit } : {}),
          aiRationale: output.aiRationale,
          aiConfidence: output.confidence
        }
      }
    ],
    deletions: [],
    edgeChanges: [],
    assumptions: output.assumptions,
    questions: output.questionsForUser,
    warnings: mapAiWarnings(output.warnings)
  };
}
