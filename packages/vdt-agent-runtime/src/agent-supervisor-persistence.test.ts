import { describe, expect, it, vi } from "vitest";
import { AgentRunEventOutbox } from "./agent-event-outbox";
import type {
  AgentEngineCheckpoint,
  AgentSessionBinding
} from "./agent-execution-contracts";
import {
  AgentRunStateSupervisorPersistence,
  AgentSupervisorPersistenceError,
  InMemoryAgentSupervisorPersistence,
  agentSupervisorPersistenceStateV2Schema,
  agentToolOperationReceiptV2Schema,
  type AgentEngineExchangeReceiptV2,
  type AgentToolOperationReceiptV2,
  type FinishReceiptV2
} from "./agent-supervisor-persistence";
import {
  AgentRunStore,
  hydrateAgentRunState,
  serializeAgentRunState,
  type AgentRunPersistence,
  type PersistedAgentRunState
} from "./run-store";
import type {
  VdtAgentEvent,
  VdtAgentRunSnapshot,
  VdtAgentRunState
} from "./types";

const hashA = `sha256:${"a".repeat(64)}`;
const hashB = `sha256:${"b".repeat(64)}`;
const hashC = `sha256:${"c".repeat(64)}`;
const startedAt = "2026-08-26T10:00:00.000Z";
const laterAt = "2026-08-26T10:01:00.000Z";

describe("AgentSupervisorPersistence", () => {
  it("keeps the session binding immutable and receipts append-only", async () => {
    const persistence = new InMemoryAgentSupervisorPersistence();
    const binding = makeBinding();

    await expect(persistence.createBinding(binding)).resolves.toMatchObject({
      schemaVersion: 2,
      binding
    });
    await expect(persistence.createBinding(binding)).resolves.toMatchObject({ binding });
    await expect(persistence.createBinding({
      ...binding,
      modelId: "different-model"
    })).rejects.toMatchObject({
      code: "SESSION_BINDING_CONFLICT"
    } satisfies Partial<AgentSupervisorPersistenceError>);

    const prepared = makeExchangeReceipt({ state: "prepared" });
    const completed: AgentEngineExchangeReceiptV2 = {
      ...prepared,
      state: "completed",
      outputHash: hashB,
      resultCode: "OK",
      updatedAt: laterAt
    };
    await persistence.appendExchangeReceipt(prepared);
    await persistence.appendExchangeReceipt(prepared);
    await persistence.appendExchangeReceipt(completed);

    const state = await persistence.load(binding.runId);
    expect(state?.exchangeReceipts).toEqual([prepared, completed]);
    expect(await persistence.getExchangeReceipt(binding.runId, prepared.stableCallKey))
      .toEqual(completed);

    await expect(persistence.appendExchangeReceipt({
      ...prepared,
      state: "in_flight",
      updatedAt: laterAt
    })).rejects.toMatchObject({
      code: "RECEIPT_STATE_REGRESSION"
    } satisfies Partial<AgentSupervisorPersistenceError>);

    await expect(persistence.appendToolOperationReceipt(makeToolReceipt({
      sessionEpoch: binding.sessionEpoch + 1
    }))).rejects.toMatchObject({
      code: "SESSION_EPOCH_MISMATCH"
    } satisfies Partial<AgentSupervisorPersistenceError>);
  });

  it("finalizes a previously unresolved external session ID exactly once", async () => {
    const persistence = new InMemoryAgentSupervisorPersistence();
    const provisional = makeBinding({ externalSessionId: null });
    await persistence.createBinding(provisional);
    await expect(persistence.createBinding({
      ...provisional,
      externalSessionId: "cursor-session-final"
    })).resolves.toMatchObject({
      binding: { externalSessionId: "cursor-session-final" }
    });
    await expect(persistence.createBinding({
      ...provisional,
      externalSessionId: "cursor-session-other"
    })).rejects.toMatchObject({ code: "SESSION_BINDING_CONFLICT" });
  });

  it("marks interrupted exchange and tool work ambiguous on process recovery", async () => {
    const persistence = new InMemoryAgentSupervisorPersistence();
    const binding = makeBinding();
    await persistence.createBinding(binding);
    await persistence.appendExchangeReceipt(makeExchangeReceipt({ state: "in_flight" }));
    await persistence.appendToolOperationReceipt(makeToolReceipt({ state: "in_flight" }));
    await persistence.saveCheckpoint(makeCheckpoint({
      activeExchange: {
        exchangeId: "exchange-1",
        stableCallKey: "exchange-key-1",
        state: "in_flight"
      },
      activeToolCall: {
        externalCallId: "call-1",
        toolName: "vdt.add_driver",
        state: "in_flight"
      }
    }));

    const durableJson = await persistence.load(binding.runId);
    expect(durableJson).not.toBeNull();
    const recovered = new InMemoryAgentSupervisorPersistence([durableJson!]);
    const state = await recovered.load(binding.runId);

    expect(state?.checkpoint?.activeExchange?.state).toBe("ambiguous");
    expect(state?.checkpoint?.activeToolCall?.state).toBe("ambiguous");
    expect(await recovered.getExchangeReceipt(binding.runId, "exchange-key-1"))
      .toMatchObject({ state: "ambiguous", resultCode: "AMBIGUOUS_EXCHANGE_RECOVERY" });
    expect(await recovered.getToolOperationReceipt(binding.runId, "call-1"))
      .toMatchObject({ state: "ambiguous", resultCode: "AMBIGUOUS_TOOL_RECOVERY" });
    await expect(recovered.getExecutionSummary(binding.runId)).resolves.toMatchObject({
      schemaVersion: 2,
      sessionStatus: "recovery_required",
      recoveryStatus: "ambiguous"
    });
  });

  it("reconciles a stale in-flight checkpoint from terminal same-key receipts", async () => {
    const persistence = new InMemoryAgentSupervisorPersistence();
    const binding = makeBinding();
    await persistence.createBinding(binding);
    const exchange = makeExchangeReceipt({ state: "in_flight" });
    const tool = makeToolReceipt({ state: "in_flight" });
    await persistence.appendExchangeReceipt(exchange);
    await persistence.appendExchangeReceipt({
      ...exchange,
      state: "completed",
      outputHash: hashB,
      resultCode: "OK",
      updatedAt: laterAt
    });
    await persistence.appendToolOperationReceipt(tool);
    await persistence.appendToolOperationReceipt({
      ...tool,
      state: "completed",
      resultHash: hashB,
      resultCode: "OK",
      committedRevision: 1,
      updatedAt: laterAt
    });
    await persistence.saveCheckpoint(makeCheckpoint({
      activeExchange: {
        exchangeId: exchange.exchangeId,
        stableCallKey: exchange.stableCallKey,
        state: "in_flight"
      },
      activeToolCall: {
        externalCallId: tool.externalCallId,
        toolName: tool.toolName,
        state: "in_flight"
      }
    }));

    const durableJson = await persistence.load(binding.runId);
    const recovered = new InMemoryAgentSupervisorPersistence([durableJson!]);
    const state = await recovered.load(binding.runId);
    expect(state?.checkpoint?.activeExchange?.state).toBe("completed");
    expect(state?.checkpoint?.activeToolCall?.state).toBe("completed");
    await expect(recovered.getExecutionSummary(binding.runId)).resolves.not.toMatchObject({
      recoveryStatus: "ambiguous"
    });
  });

  it("persists finish verification separately from the agent-authored final", async () => {
    const persistence = new InMemoryAgentSupervisorPersistence();
    await persistence.createBinding(makeBinding());
    const verified = makeFinishReceipt();
    await persistence.appendFinishReceipt(verified);

    await expect(persistence.getExecutionSummary("run-1")).resolves.toMatchObject({
      sessionStatus: "finishing",
      recoveryStatus: "resumable",
      pendingOperation: "final_message",
      finishState: "verified"
    });

    const finalPersisted: FinishReceiptV2 = {
      ...verified,
      state: "final_persisted",
      finalMessageHash: hashC,
      finalPersistedAt: laterAt
    };
    await persistence.appendFinishReceipt(finalPersisted);
    expect(await persistence.getFinishReceipt("run-1")).toEqual(finalPersisted);
    await expect(persistence.getExecutionSummary("run-1")).resolves.toMatchObject({
      sessionStatus: "completed",
      recoveryStatus: "complete",
      finishState: "final_persisted"
    });
  });

  it("persists exactly one final event while keeping exact replay idempotent", async () => {
    const persistence = new InMemoryAgentSupervisorPersistence();
    const binding = makeBinding();
    await persistence.createBinding(binding);
    const outbox = new AgentRunEventOutbox(binding.runId, {
      now: fixedClock(startedAt),
      sink: { append: (event) => persistence.appendEvent(event) }
    });
    const final = await outbox.append({
      type: "final",
      source: "external_agent",
      sessionId: binding.bindingId,
      messageId: "final-message-1",
      payload: {
        text: "One durable final.",
        format: "markdown",
        finishReceiptId: "finish-receipt-1",
        finishReceiptHash: hashA
      }
    });
    await expect(persistence.appendEvent(final)).resolves.toBeUndefined();
    await expect(outbox.append({
      type: "final",
      source: "external_agent",
      sessionId: binding.bindingId,
      messageId: "final-message-2",
      payload: {
        text: "A conflicting second final.",
        format: "markdown",
        finishReceiptId: "finish-receipt-1",
        finishReceiptHash: hashA
      }
    })).rejects.toMatchObject({ code: "DUPLICATE_DURABLE_FINAL" });
    await expect(persistence.getEvents(binding.runId)).resolves.toEqual([final]);
  });

  it("stores full V2 recovery state only in internal JSON and exposes a compact summary", async () => {
    const durable = new Map<string, PersistedAgentRunState>();
    const snapshots = new Map<string, VdtAgentRunSnapshot>();
    const persistence = mapRunPersistence(durable, snapshots);
    const store = new AgentRunStore({
      now: fixedClock(startedAt),
      persistence
    });
    const run = store.createRun({
      mode: "generate_vdt",
      input: { rootKpi: "Ore hauled" },
      providerId: "cursor_subscription"
    });
    const binding = makeBinding({ runId: run.runId });
    const supervisorPersistence = new AgentRunStateSupervisorPersistence(store);

    await supervisorPersistence.createBinding(binding);
    await supervisorPersistence.appendToolOperationReceipt(makeToolReceipt({
      runId: run.runId,
      bindingId: binding.bindingId,
      state: "in_flight"
    }));
    await supervisorPersistence.saveCheckpoint(makeCheckpoint({
      runId: run.runId,
      bindingId: binding.bindingId,
      activeToolCall: {
        externalCallId: "call-1",
        toolName: "vdt.add_driver",
        state: "in_flight"
      }
    }));

    const publicSnapshot = store.getSnapshot(run.runId);
    expect(publicSnapshot.executionSummary).toMatchObject({
      schemaVersion: 2,
      executionProfile: "external_cli_agent",
      engineAdapterId: "cursor-acp-v1",
      backendId: "cursor",
      modelId: "grok-4.6-medium",
      externalSessionBound: true,
      pendingOperation: "tool_call"
    });
    const publicJson = JSON.stringify(publicSnapshot);
    expect(publicJson).not.toContain("cursor-session-secret");
    expect(publicJson).not.toContain("settingsHash");
    expect(publicJson).not.toContain("toolOperationReceipts");
    expect(publicJson).not.toContain("argsHash");

    const internal = durable.get(run.runId);
    expect(internal).toMatchObject({
      schemaVersion: 2,
      supervisorPersistenceV2: {
        schemaVersion: 2,
        binding: { externalSessionId: "cursor-session-secret" },
        checkpoint: { schemaVersion: 2 },
        toolOperationReceipts: [{ schemaVersion: 2, externalCallId: "call-1" }]
      }
    });

    const recoveredStore = new AgentRunStore({ persistence });
    expect(recoveredStore.has(run.runId)).toBe(true);
    const recoveredAdapter = new AgentRunStateSupervisorPersistence(recoveredStore);
    await expect(recoveredAdapter.getToolOperationReceipt(run.runId, "call-1"))
      .resolves.toMatchObject({ state: "ambiguous", resultCode: "AMBIGUOUS_TOOL_RECOVERY" });
    expect(recoveredStore.getSnapshot(run.runId).executionSummary).toMatchObject({
      sessionStatus: "recovery_required",
      recoveryStatus: "ambiguous"
    });
  });

  it("accepts legacy unversioned run JSON but rejects unknown future versions", () => {
    const store = new AgentRunStore({ now: fixedClock(startedAt) });
    const state = store.createRun({
      mode: "generate_vdt",
      input: { rootKpi: "Revenue" },
      providerId: "mock"
    });
    const persisted = serializeAgentRunState(state);
    const { schemaVersion: _schemaVersion, ...legacy } = persisted;

    expect(hydrateAgentRunState(legacy as PersistedAgentRunState)).toMatchObject({
      runId: state.runId,
      status: "queued"
    });
    expect(() => hydrateAgentRunState({
      ...persisted,
      schemaVersion: 3
    } as unknown as PersistedAgentRunState)).toThrow(/Unsupported persisted agent run state schemaVersion/);
  });

  it("persists and deduplicates the V2 hash-chained outbox", async () => {
    const persistence = new InMemoryAgentSupervisorPersistence();
    await persistence.createBinding(makeBinding());
    const outbox = new AgentRunEventOutbox("run-1", {
      now: fixedClock(startedAt)
    });
    const event = await outbox.append({
      type: "runtime_status",
      source: "runtime",
      payload: { code: "SESSION_STARTED", message: "The agent session started." }
    });

    await persistence.appendEvent(event);
    await persistence.appendEvent(event);
    await expect(persistence.getEvents("run-1")).resolves.toEqual([event]);

    await expect(persistence.appendEvent({
      ...event,
      hash: hashB
    })).rejects.toMatchObject({ code: "EVENT_SEQUENCE_CONFLICT" });
  });

  it("rejects arbitrary prompt and result payload fields from durable V2 records", async () => {
    const persistence = new InMemoryAgentSupervisorPersistence();
    const state = await persistence.createBinding(makeBinding());
    expect(agentSupervisorPersistenceStateV2Schema.safeParse({
      ...state,
      rawPrompt: "do not persist this"
    }).success).toBe(false);
    expect(agentToolOperationReceiptV2Schema.safeParse({
      ...makeToolReceipt({ state: "completed" }),
      resultHash: hashB,
      resultCode: "OK",
      payload: { apiKey: "do not persist this" }
    }).success).toBe(false);
  });
});

function makeBinding(overrides: Partial<AgentSessionBinding> = {}): AgentSessionBinding {
  return {
    schemaVersion: 2,
    bindingId: "binding-1",
    runId: "run-1",
    projectId: "project-1",
    executionProfile: "external_cli_agent",
    engineId: "cursor-acp",
    engineAdapterId: "cursor-acp-v1",
    backendId: "cursor",
    modelId: "grok-4.6-medium",
    protocolVersion: "acp-v1",
    cliVersion: "2026.08",
    toolIsolation: "hard_verified",
    qualificationStatus: "qualified",
    capabilityEvidenceHash: hashB,
    settingsHash: hashA,
    capabilityProfileHash: hashB,
    toolCatalogHash: hashC,
    externalSessionId: "cursor-session-secret",
    sessionEpoch: 1,
    boundAt: startedAt,
    ...overrides
  };
}

function makeCheckpoint(
  overrides: Partial<AgentEngineCheckpoint> = {}
): AgentEngineCheckpoint {
  return {
    schemaVersion: 2,
    checkpointId: "checkpoint-1",
    bindingId: "binding-1",
    runId: "run-1",
    sessionEpoch: 1,
    externalSessionId: "cursor-session-secret",
    lastConfirmedInput: { cursor: "input-1", contentHash: hashA },
    lastConfirmedOutput: { cursor: "output-1", contentHash: hashB },
    activeExchange: null,
    activeToolCall: null,
    finishReceipt: null,
    createdAt: startedAt,
    ...overrides
  };
}

function makeExchangeReceipt(
  overrides: Partial<AgentEngineExchangeReceiptV2> = {}
): AgentEngineExchangeReceiptV2 {
  return {
    schemaVersion: 2,
    receiptId: "exchange-receipt-1",
    runId: "run-1",
    bindingId: "binding-1",
    exchangeId: "exchange-1",
    stableCallKey: "exchange-key-1",
    sessionEpoch: 1,
    state: "prepared",
    inputHash: hashA,
    outputHash: null,
    resultCode: null,
    startedAt,
    updatedAt: startedAt,
    ...overrides
  };
}

function makeToolReceipt(
  overrides: Partial<AgentToolOperationReceiptV2> = {}
): AgentToolOperationReceiptV2 {
  return {
    schemaVersion: 2,
    receiptId: "tool-receipt-1",
    runId: "run-1",
    bindingId: "binding-1",
    externalCallId: "call-1",
    toolName: "vdt.add_driver",
    idempotencyKey: "tool-run-1-call-1",
    sessionEpoch: 1,
    state: "reserved",
    argsHash: hashA,
    resultHash: null,
    resultCode: null,
    expectedRevision: 0,
    committedRevision: null,
    startedAt,
    updatedAt: startedAt,
    ...overrides
  };
}

function makeFinishReceipt(): FinishReceiptV2 {
  return {
    schemaVersion: 2,
    receiptId: "finish-receipt-1",
    runId: "run-1",
    bindingId: "binding-1",
    sessionEpoch: 1,
    state: "verified",
    receiptHash: hashA,
    projectRevision: 7,
    projectHash: hashB,
    validationHash: hashC,
    calculationHash: hashA,
    finalMessageHash: null,
    verifiedAt: startedAt,
    finalPersistedAt: null
  };
}

function mapRunPersistence(
  durable: Map<string, PersistedAgentRunState>,
  snapshots: Map<string, VdtAgentRunSnapshot>
): AgentRunPersistence {
  const persist = (state: VdtAgentRunState) => {
    const serialized = serializeAgentRunState(state);
    durable.set(state.runId, structuredClone(serialized));
    snapshots.set(state.runId, structuredClone(serialized.snapshot));
  };
  return {
    createRun: vi.fn(persist),
    updateRun: vi.fn(persist),
    appendEvent: vi.fn((_event: VdtAgentEvent, state: VdtAgentRunState) => persist(state)),
    getState: vi.fn((runId: string) => {
      const state = durable.get(runId);
      return state ? hydrateAgentRunState(structuredClone(state)) : null;
    }),
    getSnapshot: vi.fn((runId: string) => snapshots.get(runId) ?? null)
  };
}

function fixedClock(value: string): () => string {
  return () => value;
}
