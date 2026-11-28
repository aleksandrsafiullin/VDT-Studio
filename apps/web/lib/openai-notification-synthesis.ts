import { readBoundedText } from "@vdt-studio/ai-harness/browser";
import { z } from "zod";
import { checkOpenAiSpeechCredential, type OpenAiSpeechCredentialTarget } from "./openai-byok-speech-client";
import type { VoiceSynthesis } from "./voice-notification-queue";
import { projectCurrentVoiceReadback, type VoiceRunSnapshot } from "./voice-notifications";

interface OpenAiNotificationOptions {
  consent: OpenAiSpeechCredentialTarget;
  locale: "en" | "ru";
  current: () => boolean;
  snapshot: () => VoiceRunSnapshot | undefined;
  onFailure: (message: string | undefined) => void;
}

const readbackPurpose = "current_run_readback";
const grantResponse = z.object({ state: z.literal("granted"), direction: z.literal("tts"), grantId: z.uuid(),
  purpose: z.literal(readbackPurpose) });
const openResponse = z.object({ state: z.literal("open"), sessionId: z.uuid(), stt: z.literal("off"), tts: z.object({
  provider: z.literal("openai"), transport: z.literal("realtime_synthesis"), boundary: z.literal("provider_service"),
  billing: z.literal("api"), aiGeneratedVoice: z.literal(true), purpose: z.literal(readbackPurpose)
}) });
const maxWaveBase64 = Math.ceil((24_000 * 2 * 24 + 44) / 3) * 4;
const synthesisResponse = z.object({ state: z.literal("synthesized"), playbackId: z.uuid(), aiGeneratedVoice: z.literal(true),
  waveformBase64: z.string().min(60).max(maxWaveBase64).regex(/^[A-Za-z0-9+/]+={0,2}$/) });
const closeResponse = z.object({ state: z.literal("closed") }).strict();
const failureMessage = "OpenAI spoken updates are unavailable for this run.";
const cleanupMessage = "Could not confirm that the OpenAI spoken update closed. Try again after the session expires.";

export function createOpenAiNotificationSynthesis(options: OpenAiNotificationOptions,
  port: typeof fetch = fetch, play = playOpenAiWaveform): VoiceSynthesis {
  const target = options.consent;
  const requested = new Set<string>();
  async function request<T>(operation: object, schema: z.ZodType<T>, signal: AbortSignal, limit = 2_048) {
    const response = await port("/api/speech/byok", {
      method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", credentials: "same-origin",
      mode: "same-origin", redirect: "error", signal, body: JSON.stringify({ ...target, ...operation })
    });
    const body: unknown = JSON.parse(await readBoundedText(response, limit, "OpenAI spoken update", signal));
    if (!response.ok) {
      const failure = z.object({ error: z.string() }).safeParse(body);
      if (failure.success && failure.data.error === "readback_already_requested") throw new ReadbackAlreadyRequested();
      if (failure.success && failure.data.error === "quota_exhausted") {
        throw new SpokenUpdateError("OpenAI API quota is exhausted. Review API billing or turn off OpenAI spoken updates.");
      }
      if (failure.success && failure.data.error === "rate_limited") {
        throw new SpokenUpdateError("OpenAI API spoken updates are rate limited.");
      }
      throw new SpokenUpdateError(failureMessage);
    }
    return schema.parse(body);
  }

  return {
    async speak(notification, signal) {
      if (notification.kind !== "question" && notification.kind !== "approval") return;
      const current = () => {
        if (signal.aborted || !options.current()) return false;
        const snapshot = options.snapshot();
        if (snapshot?.runId !== target.runId) return false;
        const projected = projectCurrentVoiceReadback(snapshot, options.locale);
        return projected?.key === notification.key && projected.kind === notification.kind && projected.text === notification.text;
      };
      if (!current() || requested.has(notification.key)) return;
      options.onFailure(undefined);
      let sessionId: string | undefined;
      let failure: unknown;
      let waveform: string | undefined;
      try {
        const presenceSignal = AbortSignal.any([signal, AbortSignal.timeout(8_000)]);
        if (!await checkOpenAiSpeechCredential(target, presenceSignal, current, port)) {
          if (current()) throw new SpokenUpdateError(failureMessage);
          return;
        }
        if (!current()) return;
        const grant = await request({
          operation: "grant", selection: {
            direction: "tts", provider: "openai", credentialSource: "active_direct_openai",
            consent: "send_text_openai_api_billing_ai_voice", purpose: readbackPurpose
          }
        }, grantResponse, AbortSignal.timeout(8_000));
        if (!current()) return;
        const session = await request({
          operation: "open", selection: {
            stt: "off", tts: { provider: "openai", grantId: grant.grantId, transport: "realtime_synthesis" },
            recognitionLanguage: "auto", synthesisLanguage: options.locale
          }
        }, openResponse, AbortSignal.timeout(8_000));
        sessionId = session.sessionId;
        if (current()) {
          if (requested.has(notification.key)) return;
          requested.add(notification.key);
          const result = await request({
            operation: "synthesize", sessionId, operationId: crypto.randomUUID(),
            source: { kind: "verified_event", runId: target.runId, notificationKey: notification.key }
          }, synthesisResponse, AbortSignal.any([signal, AbortSignal.timeout(26_000)]), maxWaveBase64 + 512);
          waveform = result.waveformBase64;
        }
      } catch (error) {
        failure = error;
      } finally {
        if (sessionId) {
          try {
            await request({ operation: "close", sessionId }, closeResponse, AbortSignal.timeout(5_000));
          } catch {
            if (failure === undefined || failure instanceof ReadbackAlreadyRequested) failure = new SpokenUpdateError(cleanupMessage);
          }
        }
      }
      if (!current() || failure instanceof ReadbackAlreadyRequested) return;
      try {
        if (failure !== undefined) throw failure;
        if (waveform) await play(waveform, signal);
      } catch (error) {
        if (!current()) return;
        options.onFailure(error instanceof SpokenUpdateError ? error.message : failureMessage);
        throw error;
      }
    }
  };
}

class SpokenUpdateError extends Error {}
class ReadbackAlreadyRequested extends Error {}

async function playOpenAiWaveform(base64: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const decoded = atob(base64);
  if (decoded.length <= 44 || decoded.slice(0, 4) !== "RIFF" || decoded.slice(8, 12) !== "WAVE") throw new Error(failureMessage);
  const bytes = Uint8Array.from(decoded, letter => letter.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  const audio = new Audio(url);
  try {
    await new Promise<void>((resolve, reject) => {
      const abort = () => done(signal.reason ?? new DOMException("Playback stopped.", "AbortError"));
      const ended = () => done();
      const failed = () => done(new Error(failureMessage));
      const timer = setTimeout(failed, 26_000);
      function done(error?: unknown) {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        audio.removeEventListener("ended", ended);
        audio.removeEventListener("error", failed);
        if (error === undefined) resolve(); else reject(error);
      }
      audio.addEventListener("ended", ended, { once: true });
      audio.addEventListener("error", failed, { once: true });
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      else void audio.play().catch(done);
    });
  } finally {
    audio.pause();
    audio.removeAttribute("src");
    URL.revokeObjectURL(url);
  }
}
