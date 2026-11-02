import { BUILTIN_HARNESSES, BUILTIN_HARNESS_IDS, type HarnessDefinition, type HarnessId } from "@vdt-studio/model-bridge/harness-catalog";
import type { ProxyProvider } from "./provider-target-security";
import type { ReasoningEffort } from "@vdt-studio/model-bridge";
import { stripSessionOnlySecrets } from "./session-secrets";

export type ExecutionMode = "local_cli" | "byok";

export type ByokProtocol = "anthropic" | "openai" | "azure" | "gemini";

export type ByokGateway = "none" | "ollama" | "senseaudio" | "aihubmix";

export type CliAgentBadge = "official" | "lower-cost" | "many-models";

export const CLI_AGENT_IDS = BUILTIN_HARNESS_IDS;
export type CliAgentId = HarnessId;

export type LocalRunnerPresetId = "ollama_openai" | "lm_studio_openai" | "vllm_openai" | "custom_cli_json";
export type LocalModelPresetId = Exclude<LocalRunnerPresetId, "custom_cli_json">;

export type LocalHttpModelBackendId = "ollama" | "lm_studio" | "vllm";

export type ByokCredentialMode = "encrypted_local";

export type ByokReleaseStatus = "supported" | "beta" | "experimental";

export type MemoryModelMode = "same_as_chat" | "selected_cli";

export interface CliModelSelection {
  source: "agent_default" | "custom";
  customModel?: string | undefined;
  reasoningEffort?: ReasoningEffort | undefined;
}

export type AnthropicPresetId =
  | "anthropic-claude"
  | "custom"
  | "deepseek-anthropic"
  | "minimax-anthropic"
  | "mimo-anthropic";

export type OpenAiPresetId = "openai-default" | "alibaba-coding-plan" | "custom";

export type AzurePresetId = "azure-default" | "custom";

export type GeminiPresetId = "gemini-default" | "custom";

export type GatewayOnlyPresetId = "ollama-cloud" | "senseaudio" | "aihubmix";

export type MockPresetId = "mock";

export type GatewayPresetId =
  | AnthropicPresetId
  | OpenAiPresetId
  | AzurePresetId
  | GeminiPresetId
  | GatewayOnlyPresetId
  | MockPresetId;

export interface CliCatalogEntry {
  custom?: boolean | undefined;
  id: CliAgentId;
  displayName: string;
  subtitle: string;
  usageNote: string;
  primaryCommand: string;
  badges: CliAgentBadge[];
  docsUrl: string;
  installHint: string;
}

export interface ByokGatewayPreset {
  id: GatewayPresetId;
  label: string;
  protocol: ByokProtocol;
  gateway: ByokGateway;
  proxyProvider?: ProxyProvider | undefined;
  baseUrl: string;
  model: string;
  maxTokens?: number | undefined;
  apiKeyUrl?: string | undefined;
  anthropicVersion?: string | undefined;
  endpoint?: string | undefined;
  deployment?: string | undefined;
  apiVersion?: string | undefined;
  credentialMode?: ByokCredentialMode | undefined;
  releaseStatus?: ByokReleaseStatus | undefined;
}

export interface LocalRunnerPresetCatalogEntry {
  id: LocalRunnerPresetId;
  label: string;
  description: string;
  runnerProviderId: "local_http_stub" | "cli_stub";
  modelBackendId?: LocalHttpModelBackendId | undefined;
  baseUrl?: string | undefined;
  model?: string | undefined;
  command?: string | undefined;
  argsText?: string | undefined;
}

export interface ExecutionSettings {
  /** Suggested KPI choices are scoped to this connection and never change chat. */
  smartKpiBySource?: Record<string, SmartKpiModelPreferences> | undefined;
  modelReasoningBySource?: Record<string, boolean | string | number> | undefined;
  executionMode: ExecutionMode;
  selectedCliAgentId?: CliAgentId | undefined;
  localRunnerPresetId?: LocalRunnerPresetId | undefined;
  runnerUrl?: string | undefined;
  runnerProviderId?: "local_http_stub" | "cli_stub" | undefined;
  localBaseUrl?: string | undefined;
  localModel?: string | undefined;
  savedLocalModelSelection?: { presetId: LocalModelPresetId; model?: string | undefined } | undefined;
  localApiKey?: string | undefined;
  command?: string | undefined;
  argsText?: string | undefined;
  timeoutSec?: number | undefined;
  memoryModelMode?: MemoryModelMode | undefined;
  memoryCliAgentId?: CliAgentId | undefined;
  cliModelSelection?: CliModelSelection | undefined;
  byokProtocol?: ByokProtocol | undefined;
  byokGateway?: ByokGateway | undefined;
  gatewayPresetId?: GatewayPresetId | undefined;
  useMockProvider?: boolean | undefined;
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  model?: string | undefined;
  maxTokens?: number | undefined;
  endpoint?: string | undefined;
  deployment?: string | undefined;
  apiVersion?: string | undefined;
  anthropicVersion?: string | undefined;
  customizeBaseUrl?: boolean | undefined;
}

export interface SmartKpiModelPreferences {
  /** Omitted means follow the model selected for chat on this connection. */
  model?: string | undefined;
  /** Exact advertised values, remembered independently for each Smart model. */
  /** null is an explicit opt-in to the provider's default. */
  reasoningByModel?: Record<string, boolean | string | number | null> | undefined;
}

function harnessCatalogEntry(h: HarnessDefinition): CliCatalogEntry {
  return { id: h.id, displayName: h.name, subtitle: "Local agent harness", usageNote: "Uses the account and model provider configured in this harness. Provider limits and billing apply.", primaryCommand: h.command, badges: h.custom ? [] : ["official"], docsUrl: h.docsUrl, installHint: h.installHint, custom: h.custom };
}
export const CLI_CATALOG: CliCatalogEntry[] = BUILTIN_HARNESSES.map(harnessCatalogEntry);
export function registerHarnessCatalog(definitions: readonly HarnessDefinition[]): void {
  const entries = definitions.map(harnessCatalogEntry);
  CLI_CATALOG.splice(0, CLI_CATALOG.length, ...entries);
}

export const LOCAL_RUNNER_PRESET_CATALOG: readonly LocalRunnerPresetCatalogEntry[] = [
  {
    id: "ollama_openai",
    label: "Ollama",
    description: "Run open-weight models locally with Ollama's OpenAI-compatible API.",
    runnerProviderId: "local_http_stub",
    modelBackendId: "ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "qwen3"
  },
  {
    id: "lm_studio_openai",
    label: "LM Studio",
    description: "Host GGUF models in LM Studio and expose them via a local OpenAI endpoint.",
    runnerProviderId: "local_http_stub",
    modelBackendId: "lm_studio",
    baseUrl: "http://127.0.0.1:1234/v1",
    model: "local-model"
  },
  {
    id: "vllm_openai",
    label: "vLLM",
    description: "Serve high-throughput models with vLLM's OpenAI-compatible server.",
    runnerProviderId: "local_http_stub",
    modelBackendId: "vllm",
    baseUrl: "http://127.0.0.1:8000/v1",
    model: "local-model"
  },
  {
    id: "custom_cli_json",
    label: "CLI JSON stdout",
    description: "Custom local command that prints JSON to stdout for the desktop runtime.",
    runnerProviderId: "cli_stub",
    command: "vdt-model-adapter",
    argsText: ""
  }
];

export const BYOK_GATEWAY_PRESETS: readonly ByokGatewayPreset[] = [
  {
    id: "mock",
    label: "Mock (offline dev)",
    protocol: "openai",
    gateway: "none",
    baseUrl: "",
    model: "mock"
  },
  {
    id: "anthropic-claude",
    label: "Anthropic Claude",
    protocol: "anthropic",
    gateway: "none",
    proxyProvider: "anthropic",
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4-6",
    maxTokens: 64_000,
    credentialMode: "encrypted_local",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    anthropicVersion: "2023-06-01"
  },
  {
    id: "deepseek-anthropic",
    label: "DeepSeek (Anthropic API)",
    protocol: "anthropic",
    gateway: "none",
    proxyProvider: "anthropic",
    baseUrl: "https://api.deepseek.com/anthropic",
    model: "deepseek-v4-pro",
    maxTokens: 64_000,
    credentialMode: "encrypted_local",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    anthropicVersion: "2023-06-01"
  },
  {
    id: "minimax-anthropic",
    label: "MiniMax (Anthropic API)",
    protocol: "anthropic",
    gateway: "none",
    proxyProvider: "anthropic",
    baseUrl: "https://api.minimax.chat/anthropic/v1",
    model: "MiniMax-M3",
    maxTokens: 64_000,
    credentialMode: "encrypted_local",
    apiKeyUrl: "https://platform.minimax.io/user-center/basic-information/interface-key",
    anthropicVersion: "2023-06-01"
  },
  {
    id: "mimo-anthropic",
    label: "MiMo (Anthropic API)",
    protocol: "anthropic",
    gateway: "none",
    proxyProvider: "anthropic",
    baseUrl: "https://api.xiaomimimo.com/anthropic",
    model: "mimo-v2-flash",
    maxTokens: 64_000,
    credentialMode: "encrypted_local",
    apiKeyUrl: "https://platform.xiaomimimo.com",
    anthropicVersion: "2023-06-01"
  },
  {
    id: "custom",
    label: "Custom provider",
    protocol: "anthropic",
    gateway: "none",
    proxyProvider: "anthropic",
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4-6",
    maxTokens: 64_000,
    credentialMode: "encrypted_local",
    anthropicVersion: "2023-06-01"
  },
  {
    id: "openai-default",
    label: "OpenAI",
    protocol: "openai",
    gateway: "none",
    proxyProvider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.5",
    maxTokens: 32_768,
    credentialMode: "encrypted_local",
    apiKeyUrl: "https://platform.openai.com/api-keys"
  },
  {
    id: "alibaba-coding-plan",
    label: "Alibaba Cloud Coding Plan",
    protocol: "openai",
    gateway: "none",
    proxyProvider: "openai",
    baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
    model: "qwen3-coder-plus",
    maxTokens: 32_768,
    credentialMode: "encrypted_local",
    releaseStatus: "beta",
    apiKeyUrl: "https://modelstudio.console.alibabacloud.com/ap-southeast-1/?tab=globalset#/efm/coding_plan"
  },
  {
    id: "azure-default",
    label: "Azure OpenAI",
    protocol: "azure",
    gateway: "none",
    proxyProvider: "azure",
    baseUrl: "",
    endpoint: "https://your-resource.openai.azure.com",
    deployment: "gpt-5.4-mini",
    model: "gpt-5.4-mini",
    apiVersion: "2024-10-21",
    maxTokens: 32_768,
    credentialMode: "encrypted_local",
    apiKeyUrl: "https://portal.azure.com"
  },
  {
    id: "gemini-default",
    label: "Google Gemini",
    protocol: "gemini",
    gateway: "none",
    proxyProvider: "google",
    baseUrl: "https://generativelanguage.googleapis.com",
    model: "gemini-3.5-flash",
    maxTokens: 65_536,
    credentialMode: "encrypted_local",
    apiKeyUrl: "https://aistudio.google.com/apikey"
  },
  {
    id: "ollama-cloud",
    label: "Ollama Cloud",
    protocol: "openai",
    gateway: "ollama",
    proxyProvider: "ollama",
    baseUrl: "https://ollama.com/v1",
    model: "qwen3",
    maxTokens: 32_768,
    credentialMode: "encrypted_local",
    apiKeyUrl: "https://ollama.com/settings/keys"
  },
  {
    id: "senseaudio",
    label: "SenseAudio",
    protocol: "openai",
    gateway: "senseaudio",
    proxyProvider: "senseaudio",
    baseUrl: "https://api.senseaudio.cn/v1",
    model: "sense-chat",
    maxTokens: 32_768,
    credentialMode: "encrypted_local",
    apiKeyUrl: "https://senseaudio.cn"
  },
  {
    id: "aihubmix",
    label: "AIHubMix",
    protocol: "openai",
    gateway: "aihubmix",
    proxyProvider: "openai",
    baseUrl: "https://api.aihubmix.com/v1",
    model: "gpt-5.4-mini",
    maxTokens: 32_768,
    credentialMode: "encrypted_local",
    apiKeyUrl: "https://aihubmix.com"
  }
];

const gatewayPresetById = new Map(BYOK_GATEWAY_PRESETS.map((preset) => [preset.id, preset]));
const localRunnerPresetById = new Map(LOCAL_RUNNER_PRESET_CATALOG.map((preset) => [preset.id, preset]));

export function getGatewayPreset(id: GatewayPresetId): ByokGatewayPreset {
  const preset = gatewayPresetById.get(id);
  if (!preset) {
    throw new Error(`Unknown gateway preset: ${id}`);
  }
  return preset;
}

export const DEFAULT_OPENAI_COMPATIBLE_FALLBACK_MODEL = getGatewayPreset("openai-default").model;
export const DEFAULT_ANTHROPIC_FALLBACK_MODEL = getGatewayPreset("anthropic-claude").model;

export function getLocalRunnerPreset(id: LocalRunnerPresetId): LocalRunnerPresetCatalogEntry {
  const preset = localRunnerPresetById.get(id);
  if (!preset) {
    throw new Error(`Unknown local runner preset: ${id}`);
  }
  return preset;
}

export function getCliCatalogEntry(id: CliAgentId): CliCatalogEntry {
  const entry = CLI_CATALOG.find((candidate) => candidate.id === id);
  if (!entry) return { id, displayName: "Custom harness", subtitle: "Reconnect to the local runtime", usageNote: "Refresh the runtime catalog to verify this connection.", primaryCommand: "", badges: [], docsUrl: "", installHint: "" };
  return entry;
}

export const DEFAULT_PRESET_BY_PROTOCOL: Record<ByokProtocol, GatewayPresetId> = {
  anthropic: "anthropic-claude",
  openai: "openai-default",
  azure: "azure-default",
  gemini: "gemini-default"
};

export const GATEWAY_TO_PRESET: Record<Exclude<ByokGateway, "none">, GatewayPresetId> = {
  ollama: "ollama-cloud",
  senseaudio: "senseaudio",
  aihubmix: "aihubmix"
};

export const PROTOCOL_SECTION_LABELS: Record<ByokProtocol, { title: string; hint: string }> = {
  anthropic: {
    title: "Anthropic API",
    hint: "Claude models via the Anthropic Messages API or Anthropic-compatible gateways."
  },
  openai: {
    title: "OpenAI API",
    hint: "GPT models via the OpenAI Chat Completions API or OpenAI-compatible endpoints."
  },
  azure: {
    title: "Azure OpenAI API",
    hint: "Deploy models on Azure OpenAI with your resource endpoint, deployment name, and API version."
  },
  gemini: {
    title: "Google Gemini API",
    hint: "Gemini models via the Google Generative Language API."
  }
};

function protocolCustomDefaults(protocol: ByokProtocol): Pick<
  ByokGatewayPreset,
  "protocol" | "gateway" | "baseUrl" | "model" | "maxTokens" | "anthropicVersion" | "endpoint" | "deployment" | "apiVersion"
> {
  switch (protocol) {
    case "anthropic":
      return {
        protocol: "anthropic",
        gateway: "none",
        baseUrl: "https://api.anthropic.com",
        model: "claude-sonnet-4-6",
        maxTokens: 64_000,
        anthropicVersion: "2023-06-01"
      };
    case "openai":
      return {
        protocol: "openai",
        gateway: "none",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5.5",
        maxTokens: 32_768
      };
    case "azure":
      return {
        protocol: "azure",
        gateway: "none",
        baseUrl: "",
        endpoint: "https://your-resource.openai.azure.com",
        deployment: "gpt-5.4-mini",
        model: "gpt-5.4-mini",
        apiVersion: "2024-10-21",
        maxTokens: 32_768
      };
    case "gemini":
      return {
        protocol: "gemini",
        gateway: "none",
        baseUrl: "https://generativelanguage.googleapis.com",
        model: "gemini-3.5-flash",
        maxTokens: 65_536
      };
  }
}

export function getCustomGatewayPresetForProtocol(protocol: ByokProtocol): ByokGatewayPreset {
  return {
    ...getGatewayPreset("custom"),
    ...protocolCustomDefaults(protocol),
    id: "custom",
    label: "Custom provider"
  };
}

export function listPresetsForProtocol(protocol: ByokProtocol): readonly ByokGatewayPreset[] {
  const protocolPresets = BYOK_GATEWAY_PRESETS.filter(
    (preset) => preset.gateway === "none" && preset.protocol === protocol && preset.id !== "mock"
  );

  if (protocolPresets.some((preset) => preset.id === "custom")) {
    return protocolPresets;
  }

  return [...protocolPresets, getCustomGatewayPresetForProtocol(protocol)];
}

export const DEFAULT_EXECUTION_SETTINGS: ExecutionSettings = {
  executionMode: "byok",
  gatewayPresetId: "openai-default",
  useMockProvider: false,
  byokProtocol: "openai",
  byokGateway: "none",
  memoryModelMode: "same_as_chat",
  cliModelSelection: { source: "agent_default" },
  localRunnerPresetId: "ollama_openai",
  runnerUrl: "http://127.0.0.1:8765",
  runnerProviderId: "local_http_stub",
  localBaseUrl: "http://127.0.0.1:11434/v1",
  localModel: "qwen3",
  timeoutSec: 60,
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-5.5",
  anthropicVersion: "2023-06-01",
  apiVersion: "2024-10-21"
};

export function applyGatewayPreset(
  settings: Partial<ExecutionSettings>,
  presetId: GatewayPresetId
): ExecutionSettings {
  const preset =
    presetId === "custom"
      ? getCustomGatewayPresetForProtocol(settings.byokProtocol ?? "anthropic")
      : getGatewayPreset(presetId);

  return {
    ...settings,
    executionMode: "byok",
    gatewayPresetId: presetId,
    useMockProvider: presetId === "mock",
    byokProtocol: preset.protocol,
    byokGateway: preset.gateway,
    baseUrl: preset.baseUrl || preset.endpoint,
    model: preset.model,
    maxTokens: preset.maxTokens,
    endpoint: preset.endpoint,
    deployment: preset.deployment,
    apiVersion: preset.apiVersion,
    anthropicVersion: preset.anthropicVersion,
    customizeBaseUrl: presetId === "custom" || presetId === "mock"
  } as ExecutionSettings;
}

export function applyLocalRunnerPreset(
  settings: Partial<ExecutionSettings>,
  presetId: LocalRunnerPresetId
): ExecutionSettings {
  const preset = getLocalRunnerPreset(presetId);
  return {
    ...settings,
    executionMode: "local_cli",
    localRunnerPresetId: presetId,
    runnerProviderId: preset.runnerProviderId,
    localBaseUrl: preset.baseUrl,
    localModel: preset.model,
    command: preset.command,
    argsText: preset.argsText
  } as ExecutionSettings;
}

export function persistedExecutionSettings(settings: ExecutionSettings): ExecutionSettings {
  return stripSessionOnlySecrets({ ...settings }) as ExecutionSettings;
}
