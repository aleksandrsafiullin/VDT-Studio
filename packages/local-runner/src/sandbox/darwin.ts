import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { SandboxProfile, SandboxResult, SandboxSpawnOptions } from "./types";

function quoteSandboxString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function resolveSandboxPath(value: string): string {
  return path.resolve(value);
}

export function buildDarwinSandboxProfile(profile: SandboxProfile): string {
  const tempCwd = quoteSandboxString(resolveSandboxPath(profile.tempCwd));
  const repoCwd = quoteSandboxString(resolveSandboxPath(profile.repoCwd));
  const providerExecutable = quoteSandboxString(resolveSandboxPath(profile.providerExecutable));
  const deniedReadPaths = (profile.deniedReadPaths ?? []).map((entry) =>
    quoteSandboxString(resolveSandboxPath(entry))
  );

  const lines = [
    "(version 1)",
    "; Best-effort macOS isolation. Node-based fixtures require allow-default on current Seatbelt.",
    "(allow default)",
    "",
    "; Temp cwd is the intended working root",
    `(allow file-read* (subpath ${tempCwd}))`,
    `(allow file-write* (subpath ${tempCwd}))`,
    "",
    "; Provider network access",
    "(allow network*)",
    "",
    "; Provider executable",
    `(allow process-exec (literal ${providerExecutable}))`,
    `(allow file-read* (literal ${providerExecutable}))`,
    "",
    "; Deny VDT repo reads",
    `(deny file-read* (subpath ${repoCwd}))`
  ];

  for (const deniedPath of deniedReadPaths) {
    lines.push(`(deny file-read* (subpath ${deniedPath}))`);
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Wrap a spawn target with `sandbox-exec -f profile.sb -- command ...args`.
 */
export function wrapDarwinSandbox(
  command: string,
  args: readonly string[],
  options: SandboxSpawnOptions
): SandboxResult {
  const profileDir = options.profileDir ?? options.profile.tempCwd;
  const profilePath = path.join(path.resolve(profileDir), `vdt-sandbox-${randomUUID()}.sb`);
  writeFileSync(profilePath, buildDarwinSandboxProfile(options.profile), { encoding: "utf8", mode: 0o600 });

  return {
    command: "sandbox-exec",
    args: ["-f", profilePath, "--", command, ...args],
    profilePath
  };
}
