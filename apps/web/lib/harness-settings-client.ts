import { registerHarnessCatalog } from "./execution-mode-catalog";
import { resolveVdtAppMode } from "./app-mode";
import type { HarnessDefinition } from "@vdt-studio/model-bridge";

export interface HarnessSettingsResult { ok: boolean; harnesses: HarnessDefinition[]; profiles: HarnessDefinition[] }
export async function manageHarnessSettings(payload: { action?: "list" | "save" | "remove"; profile?: unknown; removeId?: string } = {}): Promise<HarnessSettingsResult> {
  const mode = resolveVdtAppMode();
  if (mode === "hosted_web") throw new Error("Local harness settings require VDT Desktop or local web.");
  let result: HarnessSettingsResult & { error?: { message?: string } };
  if (mode === "desktop") {
    const runtime = globalThis as typeof globalThis & { __TAURI__?: { core?: { invoke?: (command: string, args: unknown) => Promise<unknown> }; invoke?: (command: string, args: unknown) => Promise<unknown> } };
    const invoke = runtime.__TAURI__?.core?.invoke ?? runtime.__TAURI__?.invoke;
    if (!invoke) throw new Error("Desktop runtime is unavailable.");
    result = await invoke("ai_harness_settings", { payload }) as typeof result;
  } else {
    const response = await fetch("/api/ai/dev-runtime", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "harness_settings", ...payload }) });
    result = await response.json() as typeof result;
    if (!response.ok) throw new Error(result.error?.message ?? "Harness settings could not be saved.");
  }
  if (!result.ok || !Array.isArray(result.harnesses)) throw new Error(result.error?.message ?? "Harness catalog is unavailable.");
  registerHarnessCatalog(result.harnesses);
  return result;
}
