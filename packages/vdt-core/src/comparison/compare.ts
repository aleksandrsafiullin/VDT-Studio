import { calculateGraph } from "../formula/calculate";
import { rankScenarioInputNodes } from "../scenario/sensitivity";
import type { VdtProject } from "../types";

export interface VdtComparisonRootDelta {
  leftValue?: number | undefined;
  rightValue?: number | undefined;
  absoluteDelta?: number | undefined;
  percentDelta?: number | undefined;
}

export interface VdtComparisonStructuralDiff {
  addedDrivers: string[];
  removedDrivers: string[];
  changedFormulas: string[];
  changedValues: string[];
}

export interface VdtBottleneckCandidate {
  nodeId: string;
  nodeName: string;
  reason: string;
  evidence: "value_delta" | "formula_change" | "sensitivity" | "missing_driver";
  severity: "low" | "medium" | "high";
}

export interface VdtComparisonResult {
  rootDelta?: VdtComparisonRootDelta | undefined;
  structuralDiff: VdtComparisonStructuralDiff;
  bottleneckCandidates: VdtBottleneckCandidate[];
}

export interface CompareVdtProjectsOptions {
  maxBottleneckCandidates?: number | undefined;
}

export function compareVdtProjects(
  left: VdtProject,
  right: VdtProject,
  options: CompareVdtProjectsOptions = {}
): VdtComparisonResult {
  const maxBottleneckCandidates = options.maxBottleneckCandidates ?? 12;
  const leftNodes = new Map(left.graph.nodes.map((node) => [node.id, node]));
  const rightNodes = new Map(right.graph.nodes.map((node) => [node.id, node]));
  const leftCalculation = calculateGraph(left);
  const rightCalculation = calculateGraph(right);

  const addedDrivers = sortedIds([...rightNodes.keys()].filter((nodeId) => !leftNodes.has(nodeId)));
  const removedDrivers = sortedIds([...leftNodes.keys()].filter((nodeId) => !rightNodes.has(nodeId)));
  const commonNodeIds = sortedIds([...leftNodes.keys()].filter((nodeId) => rightNodes.has(nodeId)));
  const changedFormulas = commonNodeIds.filter((nodeId) =>
    normalizeFormula(leftNodes.get(nodeId)?.formula) !== normalizeFormula(rightNodes.get(nodeId)?.formula)
  );
  const changedValues = commonNodeIds.filter((nodeId) =>
    numericValueChanged(valueForNode(left, nodeId, leftCalculation.values), valueForNode(right, nodeId, rightCalculation.values))
  );
  const rootDelta = buildRootDelta(leftCalculation.rootValue, rightCalculation.rootValue);
  const candidates = new CandidateCollector(maxBottleneckCandidates);

  for (const nodeId of changedValues) {
    const leftValue = valueForNode(left, nodeId, leftCalculation.values);
    const rightValue = valueForNode(right, nodeId, rightCalculation.values);
    const node = rightNodes.get(nodeId) ?? leftNodes.get(nodeId);
    if (!node) continue;
    candidates.add({
      nodeId,
      nodeName: node.name,
      evidence: "value_delta",
      severity: severityFromDelta(leftValue, rightValue),
      reason: valueDeltaReason(node.name, leftValue, rightValue, node.unit)
    });
  }

  for (const nodeId of changedFormulas) {
    const node = rightNodes.get(nodeId) ?? leftNodes.get(nodeId);
    if (!node) continue;
    candidates.add({
      nodeId,
      nodeName: node.name,
      evidence: "formula_change",
      severity: nodeId === right.rootNodeId || nodeId === left.rootNodeId ? "high" : "medium",
      reason: `Formula changed for "${node.name}".`
    });
  }

  for (const nodeId of [...addedDrivers, ...removedDrivers]) {
    const node = rightNodes.get(nodeId) ?? leftNodes.get(nodeId);
    if (!node) continue;
    const added = rightNodes.has(nodeId);
    candidates.add({
      nodeId,
      nodeName: node.name,
      evidence: "missing_driver",
      severity: node.materiality === "high" ? "high" : "medium",
      reason: added
        ? `Driver "${node.name}" exists only in the right VDT.`
        : `Driver "${node.name}" exists only in the left VDT.`
    });
  }

  const rightRootValue = rightCalculation.rootValue;
  for (const sensitivity of rankScenarioInputNodes(right).slice(0, maxBottleneckCandidates)) {
    if (sensitivity.onePercentRootDelta === undefined || !Number.isFinite(sensitivity.onePercentRootDelta)) continue;
    if (sensitivity.onePercentRootDelta === 0) continue;
    candidates.add({
      nodeId: sensitivity.nodeId,
      nodeName: sensitivity.nodeName,
      evidence: "sensitivity",
      severity: severityFromSensitivity(sensitivity.onePercentRootDelta, rightRootValue),
      reason: `A 1% change in "${sensitivity.nodeName}" changes the right VDT root by ${formatNumber(sensitivity.onePercentRootDelta)}.`
    });
  }

  return {
    ...(rootDelta ? { rootDelta } : {}),
    structuralDiff: {
      addedDrivers,
      removedDrivers,
      changedFormulas,
      changedValues
    },
    bottleneckCandidates: candidates.list()
  };
}

class CandidateCollector {
  private readonly byKey = new Map<string, VdtBottleneckCandidate>();

  constructor(private readonly maxItems: number) {}

  add(candidate: VdtBottleneckCandidate): void {
    const key = `${candidate.nodeId}:${candidate.evidence}`;
    const existing = this.byKey.get(key);
    if (!existing || severityRank(candidate.severity) > severityRank(existing.severity)) {
      this.byKey.set(key, candidate);
    }
  }

  list(): VdtBottleneckCandidate[] {
    return [...this.byKey.values()]
      .sort((left, right) => {
        const severity = severityRank(right.severity) - severityRank(left.severity);
        if (severity !== 0) return severity;
        const evidence = evidenceRank(right.evidence) - evidenceRank(left.evidence);
        if (evidence !== 0) return evidence;
        return left.nodeName.localeCompare(right.nodeName);
      })
      .slice(0, this.maxItems);
  }
}

function buildRootDelta(leftValue: number | undefined, rightValue: number | undefined): VdtComparisonRootDelta | undefined {
  if (!isFiniteNumber(leftValue) && !isFiniteNumber(rightValue)) return undefined;
  const delta = isFiniteNumber(leftValue) && isFiniteNumber(rightValue) ? rightValue - leftValue : undefined;
  return {
    ...(isFiniteNumber(leftValue) ? { leftValue } : {}),
    ...(isFiniteNumber(rightValue) ? { rightValue } : {}),
    ...(delta !== undefined ? { absoluteDelta: delta } : {}),
    ...(delta !== undefined && isFiniteNumber(leftValue) && leftValue !== 0 ? { percentDelta: delta / Math.abs(leftValue) * 100 } : {})
  };
}

function valueForNode(project: VdtProject, nodeId: string, calculatedValues: Record<string, number>): number | undefined {
  const calculated = calculatedValues[nodeId];
  if (isFiniteNumber(calculated)) return calculated;
  const node = project.graph.nodes.find((candidate) => candidate.id === nodeId);
  if (isFiniteNumber(node?.baselineValue)) return node.baselineValue;
  if (isFiniteNumber(node?.value)) return node.value;
  return undefined;
}

function numericValueChanged(left: number | undefined, right: number | undefined): boolean {
  if (left === undefined && right === undefined) return false;
  if (left === undefined || right === undefined) return true;
  return Math.abs(left - right) > 1e-9;
}

function severityFromDelta(left: number | undefined, right: number | undefined): VdtBottleneckCandidate["severity"] {
  if (!isFiniteNumber(left) || !isFiniteNumber(right)) return "medium";
  const denominator = Math.max(Math.abs(left), 1);
  const ratio = Math.abs(right - left) / denominator;
  if (ratio >= 0.1) return "high";
  if (ratio >= 0.03) return "medium";
  return "low";
}

function severityFromSensitivity(delta: number, rootValue: number | undefined): VdtBottleneckCandidate["severity"] {
  if (!isFiniteNumber(rootValue) || rootValue === 0) return Math.abs(delta) > 0 ? "medium" : "low";
  const ratio = Math.abs(delta) / Math.abs(rootValue);
  if (ratio >= 0.01) return "high";
  if (ratio >= 0.0025) return "medium";
  return "low";
}

function valueDeltaReason(name: string, left: number | undefined, right: number | undefined, unit: string | undefined): string {
  const suffix = unit ? ` ${unit}` : "";
  if (left === undefined) return `"${name}" has a value only in the right VDT: ${formatNumber(right)}${suffix}.`;
  if (right === undefined) return `"${name}" has a value only in the left VDT: ${formatNumber(left)}${suffix}.`;
  return `"${name}" changed from ${formatNumber(left)}${suffix} to ${formatNumber(right)}${suffix}.`;
}

function normalizeFormula(formula: string | undefined): string {
  return formula?.trim().replace(/\s+/g, " ") ?? "";
}

function sortedIds(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatNumber(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? "unknown" : Number(value.toFixed(6)).toString();
}

function severityRank(severity: VdtBottleneckCandidate["severity"]): number {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}

function evidenceRank(evidence: VdtBottleneckCandidate["evidence"]): number {
  if (evidence === "value_delta") return 4;
  if (evidence === "formula_change") return 3;
  if (evidence === "sensitivity") return 2;
  return 1;
}
