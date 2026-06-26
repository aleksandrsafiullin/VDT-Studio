import { FormulaParseError, type FormulaExpression } from "../formula/ast";
import { extractReferencesFromAst } from "../formula/evaluator";
import { parseFormula } from "../formula/parser";
import type { ValidationResult, VdtGraph, VdtNode, VdtProject, VdtWarning } from "../types";

type GraphInput = VdtProject | VdtGraph;

function isProject(input: GraphInput): input is VdtProject {
  return "graph" in input && "rootNodeId" in input;
}

function issue(
  id: string,
  severity: VdtWarning["severity"],
  type: VdtWarning["type"],
  message: string,
  nodeId?: string,
  edgeId?: string
): VdtWarning {
  return {
    id,
    severity,
    type,
    message,
    ...(nodeId ? { nodeId } : {}),
    ...(edgeId ? { edgeId } : {})
  };
}

function error(id: string, type: VdtWarning["type"], message: string, nodeId?: string, edgeId?: string) {
  return issue(id, "error", type, message, nodeId, edgeId);
}

function warning(id: string, type: VdtWarning["type"], message: string, nodeId?: string, edgeId?: string) {
  return issue(id, "warning", type, message, nodeId, edgeId);
}

function getRootNodeId(input: GraphInput, rootNodeId?: string): string | undefined {
  if (rootNodeId) return rootNodeId;
  if (isProject(input)) return input.rootNodeId;
  const roots = input.nodes.filter((node) => node.type === "root_kpi");
  return roots.length === 1 ? roots[0]?.id : undefined;
}

function normalizeUnit(unit: string | undefined) {
  const normalized = unit?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

function unitsCompatible(left: string, right: string) {
  return normalizeUnit(left) === normalizeUnit(right);
}

function collectUnitWarnings(
  node: VdtNode,
  expression: FormulaExpression,
  nodeById: ReadonlyMap<string, VdtNode>,
  warnings: VdtWarning[],
  path = "root"
): string | undefined {
  if (expression.type === "number") {
    return undefined;
  }

  if (expression.type === "reference") {
    return normalizeUnit(nodeById.get(expression.name)?.unit);
  }

  if (expression.type === "unary") {
    return collectUnitWarnings(node, expression.expression, nodeById, warnings, `${path}-unary`);
  }

  const leftUnit = collectUnitWarnings(node, expression.left, nodeById, warnings, `${path}-left`);
  const rightUnit = collectUnitWarnings(node, expression.right, nodeById, warnings, `${path}-right`);

  if (
    (expression.operator === "+" || expression.operator === "-") &&
    leftUnit &&
    rightUnit &&
    !unitsCompatible(leftUnit, rightUnit)
  ) {
    warnings.push(
      warning(
        `validation-unit-mismatch-${node.id}-${path}`,
        "unit_mismatch",
        `Formula for "${node.name}" combines incompatible units with "${expression.operator}": ` +
          `"${leftUnit}" and "${rightUnit}"`,
        node.id
      )
    );
  }

  if (expression.operator === "+" || expression.operator === "-") {
    return leftUnit ?? rightUnit;
  }

  return undefined;
}

export function validateGraph(input: GraphInput, rootNodeId?: string): ValidationResult {
  const graph = isProject(input) ? input.graph : input;
  const rootId = getRootNodeId(input, rootNodeId);
  const errors: VdtWarning[] = [];
  const warnings: VdtWarning[] = [];

  const nodeIds = new Set<string>();
  const nodeById = new Map<string, VdtNode>();
  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      errors.push(
        error(
          `validation-duplicate-node-${node.id}`,
          "invalid_graph",
          `Duplicate node id "${node.id}"`,
          node.id
        )
      );
    }
    nodeIds.add(node.id);
    nodeById.set(node.id, node);
  }

  const edgeIds = new Set<string>();
  const edgePairs = new Set<string>();
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      errors.push(
        error(
          `validation-duplicate-edge-${edge.id}`,
          "invalid_graph",
          `Duplicate edge id "${edge.id}"`,
          undefined,
          edge.id
        )
      );
    }
    edgeIds.add(edge.id);

    if (!nodeIds.has(edge.sourceNodeId)) {
      errors.push(
        error(
          `validation-edge-source-${edge.id}`,
          "invalid_graph",
          `Edge "${edge.id}" references missing source node "${edge.sourceNodeId}"`,
          edge.sourceNodeId,
          edge.id
        )
      );
    }
    if (!nodeIds.has(edge.targetNodeId)) {
      errors.push(
        error(
          `validation-edge-target-${edge.id}`,
          "invalid_graph",
          `Edge "${edge.id}" references missing target node "${edge.targetNodeId}"`,
          edge.targetNodeId,
          edge.id
        )
      );
    }

    const pair = `${edge.sourceNodeId}->${edge.targetNodeId}`;
    if (edgePairs.has(pair)) {
      warnings.push(
        warning(
          `validation-duplicate-edge-pair-${edge.sourceNodeId}-${edge.targetNodeId}`,
          "invalid_graph",
          `Duplicate edge pair "${edge.sourceNodeId}" -> "${edge.targetNodeId}"`,
          undefined,
          edge.id
        )
      );
    }
    edgePairs.add(pair);
  }

  if (!rootId) {
    errors.push(
      error(
        "validation-root-missing",
        "invalid_graph",
        "Graph must define a root node id or contain exactly one root_kpi node"
      )
    );
  } else if (!nodeIds.has(rootId)) {
    errors.push(
      error(
        `validation-root-not-found-${rootId}`,
        "invalid_graph",
        `Root node "${rootId}" does not exist`,
        rootId
      )
    );
  }

  const formulaReferencesByNode = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (!node.formula?.trim()) continue;

    try {
      const expression = parseFormula(node.formula);
      const references = extractReferencesFromAst(expression);
      formulaReferencesByNode.set(node.id, references);

      for (const reference of references) {
        if (!nodeIds.has(reference)) {
          errors.push(
            error(
              `validation-formula-reference-${node.id}-${reference}`,
              "unknown_reference",
              `The formula for "${node.name}" references missing node "${reference}"`,
              node.id
            )
          );
        }
      }

      collectUnitWarnings(node, expression, nodeById, warnings);
    } catch (caught) {
      if (!(caught instanceof FormulaParseError)) {
        throw caught;
      }

      errors.push(
        error(
          `validation-formula-parse-${node.id}`,
          "formula_parse_error",
          `The formula for "${node.name}" cannot be parsed: ${caught.message}`,
          node.id
        )
      );
    }
  }

  const formulaVisitState = new Map<string, "visiting" | "visited">();
  const formulaStack: string[] = [];
  const circularFormulaIds = new Set<string>();

  const validateFormulaNode = (nodeId: string) => {
    const state = formulaVisitState.get(nodeId);
    if (state === "visited") return;
    if (state === "visiting") {
      const cycleStart = formulaStack.indexOf(nodeId);
      const cycle = [...formulaStack.slice(cycleStart >= 0 ? cycleStart : 0), nodeId];
      const cycleId = cycle.join("->");
      if (!circularFormulaIds.has(cycleId)) {
        circularFormulaIds.add(cycleId);
        errors.push(
          error(
            `validation-formula-cycle-${cycleId}`,
            "circular_dependency",
            `Circular formula dependency detected: ${cycle.join(" -> ")}`,
            nodeId
          )
        );
      }
      return;
    }

    formulaVisitState.set(nodeId, "visiting");
    formulaStack.push(nodeId);

    for (const reference of formulaReferencesByNode.get(nodeId) ?? []) {
      if (!nodeIds.has(reference)) continue;
      validateFormulaNode(reference);
    }

    formulaStack.pop();
    formulaVisitState.set(nodeId, "visited");
  };

  for (const node of graph.nodes) {
    validateFormulaNode(node.id);
  }

  if (rootId && nodeIds.has(rootId)) {
    const childrenBySource = new Map<string, string[]>();
    for (const edge of graph.edges) {
      if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) continue;
      const children = childrenBySource.get(edge.sourceNodeId) ?? [];
      children.push(edge.targetNodeId);
      childrenBySource.set(edge.sourceNodeId, children);
    }
    for (const [nodeId, references] of formulaReferencesByNode) {
      const children = childrenBySource.get(nodeId) ?? [];
      for (const reference of references) {
        if (nodeIds.has(reference)) {
          children.push(reference);
        }
      }
      childrenBySource.set(nodeId, children);
    }

    const reachable = new Set<string>();
    const queue = [rootId];
    while (queue.length > 0) {
      const nodeId = queue.shift();
      if (!nodeId || reachable.has(nodeId)) continue;
      reachable.add(nodeId);
      for (const child of childrenBySource.get(nodeId) ?? []) queue.push(child);
    }

    for (const node of graph.nodes) {
      if (reachable.has(node.id) && node.status === "rejected") {
        errors.push(
          error(
            `validation-rejected-active-node-${node.id}`,
            "invalid_graph",
            `Active model depends on rejected node "${node.name}"`,
            node.id
          )
        );
      }

      if (node.id === rootId || node.type === "external_factor") continue;
      if (!reachable.has(node.id)) {
        errors.push(
          error(
            `validation-unreachable-${node.id}`,
            "invalid_graph",
            `Node "${node.id}" is not reachable from root "${rootId}" through visual or formula dependency edges`,
            node.id
          )
        );
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
