import type { VdtStudioState } from "@/components/vdt/vdt-store";
import type { VdtAppMode } from "./app-mode";
import { resolveExecutionSettings } from "./execution-mode-resolver";
import { resolveSmartKpiSettings } from "./smart-kpi-settings";
import { readSupportErrors, safeSupportCode } from "./support-error-events";
export { supportGuidance } from "./support-error-events";

export const SUPPORT_GUIDE_URL = "https://github.com/aleksandrsafiullin/VDT-Studio/blob/main/docs/desktop-installation.md";
export const SUPPORT_REPORT_URL = "https://github.com/aleksandrsafiullin/VDT-Studio/issues/new/choose";

export interface SupportBuildInfo {
  version: string | null;
  commit: string | null;
  dirty: boolean | null;
  builtAt: string | null;
  platform: "darwin" | "win32" | "linux" | "unknown";
  architecture: "arm64" | "x64" | "ia32" | "unknown";
  osRelease: string | null;
  nodeVersion: string | null;
}

const RUN_STATUSES = ["queued", "running", "needs_user_input", "waiting_approval", "recovery_required", "succeeded", "failed", "cancelled"];
const CONNECTION_STATUSES = ["idle", "connecting", "connected", "disconnected", "error"];
const SAFE_BACKENDS = new Set([
  "mock", "openai_compatible", "anthropic", "azure_openai", "gemini", "ollama", "lm_studio", "vllm",
  ...["codex", "cursor", "claude", "copilot", "opencode", "hermes", "kiro", "kimi", "vibe", "kilo", "qwen", "grok-build", "pi"].map(id => `${id}_subscription`)
]);
const SAFE_REASONING = new Set(["none", "off", "on", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "auto", "default", "adaptive", "enabled", "disabled"]);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function sanitizeSupportBuildInfo(value: unknown): SupportBuildInfo {
  const info = object(value);
  return {
    version: typeof info.version === "string" && /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]{1,40})?$/.test(info.version) ? info.version : null,
    commit: typeof info.commit === "string" && /^[a-f0-9]{40}$/i.test(info.commit) ? info.commit : null,
    dirty: typeof info.dirty === "boolean" ? info.dirty : null,
    builtAt: timestamp(info.builtAt),
    platform: info.platform === "darwin" || info.platform === "win32" || info.platform === "linux" ? info.platform : "unknown",
    architecture: info.architecture === "arm64" || info.architecture === "x64" || info.architecture === "ia32" ? info.architecture : "unknown",
    osRelease: typeof info.osRelease === "string" && /^\d+(?:\.\d+){1,3}$/.test(info.osRelease) && info.osRelease.length <= 40 ? info.osRelease : null,
    nodeVersion: typeof info.nodeVersion === "string" && /^v?\d+\.\d+\.\d+$/.test(info.nodeVersion) ? info.nodeVersion : null
  };
}

/** These values are replaced by Next at build time, not guessed from the user's machine. */
export function compiledSupportBuildInfo(): SupportBuildInfo {
  return sanitizeSupportBuildInfo({
    version: process.env.NEXT_PUBLIC_VDT_BUILD_VERSION,
    commit: process.env.NEXT_PUBLIC_VDT_BUILD_COMMIT,
    dirty: process.env.NEXT_PUBLIC_VDT_BUILD_DIRTY === "true" ? true : process.env.NEXT_PUBLIC_VDT_BUILD_DIRTY === "false" ? false : null,
    builtAt: process.env.NEXT_PUBLIC_VDT_BUILD_TIME
  });
}

type DiagnosticSource = Pick<VdtStudioState,
  "executionSettings" | "providerConfig" | "runnerPairingToken" | "agentRun" | "agentEvents" |
  "agentConnectionStatus" | "agentError" | "aiError" | "aiActionError" | "workspace" |
  "providerTestStatus" | "pendingIncomingKpiRestart"
>;

function knownSecrets(source: DiagnosticSource): string[] {
  // Only inspect explicitly credential-bearing fields. Never recursively collect
  // or stringify the store, vault, provider configuration or project content.
  const config = object(source.providerConfig);
  return [source.executionSettings.apiKey, source.executionSettings.localApiKey,
    source.runnerPairingToken, config.apiKey, config.openAiApiKey, config.anthropicApiKey,
    config.azureApiKey, config.geminiApiKey, config.runnerToken, config.localApiKey]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

function modelId(value: unknown, secrets: readonly string[]): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 160 ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9_.:-]*)?$/.test(value) ||
      /(?:^|[/:])(?:sk[-_]|rk[-_]|gh[pousr]_|github_pat_|bearer|token|password|secret|api[-_]?key|xox[baprs]-|AIza[a-z0-9_-]{35}$|(?:AKIA|ASIA)[a-z0-9]{16}$)/i.test(value) ||
      /(?:\.{2}|^[a-zA-Z]:)/.test(value) || secrets.some(secret => value.includes(secret))) return "omitted";
  return value;
}

function reasoning(value: unknown): boolean | number | string | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 32768) return value;
  return typeof value === "string" && SAFE_REASONING.has(value) ? value : null;
}

function execution(settings: DiagnosticSource["executionSettings"], secrets: readonly string[] | null) {
  const resolved = resolveExecutionSettings(settings);
  const config = resolved.providerConfig ?? {};
  const backend = resolved.providerId === "local_runner" ? config.backendId : resolved.providerId;
  return {
    backend: typeof backend === "string" && SAFE_BACKENDS.has(backend) ? backend : "custom_or_unconfigured",
    model: secrets ? modelId(config.model, secrets) : "omitted",
    reasoning: reasoning(config.modelReasoning)
  };
}

function opaqueId(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

export function createSupportReport(source: DiagnosticSource, build: SupportBuildInfo, appMode: VdtAppMode, now = new Date(), options: { includeModelNames?: boolean } = {}) {
  const run = source.agentRun;
  const includeModelNames = options.includeModelNames === true;
  const secrets = includeModelNames ? knownSecrets(source) : null;
  const recentErrors: Array<{ code: string; at: string | null }> = [];
  function addError(code: unknown, at: unknown) {
    const entry = { code: safeSupportCode(code), at: timestamp(at) };
    if (!recentErrors.some(existing => existing.code === entry.code && existing.at === entry.at)) recentErrors.push(entry);
  }
  for (const event of readSupportErrors()) addError(event.code, event.at);
  // Bound work as well as output; event payloads and messages are never traversed.
  for (const event of source.agentEvents.slice(-40)) {
    if (event.type === "error") addError(event.metadata?.code ?? event.metadata?.errorCode, event.timestamp);
  }
  if (run?.error) addError(run.error.code, run.updatedAt);
  if (run?.retryableError) addError(run.retryableError.code, run.retryableError.createdAt);
  if (source.agentError || source.aiError || source.aiActionError) addError("AGENT_REQUEST_FAILED", null);
  if (source.workspace.error) addError("STORAGE_REQUEST_FAILED", null);
  if (source.providerTestStatus?.kind === "error") addError("PROVIDER_CHECK_FAILED", null);
  const head = source.workspace.draftRevisionBase?.expectedHead;
  const generation = head?.commitGeneration;
  return {
    schemaVersion: "vdt_support_report.v1",
    generatedAt: now.toISOString(),
    scope: "Current workspace, selected run and recent session error codes; no persisted diagnostic history",
    build: sanitizeSupportBuildInfo(build),
    application: {
      mode: appMode === "desktop" || appMode === "development_web" ? appMode : "hosted_web",
      localExecutionAvailable: appMode !== "hosted_web",
      connectionStatus: CONNECTION_STATUSES.includes(source.agentConnectionStatus) ? source.agentConnectionStatus : "unknown",
      cancellationPending: Boolean(source.pendingIncomingKpiRestart)
    },
    modelNames: includeModelNames ? "explicitly_included_when_eligible" : "omitted",
    execution: { chat: execution(source.executionSettings, secrets), suggestedKpi: execution(resolveSmartKpiSettings(source.executionSettings), secrets) },
    run: run ? {
      id: opaqueId(run.runId),
      status: RUN_STATUSES.includes(run.status) ? run.status : "unknown",
      createdAt: timestamp(run.createdAt), updatedAt: timestamp(run.updatedAt), completedAt: timestamp(run.completedAt)
    } : null,
    revision: {
      id: opaqueId(head?.activeRevisionId),
      generation: typeof generation === "number" && Number.isSafeInteger(generation) && generation >= 0 ? generation : null,
      savedAt: timestamp(source.workspace.lastSavedAt)
    },
    recentErrors: recentErrors.slice(-20),
    excluded: ["credentials", "configured URLs and endpoints", "configured commands and paths", "prompts and messages", "project records", "source files", "raw logs"]
  };
}

export type SupportReport = ReturnType<typeof createSupportReport>;

export function supportReportFilename(report: SupportReport): string {
  return `vdt-diagnostics-${report.generatedAt.replace(/[:.]/g, "-")}.json`;
}
