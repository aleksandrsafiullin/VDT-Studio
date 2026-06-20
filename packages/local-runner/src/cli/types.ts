export interface CliProviderConfig {
  name: string;
  command: string;
  args?: string[];
  inputMode: "stdin";
  outputMode: "stdout_json";
  timeoutSec: number;
}

export interface LocalHttpProviderConfig {
  baseUrl: string;
  apiKey?: string | undefined;
  model: string;
  timeoutSec?: number | undefined;
}

export type LocalRunnerProviderPresetKind = "local_http" | "cli";

export interface LocalRunnerProviderPreset {
  id: string;
  label: string;
  providerId: "local_http_stub" | "cli_stub";
  kind: LocalRunnerProviderPresetKind;
  description: string;
  providerConfig: LocalHttpProviderConfig | CliProviderConfig;
  notes?: string[] | undefined;
}

export interface CliProviderTestResult {
  ok: boolean;
  provider: string;
  command: string;
  message: string;
}

export interface LocalRunnerProvider {
  id: string;
  name: string;
  kind: "cli" | "local_http" | "mock";
  status: "stub" | "configurable";
  runMode: "disabled" | "mock" | "local_http" | "cli";
  taskTypes: string[];
  description: string;
  safety: {
    executesShell: boolean;
    performsNetworkRequests: boolean;
    returnsMockDataOnly: boolean;
  };
}

export interface LocalRunnerRunRequest {
  providerId: string;
  taskType: string;
  input?: unknown;
  schema?: unknown;
  systemPrompt?: string;
  userPrompt?: string;
  model?: string;
  providerConfig?: unknown;
  timeoutSec?: number;
}

export interface LocalRunnerRunSummary {
  provided: boolean;
  type: "array" | "object" | "undefined" | "null" | "string" | "number" | "boolean" | "bigint" | "symbol" | "function";
  itemCount?: number;
  keys?: string[];
  truncated?: boolean;
}

export type LocalRunnerRunResult = LocalRunnerRunSuccess | LocalRunnerRunFailure;

export interface LocalRunnerRunSuccess {
  ok: true;
  providerId: string;
  taskType: string;
  result: {
    mode: "stub" | "local_http" | "cli";
    message: string;
    input?: LocalRunnerRunSummary;
    schema?: LocalRunnerRunSummary;
  };
  output?: unknown;
  rawOutput?: string;
  latencyMs?: number;
  diagnostics?: LocalRunnerRunDiagnostics;
}

export interface LocalRunnerRunFailure {
  ok: false;
  providerId?: string;
  taskType?: string;
  error: {
    code: string;
    message: string;
  };
  diagnostics?: LocalRunnerRunDiagnostics;
}

export interface LocalRunnerRunDiagnostics {
  executed: boolean;
  shellExecution: boolean;
  remoteExecution: boolean;
  timeoutSec?: number;
}
