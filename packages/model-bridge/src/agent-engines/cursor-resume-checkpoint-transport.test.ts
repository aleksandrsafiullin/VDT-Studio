import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
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

function directCallsResult(): string {
  return JSON.stringify({
    protocolVersion: CURSOR_CHECKPOINT_PROTOCOL_VERSION,
    assistantMessage: null,
    action: {
      type: "action_batch",
      calls: [{ externalCallId: "call-direct-1", toolName: "vdt.echo", args: { value: 2 } }]
    }
  });
}

function directCallsWithStringMessageResult(): string {
  return JSON.stringify({
    protocolVersion: CURSOR_CHECKPOINT_PROTOCOL_VERSION,
    assistantMessage: "I will build the two fleet branches.",
    action: {
      type: "action_batch",
      calls: [{ externalCallId: "call-string-1", toolName: "vdt.echo", args: { value: 3 } }]
    }
  });
}

function userAskResult(): string {
  return JSON.stringify({
    protocolVersion: CURSOR_CHECKPOINT_PROTOCOL_VERSION,
    assistantMessage: "I need one topology choice.",
    action: {
      type: "user.ask",
      questions: [{
        id: "fleet_split",
        question: "Use two fleet branches?",
        reason: "Prevents averaging unlike fleets.",
        required: true,
        expectedAnswerType: "choice",
        options: [
          { id: "two_branches", label: "Two fleet branches" },
          { id: "weighted_average", label: "Weighted average" }
        ]
      }]
    }
  });
}

function compactFinalResult(): string {
  return JSON.stringify({
    protocolVersion: CURSOR_CHECKPOINT_PROTOCOL_VERSION,
    assistantMessage: "Ore hauled is complete and validated.",
    action: {
      type: "final",
      finishReceiptId: "finish-receipt-1"
    }
  });
}

function nestedUserAskBatchResult(): string {
  return JSON.stringify({
    protocolVersion: CURSOR_CHECKPOINT_PROTOCOL_VERSION,
    assistantMessage: "Confirm the fleet topology.",
    action: {
      type: "action_batch",
      calls: [{
        externalCallId: "call-nested-ask",
        toolName: "user.ask",
        args: {
          questions: [{
            id: "fleet_split",
            question: "Use two branches?",
            reason: "The truck classes differ.",
            required: true,
            expectedAnswerType: "choice",
            options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }]
          }]
        }
      }]
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

  it("uses an explicit trusted subscription auth home without exposing the private state as config", async () => {
    const isolated = await environment();
    const authHome = await temporaryDirectory("vdt-cursor-auth-home-");
    const runner = new FakeRunner((request) => processResult(stream({
      cwd: request.cwd,
      sessionId: "cursor-session-auth"
    })));
    const transport = new CursorResumeCheckpointTransport({
      executable: "/opt/cursor/cursor-agent",
      validatedCliVersion: "2026.08.1",
      runner
    });

    await transport.executeSegment({
      mode: "open",
      environment: {
        ...isolated,
        trustedSubscriptionAuthHomePath: authHome,
        preauthorizeEmptyWorkspace: true,
        credentialEnvironment: [
          { name: "PATH", value: "/usr/bin:/bin" },
          { name: "USER", value: "trusted-user" },
          { name: "LOGNAME", value: "trusted-user" }
        ]
      },
      model: "auto",
      prompt: "open",
      signal: new AbortController().signal
    }, ["vdt.echo"]);

    const canonicalAuthHome = await realpath(authHome);
    expect(runner.requests[0]?.environment).toEqual({
      HOME: canonicalAuthHome,
      USERPROFILE: canonicalAuthHome,
      PATH: "/usr/bin:/bin",
      USER: "trusted-user",
      LOGNAME: "trusted-user"
    });
    expect(runner.requests[0]?.environment).not.toHaveProperty("CURSOR_CONFIG_DIR");
    expect(runner.requests[0]?.environment).not.toHaveProperty("XDG_CONFIG_HOME");
    expect(runner.requests[0]?.args).toContain("--trust");
  });

  it("accepts the current Cursor thinking delta envelope but rejects unknown thinking subtypes", async () => {
    const isolated = await environment();
    const runner = new FakeRunner((request, index) => processResult(stream({
      cwd: request.cwd,
      sessionId: "cursor-session-thinking",
      extra: [{
        type: "thinking",
        subtype: index === 0 ? "delta" : "future-thinking-kind",
        text: "bounded reasoning delta",
        session_id: "cursor-session-thinking"
      }]
    })));
    const transport = new CursorResumeCheckpointTransport({
      executable: "/opt/cursor/cursor-agent",
      validatedCliVersion: "2026.08.1",
      runner
    });
    const common = {
      mode: "open" as const,
      environment: isolated,
      model: "auto",
      prompt: "open",
      signal: new AbortController().signal
    };

    await expect(transport.executeSegment(common, ["vdt.echo"])).resolves.toMatchObject({
      sessionId: "cursor-session-thinking"
    });
    await expect(transport.executeSegment(common, ["vdt.echo"]))
      .rejects.toMatchObject({ code: "CURSOR_CHECKPOINT_PROTOCOL_MISMATCH" });
  });

  it("normalizes Cursor's unambiguous direct calls action into an ActionBatch", async () => {
    const isolated = await environment();
    const runner = new FakeRunner((request) => processResult(stream({
      cwd: request.cwd,
      sessionId: "cursor-session-direct-calls",
      result: directCallsResult()
    })));
    const transport = new CursorResumeCheckpointTransport({
      executable: "/opt/cursor/cursor-agent",
      validatedCliVersion: "2026.08.1",
      runner
    });

    const result = await transport.executeSegment({
      mode: "open",
      environment: isolated,
      model: "auto",
      prompt: "open",
      signal: new AbortController().signal
    }, ["vdt.echo"]);

    expect(result.turn.action).toMatchObject({
      type: "action_batch",
      batch: { calls: [{ externalCallId: "call-direct-1", toolName: "vdt.echo" }] }
    });
  });

  it("normalizes Cursor's string assistant message with a stable transport ID", async () => {
    const isolated = await environment();
    const runner = new FakeRunner((request) => processResult(stream({
      cwd: request.cwd,
      sessionId: "cursor-session-string-message",
      result: directCallsWithStringMessageResult()
    })));
    const transport = new CursorResumeCheckpointTransport({
      executable: "/opt/cursor/cursor-agent",
      validatedCliVersion: "2026.08.1",
      runner
    });

    const result = await transport.executeSegment({
      mode: "open",
      environment: isolated,
      model: "auto",
      prompt: "open",
      signal: new AbortController().signal
    }, ["vdt.echo"]);

    expect(result.turn).toMatchObject({
      assistantMessage: {
        messageId: expect.stringMatching(/^message-[a-f0-9]{24}$/),
        text: "I will build the two fleet branches."
      }
    });
  });

  it("normalizes Cursor's dedicated user.ask control action into a one-call batch", async () => {
    const isolated = await environment();
    const runner = new FakeRunner((request) => processResult(stream({
      cwd: request.cwd,
      sessionId: "cursor-session-user-ask",
      result: userAskResult()
    })));
    const transport = new CursorResumeCheckpointTransport({
      executable: "/opt/cursor/cursor-agent",
      validatedCliVersion: "2026.08.1",
      runner
    });

    const result = await transport.executeSegment({
      mode: "open",
      environment: isolated,
      model: "auto",
      prompt: "open",
      signal: new AbortController().signal
    }, ["user.ask"]);

    expect(result.turn).toMatchObject({
      assistantMessage: { text: "I need one topology choice." },
      action: {
        type: "action_batch",
        batch: { calls: [{ toolName: "user.ask" }] }
      }
    });
    if (result.turn.action.type !== "action_batch") throw new Error("Expected an action batch.");
    expect(result.turn.action.batch.calls[0]?.args).toMatchObject({
      questions: [{
        expectedAnswerType: "single_choice",
        options: [
          { id: "two_branches", value: "two_branches" },
          { id: "weighted_average", value: "weighted_average" }
        ]
      }]
    });
  });

  it("normalizes Cursor's compact final while keeping exactly one durable final message", async () => {
    const isolated = await environment();
    const runner = new FakeRunner((request) => processResult(stream({
      cwd: request.cwd,
      sessionId: "cursor-session-compact-final",
      result: compactFinalResult()
    })));
    const transport = new CursorResumeCheckpointTransport({
      executable: "/opt/cursor/cursor-agent",
      validatedCliVersion: "2026.08.1",
      runner
    });

    const result = await transport.executeSegment({
      mode: "resume",
      environment: isolated,
      model: "auto",
      prompt: "finish",
      expectedSessionId: "cursor-session-compact-final",
      signal: new AbortController().signal
    }, ["run.request_finish"]);

    expect(result.turn).toEqual({
      protocolVersion: CURSOR_CHECKPOINT_PROTOCOL_VERSION,
      assistantMessage: null,
      action: {
        type: "final",
        messageId: expect.stringMatching(/^message-[a-f0-9]{24}$/),
        finishReceiptId: "finish-receipt-1",
        text: "Ore hauled is complete and validated."
      }
    });
  });

  it("normalizes user.ask aliases inside a regular Cursor ActionBatch", async () => {
    const isolated = await environment();
    const runner = new FakeRunner((request) => processResult(stream({
      cwd: request.cwd,
      sessionId: "cursor-session-nested-ask",
      result: nestedUserAskBatchResult()
    })));
    const transport = new CursorResumeCheckpointTransport({
      executable: "/opt/cursor/cursor-agent",
      validatedCliVersion: "2026.08.1",
      runner
    });

    const result = await transport.executeSegment({
      mode: "open",
      environment: isolated,
      model: "auto",
      prompt: "open",
      signal: new AbortController().signal
    }, ["user.ask"]);

    if (result.turn.action.type !== "action_batch") throw new Error("Expected an action batch.");
    expect(result.turn.action.batch.calls[0]?.args).toMatchObject({
      questions: [{
        expectedAnswerType: "single_choice",
        options: [{ id: "yes", value: "yes" }, { id: "no", value: "no" }]
      }]
    });
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
      credentialEnvironment: [{ name: "SHELL", value: "/bin/zsh" }]
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
