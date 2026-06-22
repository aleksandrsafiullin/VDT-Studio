/**
 * macOS Seatbelt profile inputs for subscription CLI isolation.
 *
 * Sandbox is best-effort defense-in-depth. Certification still requires
 * provider CLIs with tools, MCP, hooks, and project reads disabled via flags.
 */
export interface SandboxProfile {
  /** Isolated temp working directory — sole writable root. */
  tempCwd: string;
  /** Runner / VDT repo cwd — read access denied. */
  repoCwd: string;
  /** Resolved provider CLI binary — execute and read allowed. */
  providerExecutable: string;
  /** User home root. Reads are denied except explicit provider auth paths. */
  homeDir?: string;
  /** Optional user project or other paths denied for read. */
  deniedReadPaths?: readonly string[];
  /** Additional absolute paths allowed for read (e.g. node script argv). */
  allowedReadPaths?: readonly string[];
}

export interface SandboxSpawnOptions {
  profile: SandboxProfile;
  /** Directory for ephemeral `*.sb` profile file (defaults to `profile.tempCwd`). */
  profileDir?: string;
}

export interface SandboxResult {
  command: string;
  args: string[];
  /** Written sandbox profile path when darwin wrapping is applied. */
  profilePath?: string;
  /** Present when the OS sandbox is not applied on this platform. */
  diagnostic?: string;
}
