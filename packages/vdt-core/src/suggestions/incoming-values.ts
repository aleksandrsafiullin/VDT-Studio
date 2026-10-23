import type { FormulaExpression } from "../formula/ast";
import { evaluateAst } from "../formula/evaluator";
import { calculateGraph } from "../formula/calculate";
import type { VdtNodePatch } from "../changeset/types";
import type { VdtNode, VdtProject } from "../types";
import { inspectIncomingKpiDraft } from "./incoming-contract";
import { parseIncomingKpiUnit } from "./incoming-unit-contract";
import type { IncomingKpiAlias, IncomingKpiBatchInput, IncomingKpiDraftBinding, IncomingKpiDraftIssue } from "./incoming-types";

export interface IncomingKpiInputValue {
  alias: IncomingKpiAlias;
  value?: number;
  source: "existing" | "user" | "derived" | "estimate" | "missing";
  editable: boolean;
  estimated?: true;
}
export interface IncomingKpiValueResolution {
  inputs: IncomingKpiInputValue[];
  referenceValue?: number;
  referenceSource: "current" | "retained" | "user" | "estimate" | "missing";
  referenceEstimated?: true;
  result?: number;
  issues: IncomingKpiDraftIssue[];
}
const finite = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value);
export const incomingKpiValuesEqual = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b), 1e-6);
function numericText(text: string | undefined): number | undefined {
  if (!text?.trim()) return;
  const normalized = text.trim().replace(",", ".");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) return;
  const value = Number(normalized);
  return finite(value) ? value : undefined;
}

/** Only invert a single occurrence with a unique finite solution. No neutral
 * defaults, equal splits, min/max guesses or calibration factors are invented. */
function solveOne(ast: FormulaExpression, alias: string, target: number, known: ReadonlyMap<string, number>): number | undefined {
  const count = (node: FormulaExpression): number => node.type === "reference" ? Number(node.name === alias) : node.type === "number" ? 0
    : node.type === "unary" ? count(node.expression) : node.type === "call" ? node.args.reduce((n, child) => n + count(child), 0) : count(node.left) + count(node.right);
  if (count(ast) !== 1) return;
  const solve = (node: FormulaExpression, value: number): number | undefined => {
    if (!finite(value)) return;
    if (node.type === "reference") return node.name === alias ? value : undefined;
    if (node.type === "unary") return solve(node.expression, -value);
    if (node.type !== "binary") return;
    const left = count(node.left) === 1;
    let other: number;
    try { other = evaluateAst(left ? node.right : node.left, name => known.get(name)); } catch { return; }
    if (!finite(other)) return;
    let next: number;
    if (node.operator === "+") next = value - other;
    else if (node.operator === "-") next = left ? value + other : other - value;
    else if (node.operator === "*") { if (other === 0) return; next = value / other; }
    else if (left) { if (other === 0) return; next = value * other; }
    else { if (value === 0 || other === 0) return; next = other / value; }
    return solve(left ? node.left : node.right, next);
  };
  return solve(ast, target);
}

/** Bounded illustrative allocations, never measured defaults. Unit-aware seeds
 * and a solved pivot provide a reviewable starting point with exact baseline
 * reconciliation. Known or explicitly entered numbers are never adjusted. */
function estimateMissing(ast: FormulaExpression, rows: IncomingKpiInputValue[], bindings: IncomingKpiDraftBinding[], reference: number,
  known: ReadonlyMap<string, number>, input: IncomingKpiBatchInput): Map<string, number> | undefined {
  const missing = rows.filter(row => !finite(row.value));
  if (missing.some(row => !row.editable)) return;
  const units = new Map(bindings.map(row => [row.alias, parseIncomingKpiUnit(row.unit, input.context.period)]));
  const parentUnit = parseIncomingKpiUnit(input.context.target.unit!, input.context.period);
  const count = (alias: IncomingKpiAlias) => { const unit = units.get(alias)!; const dimensions = Object.entries(unit.dimensions);
    return dimensions.length === 1 && (dimensions[0]![0] === "trip" || dimensions[0]![0] === "count") && dimensions[0]![1] === 1; };
  const sameUnit = (alias: IncomingKpiAlias) => JSON.stringify(units.get(alias)) === JSON.stringify(parentUnit);
  const fraction = (alias: IncomingKpiAlias) => !Object.keys(units.get(alias)!.dimensions).length;
  const seed = (alias: IncomingKpiAlias) => sameUnit(alias) && ast.type === "binary" && ast.operator === "+"
    ? count(alias) ? Math.floor(Math.max(0, reference) / missing.length) : reference / missing.length
    : count(alias) ? 1000 : sameUnit(alias) ? reference
    : fraction(alias) ? Object.hasOwn(units.get(alias)!.scales, "fraction:percent") ? 50 : 0.5 : 1;
  const acceptable = (alias: IncomingKpiAlias, value: number) => finite(value) && (!count(alias) || Number.isSafeInteger(value) && value >= 0)
    && (!fraction(alias) || value >= 0 && value <= (Object.hasOwn(units.get(alias)!.scales, "fraction:percent") ? 100 : 1));
  // Prefer solving a physical amount rather than producing a fractional count.
  for (const pivot of [...missing].sort((a, b) => Number(count(a.alias)) - Number(count(b.alias)))) {
    const candidate = new Map(known);
    for (const row of missing) if (row !== pivot) candidate.set(row.alias, seed(row.alias));
    candidate.set(pivot.alias, solveOne(ast, pivot.alias, reference, candidate) ?? seed(pivot.alias));
    if (missing.some(row => !acceptable(row.alias, candidate.get(row.alias)!))) continue;
    try { if (incomingKpiValuesEqual(evaluateAst(ast, name => candidate.get(name)), reference)) return candidate; } catch { /* Try another finite pivot. */ }
  }
}

/** Host-only baseline resolution, independent of preparation and providers.
 * Existing values win. Optional illustrative estimates are explicitly marked;
 * the parent reference is never changed to fit. */
export function resolveIncomingKpiValues(project: VdtProject, input: IncomingKpiBatchInput): IncomingKpiValueResolution {
  const result: IncomingKpiValueResolution = { inputs: [], referenceSource: "missing", issues: [] };
  const inspected = inspectIncomingKpiDraft(input, project);
  const target = project.graph.nodes.find(node => node.id === input.context?.targetNodeId);
  if (!target) return result;
  const calculated = calculateGraph(project).values;
  const current = calculated[target.id], retained = target.baselineValue ?? target.value;
  const rawReference = typeof input.draft?.referenceValue === "string" ? input.draft.referenceValue : undefined;
  const reference = finite(current) ? current : finite(retained) ? retained : numericText(rawReference);
  if (finite(reference)) {
    result.referenceValue = reference;
    result.referenceSource = finite(current) ? "current" : finite(retained) ? "retained" : input.draft.referenceValueEstimated ? "estimate" : "user";
    if (result.referenceSource === "estimate" || target.valueStatus === "default_assumption" || target.valueSource?.sourceTier === "assumption") result.referenceEstimated = true;
  } else result.issues.push({ code: "MISSING_REFERENCE_VALUE", message: "Enter the current KPI value to preserve in this breakdown." });
  if (rawReference?.trim() && (!finite(numericText(rawReference))
    || finite(reference) && !incomingKpiValuesEqual(numericText(rawReference)!, reference)))
    result.issues.push({ code: "INVALID_REFERENCE_VALUE", message: "Use the current KPI value; it cannot be changed to fit the formula." });
  if (!inspected.readyForCompile) { result.issues.push(...inspected.issues); return result; }
  const known = new Map<string, number>();
  for (const binding of inspected.bindings) {
    const node = binding.existingNodeId ? project.graph.nodes.find(node => node.id === binding.existingNodeId) : undefined;
    const existing = node ? calculated[node.id] : undefined;
    const raw = input.draft.inputValues?.[binding.alias], supplied = numericText(raw);
    const editable = !node || !node.formula?.trim() && !finite(existing);
    const row: IncomingKpiInputValue = { alias: binding.alias, source: "missing", editable };
    if (finite(existing)) { row.value = existing; row.source = "existing";
      if (node?.valueStatus === "default_assumption" || node?.valueSource?.sourceTier === "assumption") row.estimated = true;
    }
    else if (finite(supplied) && editable) { row.value = supplied;
      row.source = input.draft.estimatedAliases?.includes(binding.alias) ? "estimate" : "user";
      if (row.source === "estimate") row.estimated = true;
    }
    if (raw?.trim() && (!finite(supplied) || !editable && (!finite(existing) || !incomingKpiValuesEqual(supplied, existing))))
      result.issues.push({ code: "INVALID_INPUT_VALUE", alias: binding.alias, message: editable ? `Enter a finite value for ${binding.name}.` : `Use the existing value of ${binding.name}; edit its source separately.` });
    if (finite(row.value)) known.set(binding.alias, row.value);
    result.inputs.push(row);
  }
  const missing = result.inputs.filter(row => !finite(row.value));
  if (missing.length === 1 && missing[0]!.editable && finite(reference) && !result.issues.length) {
    const row = missing[0]!, value = solveOne(inspected.analysis.ast, row.alias, reference, known);
    if (finite(value)) { row.value = value; row.source = result.referenceEstimated || result.inputs.some(input => input.estimated) ? "estimate" : "derived";
      if (row.source === "estimate") row.estimated = true;
      known.set(row.alias, value);
    }
  }
  if (input.draft.estimateMissingValues && finite(reference) && !result.issues.length && result.inputs.some(row => !finite(row.value))) {
    let estimates: Map<string, number> | undefined;
    try { estimates = estimateMissing(inspected.analysis.ast, result.inputs, inspected.bindings, reference, known, input); } catch { /* Incomplete unit edits remain editable; the compiler supplies their formal error. */ }
    if (estimates) for (const row of result.inputs) if (!finite(row.value)) { row.value = estimates.get(row.alias)!; row.source = "estimate"; row.estimated = true; known.set(row.alias, row.value); }
  }
  if (result.inputs.some(row => !finite(row.value))) result.issues.push({ code: "MISSING_INPUT_VALUES", message: "Enter the missing input values. One remaining input can be calculated from the current KPI." });
  else {
    try {
      const value = evaluateAst(inspected.analysis.ast, name => known.get(name));
      if (!finite(value)) throw new Error("Nonfinite result");
      result.result = value;
      if (finite(reference) && !incomingKpiValuesEqual(value, reference)) result.issues.push({ code: "BASELINE_MISMATCH", message: `The formula gives ${Number(value.toPrecision(12))}; it must equal the current KPI (${Number(reference.toPrecision(12))}).` });
    } catch { result.issues.push({ code: "INVALID_INPUT_CALCULATION", message: "These values do not produce a finite result. Check zero denominators." }); }
  }
  return result;
}

export function incomingKpiInputValuePatch(row: IncomingKpiInputValue, input: IncomingKpiBatchInput, reference: number): VdtNodePatch {
  if (!finite(row.value) || row.source === "existing" || row.source === "missing") return {};
  return { baselineValue: row.value, valueStatus: row.source === "estimate" ? "default_assumption" : row.source === "user" ? "user_provided_value" : "calculated",
    valueSource: { sourceTier: row.source === "estimate" ? "assumption" : row.source === "user" ? "user" : "derived", acceptedByUserInDialog: true, editableInDialog: true,
      note: row.source === "user" ? "Value entered by the user in the incoming KPI panel."
        : row.source === "estimate" ? `Illustrative estimate accepted in Smart to preserve ${input.draft.targetNodeId} = ${reference}. Not measured data; replace with real inputs when available.`
        : `Derived from the retained current KPI ${input.draft.targetNodeId} = ${reference} using ${input.draft.formula}. Not an independent measurement.` } };
}

export function incomingKpiReferenceValuePatch(values: IncomingKpiValueResolution, target: VdtNode): VdtNodePatch {
  if (values.referenceSource !== "user" && values.referenceSource !== "estimate") return {};
  return { baselineValue: values.referenceValue, valueSource: { sourceTier: values.referenceSource === "estimate" ? "assumption" : "user", acceptedByUserInDialog: true,
    note: values.referenceSource === "estimate" ? "Illustrative parent reference estimate accepted in Smart. Not measured data."
      : "Reference value entered by the user before applying the incoming KPI breakdown." },
    ...(values.referenceSource === "estimate" ? { assumptions: [...(target.assumptions ?? []), "Illustrative parent reference estimate; not measured data."] } : {}) };
}
