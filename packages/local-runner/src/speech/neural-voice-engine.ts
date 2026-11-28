import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { SPEECH_TTS_MAX_TEXT, SPEECH_TTS_MAX_WAVE_BASE64, type AppleVoicePreviewSelection } from "./catalog";
import type { NeuralVoiceAssetInstaller } from "./neural-voice-assets";

const MAX_WAVE_BYTES = Math.floor(SPEECH_TTS_MAX_WAVE_BASE64 / 4) * 3;
const HEADER_BYTES = 44;
const PIPER_VERSION_METADATA = "piper_tts-1.5.0.dist-info/METADATA";
const PIPER_MODULE = "import runpy,sys;sys.path.insert(0,sys.argv.pop(1));runpy.run_module('piper',run_name='__main__')";
const SANDBOX = "(version 1)(allow default)(deny network*)(deny file-write*)";
const isDigest = (value: string) => /^[a-f0-9]{64}$/.test(value);

export interface NeuralVoiceEngine {
  synthesize(preview: AppleVoicePreviewSelection, text: string, signal: AbortSignal): Promise<string>;
}

/** Supplied by the trusted host after approving an external Piper 1.5.0 installation. */
export interface PiperInstallation {
  readonly python: string;
  readonly pythonSha256: string;
  readonly libraries: string;
  readonly librariesSha256: string;
}

async function hashFile(path: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const hash = createHash("sha256");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await file.stat({ bigint: true });
    if (!opened.isFile() || (opened.mode & 0o022n)) throw new Error("The approved Piper file is unavailable.");
    const size = Number(opened.size);
    const bytes = Buffer.allocUnsafe(Math.min(size, 64 * 1024));
    for (let offset = 0; offset < size;) {
      signal.throwIfAborted();
      const { bytesRead } = await file.read(bytes, 0, Math.min(bytes.length, size - offset), offset);
      if (!bytesRead) throw new Error("The approved Piper file changed.");
      hash.update(bytes.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const current = await lstat(path, { bigint: true });
    if (opened.dev !== current.dev || opened.ino !== current.ino || opened.size !== current.size
      || opened.ctimeNs !== current.ctimeNs || opened.mtimeNs !== current.mtimeNs) throw new Error("The approved Piper file changed.");
    return hash.digest("hex");
  } finally { await file.close(); }
}

/** Seal a dedicated, app-owned external engine tree after auditing its provenance. */
export async function hashPiperLibraries(directory: string, signal: AbortSignal): Promise<string> {
  if (!isAbsolute(directory) || await realpath(directory) !== directory) throw new Error("Invalid Piper libraries directory.");
  const digest = createHash("sha256");
  async function visit(path: string) {
    signal.throwIfAborted();
    const entry = await lstat(path);
    if ((entry.mode & 0o022) || entry.uid !== process.getuid?.()) throw new Error("Piper libraries must be owned by this user.");
    if (entry.isDirectory()) {
      digest.update(JSON.stringify([relative(directory, path), "directory"]));
      for (const name of (await readdir(path)).sort()) await visit(join(path, name));
    } else if (entry.isFile() && entry.nlink === 1) {
      digest.update(JSON.stringify([relative(directory, path), await hashFile(path, signal)]));
    } else throw new Error("Piper libraries contain an unsupported entry.");
  }
  await visit(directory);
  return digest.digest("hex");
}

function render(installation: PiperInstallation, directory: string, preview: AppleVoicePreviewSelection, text: string, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn("/usr/bin/sandbox-exec", ["-p", SANDBOX, installation.python, "-I", "-B", "-S", "-c",
      PIPER_MODULE, installation.libraries, "-m", join(directory, "model.onnx"), "-c", join(directory, "model.onnx.json"),
      "--output-raw", "--length-scale", String(100 / preview.ratePercent), "--volume", String(preview.volumePercent / 100)],
    { cwd: directory, env: { PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8", NODE_ENV: "production" }, stdio: ["pipe", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    const stop = () => { failed = true; child.kill("SIGKILL"); };
    const timeout = setTimeout(stop, 20_000);
    signal.addEventListener("abort", stop, { once: true });
    child.on("error", () => { failed = true; });
    child.stdout.on("data", (data: Buffer) => {
      size += data.length;
      if (size + HEADER_BYTES > MAX_WAVE_BYTES) stop();
      if (!failed) chunks.push(data);
    });
    child.once("close", code => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", stop);
      if (failed || code !== 0) reject(new Error("Piper could not synthesize the selected voice."));
      else resolve(Buffer.concat(chunks, size));
    });
    child.stdin.on("error", stop);
    child.stdin.end(`${text}\n`, "utf8");
  });
}

function waveBase64(pcm: Buffer, sampleRate: number): string {
  if (!pcm.length || pcm.length % 2 || pcm.length + HEADER_BYTES > MAX_WAVE_BYTES) {
    throw new Error("Piper returned invalid PCM.");
  }
  const header = Buffer.alloc(HEADER_BYTES);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]).toString("base64");
}

export function createPiperVoiceEngine(options: PiperInstallation, assets: NeuralVoiceAssetInstaller): NeuralVoiceEngine & {
  verifyInstallation(signal: AbortSignal): Promise<void>;
} {
  if (process.platform !== "darwin" || process.arch !== "arm64" || !isAbsolute(options.python)
    || !isDigest(options.pythonSha256) || !isDigest(options.librariesSha256)) {
    throw new Error("The approved Piper engine requires macOS ARM64 and an exact installation identity.");
  }
  const installation = Object.freeze({ ...options });
  async function verifyInstallation(signal: AbortSignal) {
    if (await realpath(installation.python) !== installation.python
      || await hashFile(installation.python, signal) !== installation.pythonSha256
      || await hashPiperLibraries(installation.libraries, signal) !== installation.librariesSha256
      || !(await lstat(join(installation.libraries, PIPER_VERSION_METADATA))).isFile()) {
      throw new Error("The approved Piper installation could not be verified.");
    }
  }
  return {
    verifyInstallation,
    async synthesize(preview, text, signal) {
      if (!text.trim() || text.length > SPEECH_TTS_MAX_TEXT || /[\x00-\x1f\x7f]/.test(text)) {
        throw new Error("Invalid neural speech text.");
      }
      return assets.withVerifiedAssets(preview.voiceId, async (voice, directory) => {
        if (voice.locale !== (preview.locale === "en" ? "en-US" : "ru-RU")) throw new Error("Neural voice locale mismatch.");
        await verifyInstallation(signal);
        return waveBase64(await render(installation, directory, preview, text, signal), voice.sampleRate);
      });
    }
  };
}
