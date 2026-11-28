import { expect, it, vi } from "vitest";
import { SpeechRuntime } from "./runtime";
import { AppleVoiceOutputTooLargeError } from "./apple-voice";
import type { SpeechRequest } from "./catalog";

const input: Extract<SpeechRequest, { operation: "open_tts" }> = {
  operation: "open_tts", eventId: "a".repeat(64), text: "The model was saved.", confirmed: true,
  preview: { locale: "en", voiceId: "system-voice", ratePercent: 100, volumePercent: 70 },
  selection: { version: 1, scopeId: "b".repeat(64), analytics: { mode: "local", providerId: "ollama", modelId: "qwen" }, language: "en",
    stt: null, tts: { providerId: "apple_local", modelId: "system-voice" }, realtime: null }
};
const wave = "UklGRgAAAABXQVZF";

it("reports a classified Apple waveform overflow for its own event", async () => {
  const runtime = new SpeechRuntime({ appleVoice: {
    synthesize: async () => { throw new AppleVoiceOutputTooLargeError(); },
    preview: async () => wave, recognize: async () => "",
    status: async () => ({ state: "apple_voice_status", supported: true, recognition: [], voices: [] })
  } });
  const grant = await runtime.request(input);
  if (!("state" in grant) || grant.state !== "tts_open") throw new Error("Expected Apple grant.");
  try {
    await vi.waitFor(async () => {
      await expect(runtime.request({ operation: "tts_result", sessionId: grant.sessionId }))
        .resolves.toEqual({ state: "tts_error", code: "waveform_too_large", eventId: input.eventId });
    });
  } finally {
    await runtime.request({ operation: "close_tts", sessionId: grant.sessionId });
  }
});

it("requires a host-configured neural voice, explicit consent and the same playback lease", async () => {
  const { eventId, text, selection: { scopeId } } = input;
  const preview = { ...input.preview, voiceId: "en_US-joe-medium" };
  const neuralRequest = { eventId, text, scopeId, preview, confirmed: true } as const;
  expect(() => new SpeechRuntime().openNeuralTts(neuralRequest)).toThrow("approved neural voice engine");
  const synthesize = vi.fn(async () => wave);
  const runtime = new SpeechRuntime({ neuralVoice: { synthesize } });
  expect(() => runtime.openNeuralTts({ ...neuralRequest, confirmed: false as true })).toThrow("Confirm local speech");
  await expect(runtime.request({ ...neuralRequest, operation: "open_neural_tts" })).rejects.toThrow("Unsupported");
  await expect(runtime.request(input)).rejects.toThrow("installed Apple voice");
  const grant = runtime.openNeuralTts(neuralRequest);
  try {
    expect(() => runtime.openNeuralTts({ ...neuralRequest, eventId: "c".repeat(64) })).toThrow("busy");
    await vi.waitFor(async () => expect(await runtime.request({ operation: "tts_result", sessionId: grant.sessionId }))
      .toMatchObject({ state: "tts_complete", waveformBase64: wave }));
    expect(synthesize).toHaveBeenCalledExactlyOnceWith(preview, text, expect.any(AbortSignal));
  } finally {
    await runtime.request({ operation: "close_tts", sessionId: grant.sessionId });
  }
  expect(() => runtime.openNeuralTts(neuralRequest)).toThrow("already received");
});

it("grants one utterance at a time, fences capture, cancels the renderer and rejects replay", async () => {
  let signal: AbortSignal | undefined;
  const synthesize = vi.fn(async (_voice, _text, abort: AbortSignal) => {
    signal = abort;
    return new Promise<string>((_resolve, reject) => {
      abort.addEventListener("abort", () => reject(abort.reason), { once: true });
    });
  });
  const runtime = new SpeechRuntime({ appleVoice: {
    synthesize, preview: async () => wave, recognize: async () => "",
    status: async () => ({ state: "apple_voice_status", supported: true, recognition: [
      { locale: "en", systemLocale: "en-US", status: "installed" }
    ], voices: [] })
  } });
  await expect(runtime.request({ ...input, confirmed: false })).rejects.toThrow("Confirm local speech");
  expect(synthesize).not.toHaveBeenCalled();
  const grant = await runtime.request(input);
  if (!("state" in grant) || grant.state !== "tts_open") throw new Error("Expected Apple grant.");
  const capture = { operation: "open_session", selection: { ...input.selection, tts: null,
    stt: { providerId: "apple_local", modelId: "system" } } };
  await expect(runtime.request(capture)).rejects.toThrow("before starting capture");
  await expect(runtime.request({ ...input, eventId: "c".repeat(64) })).rejects.toThrow("busy");
  await expect(runtime.request({ operation: "tts_result", sessionId: grant.sessionId })).resolves.toEqual({ state: "tts_processing" });
  await runtime.request({ operation: "close_tts", sessionId: grant.sessionId });
  expect(signal?.aborted).toBe(true);
  await expect(runtime.request({ operation: "tts_result", sessionId: grant.sessionId })).rejects.toThrow("expired");
  const mic = await runtime.request(capture);
  if (!("sessionId" in mic)) throw new Error("Expected microphone grant.");
  await expect(runtime.request({ ...input, eventId: "c".repeat(64) })).rejects.toThrow("busy");
  await runtime.request({ operation: "close_session", sessionId: mic.sessionId });
  await expect(runtime.request(input)).rejects.toThrow("already received");
  synthesize.mockResolvedValueOnce(wave);
  const second = await runtime.request({ ...input, eventId: "c".repeat(64) });
  if (!("state" in second) || second.state !== "tts_open") throw new Error("Expected second Apple grant.");
  const poll = { operation: "tts_result", sessionId: second.sessionId };
  try {
    await vi.waitFor(async () => expect(await runtime.request(poll)).toMatchObject({ state: "tts_complete", waveformBase64: wave }));
    await expect(runtime.request(poll)).resolves.toEqual({ state: "tts_error" });
  } finally {
    await runtime.request({ operation: "close_tts", sessionId: second.sessionId });
  }
});
