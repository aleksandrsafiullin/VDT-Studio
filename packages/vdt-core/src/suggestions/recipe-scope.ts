import type { FormulaExpression } from "../formula/ast";
import { extractReferencesFromAst } from "../formula/evaluator";
import { parseFormula } from "../formula/parser";
import { INCOMING_KPI_UNIT_GRAMMAR, parseIncomingKpiUnit } from "./incoming-unit-contract";
import type { KpiRecipeChild, KpiSuggestedChild, KpiSuggestionContext, KpiSuggestionPeriod, KpiSuggestionRecipe } from "./types";
import { resolveKpiRecipeUnits } from "./units";

type FactorUnits = ReadonlyMap<string, string | undefined>;

function normalizedLabel(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Exact operand names are negative evidence only. Qualifying business scopes
 * remain distinct, including a channel's own revenue or its refund subtotals. */
function matchesRecipeOperandLabel(label: string, operand: KpiRecipeChild): boolean {
  const name = normalizedLabel(label);
  if ([operand.name, operand.key, operand.conceptKey].some(value => normalizedLabel(value) === name)) return true;
  if (operand.conceptKey !== "refunds") return false;
  // The audited Finance skill treats refunds and returns as the same deduction.
  const words = name.split(" ");
  if (INCOMING_KPI_UNIT_GRAMMAR.currencies.some(currency => currency.toLowerCase() === words.at(-1))) words.pop();
  const amount = words.join(" ")
    .replace(/^(?:total|сумма) /u, "")
    .replace(/ (?:after discounts?|после скид(?:ки|ок))$/u, "")
    .replace(/ (?:amount|value)$/u, "");
  return /^(?:refunds?|returns?|возврат(?:ы|ов)?)$/u.test(amount);
}

export function repeatsRecipeOperand(context: KpiSuggestionContext, child: KpiSuggestedChild, operand: KpiRecipeChild): boolean {
  if (child.existingNodeId || !context.target.unit || !matchesRecipeOperandLabel(child.name, operand)) return false;
  try {
    return unitShape(child.unit, context.period) === unitShape(context.target.unit, context.period);
  } catch {
    return false;
  }
}

function unitShape(unit: string, period: KpiSuggestionPeriod): string {
  return JSON.stringify(parseIncomingKpiUnit(unit, period));
}

function commutativeOperands(expression: FormulaExpression, operator: "+" | "*"): FormulaExpression[] {
  if (expression.type !== "binary" || expression.operator !== operator) return [expression];
  return [...commutativeOperands(expression.left, operator), ...commutativeOperands(expression.right, operator)];
}

function formulaShape(expression: FormulaExpression, units: FactorUnits, period: KpiSuggestionPeriod, markedFactor: string, ancestor: boolean): string {
  const shape = (part: FormulaExpression) => formulaShape(part, units, period, markedFactor, ancestor);
  const factor = (name: string, unit: string) => `${name === markedFactor ? "operand" : "factor"}(${unitShape(unit, period)})`;
  if (expression.type === "number") return `number(${expression.value})`;
  if (expression.type === "reference") return factor(expression.name, units.get(expression.name) ?? "");
  if (expression.type === "unary") return `negate(${shape(expression.expression)})`;
  if (expression.type === "call") return `${expression.name}(${expression.args.map(shape).join(",")})`;
  const { operator, left, right } = expression;
  // Recognize an existing percent-to-fraction operand for direction checking.
  // This signature never authorizes conversion in a new proposal or formula.
  if (ancestor && operator === "/" && left.type === "reference" && units.get(left.name)?.trim() === "%"
    && right.type === "number" && right.value === 100) return factor(left.name, "fraction");
  if (operator === "+" || operator === "*") {
    return `${operator}(${commutativeOperands(expression, operator).map(shape).sort().join(",")})`;
  }
  return `${operator}(${shape(left)},${shape(right)})`;
}

function matchesAncestorKpiFormula(context: KpiSuggestionContext, formula: string, factorUnits: FactorUnits, operandKey: string): boolean {
  if (!context.target.unit) return false;
  const ancestors = new Map([context.root, ...context.ancestors].map(node => [node.id, node]));
  const relativeUnits = new Map([...ancestors.values(), ...context.siblings, ...context.children, context.target]
    .map(node => [node.id, node.unit]));
  const period = context.period;
  const targetUnit = unitShape(context.target.unit, period);
  const candidate = parseFormula(formula);
  const factorCount = extractReferencesFromAst(candidate).length;
  const candidateShape = formulaShape(candidate, factorUnits, period, operandKey, false);
  for (const node of ancestors.values()) {
    if (node.id === context.targetNodeId || node.status === "rejected" || !node.formula || !node.unit) continue;
    try {
      if (unitShape(node.unit, period) !== targetUnit) continue;
      const actual = parseFormula(node.formula);
      const references = extractReferencesFromAst(actual);
      if (!references.includes(context.targetNodeId) || references.length !== factorCount) continue;
      if (formulaShape(actual, relativeUnits, period, context.targetNodeId, true) === candidateShape) return true;
    } catch {
      // An incomplete ancestor excerpt cannot establish this structural match.
    }
  }
  return false;
}

/** Exclusion needs both a recognized target label and its actual operand slot
 * in a matching ancestor. Identical arithmetic alone does not establish role. */
export function findAncestorRecipeOperand(context: KpiSuggestionContext, recipe: KpiSuggestionRecipe, resolvedUnits?: Record<string, string>): KpiRecipeChild | undefined {
  const namedOperands = recipe.children.filter(operand => matchesRecipeOperandLabel(context.target.name, operand));
  if (!namedOperands.length) return undefined;
  try {
    const units = new Map(Object.entries(resolvedUnits ?? resolveKpiRecipeUnits(recipe, context)));
    return namedOperands.find(operand => matchesAncestorKpiFormula(context, recipe.formula, units, operand.key));
  } catch {
    return undefined;
  }
}
