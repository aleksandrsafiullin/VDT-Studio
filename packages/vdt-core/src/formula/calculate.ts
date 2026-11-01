import { FormulaEvaluationError, FormulaParseError } from "./ast";
import { evaluateAst, extractReferencesFromAst, resolveFormulaText } from "./evaluator";
import { parseFormula } from "./parser";
import { buildGoalSeekPlan } from "./goal-seek";
import { getDecompositionContextGroupIds } from "../graph/decomposition";
import type {
  CalculationTraceItem,
  GraphCalculationResult,
  VdtGraph,
  VdtProject,
  VdtScenarioOverride,
  VdtWarning
} from "../types";
import { warning } from "../utils";

export interface CalculateGraphOptions {
  rootNodeId?: string;
  overrides?: VdtScenarioOverride[] | Record<string, number>;
}

function isProject(input: VdtProject | VdtGraph): input is VdtProject {
  return "graph" in input && "rootNodeId" in input;
}

function normalizeOverrides(overrides: CalculateGraphOptions["overrides"]) {
  if (!overrides) {
    return new Map<string, number>();
  }

  if (Array.isArray(overrides)) {
    return new Map(overrides.map((override) => [override.nodeId, override.value]));
  }

  return new Map(Object.entries(overrides));
}

export function calculateGraph(input: VdtProject | VdtGraph, options: CalculateGraphOptions = {}): GraphCalculationResult {
  const graph = isProject(input) ? input.graph : input;
  const balancing = graph.nodes.filter(node => node.goalSeek);
  if (!balancing.length) return calculateForwardGraph(input, options);

  const unavailable = new Set(balancing.map(node => node.id));
  const independent = calculateForwardGraph(input, {}, unavailable);
  let value: number | undefined;
  let message: string | undefined;
  const variable = balancing[0]!;
  try {
    if (balancing.length !== 1) throw new Error("Only one KPI per VDT can use back-calculation. Disable the other back-calculation settings.");
    const modelRoot = isProject(input) ? input.rootNodeId : graph.nodes.find(node => node.type === "root_kpi")?.id ?? graph.nodes[0]?.id;
    if (variable.id === modelRoot) throw new Error("Choose an incoming KPI for back-calculation, rather than the root KPI.");
    const plan = buildGoalSeekPlan(graph, variable.id);
    value = evaluateAst(plan.expression, id => independent.values[id]);
    if (!Number.isFinite(value)) throw new Error("No unique finite solution. Check the measured inputs and target value.");
    const verified = calculateForwardGraph(input, { overrides: { [variable.id]: value } });
    const target = verified.values[variable.goalSeek!.targetNodeId];
    if (target === undefined || Math.abs(target - variable.goalSeek!.targetValue) > 1e-9 * Math.max(Math.abs(target), Math.abs(variable.goalSeek!.targetValue), 1e-6)) {
      throw new Error("The target cannot be reached with these inputs. Check missing values, zero divisors and the actual target.");
    }
  } catch (error) {
    value = undefined;
    message = error instanceof FormulaEvaluationError && error.code === "division_by_zero"
      ? "No unique finite solution. The balancing KPI has zero influence on the target, or the formula divides by zero."
      : error instanceof Error ? error.message : "Back-calculation failed.";
  }
  const overrides = normalizeOverrides(options.overrides);
  if (value !== undefined) {
    unavailable.delete(variable.id);
    if (!overrides.has(variable.id)) overrides.set(variable.id, value);
  }
  // Explicit scenario changes are applied after Baseline calibration, never fed
  // into its inverse. Failed calibration cannot fall back to stale source values.
  for (const id of overrides.keys()) unavailable.delete(id);
  const result = calculateForwardGraph(input, { ...options, overrides: Object.fromEntries(overrides) }, unavailable);
  for (const node of balancing) {
    if (message) result.errors.push(warning({ severity: "error", type: "goal_seek_error", nodeId: node.id, message }));
    else {
      const trace = result.trace.find(item => item.nodeId === node.id);
      if (trace && !normalizeOverrides(options.overrides).has(node.id)) trace.goalSeek = node.goalSeek;
    }
  }
  if (value !== undefined && value < 0) result.warnings.push(warning({ severity: "warning", type: "invalid_value", nodeId: variable.id, message: "The back-calculated Baseline is negative. Check whether this is valid for the KPI and review the measured inputs and target." }));
  return result;
}

function calculateForwardGraph(input: VdtProject | VdtGraph, options: CalculateGraphOptions = {}, unavailable = new Set<string>()): GraphCalculationResult {
  const graph = isProject(input) ? input.graph : input;
  const rootNodeId = options.rootNodeId ?? (isProject(input) ? input.rootNodeId : graph.nodes[0]?.id ?? "");
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const contextGroups = getDecompositionContextGroupIds(graph, rootNodeId);
  const overrides = normalizeOverrides(options.overrides);
  const values: Record<string, number> = {};
  const traceByNode = new Map<string, CalculationTraceItem>();
  const errors: VdtWarning[] = [];
  const warnings: VdtWarning[] = [];
  const visiting: string[] = [];
  const visited = new Set<string>();

  const addError = (nodeId: string, type: VdtWarning["type"], message: string) => {
    errors.push(warning({ severity: "error", type, message, nodeId }));
  };

  const evaluateNode = (nodeId: string): number | undefined => {
    if (visited.has(nodeId)) {
      return values[nodeId];
    }

    const node = nodeById.get(nodeId);
    if (!node) {
      addError(nodeId, "unknown_reference", `Formula references a missing node: ${nodeId}`);
      return undefined;
    }

    if (node.status === "rejected") {
      addError(nodeId, "invalid_graph", `Rejected node ${node.name} is excluded from calculation.`);
      visited.add(nodeId);
      return undefined;
    }

    if (unavailable.has(nodeId)) {
      visited.add(nodeId);
      return undefined;
    }

    const circularIndex = visiting.indexOf(nodeId);
    if (circularIndex >= 0) {
      const cycle = [...visiting.slice(circularIndex), nodeId].join(" -> ");
      addError(nodeId, "circular_dependency", `Circular formula dependency detected: ${cycle}`);
      return undefined;
    }

    visiting.push(nodeId);

    if (overrides.has(nodeId)) {
      const overrideValue = overrides.get(nodeId);
      if (overrideValue !== undefined) {
        if (!Number.isFinite(overrideValue)) {
          addError(nodeId, "invalid_value", `Scenario override for ${node.name} must be a finite number.`);
          visiting.pop();
          visited.add(nodeId);
          return undefined;
        }

        values[nodeId] = overrideValue;
        traceByNode.set(nodeId, {
          nodeId,
          nodeName: node.name,
          value: overrideValue,
          unit: node.unit,
          inputs: []
        });
        visiting.pop();
        visited.add(nodeId);
        return overrideValue;
      }
    }

    if (!node.formula?.trim()) {
      const value = node.baselineValue ?? node.value;
      if (value === undefined) {
        if (!contextGroups.has(nodeId)) addError(nodeId, "missing_value", `Missing value for ${node.name}.`);
        visiting.pop();
        visited.add(nodeId);
        return undefined;
      }

      if (!Number.isFinite(value)) {
        addError(nodeId, "invalid_value", `Value for ${node.name} must be a finite number.`);
        visiting.pop();
        visited.add(nodeId);
        return undefined;
      }

      values[nodeId] = value;
      traceByNode.set(nodeId, {
        nodeId,
        nodeName: node.name,
        value,
        unit: node.unit,
        inputs: []
      });
      visiting.pop();
      visited.add(nodeId);
      return value;
    }

    try {
      const expression = parseFormula(node.formula);
      const references = extractReferencesFromAst(expression);

      for (const reference of references) {
        if (!nodeById.has(reference)) {
          addError(nodeId, "unknown_reference", `The formula for ${node.name} references a missing node: ${reference}`);
        }
      }

      for (const reference of references) {
        evaluateNode(reference);
      }

      const value = evaluateAst(expression, (reference) => values[reference]);
      if (!Number.isFinite(value)) {
        addError(nodeId, "invalid_value", `Calculated value for ${node.name} must be a finite number.`);
        visiting.pop();
        visited.add(nodeId);
        return undefined;
      }

      values[nodeId] = value;
      traceByNode.set(nodeId, {
        nodeId,
        nodeName: node.name,
        formula: node.formula,
        resolvedFormula: resolveFormulaText(node.formula, values),
        value,
        unit: node.unit,
        inputs: references.map((reference) => {
          const inputNode = nodeById.get(reference);
          return {
            nodeId: reference,
            nodeName: inputNode?.name ?? reference,
            value: values[reference],
            unit: inputNode?.unit
          };
        })
      });

      visiting.pop();
      visited.add(nodeId);
      return value;
    } catch (error) {
      if (error instanceof FormulaParseError) {
        addError(nodeId, "formula_parse_error", `The formula for ${node.name} cannot be parsed: ${error.message}`);
      } else if (error instanceof FormulaEvaluationError) {
        addError(nodeId, error.code, error.message);
      } else {
        throw error;
      }

      visiting.pop();
      visited.add(nodeId);
      return undefined;
    }
  };

  for (const node of graph.nodes) {
    evaluateNode(node.id);
  }

  return {
    rootNodeId,
    rootValue: values[rootNodeId],
    values,
    trace: graph.nodes.flatMap((node) => {
      const item = traceByNode.get(node.id);
      return item ? [item] : [];
    }),
    errors,
    warnings
  };
}
