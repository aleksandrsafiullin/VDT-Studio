import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CODING_AGENT_IDS, type AgentRunEvent, type AgentRunParams } from "./agent-runtime";
import {
  AGENT_COMMAND_ADAPTERS,
  runAgent,
  type ChildProcessLike,
  type ChildStdinLike,
  type SpawnAgentProcess
} from "./agent-runner";

async function* chunks(values: readonly (string | Uint8Array)[]): AsyncIterable<string | Uint8Array> {
  for (const value of values) yield value;
}

class FakeChild extends EventEmitter implements ChildProcessLike {
  readonly kills: NodeJS.Signals[] = [];
  readonly stdinWrites: Array<string | undefined> = [];
  readonly stdin: ChildStdinLike = {
    write: (data) => { this.stdinWrites.push(data); return true; },
    end: (data) => { this.stdinWrites.push(data); }
  };

  constructor(
    readonly stdout: AsyncIterable<string | Uint8Array> | null = chunks([]),
    readonly stderr: AsyncIterable<string | Uint8Array> | null = chunks([])
  ) {
    super();
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.kills.push(signal);
    return true;
  }

  close(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
    queueMicrotask(() => this.emit("close", code, signal));
  }
}

const params = (overrides: Partial<AgentRunParams> = {}): AgentRunParams => ({
  agentId: "codex",
  prompt: "Fix the tests",
  cwd: process.cwd(),
  ...overrides
});

const collect = async (events: AsyncIterable<AgentRunEvent>): Promise<AgentRunEvent[]> => {
  const result: AgentRunEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
};

const tempDirs: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("agent command adapters", () => {
  it("defines a distinct explicit adapter for all 21 runtime ids", () => {
    expect(Object.keys(AGENT_COMMAND_ADAPTERS)).toEqual(CODING_AGENT_IDS);
    expect(new Set(Object.values(AGENT_COMMAND_ADAPTERS).map((item) => item.buildArgv)).size).toBe(21);
    for (const id of CODING_AGENT_IDS) expect(AGENT_COMMAND_ADAPTERS[id].id).toBe(id);
  });

  it("has an asserted command shape for every catalog id", () => {
    const actual = Object.fromEntries(CODING_AGENT_IDS.map((id) => [
      id,
      AGENT_COMMAND_ADAPTERS[id].buildArgv(id === "aider" ? { prompt: "p", promptFile: "/tmp/prompt" } : { prompt: "p" })
    ]));
    expect(actual).toEqual({
      claude: ["-p", "--output-format", "stream-json", "--verbose"],
      codex: ["exec", "--json", "--color", "never"],
      opencode: ["run", "--format", "json"],
      hermes: ["acp", "--accept-hooks"],
      antigravity: ["run", "--non-interactive", "p"],
      gemini: ["--output-format", "stream-json", "--yolo"],
      "grok-build": ["run", "--no-interactive", "p"],
      kimi: ["acp"],
      "cursor-agent": ["--print", "--output-format", "stream-json", "--stream-partial-output", "--force", "--trust"],
      qwen: ["--yolo", "-"],
      qoder: ["-p", "--output-format", "stream-json", "--permission-mode", "bypass_permissions"],
      copilot: ["-p", "p", "--allow-all-tools", "--output-format", "json"],
      pi: ["--mode", "rpc"],
      kiro: ["acp"],
      kilo: ["acp"],
      vibe: [],
      deepseek: ["chat", "--no-interactive", "p"],
      reasonix: ["run", "--no-interactive", "p"],
      aider: ["--yes", "--no-stream", "--message-file", "/tmp/prompt"],
      devin: ["--permission-mode", "dangerous", "--respect-workspace-trust", "false", "acp"],
      trae: ["run", "--no-interactive", "p"]
    });
    expect(() => AGENT_COMMAND_ADAPTERS.aider.buildArgv({ prompt: "p" })).toThrow("prompt file");
    expect(AGENT_COMMAND_ADAPTERS.aider.buildArgv({ prompt: "p", promptFile: "/tmp/prompt" }))
      .toEqual(["--yes", "--no-stream", "--message-file", "/tmp/prompt"]);
  });

  it("builds the documented Claude, Codex, OpenCode, Gemini, Cursor, Pi, and Hermes forms", () => {
    expect(AGENT_COMMAND_ADAPTERS.claude.buildArgv({ prompt: "p", model: "m", sessionId: "s", systemPrompt: "sys" }))
      .toEqual(["-p", "--output-format", "stream-json", "--verbose", "--model", "m", "--resume", "s", "--system-prompt", "sys"]);
    expect(AGENT_COMMAND_ADAPTERS.codex.buildArgv({ prompt: "p", model: "m", sessionId: "s" }))
      .toEqual(["exec", "resume", "s", "--json", "--color", "never", "--model", "m"]);
    expect(AGENT_COMMAND_ADAPTERS.opencode.buildArgv({ prompt: "p", model: "m", sessionId: "s" }))
      .toEqual(["run", "--format", "json", "--model", "m", "--session", "s"]);
    expect(AGENT_COMMAND_ADAPTERS.gemini.buildArgv({ prompt: "p" }))
      .toEqual(["--output-format", "stream-json", "--yolo"]);
    expect(AGENT_COMMAND_ADAPTERS["cursor-agent"].buildArgv({ prompt: "p" }))
      .toEqual(["--print", "--output-format", "stream-json", "--stream-partial-output", "--force", "--trust"]);
    expect(AGENT_COMMAND_ADAPTERS.pi.buildArgv({ prompt: "p" })).toEqual(["--mode", "rpc"]);
    expect(AGENT_COMMAND_ADAPTERS.hermes.buildArgv({ prompt: "p" })).toEqual(["acp", "--accept-hooks"]);
  });
});

describe("runAgent", () => {
  it("spawns without a shell, writes stdin prompts, filters env, and emits normalized JSONL events", async () => {
    const child = new FakeChild(chunks([
      '{"type":"thread.started","thread_id":"thread-1"}\n{"type":"item.completed","item":{"type":"agent_',
      'message","text":"done"}}\n'
    ]), chunks(["warning\n"]));
    const spawn = vi.fn<SpawnAgentProcess>((_command, _argv, _options) => {
      child.close();
      return child;
    });
    const events = await collect(runAgent(params({ env: { OPENAI_API_KEY: "secret" } }), {
      executable: "/tools/codex",
      spawn,
      baseEnv: { PATH: "/bin", NODE_OPTIONS: "--inspect", ANTHROPIC_API_KEY: "must-not-leak" }
    }));

    expect(spawn).toHaveBeenCalledWith("/tools/codex", ["exec", "--json", "--color", "never"], expect.objectContaining({
      shell: false,
      cwd: process.cwd(),
      env: expect.objectContaining({ PATH: "/bin", OPENAI_API_KEY: "secret" })
    }));
    expect(spawn.mock.calls[0]?.[2].env).not.toHaveProperty("NODE_OPTIONS");
    expect(spawn.mock.calls[0]?.[2].env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(child.stdinWrites).toEqual(["Fix the tests"]);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "start", agentId: "codex" }),
      { type: "message", role: "assistant", content: "done" },
      { type: "stderr", data: "warning\n" },
      { type: "complete", exitCode: 0, sessionId: "thread-1" }
    ]));
  });

  it("buffers JSON and text records split across arbitrary chunks", async () => {
    const jsonChild = new FakeChild(chunks(['{"type":"result",', '"result":"ok"}']));
    const jsonSpawn: SpawnAgentProcess = () => { jsonChild.close(); return jsonChild; };
    const jsonEvents = await collect(runAgent(params({ agentId: "qoder" }), { executable: "/tools/qoder", spawn: jsonSpawn, allowDangerousPermissions: true }));
    expect(jsonEvents).toContainEqual({ type: "message", role: "assistant", content: "ok" });

    const textChild = new FakeChild(chunks(["first par", "t\nsecond"]));
    const textSpawn: SpawnAgentProcess = () => { textChild.close(); return textChild; };
    const textEvents = await collect(runAgent(params({ agentId: "deepseek" }), { executable: "/tools/deepseek", spawn: textSpawn }));
    expect(textEvents).toEqual(expect.arrayContaining([
      { type: "message", role: "assistant", content: "first part" },
      { type: "message", role: "assistant", content: "second" }
    ]));
  });

  it("normalizes tool call and tool result records", async () => {
    const child = new FakeChild(chunks([
      '{"type":"tool_call","name":"read","call_id":"c1","input":{"path":"a"}}\n',
      '{"type":"tool_result","name":"read","call_id":"c1","output":"contents"}\n'
    ]));
    const spawn: SpawnAgentProcess = () => { child.close(); return child; };
    const events = await collect(runAgent(params({ agentId: "qoder" }), { executable: "/tools/qoder", spawn, allowDangerousPermissions: true }));
    expect(events).toContainEqual({ type: "tool-call", name: "read", callId: "c1", input: { path: "a" } });
    expect(events).toContainEqual({ type: "tool-result", name: "read", callId: "c1", output: "contents" });
  });

  it("normalizes block tool events and Codex command executions", async () => {
    const child = new FakeChild(chunks([
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"c2","name":"edit","input":{"file":"a"}}]}}\n',
      '{"type":"item.completed","item":{"type":"command_execution","id":"c3","command":"pnpm test","aggregated_output":"passed"}}\n'
    ]));
    const events = await collect(runAgent(params(), { executable: "/tools/codex", spawn: () => { child.close(); return child; } }));
    expect(events).toContainEqual({ type: "tool-call", name: "edit", callId: "c2", input: { file: "a" } });
    expect(events).toContainEqual({ type: "tool-result", name: "command", callId: "c3", output: "passed" });
  });

  it("uses a private temporary prompt file and removes it after Aider exits", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agent-runner-test-"));
    tempDirs.push(tempRoot);
    let promptFile = "";
    let fileContents = "";
    const child = new FakeChild(chunks(["done\n"]));
    const spawn: SpawnAgentProcess = (_command, argv) => {
      promptFile = argv[argv.indexOf("--message-file") + 1] ?? "";
      child.close();
      return child;
    };
    const iterator = runAgent(params({ agentId: "aider", prompt: "from file" }), {
      executable: "/tools/aider", spawn, tempRoot, allowDangerousPermissions: true
    });
    const events: AgentRunEvent[] = [];
    for await (const event of iterator) {
      events.push(event);
      if (event.type === "start") fileContents = await readFile(promptFile, "utf8");
    }
    expect(fileContents).toBe("from file");
    await expect(readFile(promptFile, "utf8")).rejects.toThrow();
    expect(events).toContainEqual({ type: "complete", exitCode: 0 });
  });

  it("rejects cwd escapes, non-allowlisted env, extra args, unsupported resume, and oversized prompts", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "agent-outside-"));
    tempDirs.push(outside);
    const neverSpawn = vi.fn<SpawnAgentProcess>();
    await expect(collect(runAgent(params({ cwd: outside }), { executable: "/tools/codex", allowedCwdRoots: [process.cwd()], spawn: neverSpawn }))).rejects.toThrow("outside the allowed roots");
    await expect(collect(runAgent(params({ env: { NODE_OPTIONS: "--inspect" } }), { executable: "/tools/codex", spawn: neverSpawn }))).rejects.toThrow("not allowed");
    await expect(collect(runAgent(params({ extraArgs: ["--yolo"] }), { executable: "/tools/codex", spawn: neverSpawn }))).rejects.toThrow("extra argument is not allowed");
    await expect(collect(runAgent(params({ agentId: "aider", sessionId: "s" }), { executable: "/tools/aider", spawn: neverSpawn }))).rejects.toThrow("does not support session resume");
    await expect(collect(runAgent(params({ agentId: "qwen" }), { executable: "/tools/qwen", spawn: neverSpawn }))).rejects.toThrow("allowDangerousPermissions");
    await expect(collect(runAgent(params({ agentId: "aider" }), { executable: "/tools/aider", spawn: neverSpawn }))).rejects.toThrow("allowDangerousPermissions");
    await expect(collect(runAgent(params({ prompt: "large" }), { executable: "/tools/codex", maxPromptBytes: 4, spawn: neverSpawn }))).rejects.toThrow("exceeds 4 bytes");
    expect(neverSpawn).not.toHaveBeenCalled();
  });

  it("runs Pi through its correlated RPC protocol client", async () => {
    let child!: FakeChild;
    async function* piOutput(): AsyncIterable<string> {
      const prompt = JSON.parse(child.stdinWrites[0] ?? "{}") as { id?: string };
      yield `${JSON.stringify({ id: prompt.id, type: "response", command: "prompt", success: true })}\n`;
      yield '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"done"}}\n';
      yield '{"type":"agent_end","messages":[]}\n';
    }
    child = new FakeChild(piOutput());
    const events = await collect(runAgent(params({ agentId: "pi" }), {
      executable: "/tools/pi",
      spawn: () => { setTimeout(() => child.close(), 0); return child; }
    }));
    expect(events).toContainEqual({ type: "message", role: "assistant", content: "done" });
    expect(child.stdinWrites[0]).toContain('"type":"prompt"');
  });

  it("runs ACP adapters through initialize, session/new, and session/prompt", async () => {
    const child = new FakeChild(chunks([
      '{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1,"agentCapabilities":{}}}\n',
      '{"jsonrpc":"2.0","id":1,"result":{"sessionId":"acp-session"}}\n',
      '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"implemented"}}}}\n',
      '{"jsonrpc":"2.0","id":2,"result":{"stopReason":"end_turn"}}\n'
    ]));
    const spawn: SpawnAgentProcess = () => {
      setTimeout(() => child.close(), 0);
      return child;
    };
    const events = await collect(runAgent(params({ agentId: "hermes" }), { executable: "/tools/hermes", spawn }));
    const protocol = child.stdinWrites.filter((value): value is string => value !== undefined).map((line) => JSON.parse(line));

    expect(protocol.map((message) => message.method)).toEqual(["initialize", "session/new", "session/prompt"]);
    expect(events).toContainEqual({ type: "message", role: "assistant", content: "implemented" });
    expect(events).toContainEqual({ type: "complete", exitCode: 0, sessionId: "acp-session" });
  });

  it("cancels with SIGTERM and escalates to SIGKILL after a bounded grace period", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const child = new FakeChild();
    const spawn: SpawnAgentProcess = () => child;
    const iterator = runAgent(params(), { executable: "/tools/codex", spawn, signal: controller.signal, killGraceMs: 20, timeoutMs: 1_000 })[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({ type: "start" });
    const pending = collect({ [Symbol.asyncIterator]: () => iterator });
    controller.abort();
    await vi.advanceTimersByTimeAsync(20);
    expect(child.kills).toEqual(["SIGTERM", "SIGKILL"]);
    child.close(null, "SIGKILL");
    const events = await pending;
    expect(events.some((event) => event.type === "error" && event.error.name === "AbortError")).toBe(true);
  });

  it("terminates on timeout and output bounds", async () => {
    vi.useFakeTimers();
    const timeoutChild = new FakeChild();
    const iterator = runAgent(params(), { executable: "/tools/codex", spawn: () => timeoutChild, timeoutMs: 10, killGraceMs: 5 })[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({ type: "start" });
    const timeoutPending = collect({ [Symbol.asyncIterator]: () => iterator });
    await vi.advanceTimersByTimeAsync(10);
    timeoutChild.close(null, "SIGTERM");
    const timeoutEvents = await timeoutPending;
    expect(timeoutChild.kills).toContain("SIGTERM");
    expect(timeoutEvents.some((event) => event.type === "error" && event.error.message.includes("timed out"))).toBe(true);

    vi.useRealTimers();
    const outputChild = new FakeChild(chunks(["12345"]));
    const outputPending = collect(runAgent(params({ agentId: "deepseek" }), { executable: "/tools/deepseek", spawn: () => { queueMicrotask(() => outputChild.close(null, "SIGTERM")); return outputChild; }, maxOutputBytes: 4 }));
    const outputEvents = await outputPending;
    expect(outputChild.kills).toContain("SIGTERM");
    expect(outputEvents.some((event) => event.type === "error" && event.error.message.includes("exceeds 4 bytes"))).toBe(true);
  });

  it("reports malformed strict JSONL and nonzero exits", async () => {
    const malformed = new FakeChild(chunks(["not-json\n"]));
    const malformedEvents = await collect(runAgent(params(), { executable: "/tools/codex", spawn: () => { setTimeout(() => malformed.close(null, "SIGTERM"), 0); return malformed; } }));
    expect(malformedEvents.some((event) => event.type === "error" && event.error.message.includes("Invalid JSONL"))).toBe(true);

    const failed = new FakeChild();
    const failedEvents = await collect(runAgent(params(), { executable: "/tools/codex", spawn: () => { failed.close(7); return failed; } }));
    expect(failedEvents).toContainEqual({ type: "complete", exitCode: 7 });
    expect(failedEvents.some((event) => event.type === "error" && event.error.message.includes("code 7"))).toBe(true);
  });

  it("resolves the first installed alias instead of blindly spawning the first catalog alias", async () => {
    const child = new FakeChild();
    const spawn = vi.fn<SpawnAgentProcess>(() => { child.close(); return child; });
    await collect(runAgent(params({ agentId: "opencode" }), {
      baseEnv: { PATH: "/first:/second" },
      executableCheck: async (candidate) => candidate === "/second/opencode",
      spawn
    }));
    expect(spawn.mock.calls[0]?.[0]).toBe("/second/opencode");
  });

  it("closes an abandoned iterator with bounded SIGTERM and SIGKILL escalation", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const iterator = runAgent(params(), {
      executable: "/tools/codex", spawn: () => child, killGraceMs: 20
    })[Symbol.asyncIterator]();
    await iterator.next();
    const closing = iterator.return?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(child.kills).toEqual(["SIGTERM"]);
    await vi.advanceTimersByTimeAsync(20);
    expect(child.kills).toEqual(["SIGTERM", "SIGKILL"]);
    child.close(null, "SIGKILL");
    await closing;
  });
});
