import { describe, expect, it } from "vitest";
import type {
  AgentCapabilityProfile,
  AgentEngineCheckpoint,
  AgentEngineEvent,
  AgentEngineHost,
  AgentRunSession,
  AgentSessionBinding,
  VdtGatewayToolCall,
  VdtGatewayToolResult
} from "./agent-execution-contracts";
import {
  MAX_MODEL_AGENT_SESSION_STATE_BYTES,
  StructuredInProductModelAgentEngine,
  modelAgentStructuredTurnSchema,
  type ModelAgentTurnRequest,
  type ModelAgentTurnResponse,
  type ModelAgentTurnTransport
} from "./in-product-model-agent-engine";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;

describe("StructuredInProductModelAgentEngine", () => {
  it("requires a private semantic checkpoint bounded by UTF-8 bytes", () => {
    const valid = turn("turn-schema", {
      type: "question",
      messageId: "message-schema",
      questionSetId: "questions-schema",
      questions: [{
        id: "confirm",
        question: "Continue?",
        reason: "Keep the logical goal across stateless turns.",
        required: true,
        expectedAnswerType: "text"
      }]
    });
    expect(modelAgentStructuredTurnSchema.safeParse(valid).success).toBe(true);
    expect(modelAgentStructuredTurnSchema.safeParse({
      ...valid,
      sessionState: "🚀".repeat(Math.floor(MAX_MODEL_AGENT_SESSION_STATE_BYTES / 4) + 1)
    }).success).toBe(false);
    const { sessionState: _sessionState, ...missingState } = valid;
    expect(modelAgentStructuredTurnSchema.safeParse(missingState).success).toBe(false);
  });

  it("sends initial context once, executes ordered batches, and keeps one logical session", async () => {
    const transport = new QueueTransport([
      turn("turn-1", {
        type: "action_batch",
        batch: { calls: [
          { externalCallId: "call-1", toolName: "vdt.echo", args: { value: "a" } },
          { externalCallId: "call-2", toolName: "vdt.echo", args: { value: "b" } }
        ] }
      }, { messageId: "message-1", text: "I will build the VDT in ordered batches." }),
      turn("turn-2", {
        type: "action_batch",
        batch: { calls: [
          { externalCallId: "finish-1", toolName: "run.request_finish", args: {} }
        ] }
      }),
      turn("turn-3", {
        type: "final",
        messageId: "message-2",
        finishReceiptId: "finish-receipt-1",
        text: "The verified VDT is ready."
      })
    ]);
    const calls: VdtGatewayToolCall[] = [];
    const inFlightToolCalls: Array<AgentEngineCheckpoint["activeToolCall"]> = [];
    const engine = makeEngine(transport);
    let session!: AgentRunSession;
    session = await engine.openSession({
      binding,
      initialContext: { brief: { rootKpi: "Ore hauled" } },
      initialContextHash: HASH_A
    }, host(async (call) => {
      calls.push(call);
      inFlightToolCalls.push((await session.checkpoint()).activeToolCall);
      if (call.toolName === "run.request_finish") {
        return result(call, "succeeded", "FINISH_VERIFIED", {
          receiptId: "finish-receipt-1",
          receiptHash: HASH_C
        });
      }
      return result(call, "succeeded", "OK", { echoed: call.args });
    }));

    const events = await collect(session.events());

    expect(calls.map((call) => call.externalCallId)).toEqual(["call-1", "call-2", "finish-1"]);
    expect(inFlightToolCalls).toEqual([
      { externalCallId: "call-1", toolName: "vdt.echo", state: "in_flight" },
      { externalCallId: "call-2", toolName: "vdt.echo", state: "in_flight" },
      { externalCallId: "finish-1", toolName: "run.request_finish", state: "in_flight" }
    ]);
    expect(transport.requests.map((request) => request.delta.type)).toEqual([
      "initial_context",
      "tool_results",
      "tool_results"
    ]);
    expect(events.filter((event) => event.type === "assistant_message")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      type: "final",
      finishReceiptId: "finish-receipt-1"
    });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "checkpoint_requested", reason: "engine_exchange_started" }),
      expect.objectContaining({ type: "checkpoint_requested", reason: "engine_exchange_completed" })
    ]));
    await expect(session.checkpoint()).resolves.toMatchObject({
      bindingId: binding.bindingId,
      finishReceipt: { receiptId: "finish-receipt-1", state: "verified" }
    });
  });

  it("stops a batch on its first failed call and sends only the bounded result delta", async () => {
    const transport = new QueueTransport([
      turn("turn-1", {
        type: "action_batch",
        batch: { calls: [
          { externalCallId: "bad-1", toolName: "vdt.echo", args: {} },
          { externalCallId: "must-not-run", toolName: "vdt.echo", args: {} }
        ] }
      }, { messageId: "message-1", text: "I will validate each operation." }),
      turn("turn-2", {
        type: "question",
        messageId: "message-2",
        questionSetId: "questions-1",
        questions: [{
          id: "correction",
          question: "Should I retry with corrected inputs?",
          reason: "The first operation was rejected.",
          required: true,
          expectedAnswerType: "text"
        }]
      })
    ]);
    const calls: string[] = [];
    const session = await makeEngine(transport).openSession({
      binding,
      initialContext: {},
      initialContextHash: HASH_A
    }, host(async (call) => {
      calls.push(call.externalCallId);
      if (call.toolName === "user.ask") {
        return result(call, "waiting_user", "USER_INPUT_REQUIRED", {});
      }
      return result(call, "failed", "INVALID_TOOL_ARGS", { message: "invalid" });
    }));

    const events = await collect(session.events());

    expect(calls).toEqual(["bad-1", expect.stringMatching(/^question-call-/)]);
    expect(transport.requests[1]?.delta).toMatchObject({
      type: "tool_results",
      results: [{ externalCallId: "bad-1", status: "failed" }]
    });
    expect(events.at(-1)?.type).toBe("question");
  });

  it("rejects a first turn that has neither an assistant message nor a question", async () => {
    const transport = new QueueTransport([
      turn("turn-1", {
        type: "action_batch",
        batch: { calls: [{ externalCallId: "call-1", toolName: "vdt.echo", args: {} }] }
      })
    ]);
    const session = await makeEngine(transport).openSession({
      binding,
      initialContext: {},
      initialContextHash: HASH_A
    }, host(async (call) => call.toolName === "user.ask"
      ? result(call, "waiting_user", "USER_INPUT_REQUIRED", {})
      : result(call, "succeeded", "OK", {})));

    const events = await collect(session.events());
    expect(events.at(-1)).toMatchObject({
      type: "transport_error",
      code: "MODEL_FIRST_RESPONSE_MISSING"
    });
  });

  it.each([false, true])("bounds repeated tool failures independently of call IDs and invalid value changes (%s)", async (changeArgs) => {
    const transport = new QueueTransport(Array.from({ length: 4 }, (_, index) =>
      driverBatchTurn(index, changeArgs ? `driver-${index}` : "driver")
    ));
    const calls: string[] = [];
    const session = await makeEngine(transport).openSession({
      binding, initialContext: {}, initialContextHash: HASH_A
    }, host(async (call) => {
      calls.push(call.externalCallId);
      return invalidDriverBatch(call);
    }));

    const events = await collect(session.events());

    expect(calls).toEqual(["driver-call-0", "driver-call-1", "driver-call-2"]);
    expect(transport.requests).toHaveLength(3);
    expect(events.at(-1)).toMatchObject({
      type: "transport_error", code: "MODEL_TOOL_RETRY_LIMIT_EXCEEDED", retryable: false
    });
    expect(events.some((event) => event.type === "final")).toBe(false);
    expect((await session.checkpoint()).modelAgentLoopState).toMatchObject({
      turnCount: 3,
      toolFailures: [{ toolName: "vdt.add_drivers_batch", attempts: 3 }]
    });
  });

  it("keeps failure counts across unrelated successful reads and question resume", async () => {
    const question = turn("question-turn", {
      type: "question", messageId: "question-message", questionSetId: "questions-repair",
      questions: [{ id: "repair", question: "How should I repair the drivers?", reason: "The batch was rejected.", required: true, expectedAnswerType: "text" }]
    });
    const transport = new QueueTransport([
      driverBatchTurn(0),
      turn("read-turn", { type: "action_batch", batch: { calls: [{ externalCallId: "read-1", toolName: "project.get_current", args: {} }] } }),
      driverBatchTurn(1), question, driverBatchTurn(2), driverBatchTurn(3)
    ]);
    const execute = host(async (call) => call.toolName === "user.ask"
      ? result(call, "waiting_user", "USER_INPUT_REQUIRED", {})
      : call.toolName === "project.get_current"
        ? result(call, "succeeded", "OK", {})
        : invalidDriverBatch(call));
    const engine = makeEngine(transport);
    const session = await engine.openSession({ binding, initialContext: {}, initialContextHash: HASH_A }, execute);
    expect((await collect(session.events())).at(-1)?.type).toBe("question");
    const checkpoint = await session.checkpoint();
    expect(checkpoint.modelAgentLoopState?.turnCount).toBe(4);

    const nextBinding = { ...binding, sessionEpoch: 2 };
    const resumed = await engine.resumeBoundSession(nextBinding, { ...checkpoint, sessionEpoch: 2 }, execute);
    const events = await collect(resumed.events());
    expect(events.at(-1)).toMatchObject({ type: "transport_error", code: "MODEL_TOOL_RETRY_LIMIT_EXCEEDED" });
    expect(transport.requests).toHaveLength(5);
    expect(transport.requests.at(-1)?.stableCallKey).toBe("turn-2-5");

    const stopped = await engine.resumeBoundSession(nextBinding, await resumed.checkpoint(), execute);
    expect((await collect(stopped.events())).at(-1)).toMatchObject({ code: "MODEL_TOOL_RETRY_LIMIT_EXCEEDED" });
    expect(transport.requests).toHaveLength(5);
  });

  it("bounds provenance failures even when the model changes notes, values and target IDs", async () => {
    const transport = new QueueTransport(Array.from({ length: 4 }, (_, index) => turn(`source-${index}`, {
      type: "action_batch", batch: { calls: [{ externalCallId: `source-${index}`, toolName: "vdt.fill_input_values_batch", args: {
        values: [{ nodeId: `input_${index}`, value: 365 + index, provenance: "user_provided_value", note: `Changed attribution ${index}` }]
      } }] }
    }, index === 0 ? { messageId: "source-opening", text: "I will build and check the tree." } : null)));
    const session = await makeEngine(transport).openSession({ binding, initialContext: {}, initialContextHash: HASH_A },
      host(async (call) => result(call, "failed", "USER_PROVIDED_VALUE_UNGROUNDED", { error: { message: "No literal source" } })));
    expect((await collect(session.events())).at(-1)).toMatchObject({ type: "transport_error", code: "MODEL_TOOL_RETRY_LIMIT_EXCEEDED" });
    expect(transport.requests).toHaveLength(3);
    expect((await session.checkpoint()).modelAgentLoopState?.toolFailures).toMatchObject([{ toolName: "vdt.fill_input_values_batch", attempts: 3 }]);
  });

  it("allows corrected tool arguments to succeed and reset that tool's failure budget", async () => {
    const corrected = driverBatchTurn(1);
    corrected.action.batch.calls[0]!.args.drivers.push({ parentNodeId: "root", name: "Second driver" });
    const transport = new QueueTransport([
      driverBatchTurn(0), corrected, driverBatchTurn(2), driverBatchTurn(3),
      turn("question-turn", {
        type: "question", messageId: "question-message", questionSetId: "questions-repair",
        questions: [{ id: "repair", question: "Continue with the saved drivers?", reason: "One batch was added.", required: true, expectedAnswerType: "text" }]
      })
    ]);
    const session = await makeEngine(transport).openSession({
      binding, initialContext: {}, initialContextHash: HASH_A
    }, host(async (call) => call.toolName === "user.ask"
      ? result(call, "waiting_user", "USER_INPUT_REQUIRED", {})
      : call.externalCallId === "driver-call-1"
        ? result(call, "succeeded", "OK", { added: 2 })
        : invalidDriverBatch(call)));
    const events = await collect(session.events());
    expect(events.at(-1)?.type).toBe("question");
    expect(events.some((event) => event.type === "transport_error")).toBe(false);
    expect((await session.checkpoint()).modelAgentLoopState?.toolFailures[0]?.attempts).toBe(2);
  });

  it("also bounds repeated rejected questions", async () => {
    const transport = new QueueTransport(Array.from({ length: 4 }, (_, index) => turn(`question-turn-${index}`, {
      type: "question", messageId: `message-${index}`, questionSetId: `question-set-${index}`,
      questions: [{ id: "repair", question: "Continue?", reason: "Need a decision.", required: true, expectedAnswerType: "text" }]
    })));
    const session = await makeEngine(transport).openSession({ binding, initialContext: {}, initialContextHash: HASH_A },
      host(async (call) => result(call, "failed", "QUESTION_REJECTED", {})));
    const events = await collect(session.events());
    expect(transport.requests).toHaveLength(3);
    expect(events.at(-1)).toMatchObject({ code: "MODEL_TOOL_RETRY_LIMIT_EXCEEDED", retryable: false });
    expect(events.some((event) => event.type === "question")).toBe(false);
  });

  it("stops identical successful reads without graph progress, including after checkpoint resume", async () => {
    const transport = new QueueTransport(Array.from({ length: 5 }, (_, index) => turn(`read-turn-${index}`, {
      type: "action_batch", batch: { calls: [{ externalCallId: `read-${index}`, toolName: "project.get_current", args: {} }] }
    }, index === 0 ? { messageId: "opening", text: "I will build the model." } : undefined)));
    const engine = makeEngine(transport);
    const execute = host(async (call) => result(call, "succeeded", "OK", { projectChanged: false }));
    const session = await engine.openSession({ binding, initialContext: {}, initialContextHash: HASH_A }, execute);
    expect((await collect(session.events())).at(-1)).toMatchObject({ type: "transport_error", code: "MODEL_NO_PROGRESS", retryable: false });
    expect(transport.requests).toHaveLength(4);
    const checkpoint = await session.checkpoint();
    expect(checkpoint.modelAgentLoopState?.repeatedReads?.[0]?.attempts).toBe(4);
    const resumed = await engine.resumeBoundSession(binding, checkpoint, execute);
    expect((await collect(resumed.events())).at(-1)).toMatchObject({ code: "MODEL_NO_PROGRESS" });
    expect(transport.requests).toHaveLength(4);
  });

  it("permits fresh validation/read cycles after a committed mutation", async () => {
    const transport = new QueueTransport([
      ...Array.from({ length: 7 }, (_, index) => turn(`progress-turn-${index}`, {
        type: "action_batch", batch: { calls: [{ externalCallId: `progress-${index}`, toolName: index === 3 ? "vdt.set_formula" : "vdt.calculate", args: {} }] }
      }, index === 0 ? { messageId: "opening", text: "I will build the model." } : undefined)),
      turn("question-turn", { type: "question", messageId: "question", questionSetId: "questions", questions: [{
        id: "confirm", question: "Continue?", reason: "Review the computed result.", required: true, expectedAnswerType: "text"
      }] })
    ]);
    const session = await makeEngine(transport).openSession({ binding, initialContext: {}, initialContextHash: HASH_A }, host(async (call) =>
      call.toolName === "user.ask" ? result(call, "waiting_user", "USER_INPUT_REQUIRED", {})
        : result(call, "succeeded", "OK", { projectChanged: call.toolName === "vdt.set_formula" })
    ));
    expect((await collect(session.events())).at(-1)?.type).toBe("question");
    expect(transport.requests).toHaveLength(8);
  });

  it("recognizes a committed graph repair as progress without counting unrelated reads", async () => {
    const transport = new QueueTransport([
      driverBatchTurn(0), driverBatchTurn(1),
      turn("repair-turn", { type: "action_batch", batch: { calls: [{
        externalCallId: "single-driver-repair", toolName: "vdt.add_driver", args: { parentNodeId: "root", name: "Driver" }
      }] } }),
      driverBatchTurn(2), driverBatchTurn(3),
      turn("question-turn", { type: "question", messageId: "question-message", questionSetId: "questions-repair", questions: [{
        id: "next", question: "Continue?", reason: "The graph changed.", required: true, expectedAnswerType: "text"
      }] })
    ]);
    const session = await makeEngine(transport).openSession({ binding, initialContext: {}, initialContextHash: HASH_A },
      host(async (call) => call.toolName === "user.ask"
        ? result(call, "waiting_user", "USER_INPUT_REQUIRED", {})
        : call.toolName === "vdt.add_driver"
          ? result(call, "succeeded", "OK", { projectChanged: true })
          : invalidDriverBatch(call)));
    expect((await collect(session.events())).at(-1)?.type).toBe("question");
    expect((await session.checkpoint()).modelAgentLoopState?.toolFailures[0]?.attempts).toBe(2);
  });

  it("does not reset the configured turn limit when resuming a checkpoint", async () => {
    const transport = new QueueTransport([driverBatchTurn(0), driverBatchTurn(1), driverBatchTurn(2)]);
    const engine = makeEngine(transport, { maxTurns: 2 });
    const execute = host(async (call) => invalidDriverBatch(call));
    const session = await engine.openSession({ binding, initialContext: {}, initialContextHash: HASH_A }, execute);
    expect((await collect(session.events())).at(-1)).toMatchObject({ code: "MAX_MODEL_TURNS_EXCEEDED" });
    const resumed = await engine.resumeBoundSession(binding, await session.checkpoint(), execute);
    expect((await collect(resumed.events())).at(-1)).toMatchObject({ code: "MAX_MODEL_TURNS_EXCEEDED" });
    expect(transport.requests).toHaveLength(2);
  });

  it("resumes a paused question with a human delta without opening another engine", async () => {
    const transport = new QueueTransport([
      turn("turn-1", {
        type: "question",
        messageId: "message-1",
        questionSetId: "questions-1",
        questions: [{
          id: "unit",
          question: "Which unit should be used?",
          reason: "The root KPI needs a unit.",
          required: true,
          expectedAnswerType: "text"
        }]
      }),
      turn("turn-2", {
        type: "final",
        messageId: "message-2",
        finishReceiptId: "finish-receipt-1",
        text: "Thank you."
      }, { messageId: "message-answer", text: "I will use tonnes." })
    ]);
    const session = await makeEngine(transport).openSession({
      binding,
      initialContext: {},
      initialContextHash: HASH_A
    }, host(async (call) => call.toolName === "user.ask"
      ? result(call, "waiting_user", "USER_INPUT_REQUIRED", {})
      : result(call, "succeeded", "OK", {})));

    expect((await collect(session.events())).at(-1)?.type).toBe("question");
    await session.submit({
      type: "user_answer",
      questionSetId: "questions-1",
      answers: { unit: "tonnes" }
    });
    expect((await collect(session.events())).at(-1)?.type).toBe("final");
    expect(transport.requests[1]?.delta).toMatchObject({
      type: "human_input",
      input: { type: "user_answer", questionSetId: "questions-1" }
    });
  });

  it("queues an instruction received during inference and merges it into the next checkpoint delta", async () => {
    let releaseFirstTurn!: () => void;
    const firstTurnBlocked = new Promise<void>((resolve) => {
      releaseFirstTurn = resolve;
    });
    const transport = new QueueTransport([
      async () => {
        await firstTurnBlocked;
        return turn("turn-1", {
          type: "action_batch",
          batch: { calls: [{ externalCallId: "call-1", toolName: "vdt.echo", args: {} }] }
        }, { messageId: "message-1", text: "I am building the tree." });
      },
      turn("turn-2", {
        type: "question",
        messageId: "message-2",
        questionSetId: "questions-2",
        questions: [{
          id: "confirm",
          question: "Continue?",
          reason: "Confirm the queued instruction was understood.",
          required: true,
          expectedAnswerType: "text"
        }]
      })
    ]);
    const session = await makeEngine(transport).openSession({
      binding,
      initialContext: {},
      initialContextHash: HASH_A
    }, host(async (call) => call.toolName === "user.ask"
      ? result(call, "waiting_user", "USER_INPUT_REQUIRED", {})
      : result(call, "succeeded", "OK", {})));

    const eventsPromise = collect(session.events());
    await Promise.resolve();
    await session.submit({ type: "user_instruction", text: "Use the revised fleet naming." });
    await expect(session.checkpoint()).resolves.toMatchObject({
      pendingHumanInputs: [{
        type: "user_instruction",
        text: "Use the revised fleet naming."
      }]
    });
    releaseFirstTurn();
    await eventsPromise;

    expect(transport.requests[1]?.delta).toMatchObject({
      type: "checkpoint_inputs",
      checkpointDelta: {
        type: "tool_results",
        results: [{ externalCallId: "call-1", status: "succeeded" }]
      },
      inputs: [{ type: "user_instruction", text: "Use the revised fleet naming." }]
    });
  });

  it("does not publish a final that raced with an accepted queued instruction", async () => {
    let markFinalStarted!: () => void;
    const finalStarted = new Promise<void>((resolve) => {
      markFinalStarted = resolve;
    });
    let releaseFinal!: () => void;
    const finalBlocked = new Promise<void>((resolve) => {
      releaseFinal = resolve;
    });
    const transport = new QueueTransport([
      turn("turn-1", {
        type: "action_batch",
        batch: { calls: [{ externalCallId: "call-1", toolName: "vdt.echo", args: {} }] }
      }, { messageId: "message-1", text: "I am checking the VDT." }),
      async () => {
        markFinalStarted();
        await finalBlocked;
        return turn("turn-2", {
          type: "final",
          messageId: "stale-final",
          finishReceiptId: "finish-receipt-1",
          text: "This final must not be published."
        });
      },
      turn("turn-3", {
        type: "question",
        messageId: "message-3",
        questionSetId: "questions-3",
        questions: [{
          id: "revised-finish",
          question: "Should I finish after applying the queued instruction?",
          reason: "The instruction arrived while the previous final was being generated.",
          required: true,
          expectedAnswerType: "text"
        }]
      })
    ]);
    const session = await makeEngine(transport).openSession({
      binding,
      initialContext: {},
      initialContextHash: HASH_A
    }, host(async (call) => call.toolName === "user.ask"
      ? result(call, "waiting_user", "USER_INPUT_REQUIRED", {})
      : result(call, "succeeded", "OK", {})));

    const eventsPromise = collect(session.events());
    await finalStarted;
    await session.submit({ type: "user_instruction", text: "Add the missing CAT fleet first." });
    releaseFinal();
    const events = await eventsPromise;

    expect(events.some((event) => event.type === "final")).toBe(false);
    expect(events.at(-1)?.type).toBe("question");
    expect(transport.requests[2]?.delta).toEqual({
      type: "human_inputs",
      inputs: [{ type: "user_instruction", text: "Add the missing CAT fleet first." }]
    });
  });

  it("uses the persisted binding resolver for checkpoint recovery", async () => {
    const checkpoint: AgentEngineCheckpoint = {
      schemaVersion: 2,
      checkpointId: "checkpoint-1",
      bindingId: binding.bindingId,
      runId: binding.runId,
      sessionEpoch: 1,
      externalSessionId: null,
      lastConfirmedInput: null,
      lastConfirmedOutput: { cursor: "cursor-old", contentHash: HASH_A },
      activeExchange: null,
      activeToolCall: null,
      finishReceipt: null,
      pendingHumanInputs: [{
        type: "user_instruction",
        text: "Keep the accepted instruction after restart."
      }],
      createdAt: "2026-08-26T10:00:00.000Z"
    };
    const transport = new QueueTransport([
      turn("turn-resume", {
        type: "question",
        messageId: "message-1",
        questionSetId: "questions-1",
        questions: [{
          id: "resume",
          question: "Continue from the saved checkpoint?",
          reason: "The prior process was interrupted.",
          required: true,
          expectedAnswerType: "text"
        }]
      })
    ]);
    const engine = makeEngine(transport, { resolveBinding: () => binding });
    const session = await engine.resumeSession(
      checkpoint,
      host(async (call) => call.toolName === "user.ask"
        ? result(call, "waiting_user", "USER_INPUT_REQUIRED", {})
        : result(call, "succeeded", "OK", {}))
    );

    await collect(session.events());
    expect(transport.requests[0]).toMatchObject({
      previousCursor: "cursor-old",
      delta: {
        type: "checkpoint_inputs",
        checkpointDelta: { type: "recovery", checkpoint: { checkpointId: "checkpoint-1" } },
        inputs: [{
          type: "user_instruction",
          text: "Keep the accepted instruction after restart."
        }]
      }
    });
  });

  it("adopts only the exact next Supervisor recovery epoch for the cached session binding", async () => {
    const transport = new QueueTransport([
      turn("turn-resume", {
        type: "question",
        messageId: "message-1",
        questionSetId: "questions-1",
        questions: [{
          id: "resume",
          question: "Continue from the fenced recovery checkpoint?",
          reason: "The Supervisor committed the exact successor epoch.",
          required: true,
          expectedAnswerType: "text"
        }]
      })
    ]);
    const engine = makeEngine(transport);
    const opened = await engine.openSession({
      binding,
      initialContext: {},
      initialContextHash: HASH_A
    }, host(async (call) => result(call, "waiting_user", "USER_INPUT_REQUIRED", {})));
    await opened.close();

    const checkpoint = recoveryCheckpoint(2);
    const resumed = await engine.resumeSession(
      checkpoint,
      host(async (call) => result(call, "waiting_user", "USER_INPUT_REQUIRED", {}))
    );

    await collect(resumed.events());
    expect(resumed.binding).toMatchObject({
      bindingId: binding.bindingId,
      sessionEpoch: 2
    });
    expect(transport.requests[0]?.binding.sessionEpoch).toBe(2);
  });

  it("refuses to synthesize a skipped recovery epoch for a cached session binding", async () => {
    const engine = makeEngine(new QueueTransport([]));
    const opened = await engine.openSession({
      binding,
      initialContext: {},
      initialContextHash: HASH_A
    }, host(async (call) => result(call, "succeeded", "OK", {})));
    await opened.close();

    await expect(engine.resumeSession(
      recoveryCheckpoint(3),
      host(async (call) => result(call, "succeeded", "OK", {}))
    )).rejects.toMatchObject({ code: "MODEL_RESUME_BINDING_REQUIRED" });
  });
});

class QueueTransport implements ModelAgentTurnTransport {
  readonly requests: ModelAgentTurnRequest[] = [];

  constructor(private readonly outputs: Array<unknown | (() => unknown | Promise<unknown>)>) {}

  async completeTurn(request: ModelAgentTurnRequest): Promise<ModelAgentTurnResponse> {
    this.requests.push(request);
    const queued = this.outputs.shift();
    if (!queued) throw new Error("No queued model turn.");
    const output = typeof queued === "function" ? await queued() : queued;
    return {
      cursor: `cursor-${this.requests.length}`,
      output,
      usage: { inputTokens: 10, outputTokens: 5 }
    };
  }
}

function turn(
  turnId: string,
  action: Record<string, unknown>,
  assistantMessage: { messageId: string; text: string } | null = null
) {
  return {
    turnId,
    sessionState: `Goal: complete the bound VDT run. Confirmed turn: ${turnId}. Pending: execute the returned action.`,
    assistantMessage,
    action
  };
}

function driverBatchTurn(index: number, name = "driver") {
  const action = {
    type: "action_batch",
    batch: { calls: [{
      externalCallId: `driver-call-${index}`,
      toolName: "vdt.add_drivers_batch",
      args: { drivers: [{ parentNodeId: "root", name }] }
    }] }
  };
  return {
    ...turn(`driver-turn-${index}`, action, { messageId: `driver-message-${index}`, text: "I will add the driver." }),
    action
  };
}

function invalidDriverBatch(call: VdtGatewayToolCall): VdtGatewayToolResult {
  return result(call, "failed", "INVALID_TOOL_ARGS", {
    error: {
      code: "INVALID_TOOL_ARGS",
      details: [{ code: "too_small", minimum: 2, type: "array", inclusive: true, path: ["drivers"] }]
    }
  });
}

function makeEngine(
  transport: ModelAgentTurnTransport,
  overrides: Partial<ConstructorParameters<typeof StructuredInProductModelAgentEngine>[0]> = {}
) {
  return new StructuredInProductModelAgentEngine({
    capability,
    transport,
    now: () => "2026-08-26T10:00:00.000Z",
    idFactory: () => "checkpoint-id",
    ...overrides
  });
}

function host(executeTool: AgentEngineHost["executeTool"]): AgentEngineHost {
  return { signal: new AbortController().signal, executeTool };
}

function result(
  call: VdtGatewayToolCall,
  status: VdtGatewayToolResult["status"],
  resultCode: string,
  payload: unknown
): VdtGatewayToolResult {
  return {
    externalCallId: call.externalCallId,
    toolName: call.toolName,
    status,
    resultCode,
    resultHash: HASH_B,
    payload
  };
}

async function collect(events: AsyncIterable<AgentEngineEvent>): Promise<AgentEngineEvent[]> {
  const output: AgentEngineEvent[] = [];
  for await (const event of events) output.push(event);
  return output;
}

function recoveryCheckpoint(sessionEpoch: number): AgentEngineCheckpoint {
  return {
    schemaVersion: 2,
    checkpointId: `checkpoint-${sessionEpoch}`,
    bindingId: binding.bindingId,
    runId: binding.runId,
    sessionEpoch,
    externalSessionId: null,
    lastConfirmedInput: null,
    lastConfirmedOutput: { cursor: "cursor-old", contentHash: HASH_A },
    activeExchange: null,
    activeToolCall: null,
    finishReceipt: null,
    pendingHumanInputs: [],
    createdAt: "2026-08-26T10:00:00.000Z"
  };
}

const binding: AgentSessionBinding = {
  schemaVersion: 2,
  bindingId: "binding-1",
  runId: "run-1",
  projectId: "project-1",
  executionProfile: "model_agent",
  engineId: "model-engine",
  engineAdapterId: "structured-turn-v1",
  backendId: "http-model",
  modelId: "model-1",
  protocolVersion: "model-turn.v1",
  cliVersion: null,
  toolIsolation: "hard_verified",
  qualificationStatus: "qualified",
  capabilityEvidenceHash: HASH_A,
  settingsHash: HASH_A,
  capabilityProfileHash: HASH_B,
  toolCatalogHash: HASH_C,
  externalSessionId: null,
  sessionEpoch: 1,
  boundAt: "2026-08-26T10:00:00.000Z"
};

const capability: Extract<AgentCapabilityProfile, { executionProfile: "model_agent" }> = {
  schemaVersion: 1,
  executionProfile: "model_agent",
  engineId: "model-engine",
  engineAdapterId: "structured-turn-v1",
  backendId: "http-model",
  protocolVersion: "model-turn.v1",
  sessionStrategy: "structured_turn",
  toolCatalogHash: HASH_C,
  toolIsolation: "hard_verified",
  qualification: {
    status: "qualified",
    platform: { os: "test", arch: "test", runtimeVersion: null },
    testedAt: "2026-08-26T10:00:00.000Z",
    evidenceHash: HASH_A
  },
  supportsNativeSession: false,
  supportsResume: true,
  supportsStructuredEvents: true,
  supportsToolBridge: true,
  supportsQuestions: true,
  supportsCancellation: true,
  supportsUsageMetrics: true,
  cli: null
};
