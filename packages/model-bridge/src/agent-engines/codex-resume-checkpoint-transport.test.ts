import { mkdtemp, rm } from "node:fs/promises";
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

function codexStream(sessionId: string, turn = checkpointTurn(), extra: readonly unknown[] = []): string {
  return [
    { type: "thread.started", thread_id: sessionId },
    { type: "turn.started" },
    ...extra,
    { type: "item.completed", item: { id: "item-1", type: "agent_message", text: turn } },
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
    expect(runner.requests[0]?.args).toEqual(expect.arrayContaining([
      "exec", "--json", "--color", "never", "--skip-git-repo-check", "--ignore-user-config",
      "--sandbox", "read-only", "-C", runner.requests[0]!.cwd, "-"
    ]));
    expect(runner.requests[1]?.args.slice(0, 3)).toEqual(["exec", "resume", "--json"]);
    expect(runner.requests[1]?.args).toEqual(expect.arrayContaining(["codex-thread-1", "-"]));
    expect(runner.requests[0]?.args).not.toEqual(expect.arrayContaining(["--ephemeral", "--yolo"]));
  });

  it("rejects forbidden Codex tool events as SECURITY_BOUNDARY_BREACH", async () => {
    const env = await environment();
    const runner = new FakeRunner(() => ({
      exitCode: 0,
      signal: null,
      stdout: codexStream("codex-thread-2", checkpointTurn(), [
        { type: "item.completed", item: { id: "bad", type: "web_search" } }
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
});
