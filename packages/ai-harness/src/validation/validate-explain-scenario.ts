import type { VdtProject } from "@vdt-studio/vdt-core";
import { TASK_LIMITS } from "../tasks/registry";
import {
  explainScenarioOutputSchema,
  type ExplainScenarioResult,
  type ExplainScenarioOutput
} from "../schemas/explain-scenario";
import { assertTextSectionLength } from "./changeset-graph";

export function validateExplainScenarioOutput(
  project: VdtProject,
  rawOutput: unknown,
  inputScenarioId: string
): ExplainScenarioResult {
  const output = explainScenarioOutputSchema.parse(rawOutput);
  const maxBytes = TASK_LIMITS.explain_scenario.maxTextSectionBytes ?? 8 * 1024;

  if (output.scenarioId !== inputScenarioId) {
    throw new Error(
      `Explain scenario output scenarioId (${output.scenarioId}) does not match requested scenario (${inputScenarioId}).`
    );
  }

  if (!project.scenarios.some((scenario) => scenario.id === output.scenarioId)) {
    throw new Error(`Explained scenario does not exist in project: ${output.scenarioId}`);
  }

  assertTextSectionLength(output.narrative, maxBytes, "narrative");

  if (output.impactHighlights.length === 0) {
    throw new Error("Explain scenario output must include at least one impact highlight.");
  }

  const projectNodeIds = new Set(project.graph.nodes.map((node) => node.id));
  for (const highlight of output.impactHighlights) {
    if (!projectNodeIds.has(highlight.nodeId)) {
      throw new Error(`Impact highlight references unknown node id: ${highlight.nodeId}`);
    }
  }

  return output;
}

export type { ExplainScenarioOutput };
