import type { FormulaExpression } from "../formula/ast";
import type { IncomingKpiDraftBinding, IncomingKpiFormulaAnalysis, IncomingKpiUnitExpression } from "./incoming-types";
import type { KpiSuggestionPeriod } from "./types";
import { parseIncomingKpiUnit } from "./incoming-unit-contract";
import { kpiCanonicalJson } from "./identity";
import { smartAssert } from "./validation";

const clean = (map: Record<string, number>) => Object.fromEntries(Object.entries(map).filter(([, value]) => value !== 0).sort(([a], [b]) => a.localeCompare(b, "en")));
const combine = (a: Record<string, number>, b: Record<string, number>, sign: number) => {
  const result = { ...a }; for (const [key, value] of Object.entries(b)) result[key] = (result[key] ?? 0) + value * sign; return clean(result);
};
const same = (a: unknown, b: unknown) => kpiCanonicalJson(a) === kpiCanonicalJson(b);

export function validateIncomingKpiModelConstants(analysis: IncomingKpiFormulaAnalysis): void {
  const visit = (node: FormulaExpression, complement = false): void => {
    if (node.type === "number") smartAssert(complement && node.raw === "1", "MODEL_COEFFICIENT", "Use measured inputs for weights or thresholds.");
    else if (node.type === "unary") visit(node.expression);
    else if (node.type === "call") node.args.forEach(child => visit(child));
    else if (node.type === "binary") { visit(node.left, node.operator === "-"); visit(node.right); }
  };
  visit(analysis.ast);
}

/** No scale conversion is inferred from numeric constants. */
export function validateIncomingKpiUnits(analysis: IncomingKpiFormulaAnalysis, bindings: readonly IncomingKpiDraftBinding[], targetUnit: string, period: KpiSuggestionPeriod): void {
  const units = new Map(bindings.map(row => [row.alias, parseIncomingKpiUnit(row.unit, period)]));
  const visit = (node: FormulaExpression): IncomingKpiUnitExpression => {
    if (node.type === "number") return { dimensions: {}, scales: {} };
    if (node.type === "reference") { const unit = units.get(node.name as IncomingKpiDraftBinding["alias"]); smartAssert(unit, "UNKNOWN_REFERENCE", "Choose a known KPI."); return unit; }
    if (node.type === "unary") return visit(node.expression);
    if (node.type === "call") {
      const args = node.args.map(visit); smartAssert(args.every(unit => same(unit, args[0])), "UNIT_MISMATCH", "Use matching units and scales."); return args[0]!;
    }
    const a = visit(node.left), b = visit(node.right);
    if (node.operator === "+" || node.operator === "-") { smartAssert(same(a, b), "UNIT_MISMATCH", "Use matching units and scales."); return a; }
    const sign = node.operator === "*" ? 1 : -1;
    return { dimensions: combine(a.dimensions, b.dimensions, sign), scales: combine(a.scales, b.scales, sign) };
  };
  smartAssert(same(visit(analysis.ast), parseIncomingKpiUnit(targetUnit, period)), "UNIT_MISMATCH", "Formula units must match the parent; use matching input scales.");
}

/** Bounded literal/linear normalization catches zero/cancelled padding without
 * using current values or claiming general symbolic equivalence. */
export function validateIncomingKpiEffectiveReferences(analysis: IncomingKpiFormulaAnalysis): void {
  // Visit every constant domain before algebra can discard a zero/cancelled
  // branch. Unknown measured inputs must not conceal an invalid definition.
  const constantDomain = (node: FormulaExpression): number | undefined => {
    if (node.type === "number") return node.value;
    if (node.type === "reference") return;
    let value: number | undefined;
    if (node.type === "unary") { const x = constantDomain(node.expression); value = x === undefined ? undefined : -x; }
    else if (node.type === "call") {
      const args = node.args.map(constantDomain);
      if (args.every(x => x !== undefined)) value = (node.name === "min" ? Math.min : Math.max)(...(args as number[]));
    } else {
      const a = constantDomain(node.left), b = constantDomain(node.right);
      smartAssert(node.operator !== "/" || b !== 0, "DIVISION_BY_ZERO", "The denominator cannot be zero.");
      if (a !== undefined && b !== undefined) value = node.operator === "+" ? a + b : node.operator === "-" ? a - b : node.operator === "*" ? a * b : a / b;
    }
    smartAssert(value === undefined || Number.isFinite(value), "NONFINITE_CONSTANT", "Simplify the numeric coefficient.");
    return value;
  };
  constantDomain(analysis.ast);
  type Term = { coefficient: number; refs: Set<string> };
  type Sum = Map<string, Term>;
  const add = (a: Sum, b: Sum, sign = 1): Sum => {
    const result = new Map([...a].map(([key, term]) => [key, { ...term, refs: new Set(term.refs) }]));
    for (const [key, term] of b) { const value = (result.get(key)?.coefficient ?? 0) + term.coefficient * sign;
      if (value === 0) result.delete(key); else result.set(key, { coefficient: value, refs: new Set(term.refs) }); }
    return result;
  };
  const scalar = (sum: Sum): number | undefined => !sum.size ? 0 : sum.size === 1 && sum.has("constant") ? sum.get("constant")!.coefficient : undefined;
  const scale = (sum: Sum, n: number): Sum => n === 0 ? new Map() : new Map([...sum].map(([key, term]) => [key, { ...term, coefficient: term.coefficient * n }]));
  const constant = (n: number): Sum => n === 0 ? new Map() : new Map([["constant", { coefficient: n, refs: new Set() }]]);
  const keyOf = (sum: Sum) => JSON.stringify([...sum].map(([key, term]) => [key, term.coefficient]).sort(([a], [b]) => String(a).localeCompare(String(b), "en")));
  const visit = (node: FormulaExpression): Sum => {
    if (node.type === "number") return constant(node.value);
    if (node.type === "reference") return new Map([[`ref:${node.name}`, { coefficient: 1, refs: new Set([node.name]) }]]);
    if (node.type === "unary") return scale(visit(node.expression), -1);
    const children = node.type === "call" ? node.args.map(visit) : [visit(node.left), visit(node.right)];
    if (node.type === "call" && children.every(child => scalar(child) !== undefined))
      return constant((node.name === "min" ? Math.min : Math.max)(...children.map(child => scalar(child)!)));
    if (node.type === "binary") {
      const [a, b] = children as [Sum, Sum], x = scalar(a), y = scalar(b);
      smartAssert(node.operator !== "/" || y !== 0, "DIVISION_BY_ZERO", "The denominator cannot be zero.");
      const equalAst = (a: FormulaExpression, b: FormulaExpression) => same(a, b);
      if (node.operator === "/" && node.left.type === "binary" && node.left.operator === "*") {
        if (equalAst(node.left.right, node.right)) return visit(node.left.left);
        if (equalAst(node.left.left, node.right)) return visit(node.left.right);
      }
      if (node.operator === "*") {
        if (node.left.type === "binary" && node.left.operator === "/" && equalAst(node.left.right, node.right)) return visit(node.left.left);
        if (node.right.type === "binary" && node.right.operator === "/" && equalAst(node.right.right, node.left)) return visit(node.right.left);
      }
      if (node.operator === "+" || node.operator === "-") return add(a, b, node.operator === "+" ? 1 : -1);
      if (node.operator === "*") { if (x !== undefined) return scale(b, x); if (y !== undefined) return scale(a, y); }
      if (node.operator === "/") {
        smartAssert(y !== 0, "DIVISION_BY_ZERO", "The denominator cannot be zero.");
        if (y !== undefined) return scale(a, 1 / y);
        if (keyOf(a) === keyOf(b)) return constant(1);
        if (x === 0) return new Map();
      }
    }
    const refs = new Set(children.flatMap(sum => [...sum.values()].flatMap(term => [...term.refs])));
    let keys = children.map(keyOf);
    if (node.type === "call" || node.type === "binary" && node.operator === "*") keys = keys.sort();
    return new Map([[`${node.type === "call" ? node.name : node.operator}(${keys.join(";")})`, { coefficient: 1, refs }]]);
  };
  const effective = new Set([...visit(analysis.ast).values()].flatMap(term => [...term.refs]));
  smartAssert(analysis.references.every(alias => effective.has(alias)), "INEFFECTIVE_FACTOR", "Remove cancelled or zero-weight KPI references.");
}
