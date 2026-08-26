import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  AgentSupervisorToolGatewayLedger,
  AgentRunEventOutbox,
  InMemoryAgentSupervisorPersistence,
  ToolRegistry,
  VdtToolGateway,
  type AgentCapabilityProfile,
  type AgentEngineCheckpoint,
  type AgentEngineExchangeReceiptV2,
  type AgentSessionBinding,
  type AgentSupervisorPersistence,
  type AgentToolContext,
  type AgentToolOperationReceiptV2,
  type FinishReceiptV2
} from "@vdt-studio/vdt-agent-runtime";
import { openVdtDatabase, type VdtDatabase } from "@vdt-studio/storage";
import {
  ProjectedAgentSupervisorPersistence,
  SqliteAgentSupervisorPersistence
} from "./sqlite-supervisor-persistence";

const NOW = "2026-08-26T10:00:00.000Z";
const createdDirectories: string[] = [];

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("SqliteAgentSupervisorPersistence", () => {
  it("persists all seven Sequence 4 projections and reloads terminal receipts after restart", async () => {
    const fixture = createFixture("restart");
    const first = createAuthority(fixture.database.databasePath);
    const binding = modelBinding(fixture.runId, fixture.projectId);
    await first.createBinding(binding);
    await first.saveCheckpoint(checkpoint(binding, 1, "checkpoint-1", "2026-08-26T09:01:00.000Z"));

    const preparedExchange = exchangeReceipt(binding, "prepared", {
      outputHash: null,
      resultCode: null,
      updatedAt: "2026-08-26T09:02:00.000Z"
    });
    await first.appendExchangeReceipt(preparedExchange);
    await first.appendExchangeReceipt({
      ...preparedExchange,
      state: "completed",
      outputHash: sha("exchange-output"),
      resultCode: "OK",
      updatedAt: "2026-08-26T09:03:00.000Z"
    });

    const tool = completedToolReceipt(binding, 1);
    await first.appendToolOperationReceipt(tool);
    const verified = finishReceipt(binding, "verified");
    await first.appendFinishReceipt(verified);
    const finalPersisted: FinishReceiptV2 = {
      ...verified,
      state: "final_persisted",
      finalMessageHash: sha("final-message"),
      finalPersistedAt: "2026-08-26T09:05:00.000Z"
    };
    await first.appendFinishReceipt(finalPersisted);

    const outbox = new AgentRunEventOutbox(fixture.runId, {
      now: sequenceNow([
        "2026-08-26T09:00:10.000Z",
        "2026-08-26T09:01:10.000Z"
      ]),
      sink: { append: (event) => first.appendEvent(event) }
    });
    await outbox.append({
      type: "runtime_status",
      source: "runtime",
      payload: { code: "SESSION_STARTED", message: "Session started.", state: "running" }
    });
    await outbox.append({
      type: "checkpoint",
      source: "runtime",
      payload: {
        checkpointId: "checkpoint-1",
        checkpointHash: sha("checkpoint-1"),
        reason: "engine_exchange",
        sessionEpoch: 1
      }
    });
    first.close();

    const restarted = createAuthority(fixture.database.databasePath);
    const loaded = await restarted.load(fixture.runId);
    expect(loaded).toMatchObject({
      binding,
      checkpoint: { checkpointId: "checkpoint-1", sessionEpoch: 1 },
      finishReceipt: finalPersisted
    });
    expect(loaded?.exchangeReceipts).toHaveLength(2);
    expect(loaded?.toolOperationReceipts).toEqual([tool]);
    expect(loaded?.eventOutbox).toHaveLength(2);
    expect(await restarted.getToolOperationReceipt(fixture.runId, tool.externalCallId))
      .toEqual(tool);
    expect(await restarted.getFinishReceipt(fixture.runId)).toEqual(finalPersisted);
    expect(await restarted.getExecutionSummary(fixture.runId)).toMatchObject({
      sessionStatus: "completed",
      recoveryStatus: "complete",
      finishState: "final_persisted"
    });

    // Same terminal callback after a lost response is a read-equivalent no-op.
    await restarted.appendToolOperationReceipt(tool);
    await restarted.appendFinishReceipt(finalPersisted);
    expect(tableCount(fixture.database.databasePath, "agent_tool_operation_receipts_v2")).toBe(1);
    expect(tableCount(fixture.database.databasePath, "agent_finish_receipts_v2")).toBe(2);

    // Sequence 4 is additive: the original V1 run remains readable.
    expect(fixture.database.getAgentRun(fixture.runId)).toMatchObject({
      id: fixture.runId,
      projectId: fixture.projectId,
      status: "running"
    });
    restarted.close();
    fixture.database.close();
  });

  it("increments epochs monotonically and rejects stale, future, and epoch-less stale callbacks", async () => {
    const fixture = createFixture("epoch");
    const legacyProjection = new InMemoryAgentSupervisorPersistence();
    const stalePrimary = createAuthority(fixture.database.databasePath);
    const staleSupervisor = new ProjectedAgentSupervisorPersistence(
      stalePrimary,
      legacyProjection
    );
    const binding = modelBinding(fixture.runId, fixture.projectId);
    await staleSupervisor.createBinding(binding);
    await staleSupervisor.saveCheckpoint(
      checkpoint(binding, 1, "checkpoint-epoch-1", "2026-08-26T09:01:00.000Z")
    );
    await staleSupervisor.load(fixture.runId); // Pins this Supervisor instance to epoch 1.

    const resumedPrimary = createAuthority(fixture.database.databasePath);
    const resumedSupervisor = new ProjectedAgentSupervisorPersistence(
      resumedPrimary,
      legacyProjection
    );
    await resumedSupervisor.load(fixture.runId);
    await resumedSupervisor.saveCheckpoint(
      checkpoint(binding, 2, "checkpoint-epoch-2", "2026-08-26T09:02:00.000Z")
    );
    const effectiveBinding = { ...binding, sessionEpoch: 2 };
    expect((await resumedSupervisor.load(fixture.runId))?.binding).toEqual(effectiveBinding);
    await expect(resumedSupervisor.createBinding(effectiveBinding)).resolves.toMatchObject({
      binding: effectiveBinding,
      checkpoint: { sessionEpoch: 2 }
    });
    await expect(resumedSupervisor.createBinding({
      ...effectiveBinding,
      modelId: "different-model"
    })).rejects.toMatchObject({ code: "SESSION_BINDING_CONFLICT" });

    await expect(staleSupervisor.appendToolOperationReceipt(
      completedToolReceipt(binding, 1)
    )).rejects.toMatchObject({ code: "SESSION_EPOCH_MISMATCH" });
    await expect(resumedSupervisor.appendToolOperationReceipt(
      completedToolReceipt(binding, 3)
    )).rejects.toMatchObject({ code: "SESSION_EPOCH_MISMATCH" });
    await resumedSupervisor.appendToolOperationReceipt(completedToolReceipt(binding, 2));

    // A read cannot silently grant the stale Supervisor the resumed epoch.
    await staleSupervisor.load(fixture.runId);
    const staleOutbox = new AgentRunEventOutbox(fixture.runId, {
      now: () => "2026-08-26T09:03:00.000Z",
      sink: { append: (event) => staleSupervisor.appendEvent(event) }
    });
    await expect(staleOutbox.append({
      type: "runtime_status",
      source: "runtime",
      payload: { code: "STALE_CALLBACK", message: "Must be fenced.", state: "running" }
    })).rejects.toMatchObject({ code: "SESSION_EPOCH_MISMATCH" });

    expect(queryOne(fixture.database.databasePath, `
      SELECT COUNT(*) AS count, MAX(session_epoch) AS current_epoch
      FROM agent_session_epochs_v2 WHERE run_id = ?
    `, fixture.runId)).toEqual({ count: 2, current_epoch: 2 });
    expect(queryOne(fixture.database.databasePath, `
      SELECT session_epoch FROM agent_session_bindings_v2 WHERE run_id = ?
    `, fixture.runId)).toEqual({ session_epoch: 1 });
    expect((await resumedSupervisor.load(fixture.runId))?.checkpoint?.sessionEpoch).toBe(2);

    stalePrimary.close();
    resumedPrimary.close();
    fixture.database.close();
  });

  it("replays a primary terminal commit after the compatibility projection loses its response", async () => {
    const fixture = createFixture("commit_response_gap");
    const primary = createAuthority(fixture.database.databasePath);
    const legacy = new InMemoryAgentSupervisorPersistence();
    const crashingProjection = withToolProjectionFailure(legacy);
    const projected = new ProjectedAgentSupervisorPersistence(primary, crashingProjection);
    const binding = modelBinding(fixture.runId, fixture.projectId);
    await projected.createBinding(binding);
    const terminal = completedToolReceipt(binding, 1);

    await expect(projected.appendToolOperationReceipt(terminal))
      .rejects.toThrow("simulated response loss after normalized commit");
    primary.close();

    const restarted = createAuthority(fixture.database.databasePath);
    expect(await restarted.getToolOperationReceipt(fixture.runId, terminal.externalCallId))
      .toEqual(terminal);
    await restarted.appendToolOperationReceipt(terminal);
    expect(tableCount(fixture.database.databasePath, "agent_tool_operation_receipts_v2")).toBe(1);

    restarted.close();
    fixture.database.close();
  });

  it("keeps the live outbox aligned when V1 event projection fails after the V2 commit", async () => {
    const fixture = createFixture("event_projection_gap");
    const primary = createAuthority(fixture.database.databasePath);
    const legacy = new InMemoryAgentSupervisorPersistence();
    const projected = new ProjectedAgentSupervisorPersistence(
      primary,
      withOneEventProjectionFailure(legacy)
    );
    const binding = modelBinding(fixture.runId, fixture.projectId);
    await projected.createBinding(binding);
    const outbox = new AgentRunEventOutbox(fixture.runId, {
      now: sequenceNow([
        "2026-08-26T09:00:10.000Z",
        "2026-08-26T09:00:20.000Z"
      ]),
      sink: { append: (event) => projected.appendEvent(event) }
    });

    const first = await outbox.append({
      type: "runtime_status",
      source: "runtime",
      payload: { code: "SESSION_STARTED", message: "Session started.", state: "running" }
    });

    // The normalized commit succeeded before the injected V1 failure. The
    // append still completes, so process memory does not reuse durable seq 1.
    expect(outbox.snapshot()).toEqual([first]);
    expect(await primary.getEvents(fixture.runId)).toEqual([first]);
    expect(await legacy.getEvents(fixture.runId)).toEqual([]);

    const second = await outbox.append({
      type: "runtime_status",
      source: "runtime",
      payload: { code: "SESSION_ACTIVE", message: "Session is active.", state: "running" }
    });
    expect(second).toMatchObject({ seq: 2, previousHash: first.hash });
    expect(await primary.getEvents(fixture.runId)).toEqual([first, second]);
    expect(await legacy.getEvents(fixture.runId)).toEqual([first, second]);

    // Lost-response replay remains idempotent after deterministic catch-up.
    await expect(projected.appendEvent(first)).resolves.toBeUndefined();
    expect(await primary.getEvents(fixture.runId)).toEqual([first, second]);
    expect(await legacy.getEvents(fixture.runId)).toEqual([first, second]);

    primary.close();
    fixture.database.close();
  });

  it("atomically reserves one tool receipt across independent SQLite authorities", async () => {
    const fixture = createFixture("atomic_reservation");
    const first = createAuthority(fixture.database.databasePath);
    const second = createAuthority(fixture.database.databasePath);
    const binding = modelBinding(fixture.runId, fixture.projectId);
    await first.createBinding(binding);
    await second.load(fixture.runId);
    const terminal = completedToolReceipt(binding, 1);
    const reservation: AgentToolOperationReceiptV2 = {
      ...terminal,
      state: "reserved",
      resultHash: null,
      resultCode: null,
      replayResult: null,
      committedRevision: null,
      updatedAt: terminal.startedAt
    };

    const results = await Promise.all([
      first.reserveToolOperationReceipt(reservation),
      second.reserveToolOperationReceipt(reservation)
    ]);

    expect(results.map((result) => result.acquired).sort()).toEqual([false, true]);
    expect(results[0]?.receipt).toEqual(reservation);
    expect(results[1]?.receipt).toEqual(reservation);
    expect(tableCount(
      fixture.database.databasePath,
      "agent_tool_operation_receipts_v2"
    )).toBe(1);

    first.close();
    second.close();
    fixture.database.close();
  });

  it("replays an approved control-plane apply from SQLite without invoking it twice", async () => {
    const fixture = createFixture("approval_control_replay");
    const first = createAuthority(fixture.database.databasePath);
    const binding = modelBinding(fixture.runId, fixture.projectId);
    await first.createBinding(binding);
    const tools = new ToolRegistry();
    const signal = new AbortController().signal;
    const toolContext = (): AgentToolContext => ({
      runId: binding.runId,
      store: {} as AgentToolContext["store"],
      emit: () => undefined,
      getRun: () => ({ status: "running" }) as ReturnType<AgentToolContext["getRun"]>,
      updateRun: () => undefined,
      signal
    });
    const call = {
      externalCallId: "approval-apply-stable-proposal",
      toolName: "control.apply_approved_proposal",
      args: {
        proposalId: "proposal-sqlite-1",
        selectedChangeIds: ["add-driver-1"]
      }
    } as const;
    let applies = 0;
    const apply = () => {
      applies += 1;
      return {
        status: "succeeded" as const,
        resultCode: "APPROVED_PROPOSAL_APPLIED",
        payload: { proposalId: "proposal-sqlite-1" },
        projectChanged: true
      };
    };
    const firstGateway = new VdtToolGateway({
      binding,
      capability: modelCapability(binding),
      tools,
      toolContext,
      allowedTools: new Set(),
      ledger: new AgentSupervisorToolGatewayLedger({ binding, persistence: first })
    });
    const initial = await firstGateway.executeTrustedControlOperation(call, apply);
    expect(initial).toMatchObject({
      replayed: false,
      result: { status: "succeeded", resultCode: "APPROVED_PROPOSAL_APPLIED" }
    });
    first.close();

    const restarted = createAuthority(fixture.database.databasePath);
    await restarted.load(binding.runId);
    const restartedGateway = new VdtToolGateway({
      binding,
      capability: modelCapability(binding),
      tools,
      toolContext,
      allowedTools: new Set(),
      ledger: new AgentSupervisorToolGatewayLedger({ binding, persistence: restarted })
    });
    const replay = await restartedGateway.executeTrustedControlOperation(call, apply);

    expect(replay).toEqual({ result: initial.result, replayed: true });
    expect(applies).toBe(1);
    expect(await restarted.getToolOperationReceipt(binding.runId, call.externalCallId)).toMatchObject({
      state: "completed",
      toolName: "control.apply_approved_proposal",
      replayResult: initial.result
    });
    expect(queryAll(fixture.database.databasePath, `
      SELECT state, result_code, replay_result_json
      FROM agent_tool_operation_receipts_v2
      WHERE run_id = ? ORDER BY transition_sequence
    `, binding.runId).at(-1)).toMatchObject({
      state: "completed",
      result_code: "APPROVED_PROPOSAL_APPLIED",
      replay_result_json: expect.stringContaining("APPROVED_PROPOSAL_APPLIED")
    });

    restarted.close();
    fixture.database.close();
  });

  it("uses a fresh bounded attempt fence after provider wait instead of holding one lease", async () => {
    const fixture = createFixture("attempt_fence");
    let now = "2026-08-26T10:00:00.000Z";
    let token = 0;
    const authority = new SqliteAgentSupervisorPersistence(fixture.database.databasePath, {
      now: () => now,
      fenceLeaseMs: 60 * 60 * 1_000,
      attemptLeaseMs: 1_000,
      fenceTokenFactory: () => `attempt-fence-${++token}`
    });
    const binding = modelBinding(fixture.runId, fixture.projectId);
    await authority.createBinding(binding);
    const prepared = exchangeReceipt(binding, "in_flight", {
      outputHash: null,
      resultCode: null,
      updatedAt: "2026-08-26T10:00:00.000Z"
    });
    await authority.appendExchangeReceipt(prepared);

    // The first 1-second attempt lease is expired, but no lease was held over
    // inference. The terminal callback acquires a distinct bounded attempt.
    now = "2026-08-26T10:01:00.000Z";
    await authority.appendExchangeReceipt({
      ...prepared,
      state: "completed",
      outputHash: sha("provider-output-after-wait"),
      resultCode: "OK",
      updatedAt: now
    });

    expect(queryAll(fixture.database.databasePath, `
      SELECT write_fence_token, write_fence_expires_at
      FROM agent_engine_exchange_receipts_v2
      WHERE run_id = ? ORDER BY transition_sequence
    `, fixture.runId)).toEqual([
      {
        write_fence_token: "attempt-fence-2",
        write_fence_expires_at: "2026-08-26T10:00:01.000Z"
      },
      {
        write_fence_token: "attempt-fence-3",
        write_fence_expires_at: "2026-08-26T10:01:01.000Z"
      }
    ]);

    authority.close();
    fixture.database.close();
  });

  it("finalizes an origin-epoch finish receipt only under its exact successor owner", async () => {
    const fixture = createFixture("recovered_finish");
    const authority = createAuthority(fixture.database.databasePath);
    const binding = modelBinding(fixture.runId, fixture.projectId);
    const verified = finishReceipt(binding, "verified");
    const finishCheckpoint = {
      receiptId: verified.receiptId,
      state: "verified" as const,
      receiptHash: verified.receiptHash
    };
    await authority.createBinding(binding);
    await authority.appendFinishReceipt(verified);
    await authority.saveCheckpoint({
      ...checkpoint(binding, 1, "checkpoint-finish-origin", "2026-08-26T09:04:40.000Z"),
      finishReceipt: finishCheckpoint
    });
    await authority.saveCheckpoint({
      ...checkpoint(binding, 2, "checkpoint-finish-recovery", "2026-08-26T09:05:00.000Z"),
      finishReceipt: finishCheckpoint
    });

    const messageId = "recovered-final-message";
    const text = "The recovered session confirms the verified VDT.";
    const finalMessageHash = sha(JSON.stringify({ messageId, text }));
    const outbox = new AgentRunEventOutbox(fixture.runId, {
      now: () => "2026-08-26T09:05:30.000Z",
      sink: { append: (event) => authority.appendEvent(event) }
    });
    await outbox.append({
      type: "final",
      source: "vdt_agent",
      sessionId: binding.bindingId,
      messageId,
      payload: {
        text,
        format: "markdown",
        finishReceiptId: verified.receiptId,
        finishReceiptHash: verified.receiptHash
      }
    });
    await expect(outbox.append({
      type: "final",
      source: "vdt_agent",
      sessionId: binding.bindingId,
      messageId: "duplicate-recovered-final",
      payload: {
        text: "A second final must be rejected atomically.",
        format: "markdown",
        finishReceiptId: verified.receiptId,
        finishReceiptHash: verified.receiptHash
      }
    })).rejects.toMatchObject({ code: "DUPLICATE_DURABLE_FINAL" });

    const finalization = {
      schemaVersion: 2 as const,
      runId: binding.runId,
      bindingId: binding.bindingId,
      receiptId: verified.receiptId,
      receiptHash: verified.receiptHash,
      originSessionEpoch: 1,
      recoverySessionEpoch: 2,
      finalMessageHash,
      finalPersistedAt: "2026-08-26T09:05:30.000Z"
    };
    await expect(authority.finalizeRecoveredFinish(finalization)).resolves.toMatchObject({
      state: "final_persisted",
      sessionEpoch: 1,
      finalMessageHash
    });
    await expect(authority.finalizeRecoveredFinish(finalization)).resolves.toMatchObject({
      state: "final_persisted"
    });
    expect(queryAll(fixture.database.databasePath, `
      SELECT transition_sequence, session_epoch, authorization_epoch
      FROM agent_finish_receipts_v2
      WHERE run_id = ? ORDER BY transition_sequence
    `, fixture.runId)).toEqual([
      { transition_sequence: 1, session_epoch: 1, authorization_epoch: 1 },
      { transition_sequence: 2, session_epoch: 1, authorization_epoch: 2 }
    ]);
    await expect(authority.appendFinishReceipt({
      ...verified,
      state: "final_persisted",
      finalMessageHash,
      finalPersistedAt: finalization.finalPersistedAt
    })).rejects.toMatchObject({ code: "SESSION_EPOCH_MISMATCH" });
    await expect(authority.finalizeRecoveredFinish({
      ...finalization,
      recoverySessionEpoch: 3
    })).rejects.toThrow("exact successor session epoch");

    authority.close();
    fixture.database.close();
  });
});

function createFixture(suffix: string): {
  database: VdtDatabase;
  runId: string;
  projectId: string;
} {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `vdt-supervisor-${suffix}-`));
  createdDirectories.push(directory);
  const projectId = `project_${suffix}`;
  const runId = `run_${suffix}`;
  const database = openVdtDatabase(process.cwd(), {
    dataDir: directory,
    now: () => "2026-08-26T09:00:00.000Z"
  });
  database.createProject({ id: projectId, name: `Project ${suffix}` });
  database.createAgentRun({
    id: runId,
    projectId,
    status: "running",
    phase: "planning_decomposition",
    request: { mode: "generate_vdt" },
    publicSnapshot: { runId, status: "running" },
    internalState: { schemaVersion: 1 }
  });
  return { database, runId, projectId };
}

function createAuthority(databasePath: string): SqliteAgentSupervisorPersistence {
  let fence = 0;
  return new SqliteAgentSupervisorPersistence(databasePath, {
    now: () => NOW,
    fenceLeaseMs: 60 * 60 * 1_000,
    fenceTokenFactory: () => `test-fence-${++fence}`
  });
}

function modelBinding(runId: string, projectId: string): AgentSessionBinding {
  return {
    schemaVersion: 2,
    bindingId: `binding:${runId}`,
    runId,
    projectId,
    executionProfile: "model_agent",
    engineId: "in-product-model-agent",
    engineAdapterId: "structured-turn-v1",
    backendId: "test-backend",
    modelId: "test-model",
    protocolVersion: "structured-turn.v1",
    cliVersion: null,
    toolIsolation: "hard_verified",
    qualificationStatus: "unverified",
    capabilityEvidenceHash: null,
    settingsHash: sha("settings"),
    capabilityProfileHash: sha("capability"),
    toolCatalogHash: sha("tools"),
    externalSessionId: null,
    sessionEpoch: 1,
    boundAt: "2026-08-26T09:00:00.000Z"
  };
}

function modelCapability(binding: AgentSessionBinding): AgentCapabilityProfile {
  return {
    schemaVersion: 1,
    executionProfile: "model_agent",
    engineId: binding.engineId,
    engineAdapterId: binding.engineAdapterId,
    backendId: binding.backendId,
    protocolVersion: binding.protocolVersion,
    sessionStrategy: "structured_turn",
    toolCatalogHash: binding.toolCatalogHash,
    toolIsolation: binding.toolIsolation,
    qualification: {
      status: binding.qualificationStatus,
      platform: { os: "test", arch: "test", runtimeVersion: "node-test" },
      testedAt: null,
      evidenceHash: binding.capabilityEvidenceHash
    },
    supportsNativeSession: false,
    supportsResume: true,
    supportsStructuredEvents: true,
    supportsToolBridge: true,
    supportsQuestions: true,
    supportsCancellation: true,
    supportsUsageMetrics: false,
    cli: null
  };
}

function checkpoint(
  binding: AgentSessionBinding,
  sessionEpoch: number,
  checkpointId: string,
  createdAt: string
): AgentEngineCheckpoint {
  return {
    schemaVersion: 2,
    checkpointId,
    bindingId: binding.bindingId,
    runId: binding.runId,
    sessionEpoch,
    externalSessionId: binding.externalSessionId,
    lastConfirmedInput: null,
    lastConfirmedOutput: null,
    activeExchange: null,
    activeToolCall: null,
    finishReceipt: null,
    createdAt
  };
}

function exchangeReceipt(
  binding: AgentSessionBinding,
  state: AgentEngineExchangeReceiptV2["state"],
  patch: Pick<AgentEngineExchangeReceiptV2, "outputHash" | "resultCode" | "updatedAt">
): AgentEngineExchangeReceiptV2 {
  return {
    schemaVersion: 2,
    receiptId: "exchange-receipt-1",
    runId: binding.runId,
    bindingId: binding.bindingId,
    exchangeId: "exchange-1",
    stableCallKey: "turn-1",
    sessionEpoch: 1,
    state,
    inputHash: sha("exchange-input"),
    outputHash: patch.outputHash,
    resultCode: patch.resultCode,
    startedAt: "2026-08-26T09:02:00.000Z",
    updatedAt: patch.updatedAt
  };
}

function completedToolReceipt(
  binding: AgentSessionBinding,
  sessionEpoch: number
): AgentToolOperationReceiptV2 {
  const resultHash = sha(`tool-result-${sessionEpoch}`);
  return {
    schemaVersion: 2,
    receiptId: `tool-receipt-${sessionEpoch}`,
    runId: binding.runId,
    bindingId: binding.bindingId,
    externalCallId: `tool-call-${sessionEpoch}`,
    toolName: "vdt.validate",
    idempotencyKey: `tool-key-${sessionEpoch}`,
    sessionEpoch,
    state: "completed",
    argsHash: sha(`tool-args-${sessionEpoch}`),
    resultHash,
    resultCode: "OK",
    replayResult: {
      externalCallId: `tool-call-${sessionEpoch}`,
      toolName: "vdt.validate",
      status: "succeeded",
      resultCode: "OK",
      resultHash,
      payload: { valid: true }
    },
    expectedRevision: 0,
    committedRevision: 0,
    startedAt: "2026-08-26T09:03:00.000Z",
    updatedAt: "2026-08-26T09:04:00.000Z"
  };
}

function finishReceipt(
  binding: AgentSessionBinding,
  state: "verified"
): FinishReceiptV2 {
  return {
    schemaVersion: 2,
    receiptId: "finish-receipt-1",
    runId: binding.runId,
    bindingId: binding.bindingId,
    sessionEpoch: 1,
    state,
    receiptHash: sha("finish"),
    projectRevision: 0,
    projectHash: sha("project"),
    validationHash: sha("validation"),
    calculationHash: sha("calculation"),
    finalMessageHash: null,
    verifiedAt: "2026-08-26T09:04:30.000Z",
    finalPersistedAt: null
  };
}

function withToolProjectionFailure(
  delegate: AgentSupervisorPersistence
): AgentSupervisorPersistence {
  return {
    load: (runId) => delegate.load(runId),
    createBinding: (binding) => delegate.createBinding(binding),
    saveCheckpoint: (checkpointValue) => delegate.saveCheckpoint(checkpointValue),
    appendExchangeReceipt: (receipt) => delegate.appendExchangeReceipt(receipt),
    getExchangeReceipt: (runId, key) => delegate.getExchangeReceipt(runId, key),
    reserveToolOperationReceipt: async () => {
      throw new Error("simulated response loss after normalized commit");
    },
    appendToolOperationReceipt: async () => {
      throw new Error("simulated response loss after normalized commit");
    },
    getToolOperationReceipt: (runId, callId) => delegate.getToolOperationReceipt(runId, callId),
    appendFinishReceipt: (receipt) => delegate.appendFinishReceipt(receipt),
    finalizeRecoveredFinish: (finalization) => delegate.finalizeRecoveredFinish(finalization),
    getFinishReceipt: (runId) => delegate.getFinishReceipt(runId),
    appendEvent: (event) => delegate.appendEvent(event),
    getEvents: (runId) => delegate.getEvents(runId),
    getExecutionSummary: (runId) => delegate.getExecutionSummary(runId)
  };
}

function withOneEventProjectionFailure(
  delegate: AgentSupervisorPersistence
): AgentSupervisorPersistence {
  let shouldFail = true;
  return {
    load: (runId) => delegate.load(runId),
    createBinding: (binding) => delegate.createBinding(binding),
    saveCheckpoint: (checkpointValue) => delegate.saveCheckpoint(checkpointValue),
    appendExchangeReceipt: (receipt) => delegate.appendExchangeReceipt(receipt),
    getExchangeReceipt: (runId, key) => delegate.getExchangeReceipt(runId, key),
    reserveToolOperationReceipt: (receipt) => delegate.reserveToolOperationReceipt(receipt),
    appendToolOperationReceipt: (receipt) => delegate.appendToolOperationReceipt(receipt),
    getToolOperationReceipt: (runId, callId) => delegate.getToolOperationReceipt(runId, callId),
    appendFinishReceipt: (receipt) => delegate.appendFinishReceipt(receipt),
    finalizeRecoveredFinish: (finalization) => delegate.finalizeRecoveredFinish(finalization),
    getFinishReceipt: (runId) => delegate.getFinishReceipt(runId),
    appendEvent: async (event) => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("simulated V1 event projection failure after normalized commit");
      }
      await delegate.appendEvent(event);
    },
    getEvents: (runId) => delegate.getEvents(runId),
    getExecutionSummary: (runId) => delegate.getExecutionSummary(runId)
  };
}

function tableCount(databasePath: string, table: string): number {
  const allowed = new Set([
    "agent_tool_operation_receipts_v2",
    "agent_finish_receipts_v2"
  ]);
  if (!allowed.has(table)) throw new TypeError("Unexpected test table.");
  const db = new DatabaseSync(databasePath);
  try {
    return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
  } finally {
    db.close();
  }
}

function queryOne(databasePath: string, sql: string, parameter: string): Record<string, unknown> {
  const db = new DatabaseSync(databasePath);
  try {
    return db.prepare(sql).get(parameter) as Record<string, unknown>;
  } finally {
    db.close();
  }
}

function queryAll(databasePath: string, sql: string, parameter: string): Record<string, unknown>[] {
  const db = new DatabaseSync(databasePath);
  try {
    return db.prepare(sql).all(parameter) as Record<string, unknown>[];
  } finally {
    db.close();
  }
}

function sequenceNow(values: readonly string[]): () => string {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)]!;
}

function sha(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
