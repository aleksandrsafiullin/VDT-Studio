export interface CliProviderConfig {
  name: string;
  command: string;
  args?: string[];
  inputMode: "stdin";
  outputMode: "stdout_json";
  timeoutSec: number;
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
  status: "stub";
  runMode: "disabled" | "mock";
  taskTypes: string[];
  description: string;
  safety: {
    executesShell: false;
    performsNetworkRequests: false;
    returnsMockDataOnly: boolean;
  };
}

export interface LocalRunnerRunRequest {
  providerId: string;
  taskType: string;
  input?: unknown;
  schema?: unknown;
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
    mode: "stub";
    message: string;
    input: LocalRunnerRunSummary;
    schema: LocalRunnerRunSummary;
  };
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
  executed: false;
  shellExecution: false;
  remoteExecution: false;
  timeoutSec?: number;
}
