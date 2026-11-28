import { once } from "node:events";
import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OPENAI_REALTIME_SPEECH_MODEL, OpenAiRealtimeSpeech } from "./openai-realtime";

const syntheticKey = "synthetic-realtime-fixture";
const approved = "Загрузка завершена.";
const endpoint = "wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1-mini";
const audio = { output: { format: { type: "audio/pcm", rate: 24_000 }, voice: "alloy" } };
const session = { id: "sess_fixture", type: "realtime", model: OPENAI_REALTIME_SPEECH_MODEL };
const configured = { ...session, output_modalities: ["audio"], tools: [], tool_choice: "none", tracing: null,
  audio: { input: { turn_detection: null, transcription: null }, ...audio } };

class SocketFixture extends EventTarget {
  readyState = 1;
  sent: Record<string, unknown>[] = [];
  closed: number[] = [];
  private sequence = 0;
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close(code: number) { this.closed.push(code); this.readyState = 2; }
  raw(data: unknown) { this.dispatchEvent(new MessageEvent("message", { data })); }
  receive(type: string, fields: Record<string, unknown> = {}) {
    this.raw(JSON.stringify({ event_id: `event_${++this.sequence}`, type, ...fields }));
  }
  disconnected(wasClean = true, code = wasClean ? 1000 : 1006) {
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent("close", { code, wasClean }));
  }
}

function fixture(beforeSend?: () => void, timeout = 22_000, grace = 1_500) {
  const socket = new SocketFixture();
  const connect = vi.fn(() => socket as unknown as WebSocket);
  const controller = new AbortController();
  const transport = new OpenAiRealtimeSpeech(connect, timeout, grace);
  const result = transport.synthesize(syntheticKey, approved, controller.signal, beforeSend);
  const outcome: Promise<{ wave?: Buffer; error?: unknown }> = result.then(wave => ({ wave }), error => ({ error }));
  const sessionCreated = () => socket.receive("session.created", { session });
  const sessionUpdated = (effective = configured) => socket.receive("session.updated", { session: effective });
  const response = (patch: Record<string, unknown> = {}) => ({
    id: "resp_fixture", metadata: (socket.sent[1]?.response as Record<string, unknown>)?.metadata,
    conversation_id: null, output_modalities: ["audio"], audio, ...patch
  });
  const part = { type: "output_audio", transcript: approved };
  const item = { id: "item_fixture", type: "message", role: "assistant", status: "completed", content: [part] };
  const itemFields = { response_id: "resp_fixture", output_index: 0 };
  const partFields = { ...itemFields, item_id: "item_fixture", content_index: 0 };
  const startResponse = () => {
    sessionCreated(); sessionUpdated();
    socket.receive("response.created", { response: response({ status: "in_progress", output: [] }) });
  };
  const startPart = () => {
    socket.receive("response.output_item.added", { ...itemFields, item: { ...item, status: "in_progress", content: [] } });
    socket.receive("response.content_part.added", { ...partFields, part: { type: "output_audio" } });
  };
  const final = (patch: Record<string, unknown> = {}) =>
    socket.receive("response.done", { response: response({ status: "completed", output: [item], ...patch }) });
  const finishParts = (delta = "AQIDBA==") => {
    socket.receive("response.output_audio.delta", { ...partFields, delta });
    socket.receive("response.output_audio_transcript.delta", { ...partFields, delta: "Загрузка" });
    socket.receive("response.output_audio_transcript.delta", { ...partFields, delta: " завершена." });
    socket.receive("response.output_audio_transcript.done", { ...partFields, transcript: approved });
    socket.receive("response.output_audio.done", partFields);
    socket.receive("response.content_part.done", { ...partFields, part });
    socket.receive("response.output_item.done", { ...itemFields, item });
  };
  return { socket, connect, controller, outcome, result, sessionCreated, sessionUpdated, startResponse, startPart, final, finishParts, partFields, itemFields };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("OpenAI GA Realtime speech synthesis", () => {
  it("sends only one out-of-band exact-text request and releases the correlated 24 kHz PCM only after normal close", async () => {
    const scope = vi.fn();
    const f = fixture(scope);
    expect(f.connect).toHaveBeenCalledExactlyOnceWith(endpoint, { Authorization: `Bearer ${syntheticKey}` });
    expect(f.socket.sent).toEqual([]);
    f.startResponse(); f.startPart();
    expect(f.socket.sent).toEqual([
      { type: "session.update", session: { type: "realtime", output_modalities: ["audio"], instructions: expect.any(String), tools: [],
        tool_choice: "none", tracing: null, reasoning: { effort: "minimal" },
        audio: { input: { turn_detection: null, transcription: null }, ...audio } } },
      { type: "response.create", response: { conversation: "none", metadata: { speech_request_id: expect.any(String) },
        instructions: expect.any(String), output_modalities: ["audio"], audio, tools: [], tool_choice: "none", max_output_tokens: 768,
        reasoning: { effort: "minimal" }, input: [{ type: "message", role: "user", content: [{ type: "input_text", text: approved }] }] } }
    ]);
    expect(JSON.stringify(f.socket.sent)).not.toContain(syntheticKey);
    let settled = false; void f.outcome.then(() => { settled = true; });
    f.finishParts();
    await Promise.resolve(); expect(settled).toBe(false);
    f.final();
    await Promise.resolve(); expect(settled).toBe(false); expect(f.socket.closed).toEqual([1000]);
    f.socket.disconnected();
    const wave = await f.result;
    expect(wave.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wave.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wave.readUInt16LE(22)).toBe(1); expect(wave.readUInt32LE(24)).toBe(24_000);
    expect(wave.readUInt32LE(40)).toBe(4); expect(wave.subarray(44)).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(scope).toHaveBeenCalledTimes(4);
  });

  it.each(["wrong model", "VAD", "tools", "output sample rate", "wrong session"])("rejects an effective %s before approved text is sent", async change => {
    const f = fixture(), effective = structuredClone(configured);
    if (change === "wrong model") effective.model = "other" as typeof effective.model;
    if (change === "VAD") Object.assign(effective.audio.input, { turn_detection: { type: "server_vad" } });
    if (change === "tools") Object.assign(effective, { tools: [{ type: "function", name: "execute" }] });
    if (change === "output sample rate") effective.audio.output.format.rate = 16_000;
    if (change === "wrong session") effective.id = "sess_other";
    f.sessionCreated(); f.sessionUpdated(effective); f.socket.disconnected();
    expect((await f.outcome).error).toMatchObject({ code: "invalid_response" });
    expect(f.socket.sent.map(event => event.type)).toEqual(["session.update"]);
  });

  it.each(["wrong item", "wrong part", "wrong response", "mismatched transcript", "noncanonical PCM", "non-audio", "foreign metadata",
    "short PCM", "partial output", "extra item", "final transcript", "duplicate event", "foreign conversation"])(
    "discards audio and settles the socket on %s", async change => {
      const f = fixture(); f.startResponse(); f.startPart();
      if (change === "wrong item") f.socket.receive("response.output_audio.delta", { ...f.partFields, item_id: "other", delta: "AQI=" });
      if (change === "wrong part") f.socket.receive("response.output_audio.delta", { ...f.partFields, content_index: 1, delta: "AQI=" });
      if (change === "wrong response") f.socket.receive("response.output_audio.delta", { ...f.partFields, response_id: "other", delta: "AQI=" });
      if (change === "mismatched transcript") f.socket.receive("response.output_audio_transcript.done", { ...f.partFields, transcript: "Загрузка остановлена." });
      if (change === "noncanonical PCM") f.socket.receive("response.output_audio.delta", { ...f.partFields, delta: "AQI" });
      if (change === "non-audio") f.socket.receive("response.output_text.delta", { ...f.partFields, delta: approved });
      if (change === "extra item") f.socket.receive("response.output_item.added", { ...f.itemFields, output_index: 1,
        item: { id: "call_extra", type: "function_call", name: "execute" } });
      if (change === "foreign metadata") f.final({ metadata: { speech_request_id: "other" } });
      if (change === "short PCM") { f.finishParts("AA=="); f.final(); }
      if (change === "partial output") f.final({ status: "incomplete" });
      if (change === "final transcript") { f.finishParts(); f.final({ output: [{ id: "item_fixture", type: "message", role: "assistant",
        status: "completed", content: [{ type: "output_audio", transcript: `${approved} More.` }] }] }); }
      if (change === "duplicate event") f.socket.raw(JSON.stringify({ type: "rate_limits.updated", event_id: "event_1" }));
      if (change === "foreign conversation") { f.finishParts(); f.final({ conversation_id: "conv_other" }); }
      expect(f.socket.closed).toEqual([1000]); f.socket.disconnected();
      expect((await f.outcome).error).toMatchObject({ code: "invalid_response" });
    }
  );

  it("bounds oversized frames and total decoded PCM", async () => {
    const first = fixture(); first.startResponse(); first.startPart();
    first.socket.raw("x".repeat(128 * 1024 + 1)); first.socket.disconnected();
    expect((await first.outcome).error).toMatchObject({ code: "invalid_response" });
    const second = fixture(); second.startResponse(); second.startPart();
    for (let i = 0; i < 13; i++) {
      second.socket.receive("response.output_audio.delta", { ...second.partFields, delta: Buffer.alloc(90_000).toString("base64") });
    }
    second.socket.disconnected();
    expect((await second.outcome).error).toMatchObject({ code: "invalid_response" });
  });

  it.each([["insufficient_quota", "quota_exhausted"], ["rate_limit_exceeded", "rate_limited"], ["invalid_api_key", "credentials_rejected"]])(
    "maps %s without forwarding provider diagnostics", async (code, expected) => {
      const f = fixture();
      f.socket.receive("error", { error: { code, message: `Vendor diagnostic ${syntheticKey}` } });
      f.socket.disconnected();
      expect((await f.outcome).error).toMatchObject({ code: expected, message: expected });
    }
  );

  it("uses the correlated terminal quota result without returning any audio", async () => {
    const f = fixture(); f.startResponse();
    f.final({ status: "failed", output: [], status_details: { error: { code: "insufficient_quota" } } });
    f.socket.disconnected();
    expect((await f.outcome).error).toMatchObject({ code: "quota_exhausted" });
    expect(f.socket.sent.map(event => event.type)).toEqual(["session.update", "response.create"]);
  });

  it("preserves a trusted scope rejection that aborts during the authority callback", async () => {
    const stale = new Error("Trusted stale scope");
    const guard = vi.fn();
    const f = fixture(guard);
    f.sessionCreated();
    guard.mockImplementation(() => { f.controller.abort(); throw stale; });
    f.sessionUpdated(); f.socket.disconnected();
    expect((await f.outcome).error).toBe(stale);
    expect(f.socket.sent.map(event => event.type)).toEqual(["session.update"]);
  });

  it("cancels the exact response and waits for confirmed close", async () => {
    const f = fixture(); f.startResponse(); f.startPart();
    f.controller.abort();
    expect(f.socket.sent.at(-1)).toEqual({ type: "response.cancel", response_id: "resp_fixture" });
    f.finishParts(); f.final();
    f.socket.disconnected();
    expect((await f.outcome).error).toMatchObject({ code: "cancelled" });
  });

  it("times out and fails closed if the socket never confirms close", async () => {
    vi.useFakeTimers();
    const f = fixture(undefined, 100, 50); f.startResponse();
    await vi.advanceTimersByTimeAsync(100);
    expect(f.socket.closed).toEqual([1000]);
    expect(f.socket.sent.at(-1)).toEqual({ type: "response.cancel", response_id: "resp_fixture" });
    await vi.advanceTimersByTimeAsync(50);
    expect((await f.outcome).error).toMatchObject({ code: "cleanup_unconfirmed" });
  });

  it("reports a deadline followed by clean close and discards completed audio after an unclean close", async () => {
    vi.useFakeTimers();
    const timedOut = fixture(undefined, 100, 50); timedOut.startResponse();
    await vi.advanceTimersByTimeAsync(100); timedOut.socket.disconnected();
    expect((await timedOut.outcome).error).toMatchObject({ code: "timeout" });
    const completed = fixture(); completed.startResponse(); completed.startPart(); completed.finishParts(); completed.final();
    completed.socket.disconnected(false);
    expect((await completed.outcome).error).toMatchObject({ code: "cleanup_unconfirmed" });
  });

  it("keeps completed audio private when the caller aborts during the closing handshake", async () => {
    const f = fixture(); f.startResponse(); f.startPart(); f.finishParts(); f.final();
    f.controller.abort(); f.socket.disconnected();
    expect((await f.outcome).error).toMatchObject({ code: "cancelled" });
  });

  it("keeps completed audio private when the server closes with an error code", async () => {
    const f = fixture(); f.startResponse(); f.startPart(); f.finishParts(); f.final();
    f.socket.disconnected(true, 4000);
    expect((await f.outcome).error).toMatchObject({ code: "provider_unavailable" });
  });

  it("uses Node 24 Authorization options and rejects HTTP redirects on a loopback socket", async () => {
    const requests: { path: string | undefined; authorized: boolean }[] = [];
    const server = createServer((request, response) => {
      requests.push({ path: request.url, authorized: request.headers.authorization === `Bearer ${syntheticKey}` });
      response.writeHead(302, { location: "/redirected", connection: "close" }); response.end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected a loopback port");
      const { port } = address;
      const Native = WebSocket as unknown as new (url: string, options: { headers: { Authorization: string } }) => WebSocket;
      vi.stubGlobal("WebSocket", class extends Native {
        constructor(url: string, init: { headers: { Authorization: string } }) {
          expect(url).toBe(endpoint);
          super(`ws://127.0.0.1:${port}/handshake`, init);
        }
      });
      const transport = new OpenAiRealtimeSpeech();
      await expect(transport.synthesize(syntheticKey, approved, new AbortController().signal)).rejects.toMatchObject({ code: "provider_unavailable" });
      expect(requests).toEqual([{ path: "/handshake", authorized: true }]);
    } finally {
      const closed = once(server, "close");
      server.close();
      await closed;
    }
  });
});
