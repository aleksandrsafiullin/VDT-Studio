import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ClaudeResumeCheckpointCanary,
  CodexResumeCheckpointCanary,
  VDT_CHECKPOINT_TURN_PROTOCOL_VERSION,
  type PersistentCliCheckpointEnvironment,
  type PersistentCliProcessRequest,
  type PersistentCliProcessResult,
  type PersistentCliProcessRunner
} from "./persistent-cli-checkpoint-canaries";

const TOOL_CATALOG_HASH = `sha256:${"a".repeat(64)}`;
const CAPABILITY = "server-owned-vdt-capability-0000000000000001";
const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

class FakeCliRunner implements PersistentCliProcessRunner {
  readonly requests: PersistentCliProcessRequest[] = [];
  readonly #respond: (
    request: PersistentCliProcessRequest,
    index: number
  ) => PersistentCliProcessResult | Promise<PersistentCliProcessResult>;

  constructor(respond: (
    request: PersistentCliProcessRequest,
    index: number
  ) => PersistentCliProcessResult | Promise<PersistentCliProcessResult>) {
    this.#respond = respond;
  }

  async run(request: PersistentCliProcessRequest): Promise<PersistentCliProcessResult> {
    const copy = Object.freeze({
      ...request,
      args: Object.freeze([...request.args]),
      environment: Object.freeze({ ...request.environment })
    });
    this.requests.push(copy);
    return this.#respond(copy, this.requests.length - 1);
  }
}

async function environment(
  overrides: Partial<PersistentCliCheckpointEnvironment> = {}
): Promise<PersistentCliCheckpointEnvironment> {
  return {
    environmentId: "private-cli-env-1",
    privateWorkspacePath: await temporaryDirectory("vdt-persistent-cli-workspace-"),
    privateStatePath: await temporaryDirectory("vdt-persistent-cli-state-"),
    forbiddenRoots: [await temporaryDirectory("vdt-persistent-cli-forbidden-")],
    processEnvironment: [{ name: "VDT_GATEWAY_CAPABILITY", value: CAPABILITY }],
    vdtMcpServer: { command: "/opt/vdt/vdt-gateway-mcp", args: ["--stdio"] },
    ...overrides
  };
}

function result(stdout: string, overrides: Partial<PersistentCliProcessResult> = {}): PersistentCliProcessResult {
  return {
    exitCode: 0,
    signal: null,
    stdout,
    stderr: "",
    ...overrides
  };
}

function checkpointTurn(): Record<string, unknown> {
  return {
    protocolVersion: VDT_CHECKPOINT_TURN_PROTOCOL_VERSION,
    assistantMessage: { messageId: "message-1", text: "I will apply the next bounded VDT batch." },
    action: {
      type: "action_batch",
      batch: {
        calls: [
          { externalCallId: "call-1", toolName: "vdt.echo", args: { value: 1 } },
          { externalCallId: "call-2", toolName: "vdt.calculate", args: {} }
        ]
      }
    }
  };
}

function codexStream(input: {
  sessionId: string;
  turn?: unknown;
  extra?: readonly unknown[];
}): string {
  return [
    { type: "thread.started", thread_id: input.sessionId },
    { type: "turn.started" },
    ...(input.extra ?? []),
    {
      type: "item.completed",
      item: { id: "item-1", type: "agent_message", text: JSON.stringify(input.turn ?? checkpointTurn()) }
    },
    { type: "turn.completed" }
  ].map((event) => JSON.stringify(event)).join("\n") + "\n";
}

function claudeStream(input: {
  cwd: string;
  sessionId: string;
  turn?: unknown;
  extra?: readonly unknown[];
}): string {
  return [
    { type: "system", subtype: "init", cwd: input.cwd, session_id: input.sessionId },
    ...(input.extra ?? []),
    {
      type: "result",
      subtype: "success",
      is_error: false,
      session_id: input.sessionId,
      structured_output: input.turn ?? checkpointTurn()
    }
  ].map((event) => JSON.stringify(event)).join("\n") + "\n";
}

function codexCanary(runner: PersistentCliProcessRunner, cliVersion = "codex-cli 0.146.0"): CodexResumeCheckpointCanary {
  return new CodexResumeCheckpointCanary({
    executable: "/opt/codex/codex",
    cliVersion,
    toolCatalogHash: TOOL_CATALOG_HASH,
    allowedToolNames: ["vdt.echo", "vdt.calculate"],
    runner
  });
}

function claudeCanary(runner: PersistentCliProcessRunner, cliVersion = "claude-code 2.1.0"): ClaudeResumeCheckpointCanary {
  return new ClaudeResumeCheckpointCanary({
    executable: "/opt/claude/claude",
    cliVersion,
    toolCatalogHash: TOOL_CATALOG_HASH,
    allowedToolNames: ["vdt.echo", "vdt.calculate"],
    runner
  });
}

function segment(
  isolated: PersistentCliCheckpointEnvironment,
  mode: "open" | "resume",
  expectedSessionId?: string
) {
  return {
    mode,
    environment: isolated,
    model: "pinned-model-1",
    prompt: `checkpoint-${mode}-with-private-delta`,
    ...(expectedSessionId === undefined ? {} : { expectedSessionId }),
    signal: new AbortController().signal
  } as const;
}

describe("persistent CLI checkpoint canaries", () => {
  it("keeps Codex and Claude unavailable by default without invoking a process or fallback", async () => {
    const runner = new FakeCliRunner(() => result(""));
    const engines = [codexCanary(runner), claudeCanary(runner)];

    for (const engine of engines) {
      expect(engine.capability).toMatchObject({
        executionProfile: "external_cli_agent",
        sessionStrategy: "checkpoint_resume",
        toolIsolation: "unverified",
        qualification: { status: "unverified", testedAt: null, evidenceHash: null }
      });
      await expect(engine.openSession({} as never, {} as never))
        .rejects.toMatchObject({ code: "EXTERNAL_ENGINE_NOT_QUALIFIED" });
      await expect(engine.resumeSession({} as never, {} as never))
        .rejects.toMatchObject({ code: "EXTERNAL_ENGINE_NOT_QUALIFIED" });
    }

    expect(runner.requests).toHaveLength(0);
  });

  it("pins one Codex thread across open/resume checkpoints and never spawns per ActionBatch call", async () => {
    const isolated = await environment();
    const runner = new FakeCliRunner(() => result(codexStream({ sessionId: "codex-session-1" })));
    const engine = codexCanary(runner);

    const opened = await engine.runProtocolDiagnostic(segment(isolated, "open"));
    const resumed = await engine.runProtocolDiagnostic(segment(isolated, "resume", opened.sessionId));

    expect(resumed.sessionId).toBe("codex-session-1");
    expect(resumed.turn.action).toMatchObject({ type: "action_batch", batch: { calls: [{}, {}] } });
    expect(runner.requests).toHaveLength(2);
    expect(runner.requests[0]?.args).toEqual(expect.arrayContaining([
      "exec", "--json", "--strict-config", "--ignore-user-config", "--ignore-rules",
      "--sandbox", "read-only", "-C", runner.requests[0]!.cwd
    ]));
    expect(runner.requests[1]?.args.slice(0, 2)).toEqual(["exec", "resume"]);
    expect(runner.requests[1]?.args).toEqual(expect.arrayContaining(["codex-session-1"]));
    expect(runner.requests[0]?.args).not.toEqual(expect.arrayContaining([
      "--ephemeral", "--yolo", "--dangerously-bypass-approvals-and-sandbox"
    ]));
    const codexConfig = runner.requests[0]!.args.filter((item) => item.startsWith("mcp_servers."));
    expect(codexConfig).toHaveLength(7);
    expect(codexConfig.every((item) => item.startsWith("mcp_servers.vdt_gateway."))).toBe(true);
    expect(runner.requests[0]?.environment).toEqual({
      HOME: runner.requests[0]!.environment.HOME,
      CODEX_HOME: runner.requests[0]!.environment.HOME,
      VDT_GATEWAY_CAPABILITY: CAPABILITY
    });
    expect(runner.requests[0]?.environment).not.toHaveProperty("PATH");
    expect(runner.requests[0]?.stdin).toContain("private-delta");
    expect(runner.requests[0]?.args.join(" ")).not.toContain("private-delta");
  });

  it("pins one Claude session with built-ins disabled and one strict VDT MCP configuration", async () => {
    const isolated = await environment();
    const runner = new FakeCliRunner((request) => result(claudeStream({
      cwd: request.cwd,
      sessionId: "claude-session-1"
    })));
    const engine = claudeCanary(runner);

    const opened = await engine.runProtocolDiagnostic(segment(isolated, "open"));
    const resumed = await engine.runProtocolDiagnostic(segment(isolated, "resume", opened.sessionId));

    expect(resumed.sessionId).toBe("claude-session-1");
    expect(runner.requests).toHaveLength(2);
    const openArgs = runner.requests[0]!.args;
    expect(openArgs).toEqual(expect.arrayContaining([
      "-p", "--output-format", "stream-json", "--bare", "--strict-mcp-config",
      "--tools", "", "--permission-mode", "dontAsk", "--no-chrome"
    ]));
    expect(openArgs).not.toEqual(expect.arrayContaining([
      "--no-session-persistence", "--fallback-model", "--disallowedTools"
    ]));
    const mcpConfig = JSON.parse(openArgs[openArgs.indexOf("--mcp-config") + 1]!) as Record<string, unknown>;
    expect(Object.keys(mcpConfig)).toEqual(["mcpServers"]);
    expect(Object.keys((mcpConfig.mcpServers as Record<string, unknown>))).toEqual(["vdt_gateway"]);
    expect(runner.requests[1]?.args).toEqual(expect.arrayContaining(["--resume", "claude-session-1"]));
    expect(runner.requests[0]?.environment).toEqual({
      HOME: runner.requests[0]!.environment.HOME,
      CLAUDE_CONFIG_DIR: runner.requests[0]!.environment.HOME,
      VDT_GATEWAY_CAPABILITY: CAPABILITY
    });
    expect(runner.requests[0]?.environment).not.toHaveProperty("PATH");
    expect(runner.requests[0]?.stdin).toContain("private-delta");
    expect(openArgs.join(" ")).not.toContain("private-delta");
  });

  it("fails closed on Codex shell, foreign MCP, protocol drift, and session drift", async () => {
    const isolated = await environment();
    const outputs = [
      codexStream({ sessionId: "codex-session-1", extra: [{
        type: "item.started",
        item: { type: "command_execution", command: "/bin/sh -c whoami" }
      }] }),
      codexStream({ sessionId: "codex-session-1", extra: [{
        type: "item.completed",
        item: { type: "mcp_tool_call", server: "global_server", tool: "vdt.echo" }
      }] }),
      [
        JSON.stringify({ type: "thread.started", thread_id: "codex-session-1" }),
        JSON.stringify({ type: "future.protocol.event" })
      ].join("\n"),
      codexStream({ sessionId: "other-session" })
    ];
    const runner = new FakeCliRunner((_request, index) => result(outputs[index]!));
    const engine = codexCanary(runner);

    await expect(engine.runProtocolDiagnostic(segment(isolated, "open")))
      .rejects.toMatchObject({ code: "SECURITY_BOUNDARY_BREACH" });
    await expect(engine.runProtocolDiagnostic(segment(isolated, "open")))
      .rejects.toMatchObject({ code: "SECURITY_BOUNDARY_BREACH" });
    await expect(engine.runProtocolDiagnostic(segment(isolated, "open")))
      .rejects.toMatchObject({ code: "CHECKPOINT_PROTOCOL_MISMATCH" });
    await expect(engine.runProtocolDiagnostic(segment(isolated, "resume", "codex-session-1")))
      .rejects.toMatchObject({ code: "CHECKPOINT_SESSION_MISMATCH" });
  });

  it("fails closed on Claude built-in tools, foreign MCP, malformed events, and session drift", async () => {
    const isolated = await environment();
    const outputs = [
      (request: PersistentCliProcessRequest) => claudeStream({
        cwd: request.cwd,
        sessionId: "claude-session-1",
        extra: [{
          type: "assistant",
          session_id: "claude-session-1",
          message: { content: [{ type: "tool_use", name: "Bash", input: { command: "whoami" } }] }
        }]
      }),
      (request: PersistentCliProcessRequest) => claudeStream({
        cwd: request.cwd,
        sessionId: "claude-session-1",
        extra: [{
          type: "assistant",
          session_id: "claude-session-1",
          message: { content: [{ type: "tool_use", name: "mcp__foreign__vdt.echo", input: {} }] }
        }]
      }),
      (request: PersistentCliProcessRequest) => [
        JSON.stringify({ type: "system", subtype: "init", cwd: request.cwd, session_id: "claude-session-1" }),
        JSON.stringify({ type: "future.protocol.event" })
      ].join("\n"),
      (request: PersistentCliProcessRequest) => claudeStream({ cwd: request.cwd, sessionId: "other-session" })
    ];
    const runner = new FakeCliRunner((request, index) => result(outputs[index]!(request)));
    const engine = claudeCanary(runner);

    await expect(engine.runProtocolDiagnostic(segment(isolated, "open")))
      .rejects.toMatchObject({ code: "SECURITY_BOUNDARY_BREACH" });
    await expect(engine.runProtocolDiagnostic(segment(isolated, "open")))
      .rejects.toMatchObject({ code: "SECURITY_BOUNDARY_BREACH" });
    await expect(engine.runProtocolDiagnostic(segment(isolated, "open")))
      .rejects.toMatchObject({ code: "CHECKPOINT_PROTOCOL_MISMATCH" });
    await expect(engine.runProtocolDiagnostic(segment(isolated, "resume", "claude-session-1")))
      .rejects.toMatchObject({ code: "CHECKPOINT_SESSION_MISMATCH" });
  });

  it("rejects unknown versions, argument-like session IDs, unsafe environment, and shell MCP launchers", async () => {
    const runner = new FakeCliRunner(() => result(""));
    expect(() => codexCanary(runner, "")).toThrow(expect.objectContaining({ code: "CHECKPOINT_VERSION_UNKNOWN" }));
    expect(() => claudeCanary(runner, "")).toThrow(expect.objectContaining({ code: "CHECKPOINT_VERSION_UNKNOWN" }));

    const unsafeEnvironment = await environment({
      processEnvironment: [
        { name: "VDT_GATEWAY_CAPABILITY", value: CAPABILITY },
        { name: "PATH", value: "/usr/local/bin" }
      ]
    });
    await expect(codexCanary(runner).runProtocolDiagnostic(segment(unsafeEnvironment, "open")))
      .rejects.toMatchObject({ code: "CHECKPOINT_UNSAFE_ENVIRONMENT" });

    const shellMcp = await environment({
      vdtMcpServer: { command: "/bin/sh", args: ["-c", "foreign-command"] }
    });
    await expect(claudeCanary(runner).runProtocolDiagnostic(segment(shellMcp, "open")))
      .rejects.toMatchObject({ code: "CHECKPOINT_UNSAFE_MCP" });

    const safe = await environment();
    await expect(codexCanary(runner).runProtocolDiagnostic(segment(safe, "resume", "--yolo")))
      .rejects.toMatchObject({ code: "CHECKPOINT_SESSION_INVALID" });
    expect(runner.requests).toHaveLength(0);
  });

  it("detects fake-CLI workspace writes and per-run capability disclosure", async () => {
    const isolated = await environment();
    const runner = new FakeCliRunner(async (request, index) => {
      if (index === 0) {
        await writeFile(path.join(request.cwd, "unexpected.txt"), "write outside Gateway");
        return result(codexStream({ sessionId: "codex-session-1" }));
      }
      return result(claudeStream({
        cwd: request.cwd,
        sessionId: "claude-session-1"
      }), { stderr: `debug ${CAPABILITY}` });
    });

    await expect(codexCanary(runner).runProtocolDiagnostic(segment(isolated, "open")))
      .rejects.toMatchObject({ code: "SECURITY_BOUNDARY_BREACH" });
    await rm(path.join(isolated.privateWorkspacePath, "unexpected.txt"));
    await expect(claudeCanary(runner).runProtocolDiagnostic(segment(isolated, "open")))
      .rejects.toMatchObject({ code: "SECURITY_BOUNDARY_BREACH" });
  });

  it("does not expose raw CLI failure output", async () => {
    const isolated = await environment();
    const runner = new FakeCliRunner(() => result("", {
      exitCode: 1,
      stderr: "provider debug included private prompt and credential material"
    }));

    const failure = await codexCanary(runner).runProtocolDiagnostic(segment(isolated, "open"))
      .then(() => undefined, (error: unknown) => error);
    expect(failure).toMatchObject({ code: "CHECKPOINT_PROCESS_FAILED", exitCode: 1 });
    expect((failure as Error).message).not.toContain("private prompt");
    expect((failure as Error).message).not.toContain("credential material");
  });
});
