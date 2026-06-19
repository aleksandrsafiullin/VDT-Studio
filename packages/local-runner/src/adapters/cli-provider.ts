import type { CliProviderConfig, CliProviderTestResult } from "../cli/types";

export function describeCliProvider(config: CliProviderConfig): CliProviderTestResult {
  return {
    ok: true,
    provider: config.name,
    command: [config.command, ...(config.args ?? [])].join(" "),
    message: "CLI provider interface is configured. Execution is intentionally stubbed in the MVP."
  };
}
