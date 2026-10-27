/** Provider values remain exact: Ollama may expose switches or named levels. */
export type ModelReasoningValue = boolean | string | number;
export interface ModelReasoningCapabilities {
  parameter: "think" | "reasoning_effort" | "output_config.effort" | "thinkingConfig.thinkingLevel" | "thinkingConfig.thinkingBudget";
  values: ModelReasoningValue[];
  defaultValue?: ModelReasoningValue | undefined;
  adaptiveThinking?: boolean | undefined;
  source: "provider" | "documentation";
}

export function isModelReasoningValue(value: unknown): value is ModelReasoningValue {
  return typeof value === "boolean" || (typeof value === "string" && /^[a-z][a-z0-9_.-]{0,47}$/.test(value)) || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 32768);
}

/** Stable, nonsecret identity; changing model/endpoint never reuses another setting. */
export function modelReasoningKey(providerId: string, config: Record<string, unknown> = {}): string {
  return JSON.stringify([providerId, config.backendId ?? "", config.endpoint ?? config.baseUrl ?? "", config.deployment ?? config.model ?? ""]);
}
