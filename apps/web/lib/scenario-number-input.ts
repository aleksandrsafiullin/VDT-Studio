import { getStepFromDecimalPlaces } from "./format";

/** Accept plain numbers or the same comma grouping / decimal dot as Baseline. */
export function parseScenarioNumberInput(raw: string): number | undefined {
  const value = raw.trim();
  const plain = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
  const grouped = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d*)?(?:e[+-]?\d+)?$/i;
  if (!plain.test(value) && !grouped.test(value)) {
    return undefined;
  }
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Preserve number-input arrow keys, including alignment to the displayed step. */
export function stepScenarioNumberInput(value: number, decimalPlaces: number, direction: 1 | -1): number {
  const step = getStepFromDecimalPlaces(decimalPlaces);
  const ticks = value / step;
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(ticks)) * 2;
  const nextTick = direction > 0 ? Math.floor(ticks + tolerance) + 1 : Math.ceil(ticks - tolerance) - 1;
  return Number((nextTick * step).toFixed(Math.min(6, Math.max(0, decimalPlaces))));
}
