import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CURSOR_CHECKPOINT_PROTOCOL_VERSION,
  CursorResumeCheckpointTransport,
  type CursorResumeCheckpointEnvironment,
  type CursorResumeProcessRequest,
  type CursorResumeProcessResult,
  type CursorResumeProcessRunner
} from "./cursor-resume-checkpoint-transport";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function actionBatchResult(sessionId: string): string {
  return JSON.stringify({
    protocolVersion: CURSOR_CHECKPOINT_PROTOCOL_VERSION,
    assistantMessage: { messageId: "message-1", text: "I will inspect the VDT graph." },
    action: {
      type: "action_batch",
      batch: {
        calls: [{ externalCallId: "call-1", toolName: "vdt.echo", args: { value: 1 } }]
      }
    }
  });
}

function stream(input: { cwd: string; sessionId: string; result?: string; extra?: readonly unknown[] }): string {
  return [
    {
      type: "system",
      subtype: "init",
      cwd: input.cwd,
      session_id: input.sessionId,
      permissionMode: "ask"
    },
    ...(input.extra ?? []),
    {
      type: "result",
      subtype: "success",
      is_error: false,
      result: input.result ?? actionBatchResult(input.sessionId),
      session_id: input.sessionId
    }
  ].map((event) => JSON.stringify(event)).join("\n") + "\n";
}

class FakeRunner implements CursorResumeProcessRunner {
  readonly requests: CursorResumeProcessRequest[] = [];
  readonly #respond: (request: CursorResumeProcessRequest, index: number) => CursorResumeProcessResult | Promise<CursorResumeProcessResult>;

  constructor(respond: (request: CursorResumeProcessRequest, index: number) => CursorResumeProcessResult | Promise<CursorResumeProcessResult>) {
    this.#respond = respond;
  }

  async run(request: CursorResumeProcessRequest): Promise<CursorResumeProcessResult> {
    const copy = { ...request, args: [...request.args], environment: { ...request.environment } };
    this.requests.push(copy);
    return this.#respond(copy, this.requests.length - 1);
  }
}

async function environment(): Promise<CursorResumeCheckpointEnvironment> {
  return {
    environmentId: "private-env-1",
    privateWorkspacePath: await temporaryDirectory("vdt-cursor-workspace-"),
    privateStatePath: await temporaryDirectory("vdt-cursor-state-"),
    forbiddenRoots: [await temporaryDirectory("vdt-cursor-forbidden-")],
    credentialEnvironment: [{ name: "CURSOR_API_KEY", value: "server-owned-api-key" }]
  };
}

function processResult(stdout: string, overrides: Partial<CursorResumeProcessResult> = {}): CursorResumeProcessResult {
  return {
    exitCode: 0,
    signal: null,
    stdout,
    stderr: "",
    ...overrides
  };
}

describe("CursorResumeCheckpointTransport", () => {
  it("opens and resumes the exact opaque session with shell-free reviewed arguments", async () => {
    const isolated = await environment();
    const runner = new FakeRunner((request) => processResult(stream({
      cwd: request.cwd,
      sessionId: "cursor-session-1"
    })));
    const transport = new CursorResumeCheckpointTransport({
      executable: "/opt/cursor/cursor-agent",
      validatedCliVersion: "2026.08.1",
      runner
    });
    const controller = new AbortController();

    const opened = await transport.executeSegment({
      mode: "open",
      environment: isolated,
      model: "gpt-5.5-high",
      prompt: "open prompt",
      signal: controller.signal
    }, ["vdt.echo"]);
    const resumed = await transport.executeSegment({
      mode: "resume",
      environment: isolated,
      model: "gpt-5.5-high",
      prompt: "resume prompt",
      expectedSessionId: opened.sessionId,
      signal: controller.signal
    }, ["vdt.echo"]);

    expect(resumed.sessionId).toBe("cursor-session-1");
    expect(runner.requests).toHaveLength(2);
    expect(runner.requests[0]?.args).toEqual([
      "--print",
      "--output-format",
      "stream-json",
      "--stream-partial-output",
      "--mode",
      "ask",
      "--workspace",
      runner.requests[0]!.cwd,
      "--model",
      "gpt-5.5-high"
    ]);
    expect(runner.requests[1]?.args).toEqual(expect.arrayContaining(["--resume", "cursor-session-1"]));
    expect(runner.requests[1]?.args).not.toEqual(expect.arrayContaining(["--trust", "--force", "--yolo"]));
    expect(runner.requests[0]?.environment).toEqual({
      HOME: runner.requests[0]!.environment.HOME,
      USERPROFILE: runner.requests[0]!.environment.HOME,
      CURSOR_CONFIG_DIR: path.join(runner.requests[0]!.environment.HOME!, "cursor-config"),
      XDG_CONFIG_HOME: path.join(runner.requests[0]!.environment.HOME!, "xdg-config"),
      CURSOR_API_KEY: "server-owned-api-key"
    });
    expect(runner.requests[0]?.environment).not.toHaveProperty("PATH");
    expect(opened.turn.action.type).toBe("action_batch");
  });

  it("fails closed on Cursor built-in tool activity", async () => {
    const isolated = await environment();
    const runner = new FakeRunner((request) => processResult(stream({
      cwd: request.cwd,
      sessionId: "cursor-session-1",
      extra: [{
        type: "tool_call",
        subtype: "started",
        call_id: "foreign-call",
        tool_call: { readToolCall: { args: { path: "/etc/passwd" } } },
        session_id: "cursor-session-1"
      }]
    })));
    const transport = new CursorResumeCheckpointTransport({
      executable: "/opt/cursor/cursor-agent",
      validatedCliVersion: "2026.08.1",
      runner
    });

    await expect(transport.executeSegment({
      mode: "open",
      environment: isolated,
      model: "auto",
      prompt: "open",
      signal: new AbortController().signal
    }, ["vdt.echo"])).rejects.toMatchObject({ code: "SECURITY_BOUNDARY_BREACH" });
  });

  it("fails closed on session drift, unknown stream events, and workspace writes", async () => {
    const isolated = await environment();
    const outputs = [
      (request: CursorResumeProcessRequest) => processResult(stream({ cwd: request.cwd, sessionId: "other-session" })),
      (request: CursorResumeProcessRequest) => processResult(stream({
        cwd: request.cwd,
        sessionId: "cursor-session-1",
        extra: [{ type: "future_event", session_id: "cursor-session-1" }]
      })),
      async (request: CursorResumeProcessRequest) => {
        await writeFile(path.join(request.cwd, "breach.txt"), "unexpected");
        return processResult(stream({ cwd: request.cwd, sessionId: "cursor-session-1" }));
      }
    ];
    const runner = new FakeRunner((request, index) => outputs[index]!(request));
    const transport = new CursorResumeCheckpointTransport({
      executable: "/opt/cursor/cursor-agent",
      validatedCliVersion: "2026.08.1",
      runner
    });
    const common = {
      mode: "resume" as const,
      environment: isolated,
      model: "auto",
      prompt: "resume",
      expectedSessionId: "cursor-session-1",
      signal: new AbortController().signal
    };

    await expect(transport.executeSegment(common, ["vdt.echo"]))
      .rejects.toMatchObject({ code: "CURSOR_CHECKPOINT_SESSION_MISMATCH" });
    await expect(transport.executeSegment(common, ["vdt.echo"]))
      .rejects.toMatchObject({ code: "CURSOR_CHECKPOINT_PROTOCOL_MISMATCH" });
    await expect(transport.executeSegment(common, ["vdt.echo"]))
      .rejects.toMatchObject({ code: "SECURITY_BOUNDARY_BREACH" });
  });

  it("rejects unknown versions and non-allowlisted process environment", async () => {
    expect(() => new CursorResumeCheckpointTransport({
      executable: "/opt/cursor/cursor-agent",
      validatedCliVersion: ""
    })).toThrow(expect.objectContaining({ code: "CURSOR_CHECKPOINT_VERSION_UNKNOWN" }));

    const isolated = await environment();
    const unsafe = {
      ...isolated,
      credentialEnvironment: [{ name: "PATH", value: "/usr/local/bin" }]
    };
    const runner = new FakeRunner(() => processResult(""));
    const transport = new CursorResumeCheckpointTransport({
      executable: "/opt/cursor/cursor-agent",
      validatedCliVersion: "2026.08.1",
      runner
    });
    await expect(transport.executeSegment({
      mode: "open",
      environment: unsafe,
      model: "auto",
      prompt: "open",
      signal: new AbortController().signal
    }, ["vdt.echo"])).rejects.toMatchObject({ code: "CURSOR_CHECKPOINT_UNSAFE_ENVIRONMENT" });
  });
});
