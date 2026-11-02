import { resolveSmartHarnessIdentity, type SmartHarnessIdentity } from "@vdt-studio/model-bridge/node";
import type { ModelReasoningValue } from "@vdt-studio/ai-harness/browser";
import { createLocalRuntimeContext, resolveSmartRuntimeExecution } from "@vdt-studio/local-runner/server-runtime";
import { resolveTrustedStorageWriteMode } from "../app/api/vdt/storage-write-adapter";
export type SmartHarnessHostIdentity = SmartHarnessIdentity;
export async function resolveSmartHostIdentity(backendId: string, model: string | undefined, signal: AbortSignal, env = process.env, modelReasoning?: ModelReasoningValue): Promise<SmartHarnessIdentity> {
  if (!resolveTrustedStorageWriteMode()) throw Object.assign(new Error("Trusted-local identity admission is unavailable."), { code: "SUGGESTIONS_UNAVAILABLE" });
  if (["ollama", "lm_studio", "vllm"].includes(backendId)) {
    const result = await resolveSmartRuntimeExecution(model, createLocalRuntimeContext(), signal, 5000, backendId, modelReasoning);
    const payload = result.payload as { ok?: boolean; identity?: SmartHarnessIdentity };
    if (!payload.ok || !payload.identity) throw Object.assign(new Error("The selected local model metadata is unavailable."), { code: "SUGGESTIONS_UNAVAILABLE" });
    return payload.identity;
  }
  return resolveSmartHarnessIdentity(backendId, model, signal, env, modelReasoning);
}
