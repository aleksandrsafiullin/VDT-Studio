import type { VdtWarning } from "./types";

export function nowIso() {
  return new Date().toISOString();
}

function stableIdPart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

export function warning(input: Omit<VdtWarning, "id"> & { id?: string }): VdtWarning {
  const stableId =
    input.id ??
    [
      "warning",
      input.severity,
      input.type,
      input.nodeId ?? input.edgeId ?? "global",
      stableIdPart(input.message)
    ].join("_");

  return {
    id: stableId,
    severity: input.severity,
    type: input.type,
    message: input.message,
    ...(input.nodeId ? { nodeId: input.nodeId } : {}),
    ...(input.edgeId ? { edgeId: input.edgeId } : {})
  };
}

export function percentageChange(baseline?: number, scenario?: number) {
  if (baseline === undefined || scenario === undefined || baseline === 0) {
    return undefined;
  }

  return ((scenario - baseline) / Math.abs(baseline)) * 100;
}

export function cloneProject<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
