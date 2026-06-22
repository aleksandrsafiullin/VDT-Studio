import { wrapDarwinSandbox } from "./darwin";
import type { SandboxResult, SandboxSpawnOptions } from "./types";

export * from "./types";
export { buildDarwinSandboxProfile, wrapDarwinSandbox } from "./darwin";

const UNSUPPORTED_DIAGNOSTIC =
  "unsupported: OS sandbox is only implemented on darwin (Linux/Windows deferred)";

/**
 * Apply OS sandbox wrapping when supported; otherwise return the original spawn target.
 *
 * Sandbox is best-effort. Provider certification still requires tools-disabled CLI flags.
 */
export function wrapSandbox(
  command: string,
  args: readonly string[],
  options: SandboxSpawnOptions
): SandboxResult {
  if (process.platform === "darwin") {
    return wrapDarwinSandbox(command, args, options);
  }
  return {
    command,
    args: [...args],
    diagnostic: UNSUPPORTED_DIAGNOSTIC
  };
}
