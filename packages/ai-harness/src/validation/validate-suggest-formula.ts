import type { VdtChangeSet, VdtProject, VdtWarning } from "@vdt-studio/vdt-core";
import { parseFormula } from "@vdt-studio/vdt-core";
import { FormulaParseError } from "@vdt-studio/vdt-core";
import {
  suggestFormulaOutputSchema,
  type SuggestFormulaOutput
} from "../schemas/suggest-formula";
import {
  assertChangeSetPreviewValid,
  mapAiWarnings
} from "./changeset-graph";
import { suggestFormulaOutputToChangeSet } from "./to-changeset/suggest-formula";

export interface ValidateSuggestFormulaResult {
  output: SuggestFormulaOutput;
  warnings: VdtWarning[];
}

export function validateSuggestFormulaOutput(
  project: VdtProject,
  rawOutput: unknown,
  inputNodeId: string
): ValidateSuggestFormulaResult {
  const output = suggestFormulaOutputSchema.parse(rawOutput);
  const warnings = [...mapAiWarnings(output.warnings)];

  if (output.nodeId !== inputNodeId) {
    throw new Error(
      `Formula output nodeId (${output.nodeId}) does not match requested node (${inputNodeId}).`
    );
  }

  const node = project.graph.nodes.find((entry) => entry.id === output.nodeId);
  if (!node) {
    throw new Error(`Target node does not exist in project: ${output.nodeId}`);
  }

  try {
    parseFormula(output.proposedFormula);
  } catch (error) {
    const message =
      error instanceof FormulaParseError
        ? `Proposed formula cannot be parsed: ${error.message}`
        : "Proposed formula cannot be parsed.";
    throw new Error(message);
  }

  return { output, warnings };
}

export function validateAndMapSuggestFormula(
  project: VdtProject,
  rawOutput: unknown,
  inputNodeId: string,
  backendId: string
): { changeSet: VdtChangeSet; output: SuggestFormulaOutput } {
  const { output, warnings: semanticWarnings } = validateSuggestFormulaOutput(
    project,
    rawOutput,
    inputNodeId
  );
  const changeSet = suggestFormulaOutputToChangeSet(output, { backendId });
  changeSet.warnings = [...changeSet.warnings, ...semanticWarnings];

  assertChangeSetPreviewValid(project, changeSet, "Suggest formula proposal");
  return { changeSet, output };
}
