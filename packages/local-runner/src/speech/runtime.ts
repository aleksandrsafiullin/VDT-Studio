import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, open, readFile, rename, rm, statfs, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { pcmWave } from "./audio";
import { SPEECH_LICENSE_NOTICES } from "./notices";
import {
  SPEECH_MAX_AUDIO_BYTES, SPEECH_MODELS, SPEECH_SAMPLE_RATE,
  isSpeechLanguage, isSpeechModelId,
  type SpeechJobResult, type SpeechModelId, type SpeechRequest, type SpeechStatus
} from "./catalog";

const MODEL_REVISION = "5359861c739e955e79d9a303bcbc70fb988958b1";
const MODEL_HASHES: Record<SpeechModelId, string> = {
  tiny: "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21",
  base: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
  small: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b"
};
// Pinned static whisper.cpp builds; provenance and licensing: docs/VOICE_INPUT.md.
const ENGINE_RELEASE = "https://github.com/sjoerdteunisse/whisper.cpp/releases/download/v1.0.0/";
const ENGINES = {
  "darwin-arm64": { file: "whisper-cpp-darwin-arm64", bytes: 1_215_153, sha256: "7a2f420abef4313f49332f58c2c69bff5f65c37ad932d1fb09f7d95ffec45989", binarySha256: "ebc3c2a1d7d706bd3367c81a2d70ff1d0201576af7ada17516d9398e6e787656", downloadUrl: "https://github.com/OpenWhispr/whisper.cpp/releases/download/0.0.10/whisper-cpp-darwin-arm64.zip" },
  "darwin-x64": { file: "whisper-cpp-darwin-x64", bytes: 1_131_934, sha256: "f0f2ab6c2e92b7022ac02f0759a7a38f3ea110764e00b05a6f0d6c1dcadd571c", binarySha256: "4d7ffa39b71ab9847f519f61d1baddfeddd6c83a445ff87add54857cc41fbe18" },
  "win32-x64": { file: "whisper-cpp-win32-x64-cpu.exe", bytes: 718_766, sha256: "80f6b6481794825f65043001e408e70aea4257918b15906b7e070d2c7b205da5", binarySha256: "31ceb2a375f19c993ce52bf29b34c68449adac9b54cf0c840a16ac6fb24df262" }
} as const;
type Engine = (typeof ENGINES)[keyof typeof ENGINES];

export class SpeechError extends Error {
  constructor(message: string, readonly statusCode = 400) { super(message); }
}

export function parseSpeechRequest(value: unknown): SpeechRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SpeechError("Invalid voice input request.");
  const body = value as Record<string, unknown>;
  const keys: Record<string, string[]> = {
    status: ["operation"], install: ["operation", "modelId", "confirmed"], cancel_install: ["operation"],
    transcribe: ["operation", "modelId", "language", "audioBase64", "jobId"],
    result: ["operation", "jobId"], cancel: ["operation", "jobId"]
  };
  const allowed = typeof body.operation === "string" && Object.hasOwn(keys, body.operation) ? keys[body.operation] : undefined;
  if (!allowed || Object.keys(body).some((key) => !allowed.includes(key))) throw new SpeechError("Unsupported voice input operation or field.");
  if (body.operation === "install" || body.operation === "transcribe") {
    if (!isSpeechModelId(body.modelId)) throw new SpeechError("Choose a supported speech model.");
  }
  if (body.operation === "install" && body.confirmed !== true) throw new SpeechError("Confirm the speech model download first.");
  if (body.operation === "transcribe" || body.operation === "result" || body.operation === "cancel") {
    if (typeof body.jobId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.jobId)) {
      throw new SpeechError("Invalid transcription identifier.");
    }
  }
  if (body.operation === "transcribe") {
    if (!isSpeechLanguage(body.language)) throw new SpeechError("Choose a supported dictation language.");
    if (typeof body.audioBase64 !== "string" || body.audioBase64.length > Math.ceil(SPEECH_MAX_AUDIO_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.audioBase64)) {
      throw new SpeechError("The audio fragment is invalid or too large.");
    }
  }
  return body as unknown as SpeechRequest;
}

function speechDirectory(): string {
  if (process.env.VDT_SPEECH_DATA_DIR) return path.resolve(process.env.VDT_SPEECH_DATA_DIR);
  const base = process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support")
    : process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(base, "VDT Studio", "speech");
}

interface SpeechRuntimeOptions {
  directory?: string;
  platform?: string;
  arch?: string;
  fetcher?: typeof fetch;
  /** Test seam. Never accepted from browser/IPC requests. */
  recognize?: (model: string, wav: Uint8Array, language: string, signal: AbortSignal) => Promise<string>;
}

interface SpeechJob { result: SpeechJobResult; controller: AbortController; updated: number }

export class SpeechRuntime {
  readonly directory: string;
  readonly #engine: Engine | undefined;
  readonly #fetcher: typeof fetch;
  readonly #recognize: SpeechRuntimeOptions["recognize"];
  #installation: SpeechStatus["installation"] = { state: "idle", downloadedBytes: 0, totalBytes: 0 };
  #installController: AbortController | undefined;
  #jobs = new Map<string, SpeechJob>();
  #recognizing = false;
  #verified = new Map<string, { size: number; mtime: number }>();

  constructor(options: SpeechRuntimeOptions = {}) {
    this.directory = options.directory ?? speechDirectory();
    this.#engine = ENGINES[`${options.platform ?? process.platform}-${options.arch ?? process.arch}` as keyof typeof ENGINES];
    this.#fetcher = options.fetcher ?? fetch;
    this.#recognize = options.recognize;
  }

  async request(input: unknown): Promise<SpeechStatus | SpeechJobResult> {
    const request = parseSpeechRequest(input);
    if (request.operation === "status") return this.status();
    if (!this.#engine) throw new SpeechError("Local voice input supports macOS (Apple silicon / Intel) and Windows x64.");
    if (request.operation === "install") return this.install(request.modelId);
    if (request.operation === "cancel_install") {
      this.#installController?.abort();
      return this.status();
    }
    if (request.operation === "transcribe") return this.transcribe(request);
    const job = this.#jobs.get(request.jobId);
    if (!job) throw new SpeechError("This transcription has expired. Start dictation again.", 404);
    job.updated = Date.now();
    if (request.operation === "cancel") {
      job.controller.abort();
      job.result = { state: "cancelled" };
    }
    return job.result;
  }

  async status(): Promise<SpeechStatus> {
    const engineReady = Boolean(this.#engine && await this.verifiedFile(this.enginePath(), this.#engine.binarySha256));
    const installed = await Promise.all(SPEECH_MODELS.map(async (model) =>
      await this.verifiedFile(this.modelPath(model.id), MODEL_HASHES[model.id], model.bytes) ? model.id : undefined));
    return {
      supported: Boolean(this.#engine), engineReady,
      installedModels: installed.filter((id): id is SpeechModelId => Boolean(id)),
      installation: { ...this.#installation },
      ...(!this.#engine ? { message: "Local voice input supports macOS (Apple silicon / Intel) and Windows x64." } : {})
    };
  }

  private modelPath(id: SpeechModelId): string { return path.join(this.directory, `ggml-${id}.bin`); }
  private enginePath(): string { return path.join(this.directory, this.#engine?.file ?? "unavailable"); }
  private async verifiedFile(file: string, digest: string, size?: number): Promise<boolean> {
    if (!/^[a-f0-9]{64}$/.test(digest)) return false;
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || (size !== undefined && stat.size !== size)) return false;
      const cached = this.#verified.get(file);
      if (cached?.size === stat.size && cached.mtime === stat.mtimeMs) return true;
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(file)) hash.update(chunk);
      if (hash.digest("hex") !== digest) return false;
      this.#verified.set(file, { size: stat.size, mtime: stat.mtimeMs });
      return true;
    } catch { return false; }
  }

  private async install(modelId: SpeechModelId): Promise<SpeechStatus> {
    if (this.#installController) throw new SpeechError("A speech model download is already in progress.", 409);
    const controller = new AbortController();
    this.#installController = controller;
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      if ((await lstat(this.directory)).isSymbolicLink()) throw new SpeechError("The voice input directory must not be a symbolic link.");
      const model = SPEECH_MODELS.find((entry) => entry.id === modelId)!;
      const disk = await statfs(this.directory);
      if (disk.bavail * disk.bsize < model.bytes * 2 + 256 * 1024 * 1024) throw new SpeechError("Free at least 1.5 GB of disk space before installing a speech model.");
      const status = await this.status();
      if (status.engineReady && status.installedModels.includes(modelId) && this.#installation.state === "ready") { this.#installController = undefined; return status; }
      this.#installation = { state: "downloading", phase: "engine", modelId, downloadedBytes: 0, totalBytes: model.bytes + this.#engine!.bytes };
      void this.performInstall(modelId, status, controller).finally(() => { this.#installController = undefined; });
      return this.status();
    } catch (error) { this.#installController = undefined; throw error; }
  }

  private async performInstall(modelId: SpeechModelId, initial: SpeechStatus, controller: AbortController): Promise<void> {
    const engine = this.#engine!;
    // Only this attempt's staging directory is removed, including on failure/cancel.
    let staging: string | undefined;
    try {
      staging = await mkdtemp(path.join(this.directory, ".install-"));
      if (!initial.engineReady) {
        const archive = path.join(staging, "engine.zip");
        const asset = engine.file.replace(/\.exe$/, "");
        await this.download("downloadUrl" in engine ? engine.downloadUrl : `${ENGINE_RELEASE}${asset}.zip`, archive, engine.bytes, engine.sha256, controller.signal);
        const binary = extractPinnedExecutable(await readFile(archive), engine.file);
        const target = path.join(staging, engine.file);
        await writeFile(target, binary, { flag: "wx", mode: 0o700 });
        await chmod(target, 0o700);
        if (createHash("sha256").update(binary).digest("hex") !== engine.binarySha256) throw new SpeechError("Speech engine verification failed.");
        controller.signal.throwIfAborted();
        await rename(target, this.enginePath());
      }
      this.#installation.phase = "model";
      if (!initial.installedModels.includes(modelId)) {
        const model = SPEECH_MODELS.find((entry) => entry.id === modelId)!;
        const target = path.join(staging, "model.bin");
        await this.download(`https://huggingface.co/ggerganov/whisper.cpp/resolve/${MODEL_REVISION}/ggml-${modelId}.bin`, target, model.bytes, MODEL_HASHES[modelId], controller.signal);
        controller.signal.throwIfAborted();
        await rename(target, this.modelPath(modelId));
      }
      this.#installation = { ...this.#installation, state: "verifying", downloadedBytes: this.#installation.totalBytes };
      // Validate real inference before advertising a freshly installed recognizer as ready.
      await this.recognize(this.modelPath(modelId), pcmWave(new Float32Array(SPEECH_SAMPLE_RATE)), "en", controller.signal);
      await writeFile(path.join(this.directory, "LICENSES.txt"), SPEECH_LICENSE_NOTICES, { mode: 0o600 });
      this.#installation = { ...this.#installation, state: "ready" };
    } catch (error) {
      this.#installation = {
        ...this.#installation, state: controller.signal.aborted ? "cancelled" : "error",
        ...(controller.signal.aborted ? {} : { error: error instanceof SpeechError ? error.message : "The download could not be completed. Check your connection and try again." })
      };
    } finally {
      if (staging) await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async download(url: string, file: string, expectedBytes: number, digest: string, signal: AbortSignal): Promise<void> {
    const timeout = AbortSignal.timeout(15 * 60_000);
    const combined = AbortSignal.any([signal, timeout]);
    let response: Response | undefined;
    for (let redirects = 0; redirects < 8; redirects++) {
      const target = new URL(url);
      if (target.protocol !== "https:" || !allowedDownloadHost(target.hostname)) throw new SpeechError("The model download returned an unsupported destination.");
      response = await this.#fetcher(target, { signal: combined, redirect: "manual" });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) throw new SpeechError("The model download could not be opened.");
        url = new URL(location, target).href;
      } else break;
    }
    if (!response?.ok || !response.body) throw new SpeechError("The download is unavailable. Check your connection and try again.");
    const output = await open(file, "wx", 0o600);
    const hash = createHash("sha256");
    let bytes = 0;
    try {
      const reader = response.body.getReader();
      for (;;) {
        combined.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > expectedBytes) { await reader.cancel(); throw new SpeechError("The downloaded file has an unexpected size."); }
        hash.update(value);
        await output.writeFile(value);
        this.#installation.downloadedBytes += value.byteLength;
      }
      this.#installation.state = "verifying";
      if (bytes !== expectedBytes || hash.digest("hex") !== digest) throw new SpeechError("Download verification failed. Please retry.");
      this.#installation.state = "downloading";
    } finally { await output.close(); }
  }

  private async transcribe(request: Extract<SpeechRequest, { operation: "transcribe" }>): Promise<SpeechJobResult> {
    for (const [id, job] of this.#jobs) if (Date.now() - job.updated > 120_000 && job.result.state !== "processing") this.#jobs.delete(id);
    if (this.#jobs.has(request.jobId)) throw new SpeechError("This transcription identifier is already in use.", 409);
    if (this.#recognizing) throw new SpeechError("Voice recognition is busy. Try again in a moment.", 409);
    if (this.#jobs.size >= 100) throw new SpeechError("Too many transcription requests. Try again shortly.", 429);
    const wav = Buffer.from(request.audioBase64, "base64");
    validateSpeechWave(wav);
    const job: SpeechJob = { result: { state: "processing" }, controller: new AbortController(), updated: Date.now() };
    this.#recognizing = true;
    this.#jobs.set(request.jobId, job);
    try {
      const status = await this.status();
      if (!status.engineReady || !status.installedModels.includes(request.modelId)) throw new SpeechError("Download the selected speech model in Settings → Voice input first.", 409);
    } catch (error) { this.#recognizing = false; this.#jobs.delete(request.jobId); throw error; }
    const recognize = this.#recognize ?? this.recognize.bind(this);
    void Promise.resolve().then(() => recognize(this.modelPath(request.modelId), wav, request.language, job.controller.signal))
      .then((text) => {
        if (!job.controller.signal.aborted) job.result = { state: "complete", text: text.trim().slice(0, 20_000) };
      })
      .catch((error) => {
        job.result = job.controller.signal.aborted ? { state: "cancelled" }
          : { state: "error", error: error instanceof SpeechError ? error.message : "Recognition failed. Try a shorter phrase or a smaller model." };
      })
      .finally(() => { this.#recognizing = false; job.updated = Date.now(); });
    return { state: "processing" };
  }

  private async recognize(model: string, wav: Uint8Array, language: string, signal: AbortSignal): Promise<string> {
    const directory = await mkdtemp(path.join(os.tmpdir(), "vdt-speech-audio-"));
    try {
      const input = path.join(directory, "input.wav");
      await writeFile(input, wav, { flag: "wx", mode: 0o600 });
      const output = await runWhisper(this.enginePath(), ["-m", model, "-f", input, "-l", language, "-nt", "-np", "-t", "4", "-bs", "1", "-bo", "1", "-ng"], directory, signal);
      return output.replace(/\[(?:BLANK_AUDIO|SILENCE|MUSIC|NO_SPEECH)\]/gi, "").trim();
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
}

function allowedDownloadHost(host: string): boolean {
  return ["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com", "huggingface.co"].includes(host)
    || host.endsWith(".huggingface.co") || host.endsWith(".hf.co");
}

/** The SHA-256 pinned ZIP must contain exactly one regular executable, never paths/symlinks. */
export function extractPinnedExecutable(zip: Buffer, expectedName: string): Buffer {
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) if (zip.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0 || zip.readUInt16LE(end + 10) !== 1) throw new SpeechError("The speech engine archive is invalid.");
  const central = zip.readUInt32LE(end + 16);
  if (central + 46 > zip.length || zip.readUInt32LE(central) !== 0x02014b50) throw new SpeechError("The speech engine archive is invalid.");
  const name = zip.subarray(central + 46, central + 46 + zip.readUInt16LE(central + 28)).toString("utf8");
  const mode = zip.readUInt32LE(central + 38) >>> 16;
  if (name !== expectedName || (mode & 0xf000) === 0xa000) throw new SpeechError("The speech engine archive contains unexpected files.");
  const length = zip.readUInt32LE(central + 24);
  const compressed = zip.readUInt32LE(central + 20);
  const local = zip.readUInt32LE(central + 42);
  if (length > 32 * 1024 * 1024 || local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) throw new SpeechError("The speech engine archive exceeds its limits.");
  const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
  if (start + compressed > central) throw new SpeechError("The speech engine archive is truncated.");
  const data = zip.subarray(start, start + compressed);
  const method = zip.readUInt16LE(central + 10);
  const binary = method === 0 ? data : method === 8 ? inflateRawSync(data, { maxOutputLength: length }) : undefined;
  if (!binary || binary.length !== length) throw new SpeechError("The speech engine archive could not be unpacked.");
  return binary;
}

export function validateSpeechWave(wav: Buffer): void {
  if (wav.length < 44 || wav.length > SPEECH_MAX_AUDIO_BYTES || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE"
    || wav.toString("ascii", 12, 16) !== "fmt " || wav.readUInt32LE(16) !== 16 || wav.readUInt16LE(20) !== 1 || wav.readUInt16LE(22) !== 1
    || wav.readUInt32LE(24) !== SPEECH_SAMPLE_RATE || wav.readUInt32LE(28) !== SPEECH_SAMPLE_RATE * 2 || wav.readUInt16LE(32) !== 2 || wav.readUInt16LE(34) !== 16
    || wav.toString("ascii", 36, 40) !== "data" || wav.readUInt32LE(40) !== wav.length - 44 || wav.readUInt32LE(4) !== wav.length - 8 || wav.length % 2 !== 0) {
    throw new SpeechError("Voice input requires a bounded 16 kHz mono PCM audio fragment.");
  }
}

function runWhisper(binary: string, args: string[], cwd: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const environment: NodeJS.ProcessEnv = { ...process.env, GGML_METAL_DEVICES: "0" };
    // Do not load foreign native backends; CPU avoids per-fragment Metal compilation.
    delete environment.GGML_BACKEND_PATH;
    const child = spawn(binary, args, { cwd, env: environment, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: false });
    let output = "";
    let size = 0;
    let failed = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      failed = true;
      child.kill();
      killTimer ??= setTimeout(() => child.kill("SIGKILL"), 2000);
    };
    const timer = setTimeout(stop, 45_000);
    signal.addEventListener("abort", stop, { once: true });
    child.stdout.on("data", (data: Buffer) => { size += data.length; if (size > 128 * 1024) stop(); else output += data.toString("utf8"); });
    child.stderr.on("data", (data: Buffer) => { size += data.length; if (size > 128 * 1024) stop(); });
    child.once("error", () => { failed = true; });
    child.once("close", (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal.removeEventListener("abort", stop);
      if (failed || code !== 0) reject(new SpeechError("Local recognition failed. Try the Tiny model or restart dictation."));
      else resolve(output);
    });
  });
}

const globalSpeech = globalThis as typeof globalThis & { __vdtSpeechRuntime?: SpeechRuntime; __vdtSpeechRuntimeRevision?: number };
export function getSpeechRuntime(): SpeechRuntime {
  // Deliberately invalidate only when the local speech runtime contract changes during development.
  if (globalSpeech.__vdtSpeechRuntimeRevision !== 3) {
    globalSpeech.__vdtSpeechRuntime = new SpeechRuntime();
    globalSpeech.__vdtSpeechRuntimeRevision = 3;
  }
  return globalSpeech.__vdtSpeechRuntime ??= new SpeechRuntime();
}
