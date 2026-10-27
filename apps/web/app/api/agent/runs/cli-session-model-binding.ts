import { createHash } from "node:crypto";
import type { ReasoningEffort } from "@vdt-studio/model-bridge";

export function cliSessionModelBindingId(bindingId: string, modelId: string, reasoningEffort?: ReasoningEffort): string {
  const identity = reasoningEffort === undefined ? modelId : JSON.stringify([modelId, reasoningEffort]);
  return `${bindingId}_model_${createHash("sha256").update(identity).digest("hex")}`;
}

export function matchesCliSessionBinding(
  bindingId: string,
  baseBindingId: string,
  modelId?: string,
  reasoningEffort?: ReasoningEffort
): boolean {
  return (reasoningEffort === undefined && bindingId === baseBindingId)
    || (modelId !== undefined && bindingId === cliSessionModelBindingId(baseBindingId, modelId, reasoningEffort));
}
