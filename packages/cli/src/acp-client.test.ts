import { describe, expect, it, vi } from "vitest";
import type { AgentRunEvent } from "./agent-runtime";
import { runAcpClient } from "./acp-client";

async function* chunks(values: readonly string[]): AsyncIterable<string> {
  for (const value of values) yield value;
}

function harness(output: readonly string[]) {
  const writes: string[] = [];
  const events: AgentRunEvent[] = [];
  return {
    writes,
    events,
    options: {
      stdin: { write: (data: string) => { writes.push(data); return true; }, end: vi.fn() },
      stdout: chunks(output),
      cwd: "/workspace",
      prompt: "Implement it",
      maxOutputBytes: 64 * 1024,
      maxLineBytes: 16 * 1024,
      onEvent: (event: AgentRunEvent) => events.push(event)
    }
  };
}

const messages = (writes: readonly string[]) => writes.map((line) => JSON.parse(line) as Record<string, unknown>);

describe("runAcpClient", () => {
  it("initializes, creates a session, streams updates, and prompts with text content", async () => {
    const test = harness([
      '{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1,"agentCapabilities":{}}}\n',
      '{"jsonrpc":"2.0","id":1,"result":{"sessionId":"session-1"}}\n',
      '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"session-1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Done"}}}}\n',
      '{"jsonrpc":"2.0","id":2,"result":{"stopReason":"end_turn"}}\n'
    ]);
    const result = await runAcpClient({ ...test.options, systemPrompt: "Be precise" });

    expect(result).toEqual({ sessionId: "session-1", stopReason: "end_turn" });
    expect(test.events).toEqual([{ type: "message", role: "assistant", content: "Done" }]);
    expect(messages(test.writes)).toEqual([
      expect.objectContaining({ id: 0, method: "initialize", params: expect.objectContaining({ protocolVersion: 1, clientCapabilities: {} }) }),
      { jsonrpc: "2.0", id: 1, method: "session/new", params: { cwd: "/workspace", mcpServers: [] } },
      { jsonrpc: "2.0", id: 2, method: "session/prompt", params: { sessionId: "session-1", prompt: [{ type: "text", text: "Be precise\n\nImplement it" }] } }
    ]);
  });

  it("loads only when the agent advertises loadSession", async () => {
    const supported = harness([
      '{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true}}}\n',
      '{"jsonrpc":"2.0","id":1,"result":null}\n',
      '{"jsonrpc":"2.0","id":2,"result":{"stopReason":"end_turn"}}\n'
    ]);
    await runAcpClient({ ...supported.options, sessionId: "existing" });
    expect(messages(supported.writes)[1]).toEqual({
      jsonrpc: "2.0", id: 1, method: "session/load",
      params: { sessionId: "existing", cwd: "/workspace", mcpServers: [] }
    });

    const unsupported = harness([
      '{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1,"agentCapabilities":{}}}\n'
    ]);
    await expect(runAcpClient({ ...unsupported.options, sessionId: "existing" })).rejects.toThrow("does not advertise");
  });

  it("fails permission, filesystem, terminal, and unknown client requests closed", async () => {
    const test = harness([
      '{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1,"agentCapabilities":{}}}\n',
      '{"jsonrpc":"2.0","id":1,"result":{"sessionId":"s"}}\n',
      '{"jsonrpc":"2.0","id":40,"method":"session/request_permission","params":{}}\n',
      '{"jsonrpc":"2.0","id":41,"method":"fs/read_text_file","params":{}}\n',
      '{"jsonrpc":"2.0","id":42,"method":"terminal/create","params":{}}\n',
      '{"jsonrpc":"2.0","id":2,"result":{"stopReason":"end_turn"}}\n'
    ]);
    await runAcpClient(test.options);
    expect(messages(test.writes)).toEqual(expect.arrayContaining([
      { jsonrpc: "2.0", id: 40, result: { outcome: { outcome: "cancelled" } } },
      { jsonrpc: "2.0", id: 41, error: { code: -32601, message: "Client method is not supported: fs/read_text_file" } },
      { jsonrpc: "2.0", id: 42, error: { code: -32601, message: "Client method is not supported: terminal/create" } }
    ]));
  });

  it("maps tool updates and enforces protocol, line, and output bounds", async () => {
    const test = harness([
      '{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1,"agentCapabilities":{}}}\n',
      '{"jsonrpc":"2.0","id":1,"result":{"sessionId":"s"}}\n',
      '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"tool_call","toolCallId":"c1","title":"Run tests","status":"pending"}}}\n',
      '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"tool_call_update","toolCallId":"c1","title":"Run tests","status":"completed"}}}\n',
      '{"jsonrpc":"2.0","id":2,"result":{"stopReason":"end_turn"}}\n'
    ]);
    await runAcpClient(test.options);
    expect(test.events).toEqual([
      expect.objectContaining({ type: "tool-call", name: "Run tests", callId: "c1" }),
      expect.objectContaining({ type: "tool-result", name: "Run tests", callId: "c1" })
    ]);

    const malformed = harness(['not-json\n']);
    await expect(runAcpClient(malformed.options)).rejects.toThrow("Invalid ACP JSONL");
    const oversized = harness(['{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1}}\n']);
    await expect(runAcpClient({ ...oversized.options, maxLineBytes: 8 })).rejects.toThrow("line exceeds 8 bytes");
    const excessiveOutput = harness(['{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1}}\n']);
    await expect(runAcpClient({ ...excessiveOutput.options, maxOutputBytes: 8 })).rejects.toThrow("output exceeds 8 bytes");
  });

  it("requires an official stopReason in session/prompt responses", async () => {
    const missing = harness([
      '{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1,"agentCapabilities":{}}}\n',
      '{"jsonrpc":"2.0","id":1,"result":{"sessionId":"s"}}\n',
      '{"jsonrpc":"2.0","id":2,"result":{}}\n'
    ]);
    await expect(runAcpClient(missing.options)).rejects.toThrow("invalid stopReason");

    const unknown = harness([
      '{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1,"agentCapabilities":{}}}\n',
      '{"jsonrpc":"2.0","id":1,"result":{"sessionId":"s"}}\n',
      '{"jsonrpc":"2.0","id":2,"result":{"stopReason":"done"}}\n'
    ]);
    await expect(runAcpClient(unknown.options)).rejects.toThrow("invalid stopReason: done");
  });

  it("sends session/cancel when the AbortSignal fires", async () => {
    const controller = new AbortController();
    const writes: string[] = [];
    async function* output(): AsyncIterable<string> {
      yield '{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1,"agentCapabilities":{}}}\n';
      yield '{"jsonrpc":"2.0","id":1,"result":{"sessionId":"s"}}\n';
      controller.abort();
      yield '{"jsonrpc":"2.0","id":2,"result":{"stopReason":"cancelled"}}\n';
    }
    await runAcpClient({
      stdin: { write: (data) => { writes.push(data); return true; }, end: vi.fn() },
      stdout: output(), cwd: "/workspace", prompt: "p", signal: controller.signal,
      maxOutputBytes: 4096, maxLineBytes: 4096, onEvent: vi.fn()
    });
    expect(messages(writes)).toContainEqual({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: "s" } });
  });
});
