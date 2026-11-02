import { getHarnessDefinition } from "./profiles";
import { resolveHarnessExecutable, harnessOpaqueIdentity, harnessEnvironment, withHarnessSession, type VibeCredentialSource } from "./rpc-session";
import { selectSmartCodexExecutable, readCodexSmartDefaultModel, codexSmartMetadataIdentity, readCodexSmartReasoningValues } from "../subscription-cli/codex/smart-policy";
import { isHarnessReasoningValue, isCheckpointReasoningEffort, type HarnessReasoningValue } from "../subscription-cli/reasoning";
import { createHash } from "node:crypto";
import { claudeReasoningArgs, claudeModelSupportsThinkingOff, verifyDirectClaudeSubscription } from "../subscription-cli/claude/adapter";
import { probeOwnedCliVersion } from "../subscription-cli/codex/executable-selection";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export interface SmartHarnessIdentity {
  backendId: string; modelId: string; requestModel: string; modelResolution: "exact" | "host_default_alias"; bindingVersion: string; credentialEpoch: string;
  reasoningValues?: HarnessReasoningValue[];
}
const pinReasoning = (bindingVersion: string, value: HarnessReasoningValue | undefined) => `sha256:${createHash("sha256").update(JSON.stringify([bindingVersion, "smart-reasoning.v1", value ?? null])).digest("hex")}`;
/** Metadata only: does not start a model conversation or change CLI settings. */
export async function resolveSmartHarnessIdentity(backendId: string, model: string | undefined, signal: AbortSignal, env: NodeJS.ProcessEnv = process.env, modelReasoning?: HarnessReasoningValue): Promise<SmartHarnessIdentity> {
  const h = getHarnessDefinition(backendId, env);
  if (!h?.capabilities.structuredCompletion) throw Object.assign(new Error("Selected harness cannot prepare structured suggestions."), { code: "SUGGESTIONS_UNAVAILABLE" });
  if (model && (model.length > 256 || model.startsWith("-") || /[\x00-\x20]/.test(model))) throw Object.assign(new Error("Invalid selected model."), { code: "INVALID_MODEL" });
  if (modelReasoning !== undefined && !isHarnessReasoningValue(modelReasoning)) throw Object.assign(new Error("Invalid selected reasoning value."), { code: "INVALID_REASONING" });
  signal.throwIfAborted();
  if (backendId === "codex_subscription") {
    const selection = await selectSmartCodexExecutable(env, signal);
    if (!selection?.version) throw Object.assign(new Error("A recognized selected Codex CLI is required."), { code: "SUGGESTIONS_UNAVAILABLE" });
    const configured = model && model !== "auto" ? model : await readCodexSmartDefaultModel(env);
    signal.throwIfAborted();
    if (modelReasoning !== undefined && modelReasoning !== false && !isCheckpointReasoningEffort(modelReasoning)) throw Object.assign(new Error("The selected Codex reasoning level is unsupported."), { code: "REASONING_UNSUPPORTED" });
    const reasoningValues = await readCodexSmartReasoningValues(env, configured);
    if (modelReasoning !== undefined && !reasoningValues.includes(modelReasoning === "none" ? false : modelReasoning)) throw Object.assign(new Error("The selected model does not advertise this reasoning setting. Refresh its model catalog or choose Provider default."), { code: "REASONING_UNSUPPORTED" });
    const identity = await codexSmartMetadataIdentity(env, selection.executable, selection.version);
    return { backendId, modelId: configured ?? "host_default", requestModel: configured ?? "auto", modelResolution: configured ? "exact" : "host_default_alias", ...identity, bindingVersion: pinReasoning(identity.bindingVersion, modelReasoning), reasoningValues };
  }
  const executable = await resolveHarnessExecutable(h, env);
  const js = /\.[cm]?js$/.test(executable);
  const versionArgs = [...(h.custom ? h.args : []), "--version"];
  const environment = harnessEnvironment(h, env);
  const cwd = await mkdtemp(path.join(tmpdir(), "vdt-harness-metadata-"));
  let retained = false, version: string | undefined, directClaudeSubscriptionVerified = false;
  try {
    const result = await probeOwnedCliVersion(js ? process.execPath : executable, cwd, environment, { signal, requireConfirmedCleanup: true }, js ? [executable, ...versionArgs] : versionArgs, 4000);
    version = `${result.stdout}\n${result.stderr}`.trim().split(/\r?\n/)[0];
    if (backendId === "claude_subscription") directClaudeSubscriptionVerified = await verifyDirectClaudeSubscription(executable, cwd, environment, signal);
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "CLEANUP_UNCONFIRMED") { retained = true; await writeFile(path.join(cwd, "cleanup-status.json"), JSON.stringify({ harnessId: h.id, status: "cleanup_unconfirmed" }), { mode: 0o600 }); }
    throw Object.assign(new Error(code === "CLEANUP_UNCONFIRMED" ? "Harness metadata process cleanup is unconfirmed." : signal.aborted ? "Harness metadata probe cancelled." : "Harness version could not be verified."), { code: code === "CLEANUP_UNCONFIRMED" ? code : signal.aborted ? "CANCELLED" : "SUGGESTIONS_UNAVAILABLE", ...(retained ? { retainedDirectory: cwd } : {}) });
  } finally { if (!retained) await rm(cwd, { recursive: true, force: true }); }
  if (!version || version.length > 256) throw Object.assign(new Error("Harness version is unavailable."), { code: "SUGGESTIONS_UNAVAILABLE" });
  const configured = model && model !== "auto" && model !== "host_default" ? model : h.defaultModel && h.defaultModel !== "auto" && h.defaultModel !== "host_default" ? h.defaultModel : undefined;
  let reasoningValues: HarnessReasoningValue[] = [];
  let vibeCredentialSource: VibeCredentialSource | undefined;
  if (h.transport !== "native") {
    reasoningValues = await withHarnessSession(h, signal, async session => {
      await session.selectModel(configured, signal);
      const values = session.reasoningValues();
      await session.selectReasoning(modelReasoning, signal);
      vibeCredentialSource = await session.credentialSource(signal);
      return values;
    }, { env, executable, maxBytes: 64 * 1024 });
  } else if (backendId === "cursor_subscription" && modelReasoning !== undefined) {
    throw Object.assign(new Error("This Cursor CLI does not expose a reviewed independent reasoning control. Use Provider default."), { code: "REASONING_UNSUPPORTED" });
  } else if (backendId === "claude_subscription") {
    if (directClaudeSubscriptionVerified && claudeModelSupportsThinkingOff(configured)) reasoningValues = [false];
    claudeReasoningArgs(modelReasoning, configured, directClaudeSubscriptionVerified);
  }
  const identity = harnessOpaqueIdentity(h, executable, version, env, { ...(vibeCredentialSource ? { vibeCredentialSource } : {}) });
  return { backendId, modelId: configured ?? "host_default", requestModel: configured ?? "auto", modelResolution: configured ? "exact" : "host_default_alias", ...identity, bindingVersion: pinReasoning(identity.bindingVersion, modelReasoning), reasoningValues };
}
