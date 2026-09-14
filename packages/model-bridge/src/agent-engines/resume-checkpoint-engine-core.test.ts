import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AGENT_FINISH_MISSING_VALUE_PROMPT_RULE,
  AGENT_NATIVE_WEB_SEARCH_PROVENANCE_PROMPT_RULE,
  AGENT_QUESTION_PROMPT_RULE,
  AGENT_QUESTION_WRITEBACK_PROMPT_RULE,
  AGENT_RESEARCH_UNCONFIGURED_PROMPT_RULE,
  CHECKPOINT_ACTION_BATCH_CONTRACT_PROMPT_RULE,
  CHECKPOINT_ACTION_TYPE_PROMPT_RULE,
  CHECKPOINT_FINISH_ORDER_PROMPT_RULE,
  CHECKPOINT_RESPONSE_ENVELOPE_PROMPT_RULE,
  NATIVE_WEB_SEARCH_EVENT_CODE,
  type AgentEngineEvent,
  type AgentEngineHost,
  type AgentSessionBinding,
  type VdtGatewayToolCall,
  type VdtGatewayToolResult
} from "@vdt-studio/vdt-agent-runtime";
import type { CheckpointTurn } from "./checkpoint-turn";
import { ActionBatchContractError } from "./action-batch";
import { checkpointTransportError } from "./checkpoint-transport-common";
import {
  SHARED_PROMPT_RULES,
  SHARED_RESUME_CONSTRAINTS,
  ResumeCheckpointEngine,
  createResumeCheckpointSessionMissingPendingDeltaForTests,
  evaluateWaitingUserAskPayload,
  QUESTION_PAYLOAD_RETRY_LIMIT,
  resumeCheckpointCapabilityHash,
  type ResumeCheckpointEnvironment,
  type ResumeCheckpointProviderDescriptor,
  type ResumeCheckpointSegmentInput,
  type ResumeCheckpointSegmentResult,
  type ResumeCheckpointTransport
} from "./resume-checkpoint-engine-core";

const HASH = `sha256:${"a".repeat(64)}`;

const descriptor: ResumeCheckpointProviderDescriptor = {
  engineId: "claude-resume-checkpoint",
  engineAdapterId: "claude-resume-checkpoint-v1",
  backendId: "claude_subscription",
  cliName: "claude",
  sessionSlug: "claude",
  protocolVersion: "claude-checkpoint.v1",
  turnProtocolVersion: "vdt-checkpoint-turn.v1",
  errorPrefix: "CLAUDE_CHECKPOINT",
  cliLabel: "Claude",
  supportsUsageMetrics: false,
  securityConstraint: "test"
};

describe("SHARED_PROMPT_RULES", () => {
  it("wires the shared writeback and finish constants onto the CLI checkpoint path", () => {
    expect(SHARED_PROMPT_RULES.questions).toBe(AGENT_QUESTION_PROMPT_RULE);
    expect(SHARED_PROMPT_RULES.questions).toContain(AGENT_QUESTION_WRITEBACK_PROMPT_RULE);
    expect(SHARED_PROMPT_RULES.finishMissingValues).toBe(AGENT_FINISH_MISSING_VALUE_PROMPT_RULE);
    expect(SHARED_PROMPT_RULES.actionTypes).toBe(CHECKPOINT_ACTION_TYPE_PROMPT_RULE);
    expect(SHARED_PROMPT_RULES.actionBatch).toBe(CHECKPOINT_ACTION_BATCH_CONTRACT_PROMPT_RULE);
    expect(SHARED_PROMPT_RULES.finishOrder).toBe(CHECKPOINT_FINISH_ORDER_PROMPT_RULE);
    expect(SHARED_PROMPT_RULES.actionTypes).toContain(CHECKPOINT_ACTION_BATCH_CONTRACT_PROMPT_RULE);
    expect(SHARED_PROMPT_RULES.actionTypes).toContain(CHECKPOINT_FINISH_ORDER_PROMPT_RULE);
    expect(SHARED_PROMPT_RULES.research).toContain(AGENT_RESEARCH_UNCONFIGURED_PROMPT_RULE);
    expect(SHARED_PROMPT_RULES.research).toContain(AGENT_NATIVE_WEB_SEARCH_PROVENANCE_PROMPT_RULE);
    expect(SHARED_PROMPT_RULES.research).toContain("RESEARCH_PROVIDER_NOT_CONFIGURED");
    expect(SHARED_RESUME_CONSTRAINTS.research).toContain(AGENT_NATIVE_WEB_SEARCH_PROVENANCE_PROMPT_RULE);
    expect(SHARED_RESUME_CONSTRAINTS.response).toContain(CHECKPOINT_RESPONSE_ENVELOPE_PROMPT_RULE);
    expect(SHARED_RESUME_CONSTRAINTS.response).toContain(CHECKPOINT_ACTION_TYPE_PROMPT_RULE);
    expect(SHARED_RESUME_CONSTRAINTS.response).toContain("assistantMessage only");
    expect(SHARED_RESUME_CONSTRAINTS.response).not.toContain("or stated assumptions");
    expect(SHARED_RESUME_CONSTRAINTS.research).toContain(AGENT_RESEARCH_UNCONFIGURED_PROMPT_RULE);
  });
});

describe("ResumeCheckpointSession missing pending delta", () => {
  it("emits a recoverable transport_error instead of ending the stream silently", async () => {
    const session = createResumeCheckpointSessionMissingPendingDeltaForTests({
      descriptor,
      binding: {
        schemaVersion: 2,
        bindingId: "binding-1",
        runId: "run-1",
        projectId: "project-1",
        executionProfile: "external_cli_agent",
        engineId: descriptor.engineId,
        engineAdapterId: descriptor.engineAdapterId,
        backendId: descriptor.backendId,
        modelId: "model-1",
        protocolVersion: descriptor.protocolVersion,
        cliVersion: "1.0.0",
        toolIsolation: "unverified",
        qualificationStatus: "unverified",
        capabilityEvidenceHash: null,
        settingsHash: HASH,
        capabilityProfileHash: HASH,
        toolCatalogHash: HASH,
        externalSessionId: "session-1",
        sessionEpoch: 1,
        boundAt: "2026-08-26T10:00:00.000Z"
      } satisfies AgentSessionBinding,
      transport: {
        validatedCliVersion: "1.0.0",
        executeSegment: async () => {
          throw new Error("executeSegment must not run when the pending delta is missing.");
        }
      } satisfies ResumeCheckpointTransport,
      environment: {
        environmentId: "env-1",
        privateWorkspacePath: "/tmp/workspace",
        privateStatePath: "/tmp/state",
        forbiddenRoots: []
      } satisfies ResumeCheckpointEnvironment,
      host: {
        signal: new AbortController().signal,
        executeTool: async () => {
          throw new Error("executeTool must not run when the pending delta is missing.");
        }
      } satisfies AgentEngineHost
    });

    const events = [];
    for await (const event of session.events()) events.push(event);

    expect(events).toEqual([{
      type: "transport_error",
      code: "CLAUDE_CHECKPOINT_PENDING_DELTA_MISSING",
      message: "Claude checkpoint session lost its pending exchange delta. Recover this run from the last durable checkpoint.",
      retryable: true
    }]);
  });
});

function hashText(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
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

class ScriptedResumeTransport implements ResumeCheckpointTransport {
  readonly prompts: string[] = [];
  readonly segmentInputs: ResumeCheckpointSegmentInput[] = [];
  readonly validatedCliVersion = "1.0.0";
  readonly #turns: readonly CheckpointTurn[];
  readonly #sessionId: string;
  readonly #resumeSessionId?: string;
  readonly #onExecute?: (index: number) => void;
  readonly #processSpawnCountPerSegment: number | readonly number[];
  readonly #inferenceMsPerSegment?: number | readonly number[];
  readonly #nativeWebSearchPerSegment?: readonly (ResumeCheckpointSegmentResult["nativeWebSearch"] | undefined)[];

  constructor(
    turns: readonly CheckpointTurn[],
    options?: {
      sessionId?: string;
      resumeSessionId?: string;
      onExecute?: (index: number) => void;
      processSpawnCountPerSegment?: number | readonly number[];
      inferenceMsPerSegment?: number | readonly number[];
      nativeWebSearchPerSegment?: readonly (ResumeCheckpointSegmentResult["nativeWebSearch"] | undefined)[];
    }
  ) {
    this.#turns = turns;
    this.#sessionId = options?.sessionId ?? "opaque-session-1";
    if (options?.resumeSessionId !== undefined) this.#resumeSessionId = options.resumeSessionId;
    if (options?.onExecute !== undefined) this.#onExecute = options.onExecute;
    this.#processSpawnCountPerSegment = options?.processSpawnCountPerSegment ?? 0;
    if (options?.inferenceMsPerSegment !== undefined) this.#inferenceMsPerSegment = options.inferenceMsPerSegment;
    if (options?.nativeWebSearchPerSegment !== undefined) this.#nativeWebSearchPerSegment = options.nativeWebSearchPerSegment;
  }

  async executeSegment(input: ResumeCheckpointSegmentInput): Promise<ResumeCheckpointSegmentResult> {
    this.prompts.push(input.prompt);
    this.segmentInputs.push(input);
    const index = this.prompts.length - 1;
    this.#onExecute?.(index);
    const turn = this.#turns[index];
    if (!turn) throw new Error(`Unexpected checkpoint segment ${this.prompts.length}.`);
    const processSpawnCount = typeof this.#processSpawnCountPerSegment === "number"
      ? this.#processSpawnCountPerSegment
      : this.#processSpawnCountPerSegment[index] ?? 0;
    const inferenceMs = this.#inferenceMsPerSegment === undefined
      ? undefined
      : typeof this.#inferenceMsPerSegment === "number"
        ? this.#inferenceMsPerSegment
        : this.#inferenceMsPerSegment[index];
    return {
      sessionId: input.mode === "resume" && this.#resumeSessionId ? this.#resumeSessionId : this.#sessionId,
      inputHash: hashText(`input:${this.prompts.length}`),
      outputHash: hashText(`output:${this.prompts.length}`),
      turn,
      processSpawnCount,
      ...(inferenceMs !== undefined ? { inferenceMs } : {}),
      outputBytes: 16,
      ...(this.#nativeWebSearchPerSegment?.[index]
        ? { nativeWebSearch: this.#nativeWebSearchPerSegment[index] }
        : {})
    };
  }
}

describe("ResumeCheckpointEngine research tool errors", () => {
  it("puts RESEARCH_PROVIDER_NOT_CONFIGURED into the tool_results resume delta", async () => {
    const transport = new ScriptedResumeTransport([
      {
        protocolVersion: descriptor.turnProtocolVersion,
        assistantMessage: { messageId: "message-1", text: "I will search for haulage process drivers." },
        action: {
          type: "action_batch",
          batch: {
            calls: [{
              externalCallId: "research-1",
              toolName: "research.search_web",
              args: { query: "haulage process drivers", purpose: "process_components" }
            }]
          }
        }
      },
      {
        protocolVersion: descriptor.turnProtocolVersion,
        assistantMessage: null,
        action: {
          type: "action_batch",
          batch: {
            calls: [{
              externalCallId: "question-1",
              toolName: "user.ask",
              args: {
                questions: [{
                  id: "process_components",
                  question: "What are the main process components for ore haulage?",
                  reason: "Research provider is not configured.",
                  required: true,
                  expectedAnswerType: "text"
                }]
              }
            }]
          }
        }
      }
    ]);
    const engine = new ResumeCheckpointEngine({
      descriptor,
      transport,
      cliVersion: "1.0.0",
      toolCatalogHash: HASH,
      allowedToolNames: ["research.search_web", "user.ask"],
      sessionEnvironmentFactory: () => ({
        environmentId: "env-1",
        privateWorkspacePath: "/tmp/workspace",
        privateStatePath: "/tmp/state",
        forbiddenRoots: []
      } satisfies ResumeCheckpointEnvironment),
      resolveBinding: async () => {
        throw new Error("unused");
      },
      enableUnverifiedCanary: true,
      now: () => "2026-08-26T10:00:00.000Z",
      idFactory: () => "checkpoint-id"
    });
    const host: AgentEngineHost = {
      signal: new AbortController().signal,
      executeTool: async (call) => call.toolName === "research.search_web"
        ? gatewayResult(call, {
            status: "failed",
            resultCode: "RESEARCH_PROVIDER_NOT_CONFIGURED",
            resultHash: hashText("research-failed"),
            payload: {
              error: {
                code: "RESEARCH_PROVIDER_NOT_CONFIGURED",
                message: "Research provider is not configured. Ask the user for process details or continue with explicit assumptions."
              },
              feedback: {
                kind: "research_required",
                suggestedNextTools: ["user.ask"],
                retryable: false
              }
            }
          })
        : gatewayResult(call, { status: "waiting_user", resultCode: "QUESTION_REQUIRED" })
    };
    const binding: AgentSessionBinding = {
      schemaVersion: 2,
      bindingId: "binding-1",
      runId: "run-1",
      projectId: "project-1",
      executionProfile: "external_cli_agent",
      engineId: engine.capability.engineId,
      engineAdapterId: engine.capability.engineAdapterId,
      backendId: engine.capability.backendId,
      modelId: "model-1",
      protocolVersion: engine.capability.protocolVersion,
      cliVersion: engine.capability.cli.version,
      toolIsolation: "unverified",
      qualificationStatus: "unverified",
      capabilityEvidenceHash: null,
      settingsHash: HASH,
      capabilityProfileHash: resumeCheckpointCapabilityHash(engine.capability),
      toolCatalogHash: HASH,
      externalSessionId: null,
      sessionEpoch: 1,
      boundAt: "2026-08-26T10:00:00.000Z"
    };
    const context = { brief: "research-refusal" };
    const session = await engine.openSession({
      binding,
      initialContext: context,
      initialContextHash: hashText(JSON.stringify(context))
    }, host);

    const events = [];
    for await (const event of session.events()) events.push(event);

    expect(transport.prompts[0]).toContain(AGENT_RESEARCH_UNCONFIGURED_PROMPT_RULE);
    expect(transport.prompts[0]).toContain(CHECKPOINT_ACTION_BATCH_CONTRACT_PROMPT_RULE);
    expect(transport.prompts[0]).toContain(CHECKPOINT_FINISH_ORDER_PROMPT_RULE);
    expect(transport.prompts[1]).toContain("RESEARCH_PROVIDER_NOT_CONFIGURED");
    expect(transport.prompts[1]).toContain("user.ask");
    expect(transport.prompts[1]).toContain("\"type\":\"tool_results\"");
    expect(transport.prompts[1]).toContain(CHECKPOINT_RESPONSE_ENVELOPE_PROMPT_RULE);
    expect(transport.prompts[1]).toContain(CHECKPOINT_ACTION_TYPE_PROMPT_RULE);
    expect(transport.prompts[1]).toContain(AGENT_RESEARCH_UNCONFIGURED_PROMPT_RULE);
    expect(transport.prompts[1]).toContain("assistantMessage only");
    expect(transport.prompts[1]).not.toContain("or stated assumptions");
    expect(events.map((event) => event.type)).toEqual([
      "assistant_message",
      "checkpoint_requested",
      "checkpoint_requested",
      "question"
    ]);
  });
});

const VALID_QUESTIONS = [{
  id: "fleet-size",
  question: "How many trucks should be modeled?",
  reason: "The fleet size is required for the branch.",
  required: true,
  expectedAnswerType: "number" as const
}];

const MISSING_REASON_QUESTIONS = [{
  id: "missing-reason",
  question: "What scope?",
  required: true
}];

const BAD_TYPE_QUESTIONS = [{
  id: "bad-type",
  question: "Pick one?",
  reason: "Enum is invalid.",
  required: true,
  expectedAnswerType: "bogus"
}];

function askTurn(
  externalCallId: string,
  questions: unknown,
  text: string | null = "I need one value before continuing."
): CheckpointTurn {
  return {
    protocolVersion: descriptor.turnProtocolVersion,
    assistantMessage: text === null ? null : { messageId: `message-${externalCallId}`, text },
    action: {
      type: "action_batch",
      batch: {
        calls: [{
          externalCallId,
          toolName: "user.ask",
          args: { questions }
        }]
      }
    }
  };
}

function echoTurn(externalCallId: string, text: string): CheckpointTurn {
  return {
    protocolVersion: descriptor.turnProtocolVersion,
    assistantMessage: { messageId: `message-${externalCallId}`, text },
    action: {
      type: "action_batch",
      batch: {
        calls: [{ externalCallId, toolName: "vdt.echo", args: { value: 1 } }]
      }
    }
  };
}

async function openScriptedSession(input: {
  transport: ResumeCheckpointTransport;
  executeTool?: AgentEngineHost["executeTool"];
  allowedToolNames?: readonly string[];
  initialContext?: Readonly<Record<string, unknown>>;
}) {
  const engine = new ResumeCheckpointEngine({
    descriptor,
    transport: input.transport,
    cliVersion: "1.0.0",
    toolCatalogHash: HASH,
    allowedToolNames: input.allowedToolNames ?? ["vdt.echo", "user.ask"],
    sessionEnvironmentFactory: () => ({
      environmentId: "env-1",
      privateWorkspacePath: "/tmp/workspace",
      privateStatePath: "/tmp/state",
      forbiddenRoots: []
    } satisfies ResumeCheckpointEnvironment),
    resolveBinding: async () => {
      throw new Error("unused");
    },
    enableUnverifiedCanary: true,
    now: () => "2026-08-26T10:00:00.000Z",
    idFactory: () => "checkpoint-id"
  });
  const host: AgentEngineHost = {
    signal: new AbortController().signal,
    executeTool: input.executeTool ?? (async (call) => call.toolName === "user.ask"
      ? gatewayResult(call, { status: "waiting_user", resultCode: "QUESTION_REQUIRED" })
      : gatewayResult(call))
  };
  const binding: AgentSessionBinding = {
    schemaVersion: 2,
    bindingId: "binding-1",
    runId: "run-1",
    projectId: "project-1",
    executionProfile: "external_cli_agent",
    engineId: engine.capability.engineId,
    engineAdapterId: engine.capability.engineAdapterId,
    backendId: engine.capability.backendId,
    modelId: "model-1",
    protocolVersion: engine.capability.protocolVersion,
    cliVersion: engine.capability.cli.version,
    toolIsolation: "unverified",
    qualificationStatus: "unverified",
    capabilityEvidenceHash: null,
    settingsHash: HASH,
    capabilityProfileHash: resumeCheckpointCapabilityHash(engine.capability),
    toolCatalogHash: HASH,
    externalSessionId: null,
    sessionEpoch: 1,
    boundAt: "2026-08-26T10:00:00.000Z"
  };
  const context = input.initialContext ?? { brief: "question-payload-retry" };
  const session = await engine.openSession({
    binding,
    initialContext: context,
    initialContextHash: hashText(JSON.stringify(context))
  }, host);
  return { engine, session, host };
}

async function collectEvents(events: AsyncIterable<AgentEngineEvent>): Promise<AgentEngineEvent[]> {
  const output: AgentEngineEvent[] = [];
  for await (const event of events) output.push(event);
  return output;
}

describe("evaluateWaitingUserAskPayload", () => {
  it("caps retries at one and preserves the second-failure diagnostic", () => {
    expect(QUESTION_PAYLOAD_RETRY_LIMIT).toBe(1);
    const call = {
      externalCallId: "question-1",
      toolName: "user.ask",
      args: { questions: MISSING_REASON_QUESTIONS }
    } satisfies VdtGatewayToolCall;
    const waiting = gatewayResult(call, { status: "waiting_user", resultCode: "QUESTION_REQUIRED" });
    const first = evaluateWaitingUserAskPayload({
      pausedCall: call,
      results: [waiting],
      retryCount: 0,
      errorPrefix: "CLAUDE_CHECKPOINT"
    });
    expect(first.kind).toBe("retry");
    if (first.kind !== "retry") throw new Error("expected retry");
    expect(first.note.code).toBe("CLAUDE_CHECKPOINT_QUESTION_PAYLOAD_RETRY");
    expect(first.note.message).toContain("0.reason");
    expect(first.results[0]).toMatchObject({
      status: "failed",
      resultCode: "QUESTION_SCHEMA_INVALID"
    });
    expect(JSON.stringify(first.results[0]?.payload)).toContain("0.reason");

    const secondCall = {
      externalCallId: "question-2",
      toolName: "user.ask",
      args: { questions: BAD_TYPE_QUESTIONS }
    } satisfies VdtGatewayToolCall;
    const secondWaiting = gatewayResult(secondCall, { status: "waiting_user", resultCode: "QUESTION_REQUIRED" });
    const second = evaluateWaitingUserAskPayload({
      pausedCall: secondCall,
      results: [secondWaiting],
      retryCount: QUESTION_PAYLOAD_RETRY_LIMIT,
      errorPrefix: "CLAUDE_CHECKPOINT"
    });
    expect(second.kind).toBe("terminal");
    if (second.kind !== "terminal") throw new Error("expected terminal");
    expect(second.error).toMatchObject({
      type: "transport_error",
      code: "CLAUDE_CHECKPOINT_QUESTION_INVALID",
      retryable: false
    });
    expect(second.error.message).toContain("user.ask did not contain a valid VDT question checkpoint:");
    expect(second.error.message).toContain("expectedAnswerType");
  });

  it("does not retry a waiting-user result from a non-user.ask tool", () => {
    const call = {
      externalCallId: "echo-1",
      toolName: "vdt.echo",
      args: { value: 1 }
    } satisfies VdtGatewayToolCall;
    const decision = evaluateWaitingUserAskPayload({
      pausedCall: call,
      results: [gatewayResult(call, { status: "waiting_user", resultCode: "QUESTION_REQUIRED" })],
      retryCount: 0,
      errorPrefix: "CLAUDE_CHECKPOINT"
    });
    expect(decision).toMatchObject({
      kind: "terminal",
      error: {
        code: "CLAUDE_CHECKPOINT_QUESTION_INVALID",
        message: "A waiting-user result must come from the user.ask control tool.",
        retryable: false
      }
    });
  });
});

describe("ResumeCheckpointEngine question payload retry", () => {
  it("retries one malformed user.ask and continues after a corrected set", async () => {
    const transport = new ScriptedResumeTransport([
      askTurn("question-bad", MISSING_REASON_QUESTIONS),
      askTurn("question-good", VALID_QUESTIONS, null)
    ]);
    const { session } = await openScriptedSession({ transport });
    const events = await collectEvents(session.events());

    expect(transport.prompts).toHaveLength(2);
    expect(transport.prompts[1]).toContain("QUESTION_SCHEMA_INVALID");
    expect(transport.prompts[1]).toContain("0.reason");
    expect(transport.prompts[1]).toContain("Correct the question objects and emit user.ask once more.");
    expect(events.map((event) => event.type)).toEqual([
      "assistant_message",
      "transport_note",
      "checkpoint_requested",
      "checkpoint_requested",
      "question"
    ]);
    expect(events.find((event) => event.type === "transport_note")).toMatchObject({
      code: "CLAUDE_CHECKPOINT_QUESTION_PAYLOAD_RETRY",
      message: expect.stringContaining("0.reason")
    });
    expect(events.at(-1)).toMatchObject({
      type: "question",
      questionSetId: "claude-question-question-good"
    });
  });

  it("terminates on a second consecutive malformed set with the second diagnostic", async () => {
    const transport = new ScriptedResumeTransport([
      askTurn("question-bad-1", MISSING_REASON_QUESTIONS),
      askTurn("question-bad-2", BAD_TYPE_QUESTIONS, null),
      askTurn("question-should-not-run", VALID_QUESTIONS, null)
    ]);
    const { session } = await openScriptedSession({ transport });
    const events = await collectEvents(session.events());

    expect(transport.prompts).toHaveLength(2);
    const notes = events.filter((event) => event.type === "transport_note");
    expect(notes).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      type: "transport_error",
      code: "CLAUDE_CHECKPOINT_QUESTION_INVALID",
      retryable: false
    });
    const terminal = events.at(-1);
    if (terminal?.type !== "transport_error") throw new Error("expected transport_error");
    expect(terminal.message).toContain("user.ask did not contain a valid VDT question checkpoint:");
    expect(terminal.message).toContain("expectedAnswerType");
    expect(terminal.message).not.toContain("0.reason");
  });

  it("cannot retry twice for the same question set across later segments", async () => {
    const transport = new ScriptedResumeTransport([
      echoTurn("echo-1", "I will inspect the graph."),
      askTurn("question-bad-1", MISSING_REASON_QUESTIONS, null),
      askTurn("question-bad-2", BAD_TYPE_QUESTIONS, null),
      askTurn("question-should-not-run", VALID_QUESTIONS, null)
    ]);
    const { session } = await openScriptedSession({ transport });
    const events = await collectEvents(session.events());

    expect(transport.prompts).toHaveLength(3);
    expect(events.filter((event) => event.type === "transport_note")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      type: "transport_error",
      code: "CLAUDE_CHECKPOINT_QUESTION_INVALID",
      retryable: false
    });
  });

  it("allows a later question set one retry after a valid set is accepted", async () => {
    const transport = new ScriptedResumeTransport([
      askTurn("question-bad-1", MISSING_REASON_QUESTIONS),
      askTurn("question-good-1", VALID_QUESTIONS, null),
      askTurn("question-bad-2", BAD_TYPE_QUESTIONS, null),
      askTurn("question-good-2", VALID_QUESTIONS, null)
    ]);
    const { session } = await openScriptedSession({ transport });
    const first = await collectEvents(session.events());
    expect(first.filter((event) => event.type === "transport_note")).toHaveLength(1);
    expect(first.at(-1)).toMatchObject({
      type: "question",
      questionSetId: "claude-question-question-good-1"
    });

    await session.submit({
      type: "user_answer",
      questionSetId: "claude-question-question-good-1",
      answers: { "fleet-size": 36 }
    });
    const second = await collectEvents(session.events());
    expect(transport.prompts).toHaveLength(4);
    expect(second.filter((event) => event.type === "transport_note")).toHaveLength(1);
    expect(second.at(-1)).toMatchObject({
      type: "question",
      questionSetId: "claude-question-question-good-2"
    });
  });

  it("terminates immediately on SECURITY_BOUNDARY_BREACH without a question retry", async () => {
    const transport = new ScriptedResumeTransport([
      echoTurn("echo-1", "I will inspect the graph."),
      askTurn("question-should-not-run", MISSING_REASON_QUESTIONS, null)
    ], {
      onExecute: (index) => {
        if (index === 1) {
          throw Object.assign(new Error("shell.exec is outside the VDT domain-tool boundary."), {
            code: "SECURITY_BOUNDARY_BREACH"
          });
        }
      }
    });
    const { session } = await openScriptedSession({ transport });
    const events = await collectEvents(session.events());

    expect(transport.prompts).toHaveLength(2);
    expect(events.filter((event) => event.type === "transport_note")).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({
      type: "transport_error",
      code: "SECURITY_BOUNDARY_BREACH",
      retryable: false
    });
  });

  it("terminates immediately on a session-identity mismatch without a question retry", async () => {
    const transport = new ScriptedResumeTransport([
      echoTurn("echo-1", "I will inspect the graph."),
      askTurn("question-should-not-run", MISSING_REASON_QUESTIONS, null)
    ], {
      resumeSessionId: "opaque-session-OTHER"
    });
    const { session } = await openScriptedSession({ transport });
    const events = await collectEvents(session.events());

    expect(transport.prompts).toHaveLength(2);
    expect(events.filter((event) => event.type === "transport_note")).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({
      type: "transport_error",
      code: "CLAUDE_CHECKPOINT_SESSION_MISMATCH",
      retryable: true
    });
    const telemetry = (session as unknown as { snapshotPerformanceTelemetry: () => {
      logicalSessionCount: number;
      sameOpaqueSessionAcrossSegments: boolean;
      opaqueSessionIdHash: string | null;
    } }).snapshotPerformanceTelemetry();
    expect(telemetry.logicalSessionCount).toBe(0);
    expect(telemetry.sameOpaqueSessionAcrossSegments).toBe(false);
    expect(telemetry.opaqueSessionIdHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(telemetry)).not.toContain("opaque-session");
  });
});

describe("ResumeCheckpointEngine session performance telemetry", () => {
  it("counts logical session, segments, and runner spawns independently", async () => {
    const transport = new ScriptedResumeTransport(
      [
        echoTurn("echo-1", "I will inspect the graph."),
        askTurn("question-1", VALID_QUESTIONS, null)
      ],
      {
        processSpawnCountPerSegment: [1, 3],
        inferenceMsPerSegment: [19_000, 18_400]
      }
    );
    const { session } = await openScriptedSession({ transport });
    await collectEvents(session.events());
    const telemetry = (session as unknown as { snapshotPerformanceTelemetry: () => Record<string, unknown> })
      .snapshotPerformanceTelemetry();

    expect(telemetry).toMatchObject({
      segmentCount: 2,
      processSpawnCount: 4,
      logicalSessionCount: 1,
      resumeCount: 1,
      toolCallCount: 2,
      sameOpaqueSessionAcrossSegments: true,
      repairCount: 0
    });
    expect(telemetry.segmentInferenceMs).toEqual([19_000, 18_400]);
    expect(telemetry.decisionLatenciesMs).toEqual([19_000, 18_400]);
    expect(telemetry.opaqueSessionIdHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(telemetry)).not.toContain("opaque-session-1");
    for (const key of ["qualificationStatus", "toolIsolation", "capabilityEvidenceHash", "qualificationGranted"]) {
      expect(telemetry).not.toHaveProperty(key);
    }
  });

  it("hashes a missing session id as null rather than sha256 of empty string", async () => {
    const { hashOpaqueSessionId } = await import("./cli-session-performance-telemetry");
    expect(hashOpaqueSessionId("")).toBeNull();
    expect(hashOpaqueSessionId(null)).toBeNull();
    expect(hashOpaqueSessionId("thread-1")).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});

describe("ResumeCheckpointEngine native web search", () => {
  it("emits a NATIVE_WEB_SEARCH transport_note when the transport records a search", async () => {
    const transport = new ScriptedResumeTransport(
      [echoTurn("echo-1", "I will inspect the graph.")],
      {
        nativeWebSearchPerSegment: [{ count: 1, queries: ["haulage cycle time"] }]
      }
    );
    const { session } = await openScriptedSession({ transport });
    const events = await collectEvents(session.events());
    expect(events.find((event) => event.type === "transport_note")).toMatchObject({
      type: "transport_note",
      code: NATIVE_WEB_SEARCH_EVENT_CODE,
      message: expect.stringContaining("haulage cycle time")
    });
  });

  it("passes forceNativeWebSearch when researchMode is on", async () => {
    const transport = new ScriptedResumeTransport([echoTurn("echo-1", "I will inspect the graph.")]);
    await openScriptedSession({
      transport,
      initialContext: { brief: { options: { researchMode: "on" } } }
    });
    expect(transport.segmentInputs[0]?.forceNativeWebSearch).toBe(true);
  });

  it("does not force native web search for auto or off researchMode", async () => {
    const transport = new ScriptedResumeTransport([echoTurn("echo-1", "I will inspect the graph.")]);
    await openScriptedSession({
      transport,
      initialContext: { brief: { options: { researchMode: "auto" } } }
    });
    expect(transport.segmentInputs[0]?.forceNativeWebSearch).toBeUndefined();
  });
});

describe("ResumeCheckpointSession.open contract violations", () => {
  const mixedTools = [
    ["run.request_finish", "run.request_finish must be the only call in an action batch."],
    ["user.ask", "user.ask must be the only call in an action batch."],
    ["approval.request", "approval.request must be the only call in an action batch."]
  ] as const;

  for (const [toolName, message] of mixedTools) {
    it(`yields a diagnosable transport_error when the first turn mixes ${toolName}`, async () => {
      const error = Object.assign(
        new ActionBatchContractError("ACTION_BATCH_CONTROL_TOOL_MIXED", message),
        { sessionId: "opaque-session-mixed" }
      );
      const { session } = await openScriptedSession({
        transport: {
          validatedCliVersion: "1.0.0",
          executeSegment: async () => {
            throw error;
          }
        },
        allowedToolNames: ["vdt.echo", "user.ask", "approval.request", "run.request_finish"]
      });
      const events = await collectEvents(session.events());
      expect(session.binding.externalSessionId).toBe("opaque-session-mixed");
      expect(events).toEqual([{
        type: "transport_error",
        code: "ACTION_BATCH_CONTROL_TOOL_MIXED",
        message,
        retryable: true
      }]);
    });
  }

  it("still fails loudly for a genuine internal error during open", async () => {
    await expect(openScriptedSession({
      transport: {
        validatedCliVersion: "1.0.0",
        executeSegment: async () => {
          throw new Error("sqlite disk I/O failed");
        }
      }
    })).rejects.toThrow("sqlite disk I/O failed");
  });

  it("still fails loudly for a configuration error during open", async () => {
    await expect(openScriptedSession({
      transport: {
        validatedCliVersion: "1.0.0",
        executeSegment: async () => {
          throw checkpointTransportError("CLAUDE_CHECKPOINT_CONFIGURATION_INVALID", "allowedToolNames must contain 1-100 tools.");
        }
      }
    })).rejects.toMatchObject({
      code: "CLAUDE_CHECKPOINT_CONFIGURATION_INVALID"
    });
  });
});
