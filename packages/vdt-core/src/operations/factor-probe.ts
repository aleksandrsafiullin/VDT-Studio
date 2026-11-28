import { FormulaParseError } from "../formula/ast";
import { extractFormulaReferences } from "../formula/evaluator";
import { calculateGraph } from "../formula/calculate";
import { parseFormula } from "../formula/parser";
import { calculateScenario } from "../scenario/scenario";
import type { CalculationTraceItem, VdtNode, VdtProject } from "../types";
import { decompositionRelationshipOperands, readDecompositionAssumptions, type DecompositionRelationship } from "./decomposition-assumption";

const detailLimit = 10;
const relationshipProbeNodeLimit = 200;
const relationshipSamples = [[0, 0], [0, 11], [19, 0], [7, 7], [11, 29], [37, 13], [1.25, 2.5]] as const;
const quantityRateSamples = [[0, 0], [0, 7.25], [13, 0], [1, 7.25], [13, 1], [3, 2.5], [11, 0.125]] as const;

export type DecompositionRelationshipVerification =
  | { status: "passed"; sampleCount: number }
  | { status: "mismatch"; inputs: readonly [number, number]; expected: number; actual: number }
  | { status: "unverified"; reason: string };

export function verifyDecompositionRelationship(
  target: VdtNode, relationship: DecompositionRelationship, nodes: ReadonlyMap<string, VdtNode>,
  measuredValues: Readonly<Record<string, number>> = {}
): DecompositionRelationshipVerification {
  const operands = decompositionRelationshipOperands(target, relationship, nodes);
  if (!operands) return { status: "unverified", reason: "The output and its two active operands must use the confirmed unit basis." };
  const operandIds = new Set(relationship.operandNodeIds);
  const visited = new Set<string>();
  const closure: VdtNode[] = [];
  const pending = [target.id];

  try {
    while (pending.length) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      if (visited.size > relationshipProbeNodeLimit) {
        return { status: "unverified", reason: "The relationship dependency graph exceeds the verification limit." };
      }
      const node = nodes.get(id);
      if (!node || node.status === "rejected" || node.goalSeek) {
        return { status: "unverified", reason: "The relationship depends on a missing, rejected or back-calculated KPI." };
      }
      closure.push(structuredClone(node));
      if (operandIds.has(id)) continue;
      if (!node.formula?.trim()) {
        return { status: "unverified", reason: "The formula requires an input outside the two confirmed operands." };
      }
      pending.push(...extractFormulaReferences(node.formula));
    }
  } catch (error) {
    if (!(error instanceof FormulaParseError)) throw error;
    return { status: "unverified", reason: "The relationship formula could not be parsed." };
  }

  if (operands.some(operand => !visited.has(operand.id))) {
    return { status: "unverified", reason: "The formula must use both confirmed operands." };
  }

  // The operands are synthetic boundary values for this calculation only.
  const graph = { nodes: closure, edges: [] };
  const measured = (id: string) => Object.hasOwn(measuredValues, id) ? measuredValues[id] : undefined;
  const actualFirst = measured(operands[0].id);
  const actualSecond = measured(operands[1].id);
  if ((actualFirst !== undefined && actualFirst < 0) || (actualSecond !== undefined && actualSecond < 0)) {
    return { status: "unverified", reason: "This relationship can only verify nonnegative operand values." };
  }
  const synthetic = relationship.kind === "quantity_rate" ? quantityRateSamples : relationshipSamples;
  const samples: ReadonlyArray<readonly [number, number]> = actualFirst !== undefined || actualSecond !== undefined
    ? [[actualFirst ?? 19, actualSecond ?? 11], ...synthetic]
    : synthetic;
  for (const inputs of samples) {
    const [first, second] = inputs;
    const expected = relationship.kind === "quantity_rate" ? first * second
      : relationship.kind === "serial_capacity" ? Math.min(first, second) : first + second;
    if (!Number.isFinite(expected)) {
      return { status: "unverified", reason: "The confirmed relationship exceeds the finite numerical range for the supplied operands." };
    }
    const result = calculateGraph(graph, {
      rootNodeId: target.id, overrides: [{ nodeId: operands[0].id, value: first }, { nodeId: operands[1].id, value: second }]
    });
    const actual = result.rootValue;
    if (actual === undefined || !Number.isFinite(actual) || result.errors.length) {
      return { status: "unverified", reason: `The formula could not calculate when the confirmed operands were ${first} and ${second}.` };
    }
    if (Math.abs(actual - expected) > 1e-9 * Math.max(1, Math.abs(actual), Math.abs(expected))) {
      return { status: "mismatch", inputs, expected, actual };
    }
  }
  if (relationship.kind === "quantity_rate") {
    const formula = parseFormula(closure[0]?.formula ?? "");
    // Sample agreement can rule out a candidate, but cannot certify an arbitrary expression.
    if (formula.type !== "binary" || formula.operator !== "*"
      || formula.left.type !== "reference" || formula.right.type !== "reference"
      || formula.left.name === formula.right.name || !operandIds.has(formula.left.name) || !operandIds.has(formula.right.name)) {
      return { status: "unverified", reason: "Verify the quantity-rate relationship with the direct product of its two confirmed KPI references." };
    }
  }
  return { status: "passed", sampleCount: samples.length };
}

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
    return candidate ? readDecompositionAssumptions(candidate).map(({ statement, changesConclusionWhen, evidence, relationship }) => ({
      nodeId: id, nodeName: candidate.name, statement, changesConclusionWhen, evidence,
      ...(relationship && { relationship })
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
      assumptions: assumptions.slice(0, detailLimit).map(assumption => ({
        ...assumption,
        ...(assumption.relationship && {
          verification: verifyDecompositionRelationship(nodes.get(assumption.nodeId)!, assumption.relationship, nodes,
            Object.fromEntries(assumption.relationship.operandNodeIds.flatMap(id => {
              const measured = simulatedTrace.get(id)?.value;
              return measured === undefined ? [] : [[id, measured]];
            })))
        })
      })),
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
