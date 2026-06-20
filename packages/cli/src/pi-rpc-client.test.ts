import { describe, expect, it } from "vitest";
import type { AgentRunEvent } from "./agent-runtime";
import {
  PiRpcJsonlDecoder,
  createPiRpcAbortCommand,
  createPiRpcPromptCommand,
  drivePiRpc
} from "./pi-rpc-client";

async function* chunks(values: readonly (string | Uint8Array)[]): AsyncIterable<string | Uint8Array> {
  for (const value of values) yield value;
}

async function collect(iterable: AsyncIterable<AgentRunEvent>): Promise<AgentRunEvent[]> {
  const events: AgentRunEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

describe("Pi RPC commands", () => {
  it("encodes prompt and abort commands as LF-delimited JSON", () => {
    expect(createPiRpcPromptCommand("hello", "p1")).toBe('{"id":"p1","type":"prompt","message":"hello"}\n');
    expect(createPiRpcAbortCommand()).toBe('{"type":"abort"}\n');
  });
});

describe("PiRpcJsonlDecoder", () => {
  it("uses LF framing, preserves Unicode separators, and decodes split UTF-8", () => {
    const decoder = new PiRpcJsonlDecoder();
    const bytes = Buffer.from('{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"A €"}}\r\n');
    const first = decoder.feed(bytes.subarray(0, bytes.length - 3));
    const second = decoder.feed(bytes.subarray(bytes.length - 3));
    expect(first.events).toEqual([]);
    expect(second.events).toEqual([{ type: "message", role: "assistant", content: "A €" }]);
  });

  it("maps fallback messages and tool lifecycle events", () => {
    const decoder = new PiRpcJsonlDecoder();
    const result = decoder.feed([
      '{"type":"message_start","message":{"role":"assistant"}}',
      '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}]}}',
      '{"type":"tool_execution_start","toolCallId":"c1","toolName":"read","args":{"path":"a"}}',
      '{"type":"tool_execution_end","toolCallId":"c1","toolName":"read","result":{"content":[{"type":"text","text":"ok"}]}}'
    ].join("\n") + "\n");
    expect(result.events).toEqual([
      { type: "message", role: "assistant", content: "done" },
      { type: "tool-call", name: "read", callId: "c1", input: { path: "a" } },
      { type: "tool-result", name: "read", callId: "c1", output: { content: [{ type: "text", text: "ok" }] } }
    ]);
  });

  it("does not duplicate a streamed assistant message at message_end", () => {
    const decoder = new PiRpcJsonlDecoder();
    const result = decoder.feed([
      '{"type":"message_start","message":{"role":"assistant"}}',
      '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"hel"}}',
      '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"lo"}}',
      '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"hello"}]}}'
    ].join("\n") + "\n");
    expect(result.events).toEqual([
      { type: "message", role: "assistant", content: "hel" },
      { type: "message", role: "assistant", content: "lo" }
    ]);
  });

  it("fails closed by cancelling dialog and unknown extension UI requests", () => {
    const decoder = new PiRpcJsonlDecoder();
    const result = decoder.feed([
      '{"type":"extension_ui_request","id":"u1","method":"confirm","title":"Allow?"}',
      '{"type":"extension_ui_request","id":"u2","method":"futureDialog"}',
      '{"type":"extension_ui_request","id":"u3","method":"notify","message":"info"}'
    ].join("\n") + "\n");
    expect(result.commands).toEqual([
      '{"type":"extension_ui_response","id":"u1","cancelled":true}\n',
      '{"type":"extension_ui_response","id":"u2","cancelled":true}\n'
    ]);
  });

  it("rejects malformed JSON, oversized lines, and oversized aggregate output", () => {
    expect(() => new PiRpcJsonlDecoder().feed("not-json\n")).toThrow("Invalid Pi RPC JSONL");
    expect(() => new PiRpcJsonlDecoder({ maxLineBytes: 4 }).feed("12345")).toThrow("line exceeds 4 bytes");
    const decoder = new PiRpcJsonlDecoder({ maxOutputBytes: 20 });
    decoder.feed('{"type":"x"}\n');
    expect(() => decoder.feed('{"type":"y"}\n')).toThrow("output exceeds 20 bytes");
  });

  it("requires a successful correlated prompt response before agent_end", () => {
    const rejected = new PiRpcJsonlDecoder({ promptId: "p1" });
    expect(() => rejected.feed('{"id":"p1","type":"response","command":"prompt","success":false,"error":"busy"}\n'))
      .toThrow("Pi RPC prompt failed: busy");
    const mismatched = new PiRpcJsonlDecoder({ promptId: "p1" });
    expect(() => mismatched.feed('{"id":"other","type":"response","command":"prompt","success":true}\n'))
      .toThrow("does not match");
    const unacknowledged = new PiRpcJsonlDecoder({ promptId: "p1" });
    expect(() => unacknowledged.feed('{"type":"agent_end","messages":[]}\n'))
      .toThrow("before acknowledging");
  });
});

describe("drivePiRpc", () => {
  it("sends the prompt, writes UI cancellation, streams events, and stops at agent_end", async () => {
    const writes: string[] = [];
    const stdout = chunks([
      '{"id":"p1","type":"response","command":"prompt","success":true}\n',
      '{"type":"extension_ui_request","id":"u1","method":"input"}\n',
      '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"ok"}}\n',
      '{"type":"agent_end","messages":[]}\n',
      "not consumed\n"
    ]);
    await expect(collect(drivePiRpc({ stdout, prompt: "go", promptId: "p1", write: (line) => writes.push(line) })))
      .resolves.toEqual([{ type: "message", role: "assistant", content: "ok" }]);
    expect(writes).toEqual([
      '{"id":"p1","type":"prompt","message":"go"}\n',
      '{"type":"extension_ui_response","id":"u1","cancelled":true}\n'
    ]);
  });

  it("sends one abort command when its signal is aborted", async () => {
    const controller = new AbortController();
    const writes: string[] = [];
    async function* stdout(): AsyncIterable<string> {
      yield '{"id":"p1","type":"response","command":"prompt","success":true}\n';
      controller.abort();
      yield '{"type":"agent_end","messages":[]}\n';
    }
    await collect(drivePiRpc({ stdout: stdout(), prompt: "go", promptId: "p1", signal: controller.signal, write: (line) => writes.push(line) }));
    expect(writes).toEqual([
      '{"id":"p1","type":"prompt","message":"go"}\n',
      '{"type":"abort"}\n'
    ]);
  });

  it("rejects a pre-aborted run without writing a prompt", async () => {
    const controller = new AbortController();
    const writes: string[] = [];
    controller.abort();
    const promise = collect(drivePiRpc({ stdout: chunks([]), prompt: "go", signal: controller.signal, write: (line) => writes.push(line) }));
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(writes).toEqual([]);
  });

  it("rejects EOF before agent_end", async () => {
    const stdout = chunks(['{"id":"p1","type":"response","command":"prompt","success":true}\n']);
    await expect(collect(drivePiRpc({ stdout, prompt: "go", promptId: "p1", write: () => undefined })))
      .rejects.toThrow("before agent_end");
  });
});
