import { resolveEffectiveByokUrls, resolveByokPreset } from "./byok-validation";
import {
  applyGatewayPreset,
  applyLocalRunnerPreset,
  DEFAULT_ANTHROPIC_FALLBACK_MODEL,
  DEFAULT_EXECUTION_SETTINGS,
  DEFAULT_OPENAI_COMPATIBLE_FALLBACK_MODEL,
  getCliCatalogEntry,
  getLocalRunnerPreset,
  type CliAgentId,
  type ExecutionSettings,
  type GatewayPresetId,
  type LocalRunnerPresetId
} from "./execution-mode-catalog";

export type ResolvedProviderId =
  | "mock"
  | "local_cli"
  | "openai_compatible"
  | "anthropic"
  | "azure_openai"
  | "gemini"
  | "local_runner";

export interface LegacyProviderState {
  providerId: ResolvedProviderId;
  providerConfig: LegacyProviderConfig;
}

export interface LegacyProviderConfig {
  openAiBaseUrl?: string | undefined;
  openAiModel?: string | undefined;
  anthropicBaseUrl?: string | undefined;
  anthropicModel?: string | undefined;
  geminiBaseUrl?: string | undefined;
  geminiModel?: string | undefined;
  endpoint?: string | undefined;
  deployment?: string | undefined;
  apiVersion?: string | undefined;
  anthropicVersion?: string | undefined;
  localRunnerPresetId?: LocalRunnerPresetId | undefined;
  runnerUrl?: string | undefined;
  runnerProviderId?: "local_http_stub" | "cli_stub" | undefined;
  localBaseUrl?: string | undefined;
  localModel?: string | undefined;
  localApiKey?: string | undefined;
  command?: string | undefined;
  argsText?: string | undefined;
  timeoutSec?: number | undefined;
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  model?: string | undefined;
}

export interface ResolvedExecutionProvider {
  providerId: ResolvedProviderId;
  providerConfig?: Record<string, unknown> | undefined;
}

function inferGatewayPresetId(providerId: ResolvedProviderId, config: LegacyProviderConfig): GatewayPresetId {
  if (providerId === "mock") {
    return "mock";
  }

  if (providerId === "openai_compatible") {
    const baseUrl = config.openAiBaseUrl ?? config.baseUrl ?? "";
    if (baseUrl.includes("aihubmix.com")) {
      return "aihubmix";
    }
    if (baseUrl.includes("senseaudio")) {
      return "senseaudio";
    }
    if (baseUrl.includes("ollama.com")) {
      return "ollama-cloud";
    }
    const normalized = baseUrl.toLowerCase();
    if (normalized.includes("coding.dashscope") || normalized.includes("coding-intl.dashscope")) {
      return "alibaba-coding-plan";
    }
    return "openai-default";
  }

  if (providerId === "anthropic") {
    const baseUrl = config.anthropicBaseUrl ?? config.baseUrl ?? "";
    if (baseUrl.includes("deepseek.com")) {
      return "deepseek-anthropic";
    }
    if (baseUrl.includes("minimax")) {
      return "minimax-anthropic";
    }
    if (baseUrl.includes("xiaomimimo.com")) {
      return "mimo-anthropic";
    }
    return baseUrl === "https://api.anthropic.com" ? "anthropic-claude" : "custom";
  }

  if (providerId === "azure_openai") {
    return "azure-default";
  }

  if (providerId === "gemini") {
    return "gemini-default";
  }

  return "custom";
}

export function migrateLegacyProviderToExecutionSettings(
  providerId: ResolvedProviderId,
  providerConfig: LegacyProviderConfig = {}
): ExecutionSettings {
  if (providerId === "local_cli") {
    const presetId = providerConfig.localRunnerPresetId ?? "custom_cli_json";
    const migrated = applyLocalRunnerPreset(
      {
        selectedCliAgentId: "claude",
        runnerUrl: providerConfig.runnerUrl ?? "http://127.0.0.1:8765",
        timeoutSec: providerConfig.timeoutSec ?? 60,
        memoryModelMode: "same_as_chat",
        cliModelSelection: { source: "agent_default" }
      },
      presetId
    );
    return {
      ...migrated,
      command: providerConfig.command ?? migrated.command,
      argsText: providerConfig.argsText ?? migrated.argsText
    };
  }

  if (providerId === "local_runner") {
    const presetId = providerConfig.localRunnerPresetId ?? "ollama_openai";
    return applyLocalRunnerPreset(
      {
        selectedCliAgentId: "claude",
        runnerUrl: providerConfig.runnerUrl ?? "http://127.0.0.1:8765",
        timeoutSec: providerConfig.timeoutSec ?? 60,
        memoryModelMode: "same_as_chat",
        cliModelSelection: { source: "agent_default" },
        localApiKey: providerConfig.localApiKey,
        command: providerConfig.command,
        argsText: providerConfig.argsText
      },
      presetId
    );
  }

  const gatewayPresetId = inferGatewayPresetId(providerId, providerConfig);
  const migrated = applyGatewayPreset(
    {
      memoryModelMode: "same_as_chat",
      cliModelSelection: { source: "agent_default" },
      apiKey: providerConfig.apiKey,
      anthropicVersion: providerConfig.anthropicVersion,
      apiVersion: providerConfig.apiVersion,
      endpoint: providerConfig.endpoint,
      deployment: providerConfig.deployment
    },
    gatewayPresetId
  );

  if (providerId === "openai_compatible") {
    return {
      ...migrated,
      baseUrl: providerConfig.openAiBaseUrl ?? providerConfig.baseUrl ?? migrated.baseUrl,
      model: providerConfig.openAiModel ?? providerConfig.model ?? migrated.model
    };
  }

  if (providerId === "anthropic") {
    return {
      ...migrated,
      baseUrl: providerConfig.anthropicBaseUrl ?? providerConfig.baseUrl ?? migrated.baseUrl,
      model: providerConfig.anthropicModel ?? providerConfig.model ?? migrated.model,
      anthropicVersion: providerConfig.anthropicVersion ?? migrated.anthropicVersion
    };
  }

  if (providerId === "azure_openai") {
    return {
      ...migrated,
      endpoint: providerConfig.endpoint ?? migrated.endpoint,
      deployment: providerConfig.deployment ?? providerConfig.model ?? migrated.deployment,
      model: providerConfig.deployment ?? providerConfig.model ?? migrated.model,
      apiVersion: providerConfig.apiVersion ?? migrated.apiVersion
    };
  }

  if (providerId === "gemini") {
    return {
      ...migrated,
      baseUrl: providerConfig.geminiBaseUrl ?? providerConfig.baseUrl ?? migrated.baseUrl,
      model: providerConfig.geminiModel ?? providerConfig.model ?? migrated.model
    };
  }

  return migrated;
}

function isStaleDefaultMockExecution(
  settings: ExecutionSettings,
  providerId: ResolvedProviderId | undefined
): boolean {
  return (
    settings.useMockProvider === true &&
    settings.gatewayPresetId === "mock" &&
    settings.executionMode === "byok" &&
    providerId !== undefined &&
    providerId !== "mock"
  );
}

function isUntouchedDefaultExecution(settings: ExecutionSettings): boolean {
  return (Object.keys(DEFAULT_EXECUTION_SETTINGS) as Array<keyof ExecutionSettings>).every((key) =>
    JSON.stringify(settings[key]) === JSON.stringify(DEFAULT_EXECUTION_SETTINGS[key])
  );
}

export function reconcilePersistedExecutionSettings(
  providerId: ResolvedProviderId | undefined,
  providerConfig: LegacyProviderConfig | undefined,
  executionSettings: Partial<ExecutionSettings> | undefined
): ExecutionSettings {
  const legacyProviderId = providerId ?? "mock";
  const legacyConfig = providerConfig ?? {};
  const fromLegacy = migrateLegacyProviderToExecutionSettings(legacyProviderId, legacyConfig);

  if (!executionSettings) {
    return fromLegacy;
  }

  const merged = { ...DEFAULT_EXECUTION_SETTINGS, ...executionSettings };

  if (isStaleDefaultMockExecution(merged, providerId)) {
    return fromLegacy;
  }

  if (providerId !== undefined && providerId !== "mock" && isUntouchedDefaultExecution(merged)) {
    return fromLegacy;
  }

  if (merged.useMockProvider === true || merged.gatewayPresetId === "mock") {
    if (providerId && providerId !== "mock") {
      return fromLegacy;
    }
    return applyGatewayPreset(merged, "mock");
  }

  return merged;
}

export function syncLegacyProviderFromExecutionSettings(
  executionSettings: ExecutionSettings,
  existingConfig: LegacyProviderConfig = {}
): LegacyProviderState {
  const resolved = resolveExecutionSettings(executionSettings);
  const providerId = resolved.providerId;
  const resolvedConfig = resolved.providerConfig ?? {};

  const preserveApiKey = executionSettings.apiKey ?? existingConfig.apiKey;
  const preserveLocalApiKey = executionSettings.localApiKey ?? existingConfig.localApiKey;

  if (providerId === "mock") {
    return { providerId, providerConfig: { ...existingConfig } };
  }

  if (providerId === "local_runner") {
    return {
      providerId,
      providerConfig: {
        ...existingConfig,
        localRunnerPresetId: executionSettings.localRunnerPresetId ?? existingConfig.localRunnerPresetId,
        runnerUrl: executionSettings.runnerUrl ?? existingConfig.runnerUrl,
        runnerProviderId:
          executionSettings.runnerProviderId ??
          (resolvedConfig.runnerProviderId as LegacyProviderConfig["runnerProviderId"]) ??
          existingConfig.runnerProviderId,
        localBaseUrl:
          executionSettings.localBaseUrl ??
          (resolvedConfig.baseUrl as string | undefined) ??
          existingConfig.localBaseUrl,
        localModel:
          executionSettings.localModel ??
          (resolvedConfig.model as string | undefined) ??
          existingConfig.localModel,
        command:
          executionSettings.command ??
          (resolvedConfig.command as string | undefined) ??
          existingConfig.command,
        argsText:
          executionSettings.argsText ??
          (resolvedConfig.argsText as string | undefined) ??
          existingConfig.argsText,
        timeoutSec: executionSettings.timeoutSec ?? existingConfig.timeoutSec,
        localApiKey: preserveLocalApiKey
      }
    };
  }

  if (providerId === "local_cli") {
    return {
      providerId: "local_runner",
      providerConfig: {
        ...existingConfig,
        localRunnerPresetId: executionSettings.localRunnerPresetId ?? "custom_cli_json",
        runnerUrl: executionSettings.runnerUrl ?? existingConfig.runnerUrl,
        runnerProviderId: "cli_stub",
        command: executionSettings.command ?? existingConfig.command,
        argsText: executionSettings.argsText ?? existingConfig.argsText,
        timeoutSec: executionSettings.timeoutSec ?? existingConfig.timeoutSec
      }
    };
  }

  if (providerId === "openai_compatible") {
    return {
      providerId,
      providerConfig: {
        ...existingConfig,
        openAiBaseUrl:
          (resolvedConfig.baseUrl as string | undefined) ??
          executionSettings.baseUrl ??
          existingConfig.openAiBaseUrl,
        openAiModel:
          (resolvedConfig.model as string | undefined) ??
          executionSettings.model ??
          existingConfig.openAiModel,
        apiKey: preserveApiKey
      }
    };
  }

  if (providerId === "anthropic") {
    return {
      providerId,
      providerConfig: {
        ...existingConfig,
        anthropicBaseUrl:
          (resolvedConfig.baseUrl as string | undefined) ??
          executionSettings.baseUrl ??
          existingConfig.anthropicBaseUrl,
        anthropicModel:
          (resolvedConfig.model as string | undefined) ??
          executionSettings.model ??
          existingConfig.anthropicModel,
        anthropicVersion:
          (resolvedConfig.anthropicVersion as string | undefined) ??
          executionSettings.anthropicVersion ??
          existingConfig.anthropicVersion,
        apiKey: preserveApiKey
      }
    };
  }

  if (providerId === "azure_openai") {
    return {
      providerId,
      providerConfig: {
        ...existingConfig,
        endpoint:
          (resolvedConfig.endpoint as string | undefined) ??
          executionSettings.endpoint ??
          existingConfig.endpoint,
        deployment:
          (resolvedConfig.deployment as string | undefined) ??
          executionSettings.deployment ??
          existingConfig.deployment,
        apiVersion:
          (resolvedConfig.apiVersion as string | undefined) ??
          executionSettings.apiVersion ??
          existingConfig.apiVersion,
        apiKey: preserveApiKey
      }
    };
  }

  if (providerId === "gemini") {
    return {
      providerId,
      providerConfig: {
        ...existingConfig,
        geminiBaseUrl:
          (resolvedConfig.baseUrl as string | undefined) ??
          executionSettings.baseUrl ??
          existingConfig.geminiBaseUrl,
        geminiModel:
          (resolvedConfig.model as string | undefined) ??
          executionSettings.model ??
          existingConfig.geminiModel,
        apiKey: preserveApiKey
      }
    };
  }

  return { providerId, providerConfig: { ...existingConfig } };
}

export function migratePersistedStateToV2(persistedState: unknown): unknown {
  if (!persistedState || typeof persistedState !== "object" || Array.isArray(persistedState)) {
    return persistedState;
  }

  const state = { ...(persistedState as Record<string, unknown>) };
  const providerId = state.providerId as ResolvedProviderId | undefined;
  const providerConfig = (state.providerConfig as LegacyProviderConfig | undefined) ?? {};
  const executionSettings = state.executionSettings as Partial<ExecutionSettings> | undefined;

  const reconciled = reconcilePersistedExecutionSettings(providerId, providerConfig, executionSettings);
  const synced = syncLegacyProviderFromExecutionSettings(reconciled, providerConfig);

  state.executionSettings = reconciled;
  state.providerId = synced.providerId;
  state.providerConfig = synced.providerConfig;

  return state;
}

export interface CliInstallationSnapshot {
  id: CliAgentId;
  installed: boolean;
}

export function validateExecutionForGenerate(
  settings: ExecutionSettings,
  cliDetectionAgents?: readonly CliInstallationSnapshot[]
): string | undefined {
  if (settings.executionMode !== "local_cli") {
    return undefined;
  }

  const presetId = settings.localRunnerPresetId ?? "ollama_openai";
  const preset = getLocalRunnerPreset(presetId);
  const runnerProviderId = settings.runnerProviderId ?? preset.runnerProviderId;

  if (runnerProviderId !== "cli_stub" || !settings.selectedCliAgentId) {
    return undefined;
  }

  if (preset.runnerProviderId === "local_http_stub") {
    return undefined;
  }

  // Detection unknown until the Local CLI tab runs a scan — do not block generation.
  if (cliDetectionAgents === undefined) {
    return undefined;
  }

  const detection = cliDetectionAgents.find((agent) => agent.id === settings.selectedCliAgentId);
  if (detection?.installed === false) {
    const agentName = getCliCatalogEntry(settings.selectedCliAgentId).displayName;
    return `${agentName} is not installed. Install it from Execution mode settings or switch to a local HTTP preset.`;
  }

  return undefined;
}

function resolveLocalCli(settings: ExecutionSettings): ResolvedExecutionProvider {
  const presetId = settings.localRunnerPresetId ?? "ollama_openai";
  const preset = getLocalRunnerPreset(presetId);
  let runnerProviderId = settings.runnerProviderId ?? preset.runnerProviderId;

  if (runnerProviderId === "cli_stub" && preset.runnerProviderId === "local_http_stub") {
    runnerProviderId = "local_http_stub";
  }

  if (runnerProviderId === "cli_stub") {
    const backendByAgent: Record<CliAgentId, string> = {
      "cursor-agent": "cursor_subscription",
      codex: "codex_subscription",
      claude: "claude_subscription",
      gemini: "gemini_subscription",
      copilot: "copilot_subscription"
    };
    return {
      providerId: "local_runner",
      providerConfig: {
        runnerUrl: settings.runnerUrl ?? "http://127.0.0.1:8765",
        backendId: settings.selectedCliAgentId ? backendByAgent[settings.selectedCliAgentId] : "",
        model:
          settings.cliModelSelection?.source === "custom"
            ? settings.cliModelSelection.customModel
            : undefined,
        timeoutMs: (settings.timeoutSec ?? 60) * 1_000
      }
    };
  }

  const providerConfig: Record<string, unknown> = {
    runnerUrl: settings.runnerUrl ?? "http://127.0.0.1:8765",
    backendId: preset.modelBackendId ?? "ollama",
    model: settings.localModel ?? preset.model ?? "qwen3",
    timeoutMs: (settings.timeoutSec ?? 60) * 1_000
  };

  return {
    providerId: "local_runner",
    providerConfig
  };
}

function resolveByok(settings: ExecutionSettings): ResolvedExecutionProvider {
  if (settings.useMockProvider || settings.gatewayPresetId === "mock") {
    return { providerId: "mock" };
  }

  const preset = resolveByokPreset(settings);
  const protocol = settings.byokProtocol ?? preset.protocol;
  const { baseUrl: effectiveBaseUrl, endpoint: effectiveEndpoint } = resolveEffectiveByokUrls(settings, preset);
  const model = settings.model ?? preset.model;
  const maxTokens = settings.maxTokens ?? preset.maxTokens;
  const apiKey = settings.apiKey;

  if (protocol === "anthropic") {
    const providerConfig: Record<string, unknown> = {
      baseUrl: effectiveBaseUrl ?? "https://api.anthropic.com",
      model: model ?? DEFAULT_ANTHROPIC_FALLBACK_MODEL,
      anthropicVersion: settings.anthropicVersion ?? preset.anthropicVersion ?? "2023-06-01"
    };
    if (maxTokens !== undefined) {
      providerConfig.maxTokens = maxTokens;
    }
    if (apiKey) {
      providerConfig.apiKey = apiKey;
    }
    return { providerId: "anthropic", providerConfig };
  }

  if (protocol === "azure") {
    const providerConfig: Record<string, unknown> = {
      endpoint: effectiveEndpoint ?? preset.endpoint,
      deployment: settings.deployment ?? preset.deployment ?? model,
      model: settings.deployment ?? preset.deployment ?? model,
      apiVersion: settings.apiVersion ?? preset.apiVersion ?? "2024-10-21"
    };
    if (maxTokens !== undefined) {
      providerConfig.maxTokens = maxTokens;
    }
    if (apiKey) {
      providerConfig.apiKey = apiKey;
    }
    return { providerId: "azure_openai", providerConfig };
  }

  if (protocol === "gemini") {
    const providerConfig: Record<string, unknown> = {
      baseUrl: effectiveBaseUrl ?? "https://generativelanguage.googleapis.com",
      model: model ?? "gemini-2.5-pro"
    };
    if (maxTokens !== undefined) {
      providerConfig.maxTokens = maxTokens;
    }
    if (apiKey) {
      providerConfig.apiKey = apiKey;
    }
    return { providerId: "gemini", providerConfig };
  }

  const providerConfig: Record<string, unknown> = {
    baseUrl: effectiveBaseUrl ?? "https://api.openai.com/v1",
    model: model ?? DEFAULT_OPENAI_COMPATIBLE_FALLBACK_MODEL
  };
  if (maxTokens !== undefined) {
    providerConfig.maxTokens = maxTokens;
  }
  if (apiKey) {
    providerConfig.apiKey = apiKey;
  }
  return { providerId: "openai_compatible", providerConfig };
}

export function resolveExecutionSettings(settings: ExecutionSettings): ResolvedExecutionProvider {
  if (settings.executionMode === "local_cli") {
    return resolveLocalCli(settings);
  }

  return resolveByok(settings);
}
