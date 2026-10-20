import type { KpiSuggestionPeriod } from "./types";
import type { IncomingKpiUnitExpression } from "./incoming-types";
import { smartAssert } from "./validation";

const spelling: Record<string, string> = {
  hour: "h", hours: "h", minute: "min", minutes: "min", second: "s", seconds: "s", sec: "s",
  tonne: "t", tonnes: "t", kilogram: "kg", kilograms: "kg", trips: "trip", units: "count", unit: "count", item: "count", items: "count"
};
const quantities: Record<string, [string, string]> = {
  h: ["time", "h"], min: ["time", "min"], s: ["time", "s"],
  km: ["length", "km"], m: ["length", "m"], t: ["mass", "t"], kg: ["mass", "kg"],
  trip: ["trip", "trip"], count: ["count", "count"]
};
const periods = new Set(["shift", "day", "week", "month", "quarter", "year"]);
const currencies = new Set(["USD", "EUR", "GBP", "KZT", "RUB"]);
const clean = (value: Record<string, number>) => Object.fromEntries(Object.entries(value).filter(([, exponent]) => exponent !== 0).sort(([a], [b]) => a.localeCompare(b, "en")));

/** FM-01 unit grammar/scale representation only. FM-02 composes these records
 * through an AST; this parser does not authorize a formula or certify scope.
 * No unit conversion is implemented, even with an explicit numeric multiplier. */
export function parseIncomingKpiUnit(unit: string, period: KpiSuggestionPeriod): IncomingKpiUnitExpression {
  smartAssert(typeof unit === "string" && unit.trim().length > 0 && unit.length <= 80, "UNSUPPORTED_UNIT", "Enter a unit.");
  const text = unit.trim();
  smartAssert(text.split("/").length <= 2, "UNSUPPORTED_UNIT", "Use a simple numerator/denominator unit.");
  const dimensions: Record<string, number> = {}, scales: Record<string, number> = {};
  const parts = text.split("/");
  for (let side = 0; side < parts.length; side++) {
    const terms = parts[side]!.split("*");
    smartAssert(terms.length <= 4 && terms.every(Boolean), "UNSUPPORTED_UNIT", "Simplify the unit expression.");
    for (const term of terms) {
      const match = /^\s*([\p{L}_][\p{L}\p{N}_]{0,31}|1|%)(?:\^(-?[1-6]))?\s*$/u.exec(term);
      smartAssert(match, "UNSUPPORTED_UNIT", "Use unit atoms with *, / and integer powers.");
      const raw = match[1]!, atom = Object.hasOwn(spelling, raw) ? spelling[raw]! : raw;
      const exponent = (side === 0 ? 1 : -1) * Number(match[2] ?? 1);
      if (atom === "1" || atom === "fraction") continue;
      if (atom === "%") { scales["fraction:percent"] = (scales["fraction:percent"] ?? 0) + exponent; continue; }
      if (periods.has(atom)) {
        smartAssert(period.grain === atom && !/^(?:unspecified:|conflict:)/.test(period.key), "UNSUPPORTED_PERIOD", "Use an explicit matching period basis.");
        const key = `period:${atom}:${period.key}`;
        dimensions[key] = (dimensions[key] ?? 0) + exponent; continue;
      }
      const quantity = Object.hasOwn(quantities, atom) ? quantities[atom] : undefined;
      if (quantity) {
        const [dimension, scale] = quantity;
        dimensions[dimension] = (dimensions[dimension] ?? 0) + exponent;
        scales[`${dimension}:${scale}`] = (scales[`${dimension}:${scale}`] ?? 0) + exponent;
      } else {
        const dimension = currencies.has(atom) ? `currency:${atom}` : `opaque:${atom}`;
        dimensions[dimension] = (dimensions[dimension] ?? 0) + exponent;
      }
    }
  }
  return { dimensions: clean(dimensions), scales: clean(scales) };
}
