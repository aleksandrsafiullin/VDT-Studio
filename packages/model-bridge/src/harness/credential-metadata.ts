import { execFileSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import path from "node:path";

export type VibeCredentialSource = "env" | "file" | "keyring" | "none";
/** Host-only metadata dependencies. Never accepted in a task or settings DTO. */
export interface HarnessCredentialMetadataOptions {
  /** Chat remains an unqualified session canary when account generation cannot
   * be inspected. Smart cache/admission requires an inspectable source. */
  purpose?: "chat" | "smart" | undefined;
  vibeCredentialSource?: VibeCredentialSource | undefined;
  platform?: NodeJS.Platform | undefined;
  keychainSearchList?: (() => readonly string[]) | undefined;
}
const unavailable = () => Object.assign(new Error("Vibe credential-store changes cannot be verified on this host. Use an explicitly verified environment/.env credential source, or an inspectable macOS keychain, then rescan."), { code: "CREDENTIAL_IDENTITY_UNVERIFIED" });

/** Stat only: no credential file, keychain, WAL or journal contents are read. */
export function credentialFileMetadata(file: string): readonly unknown[] | null {
  try {
    const canonical = realpathSync(file), s = statSync(canonical);
    return [canonical, s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs];
  } catch { return null; }
}

/** Current Vibe's macOS backend invokes security without a keychain override,
 * so it searches the same list returned by this read-only command. Only the
 * list and encrypted-store file metadata are used; no find/get/-g/-w command
 * or key material ever enters VDT. Unrelated keychain writes conservatively
 * invalidate an epoch rather than letting a changed credential reuse it.
 * Sources: mistralai/mistral-vibe vibe/utils/keyring.py and
 * vibe/cli-rust/src/credentials/keyring.rs. */
export function vibeKeyringMetadata(env: NodeJS.ProcessEnv, options: HarnessCredentialMetadataOptions = {}): readonly unknown[] {
  if ((options.platform ?? process.platform) !== "darwin") throw unavailable();
  let search: readonly string[];
  try {
    search = options.keychainSearchList ? options.keychainSearchList() : String(execFileSync("/usr/bin/security", ["list-keychains", "-d", "user"], {
      encoding: "utf8", timeout: 1000, killSignal: "SIGKILL", maxBuffer: 16 * 1024, windowsHide: true,
      env: { NODE_ENV: env.NODE_ENV ?? "production", PATH: "/usr/bin:/bin", ...(env.HOME ? { HOME: env.HOME } : {}) }, stdio: ["ignore", "pipe", "pipe"]
    })).split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => JSON.parse(line));
  } catch { throw unavailable(); }
  if (search.length === 0 || search.length > 32 || search.some(file => typeof file !== "string" || !path.isAbsolute(file) || file.length > 4096 || /[\x00-\x1f]/.test(file))) throw unavailable();
  const encryptedFileMetadata = (filename: string, required: boolean): readonly unknown[] | null => {
    try {
      const canonical = realpathSync(filename), s = statSync(canonical);
      if (!s.isFile()) throw unavailable();
      return [canonical, s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs];
    } catch (e) { if (!required && (e as NodeJS.ErrnoException)?.code === "ENOENT") return null; throw unavailable(); }
  };
  return search.map(file => {
    const main = encryptedFileMetadata(file, true)!;
    return [file, main, encryptedFileMetadata(`${String(main[0])}-wal`, false), encryptedFileMetadata(`${String(main[0])}-journal`, false)];
  });
}

export const credentialRootVariables: Readonly<Record<string, readonly string[]>> = Object.freeze({
  kimi: ["KIMI_CODE_HOME"], vibe: ["VIBE_HOME"], qwen: ["QWEN_HOME"], "grok-build": ["GROK_HOME"], pi: ["PI_CODING_AGENT_DIR"],
  kilo: ["KILO_CONFIG_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"]
});

/** Resolve once against the host cwd, before the subprocess changes to an
 * owned private directory. Qwen explicitly permits relative and ~/ roots. */
export function resolveCredentialRoot(value: string, env: NodeJS.ProcessEnv): string {
  const expanded = value === "~" ? env.HOME ?? value : value.startsWith("~/") ? path.join(env.HOME ?? "", value.slice(2)) : value;
  return path.resolve(expanded);
}
