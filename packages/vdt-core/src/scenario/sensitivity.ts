import { calculateGraph } from "../formula/calculate";
import { calculateScenario } from "./scenario";
import type { VdtInputSensitivity, VdtProject, VdtScenario, VdtScenarioMultiplicativeEffect } from "../types";

function isScenarioInputNode(type: VdtProject["graph"]["nodes"][number]["type"]): boolean {
  return type === "input" || type === "data_mapped";
}

function isOverridableInputNode(node: VdtProject["graph"]["nodes"][number]): boolean {
  return isScenarioInputNode(node.type) && node.fixedInScenario !== true;
}

function isKnownScenarioInputNode(project: VdtProject, nodeId: string): boolean {
  const node = project.graph.nodes.find((candidate) => candidate.id === nodeId);
  return node !== undefined && isOverridableInputNode(node);
}

function rootDelta(baselineRootValue: number | undefined, scenarioRootValue: number | undefined): number | undefined {
  if (
    baselineRootValue === undefined ||
    scenarioRootValue === undefined ||
    !Number.isFinite(baselineRootValue) ||
    !Number.isFinite(scenarioRootValue)
  ) {
    return undefined;
  }

  return scenarioRootValue - baselineRootValue;
}

export function calculateIsolatedRootEffect(
  project: VdtProject,
  nodeId: string,
  value: number
): number | undefined {
  if (!Number.isFinite(value) || !isKnownScenarioInputNode(project, nodeId)) {
    return undefined;
  }

  const baseline = calculateGraph(project);
  const isolated = calculateGraph(project, { overrides: [{ nodeId, value }] });
  return rootDelta(baseline.rootValue, isolated.rootValue);
}

/** Batch isolated root effects for override rows; reuses one baseline graph pass. */
export function calculateIsolatedRootEffects(
  project: VdtProject,
  entries: { nodeId: string; value: number }[]
): Record<string, number | undefined> {
  const baseline = calculateGraph(project);
  const effects: Record<string, number | undefined> = {};

  for (const entry of entries) {
    if (!Number.isFinite(entry.value) || !isKnownScenarioInputNode(project, entry.nodeId)) {
      effects[entry.nodeId] = undefined;
      continue;
    }

    const isolated = calculateGraph(project, { overrides: [{ nodeId: entry.nodeId, value: entry.value }] });
    effects[entry.nodeId] = rootDelta(baseline.rootValue, isolated.rootValue);
  }

  return effects;
}

export function calculateOnePercentRootSensitivity(project: VdtProject, nodeId: string): number | undefined {
  const baseline = calculateGraph(project);
  const baselineValue = baseline.values[nodeId];

  if (baselineValue === undefined || !Number.isFinite(baselineValue)) {
    return undefined;
  }

  return calculateIsolatedRootEffect(project, nodeId, baselineValue * 1.01);
}

function compareSensitivityRank(a: VdtInputSensitivity, b: VdtInputSensitivity): number {
  const aZeroBaseline = a.baselineValue === 0;
  const bZeroBaseline = b.baselineValue === 0;

  if (aZeroBaseline !== bZeroBaseline) {
    return aZeroBaseline ? 1 : -1;
  }

  const absA = Math.abs(a.onePercentRootDelta ?? 0);
  const absB = Math.abs(b.onePercentRootDelta ?? 0);

  if (absA !== absB) {
    return absB - absA;
  }

  return a.nodeName.localeCompare(b.nodeName);
}

export function calculateScenarioMultiplicativeEffect(
  project: VdtProject,
  scenario: VdtScenario
): VdtScenarioMultiplicativeEffect {
  const scenarioResult = calculateScenario(project, scenario);
  const totalRootEffect = scenarioResult.absoluteChange;
  const validOverrides = scenario.overrides.filter((override) =>
    isKnownScenarioInputNode(project, override.nodeId)
  );

  if (validOverrides.length === 0) {
    return {
      totalRootEffect,
      sumOfIsolatedEffects: undefined,
      multiplicativeEffect: undefined
    };
  }

  const isolatedByNodeId = calculateIsolatedRootEffects(project, validOverrides);
  let sumIsolated = 0;
  let hasIsolated = false;

  for (const override of validOverrides) {
    const isolated = isolatedByNodeId[override.nodeId];
    if (isolated !== undefined && Number.isFinite(isolated)) {
      sumIsolated += isolated;
      hasIsolated = true;
    }
  }

  const sumOfIsolatedEffects = hasIsolated ? sumIsolated : undefined;
  const multiplicativeEffect =
    totalRootEffect !== undefined && sumOfIsolatedEffects !== undefined
      ? totalRootEffect - sumOfIsolatedEffects
      : undefined;

  return {
    totalRootEffect,
    sumOfIsolatedEffects,
    multiplicativeEffect
  };
}

export function rankScenarioInputNodes(project: VdtProject): VdtInputSensitivity[] {
  const baseline = calculateGraph(project);

  return project.graph.nodes
    .filter((node) => isOverridableInputNode(node))
    .map((node) => {
      const baselineValue = baseline.values[node.id];
      const onePercentRootDelta =
        baselineValue !== undefined && Number.isFinite(baselineValue)
          ? calculateOnePercentRootSensitivity(project, node.id)
          : undefined;

      return {
        nodeId: node.id,
        nodeName: node.name,
        baselineValue,
        unit: node.unit,
        onePercentRootDelta
      };
    })
    .sort(compareSensitivityRank);
}
