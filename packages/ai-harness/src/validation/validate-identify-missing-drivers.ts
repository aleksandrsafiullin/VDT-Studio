import type { VdtProject } from "@vdt-studio/vdt-core";
import {
  aiChangeSetDraftSchema,
  aiChangeSetDraftToVdtChangeSet
} from "../schemas/change-set-draft";
import {
  identifyMissingDriversOutputSchema,
  type IdentifyMissingDriversResult,
  type IdentifyMissingDriversOutput
} from "../schemas/identify-missing-drivers";
import { mapAiWarnings, stripInvalidSuggestedChangeSet } from "./changeset-graph";

export function validateIdentifyMissingDriversOutput(
  project: VdtProject,
  rawOutput: unknown
): IdentifyMissingDriversResult {
  const output = identifyMissingDriversOutputSchema.parse(rawOutput);
  const projectNodeIds = new Set(project.graph.nodes.map((node) => node.id));

  for (const suggestion of output.missingDrivers) {
    if (!projectNodeIds.has(suggestion.parentNodeId)) {
      throw new Error(`Missing driver references unknown parent node id: ${suggestion.parentNodeId}`);
    }
    if (suggestion.suggestedNodeId && projectNodeIds.has(suggestion.suggestedNodeId)) {
      throw new Error(`Suggested node id already exists: ${suggestion.suggestedNodeId}`);
    }
  }

  let suggestedChanges: IdentifyMissingDriversResult["suggestedChanges"];
  const extraWarnings = [...mapAiWarnings(output.warnings)];

  if (output.suggestedChanges) {
    const draft = aiChangeSetDraftSchema.parse(output.suggestedChanges);
    const mapped = aiChangeSetDraftToVdtChangeSet(draft, {
      taskType: "identify_missing_drivers",
      backendId: "missing_drivers_draft",
      changeSetId: draft.id ?? "changeset_missing_drivers_draft"
    });
    const stripped = stripInvalidSuggestedChangeSet(project, mapped);
    extraWarnings.push(...stripped.warnings);
    suggestedChanges = stripped.changeSet;
  }

  return {
    missingDrivers: output.missingDrivers,
    assumptions: output.assumptions,
    questionsForUser: output.questionsForUser,
    warnings: output.warnings,
    ...(suggestedChanges ? { suggestedChanges } : {})
  };
}

export type { IdentifyMissingDriversOutput };
