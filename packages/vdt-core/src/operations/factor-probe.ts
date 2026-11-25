import { calculateGraph } from "../formula/calculate";
import { calculateScenario } from "../scenario/scenario";
import type { CalculationTraceItem, VdtProject } from "../types";
import { readDecompositionAssumptions } from "./decomposition-assumption";

const detailLimit = 10;

export function probeFactor(project: VdtProject, { nodeId, value }: { nodeId: string; value: number }) {
  const node = project.graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return { status: "error", code: "NODE_NOT_FOUND", message: "The KPI was not found." } as const;
  if (node.fixedInScenario) {
    return { status: "error", code: "SCENARIO_INPUT_FIXED", message: "This KPI is fixed in scenarios." } as const;
  }
  if ((node.type !== "input" && node.type !== "data_mapped") || node.status === "rejected") {
    return { status: "error", code: "NOT_SCENARIO_INPUT", message: "Select a scenario input or data-mapped driver." } as const;
  }
  if (!Number.isFinite(value)) {
    return { status: "error", code: "INVALID_SCENARIO_VALUE", message: "Provide a finite absolute input value." } as const;
  }

  const baseline = calculateGraph(project);
  const simulated = calculateScenario(project, {
    id: "factor_probe",
    name: "Factor probe",
    createdAt: project.updatedAt,
    updatedAt: project.updatedAt,
    overrides: [{ nodeId, value }]
  });
  const root = project.graph.nodes.find((candidate) => candidate.id === project.rootNodeId);
  const baselineRoot = baseline.trace.find((item) => item.nodeId === project.rootNodeId);
  const simulatedTrace = new Map(simulated.calculationTrace?.map((item) => [item.nodeId, item]));
  const simulatedRoot = simulatedTrace.get(project.rootNodeId);

  const relevantIds = findFactorPath(simulatedTrace, project.rootNodeId, nodeId);
  // Root-level assumptions still describe the reported KPI if the root cannot be calculated.
  relevantIds.add(project.rootNodeId);
  const nodes = new Map(project.graph.nodes.map((candidate) => [candidate.id, candidate]));
  const assumptions = [...relevantIds].flatMap((id) => {
    const candidate = nodes.get(id);
    return candidate ? readDecompositionAssumptions(candidate).map(({ statement, changesConclusionWhen, evidence }) => ({
      nodeId: id, nodeName: candidate.name, statement, changesConclusionWhen, evidence
    })) : [];
  });

  const baselineValue = baseline.rootValue ?? null;
  const simulatedValue = simulated.scenarioValue ?? null;
  const delta = simulated.absoluteChange;
  const errors = simulated.errors ?? [];

  return {
    status: "ok",
    result: {
      kind: "modeled_sensitivity",
      input: {
        nodeId,
        name: node.name,
        unit: node.unit ?? null,
        baselineValue: baseline.values[nodeId] ?? null,
        simulatedValue: value
      },
      root: {
        nodeId: project.rootNodeId,
        name: root?.name ?? project.rootNodeId,
        unit: root?.unit ?? null,
        formula: root?.formula ?? null,
        baselineValue,
        simulatedValue,
        absoluteChange: delta !== undefined && Number.isFinite(delta) ? delta : null,
        baselineExpression: baselineRoot?.resolvedFormula ?? null,
        simulatedExpression: simulatedRoot?.resolvedFormula ?? null
      },
      assumptions: assumptions.slice(0, detailLimit),
      assumptionCount: assumptions.length,
      errors: errors.slice(0, detailLimit),
      errorCount: errors.length
    }
  } as const;
}

function findFactorPath(trace: Map<string, CalculationTraceItem>, rootId: string, inputId: string): Set<string> {
  const affected = new Set([inputId]);
  const consumers = new Map<string, string[]>();
  for (const item of trace.values()) {
    for (const input of item.inputs) {
      const existing = consumers.get(input.nodeId) ?? [];
      existing.push(item.nodeId);
      consumers.set(input.nodeId, existing);
    }
  }
  // Set iteration also visits IDs appended by the traversal.
  for (const id of affected) {
    for (const consumer of consumers.get(id) ?? []) affected.add(consumer);
  }

  const path = new Set<string>();
  if (affected.has(rootId)) path.add(rootId);
  for (const id of path) {
    for (const input of trace.get(id)?.inputs ?? []) {
      if (affected.has(input.nodeId)) path.add(input.nodeId);
    }
  }
  return path;
}
