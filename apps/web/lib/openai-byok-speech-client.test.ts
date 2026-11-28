import { Buffer } from "node:buffer";
import { expect, it, vi } from "vitest";
import { checkSeparateOpenAiVoiceCredential, prepareOpenAiVoicePreview, prepareSeparateOpenAiVoicePreview } from "./openai-byok-speech-client";

const target = { runId: "run", analyticsBindingId: "binding",
  scope: { projectId: "project", vdtId: "tree", revisionId: "revision", commitGeneration: 3 } };
const grantId = "12345678-1234-4123-8123-123456789012";
const sessionId = "12345678-1234-4123-8123-123456789013";
const playbackId = "12345678-1234-4123-8123-123456789014";
const granted = () => Response.json({ state: "granted", direction: "tts", grantId });
const opened = () => Response.json({ state: "open", sessionId, stt: "off", tts: {
  provider: "openai", transport: "realtime_synthesis", boundary: "provider_service", billing: "api", aiGeneratedVoice: true
} });
const closed = () => Response.json({ state: "closed" });
const body = (entry: Parameters<typeof fetch>) => JSON.parse(String(entry[1]?.body));

it("opens one explicitly API-billed synthesis grant for the host sample and closes it before returning a WAV", async () => {
  const sampleWave = Buffer.alloc(46);
  sampleWave.write("RIFF"); sampleWave.write("WAVE", 8);
  const port = vi.fn<typeof fetch>().mockResolvedValueOnce(granted()).mockResolvedValueOnce(opened())
    .mockResolvedValueOnce(Response.json({ state: "synthesized", playbackId, aiGeneratedVoice: true, waveformBase64: sampleWave.toString("base64") }))
    .mockResolvedValueOnce(closed());
  const wave = await prepareOpenAiVoicePreview(target, "ru", new AbortController().signal, () => true, port);
  expect(wave?.type).toBe("audio/wav");
  expect(await wave?.arrayBuffer().then(Buffer.from)).toEqual(sampleWave);
  expect(port.mock.calls.map(body)).toEqual([
    { ...target, operation: "grant", selection: { direction: "tts", provider: "openai", credentialSource: "active_direct_openai",
      consent: "send_text_openai_api_billing_ai_voice" } },
    { ...target, operation: "open", selection: { stt: "off", recognitionLanguage: "auto", synthesisLanguage: "ru",
      tts: { provider: "openai", grantId, transport: "realtime_synthesis" } } },
    { ...target, operation: "synthesize", sessionId, operationId: expect.any(String), source: { kind: "sample" } },
    { ...target, operation: "close", sessionId }
  ]);
  for (const [url, options] of port.mock.calls) {
    expect(url).toBe("/api/speech/byok");
    expect(options).toMatchObject({ method: "POST", cache: "no-store", credentials: "same-origin", mode: "same-origin", redirect: "error" });
  }
});

it("closes a late-opened lease without synthesizing after the workspace changed", async () => {
  let current = true;
  const port = vi.fn<typeof fetch>().mockResolvedValueOnce(granted())
    .mockImplementationOnce(async () => { current = false; return opened(); })
    .mockResolvedValueOnce(closed());
  await expect(prepareOpenAiVoicePreview(target, "en", new AbortController().signal, () => current, port)).resolves.toBeUndefined();
  expect(port.mock.calls.map(call => body(call).operation)).toEqual(["grant", "open", "close"]);
});

it("uses a separate fixed-sample-only grant and checks availability without sending a credential", async () => {
  const sampleWave = Buffer.alloc(46);
  sampleWave.write("RIFF"); sampleWave.write("WAVE", 8);
  const signal = new AbortController().signal;
  const port = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ state: "separate_credential_status", present: true }))
    .mockResolvedValueOnce(Response.json({ state: "granted", direction: "tts", grantId, purpose: "separate_host_sample" }))
    .mockResolvedValueOnce(Response.json({ state: "open", sessionId, stt: "off", tts: {
      provider: "openai", transport: "realtime_synthesis", boundary: "provider_service", billing: "api",
      aiGeneratedVoice: true, purpose: "separate_host_sample"
    } }))
    .mockResolvedValueOnce(Response.json({ state: "synthesized", playbackId, aiGeneratedVoice: true, waveformBase64: sampleWave.toString("base64") }))
    .mockResolvedValueOnce(closed());
  await expect(checkSeparateOpenAiVoiceCredential(target, signal, () => true, port)).resolves.toBe(true);
  expect(port.mock.calls.map(body)).toEqual([{ ...target, operation: "separate_credential_status" }]);
  const wave = await prepareSeparateOpenAiVoicePreview(target, "en", signal, () => true, port);
  expect(wave?.type).toBe("audio/wav");
  expect(port.mock.calls.map(body)).toEqual([
    { ...target, operation: "separate_credential_status" },
    { ...target, operation: "grant", selection: { direction: "tts", provider: "openai", credentialSource: "host_voice_key",
      purpose: "separate_host_sample", consent: "send_sample_openai_voice_api_billing" } },
    { ...target, operation: "open", selection: { stt: "off", recognitionLanguage: "auto", synthesisLanguage: "en",
      tts: { provider: "openai", grantId, transport: "realtime_synthesis" } } },
    { ...target, operation: "synthesize", sessionId, operationId: expect.any(String), source: { kind: "sample" } },
    { ...target, operation: "close", sessionId }
  ]);
});

it("closes a separately authorized session without synthesizing when its purpose is missing", async () => {
  const signal = new AbortController().signal;
  const port = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ state: "granted", direction: "tts", grantId, purpose: "separate_host_sample" }))
    .mockResolvedValueOnce(opened())
    .mockResolvedValueOnce(closed());
  await expect(prepareSeparateOpenAiVoicePreview(target, "en", signal, () => true, port)).rejects.toThrow();
  expect(port.mock.calls.map(entry => body(entry).operation)).toEqual(["grant", "open", "close"]);
});

it("closes the lease after quota failure and returns explicit recovery without fallback", async () => {
  const port = vi.fn<typeof fetch>().mockResolvedValueOnce(granted()).mockResolvedValueOnce(opened())
    .mockResolvedValueOnce(Response.json({ error: "quota_exhausted" }, { status: 429 }))
    .mockResolvedValueOnce(closed());
  await expect(prepareOpenAiVoicePreview(target, "en", new AbortController().signal, () => true, port)).rejects.toThrow("OpenAI API quota is exhausted");
  expect(port.mock.calls.map(call => body(call).operation)).toEqual(["grant", "open", "synthesize", "close"]);
});

it("preserves the provider failure when the host closes the lease before acknowledging cleanup", async () => {
  const port = vi.fn<typeof fetch>().mockResolvedValueOnce(granted()).mockResolvedValueOnce(opened())
    .mockResolvedValueOnce(Response.json({ error: "cleanup_unconfirmed" }, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ error: "stale_session" }, { status: 409 }));
  await expect(prepareOpenAiVoicePreview(target, "en", new AbortController().signal, () => true, port))
    .rejects.toThrow("Reopen VDT Studio");
  expect(port.mock.calls.map(call => body(call).operation)).toEqual(["grant", "open", "synthesize", "close"]);
});
