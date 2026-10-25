import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { selectCodexExecutable, type SelectedCodexExecutable } from "./executable-selection";

export const SMART_CODEX_POLICY_VERSION = "smart-codex-readonly.v1";
export const SMART_CODEX_DISABLED_FEATURES = Object.freeze(["shell_tool", "unified_exec", "apply_patch_freeform", "multi_agent", "multi_agent_v2", "apps", "plugins", "remote_plugin", "hooks", "browser_use", "browser_use_external", "in_app_browser", "computer_use", "image_generation", "code_mode", "code_mode_host", "memories", "skill_search", "skill_mcp_dependency_install", "tool_suggest", "workspace_dependencies", "goals", "request_permissions_tool"]);
export const codexSmartHome = (env: NodeJS.ProcessEnv) => env.CODEX_HOME ?? path.join(env.HOME ?? os.homedir(), ".codex");
const model = (value: string) => { if (!value || value.length > 160 || value.startsWith("-") || /[\x00-\x20]/.test(value)) throw new Error("Codex selected model is invalid."); return value; };

type Admission = { controller: AbortController; pending: Promise<SelectedCodexExecutable | null>; uncertain: boolean };
const runtime = globalThis as typeof globalThis & { __vdtSmartCodexAdmissions?: Map<string, Admission> };
const admissions = () => runtime.__vdtSmartCodexAdmissions ??= new Map();
const admissionKey = (env: NodeJS.ProcessEnv) => createHash("sha256").update(JSON.stringify([SMART_CODEX_POLICY_VERSION, env.PATH ?? "", codexSmartHome(env)])).digest("hex");
const unconfirmed = () => Object.assign(new Error("Owned Codex metadata probe cleanup remains unconfirmed."), { code: "CLEANUP_UNCONFIRMED" });

/** Host-session ownership covers settings/revalidation probes too, before any
 * scheduler identity exists. Dedup never releases an unconfirmed process. */
export async function selectSmartCodexExecutable(env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<SelectedCodexExecutable | null> {
  signal.throwIfAborted(); const entries = admissions(), key = admissionKey(env);
  let entry = entries.get(key);
  if (entry?.uncertain) throw unconfirmed();
  if (!entry) {
    if (entries.size >= 16) throw Object.assign(new Error("Metadata admission capacity reached."), { code: "PREPARATION_CAPACITY" });
    const controller = new AbortController();
    entry = { controller, uncertain: false, pending: Promise.resolve(null) }; entries.set(key, entry);
    const owned = entry;
    const timer = setTimeout(() => controller.abort(), 5_000);
    owned.pending = selectCodexExecutable({ env, signal: controller.signal, requireConfirmedCleanup: true }).catch(error => {
      if ((error as { code?: string })?.code === "CLEANUP_UNCONFIRMED") owned.uncertain = true;
      throw error;
    }).finally(() => { clearTimeout(timer); if (!owned.uncertain && entries.get(key) === owned) entries.delete(key); });
  }
  const abort = () => entry!.controller.abort(); signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
  try { const result = await entry.pending; signal.throwIfAborted(); return result; }
  finally { signal.removeEventListener("abort", abort); }
}

/** Privileged host receipt only; never exposed as model or HTTP input. */
export function confirmSmartCodexAdmissionCleanup(env: NodeJS.ProcessEnv, receipt: { terminalCleanupConfirmedByHost: true }): void {
  if (receipt.terminalCleanupConfirmedByHost === true && admissions().get(admissionKey(env))?.uncertain) admissions().delete(admissionKey(env));
}

/** Read only the bounded top-level model selection. Never parse credentials,
 * endpoints, profiles or hooks into a Smart provider, or hash config contents. */
export async function readCodexSmartDefaultModel(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  if (env.VDT_CODEX_SESSION_MODEL?.trim() && env.VDT_CODEX_SESSION_MODEL.trim() !== "auto") return model(env.VDT_CODEX_SESSION_MODEL.trim());
  let file;
  try { file = await open(path.join(codexSmartHome(env), "config.toml"), "r"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw new Error("Codex selected-default metadata is unreadable."); }
  try {
    const info = await file.stat(); if (info.size > 64 * 1024) throw new Error("Codex selected-default metadata exceeds its bound.");
    const buffer = Buffer.alloc(Number(info.size)); await file.read(buffer, 0, buffer.length, 0);
    for (const line of buffer.toString("utf8").split(/\r?\n/)) {
      if (/^\s*\[/.test(line)) break;
      if (!/^\s*model\s*=/.test(line)) continue;
      const selected = line.match(/^\s*model\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?$/)?.[1];
      if (!selected) throw new Error("Codex configured default model needs an explicit selection.");
      return model(selected.startsWith('"') ? JSON.parse(selected) : selected.slice(1, -1));
    }
    return undefined;
  } finally { await file.close(); }
}

/** Public hash uses filesystem metadata only, never credential/config bytes. */
export async function codexSmartMetadataIdentity(env: NodeJS.ProcessEnv, executable: string, version: string | null) {
  const metadata = async (name: string) => { try { const s = await stat(path.join(codexSmartHome(env), name)); return [s.dev, s.ino, s.size, s.mtimeMs]; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw new Error("Codex binding metadata is unreadable."); } };
  const hash = (value: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
  // Codex refreshes models_cache.json during ordinary execution. That catalog
  // timestamp is not a change to the selected adapter, model or credentials.
  return { bindingVersion: hash(["smart-codex-binding.v2", SMART_CODEX_POLICY_VERSION, executable, version, await metadata("config.toml")]),
    credentialEpoch: hash(["codex-host-credential-metadata.v1", await metadata("auth.json")]) };
}
