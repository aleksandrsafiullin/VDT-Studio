import type { VdtAiTaskType } from "@vdt-studio/vdt-core";

export type { VdtAiTaskType } from "@vdt-studio/vdt-core";

export type AiTaskType = VdtAiTaskType;

/** Legacy ai-harness task names mapped to canonical VdtAiTaskType values. */
export const LEGACY_AI_TASK_ALIASES = {
  generate_vdt: "generate_tree",
  suggest_alternative_decomposition: "suggest_alternative",
  generate_scenario_summary: "explain_scenario"
} as const satisfies Record<string, VdtAiTaskType>;

export type LegacyAiTaskType = keyof typeof LEGACY_AI_TASK_ALIASES;

export function resolveAiTaskType(taskType: string): VdtAiTaskType {
  if (taskType in LEGACY_AI_TASK_ALIASES) {
    return LEGACY_AI_TASK_ALIASES[taskType as LegacyAiTaskType];
  }
  return taskType as VdtAiTaskType;
}

export interface AiExecutionSettings {
  defaultProviderId: string;
  taskRouting?: Partial<Record<AiTaskType, string>>;
}

export interface AiCompletionParams<TInput> {
  taskType: AiTaskType;
  input: TInput;
  schema: unknown;
  systemPrompt: string;
  userPrompt: string;
  model?: string | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  signal?: AbortSignal | undefined;
}

export interface AiProvider {
  id: string;
  name: string;
  type:
    | "mock"
    | "openai_compatible"
    | "anthropic"
    | "azure_openai"
    | "gemini"
    | "custom_http"
    | "local_http"
    | "local_runner"
    | "cli";
  completeStructured<TInput, TOutput>(params: AiCompletionParams<TInput>): Promise<TOutput>;
}

export interface GenerateVdtInput {
  rootKpi: string;
  industry?: string;
  businessContext?: string;
  unit?: string;
  timePeriod?: string;
  goal?: string;
  levelOfDetail?: "low" | "medium" | "high" | string;
}

export interface OpenAiCompatibleProviderConfig {
  baseUrl: string;
  apiKey?: string | undefined;
  model: string;
  timeoutMs?: number | undefined;
}

export type AiProviderFetch = typeof globalThis.fetch;

export interface AnthropicProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  anthropicVersion?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetch?: AiProviderFetch;
}

export interface AzureOpenAiProviderConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetch?: AiProviderFetch;
}

export interface GeminiProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetch?: AiProviderFetch;
}

export interface LocalHttpProviderConfig {
  baseUrl: string;
  apiKey?: string | undefined;
  model: string;
}

export interface LocalRunnerProviderConfig {
  runnerUrl: string;
  backendId: string;
  pairingToken: string;
  origin: string;
  model?: string | undefined;
  timeoutMs?: number | undefined;
}
