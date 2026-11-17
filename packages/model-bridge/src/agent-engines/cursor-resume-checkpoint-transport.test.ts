import { mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
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
    assistantMessage: { messageId: "ask-1", text: "I need one topology choice." },
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

function stream(input: { cwd: string; sessionId: string; model?: string; result?: string; extra?: readonly unknown[] }): string {
  return [
    {
      type: "system",
      subtype: "init",
      cwd: input.cwd,
      session_id: input.sessionId,
      model: input.model,
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

async function workspaceAlias(canonicalDirectory: string): Promise<string | undefined> {
  const canonical = await realpath(canonicalDirectory);
  const alias = path.join(await temporaryDirectory("vdt-cwd-alias-"), "workspace");
  try {
    await symlink(canonical, alias, "dir");
    return alias;
  } catch {
    return undefined;
  }
}

function expectOmittedDiagnostic(
  error: unknown,
  missing: string,
  extras: {
    parsedLines: number;
    eventTypes: string;
    stdoutEmpty?: boolean;
    secret?: string;
  }
): void {
  const failure = error as Error;
  const stdoutEmpty = extras.stdoutEmpty ?? false;
  expect(failure.message).toContain(`(${missing})`);
  expect(failure.message).toContain(`parsed_lines=${extras.parsedLines}`);
  expect(failure.message).toContain(`event_types=${extras.eventTypes}`);
  expect(failure.message).toContain(`stdout_empty=${stdoutEmpty}`);
  expect(failure.message).toContain("exit=0");
  expect(failure.message).toContain("signal=none");
  if (missing !== "missing_init") expect(failure.message).not.toContain("missing_init");
  if (missing !== "missing_terminal") expect(failure.message).not.toContain("missing_terminal");
  if (missing !== "empty_stdout") expect(failure.message).not.toContain("empty_stdout");
  if (extras.secret) expect(failure.message).not.toContain(extras.secret);
}

async function executeOpen(
  isolated: CursorResumeCheckpointEnvironment,
  runner: FakeRunner
): Promise<unknown> {
  const transport = new CursorResumeCheckpointTransport({
    executable: "/opt/cursor/cursor-agent",
    validatedCliVersion: "2026.08.1",
    runner
  });
  return transport.executeSegment({
    mode: "open",
    environment: isolated,
    model: "auto",
    prompt: "open",
    signal: new AbortController().signal
  }, ["vdt.echo"]).catch((value: unknown) => value);
}

describe("CursorResumeCheckpointTransport", () => {
  it.each(["gpt-5.5-high", "auto"])("opens and resumes %s with shell-free reviewed arguments", async (model) => {
    const isolated = await environment();
    const runner = new FakeRunner((request) => processResult(stream({
      cwd: request.cwd,
      model,
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
      model,
      prompt: "open prompt",
      signal: controller.signal
    }, ["vdt.echo"]);
    const resumed = await transport.executeSegment({
      mode: "resume",
      environment: isolated,
      model,
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
      ...(model === "auto" ? [] : ["--model", model])
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

  it.each([
    ["globToolCall", "Glob"],
    ["grepToolCall", "Grep"],
    ["writeToolCall", "Write"]
  ])("fails closed on Cursor %s activity even with a valid checkpoint reply", async (tool, label) => {
    const isolated = await environment();
    const runner = new FakeRunner((request) => processResult(stream({
      cwd: request.cwd,
      sessionId: "cursor-session-1",
      extra: [{
        type: "tool_call",
        subtype: "started",
        call_id: "foreign-call",
        tool_call: { [tool]: { args: { privateDetail: "private-placeholder" } } },
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
    }, ["vdt.echo"])).rejects.toMatchObject({
      code: "SECURITY_BOUNDARY_BREACH",
      message: `Cursor attempted the prohibited built-in tool ${label} during checkpoint execution.`
    });
    expect(runner.requests).toHaveLength(1);
  });

  it.each([undefined, "auto"])("rejects an unconfirmed explicit checkpoint model (%j)", async model => {
    const isolated = await environment();
    const runner = new FakeRunner(request => processResult(stream({
      cwd: request.cwd, sessionId: "cursor-session-1", ...(model === undefined ? {} : { model })
    })));
    const transport = new CursorResumeCheckpointTransport({
      executable: "/opt/cursor/cursor-agent", validatedCliVersion: "2026.08.1", runner
    });
    await expect(transport.executeSegment({
      mode: "open", environment: isolated, model: "composer-2.5", prompt: "open", signal: new AbortController().signal
    }, ["vdt.echo"])).rejects.toMatchObject({ code: "CURSOR_CHECKPOINT_MODEL_UNVERIFIED" });
    expect(runner.requests).toHaveLength(1);
  });

  it.each(["unique", "duplicate", "other-slug", "reserved-auto"])(
    "confirms only an unambiguous catalog label (%s)", async caseName => {
    const isolated = await environment();
    const label = caseName === "reserved-auto" ? "auto" : caseName === "other-slug" ? "other-model" : "GPT-5.6 Sol 272K Low";
    const model = "gpt-5.6-sol-low";
    const runner = new FakeRunner(request => processResult(stream({ cwd: request.cwd, sessionId: "cursor-session-1", model: label })));
    const names = new Map([[model, label]]);
    if (caseName === "duplicate") names.set("different-model", label);
    if (caseName === "other-slug") names.set(label, "Different display name");
    const transport = new CursorResumeCheckpointTransport({
      executable: "/opt/cursor/cursor-agent", validatedCliVersion: "2026.08.1", modelDisplayNames: names, runner
    });
    const run = transport.executeSegment({
      mode: "open", environment: isolated, model, prompt: "open", signal: new AbortController().signal
    }, ["vdt.echo"]);
    if (caseName === "unique") await expect(run).resolves.toMatchObject({ sessionId: "cursor-session-1" });
    else await expect(run).rejects.toMatchObject({ code: "CURSOR_CHECKPOINT_MODEL_UNVERIFIED" });
  });

  it("corrects a plain-text terminal result once in the same session", async () => {
    const isolated = await environment();
    const runner = new FakeRunner((request, index) => processResult(stream({
      cwd: request.cwd,
      sessionId: "cursor-session-1",
      model: "composer-2.5",
      ...(index === 0 ? { result: "I can outline the calculation for you." } : {})
    })));
    const transport = new CursorResumeCheckpointTransport({
      executable: "/opt/cursor/cursor-agent", validatedCliVersion: "2026.08.1", runner
    });
    const result = await transport.executeSegment({
      mode: "open", environment: isolated, model: "composer-2.5", prompt: "open", signal: new AbortController().signal
    }, ["vdt.echo"]);

    expect(result).toMatchObject({ sessionId: "cursor-session-1", processSpawnCount: 2, envelopeRepaired: true });
    expect(result.turn.action).toMatchObject({ type: "action_batch", batch: { calls: [{ externalCallId: "call-1" }] } });
    expect(runner.requests[1]?.args).toEqual(expect.arrayContaining(["--model", "composer-2.5", "--resume", "cursor-session-1"]));
    expect(runner.requests[1]?.stdin).toContain("The host executed none of its calls.");
    expect(runner.requests[1]?.stdin).toContain('"action":{"type":"action_batch","calls":[');
    expect(runner.requests[1]?.timeoutMs).toBeLessThanOrEqual(runner.requests[0]!.timeoutMs);
  });

  it("uses the validated envelope without projecting stray CLI prose into chat", async () => {
    const isolated = await environment();
    const runner = new FakeRunner((request) => processResult(stream({
      cwd: request.cwd, sessionId: "cursor-session-1",
      result: `CLI narration\n${actionBatchResult("cursor-session-1")}\nJSON delivery note`
    })));
    await expect(executeOpen(isolated, runner)).resolves.toMatchObject({
      turn: { assistantMessage: { messageId: "message-1", text: "I will inspect the VDT graph." } }
    });
  });

  it.each([
    ["A second plain-text answer.", "CURSOR_CHECKPOINT_PROTOCOL_INVALID", 2],
    [actionBatchResult("cursor-session-1").repeat(2), "CURSOR_CHECKPOINT_PROTOCOL_AMBIGUOUS", 1]
  ] as const)("bounds repairs and rejects ambiguous output", async (invalid, code, attempts) => {
    const isolated = await environment();
    const runner = new FakeRunner((request) => processResult(stream({
      cwd: request.cwd, sessionId: "cursor-session-1", result: invalid
    })));
    await expect(executeOpen(isolated, runner)).resolves.toMatchObject({ code });
    expect(runner.requests).toHaveLength(attempts);
  });

  it("records Cursor native web search tool_calls instead of treating them as SECURITY_BOUNDARY_BREACH", async () => {
    const isolated = await environment();
    const runner = new FakeRunner((request) => processResult(stream({
      cwd: request.cwd,
      sessionId: "cursor-session-search",
      extra: [{
        type: "tool_call",
        subtype: "started",
        call_id: "search-1",
        tool_call: { webSearchToolCall: { args: { searchTerm: "ore hauled drivers" } } },
        session_id: "cursor-session-search"
      }]
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
    expect(result.turn.action.type).toBe("action_batch");
    expect(result.nativeWebSearch).toEqual({
      count: 1,
      queries: ["ore hauled drivers"]
    });
  });

  it("uses the trusted subscription auth home with a separate restricted config", async () => {
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
    const canonicalState = await realpath(isolated.privateStatePath);
    const configDir = path.join(canonicalState, "cursor-config");
    expect(runner.requests[0]?.environment).toEqual({
      HOME: canonicalAuthHome,
      USERPROFILE: canonicalAuthHome,
      CURSOR_CONFIG_DIR: configDir,
      XDG_CONFIG_HOME: path.join(canonicalState, "xdg-config"),
      PATH: "/usr/bin:/bin",
      USER: "trusted-user",
      LOGNAME: "trusted-user"
    });
    expect(JSON.parse(await readFile(path.join(configDir, "cli-config.json"), "utf8"))).toMatchObject({
      approvalMode: "allowlist",
      permissions: { allow: [], deny: expect.arrayContaining(["Shell(*)", "Read(/**)", "Write(/**)", "Mcp(*:*)"]) },
      sandbox: { mode: "enabled", readBoundary: "workspace" }
    });
    expect(await readdir(authHome)).toEqual([]);
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
    await expect(transport.executeSegment({ ...common, mode: "resume", expectedSessionId: "cursor-session-thinking" }, ["vdt.echo"]))
      .rejects.toMatchObject({ code: "CURSOR_CHECKPOINT_PROTOCOL_MISMATCH" });
  });

  describe("pinned Cursor print telemetry", () => {
    const sessionId = "cursor-session-telemetry";
    const telemetry = { session_id: sessionId, timestamp_ms: 1_795_000_000_000 };
    const usage = {
      ...telemetry,
      type: "usage",
      subtype: "model_call",
      model_call_id: "model-call-1",
      usage: { inputTokens: 0, outputTokens: 17, cacheReadTokens: 130, cacheWriteTokens: 22 }
    };

    async function execute(eventFrames: readonly unknown[], position: "before_init" | "after_init" | "after_result" = "after_init") {
      const isolated = await environment();
      const runner = new FakeRunner((request) => {
        const standard = stream({ cwd: request.cwd, sessionId, model: "Grok 4.7 256K Low" });
        const serialized = eventFrames.map((event) => JSON.stringify(event)).join("\n") + "\n";
        if (position === "before_init") return processResult(serialized + standard);
        if (position === "after_result") return processResult(standard + serialized);
        return processResult(stream({
          cwd: request.cwd, sessionId, model: "Grok 4.7 256K Low", extra: eventFrames
        }));
      });
      return new CursorResumeCheckpointTransport({
        executable: "/opt/cursor/cursor-agent",
        validatedCliVersion: "2026.11.11-b912975",
        modelDisplayNames: new Map([["grok-4.7-low", "Grok 4.7 256K Low"]]),
        runner
      }).executeSegment({
        mode: "open", environment: isolated, model: "grok-4.7-low", prompt: "open",
        signal: new AbortController().signal
      }, ["vdt.echo"]);
    }

    it("ignores the five exact telemetry shapes while preserving only the verified action", async () => {
      const result = await execute([
        usage,
        { ...usage, model_call_id: "model-call-2", usage: { ...usage.usage, reasoningTokens: 2 } },
        { ...telemetry, type: "retry", subtype: "starting", attempt: 1, is_resume: false },
        { ...telemetry, type: "retry", subtype: "resuming", attempt: 2, checkpoint_turn_count: 0 },
        { ...telemetry, type: "connection", subtype: "reconnecting", attempt: 1, endpoint_url: "https://private-endpoint.invalid" },
        { ...telemetry, type: "connection", subtype: "reconnecting", attempt: 2 },
        { ...telemetry, type: "connection", subtype: "reconnected" }
      ]);
      expect(result).toMatchObject({ sessionId, turn: { action: { type: "action_batch" } } });
      expect(result.nativeWebSearch).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain("private-endpoint");
      expect(JSON.stringify(result)).not.toContain("outputTokens");
    });

    it.each([
      { ...usage, model_call_id: "" },
      { ...usage, usage: { ...usage.usage, reasoningTokens: 0 } },
      { ...usage, usage: { ...usage.usage, inputTokens: -1 } },
      { ...usage, usage: { ...usage.usage, cacheReadTokens: "130" } },
      { ...usage, usage: { ...usage.usage, extraCounter: 2 } },
      { ...usage, tool_call: { shellToolCall: {} } },
      { ...usage, timestamp_ms: 1.25 },
      { ...telemetry, type: "retry", subtype: "starting", attempt: 1, is_resume: "false" },
      { ...telemetry, type: "retry", subtype: "resuming", attempt: 1 },
      { ...telemetry, type: "connection", subtype: "reconnected", endpoint_url: "https://private.invalid" },
      { ...telemetry, type: "connection", subtype: "reconnecting", attempt: 1, endpoint_url: { shellToolCall: {} } },
      { ...telemetry, type: "connection", subtype: "future" }
    ])("rejects extra, missing, or ill-typed telemetry fields %#", async (event) => {
      await expect(execute([event])).rejects.toMatchObject({
        code: "CURSOR_CHECKPOINT_PROTOCOL_MISMATCH",
        eventType: event.type,
        eventSubtype: event.subtype
      });
    });

    it("requires telemetry after verified init, before the terminal result, and on the same session", async () => {
      await expect(execute([usage], "before_init")).rejects.toMatchObject({ code: "CURSOR_CHECKPOINT_PROTOCOL_INVALID" });
      await expect(execute([usage], "after_result")).rejects.toMatchObject({ code: "CURSOR_CHECKPOINT_PROTOCOL_INVALID" });
      await expect(execute([{ ...usage, session_id: "foreign-session" }])).rejects.toMatchObject({
        code: "CURSOR_CHECKPOINT_SESSION_MISMATCH", eventType: "usage"
      });
    });

    it.each(["request", "response"])("blocks native provider interaction %s before exposing any payload", async (subtype) => {
      await expect(execute([{ ...telemetry, type: "interaction_query", subtype, query: "internal interaction payload" }]))
        .rejects.toMatchObject({
          code: "SECURITY_BOUNDARY_BREACH", eventType: "interaction_query", eventSubtype: subtype,
          message: `Cursor attempted a prohibited provider interaction (interaction_query:${subtype}).`
        });
    });

    it("names bounded unknown discriminators and withholds unsafe strings", async () => {
      await expect(execute([{ type: "task_notification", subtype: "completed", contents: "internal output" }]))
        .rejects.toMatchObject({
          code: "CURSOR_CHECKPOINT_PROTOCOL_MISMATCH", eventType: "task_notification", eventSubtype: "completed",
          message: "Cursor stream contained an unknown event type (task_notification:completed)."
        });
      await expect(execute([{ type: "https://private-path.invalid", subtype: "X".repeat(200) }]))
        .rejects.toMatchObject({
          code: "CURSOR_CHECKPOINT_PROTOCOL_MISMATCH",
          message: "Cursor stream contained an unknown event type (unrecognized discriminator)."
        });
    });
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
    const runner = new FakeRunner((request, index) => processResult(stream({
      cwd: request.cwd,
      sessionId: "cursor-session-compact-final",
      result: index === 0 ? JSON.stringify({
        protocolVersion: CURSOR_CHECKPOINT_PROTOCOL_VERSION,
        assistantMessage: null,
        action: { type: "final", final: { finishReceiptId: "finish-receipt-1" } }
      }) : compactFinalResult()
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
      verifiedFinishReceiptId: "finish-receipt-1",
      signal: new AbortController().signal
    }, ["run.request_finish"]);

    expect(result.envelopeRepaired).toBe(true);
    expect(runner.requests[1]?.stdin).toContain('"action":{"type":"final","finishReceiptId":"finish-receipt-1"');
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

  it("names missing_init when the stream has a terminal result but no system init", async () => {
    const isolated = await environment();
    const secret = "DO_NOT_ECHO_MODEL_OUTPUT_9f3a";
    const runner = new FakeRunner(() => processResult([
      { type: "assistant", session_id: "cursor-session-missing-init" },
      {
        type: "result",
        subtype: "success",
        is_error: false,
        result: actionBatchResult("cursor-session-missing-init").replace("I will inspect the VDT graph.", secret),
        session_id: "cursor-session-missing-init"
      }
    ].map((event) => JSON.stringify(event)).join("\n") + "\n"));
    const error = await executeOpen(isolated, runner);

    expect(error).toMatchObject({
      code: "CURSOR_CHECKPOINT_PROTOCOL_INVALID",
      missingEvidence: ["missing_init"],
      parsedLineCount: 2,
      eventTypes: "assistant,result.success",
      stdoutEmpty: false,
      exitCode: 0,
      signal: "none"
    });
    expectOmittedDiagnostic(error, "missing_init", {
      parsedLines: 2,
      eventTypes: "assistant,result.success",
      secret
    });
  });

  it("names missing_terminal when the stream has system init but no result event", async () => {
    const isolated = await environment();
    const runner = new FakeRunner((request) => processResult(JSON.stringify({
      type: "system",
      subtype: "init",
      cwd: request.cwd,
      session_id: "cursor-session-missing-terminal",
      permissionMode: "ask"
    }) + "\n"));
    const error = await executeOpen(isolated, runner);

    expect(error).toMatchObject({
      code: "CURSOR_CHECKPOINT_PROTOCOL_INVALID",
      missingEvidence: ["missing_terminal"],
      parsedLineCount: 1,
      eventTypes: "system.init",
      stdoutEmpty: false,
      exitCode: 0,
      signal: "none"
    });
    expectOmittedDiagnostic(error, "missing_terminal", {
      parsedLines: 1,
      eventTypes: "system.init"
    });
  });

  it("names empty_stdout when Cursor exits 0 with no stream bytes", async () => {
    const isolated = await environment();
    const runner = new FakeRunner(() => processResult(""));
    const error = await executeOpen(isolated, runner);

    expect(error).toMatchObject({
      code: "CURSOR_CHECKPOINT_PROTOCOL_INVALID",
      missingEvidence: ["empty_stdout"],
      parsedLineCount: 0,
      eventTypes: "<none>",
      stdoutEmpty: true,
      exitCode: 0,
      signal: "none"
    });
    expectOmittedDiagnostic(error, "empty_stdout", {
      parsedLines: 0,
      eventTypes: "<none>",
      stdoutEmpty: true
    });
  });

  it("accepts a reported cwd that canonicalises onto the private workspace", async () => {
    const isolated = await environment();
    const runner = new FakeRunner(async (request) => {
      const alias = await workspaceAlias(request.cwd) ?? isolated.privateWorkspacePath;
      return processResult(stream({ cwd: alias, sessionId: "cursor-session-cwd-alias" }));
    });
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
    }, ["vdt.echo"])).resolves.toMatchObject({ sessionId: "cursor-session-cwd-alias" });
  });

  it("still rejects a reported cwd that canonicalises to a different directory", async () => {
    const isolated = await environment();
    const other = await temporaryDirectory("vdt-cursor-other-cwd-");
    const runner = new FakeRunner((request, index) => processResult(stream({
      cwd: index === 0 ? other : ".",
      sessionId: "cursor-session-cwd-breach"
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
    await expect(transport.executeSegment(common, ["vdt.echo"]))
      .rejects.toMatchObject({ code: "SECURITY_BOUNDARY_BREACH" });
    await expect(transport.executeSegment({ ...common, environment: await environment() }, ["vdt.echo"]))
      .rejects.toMatchObject({ code: "SECURITY_BOUNDARY_BREACH" });
  });
});
