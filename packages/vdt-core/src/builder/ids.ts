export function stableSnakeId(input: string, fallback = "node"): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const safe = normalized || fallback;
  return /^[a-z]/.test(safe) ? safe : `${fallback}_${safe}`;
}

export function uniqueId(base: string, existing: ReadonlySet<string>): string {
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}_${suffix}`)) {
    suffix += 1;
  }
  return `${base}_${suffix}`;
}
