import { calculateGraph } from "../formula/calculate";
import type {
  GraphCalculationResult,
  VdtImpactNode,
  VdtProject,
  VdtScenario,
  VdtScenarioOverride,
  VdtScenarioResult,
  VdtWarning
} from "../types";
import { percentageChange, warning } from "../utils";

const EPSILON = 0.000001;

export function getActiveScenarioOverrides(project: VdtProject, scenario: VdtScenario): VdtScenarioOverride[] {
  const fixedInScenarioNodeIds = new Set(
    project.graph.nodes.filter((node) => node.fixedInScenario === true).map((node) => node.id)
  );

  return scenario.overrides.filter((override) => !fixedInScenarioNodeIds.has(override.nodeId));
}

export function calculateScenarioGraph(project: VdtProject, scenario: VdtScenario): GraphCalculationResult {
  return calculateGraph(project, { overrides: getActiveScenarioOverrides(project, scenario) });
}

export function calculateScenario(project: VdtProject, scenario: VdtScenario): VdtScenarioResult {
  const nodeIds = new Set(project.graph.nodes.map((node) => node.id));
  const overrideErrors: VdtWarning[] = scenario.overrides
    .filter((override) => !nodeIds.has(override.nodeId))
    .map((override) =>
      warning({
        severity: "error",
        type: "invalid_graph",
        message: `Scenario override references a missing node: ${override.nodeId}`,
        nodeId: override.nodeId
      })
    );
  const baseline = calculateGraph(project);
  const scenarioCalculation = calculateScenarioGraph(project, scenario);
  const impactedNodes: VdtImpactNode[] = [];

  for (const node of project.graph.nodes) {
    const baselineValue = baseline.values[node.id];
    const scenarioValue = scenarioCalculation.values[node.id];

    if (baselineValue === undefined || scenarioValue === undefined) {
      continue;
    }

    const absoluteChange = scenarioValue - baselineValue;
    if (Math.abs(absoluteChange) <= EPSILON) {
      continue;
    }

    impactedNodes.push({
      nodeId: node.id,
      nodeName: node.name,
      baselineValue,
      scenarioValue,
      absoluteChange,
      percentageChange: percentageChange(baselineValue, scenarioValue),
      unit: node.unit
    });
  }

  return {
    rootNodeId: project.rootNodeId,
    baselineValue: baseline.rootValue,
    scenarioValue: scenarioCalculation.rootValue,
    absoluteChange:
      baseline.rootValue !== undefined && scenarioCalculation.rootValue !== undefined
        ? scenarioCalculation.rootValue - baseline.rootValue
        : undefined,
    percentageChange: percentageChange(baseline.rootValue, scenarioCalculation.rootValue),
    impactedNodes,
    calculationTrace: scenarioCalculation.trace,
    errors: [...overrideErrors, ...baseline.errors, ...scenarioCalculation.errors],
    warnings: [...baseline.warnings, ...scenarioCalculation.warnings]
  };
}
