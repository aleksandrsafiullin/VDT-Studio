export type ModelBackendMode = "api" | "subscription_cli" | "local_http" | "custom_cli";

export type ModelBackendStatus =
  | "not_installed"
  | "installed"
  | "authentication_required"
  | "ready"
  | "rate_limited"
  | "unsupported_version"
  | "unsafe_configuration"
  | "unavailable"
  | "error";

export type VdtAiTaskType =
  | "generate_tree"
  | "deepen_node"
  | "simplify_branch"
  | "suggest_alternative"
  | "suggest_formula"
  | "review_model"
  | "check_units"
  | "identify_missing_drivers"
  | "identify_duplicate_drivers"
  | "explain_node"
  | "explain_scenario"
  | "generate_executive_summary";

export interface ModelBackendCapabilities {
  structuredOutput: boolean;
  streaming: boolean;
  modelSelection: boolean;
  accountBasedUsage: boolean;
  localExecution: boolean;
  toolsCanBeDisabled: boolean;
  requiresOsSandbox: boolean;
}

export interface ModelBackendDetectionResult {
  backendId: string;
  status: ModelBackendStatus;
  executable?: string;
  version?: string;
  authSummary?: string;
  diagnostics: string[];
}

export interface StructuredCompletionRequest<TInput> {
  requestId: string;
  taskType: VdtAiTaskType;
  input: TInput;
  systemPrompt: string;
  userPrompt: string;
  schemaId: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface StructuredCompletionResult<TOutput> {
  requestId: string;
  backendId: string;
  model?: string;
  output: TOutput;
  rawText?: string;
  latencyMs: number;
  validation: {
    schemaValid: boolean;
    repaired: boolean;
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    providerReported?: boolean;
  };
}

export interface ModelBackend {
  readonly id: string;
  readonly mode: ModelBackendMode;
  readonly capabilities: ModelBackendCapabilities;
  detect(): Promise<ModelBackendDetectionResult>;
  testConnection(signal?: AbortSignal): Promise<ModelBackendDetectionResult>;
  completeStructured<TInput, TOutput>(
    request: StructuredCompletionRequest<TInput>,
    signal?: AbortSignal
  ): Promise<StructuredCompletionResult<TOutput>>;
}
