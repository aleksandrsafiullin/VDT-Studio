const MAX_INCREMENT_DECIMAL_PLACES = 6;
const NEAR_INTEGER_EPSILON = 1e-9;

export function countDecimalPlacesFromNumber(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 0;
  }

  if (Number.isInteger(value)) {
    return 0;
  }

  if (Math.abs(value - Math.round(value)) < NEAR_INTEGER_EPSILON) {
    return 0;
  }

  const str = value.toString();
  const scientificMatch = str.match(/^(-?\d+(?:\.\d+)?)e([+-]?\d+)$/i);
  if (scientificMatch) {
    const mantissa = scientificMatch[1] ?? "";
    const exponent = Number(scientificMatch[2]);
    const mantissaDecimalPlaces = mantissa.split(".")[1]?.length ?? 0;
    return Math.min(MAX_INCREMENT_DECIMAL_PLACES, Math.max(0, mantissaDecimalPlaces - exponent));
  }

  const dotIndex = str.indexOf(".");
  if (dotIndex === -1) {
    return 0;
  }

  return Math.min(MAX_INCREMENT_DECIMAL_PLACES, str.length - dotIndex - 1);
}

export function countDecimalPlacesFromString(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "-" || trimmed === "." || trimmed === "-.") {
    return undefined;
  }

  const dotIndex = trimmed.indexOf(".");
  if (dotIndex === -1) {
    return 0;
  }

  return Math.min(MAX_INCREMENT_DECIMAL_PLACES, trimmed.length - dotIndex - 1);
}

export function getStepFromDecimalPlaces(decimalPlaces: number): number {
  if (decimalPlaces <= 0) {
    return 1;
  }

  return 10 ** -Math.min(decimalPlaces, MAX_INCREMENT_DECIMAL_PLACES);
}

/** Minimum HTML number-input step derived from `Number#toString()` decimal places. */
export function getValueIncrementStep(value: number | undefined): number {
  return getStepFromDecimalPlaces(countDecimalPlacesFromNumber(value));
}

export function formatNumber(value: number | undefined, options?: Intl.NumberFormatOptions) {
  if (value === undefined || Number.isNaN(value)) {
    return "n/a";
  }

  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 2,
    ...options
  }).format(value);
}

export function formatChange(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) {
    return "n/a";
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value)}`;
}

export function formatPercent(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) {
    return "n/a";
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value, { maximumFractionDigits: 1 })}%`;
}
