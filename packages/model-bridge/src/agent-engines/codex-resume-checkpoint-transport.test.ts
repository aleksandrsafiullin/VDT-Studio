import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  VDT_CHECKPOINT_TURN_PROTOCOL_VERSION
} from "./persistent-cli-checkpoint-canaries";
import {
  CodexResumeCheckpointTransport,
  type CodexResumeCheckpointEnvironment
} from "./codex-resume-checkpoint-transport";
import type { CheckpointProcessRequest, CheckpointProcessResult, CheckpointProcessRunner } from "./checkpoint-transport-common";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function checkpointTurn(): string {
  return JSON.stringify({
    protocolVersion: VDT_CHECKPOINT_TURN_PROTOCOL_VERSION,
    assistantMessage: { messageId: "message-1", text: "I will inspect the VDT graph." },
    action: {
      type: "action_batch",
      batch: {
        calls: [{ externalCallId: "call-1", toolName: "vdt.echo", args: { value: 1 } }]
      }
    }
  });
}

const OPENING_SUMMARY = "Accepted: build a VDT model for Ore haulage (tonnes/year) using your provided trucking inputs.";

function codexStream(sessionId: string, turn = checkpointTurn(), extra: readonly unknown[] = []): string {
  return [
    { type: "thread.started", thread_id: sessionId },
    { type: "turn.started" },
    ...extra,
    { type: "item.completed", item: { id: "item-1", type: "agent_message", text: turn } },
    { type: "turn.completed" }
  ].map((event) => JSON.stringify(event)).join("\n") + "\n";
}

function codexAgentMessageStream(sessionId: string, texts: readonly string[]): string {
  return [
    { type: "thread.started", thread_id: sessionId },
    { type: "turn.started" },
    ...texts.map((text, index) => ({
      type: "item.completed",
      item: { id: `item-${index + 1}`, type: "agent_message", text }
    })),
    { type: "turn.completed" }
  ].map((event) => JSON.stringify(event)).join("\n") + "\n";
}

class FakeRunner implements CheckpointProcessRunner {
  readonly requests: CheckpointProcessRequest[] = [];
  readonly #respond: (request: CheckpointProcessRequest, index: number) => CheckpointProcessResult | Promise<CheckpointProcessResult>;

  constructor(respond: (request: CheckpointProcessRequest, index: number) => CheckpointProcessResult | Promise<CheckpointProcessResult>) {
    this.#respond = respond;
  }

  async run(request: CheckpointProcessRequest): Promise<CheckpointProcessResult> {
    const copy = { ...request, args: [...request.args], environment: { ...request.environment } };
    this.requests.push(copy);
    return this.#respond(copy, this.requests.length - 1);
  }
}

async function environment(): Promise<CodexResumeCheckpointEnvironment> {
  return {
    environmentId: "codex-private-env",
    privateWorkspacePath: await temporaryDirectory("vdt-codex-workspace-"),
    privateStatePath: await temporaryDirectory("vdt-codex-state-"),
    forbiddenRoots: [await temporaryDirectory("vdt-codex-forbidden-")]
  };
}

function expectCodexOmitted(
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

describe("CodexResumeCheckpointTransport", () => {
  it("opens and resumes with stdin prompt and no MCP configuration", async () => {
    const env = await environment();
    const runner = new FakeRunner(() => ({
      exitCode: 0,
      signal: null,
      stdout: codexStream("codex-thread-1"),
      stderr: ""
    }));
    const transport = new CodexResumeCheckpointTransport({
      executable: "/opt/codex/codex",
      validatedCliVersion: "0.146.0",
      runner
    });
    const opened = await transport.executeSegment({
      mode: "open",
      environment: env,
      model: "gpt-5.4",
      prompt: '{"delta":"open"}',
      signal: new AbortController().signal
    }, ["vdt.echo"]);
    const resumed = await transport.executeSegment({
      mode: "resume",
      environment: env,
      model: "gpt-5.4",
      prompt: '{"delta":"resume"}',
      expectedSessionId: opened.sessionId,
      signal: new AbortController().signal
    }, ["vdt.echo"]);

    expect(opened.sessionId).toBe("codex-thread-1");
    expect(resumed.sessionId).toBe("codex-thread-1");
    expect(opened.processSpawnCount).toBe(1);
    expect(resumed.processSpawnCount).toBe(1);
    expect(transport.processSpawnCount).toBe(runner.requests.length);
    expect(transport.processSpawnCount).toBe(2);
    expect(typeof opened.inferenceMs).toBe("number");
    expect(opened.outputBytes).toBeGreaterThan(0);
    expect(runner.requests[0]?.args).toEqual([
      "exec",
      "--json",
      "--color",
      "never",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--sandbox",
      "read-only",
      "--model",
      "gpt-5.4",
      "-C",
      runner.requests[0]!.cwd,
      "-"
    ]);
    expect(runner.requests[1]?.args).toEqual([
      "exec",
      "resume",
      "--json",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "-c",
      'sandbox_mode="read-only"',
      "--model",
      "gpt-5.4",
      "codex-thread-1",
      "-"
    ]);
    expect(runner.requests[0]?.args).not.toEqual(expect.arrayContaining(["--ephemeral", "--yolo"]));
  });

  it("builds resume args with a config sandbox pin and without open-only flags", async () => {
    const env = await environment();
    const runner = new FakeRunner(() => ({
      exitCode: 0,
      signal: null,
      stdout: codexStream("codex-thread-resume-args"),
      stderr: ""
    }));
    const transport = new CodexResumeCheckpointTransport({
      executable: "/opt/codex/codex",
      validatedCliVersion: "0.146.0",
      runner
    });

    await transport.executeSegment({
      mode: "resume",
      environment: env,
      model: "gpt-5.4",
      prompt: '{"delta":"resume"}',
      expectedSessionId: "codex-thread-resume-args",
      signal: new AbortController().signal
    }, ["vdt.echo"]);

    const resumeArgs = runner.requests[0]?.args ?? [];
    expect(resumeArgs).toContain("-c");
    expect(resumeArgs).toContain('sandbox_mode="read-only"');
    expect(resumeArgs).not.toContain("--color");
    expect(resumeArgs).not.toContain("--sandbox");
    expect(resumeArgs).not.toContain("-C");
  });

  it("names unknown item types in protocol mismatch errors without echoing hostile discriminators", async () => {
    const env = await environment();
    const runner = new FakeRunner(() => ({
      exitCode: 0,
      signal: null,
      stdout: codexStream("codex-thread-unknown-item", checkpointTurn(), [
        { type: "item.completed", item: { id: "bad", type: "foreign_tool" } }
      ]),
      stderr: ""
    }));
    const transport = new CodexResumeCheckpointTransport({
      executable: "/opt/codex/codex",
      validatedCliVersion: "0.146.0",
      runner
    });
    await expect(transport.executeSegment({
      mode: "open",
      environment: env,
      model: "gpt-5.4",
      prompt: "{}",
      signal: new AbortController().signal
    }, ["vdt.echo"])).rejects.toMatchObject({
      code: "CODEX_CHECKPOINT_PROTOCOL_MISMATCH",
      message: "Codex emitted an unknown item type: foreign_tool."
    });
  });

  it("replaces hostile unknown stream event discriminators with <unrecognized>", async () => {
    const env = await environment();
    const hostileEvent = JSON.stringify({
      type: `evil"\n${"x".repeat(80)}`,
      thread_id: "codex-thread-hostile-event"
    });
    const runner = new FakeRunner(() => ({
      exitCode: 0,
      signal: null,
      stdout: [
        { type: "thread.started", thread_id: "codex-thread-hostile-event" },
        { type: "turn.started" },
        JSON.parse(hostileEvent),
        { type: "item.completed", item: { id: "item-1", type: "agent_message", text: checkpointTurn() } },
        { type: "turn.completed" }
      ].map((event) => JSON.stringify(event)).join("\n") + "\n",
      stderr: ""
    }));
    const transport = new CodexResumeCheckpointTransport({
      executable: "/opt/codex/codex",
      validatedCliVersion: "0.146.0",
      runner
    });
    await expect(transport.executeSegment({
      mode: "open",
      environment: env,
      model: "gpt-5.4",
      prompt: "{}",
      signal: new AbortController().signal
    }, ["vdt.echo"])).rejects.toMatchObject({
      code: "CODEX_CHECKPOINT_PROTOCOL_MISMATCH",
      message: "Codex emitted an unknown stream event: <unrecognized>."
    });
  });

  it("skips informational error items and parses a healthy turn", async () => {
    const env = await environment();
    const diagnostic = "Skill descriptions were shortened to fit the 2% skills context budget.";
    const runner = new FakeRunner(() => ({
      exitCode: 0,
      signal: null,
      stdout: codexStream("codex-thread-error-item", checkpointTurn(), [
        {
          type: "item.completed",
          item: {
            id: "diag-1",
            type: "error",
            text: diagnostic
          }
        }
      ]),
      stderr: ""
    }));
    const transport = new CodexResumeCheckpointTransport({
      executable: "/opt/codex/codex",
      validatedCliVersion: "0.146.0",
      runner
    });
    const result = await transport.executeSegment({
      mode: "open",
      environment: env,
      model: "gpt-5.4",
      prompt: "{}",
      signal: new AbortController().signal
    }, ["vdt.echo"]);
    expect(result.turn.action.type).toBe("action_batch");
    expect(result.segmentDiagnosticSummary).toBe(`error bytes=${Buffer.byteLength(diagnostic, "utf8")}`);
    expect(result.segmentDiagnosticSummary).not.toContain("Skill");
  });

  it("still fails top-level error and turn.failed events", async () => {
    const env = await environment();
    const transport = new CodexResumeCheckpointTransport({
      executable: "/opt/codex/codex",
      validatedCliVersion: "0.146.0",
      runner: new FakeRunner((request, index) => ({
        exitCode: 0,
        signal: null,
        stdout: index === 0
          ? [
            { type: "thread.started", thread_id: "codex-thread-top-error" },
            { type: "turn.started" },
            { type: "error", message: "Authentication required." },
            { type: "turn.completed" }
          ].map((event) => JSON.stringify(event)).join("\n") + "\n"
          : [
            { type: "thread.started", thread_id: "codex-thread-turn-failed" },
            { type: "turn.started" },
            { type: "turn.failed" },
            { type: "turn.completed" }
          ].map((event) => JSON.stringify(event)).join("\n") + "\n",
        stderr: ""
      }))
    });
    const common = {
      mode: "open" as const,
      environment: env,
      model: "gpt-5.4",
      prompt: "{}",
      signal: new AbortController().signal
    };
    await expect(transport.executeSegment(common, ["vdt.echo"]))
      .rejects.toMatchObject({ code: "CODEX_CHECKPOINT_PROCESS_FAILED" });
    await expect(transport.executeSegment(common, ["vdt.echo"]))
      .rejects.toMatchObject({ code: "CODEX_CHECKPOINT_PROCESS_FAILED" });
  });

  it("fails when an error item is the only terminal evidence", async () => {
    const env = await environment();
    const runner = new FakeRunner(() => ({
      exitCode: 0,
      signal: null,
      stdout: [
        { type: "thread.started", thread_id: "codex-thread-error-only" },
        { type: "turn.started" },
        {
          type: "item.completed",
          item: {
            id: "diag-only",
            type: "error",
            text: "Model metadata for gpt-5.4 not found."
          }
        },
        { type: "turn.completed" }
      ].map((event) => JSON.stringify(event)).join("\n") + "\n",
      stderr: ""
    }));
    const transport = new CodexResumeCheckpointTransport({
      executable: "/opt/codex/codex",
      validatedCliVersion: "0.146.0",
      runner
    });
    await expect(transport.executeSegment({
      mode: "open",
      environment: env,
      model: "gpt-5.4",
      prompt: "{}",
      signal: new AbortController().signal
    }, ["vdt.echo"])).rejects.toMatchObject({
      code: "CODEX_CHECKPOINT_PROTOCOL_INVALID",
      missingEvidence: ["missing_agent_message"],
      stdoutEmpty: false
    });
  });

  it("treats disagreeing item type and item_type as SECURITY_BOUNDARY_BREACH", async () => {
    const env = await environment();
    const leak = "DO_NOT_ECHO_MODEL_OUTPUT_9f3a";
    const runner = new FakeRunner(() => ({
      exitCode: 0,
      signal: null,
      stdout: codexStream("codex-thread-type-disagree", checkpointTurn(), [
        { type: "item.completed", item: { id: "masked", type: "error", item_type: "web_search", text: leak } }
      ]),
      stderr: ""
    }));
    const transport = new CodexResumeCheckpointTransport({
      executable: "/opt/codex/codex",
      validatedCliVersion: "0.146.0",
      runner
    });
    const error = await transport.executeSegment({
      mode: "open",
      environment: env,
      model: "gpt-5.4",
      prompt: "{}",
      signal: new AbortController().signal
    }, ["vdt.echo"]).then(() => undefined, (value: unknown) => value);
    expect(error).toMatchObject({ code: "SECURITY_BOUNDARY_BREACH" });
    expect((error as Error).message).toBe("Codex item type fields disagreed.");
    expect((error as Error).message).not.toContain(leak);
  });

  it("records Codex native web_search items instead of treating them as SECURITY_BOUNDARY_BREACH", async () => {
    // Policy 2026-09-14: native web search is allowed; this previously asserted a breach.
    const env = await environment();
    const runner = new FakeRunner(() => ({
      exitCode: 0,
      signal: null,
      stdout: codexStream("codex-thread-2", checkpointTurn(), [
        {
          type: "item.started",
          item: { id: "search-1", type: "web_search", query: "haulage cycle time" }
        },
        {
          type: "item.completed",
          item: { id: "search-1", type: "web_search", query: "haulage cycle time" }
        }
      ]),
      stderr: ""
    }));
    const transport = new CodexResumeCheckpointTransport({
      executable: "/opt/codex/codex",
      validatedCliVersion: "0.146.0",
      runner
    });
    const result = await transport.executeSegment({
      mode: "open",
      environment: env,
      model: "gpt-5.4",
      prompt: "{}",
      signal: new AbortController().signal
    }, ["vdt.echo"]);
    expect(result.turn.action.type).toBe("action_batch");
    expect(result.nativeWebSearch).toEqual({
      count: 1,
      queries: ["haulage cycle time"]
    });
  });

  it("keeps native web search on a later protocol failure so the run can still record it", async () => {
    const env = await environment();
    const runner = new FakeRunner(() => ({
      exitCode: 0,
      signal: null,
      stdout: codexStream("codex-thread-search-then-dup", checkpointTurn(), [
        {
          type: "item.completed",
          item: { id: "search-1", type: "web_search", query: "haulage cycle time" }
        },
        {
          type: "item.completed",
          item: { id: "msg-a", type: "agent_message", text: checkpointTurn() }
        }
      ]),
      stderr: ""
    }));
    const transport = new CodexResumeCheckpointTransport({
      executable: "/opt/codex/codex",
      validatedCliVersion: "0.146.0",
      runner
    });
    const error = await transport.executeSegment({
      mode: "open",
      environment: env,
      model: "gpt-5.4",
      prompt: "{}",
      signal: new AbortController().signal
    }, ["vdt.echo"]).then(() => undefined, (value: unknown) => value);
    expect(error).toMatchObject({
      code: "CODEX_CHECKPOINT_PROTOCOL_AMBIGUOUS",
      nativeWebSearch: {
        count: 1,
        queries: ["haulage cycle time"]
      }
    });
  });

  it("treats opening-summary prose plus a checkpoint envelope as one turn", async () => {
    const env = await environment();
    const runner = new FakeRunner(() => ({
      exitCode: 0,
      signal: null,
      stdout: codexAgentMessageStream("codex-thread-prose-then-envelope", [OPENING_SUMMARY, checkpointTurn()]),
      stderr: ""
    }));
    const transport = new CodexResumeCheckpointTransport({
      executable: "/opt/codex/codex",
      validatedCliVersion: "0.146.0",
      runner
    });
    const result = await transport.executeSegment({
      mode: "open",
      environment: env,
      model: "gpt-5.4",
      prompt: "{}",
      signal: new AbortController().signal
    }, ["vdt.echo"]);
    expect(result.turn.action.type).toBe("action_batch");
    expect(result.turn.assistantMessage?.text).toContain(OPENING_SUMMARY);
    expect(result.turn.assistantMessage?.text).toContain("I will inspect the VDT graph.");
  });

  it("selects an envelope even when prose comes after it", async () => {
    const env = await environment();
    const runner = new FakeRunner(() => ({
      exitCode: 0,
      signal: null,
      stdout: codexAgentMessageStream("codex-thread-envelope-then-prose", [checkpointTurn(), OPENING_SUMMARY]),
      stderr: ""
    }));
    const transport = new CodexResumeCheckpointTransport({
      executable: "/opt/codex/codex",
      validatedCliVersion: "0.146.0",
      runner
    });
    const result = await transport.executeSegment({
      mode: "open",
      environment: env,
      model: "gpt-5.4",
      prompt: "{}",
      signal: new AbortController().signal
    }, ["vdt.echo"]);
    expect(result.turn.action.type).toBe("action_batch");
    if (result.turn.action.type !== "action_batch") throw new Error("expected action_batch");
    expect(result.turn.action.batch.calls[0]?.externalCallId).toBe("call-1");
    expect(result.turn.assistantMessage?.text).toContain(OPENING_SUMMARY);
  });

  it("rejects two parseable envelopes as PROTOCOL_AMBIGUOUS", async () => {
    const env = await environment();
    const second = checkpointTurn().replace("message-1", "message-2").replace("call-1", "call-2");
    const runner = new FakeRunner(() => ({
      exitCode: 0,
      signal: null,
      stdout: codexAgentMessageStream("codex-thread-two-envelopes", [checkpointTurn(), second]),
      stderr: ""
    }));
    const transport = new CodexResumeCheckpointTransport({
      executable: "/opt/codex/codex",
      validatedCliVersion: "0.146.0",
      runner
    });
    await expect(transport.executeSegment({
      mode: "open",
      environment: env,
      model: "gpt-5.4",
      prompt: "{}",
      signal: new AbortController().signal
    }, ["vdt.echo"])).rejects.toMatchObject({
      code: "CODEX_CHECKPOINT_PROTOCOL_AMBIGUOUS",
      message: expect.stringMatching(/ambiguous: found 2 candidate JSON objects/)
    });
  });

  it("keeps today's diagnostic when no agent message is a parseable envelope", async () => {
    const env = await environment();
    const runner = new FakeRunner(() => ({
      exitCode: 0,
      signal: null,
      stdout: codexAgentMessageStream("codex-thread-prose-only", [OPENING_SUMMARY, "Still just prose."]),
      stderr: ""
    }));
    const transport = new CodexResumeCheckpointTransport({
      executable: "/opt/codex/codex",
      validatedCliVersion: "0.146.0",
      runner
    });
    await expect(transport.executeSegment({
      mode: "open",
      environment: env,
      model: "gpt-5.4",
      prompt: "{}",
      signal: new AbortController().signal
    }, ["vdt.echo"])).rejects.toMatchObject({
      code: "CODEX_CHECKPOINT_PROTOCOL_INVALID",
      message: "Checkpoint result must be exactly one JSON object without prose or fences."
    });
  });

  it("still rejects forbidden Codex tool events as SECURITY_BOUNDARY_BREACH", async () => {
    const env = await environment();
    for (const type of ["command_execution", "file_change", "collab_tool_call", "mcp_tool_call"] as const) {
      const runner = new FakeRunner(() => ({
        exitCode: 0,
        signal: null,
        stdout: codexStream("codex-thread-forbidden", checkpointTurn(), [
          { type: "item.completed", item: { id: "bad", type } }
        ]),
        stderr: ""
      }));
      const transport = new CodexResumeCheckpointTransport({
        executable: "/opt/codex/codex",
        validatedCliVersion: "0.146.0",
        runner
      });
      await expect(transport.executeSegment({
        mode: "open",
        environment: env,
        model: "gpt-5.4",
        prompt: "{}",
        signal: new AbortController().signal
      }, ["vdt.echo"])).rejects.toMatchObject({ code: "SECURITY_BOUNDARY_BREACH" });
    }
  });

  it("passes --search only when native web search is forced on", async () => {
    const env = await environment();
    const runner = new FakeRunner(() => ({
      exitCode: 0,
      signal: null,
      stdout: codexStream("codex-thread-search-flag"),
      stderr: ""
    }));
    const transport = new CodexResumeCheckpointTransport({
      executable: "/opt/codex/codex",
      validatedCliVersion: "0.146.0",
      runner
    });
    await transport.executeSegment({
      mode: "open",
      environment: env,
      model: "gpt-5.4",
      prompt: "{}",
      signal: new AbortController().signal,
      forceNativeWebSearch: true
    }, ["vdt.echo"]);
    expect(runner.requests[0]?.args).toEqual(expect.arrayContaining(["--search"]));
    expect(runner.requests[0]?.args.indexOf("--search")).toBeGreaterThan(runner.requests[0]!.args.indexOf("--json"));
  });

  it("uses an explicit trusted subscription auth home for credentials without exposing private state", async () => {
    const env = await environment();
    const authHome = await temporaryDirectory("vdt-codex-auth-home-");
    const runner = new FakeRunner(() => ({
      exitCode: 0,
      signal: null,
      stdout: codexStream("codex-thread-auth"),
      stderr: ""
    }));
    const transport = new CodexResumeCheckpointTransport({
      executable: "/opt/codex/codex",
      validatedCliVersion: "0.146.0",
      runner
    });

    await transport.executeSegment({
      mode: "open",
      environment: {
        ...env,
        trustedSubscriptionAuthHomePath: authHome,
        preauthorizeEmptyWorkspace: true,
        credentialEnvironment: [
          { name: "PATH", value: "/usr/bin:/bin" },
          { name: "USER", value: "trusted-user" },
          { name: "LOGNAME", value: "trusted-user" }
        ]
      },
      model: "gpt-5.4",
      prompt: '{"delta":"open"}',
      signal: new AbortController().signal
    }, ["vdt.echo"]);

    const canonicalAuthHome = await realpath(authHome);
    expect(runner.requests[0]?.environment).toEqual({
      HOME: canonicalAuthHome,
      USERPROFILE: canonicalAuthHome,
      CODEX_HOME: path.join(canonicalAuthHome, ".codex"),
      PATH: "/usr/bin:/bin",
      USER: "trusted-user",
      LOGNAME: "trusted-user"
    });
  });

  it("pins CODEX_HOME to the isolated state directory without auth home", async () => {
    const env = await environment();
    const runner = new FakeRunner(() => ({
      exitCode: 0,
      signal: null,
      stdout: codexStream("codex-thread-isolated"),
      stderr: ""
    }));
    const transport = new CodexResumeCheckpointTransport({
      executable: "/opt/codex/codex",
      validatedCliVersion: "0.146.0",
      runner
    });

    await transport.executeSegment({
      mode: "open",
      environment: env,
      model: "gpt-5.4",
      prompt: '{"delta":"open"}',
      signal: new AbortController().signal
    }, ["vdt.echo"]);

    const canonicalState = await realpath(env.privateStatePath);
    expect(runner.requests[0]?.environment).toEqual({
      HOME: canonicalState,
      USERPROFILE: canonicalState,
      CODEX_HOME: canonicalState
    });
  });

  it("rejects credential leaks in stdout", async () => {
    const env: CodexResumeCheckpointEnvironment = {
      ...(await environment()),
      credentialEnvironment: [{ name: "OPENAI_API_KEY", value: "sk-live-leak-test-key-0001" }]
    };
    const runner = new FakeRunner(() => ({
      exitCode: 0,
      signal: null,
      stdout: `sk-live-leak-test-key-0001\n${codexStream("codex-thread-3")}`,
      stderr: ""
    }));
    const transport = new CodexResumeCheckpointTransport({
      executable: "/opt/codex/codex",
      validatedCliVersion: "0.146.0",
      runner
    });
    await expect(transport.executeSegment({
      mode: "open",
      environment: env,
      model: "gpt-5.4",
      prompt: "{}",
      signal: new AbortController().signal
    }, ["vdt.echo"])).rejects.toMatchObject({ code: "SECURITY_BOUNDARY_BREACH" });
  });

  it("names missing_init when resume has a completed turn but no thread.started", async () => {
    const env = await environment();
    const secret = "DO_NOT_ECHO_MODEL_OUTPUT_9f3a";
    const runner = new FakeRunner(() => ({
      exitCode: 0,
      signal: null,
      stdout: [
        { type: "turn.started" },
        { type: "item.completed", item: { id: "item-1", type: "agent_message", text: checkpointTurn().replace("I will inspect the VDT graph.", secret) } },
        { type: "turn.completed" }
      ].map((event) => JSON.stringify(event)).join("\n") + "\n",
      stderr: ""
    }));
    const error = await new CodexResumeCheckpointTransport({
      executable: "/opt/codex/codex",
      validatedCliVersion: "0.146.0",
      runner
    }).executeSegment({
      mode: "resume",
      environment: env,
      model: "gpt-5.4",
      prompt: "{}",
      expectedSessionId: "codex-thread-missing-init",
      signal: new AbortController().signal
    }, ["vdt.echo"]).then(() => undefined, (value: unknown) => value);

    expect(error).toMatchObject({
      code: "CODEX_CHECKPOINT_PROTOCOL_INVALID",
      missingEvidence: ["missing_init"],
      parsedLineCount: 3,
      eventTypes: "turn.started,item.completed,turn.completed",
      stdoutEmpty: false,
      exitCode: 0,
      signal: "none"
    });
    expectCodexOmitted(error, "missing_init", {
      parsedLines: 3,
      eventTypes: "turn.started,item.completed,turn.completed",
      secret
    });
  });

  it("names missing_terminal when the stream has thread.started but no turn.completed", async () => {
    const env = await environment();
    const runner = new FakeRunner(() => ({
      exitCode: 0,
      signal: null,
      stdout: [
        { type: "thread.started", thread_id: "codex-thread-missing-terminal" },
        { type: "turn.started" },
        { type: "item.completed", item: { id: "item-1", type: "agent_message", text: checkpointTurn() } }
      ].map((event) => JSON.stringify(event)).join("\n") + "\n",
      stderr: ""
    }));
    const error = await new CodexResumeCheckpointTransport({
      executable: "/opt/codex/codex",
      validatedCliVersion: "0.146.0",
      runner
    }).executeSegment({
      mode: "open",
      environment: env,
      model: "gpt-5.4",
      prompt: "{}",
      signal: new AbortController().signal
    }, ["vdt.echo"]).then(() => undefined, (value: unknown) => value);

    expect(error).toMatchObject({
      code: "CODEX_CHECKPOINT_PROTOCOL_INVALID",
      missingEvidence: ["missing_terminal"],
      parsedLineCount: 3,
      eventTypes: "thread.started,turn.started,item.completed",
      stdoutEmpty: false,
      exitCode: 0,
      signal: "none"
    });
    expectCodexOmitted(error, "missing_terminal", {
      parsedLines: 3,
      eventTypes: "thread.started,turn.started,item.completed"
    });
  });

  it("names empty_stdout when Codex exits 0 with no stream bytes", async () => {
    const env = await environment();
    const runner = new FakeRunner(() => ({
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: ""
    }));
    const error = await new CodexResumeCheckpointTransport({
      executable: "/opt/codex/codex",
      validatedCliVersion: "0.146.0",
      runner
    }).executeSegment({
      mode: "open",
      environment: env,
      model: "gpt-5.4",
      prompt: "{}",
      signal: new AbortController().signal
    }, ["vdt.echo"]).then(() => undefined, (value: unknown) => value);

    expect(error).toMatchObject({
      code: "CODEX_CHECKPOINT_PROTOCOL_INVALID",
      missingEvidence: ["empty_stdout"],
      parsedLineCount: 0,
      eventTypes: "<none>",
      stdoutEmpty: true,
      exitCode: 0,
      signal: "none"
    });
    expectCodexOmitted(error, "empty_stdout", {
      parsedLines: 0,
      eventTypes: "<none>",
      stdoutEmpty: true
    });
  });
});
