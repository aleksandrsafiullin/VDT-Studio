import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverCodexSpeechProtocol, type CodexSpeechProtocolEvidence } from "@vdt-studio/local-runner/codex-subscription-capability";
import { probeOwnedCliOutput, selectCodexExecutable } from "@vdt-studio/model-bridge/local-runtime";

export interface InstalledCodexSpeechProtocol extends CodexSpeechProtocolEvidence {
  buildFingerprint: string | null;
}

const unknown: InstalledCodexSpeechProtocol = { cliVersion: null, surface: "unknown", buildFingerprint: null };
const sandbox = "/usr/bin/sandbox-exec";
// dyld opens the system volume root during launch. Its literal allowance does
// not grant reads of descendants. OS libraries and caches are read-only here.
export const CODEX_SCHEMA_PROBE_SANDBOX = `(version 1)
(deny default)
(allow process-exec (literal (param "EXECUTABLE")))
(allow file-read* file-map-executable
  (literal (param "EXECUTABLE"))
  (subpath "/System/Library/Frameworks") (subpath "/System/Library/PrivateFrameworks")
  (subpath "/System/Library/dyld") (subpath "/usr/lib")
  (subpath "/System/Cryptexes/OS/System/Library/dyld")
  (subpath "/System/Volumes/Preboot/Cryptexes/OS/System/Library/dyld"))
(allow file-read* file-write* (subpath (param "SCRATCH")))
(allow file-read-data (literal "/"))
(allow sysctl-read
  (sysctl-name "kern.osproductversion" "kern.osrelease" "kern.ostype" "kern.iossupportversion" "kern.osvariant_status"
    "security.mac.lockdown_mode_state" "machdep.cpu.brand_string")
  (sysctl-name-regex #"^hw[.]"))`;
const maxSchemaBytes = 4 * 1024 * 1024;
const maxBinaryBytes = 512n * 1024n * 1024n;
const safeRead = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
let cleanupUnconfirmed = false;

function buildIdentity(info: Awaited<ReturnType<typeof lstat>>) {
  return `${info.dev}/${info.ino}/${info.size}/${info.mtimeMs}/${info.ctimeMs}`;
}

async function executableIdentity(executable: string) {
  const info = await lstat(executable);
  if (!info.isFile() || await realpath(executable) !== executable) throw new Error("Invalid CLI executable.");
  return buildIdentity(info);
}

async function readClientSchema(directory: string) {
  if (await realpath(directory) !== directory) throw new Error("Invalid schema directory.");
  const file = await open(join(directory, "ClientRequest.json"), safeRead);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > maxSchemaBytes) throw new Error("Invalid schema file.");
    const contents = Buffer.alloc(info.size + 1);
    const { bytesRead } = await file.read(contents, 0, contents.length, 0);
    if (bytesRead !== info.size) throw new Error("Schema changed during inspection.");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(contents.subarray(0, bytesRead))) as unknown;
  } finally {
    await file.close();
  }
}

async function fingerprint(executable: string, expectedIdentity: string, signal: AbortSignal) {
  const file = await open(executable, safeRead);
  try {
    const info = await file.stat();
    if (!info.isFile() || BigInt(info.size) > maxBinaryBytes || buildIdentity(info) !== expectedIdentity) throw new Error("CLI build changed.");
    const hash = createHash("sha256");
    const stream = file.createReadStream({ autoClose: false, end: info.size - 1, signal });
    for await (const chunk of stream) hash.update(chunk as Buffer);
    if (buildIdentity(await file.stat()) !== expectedIdentity || await executableIdentity(executable) !== expectedIdentity) {
      throw new Error("CLI build changed.");
    }
    return hash.digest("hex");
  } finally {
    await file.close();
  }
}

/** Only fixed offline schema generation and version commands run here. */
export async function probeInstalledCodexSpeechProtocol(caller: AbortSignal): Promise<InstalledCodexSpeechProtocol> {
  if (process.platform !== "darwin" || caller.aborted || cleanupUnconfirmed) return unknown;
  const signal = AbortSignal.any([caller, AbortSignal.timeout(12_000)]);
  let scratch: string | undefined;
  let retain = false;
  try {
    const root = scratch = await mkdtemp(join(await realpath(tmpdir()), "vdt-codex-speech-protocol-"));
    const env: NodeJS.ProcessEnv = { NODE_ENV: "production", TMPDIR: root, PATH: "/usr/bin:/bin", LANG: "C" };
    const options = { signal, requireConfirmedCleanup: true };
    const run = (executable: string, args: readonly string[], timeout: number) =>
      probeOwnedCliOutput(sandbox, root, env, options, ["-D", `SCRATCH=${root}`,
        "-D", `EXECUTABLE=${executable}`, "-p", CODEX_SCHEMA_PROBE_SANDBOX, executable, ...args], timeout);
    const builds = new Map<string, string>();
    const selected = await selectCodexExecutable({ ...options, versionProbe: async (executable, args) => {
      const build = await executableIdentity(executable);
      const result = await run(executable, args, 1_500);
      if (build !== await executableIdentity(executable)) throw new Error("CLI build changed.");
      builds.set(executable, build);
      return result;
    } });
    if (!selected?.version) return unknown;
    const { executable, version } = selected;
    const build = builds.get(executable);
    if (!build) return unknown;
    const schema = async (experimental: boolean) => {
      signal.throwIfAborted();
      if (await executableIdentity(executable) !== build) throw new Error("CLI build changed.");
      const directory = join(root, experimental ? "experimental" : "stable");
      await mkdir(directory, { mode: 0o700 });
      await run(executable, ["app-server", "generate-json-schema", "--out", directory, ...(experimental ? ["--experimental"] : [])], 3_500);
      return readClientSchema(directory);
    };
    const stable = await schema(false);
    const stableEvidence = discoverCodexSpeechProtocol(version, stable, undefined);
    const evidence = stableEvidence.surface === "stable" ? stableEvidence : discoverCodexSpeechProtocol(version, stable, await schema(true));
    if (evidence.surface === "unknown") return unknown;
    return { ...evidence, buildFingerprint: await fingerprint(executable, build, signal) };
  } catch (failure) {
    retain = (failure as { code?: unknown } | null)?.code === "CLEANUP_UNCONFIRMED";
    if (retain) cleanupUnconfirmed = true;
    return unknown;
  } finally {
    if (scratch && !retain) await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}
