import { parseFormula } from "../formula/parser";
import type { FormulaExpression } from "../formula/ast";
import type { KpiSuggestionContext, KpiSuggestionGroup, KpiSuggestionRecipe } from "./types";
import { kpiCanonicalJson } from "./identity";
import { KpiSuggestionError, smartAssert } from "./validation";

type Dimension = Record<string, number>;
const currencies = new Set(["USD", "EUR", "GBP", "KZT", "RUB"]);
const mass = new Set(["t", "tonne", "tonnes"]);
const time = new Set(["h", "hour", "hours"]);
const count = new Set(["unit", "units", "item", "items", "count"]);

/** Deliberately narrow. No kt/t, month/hour, wet/dry, exchange-rate or percent
 * conversion; spelling aliases are exact-unit aliases, never KPI routing. */
function atom(token: string, context: KpiSuggestionContext): string | undefined {
  if (mass.has(token.toLowerCase())) return "mass";
  if (time.has(token.toLowerCase())) return "hour";
  if (count.has(token.toLowerCase())) return "count";
  if (currencies.has(token.toUpperCase())) return `currency:${token.toUpperCase()}`;
  if (context.period.grain !== "custom" && token === context.period.grain) return `period:${context.period.key}`;
  return undefined;
}

export function smartUnitDimension(unit: string, context: KpiSuggestionContext): Dimension {
  const text = unit.trim();
  if (text === "fraction" || text === "1") return {};
  const parts = text.split("/");
  smartAssert(parts.length <= 2, "UNSUPPORTED_UNIT", `Unsupported Smart unit: ${unit}.`);
  const numerator = atom(parts[0]!, context), denominator = parts[1] ? atom(parts[1], context) : undefined;
  smartAssert(numerator && (!parts[1] || denominator), "UNSUPPORTED_UNIT", `Unsupported Smart unit/period: ${unit}.`);
  const result: Dimension = { [numerator]: 1 };
  if (denominator) result[denominator] = (result[denominator] ?? 0) - 1;
  return clean(result);
}
function clean(value: Dimension): Dimension { return Object.fromEntries(Object.entries(value).filter(([, n]) => n !== 0).sort()); }
function combine(a: Dimension, b: Dimension, sign: 1 | -1): Dimension {
  const result = { ...a }; for (const [key, value] of Object.entries(b)) result[key] = (result[key] ?? 0) + sign * value;
  return clean(result);
}
function same(a: Dimension, b: Dimension) { return kpiCanonicalJson(a) === kpiCanonicalJson(b); }
function dimensions(ast: FormulaExpression, units: ReadonlyMap<string, Dimension>): Dimension {
  if (ast.type === "reference") { const d = units.get(ast.name); smartAssert(d, "INVALID_REFERENCE", "Unknown Smart formula factor."); return d; }
  if (ast.type === "number") { smartAssert(ast.value === 1 && ast.raw === "1", "UNSAFE_FORMULA", "Numeric assumptions are not supported."); return {}; }
  if (ast.type === "unary") return dimensions(ast.expression, units);
  if (ast.type === "call") {
    const args = ast.args.map(arg => dimensions(arg, units));
    smartAssert(args.every(d => same(d, args[0]!)), "UNIT_MISMATCH", "Smart formula arguments use incompatible units."); return args[0]!;
  }
  const left = dimensions(ast.left, units), right = dimensions(ast.right, units);
  if (ast.operator === "+" || ast.operator === "-") {
    smartAssert(same(left, right), "UNIT_MISMATCH", "Smart additive factors require identical dimensions and periods."); return left;
  }
  return combine(left, right, ast.operator === "*" ? 1 : -1);
}

export function resolveKpiRecipeUnits(recipe: KpiSuggestionRecipe, context: KpiSuggestionContext): Record<string, string> {
  const unit = context.target.unit;
  smartAssert(unit, "UNSUPPORTED_UNIT", "The target needs an explicit supported unit.");
  const target = smartUnitDimension(unit, context);
  const periodSuffix = unit.includes("/") && unit.split("/")[1] === context.period.grain ? `/${context.period.grain}` : "";
  const numerator = unit.split("/")[0]!;
  if (recipe.unitRule === "mass_time_rate") smartAssert(same(target, { mass: 1, ...(periodSuffix ? { [`period:${context.period.key}`]: -1 } : {}) }), "UNIT_MISMATCH", "Time×rate requires tonnes on a compatible period.");
  if (recipe.unitRule === "time_losses") smartAssert(same(target, { hour: 1, ...(periodSuffix ? { [`period:${context.period.key}`]: -1 } : {}) }), "UNIT_MISMATCH", "Time losses require hours on the same period.");
  if (recipe.unitRule === "rate_yield") smartAssert(same(target, { mass: 1, hour: -1 }), "UNIT_MISMATCH", "Rate×yield supports tonnes/hour and decimal fractions only.");
  const currency = numerator.toUpperCase();
  if (recipe.unitRule === "revenue_net") smartAssert(currencies.has(currency) && same(target, { [`currency:${currency}`]: 1, ...(periodSuffix ? { [`period:${context.period.key}`]: -1 } : {}) }), "UNIT_MISMATCH", "Revenue requires one supported currency on the same period.");
  return Object.fromEntries(recipe.children.map(child => [child.key,
    child.unitRole === "target" ? unit : child.unitRole === "working_time" ? `h${periodSuffix}` :
      child.unitRole === "mass_rate" ? (recipe.unitRule === "rate_yield" ? unit : `${numerator}/h`) :
      child.unitRole === "quantity" ? `units${periodSuffix}` : child.unitRole === "unit_price" ? `${currency}/unit` : "fraction"
  ]));
}

/** Provenance/shape checking also applies to contextual/cached library results;
 * completeness is a separate condition for installing an executable formula. */
export function verifyKpiRecipeProjection(recipe: KpiSuggestionRecipe, context: KpiSuggestionContext, group: KpiSuggestionGroup): void {
  const binding = group.recipeBinding;
  smartAssert(binding && binding.recipeId === recipe.id && binding.recipeHash === recipe.recipeHash && binding.skillHash === recipe.skillHash
    && binding.targetRole === recipe.targetRole && binding.contextHash === context.contextHash, "INVALID_RECIPE_BINDING", "Smart recipe provenance/role has changed.");
  smartAssert(group.formula && kpiCanonicalJson(parseFormula(group.formula)) === kpiCanonicalJson(parseFormula(recipe.formula)),
    "UNVERIFIED_FORMULA", "Only the audited recipe formula can be applied.");
  const units = resolveKpiRecipeUnits(recipe, context);
  smartAssert(group.children.length === recipe.children.length && recipe.children.every(c => group.children.some(candidate =>
    candidate.key === c.key && candidate.conceptKey === c.conceptKey && same(smartUnitDimension(candidate.unit, context), smartUnitDimension(units[c.key]!, context)))),
    "UNIT_MISMATCH", "Smart factors must match the complete audited units and concepts.");
  const actual = dimensions(parseFormula(group.formula), new Map(group.children.map(c => [c.key, smartUnitDimension(c.unit, context)])));
  smartAssert(same(actual, smartUnitDimension(context.target.unit!, context)), "UNIT_MISMATCH", "Smart formula dimensions do not match the target.");
}

export function verifyKpiRecipeGroup(recipe: KpiSuggestionRecipe, context: KpiSuggestionContext, group: KpiSuggestionGroup): void {
  smartAssert(context.period.grain !== "custom", "UNSUPPORTED_PERIOD", "Formula replacement requires an explicit supported analysis period.");
  smartAssert(!Object.values(context.omissions).some(Boolean), "INCOMPLETE_CONTEXT", "A truncated/cyclic context is contextual-only; prepare a complete decision before using a formula.");
  smartAssert(context.decompositionPlan?.nodes.find(n => n.nodeId === context.targetNodeId)?.kind !== "context", "CONTEXT_ONLY",
    "This branch is deliberately outside the root calculation. Revise its model plan before promoting factors.");
  verifyKpiRecipeProjection(recipe, context, group);
}

export function kpiFormulaAvailability(recipe: KpiSuggestionRecipe | undefined, context: KpiSuggestionContext, group: KpiSuggestionGroup): { available: true } | { available: false; reason: string } {
  try {
    smartAssert(recipe, "CONTEXT_ONLY", "No audited recipe is bound to this proposal."); verifyKpiRecipeGroup(recipe, context, group);
    return { available: true };
  } catch (error) {
    if (error instanceof KpiSuggestionError) return { available: false, reason: error.message };
    return { available: false, reason: "The formula could not be verified." };
  }
}
