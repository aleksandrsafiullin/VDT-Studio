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
import {
  CursorResumeCheckpointEngine,
  cursorResumeCheckpointCapabilityHash
} from "./cursor-resume-checkpoint-engine";
import {
  CURSOR_CHECKPOINT_PROTOCOL_VERSION,
  CursorResumeCheckpointTransport,
  type CursorResumeCheckpointEnvironment,
  type CursorResumeProcessRequest,
  type CursorResumeProcessResult,
  type CursorResumeProcessRunner
} from "./cursor-resume-checkpoint-transport";

const SHA = `sha256:${"a".repeat(64)}`;
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

function turn(action: unknown, assistantMessage: unknown = null): string {
  return JSON.stringify({
    protocolVersion: CURSOR_CHECKPOINT_PROTOCOL_VERSION,
    assistantMessage,
    action
  });
}

function stream(request: CursorResumeProcessRequest, result: string, sessionId = "opaque-cursor-session"): string {
  return [
    {
      type: "system",
      subtype: "init",
      cwd: request.cwd,
      session_id: sessionId,
      permissionMode: "ask"
    },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      result,
      session_id: sessionId
    }
  ].map((event) => JSON.stringify(event)).join("\n") + "\n";
}

class ScriptedRunner implements CursorResumeProcessRunner {
  readonly requests: CursorResumeProcessRequest[] = [];
  readonly #steps: readonly ((request: CursorResumeProcessRequest, index: number) => string | Promise<string>)[];

  constructor(steps: readonly ((request: CursorResumeProcessRequest, index: number) => string | Promise<string>)[]) {
    this.#steps = steps;
  }

  async run(request: CursorResumeProcessRequest): Promise<CursorResumeProcessResult> {
    const index = this.requests.length;
    const copy = { ...request, args: [...request.args], environment: { ...request.environment } };
    this.requests.push(copy);
    const step = this.#steps[index];
    if (!step) throw new Error(`Unexpected Cursor process spawn ${index + 1}.`);
    return {
      exitCode: 0,
      signal: null,
      stdout: await step(copy, index),
      stderr: ""
    };
  }
}

async function createEnvironment(environmentId = "cursor-private-env"): Promise<CursorResumeCheckpointEnvironment> {
  return {
    environmentId,
    privateWorkspacePath: await temporaryDirectory("vdt-checkpoint-workspace-"),
    privateStatePath: await temporaryDirectory("vdt-checkpoint-state-"),
    forbiddenRoots: [await temporaryDirectory("vdt-checkpoint-forbidden-")]
  };
}

function bindingFor(engine: CursorResumeCheckpointEngine): AgentSessionBinding {
  return {
    schemaVersion: 2,
    bindingId: "binding-cursor-checkpoint",
    runId: "run-cursor-checkpoint",
    projectId: "project-1",
    executionProfile: "external_cli_agent",
    engineId: engine.capability.engineId,
    engineAdapterId: engine.capability.engineAdapterId,
    backendId: engine.capability.backendId,
    modelId: "gpt-5.5-high",
    protocolVersion: engine.capability.protocolVersion,
    cliVersion: engine.capability.cli.version,
    toolIsolation: "unverified",
    qualificationStatus: "unverified",
    capabilityEvidenceHash: null,
    settingsHash: SHA,
    capabilityProfileHash: cursorResumeCheckpointCapabilityHash(engine.capability),
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

function harness(input: {
  runner: ScriptedRunner;
  environment: CursorResumeCheckpointEnvironment;
  executed?: VdtGatewayToolCall[];
  executeTool?: (call: VdtGatewayToolCall) => Promise<VdtGatewayToolResult>;
  enable?: boolean;
}) {
  let resumeBinding: AgentSessionBinding | undefined;
  const transport = new CursorResumeCheckpointTransport({
    executable: "/opt/cursor/cursor-agent",
    validatedCliVersion: "2026.08.1",
    runner: input.runner
  });
  const engine = new CursorResumeCheckpointEngine({
    transport,
    cliVersion: "2026.08.1",
    toolCatalogHash: TOOL_CATALOG_HASH,
    allowedToolNames: ["vdt.echo", "vdt.inspect", "user.ask", "run.request_finish"],
    sessionEnvironmentFactory: () => input.environment,
    resolveBinding: () => {
      if (!resumeBinding) throw new Error("Resume binding is not available.");
      return resumeBinding;
    },
    enableUnverifiedCanary: input.enable ?? true,
    now: () => "2026-08-26T10:00:00.000Z",
    idFactory: () => "checkpoint-id"
  });
  const controller = new AbortController();
  const host: AgentEngineHost = {
    signal: controller.signal,
    executeTool: async (call) => {
      input.executed?.push(call);
      return input.executeTool ? input.executeTool(call) : gatewayResult(call);
    }
  };
  return {
    engine,
    host,
    setResumeBinding(binding: AgentSessionBinding) {
      resumeBinding = binding;
    }
  };
}

describe("CursorResumeCheckpointEngine", () => {
  it("terminates the logical session when a resumed ActionBatch attempts shell execution", async () => {
    const environment = await createEnvironment();
    const executed: VdtGatewayToolCall[] = [];
    const runner = new ScriptedRunner([
      (request) => stream(request, turn({
        type: "action_batch",
        batch: {
          calls: [{ externalCallId: "call-1", toolName: "vdt.echo", args: { value: 1 } }]
        }
      }, { messageId: "message-start", text: "I am starting through the VDT Gateway." })),
      (request) => stream(request, turn({
        type: "action_batch",
        batch: {
          calls: [{ externalCallId: "breach-1", toolName: "shell.exec", args: { command: "pwd" } }]
        }
      }))
    ]);
    const h = harness({ runner, environment, executed });
    const context = { brief: "security-boundary" };
    const session = await h.engine.openSession({
      binding: bindingFor(h.engine),
      initialContext: context,
      initialContextHash: hashText(JSON.stringify(context))
    }, h.host);

    const events = await collect(session.events());

    expect(executed.map((entry) => entry.toolName)).toEqual(["vdt.echo"]);
    expect(events.at(-1)).toMatchObject({
      type: "transport_error",
      code: "SECURITY_BOUNDARY_BREACH",
      retryable: false
    });
    expect(runner.requests).toHaveLength(2);
    await expect(session.submit({
      type: "user_instruction",
      text: "Continue."
    })).rejects.toMatchObject({ code: "CURSOR_CHECKPOINT_SESSION_TERMINAL" });
  });

  it("executes ActionBatch sequentially and resumes one opaque session only at checkpoints", async () => {
    const environment = await createEnvironment();
    const executed: VdtGatewayToolCall[] = [];
    const runner = new ScriptedRunner([
      (request) => stream(request, turn({
        type: "action_batch",
        batch: {
          calls: [
            { externalCallId: "call-1", toolName: "vdt.echo", args: { value: 1 } },
            { externalCallId: "call-2", toolName: "vdt.inspect", args: { nodeId: "root" } },
            { externalCallId: "call-3", toolName: "vdt.echo", args: { value: 2 } }
          ]
        }
      }, { messageId: "message-start", text: "I am building the VDT in this session." })),
      (request) => {
        expect(executed.map((call) => call.externalCallId)).toEqual(["call-1", "call-2", "call-3"]);
        return stream(request, turn({
          type: "action_batch",
          batch: {
            calls: [{ externalCallId: "finish-1", toolName: "run.request_finish", args: {} }]
          }
        }));
      },
      (request) => stream(request, turn({
        type: "final",
        messageId: "message-final",
        finishReceiptId: "finish-receipt-1",
        text: "The VDT is complete and verified."
      }))
    ]);
    const h = harness({
      runner,
      environment,
      executed,
      executeTool: async (call) => call.toolName === "run.request_finish"
        ? gatewayResult(call, {
            payload: {
              receiptId: "finish-receipt-1",
              receiptHash: hashText("finish-receipt-1")
            }
          })
        : gatewayResult(call)
    });
    const context = { brief: "exact-fixture" };
    const opened = await h.engine.openSession({
      binding: bindingFor(h.engine),
      initialContext: context,
      initialContextHash: hashText(JSON.stringify(context))
    }, h.host);
    h.setResumeBinding(opened.binding);
    const events = await collect(opened.events());

    expect(executed.map((call) => call.externalCallId)).toEqual(["call-1", "call-2", "call-3", "finish-1"]);
    expect(runner.requests).toHaveLength(3);
    expect(runner.requests.slice(1).every((request) => {
      const index = request.args.indexOf("--resume");
      return index >= 0 && request.args[index + 1] === "opaque-cursor-session";
    })).toBe(true);
    expect(runner.requests[0]?.stdin).toContain("exact-fixture");
    expect(runner.requests[1]?.stdin).not.toContain("exact-fixture");
    expect(runner.requests[1]?.stdin).toContain("call-3");
    expect(events).toContainEqual({
      type: "final",
      messageId: "message-final",
      finishReceiptId: "finish-receipt-1",
      text: "The VDT is complete and verified."
    });
    expect(opened.binding.externalSessionId).toBe("opaque-cursor-session");
  });

  it("checkpoints a user.ask pause and resumes the same session after submit", async () => {
    const environment = await createEnvironment();
    const runner = new ScriptedRunner([
      (request) => stream(request, turn({
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
      }, { messageId: "message-question", text: "I need one value before continuing." })),
      (request) => stream(request, turn({
        type: "action_batch",
        batch: { calls: [{ externalCallId: "finish-2", toolName: "run.request_finish", args: {} }] }
      })),
      (request) => stream(request, turn({
        type: "final",
        messageId: "message-final-2",
        finishReceiptId: "finish-receipt-2",
        text: "The answered run is complete."
      }))
    ]);
    const h = harness({
      runner,
      environment,
      executeTool: async (call) => call.toolName === "user.ask"
        ? gatewayResult(call, { status: "waiting_user", resultCode: "QUESTION_REQUIRED" })
        : gatewayResult(call, {
            payload: {
              receiptId: "finish-receipt-2",
              receiptHash: hashText("finish-receipt-2")
            }
          })
    });
    const context = { brief: "question-fixture" };
    const opened = await h.engine.openSession({
      binding: bindingFor(h.engine),
      initialContext: context,
      initialContextHash: hashText(JSON.stringify(context))
    }, h.host);
    h.setResumeBinding(opened.binding);
    const pausedEvents = await collect(opened.events());
    expect(pausedEvents.map((event) => event.type)).toEqual([
      "assistant_message",
      "checkpoint_requested",
      "question"
    ]);
    const checkpoint = await opened.checkpoint();
    expect(checkpoint.externalSessionId).toBe("opaque-cursor-session");

    await opened.submit({
      type: "user_answer",
      questionSetId: "cursor-question-question-1",
      answers: { "fleet-size": 36 }
    });
    const completedEvents = await collect(opened.events());
    expect(completedEvents.at(-1)).toMatchObject({ type: "final", finishReceiptId: "finish-receipt-2" });
    expect(runner.requests[1]?.args).toEqual(expect.arrayContaining(["--resume", "opaque-cursor-session"]));
    expect(runner.requests[1]?.stdin).toContain("fleet-size");
    expect(runner.requests[1]?.stdin).toContain("36");
  });

  it("is default-off and keeps capability isolation explicitly unverified", async () => {
    const environment = await createEnvironment();
    const runner = new ScriptedRunner([]);
    const h = harness({ runner, environment, enable: false });
    expect(h.engine.capability).toMatchObject({
      sessionStrategy: "checkpoint_resume",
      toolIsolation: "unverified",
      qualification: { status: "unverified", evidenceHash: null }
    });
    const context = { brief: "blocked" };
    await expect(h.engine.openSession({
      binding: bindingFor(h.engine),
      initialContext: context,
      initialContextHash: hashText(JSON.stringify(context))
    }, h.host)).rejects.toMatchObject({ code: "EXTERNAL_ENGINE_NOT_QUALIFIED" });
    expect(runner.requests).toHaveLength(0);
  });

  it("rejects crash recovery when the private environment identity changes", async () => {
    const original = await createEnvironment("original-private-environment");
    const changed = await createEnvironment("changed-private-environment");
    const runner = new ScriptedRunner([
      (request) => stream(request, turn({
        type: "action_batch",
        batch: {
          calls: [{
            externalCallId: "question-recovery",
            toolName: "user.ask",
            args: {
              questions: [{
                id: "confirm",
                question: "Continue?",
                reason: "A checkpoint is required.",
                required: true,
                answerKind: "single_choice",
                options: ["yes", "no"]
              }]
            }
          }]
        }
      }, { messageId: "message-recovery", text: "I need confirmation." }))
    ]);
    let resolvedBinding: AgentSessionBinding | undefined;
    let recovery = false;
    const transport = new CursorResumeCheckpointTransport({
      executable: "/opt/cursor/cursor-agent",
      validatedCliVersion: "2026.08.1",
      runner
    });
    const engine = new CursorResumeCheckpointEngine({
      transport,
      cliVersion: "2026.08.1",
      toolCatalogHash: TOOL_CATALOG_HASH,
      allowedToolNames: ["user.ask"],
      sessionEnvironmentFactory: () => recovery ? changed : original,
      resolveBinding: () => resolvedBinding!,
      enableUnverifiedCanary: true,
      now: () => "2026-08-26T10:00:00.000Z",
      idFactory: () => "checkpoint-id"
    });
    const host: AgentEngineHost = {
      signal: new AbortController().signal,
      executeTool: async (call) => gatewayResult(call, { status: "waiting_user", resultCode: "QUESTION_REQUIRED" })
    };
    const context = { brief: "recovery" };
    const opened = await engine.openSession({
      binding: bindingFor(engine),
      initialContext: context,
      initialContextHash: hashText(JSON.stringify(context))
    }, host);
    resolvedBinding = opened.binding;
    await collect(opened.events());
    const checkpoint = await opened.checkpoint();
    recovery = true;

    await expect(engine.resumeSession(checkpoint, host))
      .rejects.toMatchObject({ code: "CURSOR_CHECKPOINT_ENVIRONMENT_MISMATCH" });
  });
});
