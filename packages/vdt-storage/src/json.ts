export function encodeJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

export function decodeJson<T>(value: unknown): T | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return JSON.parse(value) as T;
}

export function defined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T;
}

export function toMillis(iso: string): number {
  const value = Date.parse(iso);
  if (!Number.isFinite(value)) throw new Error(`Invalid timestamp: ${iso}`);
  return value;
}

export function toIso(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  throw new Error(`Invalid persisted timestamp: ${String(value)}`);
}
