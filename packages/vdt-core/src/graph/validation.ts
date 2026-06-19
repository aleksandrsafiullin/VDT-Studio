import type { ValidationResult, VdtGraph, VdtWarning } from "../types";
import { warning } from "../utils";
import { extractFormulaReferences } from "../formula/evaluator";
import { FormulaParseError } from "../formula/ast";

export function validateGraph(graph: VdtGraph, rootNodeId: string): ValidationResult {
  const errors: VdtWarning[] = [];
  const warnings: VdtWarning[] = [];
  const nodeIds = new Set<string>();
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

  const formulaDependencies = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (!node.formula?.trim()) {
      continue;
    }

    try {
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
        }
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
