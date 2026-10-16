import { createHash } from "node:crypto";

export function cliSessionModelBindingId(bindingId: string, modelId: string): string {
  return `${bindingId}_model_${createHash("sha256").update(modelId).digest("hex")}`;
}

export function matchesCliSessionBinding(
  bindingId: string,
  baseBindingId: string,
  modelId?: string
): boolean {
  return bindingId === baseBindingId
    || (modelId !== undefined && bindingId === cliSessionModelBindingId(baseBindingId, modelId));
}
