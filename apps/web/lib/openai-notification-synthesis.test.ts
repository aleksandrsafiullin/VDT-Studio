import { Buffer } from "node:buffer";
import { expect, it, vi } from "vitest";
import { createOpenAiNotificationSynthesis } from "./openai-notification-synthesis";
import { projectCurrentVoiceReadback, type VoiceRunSnapshot } from "./voice-notifications";

const target = { runId: "run", analyticsBindingId: "binding",
  scope: { projectId: "project", vdtId: "tree", revisionId: "revision", commitGeneration: 3 } };
const grantId = "12345678-1234-4123-8123-123456789012";
const sessionId = "12345678-1234-4123-8123-123456789013";
const playbackId = "12345678-1234-4123-8123-123456789014";
const present = () => Response.json({ state: "existing_credential_status", present: true });
const granted = () => Response.json({ state: "granted", direction: "tts", grantId, purpose: "current_run_readback" });
const opened = () => Response.json({ state: "open", sessionId, stt: "off", tts: {
  provider: "openai", transport: "realtime_synthesis", boundary: "provider_service", billing: "api", aiGeneratedVoice: true, purpose: "current_run_readback"
} });
const closed = () => Response.json({ state: "closed" });
const wave = Buffer.alloc(46);
wave.write("RIFF"); wave.write("WAVE", 8);
const generated = () => Response.json({ state: "synthesized", playbackId, aiGeneratedVoice: true, waveformBase64: wave.toString("base64") });
const approvalSnapshot = { runId: "run", status: "waiting_approval", pendingMutationProposal: { id: "proposal" }, events: [] } as unknown as VoiceRunSnapshot;
const approval = projectCurrentVoiceReadback(approvalSnapshot, "en")!;

function setup() {
  let current = true;
  let snapshot = approvalSnapshot;
  const play = vi.fn(async () => {});
  const onFailure = vi.fn();
  const port = vi.fn<typeof fetch>();
  const synthesis = createOpenAiNotificationSynthesis({
    consent: target, locale: "en", current: () => current, snapshot: () => snapshot, onFailure
  }, port, play);
  const controller = new AbortController();
  return { synthesis, controller, play, onFailure, port, operations: () => port.mock.calls.map(([, init]) => JSON.parse(String(init?.body))),
    revoke: () => { current = false; }, clearApproval: () => { snapshot = { ...snapshot, status: "running" }; } };
}

it("requires the exact consent and current projection and sends only the verified key without draft, text or audio", async () => {
  const fixture = setup();
  const { synthesis, controller, port, play } = fixture;
  await synthesis.speak({ ...approval, text: "Unverified project details" }, controller.signal);
  await synthesis.speak({ ...approval, key: "review:invented" }, controller.signal);
  expect(port).not.toHaveBeenCalled();
  port.mockResolvedValueOnce(present()).mockResolvedValueOnce(granted()).mockResolvedValueOnce(opened())
    .mockResolvedValueOnce(generated()).mockResolvedValueOnce(closed());
  await synthesis.speak(approval, controller.signal);
  await synthesis.speak(approval, controller.signal);
  expect(fixture.operations()).toEqual([
    { ...target, operation: "existing_credential_status" },
    { ...target, operation: "grant", selection: { direction: "tts", provider: "openai", credentialSource: "active_direct_openai",
      consent: "send_text_openai_api_billing_ai_voice", purpose: "current_run_readback" } },
    { ...target, operation: "open", selection: { stt: "off", recognitionLanguage: "auto", synthesisLanguage: "en",
      tts: { provider: "openai", grantId, transport: "realtime_synthesis" } } },
    { ...target, operation: "synthesize", sessionId, operationId: expect.any(String),
      source: { kind: "verified_event", runId: "run", notificationKey: "run:approval:proposal" } },
    { ...target, operation: "close", sessionId }
  ]);
  expect(play).toHaveBeenCalledExactlyOnceWith(wave.toString("base64"), controller.signal);
});

it("closes the duplicate lease and skips playback when the authority remembers the occurrence", async () => {
  const { synthesis, port, controller, play, onFailure, operations } = setup();
  port.mockResolvedValueOnce(present()).mockResolvedValueOnce(granted()).mockResolvedValueOnce(opened())
    .mockResolvedValueOnce(Response.json({ error: "readback_already_requested" }, { status: 409 }))
    .mockResolvedValueOnce(closed());
  await expect(synthesis.speak(approval, controller.signal)).resolves.toBeUndefined();
  expect(operations().at(-1)?.operation).toBe("close");
  expect(play).not.toHaveBeenCalled();
  expect(onFailure.mock.calls).toEqual([[undefined]]);
});

it("refuses revoked consent before any request and closes an admission that arrives after the projection changes", async () => {
  const revoked = setup();
  revoked.revoke();
  await revoked.synthesis.speak(approval, revoked.controller.signal);
  expect(revoked.port).not.toHaveBeenCalled();
  const fixture = setup();
  fixture.port.mockResolvedValueOnce(present()).mockResolvedValueOnce(granted())
    .mockImplementationOnce(async () => { fixture.clearApproval(); return opened(); })
    .mockResolvedValueOnce(closed());
  await fixture.synthesis.speak(approval, fixture.controller.signal);
  expect(fixture.operations().map(value => value.operation)).toEqual(["existing_credential_status", "grant", "open", "close"]);
  expect(fixture.play).not.toHaveBeenCalled();
});

it("discards cancelled playback and surfaces API quota separately even if closing fails", async () => {
  const cancelled = setup();
  cancelled.port.mockResolvedValueOnce(present()).mockResolvedValueOnce(granted()).mockResolvedValueOnce(opened())
    .mockImplementationOnce(async () => { cancelled.controller.abort(); return generated(); }).mockResolvedValueOnce(closed());
  await cancelled.synthesis.speak(approval, cancelled.controller.signal);
  expect(cancelled.operations().at(-1)?.operation).toBe("close");
  expect(cancelled.play).not.toHaveBeenCalled();

  const quota = setup();
  quota.port.mockResolvedValueOnce(present()).mockResolvedValueOnce(granted()).mockResolvedValueOnce(opened())
    .mockResolvedValueOnce(Response.json({ error: "quota_exhausted" }, { status: 429 }))
    .mockResolvedValueOnce(Response.json({ error: "stale_session" }, { status: 409 }));
  await expect(quota.synthesis.speak(approval, quota.controller.signal)).rejects.toThrow("OpenAI API quota is exhausted");
  expect(quota.onFailure.mock.lastCall?.[0]).toContain("OpenAI API quota is exhausted");
  expect(quota.play).not.toHaveBeenCalled();
});
