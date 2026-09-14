import { mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VDT_CHECKPOINT_TURN_PROTOCOL_VERSION } from "./persistent-cli-checkpoint-canaries";
import {
  ClaudeResumeCheckpointTransport,
  assertClaudeCheckpointArgumentsAllowed,
  type ClaudeResumeCheckpointEnvironment
} from "./claude-resume-checkpoint-transport";
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

function checkpointTurn(): Record<string, unknown> {
  return {
    protocolVersion: VDT_CHECKPOINT_TURN_PROTOCOL_VERSION,
    assistantMessage: { messageId: "message-1", text: "I will inspect the VDT graph." },
    action: {
      type: "action_batch",
      batch: {
        calls: [{ externalCallId: "call-1", toolName: "vdt.echo", args: { value: 1 } }]
      }
    }
  };
}

function claudeStream(cwd: string, sessionId: string, turn = checkpointTurn(), extra: readonly unknown[] = []): string {
  return [
    { type: "system", subtype: "init", cwd, session_id: sessionId },
    ...extra,
    {
      type: "result",
      subtype: "success",
      is_error: false,
      session_id: sessionId,
      structured_output: turn
    }
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

async function environment(): Promise<ClaudeResumeCheckpointEnvironment> {
  return {
    environmentId: "claude-private-env",
    privateWorkspacePath: await temporaryDirectory("vdt-claude-workspace-"),
    privateStatePath: await temporaryDirectory("vdt-claude-state-"),
    forbiddenRoots: [await temporaryDirectory("vdt-claude-forbidden-")]
  };
}

function expectClaudeOmitted(
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

describe("ClaudeResumeCheckpointTransport", () => {
  it("opens and resumes with tools disabled and stdin prompt", async () => {
    const env = await environment();
    const runner = new FakeRunner((request) => ({
      exitCode: 0,
      signal: null,
      stdout: claudeStream(request.cwd, "claude-session-1"),
      stderr: ""
    }));
    const transport = new ClaudeResumeCheckpointTransport({
      executable: "/opt/claude/claude",
      validatedCliVersion: "2.1.0",
      runner
    });
    const opened = await transport.executeSegment({
      mode: "open",
      environment: env,
      model: "claude-sonnet-4-6",
      prompt: '{"delta":"open"}',
      signal: new AbortController().signal
    }, ["vdt.echo"]);
    const resumed = await transport.executeSegment({
      mode: "resume",
      environment: env,
      model: "claude-sonnet-4-6",
      prompt: '{"delta":"resume"}',
      expectedSessionId: opened.sessionId,
      signal: new AbortController().signal
    }, ["vdt.echo"]);

    expect(opened.sessionId).toBe("claude-session-1");
    expect(resumed.sessionId).toBe("claude-session-1");
    expect(runner.requests[0]?.args).toEqual(expect.arrayContaining(["-p", "--tools", "", "--permission-mode", "dontAsk"]));
    expect(runner.requests[1]?.args).toEqual(expect.arrayContaining(["--resume", "claude-session-1"]));
  });

  it("rejects tool_use blocks as SECURITY_BOUNDARY_BREACH", async () => {
    const env = await environment();
    const runner = new FakeRunner((request) => ({
      exitCode: 0,
      signal: null,
      stdout: claudeStream(request.cwd, "claude-session-2", checkpointTurn(), [{
        type: "assistant",
        session_id: "claude-session-2",
        message: {
          content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: {} }]
        }
      }]),
      stderr: ""
    }));
    const transport = new ClaudeResumeCheckpointTransport({
      executable: "/opt/claude/claude",
      validatedCliVersion: "2.1.0",
      runner
    });
    await expect(transport.executeSegment({
      mode: "open",
      environment: env,
      model: "claude-sonnet-4-6",
      prompt: "{}",
      signal: new AbortController().signal
    }, ["vdt.echo"])).rejects.toMatchObject({ code: "SECURITY_BOUNDARY_BREACH" });
  });

  it("rejects cwd outside the private workspace", async () => {
    const env = await environment();
    const runner = new FakeRunner((request) => ({
      exitCode: 0,
      signal: null,
      stdout: claudeStream("/tmp/outside", "claude-session-3"),
      stderr: ""
    }));
    const transport = new ClaudeResumeCheckpointTransport({
      executable: "/opt/claude/claude",
      validatedCliVersion: "2.1.0",
      runner
    });
    await expect(transport.executeSegment({
      mode: "open",
      environment: env,
      model: "claude-sonnet-4-6",
      prompt: "{}",
      signal: new AbortController().signal
    }, ["vdt.echo"])).rejects.toMatchObject({ code: "SECURITY_BOUNDARY_BREACH" });
  });

  it("rejects session mismatch on resume", async () => {
    const env = await environment();
    const runner = new FakeRunner((request) => ({
      exitCode: 0,
      signal: null,
      stdout: claudeStream(request.cwd, "claude-session-other"),
      stderr: ""
    }));
    const transport = new ClaudeResumeCheckpointTransport({
      executable: "/opt/claude/claude",
      validatedCliVersion: "2.1.0",
      runner
    });
    await expect(transport.executeSegment({
      mode: "resume",
      environment: env,
      model: "claude-sonnet-4-6",
      prompt: "{}",
      expectedSessionId: "claude-session-resume",
      signal: new AbortController().signal
    }, ["vdt.echo"])).rejects.toMatchObject({ code: "CLAUDE_CHECKPOINT_SESSION_MISMATCH" });
  });

  it("uses an explicit trusted subscription auth home for credentials without exposing private state", async () => {
    const env = await environment();
    const authHome = await temporaryDirectory("vdt-claude-auth-home-");
    const runner = new FakeRunner((request) => ({
      exitCode: 0,
      signal: null,
      stdout: claudeStream(request.cwd, "claude-session-auth"),
      stderr: ""
    }));
    const transport = new ClaudeResumeCheckpointTransport({
      executable: "/opt/claude/claude",
      validatedCliVersion: "2.1.0",
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
      model: "claude-sonnet-4-6",
      prompt: '{"delta":"open"}',
      signal: new AbortController().signal
    }, ["vdt.echo"]);

    const canonicalAuthHome = await realpath(authHome);
    expect(runner.requests[0]?.environment).toEqual({
      HOME: canonicalAuthHome,
      USERPROFILE: canonicalAuthHome,
      CLAUDE_CONFIG_DIR: path.join(canonicalAuthHome, ".claude"),
      PATH: "/usr/bin:/bin",
      USER: "trusted-user",
      LOGNAME: "trusted-user"
    });
  });

  it("pins CLAUDE_CONFIG_DIR to the isolated state directory without auth home", async () => {
    const env = await environment();
    const runner = new FakeRunner((request) => ({
      exitCode: 0,
      signal: null,
      stdout: claudeStream(request.cwd, "claude-session-isolated"),
      stderr: ""
    }));
    const transport = new ClaudeResumeCheckpointTransport({
      executable: "/opt/claude/claude",
      validatedCliVersion: "2.1.0",
      runner
    });

    await transport.executeSegment({
      mode: "open",
      environment: env,
      model: "claude-sonnet-4-6",
      prompt: '{"delta":"open"}',
      signal: new AbortController().signal
    }, ["vdt.echo"]);

    const canonicalState = await realpath(env.privateStatePath);
    expect(runner.requests[0]?.environment).toEqual({
      HOME: canonicalState,
      USERPROFILE: canonicalState,
      CLAUDE_CONFIG_DIR: canonicalState
    });
  });

  it("rejects credential leaks in stdout", async () => {
    const env: ClaudeResumeCheckpointEnvironment = {
      ...(await environment()),
      credentialEnvironment: [{ name: "ANTHROPIC_API_KEY", value: "sk-ant-leak-test-key-0001" }]
    };
    const runner = new FakeRunner((request) => ({
      exitCode: 0,
      signal: null,
      stdout: `sk-ant-leak-test-key-0001\n${claudeStream(request.cwd, "claude-session-4")}`,
      stderr: ""
    }));
    const transport = new ClaudeResumeCheckpointTransport({
      executable: "/opt/claude/claude",
      validatedCliVersion: "2.1.0",
      runner
    });
    await expect(transport.executeSegment({
      mode: "open",
      environment: env,
      model: "claude-sonnet-4-6",
      prompt: "{}",
      signal: new AbortController().signal
    }, ["vdt.echo"])).rejects.toMatchObject({ code: "SECURITY_BOUNDARY_BREACH" });
  });

  it("rejects forbidden Claude arguments before spawn", () => {
    expect(() => assertClaudeCheckpointArgumentsAllowed([
      "-p",
      "--output-format",
      "stream-json",
      "--no-session-persistence"
    ])).toThrow(expect.objectContaining({ code: "SECURITY_BOUNDARY_BREACH" }));
    expect(() => assertClaudeCheckpointArgumentsAllowed([
      "-p",
      "--dangerously-skip-permissions"
    ])).toThrow(expect.objectContaining({ code: "SECURITY_BOUNDARY_BREACH" }));
    expect(() => assertClaudeCheckpointArgumentsAllowed([
      "-p",
      "--permission-mode",
      "dontAsk"
    ])).not.toThrow();
  });

  it("names missing_init when resume has a terminal result but no system init", async () => {
    const env = await environment();
    const secret = "DO_NOT_ECHO_MODEL_OUTPUT_9f3a";
    const turn = checkpointTurn();
    (turn.assistantMessage as { text: string }).text = secret;
    const runner = new FakeRunner(() => ({
      exitCode: 0,
      signal: null,
      stdout: JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        session_id: "claude-session-missing-init",
        structured_output: turn
      }) + "\n",
      stderr: ""
    }));
    const error = await new ClaudeResumeCheckpointTransport({
      executable: "/opt/claude/claude",
      validatedCliVersion: "2.1.0",
      runner
    }).executeSegment({
      mode: "resume",
      environment: env,
      model: "claude-sonnet-4-6",
      prompt: "{}",
      expectedSessionId: "claude-session-missing-init",
      signal: new AbortController().signal
    }, ["vdt.echo"]).then(() => undefined, (value: unknown) => value);

    expect(error).toMatchObject({
      code: "CLAUDE_CHECKPOINT_PROTOCOL_INVALID",
      missingEvidence: ["missing_init"],
      parsedLineCount: 1,
      eventTypes: "result.success",
      stdoutEmpty: false,
      exitCode: 0,
      signal: "none"
    });
    expectClaudeOmitted(error, "missing_init", { parsedLines: 1, eventTypes: "result.success", secret });
  });

  it("names missing_terminal when the stream has system init but no result event", async () => {
    const env = await environment();
    const runner = new FakeRunner((request) => ({
      exitCode: 0,
      signal: null,
      stdout: JSON.stringify({
        type: "system",
        subtype: "init",
        cwd: request.cwd,
        session_id: "claude-session-missing-terminal"
      }) + "\n",
      stderr: ""
    }));
    const error = await new ClaudeResumeCheckpointTransport({
      executable: "/opt/claude/claude",
      validatedCliVersion: "2.1.0",
      runner
    }).executeSegment({
      mode: "open",
      environment: env,
      model: "claude-sonnet-4-6",
      prompt: "{}",
      signal: new AbortController().signal
    }, ["vdt.echo"]).then(() => undefined, (value: unknown) => value);

    expect(error).toMatchObject({
      code: "CLAUDE_CHECKPOINT_PROTOCOL_INVALID",
      missingEvidence: ["missing_terminal"],
      parsedLineCount: 1,
      eventTypes: "system.init",
      stdoutEmpty: false,
      exitCode: 0,
      signal: "none"
    });
    expectClaudeOmitted(error, "missing_terminal", { parsedLines: 1, eventTypes: "system.init" });
  });

  it("names empty_stdout when Claude exits 0 with no stream bytes", async () => {
    const env = await environment();
    const runner = new FakeRunner(() => ({
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: ""
    }));
    const error = await new ClaudeResumeCheckpointTransport({
      executable: "/opt/claude/claude",
      validatedCliVersion: "2.1.0",
      runner
    }).executeSegment({
      mode: "open",
      environment: env,
      model: "claude-sonnet-4-6",
      prompt: "{}",
      signal: new AbortController().signal
    }, ["vdt.echo"]).then(() => undefined, (value: unknown) => value);

    expect(error).toMatchObject({
      code: "CLAUDE_CHECKPOINT_PROTOCOL_INVALID",
      missingEvidence: ["empty_stdout"],
      parsedLineCount: 0,
      eventTypes: "<none>",
      stdoutEmpty: true,
      exitCode: 0,
      signal: "none"
    });
    expectClaudeOmitted(error, "empty_stdout", { parsedLines: 0, eventTypes: "<none>", stdoutEmpty: true });
  });

  it("accepts a reported cwd that canonicalises onto the private workspace", async () => {
    const env = await environment();
    const runner = new FakeRunner(async (request) => {
      const alias = path.join(await temporaryDirectory("vdt-claude-cwd-alias-"), "workspace");
      await symlink(await realpath(request.cwd), alias, "dir");
      return {
        exitCode: 0,
        signal: null,
        stdout: claudeStream(alias, "claude-session-cwd-alias"),
        stderr: ""
      };
    });
    const transport = new ClaudeResumeCheckpointTransport({
      executable: "/opt/claude/claude",
      validatedCliVersion: "2.1.0",
      runner
    });
    await expect(transport.executeSegment({
      mode: "open",
      environment: env,
      model: "claude-sonnet-4-6",
      prompt: "{}",
      signal: new AbortController().signal
    }, ["vdt.echo"])).resolves.toMatchObject({ sessionId: "claude-session-cwd-alias" });
  });
});
