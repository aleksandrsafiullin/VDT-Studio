import {
  SPEECH_TTS_MAX_WAVE_BASE64, type AppleVoicePreviewSelection, type SpeechAnalyticsSelection,
  type SpeechResponse, type SpeechRequest, type SpeechSynthesisGrant, type SpeechSynthesisResult
} from "@vdt-studio/local-runner/speech-catalog";
import { speechRequest } from "./speech-client";
import type { VoiceSynthesis } from "./voice-notification-queue";

interface LocalNotificationOptions {
  scope: string;
  analytics: SpeechAnalyticsSelection;
  voice: AppleVoicePreviewSelection;
  autoSpeak: boolean;
  current: () => boolean;
}

type SpeechPort = (request: SpeechRequest) => Promise<SpeechResponse>;
type AudioPort = (waveform: string, signal: AbortSignal) => Promise<void>;
const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
  byte => byte.toString(16).padStart(2, "0")).join("");

// The native helper bounds rendered PCM bytes independently of its request text limit.
const notificationPhraseLimit = 48;
const maxWaveformSplits = 2;

function phrases(text: string): string[] {
  const parts: string[] = [];
  let remaining = text.replace(/\s+/g, " ").trim();
  while (remaining) {
    let end = remaining.length <= notificationPhraseLimit ? remaining.length : remaining.lastIndexOf(" ", notificationPhraseLimit);
    if (end <= 0) {
      end = notificationPhraseLimit;
      if (/[\uD800-\uDBFF]/.test(remaining.charAt(end - 1))) end--;
    }
    parts.push(remaining.slice(0, end));
    remaining = remaining.slice(end).trim();
  }
  return parts;
}

function splitAtWordBoundary(text: string): [string, string] | undefined {
  const midpoint = Math.floor(text.length / 2);
  const before = text.lastIndexOf(" ", midpoint);
  const boundary = before > 0 ? before : text.indexOf(" ", midpoint);
  if (boundary > 0) return [text.slice(0, boundary), text.slice(boundary + 1)];
}

export function createLocalNotificationSynthesis(options: LocalNotificationOptions,
  request: SpeechPort = speechRequest, play: AudioPort = playLocalWaveform): VoiceSynthesis | null {
  if (!options.autoSpeak || !options.scope || !options.voice.voiceId) return null;
  const checkCurrent = (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (!options.current()) throw new DOMException("Spoken notification expired.", "AbortError");
  };
  return {
    async speak(notification, signal) {
      if (!notification.key || notification.key.length > 512 || !notification.text.trim() || notification.text.length > 1800) return;
      checkCurrent(signal);
      const scopeId = await digest(options.scope);
      async function speakPhrase(text: string, index: number, split: string) {
        const address = [scopeId, notification.key, index];
        const eventId = await digest(JSON.stringify(split ? [...address, split] : address));
        checkCurrent(signal);
        let grant: SpeechSynthesisGrant | undefined;
        let closing: Promise<SpeechResponse | undefined> | undefined;
        let retry: [string, string] | undefined;
        let played = false;
        const close = () => {
          if (grant) closing ??= request({ operation: "close_tts", sessionId: grant.sessionId }).catch(() => undefined);
          return closing;
        };
        const abort = () => { void close(); };
        signal.addEventListener("abort", abort, { once: true });
        try {
          const response = await request({ operation: "open_tts", confirmed: true, eventId, text, preview: options.voice,
            selection: { version: 1, scopeId, analytics: options.analytics, language: options.voice.locale,
              stt: null, tts: { providerId: "apple_local", modelId: options.voice.voiceId }, realtime: null } });
          if (!("state" in response) || response.state !== "tts_open" || typeof response.sessionId !== "string") throw new Error("Local spoken output is unavailable.");
          grant = response;
          if (grant.eventId !== eventId || grant.scopeId !== scopeId || grant.boundary !== "on_device" || grant.billing !== "none"
            || grant.consent !== "explicit_component") throw new Error("Local spoken output grant did not match this notification.");
          const deadline = Date.now() + 20_000;
          let result: SpeechResponse;
          do {
            checkCurrent(signal);
            result = await request({ operation: "tts_result", sessionId: grant.sessionId });
            if (("state" in result && result.state === "tts_processing") && Date.now() < deadline)
              await new Promise<void>(resolve => setTimeout(resolve, 125));
            else break;
          } while (true);
          checkCurrent(signal);
          const audio = result as Partial<SpeechSynthesisResult>;
          if (audio.state === "tts_error" && audio.code === "waveform_too_large" && audio.eventId === eventId
            && split.length < maxWaveformSplits) retry = splitAtWordBoundary(text);
          if (audio.state === "tts_complete" && audio.eventId === eventId && typeof audio.waveformBase64 === "string") {
            await play(audio.waveformBase64, signal);
            played = true;
          } else if (!retry) {
            throw new Error("The installed voice could not prepare this notification.");
          }
        } finally {
          signal.removeEventListener("abort", abort);
          const closed = await close();
          if (played || retry) {
            checkCurrent(signal);
            if (!closed || !("state" in closed) || closed.state !== "closed")
              throw new Error("The installed voice could not release this notification.");
          }
        }
        if (retry) {
          await speakPhrase(retry[0], index, `${split}0`);
          await speakPhrase(retry[1], index, `${split}1`);
        }
      }
      for (const [index, text] of phrases(notification.text).entries()) {
        await speakPhrase(text, index, "");
      }
    }
  };
}

async function playLocalWaveform(base64: string, signal: AbortSignal) {
  signal.throwIfAborted();
  if (base64.length > SPEECH_TTS_MAX_WAVE_BASE64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error("Invalid spoken audio.");
  const decoded = atob(base64);
  if (decoded.slice(0, 4) !== "RIFF" || decoded.slice(8, 12) !== "WAVE") throw new Error("Invalid spoken audio.");
  const bytes = Uint8Array.from(decoded, letter => letter.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  const audio = new Audio(url);
  try {
    await new Promise<void>((resolve, reject) => {
      const abort = () => done(signal.reason);
      const ended = () => done();
      const failed = () => done(new Error("Local spoken playback failed."));
      const timer = setTimeout(failed, 8_000);
      function done(error?: unknown) {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        audio.removeEventListener("ended", ended);
        audio.removeEventListener("error", failed);
        if (error === undefined) resolve(); else reject(error);
      }
      signal.addEventListener("abort", abort, { once: true });
      audio.addEventListener("ended", ended, { once: true });
      audio.addEventListener("error", failed, { once: true });
      if (signal.aborted) abort();
      else void audio.play().catch(failed);
    });
  } finally {
    audio.pause();
    audio.removeAttribute("src");
    URL.revokeObjectURL(url);
  }
}
