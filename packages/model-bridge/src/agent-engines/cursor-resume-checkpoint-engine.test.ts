import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AGENT_FINISH_MISSING_VALUE_PROMPT_RULE,
  AGENT_QUESTION_PROMPT_RULE,
  AGENT_QUESTION_WRITEBACK_PROMPT_RULE,
  AGENT_RESEARCH_UNCONFIGURED_PROMPT_RULE,
  CHECKPOINT_ACTION_BATCH_CONTRACT_PROMPT_RULE,
  CHECKPOINT_ACTION_TYPE_PROMPT_RULE,
  CHECKPOINT_FINISH_ORDER_PROMPT_RULE,
  CHECKPOINT_RESPONSE_ENVELOPE_PROMPT_RULE,
  type AgentEngineEvent,
  type AgentEngineHost,
  type AgentSessionBinding,
  type VdtGatewayToolCall,
  type VdtGatewayToolResult
} from "@vdt-studio/vdt-agent-runtime";
import { afterEach, describe, expect, it } from "vitest";
import {
  CursorResumeCheckpointEngine,
  buildCursorResumeCheckpointInitialPrompt,
  createCursorResumeCheckpointSessionMissingPendingDeltaForTests,
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
    allowedToolNames: ["vdt.echo", "vdt.inspect", "user.ask", "approval.request", "run.request_finish"],
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

describe("buildCursorResumeCheckpointInitialPrompt", () => {
  it("embeds the shared writeback and finish constants", () => {
    const prompt = buildCursorResumeCheckpointInitialPrompt({
      binding: {
        schemaVersion: 2,
        bindingId: "binding-cursor-checkpoint",
        runId: "run-cursor-checkpoint",
        projectId: "project-1",
        executionProfile: "external_cli_agent",
        engineId: "cursor-resume-checkpoint",
        engineAdapterId: "cursor-resume-checkpoint-v1",
        backendId: "cursor_cli",
        modelId: "gpt-5.5-high",
        protocolVersion: CURSOR_CHECKPOINT_PROTOCOL_VERSION,
        cliVersion: "2026.08.1",
        toolIsolation: "unverified",
        qualificationStatus: "unverified",
        capabilityEvidenceHash: null,
        settingsHash: SHA,
        capabilityProfileHash: SHA,
        toolCatalogHash: TOOL_CATALOG_HASH,
        externalSessionId: "opaque-cursor-session",
        sessionEpoch: 1,
        boundAt: "2026-08-26T10:00:00.000Z"
      },
      initialContext: { brief: "prompt-coverage" },
      initialContextHash: hashText(JSON.stringify({ brief: "prompt-coverage" }))
    }, ["vdt.echo", "user.ask", "run.request_finish"]);
    const parsed = JSON.parse(prompt) as {
      constraints: {
        questions: string;
        finishMissingValues: string;
        final: string;
        actionBatch: string;
        actionTypes: string;
      };
    };
    expect(parsed.constraints.questions).toBe(AGENT_QUESTION_PROMPT_RULE);
    expect(parsed.constraints.questions).toContain(AGENT_QUESTION_WRITEBACK_PROMPT_RULE);
    expect(parsed.constraints.finishMissingValues).toBe(AGENT_FINISH_MISSING_VALUE_PROMPT_RULE);
    expect(parsed.constraints.actionTypes).toBe(CHECKPOINT_ACTION_TYPE_PROMPT_RULE);
    expect(parsed.constraints.actionBatch).toBe(CHECKPOINT_ACTION_BATCH_CONTRACT_PROMPT_RULE);
    expect(parsed.constraints.actionTypes).toContain(CHECKPOINT_ACTION_BATCH_CONTRACT_PROMPT_RULE);
    expect(parsed.constraints.actionTypes).toContain(CHECKPOINT_FINISH_ORDER_PROMPT_RULE);
    expect(parsed.constraints.final).toContain(CHECKPOINT_FINISH_ORDER_PROMPT_RULE);
    expect(parsed.constraints.final).toContain(AGENT_FINISH_MISSING_VALUE_PROMPT_RULE);
    expect(parsed.constraints.final).not.toMatch(/request_finish first/i);
  });
});

describe("CursorResumeCheckpointEngine", () => {
  it("emits a recoverable transport_error when the pending exchange delta is missing", async () => {
    const environment = await createEnvironment();
    const transport = new CursorResumeCheckpointTransport({
      executable: "/opt/cursor/cursor-agent",
      validatedCliVersion: "2026.08.1",
      runner: new ScriptedRunner([])
    });
    const session = createCursorResumeCheckpointSessionMissingPendingDeltaForTests({
      binding: {
        schemaVersion: 2,
        bindingId: "binding-cursor-checkpoint",
        runId: "run-cursor-checkpoint",
        projectId: "project-1",
        executionProfile: "external_cli_agent",
        engineId: "cursor-resume-checkpoint",
        engineAdapterId: "cursor-resume-checkpoint-v1",
        backendId: "cursor_cli",
        modelId: "gpt-5.5-high",
        protocolVersion: CURSOR_CHECKPOINT_PROTOCOL_VERSION,
        cliVersion: "2026.08.1",
        toolIsolation: "unverified",
        qualificationStatus: "unverified",
        capabilityEvidenceHash: null,
        settingsHash: SHA,
        capabilityProfileHash: SHA,
        toolCatalogHash: TOOL_CATALOG_HASH,
        externalSessionId: "opaque-cursor-session",
        sessionEpoch: 1,
        boundAt: "2026-08-26T10:00:00.000Z"
      },
      transport,
      environment,
      host: {
        signal: new AbortController().signal,
        executeTool: async () => {
          throw new Error("executeTool must not run when the pending delta is missing.");
        }
      }
    });

    const events = await collect(session.events());
    expect(events).toEqual([{
      type: "transport_error",
      code: "CURSOR_CHECKPOINT_PENDING_DELTA_MISSING",
      message: "Cursor checkpoint session lost its pending exchange delta. Recover this run from the last durable checkpoint.",
      retryable: true
    }]);
  });
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
    expect(events.filter((event) => event.type === "transport_note")).toHaveLength(0);
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
    const telemetry = (opened as unknown as { snapshotPerformanceTelemetry: () => {
      segmentCount: number;
      processSpawnCount: number;
      logicalSessionCount: number;
      resumeCount: number;
      toolCallCount: number;
    } }).snapshotPerformanceTelemetry();
    expect(telemetry.segmentCount).toBe(3);
    expect(telemetry.processSpawnCount).toBe(runner.requests.length);
    expect(telemetry.logicalSessionCount).toBe(1);
    expect(telemetry.resumeCount).toBe(2);
    expect(telemetry.toolCallCount).toBe(4);
    expect(JSON.stringify(telemetry)).not.toContain("opaque-cursor-session");
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

  it("normalizes non-plain gateway error details before the next Cursor resume", async () => {
    const environment = await createEnvironment();
    const runner = new ScriptedRunner([
      (request) => stream(request, turn({
        type: "action_batch",
        calls: [{ externalCallId: "call-invalid", toolName: "vdt.echo", args: { value: 1 } }]
      }, "I will validate this call.")),
      (request) => stream(request, turn({
        type: "final",
        finishReceiptId: "missing-finish-receipt"
      }, "The run cannot actually finish without its receipt."))
    ]);
    const h = harness({
      runner,
      environment,
      executeTool: async (call) => gatewayResult(call, {
        status: "failed",
        resultCode: "INVALID_TOOL_ARGS",
        payload: {
          error: {
            code: "INVALID_TOOL_ARGS",
            message: "Invalid tool arguments.",
            details: [{ unionErrors: [new Error("branch one"), new Error("branch two")] }]
          }
        }
      })
    });
    const context = { brief: "wire-normalization" };
    const opened = await h.engine.openSession({
      binding: bindingFor(h.engine),
      initialContext: context,
      initialContextHash: hashText(JSON.stringify(context))
    }, h.host);

    const events = await collect(opened.events());

    expect(runner.requests).toHaveLength(2);
    expect(runner.requests[1]?.stdin).toContain("INVALID_TOOL_ARGS");
    expect(runner.requests[1]?.stdin).toContain(CHECKPOINT_RESPONSE_ENVELOPE_PROMPT_RULE);
    expect(runner.requests[1]?.stdin).toContain(CHECKPOINT_ACTION_TYPE_PROMPT_RULE);
    expect(runner.requests[1]?.stdin).toContain(CHECKPOINT_ACTION_BATCH_CONTRACT_PROMPT_RULE);
    expect(runner.requests[1]?.stdin).toContain(CHECKPOINT_FINISH_ORDER_PROMPT_RULE);
    expect(runner.requests[1]?.stdin).toContain(AGENT_RESEARCH_UNCONFIGURED_PROMPT_RULE);
    expect(runner.requests[1]?.stdin).toContain("assistantMessage only");
    expect(runner.requests[1]?.stdin).not.toContain("or stated assumptions");
    expect(events.at(-1)).toMatchObject({
      type: "transport_error",
      code: "CURSOR_CHECKPOINT_FINAL_WITHOUT_RECEIPT"
    });
    expect(events.map((event) => event.type === "transport_error" && event.code))
      .not.toContain("CURSOR_CHECKPOINT_JSON_INVALID");
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

  it("retries one malformed user.ask and continues after a corrected set", async () => {
    const environment = await createEnvironment();
    const runner = new ScriptedRunner([
      (request) => stream(request, turn({
        type: "action_batch",
        batch: {
          calls: [{
            externalCallId: "question-bad",
            toolName: "user.ask",
            args: {
              questions: [{
                id: "missing-reason",
                question: "What scope?",
                required: true
              }]
            }
          }]
        }
      }, { messageId: "message-bad", text: "I need one value before continuing." })),
      (request) => stream(request, turn({
        type: "action_batch",
        batch: {
          calls: [{
            externalCallId: "question-good",
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
      }))
    ]);
    const h = harness({
      runner,
      environment,
      executeTool: async (call) => gatewayResult(call, { status: "waiting_user", resultCode: "QUESTION_REQUIRED" })
    });
    const context = { brief: "question-payload-retry" };
    const session = await h.engine.openSession({
      binding: bindingFor(h.engine),
      initialContext: context,
      initialContextHash: hashText(JSON.stringify(context))
    }, h.host);
    const events = await collect(session.events());

    expect(runner.requests).toHaveLength(2);
    expect(runner.requests[1]?.stdin).toContain("QUESTION_SCHEMA_INVALID");
    expect(runner.requests[1]?.stdin).toContain("0.reason");
    expect(events.map((event) => event.type)).toEqual([
      "assistant_message",
      "transport_note",
      "checkpoint_requested",
      "checkpoint_requested",
      "question"
    ]);
    expect(events.find((event) => event.type === "transport_note")).toMatchObject({
      code: "CURSOR_CHECKPOINT_QUESTION_PAYLOAD_RETRY"
    });
    expect(events.at(-1)).toMatchObject({
      type: "question",
      questionSetId: "cursor-question-question-good"
    });
  });

  it("terminates on a second consecutive malformed set with the second diagnostic", async () => {
    const environment = await createEnvironment();
    const runner = new ScriptedRunner([
      (request) => stream(request, turn({
        type: "action_batch",
        batch: {
          calls: [{
            externalCallId: "question-bad-1",
            toolName: "user.ask",
            args: {
              questions: [{
                id: "missing-reason",
                question: "What scope?",
                required: true
              }]
            }
          }]
        }
      }, { messageId: "message-bad", text: "I need one value before continuing." })),
      (request) => stream(request, turn({
        type: "action_batch",
        batch: {
          calls: [{
            externalCallId: "question-bad-2",
            toolName: "user.ask",
            args: {
              questions: [{
                id: "bad-type",
                question: "Pick one?",
                reason: "Enum is invalid.",
                required: true,
                expectedAnswerType: "bogus"
              }]
            }
          }]
        }
      })),
      (request) => {
        throw new Error("A third question payload must not be requested.");
      }
    ]);
    const h = harness({
      runner,
      environment,
      executeTool: async (call) => gatewayResult(call, { status: "waiting_user", resultCode: "QUESTION_REQUIRED" })
    });
    const context = { brief: "question-payload-retry-terminal" };
    const session = await h.engine.openSession({
      binding: bindingFor(h.engine),
      initialContext: context,
      initialContextHash: hashText(JSON.stringify(context))
    }, h.host);
    const events = await collect(session.events());

    expect(runner.requests).toHaveLength(2);
    expect(events.filter((event) => event.type === "transport_note")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      type: "transport_error",
      code: "CURSOR_CHECKPOINT_QUESTION_INVALID",
      retryable: false
    });
    const terminal = events.at(-1);
    if (terminal?.type !== "transport_error") throw new Error("expected transport_error");
    expect(terminal.message).toContain("user.ask did not contain a valid VDT question checkpoint:");
    expect(terminal.message).toContain("expectedAnswerType");
    expect(terminal.message).not.toContain("0.reason");
  });
});

describe("CursorResumeCheckpointEngine.open contract violations", () => {
  const mixedTools = [
    ["run.request_finish", "run.request_finish must be the only call in an action batch."],
    ["user.ask", "user.ask must be the only call in an action batch."],
    ["approval.request", "approval.request must be the only call in an action batch."]
  ] as const;

  function mixedControlArgs(toolName: string): Record<string, unknown> {
    if (toolName !== "user.ask") return {};
    return {
      questions: [{
        id: "fleet-size",
        question: "How many trucks should be modeled?",
        reason: "The fleet size is required for the branch.",
        required: true,
        answerKind: "number"
      }]
    };
  }

  function mixedControlAction(toolName: string) {
    return {
      type: "action_batch",
      batch: {
        calls: [
          { externalCallId: "echo-1", toolName: "vdt.echo", args: { value: 1 } },
          { externalCallId: "control-1", toolName, args: mixedControlArgs(toolName) }
        ]
      }
    };
  }

  for (const [toolName, message] of mixedTools) {
    it(`ends a mixed ${toolName} first turn in a diagnosable transport_error`, async () => {
      const environment = await createEnvironment();
      const runner = new ScriptedRunner([
        (request) => stream(request, turn(
          mixedControlAction(toolName),
          { messageId: "message-open", text: "I will inspect the VDT graph." }
        ), "opaque-cursor-mixed")
      ]);
      const h = harness({
        runner,
        environment,
        executeTool: async () => {
          throw new Error("executeTool must not run on a mixed first turn.");
        }
      });
      const context = { brief: "mixed-open" };
      const session = await h.engine.openSession({
        binding: bindingFor(h.engine),
        initialContext: context,
        initialContextHash: hashText(JSON.stringify(context))
      }, h.host);
      const events = await collect(session.events());
      expect(session.binding.externalSessionId).toBe("opaque-cursor-mixed");
      expect(runner.requests[0]?.stdin).toContain(CHECKPOINT_ACTION_BATCH_CONTRACT_PROMPT_RULE);
      expect(runner.requests[0]?.stdin).toContain(CHECKPOINT_FINISH_ORDER_PROMPT_RULE);
      expect(events).toEqual([{
        type: "transport_error",
        code: "ACTION_BATCH_CONTROL_TOOL_MIXED",
        message,
        retryable: true
      }]);
    });
  }

  it("still fails loudly for a genuine internal error during open", async () => {
    const environment = await createEnvironment();
    const runner = new ScriptedRunner([
      () => {
        throw new Error("sqlite disk I/O failed");
      }
    ]);
    const h = harness({ runner, environment });
    const context = { brief: "internal-open" };
    await expect(h.engine.openSession({
      binding: bindingFor(h.engine),
      initialContext: context,
      initialContextHash: hashText(JSON.stringify(context))
    }, h.host)).rejects.toThrow("sqlite disk I/O failed");
  });
});
