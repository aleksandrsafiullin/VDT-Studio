import type { ProxyProvider } from "./provider-target-security";

export type ExecutionMode = "local_cli" | "byok";

export type ByokProtocol = "anthropic" | "openai" | "azure" | "gemini";

export type ByokGateway = "none" | "ollama" | "senseaudio" | "aihubmix";

export type CliAgentBadge = "official" | "lower-cost" | "many-models";

export const CLI_AGENT_IDS = [
  "claude",
  "codex",
  "opencode",
  "hermes",
  "antigravity",
  "gemini",
  "grok-build",
  "kimi",
  "cursor-agent",
  "qwen",
  "qoder",
  "copilot",
  "pi",
  "kiro",
  "kilo",
  "vibe",
  "deepseek",
  "reasonix",
  "aider",
  "devin",
  "trae"
] as const;

export type CliAgentId = (typeof CLI_AGENT_IDS)[number];

export type LocalRunnerPresetId = "ollama_openai" | "lm_studio_openai" | "vllm_openai" | "custom_cli_json";

export type MemoryModelMode = "same_as_chat" | "selected_cli";

export interface CliModelSelection {
  source: "agent_default" | "custom";
  customModel?: string | undefined;
}

export type AnthropicPresetId =
  | "anthropic-claude"
  | "custom"
  | "deepseek-anthropic"
  | "minimax-anthropic"
  | "mimo-anthropic";

export type OpenAiPresetId = "openai-default" | "custom";

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
  id: CliAgentId;
  displayName: string;
  subtitle: string;
  primaryCommand: string;
  badges: CliAgentBadge[];
  docsUrl: string;
  installHint: string;
  suggestedModels: readonly string[];
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
  models: readonly string[];
  apiKeyUrl?: string | undefined;
  anthropicVersion?: string | undefined;
  endpoint?: string | undefined;
  deployment?: string | undefined;
  apiVersion?: string | undefined;
}

export interface LocalRunnerPresetCatalogEntry {
  id: LocalRunnerPresetId;
  label: string;
  runnerProviderId: "local_http_stub" | "cli_stub";
  baseUrl?: string | undefined;
  model?: string | undefined;
  command?: string | undefined;
  argsText?: string | undefined;
}

export interface ExecutionSettings {
  executionMode: ExecutionMode;
  selectedCliAgentId?: CliAgentId | undefined;
  localRunnerPresetId?: LocalRunnerPresetId | undefined;
  runnerUrl?: string | undefined;
  runnerProviderId?: "local_http_stub" | "cli_stub" | undefined;
  localBaseUrl?: string | undefined;
  localModel?: string | undefined;
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

export const CLI_CATALOG: readonly CliCatalogEntry[] = [
  {
    id: "claude",
    displayName: "Claude Code",
    subtitle: "Anthropic's official coding agent with MCP and skills",
    primaryCommand: "claude",
    badges: ["official"],
    docsUrl: "https://docs.anthropic.com/en/docs/claude-code",
    installHint: "npm install -g @anthropic-ai/claude-code",
    suggestedModels: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"]
  },
  {
    id: "codex",
    displayName: "Codex CLI",
    subtitle: "OpenAI's official terminal coding agent",
    primaryCommand: "codex",
    badges: ["official"],
    docsUrl: "https://developers.openai.com/codex/cli",
    installHint: "npm install -g @openai/codex",
    suggestedModels: ["gpt-5.5", "gpt-5.4", "gpt-5.3-codex"]
  },
  {
    id: "opencode",
    displayName: "OpenCode",
    subtitle: "Open-source agent with broad model support",
    primaryCommand: "opencode",
    badges: ["many-models"],
    docsUrl: "https://github.com/opencode-ai/opencode",
    installHint: "npm install -g opencode-cli",
    suggestedModels: ["claude-sonnet-4-5", "gpt-4.1", "gemini-2.5-pro"]
  },
  {
    id: "hermes",
    displayName: "Hermes Agent",
    subtitle: "ACP-native agent with session resume",
    primaryCommand: "hermes",
    badges: [],
    docsUrl: "https://github.com/anthropics/hermes",
    installHint: "Follow the Hermes install guide for your platform",
    suggestedModels: ["claude-sonnet-4-5", "hermes-4"]
  },
  {
    id: "antigravity",
    displayName: "Antigravity",
    subtitle: "Gemini-powered experimental coding agent",
    primaryCommand: "antigravity",
    badges: [],
    docsUrl: "https://antigravity.google",
    installHint: "Install from the Antigravity distribution page",
    suggestedModels: ["gemini-2.5-pro", "gemini-2.5-flash"]
  },
  {
    id: "gemini",
    displayName: "Gemini CLI",
    subtitle: "Google's official Gemini terminal agent",
    primaryCommand: "gemini",
    badges: ["official", "many-models"],
    docsUrl: "https://github.com/google-gemini/gemini-cli",
    installHint: "npm install -g @google/gemini-cli",
    suggestedModels: ["gemini-3.5-flash", "gemini-3.1-pro-preview", "gemini-3-flash-preview"]
  },
  {
    id: "grok-build",
    displayName: "Grok Build",
    subtitle: "xAI Grok coding workflow in the terminal",
    primaryCommand: "grok-build",
    badges: [],
    docsUrl: "https://docs.x.ai",
    installHint: "Install the Grok Build CLI from xAI",
    suggestedModels: ["grok-3", "grok-3-mini"]
  },
  {
    id: "kimi",
    displayName: "Kimi CLI",
    subtitle: "Moonshot Kimi agent with ACP transport",
    primaryCommand: "kimi",
    badges: [],
    docsUrl: "https://platform.moonshot.cn/docs",
    installHint: "npm install -g @moonshot-ai/kimi-cli",
    suggestedModels: ["kimi-k2", "moonshot-v1-8k"]
  },
  {
    id: "cursor-agent",
    displayName: "Cursor Agent",
    subtitle: "Cursor's headless agent for terminal workflows",
    primaryCommand: "cursor-agent",
    badges: ["official"],
    docsUrl: "https://docs.cursor.com/agent",
    installHint: "Install via Cursor settings or cursor.com/cli",
    suggestedModels: ["claude-sonnet-4-5", "gpt-4.1", "gpt-4.1-mini"]
  },
  {
    id: "qwen",
    displayName: "Qwen Code",
    subtitle: "Alibaba Qwen coding agent with local and cloud models",
    primaryCommand: "qwen",
    badges: ["lower-cost", "many-models"],
    docsUrl: "https://github.com/QwenLM/qwen-code",
    installHint: "npm install -g @qwen-code/qwen-code",
    suggestedModels: ["qwen3-coder", "qwen-max", "qwen-plus"]
  },
  {
    id: "qoder",
    displayName: "Qoder CLI",
    subtitle: "Structured-output friendly coding CLI",
    primaryCommand: "qoder",
    badges: [],
    docsUrl: "https://qoder.com",
    installHint: "npm install -g qodercli",
    suggestedModels: ["qoder-default", "claude-sonnet-4-5"]
  },
  {
    id: "copilot",
    displayName: "GitHub Copilot CLI",
    subtitle: "GitHub's official Copilot terminal agent",
    primaryCommand: "copilot",
    badges: ["official"],
    docsUrl: "https://docs.github.com/en/copilot",
    installHint: "gh extension install github/gh-copilot",
    suggestedModels: ["gpt-4.1", "claude-sonnet-4-5", "gpt-4.1-mini"]
  },
  {
    id: "pi",
    displayName: "Pi Coding Agent",
    subtitle: "Pi RPC agent with extension tooling",
    primaryCommand: "pi",
    badges: [],
    docsUrl: "https://github.com/badlogic/pi-mono",
    installHint: "npm install -g @mariozechner/pi-coding-agent",
    suggestedModels: ["claude-sonnet-4-5", "gpt-4.1-mini"]
  },
  {
    id: "kiro",
    displayName: "Kiro CLI",
    subtitle: "ACP agent with session management",
    primaryCommand: "kiro",
    badges: [],
    docsUrl: "https://kiro.dev",
    installHint: "npm install -g @kiro/cli",
    suggestedModels: ["claude-sonnet-4-5", "gpt-4.1"]
  },
  {
    id: "kilo",
    displayName: "Kilo Code",
    subtitle: "ACP coding agent for multi-model workflows",
    primaryCommand: "kilo",
    badges: [],
    docsUrl: "https://kilocode.ai",
    installHint: "npm install -g @kilocode/cli",
    suggestedModels: ["claude-sonnet-4-5", "gpt-4.1", "deepseek-chat"]
  },
  {
    id: "vibe",
    displayName: "Mistral Vibe CLI",
    subtitle: "Mistral's ACP-native terminal agent",
    primaryCommand: "vibe",
    badges: [],
    docsUrl: "https://docs.mistral.ai",
    installHint: "npm install -g @mistralai/mistral-vibe-cli",
    suggestedModels: ["mistral-large-latest", "codestral-latest"]
  },
  {
    id: "deepseek",
    displayName: "DeepSeek CLI",
    subtitle: "DeepSeek coding agent with competitive pricing",
    primaryCommand: "deepseek",
    badges: ["lower-cost"],
    docsUrl: "https://platform.deepseek.com",
    installHint: "npm install -g deepseek-cli",
    suggestedModels: ["deepseek-chat", "deepseek-reasoner"]
  },
  {
    id: "reasonix",
    displayName: "Reasonix",
    subtitle: "Reasoning-focused terminal coding agent",
    primaryCommand: "reasonix",
    badges: [],
    docsUrl: "https://reasonix.ai",
    installHint: "Install Reasonix from the vendor distribution",
    suggestedModels: ["reasonix-default", "claude-sonnet-4-5"]
  },
  {
    id: "aider",
    displayName: "Aider",
    subtitle: "Pair-programming CLI for git-aware edits",
    primaryCommand: "aider",
    badges: [],
    docsUrl: "https://aider.chat",
    installHint: "pip install aider-chat",
    suggestedModels: ["gpt-4.1", "claude-sonnet-4-5", "deepseek-chat"]
  },
  {
    id: "devin",
    displayName: "Devin CLI",
    subtitle: "Cognition Devin agent via ACP",
    primaryCommand: "devin",
    badges: [],
    docsUrl: "https://devin.ai",
    installHint: "Install Devin CLI from Cognition",
    suggestedModels: ["devin-default"]
  },
  {
    id: "trae",
    displayName: "Trae Agent",
    subtitle: "ByteDance Trae coding agent",
    primaryCommand: "trae-agent",
    badges: [],
    docsUrl: "https://www.trae.ai",
    installHint: "Install Trae Agent from trae.ai",
    suggestedModels: ["trae-default", "claude-sonnet-4-5"]
  }
];

export function mergeCliModelOptions(
  suggestedModels: readonly string[],
  discoveredModels: readonly string[]
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const model of [...suggestedModels, ...discoveredModels]) {
    if (seen.has(model)) {
      continue;
    }
    seen.add(model);
    merged.push(model);
  }

  return merged;
}

export const LOCAL_RUNNER_PRESET_CATALOG: readonly LocalRunnerPresetCatalogEntry[] = [
  {
    id: "ollama_openai",
    label: "Ollama",
    runnerProviderId: "local_http_stub",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "qwen3"
  },
  {
    id: "lm_studio_openai",
    label: "LM Studio",
    runnerProviderId: "local_http_stub",
    baseUrl: "http://127.0.0.1:1234/v1",
    model: "local-model"
  },
  {
    id: "vllm_openai",
    label: "vLLM",
    runnerProviderId: "local_http_stub",
    baseUrl: "http://127.0.0.1:8000/v1",
    model: "local-model"
  },
  {
    id: "custom_cli_json",
    label: "CLI JSON stdout",
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
    model: "mock",
    models: ["mock"]
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
    models: [
      "claude-sonnet-4-6",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-sonnet-4-5",
      "claude-haiku-4-5"
    ],
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
    models: ["deepseek-v4-pro", "deepseek-v4-flash"],
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
    models: [
      "MiniMax-M3",
      "MiniMax-M2.7",
      "MiniMax-M2.7-highspeed",
      "MiniMax-M2.5",
      "MiniMax-M2.5-highspeed",
      "MiniMax-M2.1",
      "MiniMax-M2.1-highspeed",
      "MiniMax-M2"
    ],
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
    models: ["mimo-v2-flash"],
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
    models: ["claude-sonnet-4-6"],
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
    models: [
      "gpt-5.5",
      "gpt-5.5-pro",
      "gpt-5.4",
      "gpt-5.4-pro",
      "gpt-5.4-mini",
      "gpt-5.4-nano",
      "gpt-5.2",
      "gpt-5.2-chat-latest",
      "gpt-5.1",
      "gpt-5.3-codex",
      "gpt-5",
      "gpt-5-mini",
      "gpt-5-nano",
      "gpt-4.1",
      "gpt-4.1-mini",
      "o3"
    ],
    apiKeyUrl: "https://platform.openai.com/api-keys"
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
    models: ["gpt-5.4-mini", "gpt-5.2", "gpt-5-mini", "gpt-4.1", "gpt-4.1-mini", "o4-mini", "o3"],
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
    models: [
      "gemini-3.5-flash",
      "gemini-3.1-pro-preview",
      "gemini-3-flash-preview",
      "gemini-3.1-flash-lite",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite"
    ],
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
    models: ["qwen3", "llama3.3", "deepseek-r1"],
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
    models: ["sense-chat"],
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
    models: [
      "gpt-5.4-mini",
      "gpt-5.4",
      "gpt-5.2",
      "gpt-4.1-mini",
      "gpt-4.1",
      "claude-sonnet-4-6",
      "claude-sonnet-4-5",
      "gemini-2.5-pro",
      "deepseek-v4-pro"
    ],
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
  if (!entry) {
    throw new Error(`Unknown CLI agent: ${id}`);
  }
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
  "protocol" | "gateway" | "baseUrl" | "model" | "maxTokens" | "models" | "anthropicVersion" | "endpoint" | "deployment" | "apiVersion"
> {
  switch (protocol) {
    case "anthropic":
      return {
        protocol: "anthropic",
        gateway: "none",
        baseUrl: "https://api.anthropic.com",
        model: "claude-sonnet-4-6",
        maxTokens: 64_000,
        models: ["claude-sonnet-4-6"],
        anthropicVersion: "2023-06-01"
      };
    case "openai":
      return {
        protocol: "openai",
        gateway: "none",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5.5",
        maxTokens: 32_768,
        models: ["gpt-5.5"]
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
        maxTokens: 32_768,
        models: ["gpt-5.4-mini"]
      };
    case "gemini":
      return {
        protocol: "gemini",
        gateway: "none",
        baseUrl: "https://generativelanguage.googleapis.com",
        model: "gemini-3.5-flash",
        maxTokens: 65_536,
        models: ["gemini-3.5-flash"]
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
  const next: ExecutionSettings = { ...settings };
  delete next.apiKey;
  delete next.localApiKey;
  return next;
}
