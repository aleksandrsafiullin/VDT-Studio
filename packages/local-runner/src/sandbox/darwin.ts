import { randomUUID } from "node:crypto";
import { realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SandboxProfile, SandboxResult, SandboxSpawnOptions } from "./types";

function quoteSandboxString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function resolveSandboxPath(value: string): string {
  const resolved = path.resolve(value);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

export function buildDarwinSandboxProfile(profile: SandboxProfile): string {
  const tempCwd = quoteSandboxString(resolveSandboxPath(profile.tempCwd));
  const tempParent = quoteSandboxString(resolveSandboxPath(path.dirname(profile.tempCwd)));
  const repoCwd = quoteSandboxString(resolveSandboxPath(profile.repoCwd));
  const providerExecutable = quoteSandboxString(resolveSandboxPath(profile.providerExecutable));
  const homeDir = profile.homeDir ? quoteSandboxString(resolveSandboxPath(profile.homeDir)) : undefined;
  const providerExecutableDir = quoteSandboxString(path.dirname(resolveSandboxPath(profile.providerExecutable)));
  const allowedReadPaths = [...new Set([
    "/dev",
    "/etc",
    "/private/etc",
    "/private/var/db",
    "/private/var/folders",
    "/usr/share",
    "/var/db",
    "/var/folders",
    "/usr/lib",
    "/System/Library",
    "/Library/Apple",
    "/opt/homebrew/opt",
    "/opt/homebrew/Cellar",
    "/usr/local/opt",
    "/usr/local/Cellar",
    path.dirname(resolveSandboxPath(profile.providerExecutable)),
    ...(profile.allowedReadPaths ?? [])
  ])].map((entry) => quoteSandboxString(resolveSandboxPath(entry)));
  const deniedReadPaths = (profile.deniedReadPaths ?? []).map((entry) =>
    quoteSandboxString(resolveSandboxPath(entry))
  );

  const lines = [
    "(version 1)",
    "; Default-deny macOS isolation for reviewed local AI provider execution.",
    "(deny default)",
    "",
    "; Temp cwd is the intended working root",
    `(allow file-read* (subpath ${tempCwd}))`,
    `(allow file-write* (subpath ${tempCwd}))`,
    "(allow file-write*)",
    "",
    "; Read-only runtime dependencies and reviewed provider auth paths",
    "; Broad reads are narrowed below by explicit deny rules for repo, home, and temp-root data.",
    "(allow file-read*)",
    "(allow file-map-executable)",
    ...allowedReadPaths.map((entry) => `(allow file-read* (subpath ${entry}))`),
    ...allowedReadPaths.map((entry) => `(allow file-map-executable (subpath ${entry}))`),
    "(allow file-read-metadata)",
    "",
    "; Required process and system services",
    "(allow ipc*)",
    "(allow mach*)",
    "(allow process-fork)",
    "(allow process-info*)",
    "(allow signal (target self))",
    "(allow sysctl-read)",
    "",
    "; Provider network access",
    "(allow network*)",
    "",
    "; Provider executable",
    `(allow process-exec (literal ${providerExecutable}))`,
    `(allow file-read* (literal ${providerExecutable}))`,
    `(allow file-map-executable (literal ${providerExecutable}))`,
    `(allow file-read* (subpath ${providerExecutableDir}))`,
    `(allow file-map-executable (subpath ${providerExecutableDir}))`,
    "",
    "; Writes are confined to the ephemeral run directory",
    `(deny file-write* (require-all (subpath "/") (require-not (subpath ${tempCwd})) (require-not (literal "/dev/null"))))`,
    "",
    "; Deny VDT repo reads",
    `(deny file-read* (subpath ${repoCwd}))`,
    "",
    "; Deny temp-root reads outside the request directory",
    `(deny file-read-data (require-all (subpath ${tempParent}) (require-not (subpath ${tempCwd}))))`,
    `(deny file-read-data (require-all (subpath "/tmp") (require-not (subpath ${tempCwd}))))`,
    `(deny file-read-data (require-all (subpath "/private/tmp") (require-not (subpath ${tempCwd}))))`
  ];

  if (homeDir) {
    const exceptions = [tempCwd, ...allowedReadPaths]
      .map((entry) => `(require-not (subpath ${entry}))`)
      .join(" ");
    lines.push("", "; Deny arbitrary home file contents except reviewed provider auth paths", `(deny file-read-data (require-all (subpath ${homeDir}) ${exceptions}))`);
  }

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
