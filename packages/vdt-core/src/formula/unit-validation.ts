import type { FormulaExpression } from "./ast";
import type { VdtNode, VdtWarning } from "../types";

type Unit = Record<string, number>;
type InferredUnit = { unit: Unit | undefined; literal: boolean; coefficient: number | undefined };
const aliases: Record<string, string> = {
  hour: "h", hours: "h", minute: "min", minutes: "min", second: "s", seconds: "s", sec: "s",
  tonne: "t", tonnes: "t", kilogram: "kg", kilograms: "kg", metre: "m", metres: "m", meter: "m", meters: "m",
  units: "count", unit: "count", counts: "count", item: "count", items: "count", trips: "trip",
  days: "day", weeks: "week", months: "month", quarters: "quarter", years: "year", shifts: "shift"
};
const scalar = new Set(["1", "%", "fraction", "ratio", "percent", "percentage"]);
const percent = new Set(["%", "percent", "percentage"]);
const percentScale = 0.01;
const percentScaleHint = " Percent inputs use a 0–100 scale. Divide by 100 to use a fraction, or multiply a fraction by 100 to produce a percent.";
const quantities: Record<string, [string, number]> = {
  h: ["time", 3600], min: ["time", 60], s: ["time", 1], day: ["time", 86400],
  t: ["mass", 1000], kg: ["mass", 1], kt: ["mass", 1_000_000],
  km: ["length", 1000], m: ["length", 1], cm: ["length", 0.01], mm: ["length", 0.001]
};
// Named business entities (trips, shifts, machines, etc.) need an explicit
// per-entity basis. Preserve their algebra without guessing that basis.
const identities = new Set(["count", "week", "month", "quarter", "year", "usd", "eur", "gbp", "kzt", "rub", "cad", "aud", "jpy", "cny", "chf"]);
const clean = (unit: Unit): Unit => Object.fromEntries(Object.entries(unit).filter(([, power]) => power !== 0).sort(([a], [b]) => a.localeCompare(b, "en")));
const same = (a: Unit, b: Unit) => JSON.stringify(clean(a)) === JSON.stringify(clean(b));
function combine(a: Unit, b: Unit, sign: number): Unit {
  const result: Unit = Object.assign(Object.create(null), a);
  for (const [atom, power] of Object.entries(b)) result[atom] = (result[atom] ?? 0) + sign * power;
  return clean(result);
}

function physical(unit: Unit) {
  const dimensions: Unit = Object.create(null);
  let scale = 1, known = true;
  for (const [atom, power] of Object.entries(unit)) {
    if (atom === "%") {
      scale *= percentScale ** power;
      continue;
    }
    const quantity = Object.hasOwn(quantities, atom) ? quantities[atom] : undefined;
    const dimension = quantity?.[0] ?? atom;
    dimensions[dimension] = (dimensions[dimension] ?? 0) + power;
    scale *= (quantity?.[1] ?? 1) ** power;
    if (!quantity && !identities.has(atom) && !/^(?:usd|eur|gbp|kzt|rub)[_ ]\d{4}$/.test(atom)) known = false;
  }
  return { dimensions: clean(dimensions), scale, known };
}

/** A known numeric scale change must appear in the formula; values themselves
 * are never converted. Unknown custom bases are review issues, not invented SI
 * dimensions (for example a declared equipment count may be a scalar count). */
function compatible(actual: Unit, expected: Unit, coefficient: number | undefined): boolean | undefined {
  if (same(actual, expected)) return true;
  const from = physical(actual), to = physical(expected);
  if (!same(from.dimensions, to.dimensions)) return from.known && to.known ? false : undefined;
  if (!Number.isFinite(from.scale) || !Number.isFinite(to.scale) || from.scale <= 0 || to.scale <= 0) return undefined;
  const ratio = from.scale / to.scale;
  return coefficient !== undefined && Number.isFinite(coefficient) && Math.abs(Math.abs(coefficient) - ratio) <= 1e-12 * Math.max(ratio, Math.abs(coefficient), 1e-12);
}

/** Formal unit algebra with an opt-in check for the percent/fraction scale. */
export function parseValidationUnit(text: string, enforcePercentageScale = false): Unit | undefined {
  if (!text.trim() || text.length > 256) return undefined;
  const tokens = text.trim().toLowerCase().replace(/[·×]/g, "*").match(/[^*/^()]+|[*/^()]/g) ?? [];
  let cursor = 0;
  const term = (): Unit => {
    let result: Unit;
    const token = tokens[cursor++]?.trim();
    if (!token || ["*", "/", "^", ")"].includes(token)) throw new Error("Invalid unit term");
    if (token === "(") {
      result = expression();
      if (tokens[cursor++] !== ")") throw new Error("Unclosed unit group");
    } else {
      const atom = Object.hasOwn(aliases, token) ? aliases[token]! : token;
      result = enforcePercentageScale && percent.has(atom) ? { "%": 1 } : scalar.has(atom) ? {} : { [atom]: 1 };
    }
    if (tokens[cursor] === "^") {
      cursor++;
      const power = tokens[cursor++]?.trim() ?? "";
      if (!/^[+-]?\d+$/.test(power) || Math.abs(Number(power)) > 16) throw new Error("Invalid unit power");
      result = clean(Object.fromEntries(Object.entries(result).map(([atom, exponent]) => [atom, exponent * Number(power)])));
    }
    return result;
  };
  const expression = (): Unit => {
    let result = term();
    while (tokens[cursor] === "*" || tokens[cursor] === "/") {
      const operator = tokens[cursor++];
      result = combine(result, term(), operator === "*" ? 1 : -1);
    }
    return result;
  };
  try {
    const result = expression();
    return cursor === tokens.length ? clean(result) : undefined;
  } catch { return undefined; }
}

function formatUnit(unit: Unit): string {
  const terms = (sign: number) => Object.entries(unit).filter(([, power]) => power * sign > 0)
    .map(([atom, power]) => `${atom}${Math.abs(power) === 1 ? "" : `^${Math.abs(power)}`}`).join(" * ");
  const numerator = terms(1) || "1", denominator = terms(-1);
  return denominator ? `${numerator} / (${denominator})` : numerator;
}

export function validateFormulaUnits(
  node: VdtNode, expression: FormulaExpression, nodes: ReadonlyMap<string, VdtNode>, enforcePercentageScale = false,
  requireTimeInputUnits = false
): VdtWarning[] {
  const issues: VdtWarning[] = [];
  const declaredUnit = node.unit ? parseValidationUnit(node.unit, true) : undefined;
  const verifyTime = requireTimeInputUnits && declaredUnit && (physical(declaredUnit).dimensions.time ?? 0) > 0;
  const matchUnits = (actual: Unit, expected: Unit, coefficient: number | undefined) => {
    const scaled = compatible(actual, expected, coefficient);
    if (enforcePercentageScale || verifyTime || scaled === true || (!actual["%"] && !expected["%"])) return scaled;
    // Legacy formulas may use percentages as scalars. They also need to
    // recognize explicit percentage conversion inside a physical scale change.
    return compatible(combine(actual, { "%": actual["%"] ?? 0 }, -1),
      combine(expected, { "%": expected["%"] ?? 0 }, -1), coefficient);
  };
  const report = (key: string, message: string, severity: VdtWarning["severity"] = "error") => {
    issues.push({ id: `validation-unit-${node.id}-${key}`, type: "unit_mismatch", severity, nodeId: node.id, message });
  };
  const readUnit = (target: VdtNode, key: string) => {
    const unit = target.unit ? parseValidationUnit(target.unit, true) : undefined;
    if (!unit) report(key, `The unit of “${target.name}” is missing or cannot be checked. Set a unit to verify the formula for “${node.name}”.`, verifyTime ? "error" : "warning");
    return unit;
  };
  const add = (left: InferredUnit, right: InferredUnit, path: string, operator: string): InferredUnit => {
    if (left.literal && right.literal) {
      const a = left.coefficient, b = right.coefficient;
      return { unit: {}, literal: true, coefficient: a === undefined || b === undefined ? undefined
        : operator === "+" ? a + b : operator === "-" ? a - b : operator.startsWith("min") ? Math.min(a, b) : Math.max(a, b) };
    }
    // Numeric offsets/thresholds retain the general formula language's existing
    // context-unit semantics. Multiplicative coefficients remain scalars.
    if (left.literal) return right;
    if (right.literal) return left;
    if (left.unit && right.unit && !same(left.unit, right.unit)) {
      const rightToLeft = matchUnits(right.unit, left.unit, right.coefficient);
      const leftToRight = matchUnits(left.unit, right.unit, left.coefficient);
      if (rightToLeft === true || leftToRight === true) return { unit: rightToLeft ? left.unit : right.unit, literal: false, coefficient: undefined };
      const scaleHint = (enforcePercentageScale || verifyTime) && left.unit["%"] !== right.unit["%"] ? percentScaleHint : "";
      report(path, `Formula for “${node.name}” combines ${rightToLeft === undefined ? "unverified custom" : "incompatible"} units with ${operator}: “${formatUnit(left.unit)}” and “${formatUnit(right.unit)}”.${scaleHint}`, rightToLeft === undefined && !verifyTime ? "warning" : "error");
    }
    return { unit: left.unit && right.unit ? left.unit : undefined, literal: false,
      coefficient: left.coefficient === right.coefficient ? left.coefficient : undefined };
  };
  const visit = (ast: FormulaExpression, path: string): InferredUnit => {
    if (ast.type === "number") return { unit: {}, literal: true, coefficient: ast.value };
    if (ast.type === "reference") {
      const target = nodes.get(ast.name);
      return { unit: target ? readUnit(target, `reference-${ast.name}`) : undefined, literal: false, coefficient: 1 };
    }
    if (ast.type === "unary") {
      const result = visit(ast.expression, `${path}-unary`);
      return { ...result, coefficient: result.coefficient === undefined ? undefined : -result.coefficient };
    }
    if (ast.type === "call") return ast.args.map((arg, index) => visit(arg, `${path}-${index}`))
      .reduce((left, right, index) => add(left, right, `${path}-${index}`, `${ast.name}(...)`));
    const left = visit(ast.left, `${path}-left`), right = visit(ast.right, `${path}-right`);
    if (ast.operator === "+" || ast.operator === "-") return add(left, right, path, ast.operator);
    const multiply = ast.operator === "*";
    const unit = left.unit && right.unit ? combine(left.unit, right.unit, multiply ? 1 : -1) : undefined;
    const coefficient = left.coefficient === undefined || right.coefficient === undefined ? undefined
      : multiply ? left.coefficient * right.coefficient : left.coefficient / right.coefficient;
    // An explicit scale such as p/100 gives subsequent arithmetic a fraction.
    const literal = left.literal && right.literal;
    if (unit?.["%"] && coefficient !== undefined) {
      const scale = percentScale ** unit["%"];
      if (scale > 0 && Number.isFinite(scale) && Math.abs(Math.abs(coefficient) - scale) <= 1e-12 * scale) {
        return { unit: combine(unit, { "%": unit["%"] }, -1), literal, coefficient: coefficient / scale };
      }
    }
    return { unit, literal, coefficient };
  };
  const inferred = visit(expression, "expression");
  if (!inferred.literal) {
    const declared = readUnit(node, "result-missing");
    if (declared && inferred.unit) {
      const matches = matchUnits(inferred.unit, declared, inferred.coefficient);
      const scaleHint = (enforcePercentageScale || verifyTime) && inferred.unit["%"] !== declared["%"] ? percentScaleHint : "";
      const from = physical(inferred.unit), to = physical(declared);
      const timeHint = same(from.dimensions, to.dimensions) && from.dimensions.time && from.scale !== to.scale
        ? ` The explicit conversion multiplier for these units is ${from.scale / to.scale}.` : "";
      const countHint = same(combine(from.dimensions, { count: 1 }, -1), to.dimensions)
        ? " If the other factors describe one identical entity, use unit 1 for the number of copies. For an explicit count, use a matching per-item amount or rate." : "";
      if (matches === false) report("result", `The output unit of “${node.name}” is “${node.unit}”, but its formula produces “${formatUnit(inferred.unit)}”. Correct the unit or formula.${scaleHint}${timeHint}${countHint}`);
      if (matches === undefined) report("result", `The output unit of “${node.name}” is “${node.unit}”, while its formula produces “${formatUnit(inferred.unit)}”. Define the custom unit or per-entity basis to verify this relationship.`, verifyTime ? "error" : "warning");
    }
  }
  return [...new Map(issues.map(item => [item.id, item])).values()];
}
