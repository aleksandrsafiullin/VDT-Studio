import { describe, expect, it } from "vitest";
import { productionVolumeProject } from "@vdt-studio/vdt-core";
import type { AgentSessionBinding } from "./agent-execution-contracts";
import type { AgentSupervisorPersistenceStateV2 } from "./agent-supervisor-persistence";
import { verifyDeterministicRunFinish } from "./finish-verifier";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

describe("verifyDeterministicRunFinish", () => {
  it("creates an idempotent FinishReceiptV2 only for a valid calculable head", () => {
    const first = verifyDeterministicRunFinish({
      ...readyInput(),
      now: () => "2026-08-26T10:00:00.000Z"
    });
    expect(first).toMatchObject({
      accepted: true,
      code: "FINISH_VERIFIED",
      finishReceipt: {
        state: "verified",
        projectRevision: 7,
        finalMessageHash: null
      },
      payload: { rootValue: expect.any(Number) }
    });

    const replay = verifyDeterministicRunFinish({
      ...readyInput(),
      existingFinishReceipt: first.finishReceipt,
      now: () => "2026-08-26T11:00:00.000Z"
    });
    expect(replay.finishReceipt).toEqual(first.finishReceipt);
  });

  it("rejects stale heads and pending control-plane work before graph inspection", () => {
    const result = verifyDeterministicRunFinish({
      ...readyInput(),
      currentRevision: 8,
      pendingQuestion: true,
      pendingApproval: true,
      pendingProposal: true,
      ambiguousOperation: true
    });
    expect(result).toMatchObject({
      accepted: false,
      code: "STALE_PROJECT_REVISION"
    });
    expect((result.payload.blockers as Array<{ code: string }>).map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "STALE_PROJECT_REVISION",
        "PENDING_QUESTION",
        "PENDING_APPROVAL",
        "PENDING_PROPOSAL",
        "OPERATION_LEDGER_NOT_SETTLED"
      ])
    );
  });

  it("returns a compact formula backlog rejection for incomplete calculated nodes", () => {
    const project = structuredClone(productionVolumeProject);
    const calculated = project.graph.nodes.find((node) => node.id === "average_productivity")!;
    calculated.formula = undefined;
    const result = verifyDeterministicRunFinish({ ...readyInput(), project });
    expect(result).toMatchObject({
      accepted: false,
      code: "FORMULA_BACKLOG_NOT_EMPTY",
      payload: { formulaBacklogCount: 1 }
    });
  });

  it("enforces mode-specific completion for deepen_node", () => {
    expect(verifyDeterministicRunFinish({
      ...readyInput(),
      mode: "deepen_node",
      modeCompletion: { immediateChildCreated: false }
    })).toMatchObject({ accepted: false, code: "MODE_COMPLETION_MISSING" });

    expect(verifyDeterministicRunFinish({
      ...readyInput(),
      mode: "deepen_node",
      modeCompletion: { immediateChildCreated: true },
      now: () => "2026-08-26T10:00:00.000Z"
    })).toMatchObject({ accepted: true, code: "FINISH_VERIFIED" });

    const incomplete = structuredClone(productionVolumeProject);
    incomplete.graph.nodes.find((node) => node.id === "average_productivity")!.formula = undefined;
    expect(verifyDeterministicRunFinish({
      ...readyInput(),
      project: incomplete,
      mode: "deepen_node",
      modeCompletion: { immediateChildCreated: true }
    })).toMatchObject({ accepted: false, code: "FORMULA_BACKLOG_NOT_EMPTY" });
  });

  it("evaluates only latest ledger states and permits the currently executing finish request", () => {
    const state = supervisorStateWithSettledHistory();
    expect(verifyDeterministicRunFinish({
      ...readyInput(),
      supervisorState: state,
      currentFinishCallId: "finish-call",
      now: () => "2026-08-26T10:00:03.000Z"
    })).toMatchObject({ accepted: true, code: "FINISH_VERIFIED" });

    expect(verifyDeterministicRunFinish({
      ...readyInput(),
      supervisorState: state
    })).toMatchObject({ accepted: false, code: "OPERATION_LEDGER_NOT_SETTLED" });

    state.toolOperationReceipts.push({
      ...state.toolOperationReceipts[0]!,
      receiptId: "tool-receipt-ambiguous",
      externalCallId: "old-ambiguous-call",
      idempotencyKey: "tool-key-ambiguous",
      state: "ambiguous",
      resultCode: "AMBIGUOUS_TOOL_RECOVERY",
      startedAt: "2026-08-26T10:00:03.000Z",
      updatedAt: "2026-08-26T10:00:03.000Z"
    });
    expect(verifyDeterministicRunFinish({
      ...readyInput(),
      supervisorState: state
    })).toMatchObject({ accepted: false, code: "OPERATION_LEDGER_NOT_SETTLED" });
  });
});

function readyInput() {
  return {
    binding,
    project: structuredClone(productionVolumeProject),
    currentRevision: 7,
    expectedHeadRevision: 7,
    mode: "generate_vdt" as const,
    pendingQuestion: false,
    pendingApproval: false,
    pendingProposal: false,
    ambiguousOperation: false
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
  backendId: "model-backend",
  modelId: "model-1",
  protocolVersion: "model-turn.v1",
  cliVersion: null,
  toolIsolation: "hard_verified",
  qualificationStatus: "qualified",
  capabilityEvidenceHash: HASH_B,
  settingsHash: HASH_A,
  capabilityProfileHash: HASH_B,
  toolCatalogHash: HASH_A,
  externalSessionId: null,
  sessionEpoch: 1,
  boundAt: "2026-08-26T10:00:00.000Z"
};

function supervisorStateWithSettledHistory(): AgentSupervisorPersistenceStateV2 {
  return {
    schemaVersion: 2,
    binding,
    checkpoint: {
      schemaVersion: 2,
      checkpointId: "checkpoint-finish-in-flight",
      bindingId: binding.bindingId,
      runId: binding.runId,
      sessionEpoch: binding.sessionEpoch,
      externalSessionId: null,
      lastConfirmedInput: null,
      lastConfirmedOutput: null,
      activeExchange: null,
      activeToolCall: {
        externalCallId: "finish-call",
        toolName: "run.request_finish",
        state: "in_flight"
      },
      finishReceipt: null,
      createdAt: "2026-08-26T10:00:02.000Z"
    },
    exchangeReceipts: [
      {
        schemaVersion: 2,
        receiptId: "exchange-receipt-1",
        runId: binding.runId,
        bindingId: binding.bindingId,
        exchangeId: "exchange-1",
        stableCallKey: "turn-1",
        sessionEpoch: 1,
        state: "in_flight",
        inputHash: HASH_A,
        outputHash: null,
        resultCode: null,
        startedAt: "2026-08-26T10:00:00.000Z",
        updatedAt: "2026-08-26T10:00:00.000Z"
      },
      {
        schemaVersion: 2,
        receiptId: "exchange-receipt-1",
        runId: binding.runId,
        bindingId: binding.bindingId,
        exchangeId: "exchange-1",
        stableCallKey: "turn-1",
        sessionEpoch: 1,
        state: "completed",
        inputHash: HASH_A,
        outputHash: HASH_B,
        resultCode: "OK",
        startedAt: "2026-08-26T10:00:00.000Z",
        updatedAt: "2026-08-26T10:00:01.000Z"
      }
    ],
    toolOperationReceipts: [
      {
        schemaVersion: 2,
        receiptId: "tool-receipt-finish",
        runId: binding.runId,
        bindingId: binding.bindingId,
        externalCallId: "finish-call",
        toolName: "run.request_finish",
        idempotencyKey: "tool-key-finish",
        sessionEpoch: 1,
        state: "in_flight",
        argsHash: HASH_A,
        resultHash: null,
        resultCode: null,
        expectedRevision: 7,
        committedRevision: null,
        startedAt: "2026-08-26T10:00:02.000Z",
        updatedAt: "2026-08-26T10:00:02.000Z"
      }
    ],
    finishReceipt: null,
    eventOutbox: [],
    updatedAt: "2026-08-26T10:00:02.000Z"
  };
}
