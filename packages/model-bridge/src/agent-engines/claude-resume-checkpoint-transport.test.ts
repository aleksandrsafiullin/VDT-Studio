import { mkdtemp, rm } from "node:fs/promises";
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
});
