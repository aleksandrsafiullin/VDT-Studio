import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  AgentEngineEvent,
  AgentEngineHost,
  AgentSessionBinding,
  VdtGatewayToolCall,
  VdtGatewayToolResult
} from "@vdt-studio/vdt-agent-runtime";
import { afterEach, describe, expect, it } from "vitest";
import { VDT_CHECKPOINT_TURN_PROTOCOL_VERSION } from "./persistent-cli-checkpoint-canaries";
import {
  ClaudeResumeCheckpointEngine,
  claudeResumeCheckpointCapabilityHash
} from "./claude-resume-checkpoint-engine";
import {
  ClaudeResumeCheckpointTransport,
  type ClaudeResumeCheckpointEnvironment
} from "./claude-resume-checkpoint-transport";
import type { CheckpointProcessRequest, CheckpointProcessResult, CheckpointProcessRunner } from "./checkpoint-transport-common";

const TOOL_CATALOG_HASH = `sha256:${"b".repeat(64)}`;
const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function hashText(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function turn(action: unknown, assistantMessage: unknown = null): Record<string, unknown> {
  return {
    protocolVersion: VDT_CHECKPOINT_TURN_PROTOCOL_VERSION,
    assistantMessage,
    action
  };
}

function claudeStream(cwd: string, sessionId: string, turn: Record<string, unknown>): string {
  return [
    { type: "system", subtype: "init", cwd, session_id: sessionId },
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

class EmptyRunner implements CheckpointProcessRunner {
  run(): Promise<CheckpointProcessResult> {
    return Promise.resolve({ exitCode: 0, signal: null, stdout: "", stderr: "" });
  }
}

async function environment(): Promise<ClaudeResumeCheckpointEnvironment> {
  return {
    environmentId: "claude-env",
    privateWorkspacePath: await temporaryDirectory("vdt-claude-engine-workspace-"),
    privateStatePath: await temporaryDirectory("vdt-claude-engine-state-"),
    forbiddenRoots: [await temporaryDirectory("vdt-claude-engine-forbidden-")]
  };
}

function bindingFor(engine: ClaudeResumeCheckpointEngine): AgentSessionBinding {
  return {
    schemaVersion: 2,
    bindingId: "binding-claude",
    runId: "run-1",
    projectId: "project-1",
    executionProfile: "external_cli_agent",
    engineId: engine.capability.engineId,
    engineAdapterId: engine.capability.engineAdapterId,
    backendId: engine.capability.backendId,
    modelId: "claude-sonnet-4-6",
    protocolVersion: engine.capability.protocolVersion,
    cliVersion: engine.capability.cli.version,
    toolIsolation: "unverified",
    qualificationStatus: "unverified",
    capabilityEvidenceHash: null,
    settingsHash: TOOL_CATALOG_HASH,
    capabilityProfileHash: claudeResumeCheckpointCapabilityHash(engine.capability),
    toolCatalogHash: TOOL_CATALOG_HASH,
    externalSessionId: null,
    sessionEpoch: 1,
    boundAt: "2026-08-26T10:00:00.000Z"
  };
}

function gatewayResult(call: VdtGatewayToolCall, input: Partial<VdtGatewayToolResult> = {}): VdtGatewayToolResult {
  return {
    externalCallId: call.externalCallId,
    toolName: call.toolName,
    status: "succeeded",
    resultCode: "OK",
    resultHash: hashText(`${call.externalCallId}:${call.toolName}`),
    payload: { ok: true },
    ...input
  };
}

async function collect(events: AsyncIterable<AgentEngineEvent>): Promise<AgentEngineEvent[]> {
  const output: AgentEngineEvent[] = [];
  for await (const event of events) output.push(event);
  return output;
}

describe("ClaudeResumeCheckpointEngine", () => {
  it("exposes claude_subscription capability and is default-off", async () => {
    const env = await environment();
    const engine = new ClaudeResumeCheckpointEngine({
      transport: new ClaudeResumeCheckpointTransport({
        executable: "/opt/claude/claude",
        validatedCliVersion: "2.1.0",
        runner: new EmptyRunner()
      }),
      cliVersion: "2.1.0",
      toolCatalogHash: TOOL_CATALOG_HASH,
      allowedToolNames: ["vdt.echo"],
      sessionEnvironmentFactory: () => env,
      resolveBinding: async () => { throw new Error("unused"); }
    });
    expect(engine.capability).toMatchObject({
      backendId: "claude_subscription",
      engineAdapterId: "claude-resume-checkpoint-v1",
      toolIsolation: "unverified",
      qualification: { status: "unverified" }
    });
    await expect(engine.openSession({
      binding: bindingFor(engine),
      initialContext: { brief: "blocked" },
      initialContextHash: TOOL_CATALOG_HASH
    }, { signal: new AbortController().signal, executeTool: async () => ({}) as never }))
      .rejects.toMatchObject({ code: "EXTERNAL_ENGINE_NOT_QUALIFIED" });
  });

  it("opens an unverified canary session, executes a batch, and pauses on user.ask", async () => {
    const env = await environment();
    const executed: VdtGatewayToolCall[] = [];
    const runner = new FakeRunner((request, index) => ({
      exitCode: 0,
      signal: null,
      stdout: claudeStream(
        request.cwd,
        "claude-session-open",
        turn(
          index === 0
            ? {
                type: "action_batch",
                batch: {
                  calls: [{ externalCallId: "call-echo", toolName: "vdt.echo", args: { value: 1 } }]
                }
              }
            : {
                type: "action_batch",
                batch: {
                  calls: [{
                    externalCallId: "question-1",
                    toolName: "user.ask",
                    args: {
                      questions: [{
                        id: "fleet-size",
                        question: "How many trucks should be modeled?",
                        reason: "The fleet size is required for the branch.",
                        required: true,
                        answerKind: "number"
                      }]
                    }
                  }]
                }
              },
          index === 0 ? { messageId: "message-open", text: "I will inspect the VDT graph." } : null
        )
      ),
      stderr: ""
    }));
    const engine = new ClaudeResumeCheckpointEngine({
      transport: new ClaudeResumeCheckpointTransport({
        executable: "/opt/claude/claude",
        validatedCliVersion: "2.1.0",
        runner
      }),
      cliVersion: "2.1.0",
      toolCatalogHash: TOOL_CATALOG_HASH,
      allowedToolNames: ["vdt.echo", "user.ask"],
      sessionEnvironmentFactory: () => env,
      resolveBinding: async () => { throw new Error("unused"); },
      enableUnverifiedCanary: true,
      now: () => "2026-08-26T10:00:00.000Z",
      idFactory: () => "checkpoint-id"
    });
    const host: AgentEngineHost = {
      signal: new AbortController().signal,
      executeTool: async (call) => {
        executed.push(call);
        return call.toolName === "user.ask"
          ? gatewayResult(call, { status: "waiting_user", resultCode: "QUESTION_REQUIRED" })
          : gatewayResult(call);
      }
    };
    const context = { brief: "claude-open-fixture" };
    const session = await engine.openSession({
      binding: bindingFor(engine),
      initialContext: context,
      initialContextHash: hashText(JSON.stringify(context))
    }, host);
    const events = await collect(session.events());

    expect(executed.map((call) => call.toolName)).toEqual(["vdt.echo", "user.ask"]);
    expect(runner.requests).toHaveLength(2);
    expect(events.map((event) => event.type)).toEqual([
      "assistant_message",
      "checkpoint_requested",
      "checkpoint_requested",
      "question"
    ]);
    expect(events[0]).toMatchObject({
      type: "assistant_message",
      text: "I will inspect the VDT graph."
    });
    expect(session.binding.externalSessionId).toBe("claude-session-open");
  });

  it("ends a mixed run.request_finish first turn in a diagnosable transport_error", async () => {
    const env = await environment();
    const runner = new FakeRunner((request) => ({
      exitCode: 0,
      signal: null,
      stdout: claudeStream(
        request.cwd,
        "claude-session-mixed",
        turn({
          type: "action_batch",
          batch: {
            calls: [
              { externalCallId: "echo-1", toolName: "vdt.echo", args: { value: 1 } },
              { externalCallId: "finish-1", toolName: "run.request_finish", args: {} }
            ]
          }
        }, { messageId: "message-open", text: "I will inspect the VDT graph." })
      ),
      stderr: ""
    }));
    const engine = new ClaudeResumeCheckpointEngine({
      transport: new ClaudeResumeCheckpointTransport({
        executable: "/opt/claude/claude",
        validatedCliVersion: "2.1.0",
        runner
      }),
      cliVersion: "2.1.0",
      toolCatalogHash: TOOL_CATALOG_HASH,
      allowedToolNames: ["vdt.echo", "run.request_finish"],
      sessionEnvironmentFactory: () => env,
      resolveBinding: async () => { throw new Error("unused"); },
      enableUnverifiedCanary: true
    });
    const session = await engine.openSession({
      binding: bindingFor(engine),
      initialContext: { brief: "mixed-open" },
      initialContextHash: hashText(JSON.stringify({ brief: "mixed-open" }))
    }, {
      signal: new AbortController().signal,
      executeTool: async () => {
        throw new Error("executeTool must not run on a mixed first turn.");
      }
    });
    const events = await collect(session.events());
    expect(session.binding.externalSessionId).toBe("claude-session-mixed");
    expect(events).toEqual([{
      type: "transport_error",
      code: "ACTION_BATCH_CONTROL_TOOL_MIXED",
      message: "run.request_finish must be the only call in an action batch.",
      retryable: true
    }]);
  });
});
