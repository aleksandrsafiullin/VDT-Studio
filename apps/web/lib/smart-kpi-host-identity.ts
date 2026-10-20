import { codexSmartMetadataIdentity, readCodexSmartDefaultModel, selectSmartCodexExecutable } from "@vdt-studio/model-bridge/node";
import { resolveTrustedStorageWriteMode } from "../app/api/vdt/storage-write-adapter";

export interface SmartCodexHostIdentity { backendId: "codex_subscription"; modelId: string; requestModel: string; modelResolution: "exact" | "host_default_alias"; bindingVersion: string; credentialEpoch: string }
/** Admission is separate from hover and does no model call or state mutation. */
export async function resolveSmartCodexHostIdentity(selectedModel: string | undefined, signal: AbortSignal, env = process.env): Promise<SmartCodexHostIdentity> {
  if (!resolveTrustedStorageWriteMode()) throw Object.assign(new Error("Trusted-local identity admission is unavailable."), { code: "SUGGESTIONS_UNAVAILABLE" });
  const selection = await selectSmartCodexExecutable(env, signal);
  if (!selection?.version) throw Object.assign(new Error("Recognized selected Codex CLI is required."), { code: "SUGGESTIONS_UNAVAILABLE" });
  const configured = selectedModel && selectedModel !== "auto" ? selectedModel : await readCodexSmartDefaultModel(env);
  if (configured && (configured.length > 160 || configured.startsWith("-") || /[\x00-\x20]/.test(configured))) throw new Error("Invalid selected model.");
  return { backendId: "codex_subscription", modelId: configured ?? "host_default", requestModel: configured ?? "auto", modelResolution: configured ? "exact" : "host_default_alias",
    ...await codexSmartMetadataIdentity(env, selection.executable, selection.version) };
}
