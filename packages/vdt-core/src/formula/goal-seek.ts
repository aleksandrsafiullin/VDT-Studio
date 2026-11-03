import type { VdtGraph, VdtNode } from "../types";
import type { FormulaExpression } from "./ast";
import { extractReferencesFromAst } from "./evaluator";
import { parseFormula } from "./parser";

type Polynomial = FormulaExpression[];
interface Rational { numerator: Polynomial; denominator: Polynomial }

const literal = (value: number): FormulaExpression => ({ type: "number", value, raw: String(value) });
const zero = literal(0);
const one = literal(1);
const isZero = (value: FormulaExpression) => value.type === "number" && value.value === 0;

/** Formula dependencies, rather than visual parentage, determine eligible targets. */
export function getGoalSeekTargets(graph: VdtGraph, variableId: string): VdtNode[] {
  const users = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (!node.formula?.trim() || node.status === "rejected") continue;
    try {
      for (const ref of extractReferencesFromAst(parseFormula(node.formula))) users.set(ref, [...(users.get(ref) ?? []), node.id]);
    } catch { /* Malformed formulas are reported by calculation. */ }
  }
  const reachable = new Set([variableId]);
  const queue = [variableId];
  for (let i = 0; i < queue.length; i++) for (const id of users.get(queue[i]!) ?? []) {
    if (!reachable.has(id)) { reachable.add(id); queue.push(id); }
  }
  return graph.nodes.filter(node => node.id !== variableId && reachable.has(node.id));
}

export interface GoalSeekPlan {
  /** References independent KPIs and, when supplied, the symbolic target input. */
  expression: FormulaExpression;
  /** Original division domains, with the solved value substituted. */
  nonZeroExpressions: FormulaExpression[];
}

/**
 * Build a bounded, deterministic inverse. Arithmetic may reference the unknown
 * repeatedly; the target equation must reduce to degree one. No numerical search
 * or arbitrary choice between multiple roots/flat min/max branches is made.
 * The caller must verify the candidate through the original forward formulas.
 * Exporters may supply a symbolic target reference to keep the target editable.
 */
export function buildGoalSeekPlan(graph: VdtGraph, variableId: string, targetReference?: string): GoalSeekPlan {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const variable = nodes.get(variableId);
  const config = variable?.goalSeek;
  if (!variable || !config) throw new Error("Back-calculation settings are missing.");
  if (variable.status === "rejected") throw new Error("The back-calculated KPI is rejected.");
  if (!Number.isFinite(config.targetValue)) throw new Error("Enter a finite actual target value.");
  if (config.targetNodeId === variableId) throw new Error("Choose a different output KPI as the target.");
  if (!nodes.has(config.targetNodeId)) throw new Error("The target KPI was deleted. Choose another target.");

  let budget = 4096;
  const spend = () => { if (--budget < 0) throw new Error("This back-calculation is too complex. Choose a nearer output KPI."); };
  const binary = (operator: "+" | "-" | "*" | "/", left: FormulaExpression, right: FormulaExpression): FormulaExpression => {
    spend();
    if (left.type === "number" && right.type === "number") {
      if (operator === "/" && right.value === 0) throw new Error("The target formula divides by zero.");
      const value = operator === "+" ? left.value + right.value : operator === "-" ? left.value - right.value : operator === "*" ? left.value * right.value : left.value / right.value;
      if (!Number.isFinite(value)) throw new Error("The target formula produces a non-finite coefficient.");
      return literal(value);
    }
    if ((operator === "+" || operator === "-") && isZero(right)) return left;
    if (operator === "+" && isZero(left)) return right;
    if (operator === "*" && (isZero(left) || isZero(right))) return zero;
    if (operator === "*" && left.type === "number" && left.value === 1) return right;
    if ((operator === "*" || operator === "/") && right.type === "number" && right.value === 1) return left;
    return { type: "binary", operator, left, right };
  };
  const trim = (items: Polynomial) => {
    while (items.length > 1 && isZero(items[items.length - 1]!)) items.pop();
    return items;
  };
  const add = (a: Polynomial, b: Polynomial, operator: "+" | "-" = "+") => trim(Array.from({ length: Math.max(a.length, b.length) }, (_, i) => binary(operator, a[i] ?? zero, b[i] ?? zero)));
  const multiply = (a: Polynomial, b: Polynomial) => {
    if (a.length + b.length > 10) throw new Error("Nonlinear back-calculation is not supported. Choose an independent input KPI.");
    const result = Array.from({ length: a.length + b.length - 1 }, () => zero);
    for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) result[i + j] = binary("+", result[i + j]!, binary("*", a[i]!, b[j]!));
    return trim(result);
  };
  const scalar = (expression: FormulaExpression): Rational => ({ numerator: [expression], denominator: [one] });
  const cache = new Map<string, Rational>();
  const dependentIds = new Set([variableId]);
  const divisors: Polynomial[] = [];
  const visiting = new Set<string>();
  const compileNode = (id: string): Rational => {
    spend();
    if (id === variableId) return { numerator: [zero, one], denominator: [one] };
    const cached = cache.get(id);
    if (cached) return cached;
    const node = nodes.get(id);
    if (!node) throw new Error(`The target formula references a missing KPI: ${id}.`);
    if (node.status === "rejected") throw new Error(`The target depends on rejected KPI “${node.name}”.`);
    if (visiting.has(id)) throw new Error("The target formula has a circular dependency.");
    visiting.add(id);
    const formula = node.formula?.trim() ? parseFormula(node.formula) : undefined;
    let result = formula ? compileExpression(formula) : scalar({ type: "reference", name: id });
    const dependent = formula && extractReferencesFromAst(formula).some(ref => dependentIds.has(ref));
    if (dependent) dependentIds.add(id);
    // Keep independent subtrees as references: smaller expressions and live Excel inputs.
    if (!dependent) result = scalar({ type: "reference", name: id });
    visiting.delete(id);
    cache.set(id, result);
    return result;
  };
  const compileExpression = (expression: FormulaExpression): Rational => {
    spend();
    switch (expression.type) {
      case "number": return scalar(expression);
      case "reference": return compileNode(expression.name);
      case "unary": {
        const value = compileExpression(expression.expression);
        return { numerator: multiply([literal(-1)], value.numerator), denominator: value.denominator };
      }
      case "call": {
        const args = expression.args.map(compileExpression);
        if (args.some(arg => arg.numerator.length > 1 || arg.denominator.length > 1) || extractReferencesFromAst(expression).some(ref => dependentIds.has(ref))) throw new Error("Back-calculation through min/max is not supported: a flat branch can have multiple solutions. Choose another target or input KPI.");
        return scalar(expression);
      }
      case "binary": {
        const a = compileExpression(expression.left);
        const b = compileExpression(expression.right);
        if (expression.operator === "/") divisors.push(b.numerator);
        if (expression.operator === "+" || expression.operator === "-") return {
          numerator: add(multiply(a.numerator, b.denominator), multiply(b.numerator, a.denominator), expression.operator),
          denominator: multiply(a.denominator, b.denominator)
        };
        return expression.operator === "*"
          ? { numerator: multiply(a.numerator, b.numerator), denominator: multiply(a.denominator, b.denominator) }
          : { numerator: multiply(a.numerator, b.denominator), denominator: multiply(a.denominator, b.numerator) };
      }
    }
  };
  const target = compileNode(config.targetNodeId);
  const targetValue: FormulaExpression = targetReference === undefined ? literal(config.targetValue) : { type: "reference", name: targetReference };
  const equation = add(target.numerator, multiply([targetValue], target.denominator), "-");
  if (equation.length > 2) throw new Error("Nonlinear back-calculation may have multiple solutions. Choose another target or an independent input KPI.");
  // Constant/zero slopes are diagnosed by the forward caller; retain live references.
  const expression: FormulaExpression = { type: "binary", operator: "/", left: binary("-", zero, equation[0]!), right: equation[1] ?? zero };
  const substitute = (polynomial: Polynomial) => polynomial.reduceRight<FormulaExpression>((result, coefficient) => binary("+", binary("*", result, expression), coefficient), zero);
  return { expression, nonZeroExpressions: divisors.map(substitute) };
}
