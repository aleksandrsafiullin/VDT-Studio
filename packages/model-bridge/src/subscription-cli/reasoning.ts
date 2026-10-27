export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type ReasoningEffort = typeof REASONING_EFFORTS[number];

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && REASONING_EFFORTS.includes(value as ReasoningEffort);
}

/** Ultra enables native delegation, outside the checkpoint Gateway contract. */
export function isCheckpointReasoningEffort(value: unknown): value is Exclude<ReasoningEffort, "ultra"> {
  return isReasoningEffort(value) && value !== "ultra";
}
