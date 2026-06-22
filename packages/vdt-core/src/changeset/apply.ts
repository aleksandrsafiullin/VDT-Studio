import { validateGraph } from "../graph/validation";
import type { VdtProject } from "../types";
import { cloneProject } from "../utils";
import type { ApplyChangeSetResult, VdtChangeSet } from "./types";
import {
  collectChangeSetStructureWarnings,
  collectFormulaValidationWarnings,
  filterChangeSet,
  mutateProjectGraph
} from "./mutate";

export function applyChangeSet(
  project: VdtProject,
  changeSet: VdtChangeSet,
  selection: ReadonlySet<string>
): ApplyChangeSetResult {
  const baseline = cloneProject(project);
  const filtered = filterChangeSet(changeSet, selection);
  const structureErrors = collectChangeSetStructureWarnings(changeSet, project, filtered);
  const formulaErrors = collectFormulaValidationWarnings(filtered);

  if (structureErrors.length > 0 || formulaErrors.length > 0) {
    return {
      success: false,
      project: baseline,
      warnings: [...structureErrors, ...formulaErrors]
    };
  }

  const next = mutateProjectGraph(baseline, filtered, { touchUpdatedAt: true });
  const validation = validateGraph(next.graph, next.rootNodeId);

  if (!validation.valid) {
    return {
      success: false,
      project: baseline,
      warnings: [...validation.errors, ...validation.warnings]
    };
  }

  return {
    success: true,
    project: next,
    warnings: validation.warnings
  };
}
