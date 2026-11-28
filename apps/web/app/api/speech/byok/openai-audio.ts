import { awaitProviderSettlement } from "@vdt-studio/ai-harness/browser";
import { validateSpeechWave } from "@vdt-studio/local-runner/speech";
import { SPEECH_TTS_MAX_TEXT } from "@vdt-studio/local-runner/speech-catalog";

const endpoint = "https://api.openai.com/v1/audio";
export const OPENAI_TRANSCRIPTION_MODEL = "gpt-transcribe";
export const OPENAI_SPEECH_MODEL = "gpt-4o-mini-tts-2025-12-15";
export const OPENAI_SPEECH_SHUTDOWN = "2027-01-06";
const outputRate = 24_000;
const maxPcmBytes = outputRate * 2 * 24;
const maxTranscriptBytes = 16_384;

export const audioFailureStatus = {
  invalid_audio: 400,
  invalid_text: 400,
  credential_unavailable: 409,
  credentials_rejected: 403,
  speech_model_retired: 409,
  quota_exhausted: 429,
  rate_limited: 429,
  provider_unavailable: 502,
  invalid_response: 502,
  cleanup_unconfirmed: 503,
  cancelled: 409,
  timeout: 504
} as const;

export class OpenAiAudioError extends Error {
  constructor(readonly code: keyof typeof audioFailureStatus) {
    super(code);
    this.name = "OpenAiAudioError";
  }
}

export function assertOpenAiSpeechCompatibility() {
  if (Date.now() >= Date.parse(`${OPENAI_SPEECH_SHUTDOWN}T00:00:00.000Z`)) throw new OpenAiAudioError("speech_model_retired");
}

function mime(response: Response) {
  return response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
}

function cleanupUnconfirmed(error: unknown) {
  return error instanceof OpenAiAudioError ? error.code === "cleanup_unconfirmed"
    : Boolean(error && typeof error === "object" && "code" in error && error.code === "CLEANUP_UNCONFIRMED");
}

async function confirmCancel(cancel: Promise<void>) {
  try { await awaitProviderSettlement(cancel, AbortSignal.abort()); }
  catch { throw new OpenAiAudioError("cleanup_unconfirmed"); }
}

async function rejectResponse(response: Response, code: keyof typeof audioFailureStatus): Promise<never> {
  if (response.body?.locked) throw new OpenAiAudioError("cleanup_unconfirmed");
  if (response.body) await confirmCancel(response.body.cancel());
  throw new OpenAiAudioError(code);
}

async function readAudioResponse(response: Response, limit: number, signal: AbortSignal) {
  const length = Number(response.headers.get("content-length"));
  if (!response.body || length > limit || response.body.locked) return rejectResponse(response, "invalid_response");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  let complete = false;
  try {
    for (;;) {
      signal.throwIfAborted();
      const part = await awaitProviderSettlement(reader.read(), signal);
      if (part.done) { complete = true; break; }
      bytes += part.value.byteLength;
      if (bytes > limit) throw new OpenAiAudioError("invalid_response");
      chunks.push(Buffer.from(part.value));
    }
  } finally {
    try { if (!complete) await confirmCancel(reader.cancel()); }
    finally { try { reader.releaseLock(); } catch { /* The cancelled pending read owns the lock. */ } }
  }
  return Buffer.concat(chunks, bytes);
}

async function readJson(response: Response, limit: number, signal: AbortSignal) {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readAudioResponse(response, limit, signal)));
}

async function readPcm(response: Response, signal: AbortSignal) {
  const contentType = mime(response);
  if (contentType !== "application/octet-stream" && contentType !== "audio/pcm") return rejectResponse(response, "invalid_response");
  const pcm = await readAudioResponse(response, maxPcmBytes, signal);
  const bytes = pcm.length;
  if (bytes < 2 || bytes % 2 !== 0) throw new OpenAiAudioError("invalid_response");
  const wave = Buffer.alloc(bytes + 44);
  wave.write("RIFF", 0); wave.writeUInt32LE(bytes + 36, 4); wave.write("WAVEfmt ", 8);
  wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(outputRate, 24); wave.writeUInt32LE(outputRate * 2, 28);
  wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write("data", 36); wave.writeUInt32LE(bytes, 40);
  wave.set(pcm, 44);
  return wave;
}

/** Narrow fixed-origin transport. Its key is supplied only by the admitted host lease. */
export class OpenAiAudio {
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly timeoutMs = 22_000) {}

  async transcribe(key: string, wave: Buffer, language: "en" | "ru" | "auto", signal: AbortSignal, beforeSend?: () => void) {
    try {
      if (wave.length <= 44) throw new Error();
      validateSpeechWave(wave);
    } catch { throw new OpenAiAudioError("invalid_audio"); }
    const form = new FormData();
    form.set("model", OPENAI_TRANSCRIPTION_MODEL);
    form.set("response_format", "json");
    if (language !== "auto") form.append("languages[]", language);
    form.set("file", new Blob([new Uint8Array(wave)], { type: "audio/wav" }), "voice.wav");
    return this.#request("transcriptions", key, form, signal, beforeSend, async (response, deadline) => {
      if (mime(response) !== "application/json") return rejectResponse(response, "invalid_response");
      const value = await readJson(response, maxTranscriptBytes, deadline);
      if (!value || typeof value.text !== "string" || value.text.length > 4096 || value.text.includes(key)) {
        throw new OpenAiAudioError("invalid_response");
      }
      return value.text.trim();
    });
  }

  async synthesize(key: string, text: string, signal: AbortSignal, beforeSend?: () => void) {
    assertOpenAiSpeechCompatibility();
    const input = text.trim();
    if (!input || input.length > SPEECH_TTS_MAX_TEXT || input.includes(key)) throw new OpenAiAudioError("invalid_text");
    return this.#request("speech", key, JSON.stringify({ model: OPENAI_SPEECH_MODEL, voice: "alloy", input,
      response_format: "pcm", stream_format: "audio" }), signal, beforeSend, readPcm);
  }

  async #request<T>(direction: "transcriptions" | "speech", key: string, body: string | FormData, caller: AbortSignal,
    beforeSend: (() => void) | undefined, read: (response: Response, signal: AbortSignal) => Promise<T>): Promise<T> {
    if (!/^[\x21-\x7e]{1,1024}$/.test(key)) throw new OpenAiAudioError("credential_unavailable");
    if (caller.aborted) throw new OpenAiAudioError("cancelled");
    beforeSend?.();
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = AbortSignal.any([caller, timeout]);
    const url = `${endpoint}/${direction}`;
    try {
      signal.throwIfAborted();
      const response = await awaitProviderSettlement(this.fetcher(url, {
        method: "POST", body, signal, redirect: "error", credentials: "omit", cache: "no-store",
        headers: { authorization: `Bearer ${key}`, ...(typeof body === "string" ? { "content-type": "application/json" } : {}) }
      }), signal);
      if (signal.aborted) return rejectResponse(response, caller.aborted ? "cancelled" : "timeout");
      if (response.redirected || (response.url && response.url !== url)) return rejectResponse(response, "provider_unavailable");
      if (response.status === 429) {
        if (mime(response) !== "application/json") return rejectResponse(response, "rate_limited");
        const error = await readJson(response, 4096, signal).then(value => value?.error?.code,
          error => { if (cleanupUnconfirmed(error)) throw error; return undefined; });
        signal.throwIfAborted();
        throw new OpenAiAudioError(error === "insufficient_quota" ? "quota_exhausted" : "rate_limited");
      }
      if (response.status === 401 || response.status === 403) return rejectResponse(response, "credentials_rejected");
      if (response.status !== 200) return rejectResponse(response, "provider_unavailable");
      let result: T;
      try { result = await read(response, signal); }
      catch (error) {
        if (error instanceof OpenAiAudioError || cleanupUnconfirmed(error)) throw error;
        throw new OpenAiAudioError("invalid_response");
      }
      signal.throwIfAborted();
      return result;
    } catch (error) {
      if (cleanupUnconfirmed(error)) throw new OpenAiAudioError("cleanup_unconfirmed");
      if (caller.aborted) throw new OpenAiAudioError("cancelled");
      if (timeout.aborted) throw new OpenAiAudioError("timeout");
      if (error instanceof OpenAiAudioError) throw error;
      throw new OpenAiAudioError("provider_unavailable");
    }
  }
}
