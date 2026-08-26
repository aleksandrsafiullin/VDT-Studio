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
  } else if (expression.type === "call") {
    for (const arg of expression.args) {
      extractReferencesFromAst(arg, references);
    }
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
    case "call": {
      const values = expression.args.map((arg) => evaluateAst(arg, resolve));
      return expression.name === "min" ? Math.min(...values) : Math.max(...values);
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

function formatResolvedAst(expression: FormulaExpression, values: Record<string, number>): string {
  switch (expression.type) {
    case "number":
      return expression.raw;
    case "reference": {
      const value = values[expression.name];
      return value === undefined ? expression.name : String(Number(value.toFixed(6)));
    }
    case "unary":
      return `-${formatResolvedAst(expression.expression, values)}`;
    case "binary": {
      const left = formatResolvedAst(expression.left, values);
      const right = formatResolvedAst(expression.right, values);
      return `${left} ${expression.operator} ${right}`;
    }
    case "call": {
      const args = expression.args.map((arg) => formatResolvedAst(arg, values));
      return `${expression.name}(${args.join(", ")})`;
    }
  }
}

export function resolveFormulaText(formula: string, values: Record<string, number>) {
  return formatResolvedAst(parseFormula(formula), values);
}
