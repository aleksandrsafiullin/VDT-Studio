import type { VdtProject } from "@vdt-studio/vdt-core";
import {
  checkUnitsOutputSchema,
  type CheckUnitsResult,
  type CheckUnitsOutput
} from "../schemas/check-units";
import type { AiModelWarning } from "../schemas/shared";

function normalizeUnit(value?: string) {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

function heuristicUnitMismatch(expected?: string, actual?: string) {
  const expectedNorm = normalizeUnit(expected);
  const actualNorm = normalizeUnit(actual);
  if (!expectedNorm || !actualNorm) return false;
  if (expectedNorm === actualNorm) return false;

  const percentAliases = new Set(["%", "percent", "pct", "ratio"]);
  if (percentAliases.has(expectedNorm) && percentAliases.has(actualNorm)) {
    return false;
  }

  return true;
}

export function validateCheckUnitsOutput(project: VdtProject, rawOutput: unknown): CheckUnitsResult {
  const output = checkUnitsOutputSchema.parse(rawOutput);
  const projectNodeIds = new Set(project.graph.nodes.map((node) => node.id));
  const heuristicWarnings: AiModelWarning[] = [];

  for (const finding of output.unitFindings) {
    if (!projectNodeIds.has(finding.nodeId)) {
      throw new Error(`Unit finding references unknown node id: ${finding.nodeId}`);
    }

    const node = project.graph.nodes.find((entry) => entry.id === finding.nodeId);
    const actualFromProject = node?.unit;
    if (
      finding.actualUnit &&
      actualFromProject &&
      normalizeUnit(finding.actualUnit) !== normalizeUnit(actualFromProject)
    ) {
      throw new Error(
        `Unit finding actualUnit for ${finding.nodeId} does not match project excerpt (${finding.actualUnit} vs ${actualFromProject}).`
      );
    }

    if (heuristicUnitMismatch(finding.expectedUnit, finding.actualUnit ?? actualFromProject)) {
      heuristicWarnings.push({
        severity: "info",
        message: `Heuristic unit check flagged ${finding.nodeId}: expected ${finding.expectedUnit}, saw ${finding.actualUnit ?? actualFromProject}.`,
        nodeId: finding.nodeId
      });
    }
  }

  return {
    unitFindings: output.unitFindings,
    assumptions: output.assumptions,
    questionsForUser: output.questionsForUser,
    warnings: [...output.warnings, ...heuristicWarnings]
  };
}

export type { CheckUnitsOutput };
