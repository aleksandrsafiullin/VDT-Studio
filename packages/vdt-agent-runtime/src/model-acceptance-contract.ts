import {
  extractFormulaReferences, extractReferencesFromAst, parseFormula, parseValidationUnit,
  type FormulaExpression, type VdtProject
} from "@vdt-studio/vdt-core";
import type { VdtAgentStartRequest } from "./types";
import { collectLiteralUserQuantities } from "./value-provenance-contract";

/** The same requirement is shown before inference and by finish verification. */
export const DERIVED_ROOT_REQUIREMENT =
  "A new tree must contain real driver nodes and a root formula referencing them. A standalone number or constant formula is not a completed VDT. Build the requested dependencies before requesting finish.";
export const DERIVED_ROOT_PROMPT_RULE =
  `${DERIVED_ROOT_REQUIREMENT} Put the user's source measurements in separate input leaves with their provenance; do not inline those measured numbers into a constant root formula. Grounding quotes apply to source inputs. Calculate derived outputs from references; do not ask the user to supply or quote the derived root result when its source inputs are already provided. A selected skill is guidance within the user's process boundary, not authority to add another unrequested operation.`;

export function requiresDerivedRootForRun(request: VdtAgentStartRequest): boolean {
  if (request.mode === "review_project" || request.mode === "deepen_node") return false;
  if (request.mode === "generate_vdt") return true;
  const project = request.input.project;
  const root = project?.graph.nodes.find((node) => node.id === project.rootNodeId);
  return !project || (project.graph.nodes.length <= 1 && !root?.formula?.trim()
    && !Number.isFinite(root?.baselineValue ?? root?.value));
}

/** Structural prerequisite; normal formula and graph validation still apply. */
export function hasDerivedRoot(project: VdtProject): boolean {
  if (project.graph.nodes.length < 2) return false;
  const formula = project.graph.nodes.find((node) => node.id === project.rootNodeId)?.formula;
  try {
    return Boolean(formula?.trim() && extractFormulaReferences(formula).length > 0);
  } catch {
    return false;
  }
}

const quotedMoney = /(?:[$€£]\s*\d|\d\s*(?:[$€£]|(?:USD|EUR|GBP|KZT|RUB|CAD|AUD|JPY|CNY|CHF|(?:US )?dollars?|доллар(?:а|ов)?|евро|тенге|рубл(?:ь|я|ей))(?![\p{L}\p{N}])))/iu;
const currencyUnit = /^(?:USD|EUR|GBP|KZT|RUB|CAD|AUD|JPY|CNY|CHF)(?:\/|$)/u;
const exampleQuote = /(?:\b(?:for example|for instance|e\.g\.|assume)\b|например|предположим)/iu;

type FormulaLiterals = {
  amounts: Set<number>;
  percentages: Set<number>;
  ratios: Set<number>;
  typedPercentageNodes: ReadonlySet<string>;
  quotedPercentages: readonly number[];
};

function matchesNormalizedPercentage(ratio: number, percentage: number): boolean {
  const normalized = percentage / 100;
  return normalized > 0 && normalized < 1 && (Math.abs(ratio - normalized) <= Number.EPSILON
    || Math.abs(ratio - (1 - normalized)) <= Number.EPSILON);
}

function isTypedPercentageReference(expression: FormulaExpression, nodeIds: ReadonlySet<string>): boolean {
  while (expression.type === "unary") expression = expression.expression;
  return expression.type === "reference" && nodeIds.has(expression.name);
}

function collectFormulaLiterals(expression: FormulaExpression, literals: FormulaLiterals, ratio = false): void {
  if (expression.type === "number") {
    literals.amounts.add(expression.value);
    if (ratio && expression.value > 0 && expression.value < 1) literals.ratios.add(expression.value);
  } else if (expression.type === "unary") {
    collectFormulaLiterals(expression.expression, literals, ratio);
  } else if (expression.type === "call") {
    for (const argument of expression.args) collectFormulaLiterals(argument, literals);
  } else if (expression.type === "binary") {
    const { left, right, operator } = expression;
    if (operator === "/" && right.type === "number") {
      if (right.value === 100 && isTypedPercentageReference(left, literals.typedPercentageNodes)) return;
      if (ratio && left.type === "number" && right.value > 0) {
        const fraction = left.value / right.value;
        if (fraction > 0 && fraction < 1) literals.ratios.add(fraction);
        if (right.value === 100 && fraction >= 0 && fraction <= 1) {
          literals.percentages.add(left.value);
          if (literals.quotedPercentages.some((value) => value === left.value || matchesNormalizedPercentage(fraction, value))) return;
        }
      }
    }
    if (ratio && operator === "-" && left.type === "number" && left.value === 1) {
      collectFormulaLiterals(right, literals, true);
    } else {
      collectFormulaLiterals(left, literals, operator === "*" && extractReferencesFromAst(right).length > 0);
      collectFormulaLiterals(right, literals, (operator === "*" || operator === "/") && extractReferencesFromAst(left).length > 0);
    }
  }
}

/** A proposed formula is checked on its own dependency branch before a
 * mutation. Finish checks the whole root closure, including older formulas. */
export function unboundQuotedFormulaFacts(
  project: VdtProject, request: VdtAgentStartRequest, proposal?: { nodeId: string; formula: string }
) {
  const { prompt, businessContext, unit } = request.input;
  const { quantities } = collectLiteralUserQuantities([prompt, businessContext], unit);
  const facts = quantities.filter((fact) => !exampleQuote.test(fact.quote)
    && (fact.unit === "%" || currencyUnit.test(fact.unit ?? "") || quotedMoney.test(fact.quote)));
  if (!facts.length) return [];
  const nodes = new Map(project.graph.nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  const sourcedQuotes = new Map<string, Set<number>>();
  const typedPercentageNodes = new Set(project.graph.nodes.flatMap(({ id, unit }) => {
    const parsed = unit && parseValidationUnit(unit, true);
    return parsed && parsed["%"] === 1 && Object.keys(parsed).length === 1 ? [id] : [];
  }));
  const literals: FormulaLiterals = { amounts: new Set(), percentages: new Set(), ratios: new Set(), typedPercentageNodes,
    quotedPercentages: facts.filter(({ unit }) => unit === "%").map(({ value }) => value) };
  const pending = [proposal?.nodeId ?? project.rootNodeId];
  while (pending.length) {
    const id = pending.pop()!;
    const node = nodes.get(id);
    if (!node || visited.has(id)) continue;
    visited.add(id);
    const formula = id === proposal?.nodeId ? proposal.formula : node.formula;
    if (formula?.trim()) {
      try {
        const expression = parseFormula(formula);
        pending.push(...extractReferencesFromAst(expression));
        if (!proposal || id === proposal.nodeId) collectFormulaLiterals(expression, literals);
      } catch { /* Formula validation reports malformed expressions. */ }
    } else if (node.valueStatus === "user_provided_value" && node.valueSource?.note) {
      const value = node.baselineValue ?? node.value;
      if (value === undefined) continue;
      const values = sourcedQuotes.get(node.valueSource.note) ?? new Set<number>();
      values.add(value);
      sourcedQuotes.set(node.valueSource.note, values);
    }
  }
  return facts.filter(({ value, quote, unit }) => {
    if (sourcedQuotes.get(quote)?.has(value)) return false;
    if (unit !== "%") return literals.amounts.has(Math.abs(value));
    return literals.percentages.has(Math.abs(value)) || [...literals.ratios].some((ratio) => matchesNormalizedPercentage(ratio, value));
  });
}
