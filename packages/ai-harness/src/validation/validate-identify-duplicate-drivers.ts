import type { VdtProject } from "@vdt-studio/vdt-core";
import {
  aiChangeSetDraftSchema,
  aiChangeSetDraftToVdtChangeSet
} from "../schemas/change-set-draft";
import {
  identifyDuplicateDriversOutputSchema,
  type IdentifyDuplicateDriversResult,
  type IdentifyDuplicateDriversOutput
} from "../schemas/identify-duplicate-drivers";
import { mapAiWarnings, stripInvalidSuggestedChangeSet } from "./changeset-graph";

export function validateIdentifyDuplicateDriversOutput(
  project: VdtProject,
  rawOutput: unknown
): IdentifyDuplicateDriversResult {
  const output = identifyDuplicateDriversOutputSchema.parse(rawOutput);
  const projectNodeIds = new Set(project.graph.nodes.map((node) => node.id));

  for (const cluster of output.duplicateClusters) {
    for (const nodeId of cluster.nodeIds) {
      if (!projectNodeIds.has(nodeId)) {
        throw new Error(`Duplicate cluster references unknown node id: ${nodeId}`);
      }
    }
  }

  let suggestedChanges: IdentifyDuplicateDriversResult["suggestedChanges"];
  const extraWarnings = [...mapAiWarnings(output.warnings)];

  if (output.suggestedChanges) {
    const draft = aiChangeSetDraftSchema.parse(output.suggestedChanges);
    const mapped = aiChangeSetDraftToVdtChangeSet(draft, {
      taskType: "identify_duplicate_drivers",
      backendId: "duplicate_drivers_draft",
      changeSetId: draft.id ?? "changeset_duplicate_drivers_draft"
    });
    const stripped = stripInvalidSuggestedChangeSet(project, mapped);
    extraWarnings.push(...stripped.warnings);
    suggestedChanges = stripped.changeSet;
  }

  return {
    duplicateClusters: output.duplicateClusters,
    assumptions: output.assumptions,
    questionsForUser: output.questionsForUser,
    warnings: output.warnings,
    ...(suggestedChanges ? { suggestedChanges } : {})
  };
}

export type { IdentifyDuplicateDriversOutput };
