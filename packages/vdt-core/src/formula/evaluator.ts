import { FormulaEvaluationError, FormulaParseError, type FormulaExpression } from "./ast";
import { parseFormula } from "./parser";

export interface FormulaEvaluationResult {
  value?: number;
  references: string[];
  errors: {
    type: "formula_parse_error" | "unknown_reference" | "missing_value" | "division_by_zero";
    message: string;
    reference?: string;
  }[];
}

export function extractReferencesFromAst(expression: FormulaExpression, references = new Set<string>()) {
  if (expression.type === "reference") {
    references.add(expression.name);
  } else if (expression.type === "unary") {
    extractReferencesFromAst(expression.expression, references);
  } else if (expression.type === "binary") {
    extractReferencesFromAst(expression.left, references);
    extractReferencesFromAst(expression.right, references);
  }

  return [...references];
}

export function extractFormulaReferences(formula: string) {
  return extractReferencesFromAst(parseFormula(formula));
}

export function evaluateAst(expression: FormulaExpression, resolve: (reference: string) => number | undefined): number {
  switch (expression.type) {
    case "number":
      return expression.value;
    case "reference": {
      const value = resolve(expression.name);
      if (value === undefined) {
        throw new FormulaEvaluationError(
          "missing_value",
          `Missing value for formula reference: ${expression.name}`,
          expression.name
        );
      }
      return value;
    }
    case "unary":
      return -evaluateAst(expression.expression, resolve);
    case "binary": {
      const left = evaluateAst(expression.left, resolve);
      const right = evaluateAst(expression.right, resolve);

      if (expression.operator === "+") {
        return left + right;
      }
      if (expression.operator === "-") {
        return left - right;
      }
      if (expression.operator === "*") {
        return left * right;
      }

      if (right === 0) {
        throw new FormulaEvaluationError("division_by_zero", "Formula attempted to divide by zero.");
      }
      return left / right;
    }
  }
}

export function evaluateFormula(formula: string, values: Record<string, number>): FormulaEvaluationResult {
  let references: string[] = [];

  try {
    const expression = parseFormula(formula);
    references = extractReferencesFromAst(expression);
    const value = evaluateAst(expression, (reference) => values[reference]);
    return { value, references, errors: [] };
  } catch (error) {
    if (error instanceof FormulaParseError) {
      return {
        references: [],
        errors: [{ type: "formula_parse_error", message: error.message }]
      };
    }

    if (error instanceof FormulaEvaluationError) {
      return {
        references,
        errors: [
          {
            type: error.code,
            message: error.message,
            ...(error.reference ? { reference: error.reference } : {})
          }
        ]
      };
    }

    throw error;
  }
}

export function resolveFormulaText(formula: string, values: Record<string, number>) {
  return formula.replace(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, (reference) => {
    const value = values[reference];
    return value === undefined ? reference : String(Number(value.toFixed(6)));
  });
}
