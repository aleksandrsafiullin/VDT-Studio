import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { probeOwnedCliOutput } from "../codex/executable-selection";
import { isClaudeReasoningEffort } from "../reasoning";
import type { SubscriptionCliModelOption, SubscriptionCliModelProbeOptions } from "../types";

const REQUEST_ID = "vdt-claude-models";
const INITIALIZE = JSON.stringify({
  type: "control_request",
  request_id: REQUEST_ID,
  request: { subtype: "initialize" }
}) + "\n";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function initializationReply(stdout: string): Record<string, unknown> | undefined {
  const lines = stdout.split("\n");
  lines.pop(); // A partially received line cannot be a reply yet.
  for (const line of lines) {
    try {
      const event = record(JSON.parse(line));
      const reply = record(event?.response);
      if (event?.type === "control_response" && reply?.request_id === REQUEST_ID) return reply;
    } catch {
      // Startup diagnostics may precede the structured reply.
    }
  }
  return undefined;
}

function isModelId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._:/\[\]+-]{0,159}$/i.test(value);
}

function modelOptions(reply: Record<string, unknown> | undefined): readonly SubscriptionCliModelOption[] {
  const models = reply?.subtype === "success" ? record(reply.response)?.models : undefined;
  if (!Array.isArray(models)) return [];
  const unique = new Map<string, SubscriptionCliModelOption>();
  for (const entry of models) {
    const model = record(entry);
    const value = model?.value;
    if (!isModelId(value) || value === "default" || value === "auto") continue;
    const resolved = model?.resolvedModel;
    const id = isModelId(resolved) && resolved !== "default" && resolved !== "auto" ? resolved : value;
    const advertised = model?.supportedEffortLevels;
    const efforts = model?.supportsEffort !== false && Array.isArray(advertised)
      ? [...new Set(advertised.filter(isClaudeReasoningEffort))]
      : [];
    if (unique.has(id) && (!efforts.length || unique.get(id)?.reasoningEfforts)) continue;
    unique.set(id, { id, ...(efforts.length ? { reasoningEfforts: efforts } : {}) });
    if (unique.size === 100) break;
  }
  return [...unique.values()];
}

export async function listClaudeModelOptions(
  executable: string,
  options: SubscriptionCliModelProbeOptions = {}
): Promise<readonly SubscriptionCliModelOption[]> {
  if (!path.isAbsolute(executable)) return [];
  options.signal?.throwIfAborted();
  const workspace = await mkdtemp(path.join(tmpdir(), "vdt-claude-models-"));
  let cleanupConfirmed = true;
  try {
    const env = { ...process.env, CLAUDE_CODE_ENTRYPOINT: "sdk-ts" };
    const args = [
      "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
      "--await-initialize", "--no-session-persistence", "--tools", "",
      "--permission-mode", "dontAsk", "--no-chrome", "--disable-slash-commands",
      "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
      "--setting-sources", "", "--settings", '{"disableAllHooks":true}'
    ];
    const isJavaScript = /\.[cm]?js$/i.test(executable);
    const { stdout } = await probeOwnedCliOutput(
      isJavaScript ? process.execPath : executable, workspace, env,
      { ...options.signal && { signal: options.signal }, requireConfirmedCleanup: true },
      isJavaScript ? [executable, ...args] : args, 10_000,
      { input: INITIALIZE, responseComplete: (output) => initializationReply(output) !== undefined }
    );
    return modelOptions(initializationReply(stdout));
  } catch (error) {
    cleanupConfirmed = (error as { code?: string } | undefined)?.code !== "CLEANUP_UNCONFIRMED";
    throw error;
  } finally {
    if (cleanupConfirmed) await rm(workspace, { recursive: true, force: true });
  }
}


export async function listClaudeModels(executable: string, options?: SubscriptionCliModelProbeOptions): Promise<readonly string[]> {
  return (await listClaudeModelOptions(executable, options)).map(({ id }) => id);
}
