import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, type BigIntStats } from "node:fs";
import { isAbsolute } from "node:path";

const configurationName = "VDT_OPENAI_VOICE_API_KEY_FILE";
const authorityKey = Symbol.for("vdt-studio.separate-openai-voice-credential.v1");
const maxCredentialFileBytes = 1026;

interface VoiceCredentialAuthority {
  fingerprint: string;
  use<T>(invoke: (key: string) => T): T;
}
const host = globalThis as typeof globalThis & { [authorityKey]?: VoiceCredentialAuthority };

function sameCredentialFile(first: BigIntStats, next: BigIntStats) {
  return first.dev === next.dev && first.ino === next.ino && first.ctimeNs === next.ctimeNs && first.mtimeNs === next.mtimeNs
    && first.mode === next.mode && first.uid === next.uid && first.nlink === next.nlink && first.size === next.size;
}

function macCredentialHasNoAcl(filename: string) {
  if (process.platform !== "darwin") return true;
  // macOS lists ACL entries on additional lines even when an extended attribute masks the ACL indicator.
  const metadata = execFileSync("/bin/ls", ["-ldeb", filename], {
    env: { LC_ALL: "C", NODE_ENV: "production" }, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8", timeout: 2_000, maxBuffer: 4_096
  });
  return /^-rw-------(?:@ |  )[^\r\n]+\n$/.test(metadata);
}

function readPrivateVoiceKey(filename: string): string | undefined {
  if (typeof process.getuid !== "function" || !isAbsolute(filename)) return;
  let fd: number | undefined;
  try {
    if (realpathSync(filename) !== filename) return;
    fd = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd, { bigint: true });
    const current = () => realpathSync(filename) === filename
      && sameCredentialFile(stat, lstatSync(filename, { bigint: true }))
      && sameCredentialFile(stat, fstatSync(fd!, { bigint: true }));
    if (!stat.isFile() || stat.uid !== BigInt(process.getuid()) || stat.nlink !== 1n || (stat.mode & 0o777n) !== 0o600n
      || stat.size < 1n || stat.size > maxCredentialFileBytes || !current() || !macCredentialHasNoAcl(filename) || !current()) return;
    const bytes = Buffer.alloc(maxCredentialFileBytes + 1);
    try {
      const length = readSync(fd, bytes, 0, bytes.length, 0);
      if (length !== Number(stat.size) || !current()) return;
      const key = bytes.toString("utf8", 0, length).replace(/\r?\n$/, "");
      return /^[\x21-\x7e]{1,1024}$/.test(key) ? key : undefined;
    } finally {
      bytes.fill(0);
    }
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Load once during Node startup. The environment contains only a file reference. */
export function captureSeparateOpenAiVoiceCredential() {
  const filename = process.env[configurationName];
  if (filename === undefined) return;
  delete process.env[configurationName];
  delete host[authorityKey];
  const mode = process.env.VDT_APP_MODE ?? process.env.NEXT_PUBLIC_VDT_APP_MODE;
  if (mode !== "development_web" || process.env.VDT_OPENAI_SPEECH_BYOK_ENABLED !== "true") return;
  const key = readPrivateVoiceKey(filename);
  if (!key) return;
  host[authorityKey] = {
    fingerprint: createHash("sha256").update(key).digest("hex"),
    use: invoke => invoke(key)
  };
}

export function separateOpenAiVoiceFingerprint() {
  return host[authorityKey]?.fingerprint;
}

export function withSeparateOpenAiVoiceCredential<T>(fingerprint: string, invoke: (key: string) => T): T | undefined {
  const credential = host[authorityKey];
  if (credential?.fingerprint === fingerprint) return credential.use(invoke);
}
