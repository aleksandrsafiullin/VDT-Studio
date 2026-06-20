export type AiTaskType =
  | "generate_vdt"
  | "deepen_node"
  | "simplify_branch"
  | "suggest_alternative_decomposition"
  | "review_model"
  | "check_units"
  | "suggest_formula"
  | "explain_node"
  | "generate_scenario_summary"
  | "generate_executive_summary";

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
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
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

export interface CliProviderConfig {
  name: string;
  command: string;
  args?: string[] | undefined;
  inputMode: "stdin";
  outputMode: "stdout_json";
  timeoutSec: number;
}

export interface LocalRunnerProviderConfig {
  runnerUrl: string;
  runnerProviderId: "local_http_stub" | "cli_stub" | "mock_stub" | string;
  providerConfig?: LocalHttpProviderConfig | CliProviderConfig | undefined;
  timeoutSec?: number | undefined;
}
