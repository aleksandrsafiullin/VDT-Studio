import type { FormulaExpression } from "../formula/ast";
import { parseFormula } from "../formula/parser";
import type { ValidationResult, VdtGraph, VdtWarning } from "../types";
import { warning } from "../utils";
import { extractFormulaReferences } from "../formula/evaluator";
import { FormulaParseError } from "../formula/ast";

function normalizeUnit(unit?: string) {
  const normalized = unit?.trim().toLowerCase();
  return normalized && normalized !== "%" ? normalized : undefined;
}

export function validateGraph(graph: VdtGraph, rootNodeId: string): ValidationResult {
  const errors: VdtWarning[] = [];
  const warnings: VdtWarning[] = [];
  const nodeIds = new Set<string>();
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edgeIds = new Set<string>();
  const edgePairs = new Set<string>();

  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      errors.push(
        warning({
          severity: "error",
          type: "invalid_graph",
          message: `Duplicate node id: ${node.id}`,
          nodeId: node.id
        })
      );
    }
    nodeIds.add(node.id);
  }

  const inferFormulaUnit = (nodeId: string, expression: FormulaExpression): string | undefined => {
    if (expression.type === "number") {
      return undefined;
    }

    if (expression.type === "reference") {
      return normalizeUnit(nodeById.get(expression.name)?.unit);
    }

    if (expression.type === "unary") {
      return inferFormulaUnit(nodeId, expression.expression);
    }

    const leftUnit = inferFormulaUnit(nodeId, expression.left);
    const rightUnit = inferFormulaUnit(nodeId, expression.right);

    if (expression.operator === "+" || expression.operator === "-") {
      if (leftUnit && rightUnit && leftUnit !== rightUnit) {
        warnings.push(
          warning({
            severity: "warning",
            type: "unit_mismatch",
            message: `Formula combines incompatible units with ${expression.operator}: ${leftUnit} and ${rightUnit}.`,
            nodeId
          })
        );
      }

      return leftUnit ?? rightUnit;
    }

    return undefined;
  };

  const formulaDependencies = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (node.status === "rejected") {
      errors.push(
        warning({
          severity: "error",
          type: "invalid_graph",
          message: `Rejected node remains in the active model: ${node.name}`,
          nodeId: node.id
        })
      );
    }

    if (!node.formula?.trim()) {
      continue;
    }

    try {
      const expression = parseFormula(node.formula);
      const references = extractFormulaReferences(node.formula);
      formulaDependencies.set(node.id, references);
      for (const reference of references) {
        if (!nodeIds.has(reference)) {
          errors.push(
            warning({
              severity: "error",
              type: "unknown_reference",
              message: `The formula for ${node.name} references a missing node: ${reference}`,
              nodeId: node.id
            })
          );
        } else if (nodeById.get(reference)?.status === "rejected") {
          errors.push(
            warning({
              severity: "error",
              type: "invalid_graph",
              message: `The formula for ${node.name} references rejected node: ${reference}`,
              nodeId: node.id
            })
          );
        }
      }

      const formulaUnit = inferFormulaUnit(node.id, expression);
      const nodeUnit = normalizeUnit(node.unit);
      if (nodeUnit && formulaUnit && nodeUnit !== formulaUnit) {
        warnings.push(
          warning({
            severity: "warning",
            type: "unit_mismatch",
            message: `The formula for ${node.name} appears to return ${formulaUnit}, but the node unit is ${nodeUnit}.`,
            nodeId: node.id
          })
        );
      }
    } catch (error) {
      errors.push(
        warning({
          severity: "error",
          type: "formula_parse_error",
          message:
            error instanceof FormulaParseError
              ? `The formula for ${node.name} cannot be parsed: ${error.message}`
              : `The formula for ${node.name} cannot be parsed.`,
          nodeId: node.id
        })
      );
    }
  }

  const formulaVisiting: string[] = [];
  const formulaVisited = new Set<string>();
  const reportedCycles = new Set<string>();

  const visitFormula = (nodeId: string) => {
    if (formulaVisited.has(nodeId)) {
      return;
    }

    const circularIndex = formulaVisiting.indexOf(nodeId);
    if (circularIndex >= 0) {
      const cycle = [...formulaVisiting.slice(circularIndex), nodeId].join(" -> ");
      if (!reportedCycles.has(cycle)) {
        reportedCycles.add(cycle);
        errors.push(
          warning({
            severity: "error",
            type: "circular_dependency",
            message: `Circular formula dependency detected: ${cycle}`,
            nodeId
          })
        );
      }
      return;
    }

    formulaVisiting.push(nodeId);
    for (const reference of formulaDependencies.get(nodeId) ?? []) {
      if (nodeIds.has(reference)) {
        visitFormula(reference);
      }
    }
    formulaVisiting.pop();
    formulaVisited.add(nodeId);
  };

  for (const node of graph.nodes) {
    visitFormula(node.id);
  }

  if (!nodeIds.has(rootNodeId)) {
    errors.push(
      warning({
        severity: "error",
        type: "invalid_graph",
        message: `Root node does not exist: ${rootNodeId}`,
        nodeId: rootNodeId
      })
    );
  }

  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      errors.push(
        warning({
          severity: "error",
          type: "invalid_graph",
          message: `Duplicate edge id: ${edge.id}`,
          edgeId: edge.id
        })
      );
    }
    edgeIds.add(edge.id);

    if (!nodeIds.has(edge.sourceNodeId)) {
      errors.push(
        warning({
          severity: "error",
          type: "invalid_graph",
          message: `Edge references missing source node: ${edge.sourceNodeId}`,
          edgeId: edge.id
        })
      );
    }

    if (!nodeIds.has(edge.targetNodeId)) {
      errors.push(
        warning({
          severity: "error",
          type: "invalid_graph",
          message: `Edge references missing target node: ${edge.targetNodeId}`,
          edgeId: edge.id
        })
      );
    }

    const pairKey = `${edge.sourceNodeId}->${edge.targetNodeId}`;
    if (edgePairs.has(pairKey)) {
      warnings.push(
        warning({
          severity: "warning",
          type: "invalid_graph",
          message: `Duplicate edge pair: ${pairKey}`,
          edgeId: edge.id
        })
      );
    }
    edgePairs.add(pairKey);
  }

  const reachable = new Set<string>();
  const childrenBySource = new Map<string, string[]>();
  for (const edge of graph.edges) {
    childrenBySource.set(edge.sourceNodeId, [...(childrenBySource.get(edge.sourceNodeId) ?? []), edge.targetNodeId]);
  }

  const visit = (nodeId: string) => {
    if (reachable.has(nodeId)) {
      return;
    }
    reachable.add(nodeId);
    for (const childId of childrenBySource.get(nodeId) ?? []) {
      visit(childId);
    }
  };

  if (nodeIds.has(rootNodeId)) {
    visit(rootNodeId);
  }

  for (const node of graph.nodes) {
    if (!reachable.has(node.id) && node.type !== "external_factor") {
      warnings.push(
        warning({
          severity: "warning",
          type: "invalid_graph",
          message: `Node is not reachable from the root visual decomposition: ${node.name}`,
          nodeId: node.id
        })
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}
