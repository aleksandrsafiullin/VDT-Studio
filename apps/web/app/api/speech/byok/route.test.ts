import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pcmWave } from "@vdt-studio/local-runner/speech-audio";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { register as registerWebHost } from "@/instrumentation";
import { agentExecutionBindingRegistry } from "../../agent/runs/runtime";
import { activeSupervisorApiSpeechBinding } from "../../agent/runs/supervisor-runtime";
import { openAiSessionBindings } from "../../agent/runs/byok-bindings";
import { isStructuredModelExecutionBinding, type AgentExecutionBindingDefinition } from "../../agent/runs/execution-bindings";
import { POST } from "./route";
import { OpenAiAudio } from "./openai-audio";

const fixture = vi.hoisted(() => ({
  scope: { projectId: "testProject", vdtId: "testVdt", revisionId: "revision-one", commitGeneration: 1 },
  head: { activeRevisionId: "revision-one", commitGeneration: 1 }, snapshot: undefined as object | undefined,
  headRead: undefined as (() => void) | undefined,
  transport: vi.fn<typeof fetch>()
}));

vi.mock("@/app/api/vdt/storage-database", () => ({ openVdtStorageDatabase: () => ({
  close() {}, getVdtRevisionHead(vdtId: string) {
    fixture.headRead?.();
    return vdtId === fixture.scope.vdtId ? { projectId: fixture.scope.projectId, pendingRevisionId: null, ...fixture.head } : null;
  }
}) }));

vi.mock("../../agent/runs/runtime", async () => {
  const { AgentExecutionBindingRegistry } = await import("../../agent/runs/execution-bindings");
  const registry = new AgentExecutionBindingRegistry();
  const resolve = registry.resolve.bind(registry);
  vi.spyOn(registry, "resolve").mockImplementation(id => {
    if (id === "native-local" || id === "subscription-cli") return {
      bindingId: id, modelId: "synthetic", capability: { backendId: "synthetic" },
      ...(id === "native-local" ? { localProof: { modelRevision: "v1", profileVersion: "synthetic" } } : { currentQualification: {} })
    } as unknown as AgentExecutionBindingDefinition;
    return resolve(id);
  });
  return { agentExecutionBindingRegistry: registry, agentRuntime: { store: {
    has: (runId: string) => runId === "run-1" && Boolean(fixture.snapshot), getSnapshot: () => fixture.snapshot
  } } };
});

const origin = "http://127.0.0.1:37541";
const wave = Buffer.from(pcmWave(new Float32Array([0, .1, -.1, 0]))).toString("base64");
const transcriptKey = "synthetic-recognition-key";
const playbackKey = "synthetic-synthesis-key";
const analyticsKey = "synthetic-analytics-key";
const stt = (credentialRef: string) => ({ provider: "openai", credentialRef, consent: "send_audio_openai_api_billing" });
const tts = (credentialRef: string) => ({ provider: "openai", credentialRef, consent: "send_text_openai_api_billing_ai_voice" });
const ttsCompat = (credentialRef: string) => ({ provider: "openai", credentialRef, consent: "send_text_openai_http_compatibility_api_billing_ai_voice" });
const existing = (consent: string) => ({ provider: "openai", credentialSource: "active_direct_openai", consent });
const realtime = (credentialRef: string) => ({ provider: "openai", credentialRef, consent: "send_audio_openai_realtime_api_billing_ai_voice" });
const pcm = () => new Response(new Uint8Array([1, 0, 2, 0]), { headers: { "content-type": "application/octet-stream" } });
const issued = new Set<string>();
let voiceKeyDirectory: string | undefined;
let openSession: string | undefined;
let activeConnection: Record<string, unknown> | undefined;
let lastOpen: Record<string, unknown> | undefined;
const sockets: RealtimeSocket[] = [];
type Json = Record<string, unknown>;

class RealtimeSocket extends EventTarget {
  readyState = 1;
  readonly sent: Json[] = [];
  readonly closing: number[] = [];
  #sequence = 0;
  constructor(readonly url: string, readonly options: { headers: { Authorization: string } }) { super(); sockets.push(this); }
  send(text: string) { this.sent.push(JSON.parse(text)); }
  close(code: number) { this.closing.push(code); this.readyState = 2; }
  receive(type: string, fields: Json = {}) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ event_id: `event_${++this.#sequence}`, type, ...fields }) }));
  }
  closed(wasClean = true) {
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent("close", { code: wasClean ? 1000 : 1006, wasClean }));
  }
}

function startRealtime(socket: RealtimeSocket) {
  const audio = { output: { format: { type: "audio/pcm", rate: 24_000 }, voice: "alloy" } };
  const session = { id: "sess_test", type: "realtime", model: "gpt-realtime-2.1-mini" };
  socket.receive("session.created", { session });
  socket.receive("session.updated", { session: { ...session, output_modalities: ["audio"], tools: [], tool_choice: "none", tracing: null,
    audio: { input: { turn_detection: null, transcription: null }, ...audio } } });
  const sentResponse = socket.sent[1]?.response as Json;
  const response = { id: "resp_voice", metadata: sentResponse.metadata, conversation_id: null, output_modalities: ["audio"], audio };
  socket.receive("response.created", { response: { ...response, status: "in_progress", output: [] } });
  return response;
}

function completeRealtime(socket: RealtimeSocket, response: Json, transcript: string) {
  const itemKey = { response_id: "resp_voice", output_index: 0 };
  const partKey = { ...itemKey, item_id: "item_voice", content_index: 0 };
  const item = { id: "item_voice", type: "message", role: "assistant" };
  const part = { type: "output_audio", transcript };
  socket.receive("response.output_item.added", { ...itemKey, item: { ...item, status: "in_progress", content: [] } });
  socket.receive("response.content_part.added", { ...partKey, part: { type: "output_audio" } });
  socket.receive("response.output_audio.delta", { ...partKey, delta: "AQACAA==" });
  socket.receive("response.output_audio_transcript.done", { ...partKey, transcript });
  socket.receive("response.output_audio.done", partKey);
  socket.receive("response.content_part.done", { ...partKey, part });
  const output = { ...item, status: "completed", content: [part] };
  socket.receive("response.output_item.done", { ...itemKey, item: output });
  socket.receive("response.done", { response: { ...response, status: "completed", output: [output] } });
}

function issue(key: string) {
  const ref = openAiSessionBindings(agentExecutionBindingRegistry).admit({ apiKey: key, model: "fixture" }, "sha256:" + "a".repeat(64)).bindingId;
  issued.add(ref);
  return ref;
}

function send(operation: string, fields: Record<string, unknown> = {}, options: { requestOrigin?: string; signal?: AbortSignal } = {}) {
  return POST(new Request("http://localhost:37541/api/speech/byok", {
    method: "POST", headers: { host: "127.0.0.1:37541", origin: options.requestOrigin ?? origin, "content-type": "application/json" },
    signal: options.signal ?? null, body: JSON.stringify({ operation, scope: fixture.scope,
      ...(["transcribe", "synthesize", "release_playback", "close"].includes(operation) ? activeConnection : {}), ...fields })
  }));
}

function opening(analyticsBindingId: string, recognition: ReturnType<typeof stt> | string, synthesis: ReturnType<typeof tts> | string, runId?: string) {
  return { analyticsBindingId, ...(runId ? { runId } : {}), selection: { stt: recognition, tts: synthesis, recognitionLanguage: "ru", synthesisLanguage: "en" } };
}

type GrantDirection = "stt" | "tts" | "tts_compatibility" | "realtime";

function grant(analyticsBindingId: string, direction: GrantDirection, selection: unknown, runId?: string) {
  const component = selection && typeof selection === "object" ? { ...selection, direction } : selection;
  return send("grant", { analyticsBindingId, ...(runId ? { runId } : {}), selection: component });
}

function reviewSnapshot(analytics: string) {
  return { runId: "run-1", request: { workspace: fixture.scope, executionBindingId: analytics }, status: "waiting_approval",
    workspaceRevision: { head: { ...fixture.head } },
    executionSummary: { backendId: "openai_compatible", modelId: "fixture", sessionEpoch: 1 },
    pendingMutationProposal: { id: "proposal-1" }, events: [{ id: "old", runId: "run-1", seq: 1, type: "skill_read", metadata: { readReceiptId: "read-1" } }] };
}

const activeSupervisorRuns = (globalThis as typeof globalThis & { __vdtActiveSupervisorRuns: Map<string, unknown> }).__vdtActiveSupervisorRuns;

function ownSupervisor(bindingId: string, sessionEpoch = 1, status = "waiting_approval", config?: Record<string, unknown>) {
  const definition = agentExecutionBindingRegistry.resolve(bindingId);
  const bindingDefinition = config && isStructuredModelExecutionBinding(definition) ? { ...definition, modelEngineAdapter: {
    ...definition.modelEngineAdapter, providerConfig: { ...definition.modelEngineAdapter.providerConfig, ...config }
  } } : definition;
  activeSupervisorRuns.set("run-1", { bindingDefinition,
    supervisor: { binding: { sessionEpoch }, status } });
}

async function grantSelection(analytics: string, direction: GrantDirection, component: unknown, runId?: string) {
  const result = await grant(analytics, direction, component, runId);
  expect(result.status).toBe(200);
  return { provider: "openai", grantId: (await result.json()).grantId,
    ...(direction === "tts_compatibility" ? { transport: "http_compatibility" } : {}) };
}

async function open(fields: ReturnType<typeof opening>) {
  const { analyticsBindingId, runId, selection } = fields;
  const stt = typeof selection.stt === "string" ? selection.stt : await grantSelection(analyticsBindingId, "stt", selection.stt, runId);
  const tts = typeof selection.tts === "string" ? selection.tts : await grantSelection(analyticsBindingId,
    selection.tts.consent === "send_text_openai_http_compatibility_api_billing_ai_voice" ? "tts_compatibility" : "tts", selection.tts, runId);
  return openPrepared(analyticsBindingId, { ...selection, stt, tts }, runId);
}

async function openPrepared(analyticsBindingId: string, selection: Record<string, unknown>, runId?: string) {
  lastOpen = { analyticsBindingId, selection, runId };
  const response = await send("open", lastOpen);
  expect(response.status).toBe(200);
  const result = await response.json();
  openSession = result.sessionId;
  activeConnection = { scope: { ...fixture.scope }, analyticsBindingId, runId };
  expect(JSON.stringify(result)).not.toContain("synthetic-");
  return result;
}

function work(operation: "transcribe" | "synthesize", values: Record<string, unknown> = {}, signal?: AbortSignal) {
  return send(operation, { sessionId: openSession, operationId: randomUUID(), ...values }, signal ? { signal } : undefined);
}

async function installVoiceKey(value: string) {
  voiceKeyDirectory ??= mkdtempSync(join(realpathSync(tmpdir()), "vdt-voice-key-"));
  const filename = join(voiceKeyDirectory, "voice.key");
  writeFileSync(filename, value, { mode: 0o600 });
  vi.stubEnv("VDT_OPENAI_VOICE_API_KEY_FILE", filename);
  await registerWebHost();
  expect(process.env.VDT_OPENAI_VOICE_API_KEY_FILE).toBeUndefined();
}

beforeEach(async () => {
  vi.stubEnv("VDT_APP_MODE", "development_web");
  vi.stubEnv("VDT_OPENAI_SPEECH_BYOK_ENABLED", "true");
  vi.stubEnv("VDT_OPENAI_VOICE_API_KEY_FILE", "");
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  await registerWebHost();
  vi.stubGlobal("fetch", fixture.transport);
  vi.stubGlobal("WebSocket", RealtimeSocket);
  sockets.length = 0;
  fixture.transport.mockReset();
  fixture.snapshot = undefined;
  fixture.headRead = undefined;
  fixture.head = { activeRevisionId: "revision-one", commitGeneration: 1 };
});

afterEach(async () => {
  if (openSession) await send("close", { sessionId: openSession });
  openSession = undefined;
  activeConnection = undefined;
  lastOpen = undefined;
  activeSupervisorRuns.delete("run-1");
  for (const ref of issued) openAiSessionBindings(agentExecutionBindingRegistry).consume(ref);
  issued.clear();
  if (voiceKeyDirectory) {
    rmSync(voiceKeyDirectory, { recursive: true });
    voiceKeyDirectory = undefined;
  }
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("uses cloud recognition and retains the separate local synthesis selection", async () => {
  const analytics = issue(analyticsKey), recognition = issue(transcriptKey);
  fixture.transport.mockResolvedValueOnce(Response.json({ text: "Проверка" }));
  const grant = await open(opening(analytics, stt(recognition), "apple_local"));
  expect(grant).toMatchObject({ stt: { model: "gpt-transcribe", boundary: "provider_service", billing: "api" }, tts: "apple_local" });
  expect(agentExecutionBindingRegistry.has(recognition)).toBe(false);
  expect(agentExecutionBindingRegistry.has(analytics)).toBe(true);
  expect(await (await work("transcribe", { audioBase64: wave })).json()).toEqual({ state: "transcribed", text: "Проверка" });
  const [url, init] = fixture.transport.mock.calls[0]!;
  const form = init?.body as FormData;
  expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
  expect(init).toMatchObject({ method: "POST", redirect: "error", credentials: "omit", headers: { authorization: `Bearer ${transcriptKey}` } });
  expect(form.get("model")).toBe("gpt-transcribe");
  expect(form.getAll("languages[]")).toEqual(["ru"]);
  expect(form.get("response_format")).toBe("json");
  expect(await (form.get("file") as File).arrayBuffer().then(Buffer.from)).toEqual(Buffer.from(wave, "base64"));
  expect(await (await work("synthesize", { source: { kind: "sample" } })).json()).toEqual({ error: "consent_required" });
  expect(fixture.transport).toHaveBeenCalledTimes(1);
});

it("reports presence only for the exact live direct OpenAI owner and rejects stale, proxied and historical bindings", async () => {
  const analyticsBindingId = issue(analyticsKey);
  const fields = { analyticsBindingId, runId: "run-1" };
  const present = (expected: boolean) => ({ state: "existing_credential_status", present: expected });
  fixture.snapshot = reviewSnapshot(analyticsBindingId);
  expect(await (await send("existing_credential_status", fields)).json()).toEqual(present(false));
  ownSupervisor(analyticsBindingId);
  const checked = await send("existing_credential_status", fields);
  expect(checked.headers.get("cache-control")).toBe("no-store");
  expect(await checked.json()).toEqual(present(true));
  expect(await (await send("existing_credential_status", { ...fields, analyticsBindingId: issue(analyticsKey) })).json()).toEqual(present(false));
  expect(await (await send("existing_credential_status", { ...fields, scope: { ...fixture.scope, revisionId: "old-revision" } })).json()).toEqual(present(false));
  expect((await send("existing_credential_status", fields, { requestOrigin: "https://untrusted.test" })).status).toBe(403);
  expect((await send("existing_credential_status", { ...fields, apiKey: "forged" })).status).toBe(400);

  ownSupervisor(analyticsBindingId, 1, "waiting_approval", { baseUrl: "https://proxy.test/v1" });
  expect(await (await send("existing_credential_status", fields)).json()).toEqual(present(false));
  expect(await (await grant(analyticsBindingId, "stt", existing(stt("unused").consent), "run-1")).json()).toEqual({ error: "credential_unavailable" });
  ownSupervisor(analyticsBindingId, 1, "succeeded");
  expect(await (await send("existing_credential_status", fields)).json()).toEqual(present(false));
  expect(fixture.transport).not.toHaveBeenCalled();
  expect(sockets).toHaveLength(0);
});

it("borrows the active credential only for separately consented recognition and synthesis", async () => {
  const analytics = issue(analyticsKey);
  ownSupervisor(analytics);
  fixture.snapshot = reviewSnapshot(analytics);
  const scope = "run-1";
  const language = { recognitionLanguage: "en", synthesisLanguage: "en" };
  const sttPermission = existing(stt("unused").consent);
  const ttsPermission = existing(tts("unused").consent);
  expect(await (await grant(analytics, "stt", sttPermission)).json()).toEqual({ error: "credential_unavailable" });
  expect((await grant(analytics, "stt", { ...sttPermission, credentialRef: issue(transcriptKey) }, scope)).status).toBe(400);
  expect((await grant(analytics, "tts", sttPermission, scope)).status).toBe(400);
  const recognition = await grantSelection(analytics, "stt", sttPermission, scope);
  const synthesis = await grantSelection(analytics, "tts", ttsPermission, scope);
  expect(await (await send("open", { analyticsBindingId: analytics, runId: scope, selection: { ...language, stt: synthesis, tts: recognition } })).json())
    .toEqual({ error: "consent_required" });
  await openPrepared(analytics, { ...language, stt: recognition, tts: synthesis }, scope);
  expect(fixture.transport).not.toHaveBeenCalled();
  expect(sockets).toHaveLength(0);
  fixture.transport.mockResolvedValueOnce(Response.json({ text: "Editable draft" }));
  expect(await (await work("transcribe", { audioBase64: wave })).json()).toEqual({ state: "transcribed", text: "Editable draft" });
  expect(fixture.transport.mock.calls[0]?.[1]?.headers).toEqual({ authorization: `Bearer ${analyticsKey}` });

  const pending = work("synthesize", { source: { kind: "sample" } });
  await vi.waitFor(() => expect(sockets).toHaveLength(1));
  const socket = sockets[0]!;
  expect(socket.options.headers).toEqual({ Authorization: `Bearer ${analyticsKey}` });
  completeRealtime(socket, startRealtime(socket), "This is an AI-generated OpenAI voice preview.");
  socket.closed();
  const reply = await (await pending).json();
  expect(reply).toMatchObject({ state: "synthesized", aiGeneratedVoice: true });
  expect(JSON.stringify(reply)).not.toContain(analyticsKey);
  expect(JSON.stringify(socket.sent)).not.toContain(analyticsKey);
  expect(await (await send("release_playback", { sessionId: openSession, playbackId: reply.playbackId })).json()).toEqual({ state: "playback_released" });
  await send("close", { sessionId: openSession });
  expect(await (await send("open", lastOpen)).json()).toEqual({ error: "consent_required" });
});

it("leaves no key usable after the active owner or credential disappears", async () => {
  const analytics = issue(analyticsKey);
  ownSupervisor(analytics);
  fixture.snapshot = reviewSnapshot(analytics);
  const language = { recognitionLanguage: "en", synthesisLanguage: "en" };
  const permission = existing(stt("unused").consent);
  const selection = { ...language, stt: await grantSelection(analytics, "stt", permission, "run-1"), tts: "off" };
  ownSupervisor(analytics, 1, "waiting_approval", { apiKey: undefined });
  expect(await (await send("open", { analyticsBindingId: analytics, runId: "run-1", selection })).json()).toEqual({ error: "credential_unavailable" });
  ownSupervisor(analytics);
  await openPrepared(analytics, selection, "run-1");
  activeSupervisorRuns.delete("run-1");
  expect(await (await work("transcribe", { audioBase64: wave })).json()).toEqual({ error: "stale_session" });
  expect(fixture.transport).not.toHaveBeenCalled();
  expect(sockets).toHaveLength(0);
});

it("uses local recognition and explicitly authorized HTTP compatibility synthesis with an exclusive playback grant", async () => {
  const analytics = issue(analyticsKey), synth = issue(playbackKey), rt = issue("synthetic-realtime-key");
  const realtimeSelection = await grantSelection(analytics, "realtime", realtime(rt));
  fixture.transport.mockResolvedValueOnce(pcm());
  const grant = await open(opening(analytics, "whisper_local", ttsCompat(synth)));
  expect(grant).toMatchObject({ stt: "whisper_local", tts: { aiGeneratedVoice: true, compatibilityShutdown: "2027-01-06" } });
  const operationId = randomUUID(), source = { kind: "sample" };
  const reply = await (await work("synthesize", { operationId, source })).json();
  const waveform = Buffer.from(reply.waveformBase64, "base64");
  expect(reply).toMatchObject({ state: "synthesized", aiGeneratedVoice: true });
  expect(waveform.subarray(0, 4).toString()).toBe("RIFF");
  expect(waveform.readUInt32LE(24)).toBe(24_000);
  expect(waveform.subarray(44)).toEqual(Buffer.from([1, 0, 2, 0]));
  const [url, init] = fixture.transport.mock.calls[0]!;
  expect(url).toBe("https://api.openai.com/v1/audio/speech");
  expect(init?.headers).toMatchObject({ authorization: `Bearer ${playbackKey}` });
  expect(JSON.parse(String(init?.body))).toMatchObject({ model: "gpt-4o-mini-tts-2025-12-15", voice: "alloy", response_format: "pcm", stream_format: "audio" });
  expect(await (await work("synthesize", { source })).json()).toEqual({ error: "voice_busy" });
  expect(await (await send("realtime_eligibility", { analyticsBindingId: analytics, selection: realtimeSelection })).json()).toEqual({ error: "voice_busy" });
  expect(await (await send("release_playback", { sessionId: openSession, playbackId: reply.playbackId })).json()).toEqual({ state: "playback_released" });
  expect(await (await work("synthesize", { operationId, source })).json()).toEqual({ error: "operation_replayed" });
  expect(await (await work("transcribe", { audioBase64: wave })).json()).toEqual({ error: "consent_required" });
  expect(fixture.transport).toHaveBeenCalledTimes(1);
});

it("uses independently admitted recognition and synthesis keys and only current verified notification text", async () => {
  const analytics = issue(analyticsKey), recognition = issue(transcriptKey), synth = issue(playbackKey);
  ownSupervisor(analytics);
  fixture.snapshot = reviewSnapshot(analytics);
  expect(activeSupervisorApiSpeechBinding("run-1")).toMatchObject({ bindingId: analytics, sessionEpoch: 1 });
  fixture.transport.mockResolvedValueOnce(Response.json({ text: "A draft" })).mockResolvedValueOnce(pcm());
  await open(opening(analytics, stt(recognition), ttsCompat(synth), "run-1"));
  await work("transcribe", { audioBase64: wave });
  const source = { kind: "verified_event", runId: "run-1", notificationKey: "run-1:approval:proposal-1" };
  expect(await (await work("synthesize", { source: { ...source, notificationKey: "wrong" } })).json()).toEqual({ error: "notification_unavailable" });
  expect(await (await work("synthesize", { source: { ...source, notificationKey: "run-1:public:1" } })).json()).toEqual({ error: "notification_unavailable" });
  expect(await (await work("synthesize", { source: { ...source, runId: "wrong-run" } })).json()).toEqual({ error: "notification_unavailable" });
  expect(await (await work("synthesize", { source: { ...source, text: "invented claim" } })).json()).toEqual({ error: "invalid_voice_request" });
  const response = await (await work("synthesize", { source })).json();
  expect(response.state).toBe("synthesized");
  expect(fixture.transport.mock.calls.map(([, init]) => (init?.headers as { authorization: string }).authorization)).toEqual([
    `Bearer ${transcriptKey}`, `Bearer ${playbackKey}`
  ]);
  expect(JSON.parse(String(fixture.transport.mock.calls[1]?.[1]?.body)).input).toBe("Approval needed. Review the pending changes.");
  await send("release_playback", { sessionId: openSession, playbackId: response.playbackId });
  expect(await (await work("synthesize", { source })).json()).toEqual({ error: "operation_replayed" });
  expect(fixture.transport).toHaveBeenCalledTimes(2);
});

it.each(["before dispatch", "after provider settles"] as const)(
  "retires a two-key speech lease when the absolute deadline elapses %s", async checkpoint => {
    const startedAt = new Date("2026-11-27T00:00:00.000Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(startedAt);
      const analytics = issue(analyticsKey);
      ownSupervisor(analytics);
      fixture.snapshot = reviewSnapshot(analytics);
      const lease = await open(opening(analytics, stt(issue(transcriptKey)), ttsCompat(issue(playbackKey)), "run-1"));
      fixture.transport.mockResolvedValueOnce(Response.json({ text: "A draft" }));
      expect(await (await work("transcribe", { audioBase64: wave })).json()).toEqual({ state: "transcribed", text: "A draft" });
      expect(fixture.transport.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: `Bearer ${transcriptKey}` });

      let headReads = 0;
      if (checkpoint === "before dispatch") {
        fixture.headRead = () => { if (++headReads === 2) vi.setSystemTime(lease.expiresAt); };
      }
      fixture.transport.mockImplementationOnce(async () => {
        vi.setSystemTime(lease.expiresAt);
        return pcm();
      });
      const source = { kind: "verified_event", runId: "run-1", notificationKey: "run-1:approval:proposal-1" };
      expect(await (await work("synthesize", { source })).json()).toEqual({ error: "stale_session" });
      expect(fixture.transport).toHaveBeenCalledTimes(checkpoint === "before dispatch" ? 1 : 2);
      if (checkpoint === "after provider settles") {
        expect(fixture.transport.mock.calls[1]?.[1]?.headers).toMatchObject({ authorization: `Bearer ${playbackKey}` });
      }
      expect(await (await work("synthesize", { source })).json()).toEqual({ error: "stale_session" });
      expect(await (await send("open", lastOpen)).json()).toEqual({ error: "consent_required" });
      fixture.headRead = undefined;
      await open(opening(analytics, stt(issue(transcriptKey)), ttsCompat(issue(playbackKey)), "run-1"));
    } finally {
      vi.setSystemTime(startedAt);
      if (openSession) await send("close", { sessionId: openSession });
      vi.useRealTimers();
    }
  }
);

it("grounds canonical question readback in the current pending occurrence and rejects stale, mismatched and duplicate keys", async () => {
  const analytics = issue(analyticsKey);
  ownSupervisor(analytics, 1, "needs_user_input");
  const stale = { id: "question-old", question: "Old question?" };
  const pending = { id: "question-current", question: "What throughput should I use?" };
  const occurrence = (question: typeof pending, seq: number) => ({
    id: `public-${seq}`, runId: "run-1", seq, timestamp: "2026-11-26T00:00:00Z", type: "clarifying_questions", questions: [question],
    metadata: { eventV2Id: `canonical-${seq}`, questionSetId: `set-${seq}` }
  });
  fixture.snapshot = { ...reviewSnapshot(analytics), status: "needs_user_input", pendingQuestions: [pending],
    events: [occurrence(stale, 3), occurrence(pending, 4)] };
  const requestReadbackLease = async () => {
    const tts = await grantSelection(analytics, "tts", {
      ...existing("send_text_openai_api_billing_ai_voice"), purpose: "current_run_readback"
    }, "run-1");
    return openPrepared(analytics, { stt: "off", tts, recognitionLanguage: "auto", synthesisLanguage: "en" }, "run-1");
  };
  const lease = await requestReadbackLease();
  expect(lease.tts.purpose).toBe("current_run_readback");
  const source = { kind: "verified_event", runId: "run-1", notificationKey: "run-1:question:set-4:canonical-4" };
  expect(await (await work("synthesize", { source: { ...source, notificationKey: "run-1:question:set-3:canonical-3" } })).json())
    .toEqual({ error: "notification_unavailable" });
  expect(await (await work("synthesize", { source: { ...source, notificationKey: "run-1:question:set-4:public-4" } })).json())
    .toEqual({ error: "notification_unavailable" });
  expect(await (await work("synthesize", { source: { kind: "sample" } })).json()).toEqual({ error: "notification_unavailable" });
  fixture.snapshot = { ...fixture.snapshot, events: [occurrence(stale, 3), occurrence(pending, 4),
    { id: "new-read", type: "skill_read", runId: "run-1", seq: 5, metadata: { readReceiptId: "read-5" } }] };
  expect(await (await work("synthesize", { source: { ...source, notificationKey: "run-1:public:5" } })).json())
    .toEqual({ error: "notification_unavailable" });
  const reading = work("synthesize", { source });
  await vi.waitFor(() => expect(sockets).toHaveLength(1));
  const socket = sockets[0]!;
  expect(socket.options.headers).toEqual({ Authorization: `Bearer ${analyticsKey}` });
  expect(await (await work("synthesize", { source })).json()).toEqual({ error: "voice_busy" });
  const response = startRealtime(socket);
  const text = "Question. What throughput should I use?";
  expect(socket.sent[1]?.response).toMatchObject({ input: [{ content: [{ type: "input_text", text }] }] });
  completeRealtime(socket, response, text);
  socket.closed();
  const reply = await (await reading).json();
  expect(reply).toMatchObject({ state: "synthesized" });
  await send("release_playback", { sessionId: openSession, playbackId: reply.playbackId });
  expect(await (await work("synthesize", { source })).json()).toEqual({ error: "operation_replayed" });
  expect((await send("close", { sessionId: openSession })).status).toBe(200);
  await requestReadbackLease();
  expect(await (await work("synthesize", { source })).json()).toEqual({ error: "readback_already_requested" });
  expect((await send("close", { sessionId: openSession })).status).toBe(200);
  await requestReadbackLease();
  fixture.snapshot = { ...fixture.snapshot, status: "running", pendingQuestions: undefined };
  expect(await (await work("synthesize", { source })).json()).toEqual({ error: "notification_unavailable" });
  expect(sockets).toHaveLength(1);
  expect(fixture.transport).not.toHaveBeenCalled();
});

it("defaults to stable tool-free Realtime for only the current trusted text, with one playback and no HTTP request", async () => {
  const analytics = issue(analyticsKey);
  ownSupervisor(analytics);
  fixture.snapshot = reviewSnapshot(analytics);
  const lease = await open(opening(analytics, "whisper_local", tts(issue(playbackKey)), "run-1"));
  expect(lease.tts).toEqual({ provider: "openai", transport: "realtime_synthesis", model: "gpt-realtime-2.1-mini",
    boundary: "provider_service", billing: "api", aiGeneratedVoice: true });
  const operationId = randomUUID();
  const source = { kind: "verified_event", runId: "run-1", notificationKey: "run-1:approval:proposal-1" };
  const pending = work("synthesize", { operationId, source });
  await vi.waitFor(() => expect(sockets).toHaveLength(1));
  const socket = sockets[0]!;
  expect(socket.url).toBe("wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1-mini");
  expect(socket.options.headers).toEqual({ Authorization: `Bearer ${playbackKey}` });
  const response = startRealtime(socket);
  const text = "Approval needed. Review the pending changes.";
  expect(socket.sent.map(event => event.type)).toEqual(["session.update", "response.create"]);
  expect(socket.sent[1]?.response).toMatchObject({ conversation: "none", tools: [], tool_choice: "none", input: [
    { type: "message", role: "user", content: [{ type: "input_text", text }] }
  ] });
  completeRealtime(socket, response, text);
  expect(socket.closing).toEqual([1000]);
  expect(await (await work("synthesize", { source })).json()).toEqual({ error: "voice_busy" });
  socket.closed();

  const generated = await (await pending).json();
  expect(generated).toMatchObject({ state: "synthesized", aiGeneratedVoice: true });
  const output = Buffer.from(generated.waveformBase64, "base64");
  expect(output.readUInt32LE(24)).toBe(24_000);
  expect(output.subarray(44)).toEqual(Buffer.from([1, 0, 2, 0]));
  expect(await (await work("synthesize", { source })).json()).toEqual({ error: "voice_busy" });
  await send("release_playback", { sessionId: openSession, playbackId: generated.playbackId });
  expect(await (await work("synthesize", { operationId, source })).json()).toEqual({ error: "operation_replayed" });
  expect(await (await work("synthesize", { source })).json()).toEqual({ error: "operation_replayed" });
  expect(sockets).toHaveLength(1);
  expect(fixture.transport).not.toHaveBeenCalled();
});

it("rejects stable provider mismatch and never substitutes HTTP or opens a second socket", async () => {
  await open(opening(issue(analyticsKey), "off", tts(issue(playbackKey))));
  const operationId = randomUUID(), source = { kind: "sample" };
  const pending = work("synthesize", { operationId, source });
  await vi.waitFor(() => expect(sockets).toHaveLength(1));
  const socket = sockets[0]!;
  const response = startRealtime(socket);
  completeRealtime(socket, response, "Unexpected provider text.");
  expect(socket.closing).toEqual([1000]);
  expect(socket.sent.at(-1)).toMatchObject({ type: "response.cancel", response_id: "resp_voice" });
  socket.closed();
  expect(await (await pending).json()).toEqual({ error: "invalid_response" });
  expect(await (await work("synthesize", { operationId, source })).json()).toEqual({ error: "operation_replayed" });
  expect(fixture.transport).not.toHaveBeenCalled();
  expect(sockets).toHaveLength(1);
});

it("cancels the stable response by ID and keeps the voice owner until the socket closes", async () => {
  const analytics = issue(analyticsKey);
  await open(opening(analytics, "off", tts(issue(playbackKey))));
  const pending = work("synthesize", { source: { kind: "sample" } });
  await vi.waitFor(() => expect(sockets).toHaveLength(1));
  const socket = sockets[0]!;
  startRealtime(socket);
  expect((await send("close", { sessionId: openSession })).status).toBe(200);
  expect(socket.sent.at(-1)).toEqual({ type: "response.cancel", response_id: "resp_voice" });
  const fresh = issue(playbackKey);
  expect(await (await grant(analytics, "tts", tts(fresh))).json()).toEqual({ error: "voice_busy" });
  socket.closed();
  expect(await (await pending).json()).toEqual({ error: "cancelled" });
  await open(opening(analytics, "off", tts(fresh)));
  expect(fixture.transport).not.toHaveBeenCalled();
  expect(sockets).toHaveLength(1);
});

it("will not substitute stable and compatibility permissions even before opening a lease", async () => {
  const analyticsBindingId = issue(analyticsKey);
  const stable = await grantSelection(analyticsBindingId, "tts", tts(issue(playbackKey)));
  const compatibility = await grantSelection(analyticsBindingId, "tts_compatibility", ttsCompat(issue(playbackKey)));
  const selection = { stt: "off", synthesisLanguage: "en", recognitionLanguage: "en" };
  for (const tts of [{ ...stable, transport: "http_compatibility" }, { ...compatibility, transport: "realtime_synthesis" }]) {
    expect(await (await send("open", { analyticsBindingId, selection: { ...selection, tts } })).json()).toEqual({ error: "consent_required" });
  }
  expect(fixture.transport).not.toHaveBeenCalled();
  expect(sockets).toHaveLength(0);
});

it("refuses cloud from Local, CLI, hosted, stale, cross-origin and forged consent paths", async () => {
  const analytics = issue(analyticsKey), recognition = issue(transcriptKey);
  for (const binding of ["native-local", "subscription-cli", "fake-binding"]) {
    expect(await (await grant(binding, "stt", stt(recognition))).json()).toEqual({ error: "api_mode_required" });
  }
  expect((await send("open", opening(analytics, stt(recognition), "off"), { requestOrigin: "https://outside.example" })).status).toBe(403);
  expect(await (await grant(analytics, "stt", { ...stt(recognition), apiKey: "forged" })).json()).toEqual({ error: "invalid_voice_request" });
  expect(await (await grant(analytics, "stt", { ...stt(recognition), consent: "included" })).json()).toEqual({ error: "invalid_voice_request" });
  const recognitionGrant = await grantSelection(analytics, "stt", stt(recognition));
  const fields = { analyticsBindingId: analytics, selection: { stt: recognitionGrant, tts: "off", recognitionLanguage: "en", synthesisLanguage: "en" } };
  expect(await (await send("open", { ...fields, scope: { ...fixture.scope, projectId: "unknown" } })).json()).toEqual({ error: "scope_unavailable" });
  expect(await (await send("open", { ...fields, selection: { ...fields.selection, tts: recognitionGrant } })).json()).toEqual({ error: "consent_required" });
  expect((await send("transcribe", { analyticsBindingId: analytics, sessionId: randomUUID(), operationId: randomUUID(), audioBase64: wave })).status).toBe(409);
  vi.stubEnv("VDT_APP_MODE", "hosted_web");
  expect((await send("open", opening(analytics, stt(recognition), "off"))).status).toBe(403);
  vi.stubEnv("VDT_APP_MODE", "desktop");
  vi.stubEnv("VDT_OPENAI_SPEECH_BYOK_ENABLED", "false");
  expect((await send("open", opening(analytics, stt(recognition), "off"))).status).toBe(403);
  expect(fixture.transport).not.toHaveBeenCalled();
});

const separateSelection = { provider: "openai", credentialSource: "host_voice_key", purpose: "separate_host_sample",
  consent: "send_sample_openai_voice_api_billing" };

it.skipIf(typeof process.getuid !== "function").each(["local", "cli", "anthropic"] as const)(
  "uses only the separate host key for a consented fixed sample beside %s analytics", async (analytics) => {
  const analyticsBindingId = analytics === "anthropic" ? openAiSessionBindings(agentExecutionBindingRegistry).admitProvider({
    providerId: "anthropic", providerConfig: { model: "claude-fixture", apiKey: analyticsKey }
  }, "sha256:" + "a".repeat(64)).bindingId : analytics === "local" ? "native-local" : "subscription-cli";
  if (analytics === "anthropic") issued.add(analyticsBindingId);
  ownSupervisor(analyticsBindingId);
  fixture.snapshot = reviewSnapshot(analyticsBindingId);
  const fields = { analyticsBindingId, runId: "run-1" };
  expect(await (await send("separate_credential_status", fields)).json()).toEqual({ state: "separate_credential_status", present: false });
  const voiceKey = "synthetic-host-voice-key";
  await installVoiceKey(voiceKey);
  expect(await (await send("existing_credential_status", fields)).json()).toEqual({ state: "existing_credential_status", present: false });
  expect(await (await send("separate_credential_status", fields)).json()).toEqual({ state: "separate_credential_status", present: true });
  expect(await (await grant(analyticsBindingId, "tts", { ...separateSelection, consent: "included" }, "run-1")).json())
    .toEqual({ error: "invalid_voice_request" });
  expect(sockets).toHaveLength(0);
  const tts = await grantSelection(analyticsBindingId, "tts", separateSelection, "run-1");
  const selection = { stt: "off", tts, recognitionLanguage: "auto", synthesisLanguage: "en" };
  const lease = await openPrepared(analyticsBindingId, selection, "run-1");
  expect(lease.tts).toMatchObject({ purpose: "separate_host_sample", transport: "realtime_synthesis", billing: "api" });
  expect(await (await work("synthesize", { source: { kind: "verified_event", runId: "run-1",
    notificationKey: "run-1:approval:proposal-1" } })).json()).toEqual({ error: "notification_unavailable" });
  expect(await (await work("transcribe", { audioBase64: wave })).json()).toEqual({ error: "consent_required" });
  const result = work("synthesize", { source: { kind: "sample" } });
  await vi.waitFor(() => expect(sockets).toHaveLength(1));
  const socket = sockets[0]!;
  expect(socket.options.headers).toEqual({ Authorization: `Bearer ${voiceKey}` });
  const streamed = startRealtime(socket);
  const phrase = "This is an AI-generated OpenAI voice preview.";
  expect(socket.sent[1]?.response).toMatchObject({ input: [{ content: [{ type: "input_text", text: phrase }] }] });
  completeRealtime(socket, streamed, phrase);
  socket.closed();
  const response = await (await result).json();
  expect(response).toMatchObject({ state: "synthesized", aiGeneratedVoice: true });
  expect(JSON.stringify(response)).not.toContain(voiceKey);
  await send("release_playback", { sessionId: openSession, playbackId: response.playbackId });
  expect(await (await work("synthesize", { source: { kind: "sample" } })).json()).toEqual({ error: "operation_replayed" });
  expect(sockets).toHaveLength(1);
  expect(fixture.transport).not.toHaveBeenCalled();
});

it.skipIf(typeof process.getuid !== "function")("rejects separate host-key use after run epoch, saved revision or key replacement, without provider contact", async () => {
  const analyticsBindingId = "native-local";
  ownSupervisor(analyticsBindingId);
  fixture.snapshot = reviewSnapshot(analyticsBindingId);
  await installVoiceKey("synthetic-voice-before");
  vi.stubEnv("VDT_APP_MODE", "desktop");
  expect((await send("separate_credential_status", { analyticsBindingId, runId: "run-1" })).status).toBe(403);
  expect((await grant(analyticsBindingId, "tts", separateSelection, "run-1")).status).toBe(403);
  vi.stubEnv("VDT_APP_MODE", "development_web");
  const tts = await grantSelection(analyticsBindingId, "tts", separateSelection, "run-1");
  const selection = { stt: "off", tts, recognitionLanguage: "auto", synthesisLanguage: "en" };
  expect(await (await send("open", { analyticsBindingId, runId: "run-1", selection: { ...selection, stt: "whisper_local" } })).json())
    .toEqual({ error: "consent_required" });
  await openPrepared(analyticsBindingId, selection, "run-1");
  await installVoiceKey("synthetic-voice-after");
  expect(await (await work("synthesize", { source: { kind: "sample" } })).json()).toEqual({ error: "stale_session" });
  const next = await grantSelection(analyticsBindingId, "tts", separateSelection, "run-1");
  ownSupervisor(analyticsBindingId, 2);
  expect(await (await send("open", { analyticsBindingId, runId: "run-1", selection: { ...selection, tts: next } })).json())
    .toEqual({ error: "consent_required" });
  fixture.head = { activeRevisionId: "revision-two", commitGeneration: 2 };
  expect(await (await send("separate_credential_status", { analyticsBindingId, runId: "run-1" })).json())
    .toEqual({ state: "separate_credential_status", present: false });
  expect(sockets).toHaveLength(0);
});

it.skipIf(typeof process.getuid !== "function")("retires a separate sample when the analytical run terminates before provider dispatch", async () => {
  const analyticsBindingId = "native-local";
  ownSupervisor(analyticsBindingId);
  fixture.snapshot = reviewSnapshot(analyticsBindingId);
  await installVoiceKey("synthetic-voice-currentness");
  const tts = await grantSelection(analyticsBindingId, "tts", separateSelection, "run-1");
  await openPrepared(analyticsBindingId, { stt: "off", tts, recognitionLanguage: "auto", synthesisLanguage: "en" }, "run-1");
  const workResult = work("synthesize", { source: { kind: "sample" } });
  await vi.waitFor(() => expect(sockets).toHaveLength(1));
  const socket = sockets[0]!;
  try {
    const session = { id: "sess_test", type: "realtime", model: "gpt-realtime-2.1-mini" };
    socket.receive("session.created", { session });
    expect(socket.sent.map(event => event.type)).toEqual(["session.update"]);
    fixture.snapshot = { ...fixture.snapshot, status: "succeeded" };
    socket.receive("session.updated", { session: { ...session, output_modalities: ["audio"], tools: [], tool_choice: "none", tracing: null,
      audio: { input: { turn_detection: null, transcription: null },
        output: { format: { type: "audio/pcm", rate: 24_000 }, voice: "alloy" } } } });
    expect(socket.sent.map(event => event.type)).not.toContain("response.create");
  } finally {
    socket.closed();
  }
  expect(await (await workResult).json()).toEqual({ error: "stale_session" });
});

it("returns a tool-free realtime eligibility envelope with no connection or speech and excludes split selections", async () => {
  const analytics = issue(analyticsKey), ref = issue(playbackKey);
  const fields = { analyticsBindingId: analytics, selection: await grantSelection(analytics, "realtime", realtime(ref)) };
  const response = await send("realtime_eligibility", fields);
  expect(await response.json()).toMatchObject({ state: "eligible_envelope_only", transportEnabled: false, billing: "api", model: "gpt-realtime-2.1-mini", envelope: {
    type: "session.update", session: { tools: [], tool_choice: "none", audio: { input: { format: { rate: 24_000 }, turn_detection: null } } }
  } });
  expect(await (await send("realtime_eligibility", { ...fields, selection: { ...fields.selection, stt: "apple_local" } })).json()).toEqual({ error: "invalid_voice_request" });
  expect(fixture.transport).not.toHaveBeenCalled();
});

it("absorbs upstream quota, denial, over-limit and redirect details and does not retry or fall back", async () => {
  await open(opening(issue(analyticsKey), stt(issue(transcriptKey)), "off"));
  fixture.transport.mockResolvedValueOnce(Response.json({ error: { code: "insufficient_quota", message: transcriptKey } }, { status: 429 }))
    .mockResolvedValueOnce(Response.json({ error: { code: "rate_limit_exceeded", message: transcriptKey } }, { status: 429 }))
    .mockResolvedValueOnce(Response.json({ key: transcriptKey }, { status: 401 }))
    .mockResolvedValueOnce(new Response("", { status: 302, headers: { location: "https://outside.example" } }))
    .mockResolvedValueOnce(Response.json({ text: transcriptKey }))
    .mockResolvedValueOnce(Response.json({ text: "x".repeat(17_000) }));
  expect(await (await work("transcribe", { audioBase64: "AAAA" })).json()).toEqual({ error: "invalid_audio" });
  expect(fixture.transport).not.toHaveBeenCalled();
  for (const error of ["quota_exhausted", "rate_limited", "credentials_rejected", "provider_unavailable", "invalid_response", "invalid_response"]) {
    expect(await (await work("transcribe", { audioBase64: wave })).json()).toEqual(error === "quota_exhausted"
      ? { error, choices: ["use_local_speech", "review_api_billing"] } : { error });
  }
  expect(fixture.transport).toHaveBeenCalledTimes(6);
});

it("cancels the owned request without allowing a late result or transferring the audio lease", async () => {
  const analytics = issue(analyticsKey);
  const old = opening(analytics, stt(issue(transcriptKey)), "off");
  await open(old);
  let begin!: () => void;
  const started = new Promise<void>(resolve => { begin = resolve; });
  fixture.transport.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => reject(Error("private signal reason")), { once: true });
    begin();
  }));
  const pending = work("transcribe", { audioBase64: wave });
  await started;
  expect((await send("close", { sessionId: openSession })).status).toBe(200);
  expect(await (await pending).json()).toEqual({ error: "cancelled" });
  expect(await (await work("transcribe", { audioBase64: wave })).json()).toEqual({ error: "stale_session" });
  expect(await (await send("open", lastOpen)).json()).toEqual({ error: "consent_required" });
  await open(opening(analytics, stt(issue(transcriptKey)), "off"));
  expect(fixture.transport).toHaveBeenCalledTimes(1);
});

it("bounds the separate transport deadline and response audio size", async () => {
  const delayed = vi.fn<typeof fetch>().mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => reject(Error("sensitive provider error")), { once: true });
  })).mockResolvedValueOnce(new Response(new Uint8Array(1_152_001), { headers: { "content-type": "application/octet-stream" } }));
  const audio = new OpenAiAudio(delayed, 25);
  await expect(audio.synthesize(playbackKey, "A test voice.", new AbortController().signal)).rejects.toMatchObject({ code: "timeout" });
  await expect(audio.synthesize(playbackKey, "A test voice.", new AbortController().signal)).rejects.toMatchObject({ code: "invalid_response" });
});

it("withdraws the fixed HTTP synthesis model at its announced shutdown", async () => {
  const analytics = issue(analyticsKey), synth = issue(playbackKey), recognition = issue(transcriptKey);
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(new Date("2027-01-06T00:00:00.000Z"));
    expect(await (await grant(analytics, "tts_compatibility", ttsCompat(synth))).json()).toEqual({ error: "speech_model_retired" });
    expect(agentExecutionBindingRegistry.has(synth)).toBe(true);
    const lease = await open(opening(analytics, stt(recognition), tts(issue(playbackKey))));
    expect(lease.tts).toMatchObject({ transport: "realtime_synthesis", model: "gpt-realtime-2.1-mini" });
    expect(fixture.transport).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

it("checks the exact saved revision immediately before sending and again after the provider settles", async () => {
  const analytics = issue(analyticsKey);
  await open(opening(analytics, stt(issue(transcriptKey)), "off"));
  let reads = 0;
  fixture.headRead = () => { if (++reads === 2) fixture.head = { activeRevisionId: "revision-two", commitGeneration: 2 }; };
  expect(await (await work("transcribe", { audioBase64: wave })).json()).toEqual({ error: "stale_session" });
  expect(fixture.transport).not.toHaveBeenCalled();
  fixture.headRead = undefined;
  expect(await (await grant(analytics, "stt", stt(issue(transcriptKey)))).json()).toEqual({ error: "scope_unavailable" });
  fixture.head = { activeRevisionId: "revision-one", commitGeneration: 1 };
  await open(opening(analytics, stt(issue(transcriptKey)), "off"));
  fixture.transport.mockImplementationOnce(async () => {
    fixture.head = { activeRevisionId: "revision-three", commitGeneration: 3 };
    return Response.json({ text: "Late draft" });
  });
  expect(await (await work("transcribe", { audioBase64: wave })).json()).toEqual({ error: "stale_session" });
  expect(fixture.transport).toHaveBeenCalledTimes(1);
});

it("does not carry staged speech to a different analytics binding, run epoch, pending event or historical run", async () => {
  const analytics = issue(analyticsKey);
  fixture.snapshot = reviewSnapshot(analytics);
  expect(await (await grant(analytics, "tts", tts(issue(playbackKey)), "run-1")).json()).toEqual({ error: "api_mode_required" });
  ownSupervisor(analytics);
  await open(opening(analytics, "whisper_local", ttsCompat(issue(playbackKey)), "run-1"));
  const source = { kind: "verified_event", runId: "run-1", notificationKey: "run-1:approval:proposal-1" };
  expect(await (await work("synthesize", { source, analyticsBindingId: issue(analyticsKey) })).json()).toEqual({ error: "stale_session" });
  expect(fixture.transport).not.toHaveBeenCalled();
  fixture.transport.mockImplementationOnce(async () => {
    fixture.snapshot = { ...reviewSnapshot(analytics), pendingMutationProposal: { id: "proposal-2" } };
    return pcm();
  });
  expect(await (await work("synthesize", { source })).json()).toEqual({ error: "notification_unavailable" });
  ownSupervisor(analytics, 2);
  expect(await (await work("synthesize", { source: { kind: "sample" } })).json()).toEqual({ error: "stale_session" });
  fixture.snapshot = { ...reviewSnapshot(analytics), status: "succeeded" };
  ownSupervisor(analytics, 2, "succeeded");
  expect(await (await grant(analytics, "tts", tts(issue(playbackKey)), "run-1")).json()).toEqual({ error: "api_mode_required" });
  expect(fixture.transport).toHaveBeenCalledTimes(1);
});

it("quarantines paid speech when transport abort cannot be confirmed", async () => {
  const analytics = issue(analyticsKey);
  await open(opening(analytics, stt(issue(transcriptKey)), "off"));
  let begin!: () => void;
  const started = new Promise<void>(resolve => { begin = resolve; });
  fixture.transport.mockImplementationOnce(() => new Promise(() => begin()));
  const command = work("transcribe", { audioBase64: wave });
  await started;
  expect((await send("close", { sessionId: openSession })).status).toBe(200);
  const nextRef = issue(transcriptKey);
  expect(await (await grant(analytics, "stt", stt(nextRef))).json()).toEqual({ error: "voice_busy" });
  const unsettled = await command;
  expect(unsettled.status).toBe(503);
  expect(await unsettled.json()).toEqual({ error: "cleanup_unconfirmed" });
  expect(await (await grant(analytics, "stt", stt(nextRef))).json()).toEqual({ error: "cleanup_unconfirmed" });
  expect(agentExecutionBindingRegistry.has(nextRef)).toBe(true);
  expect(fixture.transport).toHaveBeenCalledTimes(1);
});
