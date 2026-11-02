export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type ReasoningEffort = typeof REASONING_EFFORTS[number];

/** Exact provider values; false means explicitly disabled, never omitted. */
export type HarnessReasoningValue = boolean | string | number;
export function isHarnessReasoningValue(value: unknown): value is HarnessReasoningValue {
  return typeof value === "boolean" || typeof value === "string" && /^[a-z][a-z0-9_.-]{0,47}$/.test(value)
    || typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 32768;
}

export interface LocalModelReasoningCapabilities {
  parameter: "think" | "reasoning_effort";
  values: HarnessReasoningValue[];
  defaultValue?: HarnessReasoningValue | undefined;
  source: "provider";
}
/** Shared by host metadata admission and the actual local completion path. */
export function parseLocalModelReasoningCapabilities(metadata: unknown, backendId: string): LocalModelReasoningCapabilities | undefined {
  const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const meta = record(metadata), caps = record(meta.capabilities), thinking = record(meta.thinking);
  if (meta.reasoning === false || caps.reasoning === false || meta.thinking === false
    || backendId === "ollama" && Array.isArray(meta.capabilities) && meta.capabilities.includes("completion") && !meta.capabilities.includes("thinking")) {
    return { parameter: backendId === "ollama" ? "think" : "reasoning_effort", values: [false], source: "provider" };
  }
  const reasoning = record(meta.reasoning ?? caps.reasoning);
  const raw = backendId === "ollama" ? thinking.values : meta.supported_reasoning_efforts ?? reasoning.values ?? reasoning.supported_efforts;
  const values = Array.isArray(raw) ? [...new Set(raw.filter(isHarnessReasoningValue))].slice(0, 16)
    .filter(value => backendId === "ollama" ? typeof value !== "number" : typeof value === "string") : [];
  if (!values.length) return undefined;
  return { parameter: backendId === "ollama" ? "think" : "reasoning_effort", values, source: "provider", ...(values.includes(thinking.default as HarnessReasoningValue) ? { defaultValue: thinking.default as HarnessReasoningValue } : {}) };
}

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && REASONING_EFFORTS.includes(value as ReasoningEffort);
}

/** Ultra enables native delegation, outside the checkpoint Gateway contract. */
export function isCheckpointReasoningEffort(value: unknown): value is Exclude<ReasoningEffort, "ultra"> {
  return isReasoningEffort(value) && value !== "ultra";
}
