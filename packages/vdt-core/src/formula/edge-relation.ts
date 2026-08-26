import type { VdtEdgeRelation } from "../types";
import type { FormulaExpression } from "./ast";
import { parseFormula } from "./parser";

const OPERATOR_TO_RELATION: Record<"+" | "-" | "*" | "/", VdtEdgeRelation> = {
  "*": "multiplicative_driver",
  "/": "divisive_driver",
  "+": "additive_component",
  "-": "subtractive_component"
};

function operatorToRelation(operator: "+" | "-" | "*" | "/"): VdtEdgeRelation {
  return OPERATOR_TO_RELATION[operator];
}

interface FormulaReference {
  id: string;
  relation: VdtEdgeRelation;
}

function walkAstReferences(
  expression: FormulaExpression,
  pendingOperator: VdtEdgeRelation | null,
  out: FormulaReference[]
): void {
  switch (expression.type) {
    case "reference":
      out.push({ id: expression.name, relation: pendingOperator ?? "formula_dependency" });
      break;
    case "call":
      for (const arg of expression.args) {
        walkAstReferences(arg, "formula_dependency", out);
      }
      break;
    case "binary":
      walkAstReferences(expression.left, pendingOperator ?? "formula_dependency", out);
      walkAstReferences(expression.right, operatorToRelation(expression.operator), out);
      break;
    case "unary":
      walkAstReferences(expression.expression, pendingOperator ?? "formula_dependency", out);
      break;
    case "number":
      break;
  }
}

function walkFormulaReferences(formula: string): FormulaReference[] {
  const allReferences: FormulaReference[] = [];
  walkAstReferences(parseFormula(formula), null, allReferences);

  const seen = new Set<string>();
  const references: FormulaReference[] = [];
  for (const reference of allReferences) {
    if (!seen.has(reference.id)) {
      seen.add(reference.id);
      references.push(reference);
    }
  }
  return references;
}

/**
 * Returns formula operand ids in left-to-right AST order (first occurrence only).
 */
export function getFormulaReferenceOrder(formula: string): string[] {
  return walkFormulaReferences(formula).map((reference) => reference.id);
}

/**
 * Derives display relations for formula operand references in left-to-right order.
 * The first reference has no leading operator → `formula_dependency`; each later
 * reference uses the binary operator immediately before it in the formula AST.
 */
export function buildFormulaReferenceRelations(formula: string): Map<string, VdtEdgeRelation> {
  const relations = new Map<string, VdtEdgeRelation>();
  for (const reference of walkFormulaReferences(formula)) {
    relations.set(reference.id, reference.relation);
  }
  return relations;
}

export function resolveFormulaEdgeRelation(
  parentFormula: string | undefined,
  childNodeId: string,
  fallbackRelation: VdtEdgeRelation
): VdtEdgeRelation {
  if (!parentFormula?.trim()) {
    return fallbackRelation;
  }

  try {
    const relations = buildFormulaReferenceRelations(parentFormula);
    return relations.get(childNodeId) ?? fallbackRelation;
  } catch {
    return fallbackRelation;
  }
}
