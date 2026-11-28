import { spawn } from "node:child_process";
import { lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SpeechError } from "./admission";
import {
  isSpeechLanguage, SPEECH_TTS_MAX_WAVE_BASE64, type AppleVoicePreviewSelection, type AppleVoiceStatus, type AppleSpeechLanguage
} from "./catalog";

export interface AppleVoiceAdapter {
  status(): Promise<AppleVoiceStatus>;
  recognize(wav: Uint8Array, locale: AppleSpeechLanguage, signal: AbortSignal): Promise<string>;
  install?(locale: AppleSpeechLanguage, systemLocale: string, signal: AbortSignal, onProgress: (fraction?: number) => void): Promise<void>;
  preview(selection: AppleVoicePreviewSelection): Promise<string>;
  synthesize?(selection: AppleVoicePreviewSelection, text: string, signal: AbortSignal): Promise<string>;
}

export class AppleVoiceOutputTooLargeError extends Error {
  constructor() { super("Apple spoken output exceeded the waveform limit."); }
}

const outputLimit = 750_000;
const recognitionStatuses = new Set(["installed", "asset_required", "downloading", "unsupported_locale", "unsupported_os_or_sdk", "unavailable"]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function voiceStatus(value: Record<string, unknown>): AppleVoiceStatus {
  if (value.status !== "ok" || value.boundary !== "on_device" || !Array.isArray(value.recognition) || !Array.isArray(value.installedVoices)
    || value.recognition.length > 20 || value.installedVoices.length > 400) throw new SpeechError("Apple voice metadata is unavailable.", 503);
  const recognition = value.recognition.map((entry: unknown): AppleVoiceStatus["recognition"][number] => {
    const value = asRecord(entry);
    if (!value || !isSpeechLanguage(value.locale) || value.locale === "auto" || typeof value.status !== "string" || !recognitionStatuses.has(value.status)) {
      throw new SpeechError("Apple recognition metadata is unavailable.", 503);
    }
    return {
      locale: value.locale, status: value.status as AppleVoiceStatus["recognition"][number]["status"],
      ...(typeof value.systemLocale === "string" && value.systemLocale.length <= 35 ? { systemLocale: value.systemLocale } : {})
    };
  });
  const voices = value.installedVoices.map((entry: unknown): AppleVoiceStatus["voices"][number] => {
    const value = asRecord(entry);
    if (!value || typeof value.id !== "string" || value.id.length > 200 || typeof value.label !== "string" || value.label.length > 200
      || typeof value.locale !== "string" || value.locale.length > 35 || typeof value.quality !== "number" || ![1, 2, 3].includes(value.quality)) {
      throw new SpeechError("Apple system voice metadata is unavailable.", 503);
    }
    return {
      id: value.id, label: value.label, locale: value.locale, quality: value.quality,
      ...(value.systemDefault === true ? { systemDefault: true } : {})
    };
  });
  return { state: "apple_voice_status", supported: true, recognition, voices };
}

/** The package host verifies the resources manifest and returns the canonical helper path on each launch. */
export function createAppleVoiceAdapter(verifiedHelper: () => Promise<string>): AppleVoiceAdapter {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new SpeechError("Apple voice helper is unavailable.", 503);

  async function call(request: object, signal?: AbortSignal, onProgress?: (fraction?: number) => void): Promise<Record<string, unknown>> {
    signal?.throwIfAborted();
    let executable: string;
    try {
      executable = await verifiedHelper();
      if (!path.isAbsolute(executable) || path.basename(executable) !== "vdt-apple-voice"
        || !(await lstat(executable)).isFile() || await realpath(executable) !== executable) {
        throw new Error("Helper path mismatch.");
      }
    } catch {
      throw new SpeechError("Apple voice helper is unavailable.", 503);
    }
    const scratch = await mkdtemp(path.join(os.tmpdir(), "vdt-apple-voice-"));
    try {
      signal?.throwIfAborted();
      return await new Promise((resolve, reject) => {
        const child = spawn(executable, [], { stdio: ["pipe", "pipe", "pipe"], env: { NODE_ENV: "production", TMPDIR: scratch } });
        const chunks: Buffer[] = [];
        let bytes = 0;
        const kill = () => { child.kill("SIGKILL"); };
        let terminal: Record<string, unknown> | undefined;
        let pending = "";
        let forceStop: ReturnType<typeof setTimeout> | undefined;
        const stop = () => {
          child.kill("SIGTERM");
          forceStop ??= setTimeout(kill, 2_000);
        };
        const timer = setTimeout(onProgress ? stop : kill, onProgress ? 20 * 60_000 : 20_000);
        signal?.addEventListener("abort", onProgress ? stop : kill, { once: true });
        child.stdout.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > outputLimit) kill();
          else if (!onProgress) chunks.push(chunk);
          else {
            pending += chunk.toString("utf8");
            const lines = pending.split("\n");
            pending = lines.pop() ?? "";
            for (const line of lines) {
              try {
                const frame = asRecord(JSON.parse(line));
                if (!frame || terminal) { kill(); return; }
                if (frame.status === "progress") {
                  const fraction = frame.fraction;
                  onProgress(typeof fraction === "number" && Number.isFinite(fraction) && fraction >= 0 && fraction <= 1 ? fraction : undefined);
                } else terminal = frame;
              } catch { kill(); return; }
            }
          }
        });
        child.stderr.resume();
        child.stdin.on("error", () => { /* The exit status reports a failed helper or closed pipe. */ });
        child.once("error", () => { /* close settles after all child streams close. */ });
        child.once("close", (code) => {
          clearTimeout(timer);
          if (forceStop) clearTimeout(forceStop);
          signal?.removeEventListener("abort", onProgress ? stop : kill);
          if (signal?.aborted) { reject(signal.reason); return; }
          if (code === 0 && bytes <= outputLimit) {
            try {
              const reply = onProgress ? terminal : asRecord(JSON.parse(Buffer.concat(chunks).toString("utf8")));
              if (reply) { resolve(reply); return; }
            } catch { /* Only a bounded, structured reply may cross the bridge. */ }
          }
          reject(new SpeechError("Apple voice helper could not complete the request.", 503));
        });
        child.stdin.end(JSON.stringify(request));
      });
    } finally { await rm(scratch, { recursive: true, force: true }); }
  }

  return {
    async status() { return voiceStatus(await call({ operation: "status" })); },
    async recognize(wav, locale, signal) {
      const reply = await call({ operation: "recognize", locale, audioBase64: Buffer.from(wav).toString("base64") }, signal);
      if (reply.status !== "ok" || reply.boundary !== "on_device" || typeof reply.text !== "string" || reply.text.length > 20_000) {
        throw new SpeechError("Apple recognition is unavailable for this language. Check its on-device speech assets or select Whisper.");
      }
      return reply.text;
    },
    async install(locale, systemLocale, signal, onProgress) {
      const reply = await call({ operation: "install_asset", locale, systemLocale, confirmed: true }, signal, onProgress);
      if (reply.status !== "installed") throw new SpeechError("Apple could not confirm the selected speech assets.");
    },
    async preview(selection) {
      const reply = await call({ operation: "preview", ...selection });
      if (reply.status !== "ok" || reply.boundary !== "on_device" || typeof reply.waveformBase64 !== "string"
        || reply.waveformBase64.length > 613_400 || !/^[A-Za-z0-9+/]+={0,2}$/.test(reply.waveformBase64)) {
        throw new SpeechError("The local system voice could not prepare a preview.");
      }
      return reply.waveformBase64;
    },
    async synthesize(selection, text, signal) {
      const reply = await call({ operation: "synthesize", ...selection, text }, signal);
      if (reply.status === "output_too_large") throw new AppleVoiceOutputTooLargeError();
      if (reply.status !== "ok" || reply.boundary !== "on_device" || typeof reply.waveformBase64 !== "string"
        || reply.waveformBase64.length > SPEECH_TTS_MAX_WAVE_BASE64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(reply.waveformBase64)) {
        throw new SpeechError("The local system voice could not prepare spoken output.");
      }
      return reply.waveformBase64;
    }
  };
}
