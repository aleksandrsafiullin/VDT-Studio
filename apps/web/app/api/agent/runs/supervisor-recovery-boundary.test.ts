import {
  AgentRunStateSupervisorPersistence,
  type AgentSessionBinding
} from "@vdt-studio/vdt-agent-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentExecutionBindingRegistry, agentRuntime } from "./runtime";
import {
  PublicSupervisorRunError,
  cancelStructuredModelAgentRun,
  compactSupervisorAwareSnapshot,
  currentModelAgentToolCatalogHash,
  deriveModelAgentSessionBindingId,
  handleStructuredModelAgentMessage,
  resetActiveSupervisorRunsForTests
} from "./supervisor-runtime";

const HASH = `sha256:${"a".repeat(64)}`;

describe("public structured Model Agent recovery boundary", () => {
  beforeEach(() => {
    vi.stubEnv("VDT_APP_MODE", "development_web");
    resetActiveSupervisorRunsForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetActiveSupervisorRunsForTests();
  });

  it("fails closed after controller loss without creating a provider/session or advancing the durable epoch", async () => {
    const executionBindingId = `recovery_boundary_${Date.now()}`;
    const state = agentRuntime.store.createRun({
      mode: "generate_vdt",
      input: { rootKpi: "Ore hauled" },
      workspace: { projectId: `recovery_project_${Date.now()}` },
      executionBindingId,
      providerId: "model_agent"
    });
    const boundAt = "2026-08-26T10:00:00.000Z";
    const binding: AgentSessionBinding = {
      schemaVersion: 2,
      bindingId: deriveModelAgentSessionBindingId(executionBindingId, state.runId),
      runId: state.runId,
      projectId: state.request.workspace!.projectId,
      executionProfile: "model_agent",
      engineId: "in-product-model-agent",
      engineAdapterId: "http-structured-turn-test-v1",
      backendId: "openai_compatible",
      modelId: "server-owned-model",
      protocolVersion: "structured-turn-v1",
      cliVersion: null,
      toolIsolation: "permission_only",
      qualificationStatus: "unverified",
      capabilityEvidenceHash: null,
      settingsHash: HASH,
      capabilityProfileHash: HASH,
      toolCatalogHash: currentModelAgentToolCatalogHash(),
      externalSessionId: null,
      sessionEpoch: 1,
      boundAt
    };
    const persistence = new AgentRunStateSupervisorPersistence(agentRuntime.store);
    await persistence.createBinding(binding);
    await persistence.saveCheckpoint({
      schemaVersion: 2,
      checkpointId: "checkpoint-waiting-user",
      bindingId: binding.bindingId,
      runId: state.runId,
      sessionEpoch: 1,
      externalSessionId: null,
      lastConfirmedInput: { cursor: "turn-1-input", contentHash: HASH },
      lastConfirmedOutput: { cursor: "provider-cursor-1", contentHash: HASH },
      activeExchange: null,
      activeToolCall: null,
      finishReceipt: null,
      createdAt: "2026-08-26T10:00:01.000Z"
    });
    agentRuntime.store.updateRun(state.runId, {
      status: "needs_user_input",
      phase: "asking_clarifying_questions",
      pendingQuestions: [{
        id: "period",
        question: "Which period?",
        reason: "A time basis is required.",
        required: true,
        expectedAnswerType: "text"
      }]
    });

    const bindingResolve = vi.spyOn(agentExecutionBindingRegistry, "resolve");
    const before = structuredClone(agentRuntime.store.getState(state.runId).supervisorPersistenceV2);
    const snapshot = await compactSupervisorAwareSnapshot(agentRuntime.store.getSnapshot(state.runId));

    expect(snapshot.executionSummary).toMatchObject({
      sessionStatus: "recovery_required",
      recoveryStatus: "recovery_required",
      sessionEpoch: 1
    });
    await expect(handleStructuredModelAgentMessage(state.runId, {
      type: "user_answer",
      answers: { period: "year" }
    })).rejects.toEqual(expect.objectContaining<Partial<PublicSupervisorRunError>>({
      code: "MODEL_AGENT_RECOVERY_REQUIRED",
      status: 409
    }));
    await expect(cancelStructuredModelAgentRun(state.runId)).rejects.toEqual(
      expect.objectContaining<Partial<PublicSupervisorRunError>>({
        code: "MODEL_AGENT_RECOVERY_REQUIRED",
        status: 409
      })
    );

    expect(bindingResolve).not.toHaveBeenCalled();
    expect(agentRuntime.store.getState(state.runId).supervisorPersistenceV2).toEqual(before);
    expect(agentRuntime.store.getState(state.runId).supervisorPersistenceV2?.binding.sessionEpoch).toBe(1);
    expect(agentRuntime.store.getState(state.runId).supervisorPersistenceV2?.checkpoint?.sessionEpoch).toBe(1);
  });
});
