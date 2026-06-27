import type { VdtEdgeRelation } from "../types";
import { tokenizeFormula } from "./parser";

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

function walkFormulaReferences(formula: string): FormulaReference[] {
  const references: FormulaReference[] = [];
  const seen = new Set<string>();
  const tokens = tokenizeFormula(formula);
  let pendingOperator: VdtEdgeRelation | null = null;
  let expectOperand = true;

  for (const token of tokens) {
    if (token.type === "eof") {
      break;
    }

    if (token.type === "left_paren") {
      expectOperand = true;
      continue;
    }

    if (token.type === "right_paren") {
      expectOperand = false;
      continue;
    }

    if (token.type === "operator") {
      if (expectOperand && token.value === "-") {
        continue;
      }

      pendingOperator = operatorToRelation(token.value);
      expectOperand = true;
      continue;
    }

    if (token.type === "number") {
      pendingOperator = null;
      expectOperand = false;
      continue;
    }

    if (token.type === "identifier") {
      if (!seen.has(token.value)) {
        seen.add(token.value);
        references.push({
          id: token.value,
          relation: pendingOperator ?? "formula_dependency"
        });
      }
      pendingOperator = null;
      expectOperand = false;
    }
  }

  return references;
}

/**
 * Returns formula operand ids in left-to-right token order (first occurrence only).
 */
export function getFormulaReferenceOrder(formula: string): string[] {
  return walkFormulaReferences(formula).map((reference) => reference.id);
}

/**
 * Derives display relations for formula operand references in left-to-right order.
 * The first reference has no leading operator → `formula_dependency`; each later
 * reference uses the binary operator immediately before it in the formula string.
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
