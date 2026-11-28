import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, open, readFile, rename, rm, statfs, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { inflateRawSync } from "node:zlib";
import { SpeechError, admitDictationSelection, parseAppleVoicePreview, parseSpeechSelection } from "./admission";
import { AppleVoiceOutputTooLargeError, type AppleVoiceAdapter } from "./apple-voice";
import { pcmWave } from "./audio";
import type { NeuralVoiceEngine } from "./neural-voice-engine";
import { SPEECH_LICENSE_NOTICES } from "./notices";
import {
  SPEECH_MAX_AUDIO_BYTES, SPEECH_MODELS, SPEECH_SAMPLE_RATE, SPEECH_TTS_MAX_TEXT, SPEECH_TTS_MAX_WAVE_BASE64,
  isSpeechLanguage, isSpeechModelId, type AppleAssetOffer, type AppleAssetSetup, type AppleSpeechLanguage,
  type SpeechJobResult, type SpeechModelId, type SpeechRequest, type SpeechResponse, type SpeechSessionAdmission, type SpeechStatus,
  type SpeechSynthesisGrant, type SpeechSynthesisResult
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

export { SpeechError } from "./admission";
export { createAppleVoiceAdapter, type AppleVoiceAdapter } from "./apple-voice";
export { NeuralVoiceAssetInstaller } from "./neural-voice-assets";
export { NEURAL_VOICES } from "./neural-voice-catalog";
export { createPiperVoiceEngine } from "./neural-voice-engine";

const SESSION_IDLE_MS = 120_000;
export const SPEECH_TTS_LEASE_MS = 30_000;
const validIdentifier = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function parseTtsInput(confirmed: unknown, eventId: unknown, text: unknown) {
  if (confirmed !== true || typeof eventId !== "string" || !/^[a-f0-9]{64}$/.test(eventId)
    || typeof text !== "string" || !text.trim() || text.length > SPEECH_TTS_MAX_TEXT || /[\x00-\x1f\x7f]/.test(text)) {
    throw new SpeechError("Confirm local speech and provide a valid spoken notification.");
  }
  return { confirmed, eventId, text } as const;
}

export function parseSpeechRequest(value: unknown): SpeechRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SpeechError("Invalid voice input request.");
  const body = value as Record<string, unknown>;
  const keys: Record<string, string[]> = {
    status: ["operation"], install: ["operation", "modelId", "confirmed"], cancel_install: ["operation"],
    apple_status: ["operation"], apple_preview: ["operation", "preview"],
    open_tts: ["operation", "selection", "preview", "eventId", "text", "confirmed"], tts_result: ["operation", "sessionId"], close_tts: ["operation", "sessionId"],
    apple_install_offer: ["operation", "locale"], apple_install: ["operation", "locale", "setupId", "confirmed"],
    apple_install_status: ["operation", "setupId"], apple_cancel_install: ["operation", "setupId"],
    open_session: ["operation", "selection"], close_session: ["operation", "sessionId"], keep_session: ["operation", "sessionId"],
    transcribe: ["operation", "sessionId", "audioBase64", "jobId"],
    result: ["operation", "sessionId", "jobId"], cancel: ["operation", "sessionId", "jobId"]
  };
  const allowed = typeof body.operation === "string" && Object.hasOwn(keys, body.operation) ? keys[body.operation] : undefined;
  if (!allowed || Object.keys(body).some((key) => !allowed.includes(key))) throw new SpeechError("Unsupported voice input operation or field.");
  if (body.operation === "install") {
    if (!isSpeechModelId(body.modelId)) throw new SpeechError("Choose a supported speech model.");
    if (body.confirmed !== true) throw new SpeechError("Confirm the speech model download first.");
  }
  if (allowed.includes("locale") && (!isSpeechLanguage(body.locale) || body.locale === "auto")) throw new SpeechError("Choose a supported Apple speech language.");
  if (allowed.includes("setupId") && !validIdentifier(body.setupId)) throw new SpeechError("Open the Apple speech setup confirmation first.");
  if (body.operation === "apple_install" && body.confirmed !== true) throw new SpeechError("Confirm the Apple speech asset download first.");
  if (body.operation === "apple_preview") return { operation: "apple_preview", preview: parseAppleVoicePreview(body.preview) };
  if (body.operation === "open_tts") {
    const utterance = parseTtsInput(body.confirmed, body.eventId, body.text);
    return { operation: "open_tts", selection: parseSpeechSelection(body.selection), preview: parseAppleVoicePreview(body.preview),
      ...utterance };
  }
  if (body.operation === "open_session") return { operation: "open_session", selection: parseSpeechSelection(body.selection) };
  if (allowed.includes("sessionId") && !validIdentifier(body.sessionId)) throw new SpeechError("Invalid voice session identifier.");
  if (allowed.includes("jobId") && !validIdentifier(body.jobId)) throw new SpeechError("Invalid transcription identifier.");
  if (body.operation === "transcribe") {
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
  /** The native package host owns the exact installed helper. */
  appleVoice?: AppleVoiceAdapter;
  /** Optional host-owned external engine. Never accepted from browser/IPC requests. */
  neuralVoice?: NeuralVoiceEngine;
  /** Test seam. Never accepted from browser/IPC requests. */
  recognize?: (model: string, wav: Uint8Array, language: string, signal: AbortSignal) => Promise<string>;
}

interface SpeechJob { result: SpeechJobResult; controller: AbortController; updated: number; sessionId: string }
interface ActiveSpeechSession { admission: SpeechSessionAdmission; touchedAt: number }
interface ActiveTts {
  admission: SpeechSynthesisGrant;
  controller: AbortController;
  expiry: ReturnType<typeof setTimeout>;
  result?: SpeechSynthesisResult;
}

export class SpeechRuntime {
  readonly directory: string;
  readonly #engine: Engine | undefined;
  readonly #fetcher: typeof fetch;
  readonly #recognize: SpeechRuntimeOptions["recognize"];
  readonly #appleVoice: AppleVoiceAdapter | undefined;
  readonly #neuralVoice: NeuralVoiceEngine | undefined;
  #preparingPreview = false;
  #appleOffer: { value: AppleAssetOffer; expiresAt: number } | undefined;
  #appleSetup: { id: string; controller: AbortController; result: AppleAssetSetup; active: boolean } | undefined;
  #installation: SpeechStatus["installation"] = { state: "idle", downloadedBytes: 0, totalBytes: 0 };
  #installController: AbortController | undefined;
  #jobs = new Map<string, SpeechJob>();
  #recognizing = false;
  #captureSession: ActiveSpeechSession | undefined;
  #openingSession = false;
  #tts: ActiveTts | undefined;
  #renderingTts = false;
  #spokenEvents = new Set<string>();
  #verified = new Map<string, { size: number; mtime: number }>();

  constructor(options: SpeechRuntimeOptions = {}) {
    this.directory = options.directory ?? speechDirectory();
    this.#engine = ENGINES[`${options.platform ?? process.platform}-${options.arch ?? process.arch}` as keyof typeof ENGINES];
    this.#fetcher = options.fetcher ?? fetch;
    this.#recognize = options.recognize;
    this.#appleVoice = options.appleVoice;
    this.#neuralVoice = options.neuralVoice;
  }

  async request(input: unknown): Promise<SpeechResponse> {
    const request = parseSpeechRequest(input);
    if (request.operation === "status") return this.status();
    if (request.operation === "apple_status") {
      return this.#appleVoice ? this.#appleVoice.status() : { state: "apple_voice_status", supported: false, recognition: [], voices: [] };
    }
    if (this.#captureSession && Date.now() - this.#captureSession.touchedAt > SESSION_IDLE_MS) {
      this.closeSession(this.#captureSession.admission.sessionId);
    }
    if (request.operation === "apple_install_offer") return this.appleInstallOffer(request.locale);
    if (request.operation === "apple_install") return this.beginAppleInstall(request);
    if (request.operation === "apple_install_status" || request.operation === "apple_cancel_install") {
      const setup = this.#appleSetup;
      if (!setup || setup.id !== request.setupId) throw new SpeechError("This Apple speech setup has expired.", 404);
      if (request.operation === "apple_cancel_install" && setup.active) {
        setup.result = { ...setup.result, phase: "cancelling" };
        setup.controller.abort();
      }
      return setup.result;
    }
    if (request.operation === "install") {
      if (!this.#engine) throw new SpeechError("Local voice input supports macOS (Apple silicon / Intel) and Windows x64.");
      return this.install(request.modelId);
    }
    if (request.operation === "cancel_install") {
      this.#installController?.abort();
      return this.status();
    }
    if (request.operation === "apple_preview") {
      if (!this.#appleVoice) throw new SpeechError("Apple system voices are unavailable on this host.", 409);
      if (this.#captureSession || this.#openingSession || this.#preparingPreview || this.#appleSetup?.active || this.#tts || this.#renderingTts) throw new SpeechError("Stop capture or the current spoken output before preparing a voice preview.", 409);
      this.#preparingPreview = true;
      try { return { state: "apple_voice_preview", waveformBase64: await this.#appleVoice.preview(request.preview) }; }
      finally { this.#preparingPreview = false; }
    }
    if (request.operation === "open_tts") return this.openTts(request);
    if (request.operation === "close_tts") {
      this.closeTts(request.sessionId);
      return { state: "closed" };
    }
    if (request.operation === "tts_result") {
      const active = this.#tts;
      if (!active || active.admission.sessionId !== request.sessionId) throw new SpeechError("Spoken output has expired.", 404);
      const result = active.result;
      if (result?.state === "tts_complete") active.result = { state: "tts_error" };
      return result ?? { state: "tts_processing" };
    }
    if (request.operation === "open_session") {
      const admitted = admitDictationSelection(request.selection, this.#appleVoice !== undefined);
      if (this.#appleSetup?.active) throw new SpeechError("Wait for Apple speech asset setup before starting capture.", 409);
      if (this.#preparingPreview || this.#tts || this.#renderingTts) throw new SpeechError("Wait for spoken playback to finish before starting capture.", 409);
      if (this.#captureSession || this.#openingSession) throw new SpeechError("Voice input already owns the microphone.", 409);
      this.#openingSession = true;
      try {
        await this.requireRecognizer(admitted);
        const admission: SpeechSessionAdmission = { ...admitted, sessionId: randomUUID() };
        this.#captureSession = { admission, touchedAt: Date.now() };
        return admission;
      } finally { this.#openingSession = false; }
    }

    if (request.operation === "close_session") {
      this.closeSession(request.sessionId);
      return { state: "closed" };
    }
    const session = this.#captureSession;
    if (!session || session.admission.sessionId !== request.sessionId) {
      throw new SpeechError("This voice session has expired. Start dictation again.", 404);
    }
    if (request.operation === "keep_session") {
      session.touchedAt = Date.now();
      return { state: "active" };
    }
    if (request.operation === "transcribe") {
      session.touchedAt = Date.now();
      return this.transcribe(request, session.admission);
    }
    const job = this.#jobs.get(request.jobId);
    if (!job || job.sessionId !== request.sessionId) throw new SpeechError("This transcription has expired. Start dictation again.", 404);
    session.touchedAt = Date.now();
    job.updated = Date.now();
    if (request.operation === "cancel") {
      job.controller.abort();
      job.result = { state: "cancelled" };
    }
    return job.result;
  }

  private openTts(request: Extract<SpeechRequest, { operation: "open_tts" }>): SpeechSynthesisGrant {
    const voice = this.#appleVoice;
    const { selection, preview, eventId } = request;
    if (!voice?.synthesize || selection.stt || selection.realtime || selection.tts?.providerId !== "apple_local"
      || selection.tts.modelId !== preview.voiceId || selection.language !== preview.locale) {
      throw new SpeechError("A verified installed Apple voice is required for spoken output.", 409);
    }
    return this.startTts(selection.scopeId, eventId, signal => voice.synthesize!(preview, request.text, signal));
  }

  /** Host-only entry point. The host selects the exact consented, installed voice. */
  openNeuralTts(request: Pick<Extract<SpeechRequest, { operation: "open_tts" }>, "preview" | "eventId" | "text" | "confirmed">
    & { scopeId: string }, engine = this.#neuralVoice): SpeechSynthesisGrant {
    if (!engine) throw new SpeechError("An approved neural voice engine is required.", 409);
    const { scopeId } = request;
    const { eventId, text } = parseTtsInput(request.confirmed, request.eventId, request.text);
    if (typeof scopeId !== "string" || !/^[a-f0-9]{64}$/.test(scopeId)) throw new SpeechError("Invalid speech scope.");
    const preview = parseAppleVoicePreview(request.preview);
    return this.startTts(scopeId, eventId, signal => engine.synthesize(preview, text, signal));
  }

  private startTts(scopeId: string, eventId: string, synthesize: (signal: AbortSignal) => Promise<string>): SpeechSynthesisGrant {
    if (this.#captureSession || this.#openingSession || this.#preparingPreview || this.#appleSetup?.active || this.#tts || this.#renderingTts) {
      throw new SpeechError("The local voice runtime is busy with capture or spoken output.", 409);
    }
    if (this.#spokenEvents.has(eventId)) throw new SpeechError("This notification was already received.", 409);
    const admission = { state: "tts_open", sessionId: randomUUID(), scopeId, eventId,
      boundary: "on_device", billing: "none", consent: "explicit_component" } as const;
    const controller = new AbortController();
    const active: ActiveTts = { admission, controller, expiry: setTimeout(() => this.closeTts(admission.sessionId), SPEECH_TTS_LEASE_MS) };
    active.expiry.unref?.();
    this.#tts = active;
    this.#spokenEvents.add(eventId);
    if (this.#spokenEvents.size > 2048) this.#spokenEvents.delete(this.#spokenEvents.values().next().value!);
    this.#renderingTts = true;
    void Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return synthesize(controller.signal);
    }).then(waveformBase64 => {
      if (this.#tts !== active) return;
      if (!waveformBase64 || waveformBase64.length > SPEECH_TTS_MAX_WAVE_BASE64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(waveformBase64)) {
        active.result = { state: "tts_error" };
      } else active.result = { state: "tts_complete", eventId, waveformBase64 };
    }, error => {
      if (this.#tts === active) {
        active.result = error instanceof AppleVoiceOutputTooLargeError
          ? { state: "tts_error", code: "waveform_too_large", eventId }
          : { state: "tts_error" };
      }
    }).finally(() => { this.#renderingTts = false; });
    return admission;
  }

  private closeTts(sessionId: string) {
    const active = this.#tts;
    if (!active || active.admission.sessionId !== sessionId) return;
    this.#tts = undefined;
    clearTimeout(active.expiry);
    active.controller.abort();
  }

  private async appleInstallOffer(locale: AppleSpeechLanguage): Promise<AppleAssetOffer> {
    if (!this.#appleVoice?.install) throw new SpeechError("Apple speech asset setup is unavailable on this host.", 409);
    if (this.#appleSetup?.active) throw new SpeechError("Apple speech asset setup is already in progress.", 409);
    const status = await this.#appleVoice.status();
    const match = status.recognition.find(item => item.locale === locale && item.status === "asset_required");
    if (!status.supported || !match?.systemLocale) throw new SpeechError("The selected language does not need or cannot use Apple speech setup.", 409);
    const value: AppleAssetOffer = { state: "apple_asset_offer", setupId: randomUUID(), locale, systemLocale: match.systemLocale };
    this.#appleOffer = { value, expiresAt: Date.now() + 60_000 };
    return value;
  }

  private beginAppleInstall(request: Extract<SpeechRequest, { operation: "apple_install" }>): AppleAssetSetup {
    const offer = this.#appleOffer;
    if (!offer || offer.expiresAt < Date.now() || offer.value.setupId !== request.setupId || offer.value.locale !== request.locale) {
      throw new SpeechError("Confirm a fresh setup for this Apple speech language.", 409);
    }
    const adapter = this.#appleVoice;
    if (!adapter?.install || this.#installController || this.#appleSetup?.active || this.#captureSession || this.#openingSession || this.#preparingPreview || this.#tts || this.#renderingTts) {
      throw new SpeechError("Finish the current voice operation before starting Apple speech setup.", 409);
    }
    this.#appleOffer = undefined;
    const setup = {
      id: request.setupId, controller: new AbortController(), active: true,
      result: { state: "apple_asset_setup", phase: "preparing", locale: request.locale } as AppleAssetSetup
    };
    this.#appleSetup = setup;
    const signal = setup.controller.signal;
    void Promise.resolve().then(async () => {
      signal.throwIfAborted();
      const current = await adapter.status();
      signal.throwIfAborted();
      if (!current.supported || !current.recognition.some(item => item.locale === request.locale
        && item.systemLocale === offer.value.systemLocale && item.status === "asset_required")) {
        throw new SpeechError("The selected Apple speech assets changed after confirmation.");
      }
      await adapter.install!(request.locale, offer.value.systemLocale, signal, fraction => {
        if (!signal.aborted) setup.result = { ...setup.result, phase: "downloading", ...(fraction === undefined ? {} : { fraction }) };
      });
      signal.throwIfAborted();
      setup.result = { ...setup.result, phase: "verifying" };
      const latest = await adapter.status();
      signal.throwIfAborted();
      if (!latest.recognition.some(item => item.locale === request.locale && item.systemLocale === offer.value.systemLocale && item.status === "installed")) {
        throw new SpeechError("Apple has not finished installing the selected assets.");
      }
      setup.result = { ...setup.result, phase: "ready" };
    }).catch(() => {
      setup.result = signal.aborted ? { ...setup.result, phase: "cancelled" }
        : { ...setup.result, phase: "error", error: "Apple could not confirm the speech assets. Refresh readiness or try setup again." };
    }).finally(() => { setup.active = false; });
    return setup.result;
  }

  private closeSession(sessionId: string): void {
    if (this.#captureSession?.admission.sessionId !== sessionId) return;
    this.#captureSession = undefined;
    for (const [jobId, job] of this.#jobs) {
      if (job.sessionId !== sessionId) continue;
      job.controller.abort();
      this.#jobs.delete(jobId);
    }
  }

  private async requireRecognizer(admission: Omit<SpeechSessionAdmission, "sessionId">): Promise<void> {
    if (admission.stt.providerId === "apple_local") {
      const status = await this.#appleVoice?.status();
      if (!status?.supported || !status.recognition.some(entry => entry.locale === admission.language && entry.status === "installed")) {
        throw new SpeechError("Apple recognition requires installed on-device assets for the selected language. Choose an installed language or select Whisper.", 409);
      }
      return;
    }
    const status = await this.status();
    if (!status.engineReady || !status.installedModels.includes(admission.stt.modelId)) {
      throw new SpeechError("Download the selected speech model in Settings → Voice input first.", 409);
    }
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
    if (this.#installController || this.#appleSetup?.active) throw new SpeechError("A speech model download is already in progress.", 409);
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

  private async transcribe(
    request: Extract<SpeechRequest, { operation: "transcribe" }>, admission: SpeechSessionAdmission
  ): Promise<SpeechJobResult> {
    for (const [id, job] of this.#jobs) if (Date.now() - job.updated > 120_000 && job.result.state !== "processing") this.#jobs.delete(id);
    if (this.#jobs.has(request.jobId)) throw new SpeechError("This transcription identifier is already in use.", 409);
    if (this.#recognizing) throw new SpeechError("Voice recognition is busy. Try again in a moment.", 409);
    if (this.#jobs.size >= 100) throw new SpeechError("Too many transcription requests. Try again shortly.", 429);
    const wav = Buffer.from(request.audioBase64, "base64");
    validateSpeechWave(wav);
    const job: SpeechJob = { result: { state: "processing" }, controller: new AbortController(), updated: Date.now(), sessionId: admission.sessionId };
    this.#recognizing = true;
    this.#jobs.set(request.jobId, job);
    try {
      if (admission.stt.providerId === "whisper_local") await this.requireRecognizer(admission);
    } catch (error) { this.#recognizing = false; this.#jobs.delete(request.jobId); throw error; }
    const recognize = this.#recognize ?? this.recognize.bind(this);
    void Promise.resolve().then(() => {
      job.controller.signal.throwIfAborted();
      if (admission.stt.providerId === "apple_local") {
        if (!this.#appleVoice || admission.language === "auto") throw new SpeechError("Apple recognition is unavailable.", 409);
        return this.#appleVoice.recognize(wav, admission.language, job.controller.signal);
      }
      return recognize(this.modelPath(admission.stt.modelId), wav, admission.language, job.controller.signal);
    })
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
    // The pinned CLI reads "-" from stdin. A fixed -of value preserves its
    // transcript callback without creating a file (no output format flags).
    const output = await runWhisper(this.enginePath(), [
      "-m", model, "-f", "-", "-of", "vdt-dictation", "-l", language, "-nt", "-np", "-t", "4", "-bs", "1", "-bo", "1", "-ng"
    ], this.directory, wav, signal);
    return output.replace(/\[(?:BLANK_AUDIO|SILENCE|MUSIC|NO_SPEECH)\]/gi, "").trim();
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

function runWhisper(binary: string, args: string[], cwd: string, wav: Uint8Array, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const environment: NodeJS.ProcessEnv = { ...process.env, GGML_METAL_DEVICES: "0" };
    // Do not load foreign native backends; CPU avoids per-fragment Metal compilation.
    delete environment.GGML_BACKEND_PATH;
    const child = spawn(binary, args, { cwd, env: environment, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false });
    const outputDecoder = new StringDecoder("utf8");
    let output = "";
    let diagnostics = "";
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
    child.stdout.on("data", (data: Buffer) => { size += data.length; if (size > 128 * 1024) stop(); else output += outputDecoder.write(data); });
    child.stderr.on("data", (data: Buffer) => {
      size += data.length;
      if (size > 128 * 1024) stop();
      else diagnostics += data.toString("latin1");
    });
    child.once("error", () => { failed = true; });
    child.once("close", (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal.removeEventListener("abort", stop);
      // The pinned CLI can exit zero after a WAV decode failure. Both release
      // sources acknowledge the byte count only after initializing the decoder.
      const acknowledged = diagnostics.split(/\r?\n/).slice(0, -1)
        .includes(`read_audio_data: read ${wav.byteLength} bytes from stdin`);
      if (failed || code !== 0 || !acknowledged) {
        reject(new SpeechError("Local recognition failed. Try the Tiny model or restart dictation."));
      } else {
        resolve(output + outputDecoder.end());
      }
    });
    child.stdin.on("error", stop);
    child.stdin.end(wav);
  });
}

const globalSpeech = globalThis as typeof globalThis & { __vdtSpeechRuntime?: SpeechRuntime; __vdtSpeechRuntimeRevision?: number };
export function getSpeechRuntime(options: Pick<SpeechRuntimeOptions, "appleVoice"> = {}): SpeechRuntime {
  // Deliberately invalidate only when the local speech runtime contract changes during development.
  if (globalSpeech.__vdtSpeechRuntimeRevision !== 9) {
    globalSpeech.__vdtSpeechRuntime = new SpeechRuntime(options);
    globalSpeech.__vdtSpeechRuntimeRevision = 9;
  }
  return globalSpeech.__vdtSpeechRuntime ??= new SpeechRuntime(options);
}
