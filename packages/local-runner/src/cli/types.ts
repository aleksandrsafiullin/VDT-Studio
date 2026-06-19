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
