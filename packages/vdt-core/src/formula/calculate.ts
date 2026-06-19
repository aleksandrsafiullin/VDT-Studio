import { FormulaEvaluationError, FormulaParseError } from "./ast";
import { evaluateAst, extractReferencesFromAst, resolveFormulaText } from "./evaluator";
import { parseFormula } from "./parser";
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
  const rootNodeId = options.rootNodeId ?? (isProject(input) ? input.rootNodeId : graph.nodes[0]?.id ?? "");
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
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
        addError(nodeId, "missing_value", `Missing value for ${node.name}.`);
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
