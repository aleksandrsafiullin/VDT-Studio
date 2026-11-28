import { expect, it, vi } from "vitest";
import { transcribeOpenAiDictation } from "./openai-byok-speech-client";

const target = { runId: "run", analyticsBindingId: "binding",
  scope: { projectId: "project", vdtId: "tree", revisionId: "revision", commitGeneration: 3 } };
const selection = { recognitionLanguage: "ru", synthesisLanguage: "en", localSynthesis: "apple_local" } as const;
const grantId = "12345678-1234-4123-8123-123456789012";
const sessionId = "12345678-1234-4123-8123-123456789013";
const capture = new Float32Array([0.2, 0.1]);
const granted = () => Response.json({ state: "granted", direction: "stt", grantId });
const opened = (scope = target.scope) => Response.json({ state: "open", sessionId, scope, tts: "apple_local", stt: {
  provider: "openai", model: "gpt-transcribe", boundary: "provider_service", billing: "api"
} });
const closed = () => Response.json({ state: "closed" });
const body = (entry: Parameters<typeof fetch>) => JSON.parse(String(entry[1]?.body));

it("sends one final WAV under explicit recognition consent and retains local synthesis", async () => {
  const port = vi.fn<typeof fetch>().mockResolvedValueOnce(granted()).mockResolvedValueOnce(opened())
    .mockResolvedValueOnce(Response.json({ state: "transcribed", text: "  Editable draft  " })).mockResolvedValueOnce(closed());
  await expect(transcribeOpenAiDictation(target, capture, selection, new AbortController().signal, () => true, port))
    .resolves.toBe("Editable draft");
  const requests = port.mock.calls.map(body);
  expect(requests).toEqual([
    { ...target, operation: "grant", selection: { direction: "stt", provider: "openai", credentialSource: "active_direct_openai",
      consent: "send_audio_openai_api_billing" } },
    { ...target, operation: "open", selection: { stt: { provider: "openai", grantId }, tts: "apple_local",
      recognitionLanguage: "ru", synthesisLanguage: "en" } },
    { ...target, operation: "transcribe", sessionId, operationId: expect.any(String), audioBase64: expect.any(String) },
    { ...target, operation: "close", sessionId }
  ]);
  const wav = Buffer.from(requests[2].audioBase64, "base64");
  expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
  expect(wav.readUInt32LE(24)).toBe(16_000);
  expect(wav.readUInt32LE(40)).toBe(4);
  for (const [url, options] of port.mock.calls) {
    expect(url).toBe("/api/speech/byok");
    expect(options).toMatchObject({ method: "POST", cache: "no-store", credentials: "same-origin", mode: "same-origin", redirect: "error" });
  }
});

it("closes a late lease and does not upload captured audio after scope loss", async () => {
  let current = true;
  const port = vi.fn<typeof fetch>().mockResolvedValueOnce(granted())
    .mockImplementationOnce(async () => { current = false; return opened(); }).mockResolvedValueOnce(closed());
  await expect(transcribeOpenAiDictation(target, capture, selection, new AbortController().signal, () => current, port))
    .resolves.toBeUndefined();
  expect(port.mock.calls.map(call => body(call).operation)).toEqual(["grant", "open", "close"]);
});

it("cancels during the grant without opening a host voice lease", async () => {
  const controller = new AbortController();
  const port = vi.fn<typeof fetch>().mockImplementationOnce(async () => { controller.abort(); return granted(); });
  await expect(transcribeOpenAiDictation(target, capture, selection, controller.signal, () => true, port)).resolves.toBeUndefined();
  expect(port.mock.calls.map(call => body(call).operation)).toEqual(["grant"]);
});

it("waits for independent closing of a lease that arrived after explicit cancellation", async () => {
  const controller = new AbortController();
  let acknowledgeClose!: (response: Response) => void;
  const close = new Promise<Response>(resolve => { acknowledgeClose = resolve; });
  const port = vi.fn<typeof fetch>().mockResolvedValueOnce(granted())
    .mockImplementationOnce(async () => { controller.abort(); return opened(); })
    .mockImplementationOnce((_url, options) => { expect(options?.signal?.aborted).toBe(false); return close; });
  const settled = vi.fn();
  const recognition = transcribeOpenAiDictation(target, capture, selection, controller.signal, () => true, port).then(settled);
  await vi.waitFor(() => expect(port.mock.calls.map(call => body(call).operation)).toEqual(["grant", "open", "close"]));
  expect(settled).not.toHaveBeenCalled();
  acknowledgeClose(closed());
  await recognition;
  expect(settled).toHaveBeenCalledExactlyOnceWith(undefined);
});

it("rejects a mismatched host lease or added recognition proof before returning text", async () => {
  const mismatch = vi.fn<typeof fetch>().mockResolvedValueOnce(granted())
    .mockResolvedValueOnce(opened({ ...target.scope, revisionId: "other" })).mockResolvedValueOnce(closed());
  await expect(transcribeOpenAiDictation(target, capture, selection, new AbortController().signal, () => true, mismatch))
    .rejects.toThrow("changed scope");
  expect(mismatch.mock.calls.map(call => body(call).operation)).toEqual(["grant", "open", "close"]);
  const proof = vi.fn<typeof fetch>().mockResolvedValueOnce(granted()).mockResolvedValueOnce(opened())
    .mockResolvedValueOnce(Response.json({ state: "transcribed", text: "draft", recognitionProof: "unexpected" })).mockResolvedValueOnce(closed());
  await expect(transcribeOpenAiDictation(target, capture, selection, new AbortController().signal, () => true, proof)).rejects.toThrow();
});

it("suppresses a late transcript after cancellation and closes with a separate signal", async () => {
  const controller = new AbortController();
  const port = vi.fn<typeof fetch>().mockResolvedValueOnce(granted()).mockResolvedValueOnce(opened())
    .mockImplementationOnce(async () => { controller.abort(); return Response.json({ state: "transcribed", text: "late draft" }); })
    .mockImplementationOnce(async (_url, options) => { expect(options?.signal?.aborted).toBe(false); return closed(); });
  await expect(transcribeOpenAiDictation(target, capture, selection, controller.signal, () => true, port)).resolves.toBeUndefined();
  expect(port.mock.calls.map(call => body(call).operation)).toEqual(["grant", "open", "transcribe", "close"]);
});
