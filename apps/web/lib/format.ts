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
