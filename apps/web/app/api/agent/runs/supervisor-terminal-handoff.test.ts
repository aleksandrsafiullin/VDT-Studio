import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VdtRunSupervisor, type AgentCapabilityProfile } from "@vdt-studio/vdt-agent-runtime";
import { createIncomingGraphFixture } from "../../../../../../packages/vdt-core/src/suggestions/incoming-contract.fixtures";
import { POST as startRun } from "./route";
import { POST as cancelRun } from "./[runId]/cancel/route";
import { agentExecutionBindingRegistry, agentRuntime } from "./runtime";
import { cancelStructuredModelAgentRun, currentModelAgentToolCatalogHash, getPersistedSupervisorEvents, isStructuredModelAgentRunActive, resetActiveSupervisorRunsForTests } from "./supervisor-runtime";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); resetActiveSupervisorRunsForTests(); });

async function startPausedRun() {
  const capability: Extract<AgentCapabilityProfile, { executionProfile: "model_agent" }> = {
    schemaVersion: 1, executionProfile: "model_agent", engineId: "in-product-model-agent", engineAdapterId: "http-terminal-handoff-test-v1", backendId: "ollama",
    protocolVersion: "structured-turn-v1", sessionStrategy: "structured_turn", toolCatalogHash: currentModelAgentToolCatalogHash(), toolIsolation: "permission_only",
    qualification: { status: "unverified", platform: { os: "test", arch: "test", runtimeVersion: "node-test" }, testedAt: null, evidenceHash: null },
    supportsNativeSession: false, supportsResume: false, supportsStructuredEvents: true, supportsToolBridge: true, supportsQuestions: true, supportsCancellation: true, supportsUsageMetrics: false, cli: null
  };
  const bindingId = `terminal_handoff_${crypto.randomUUID()}`;
  const dispose = agentExecutionBindingRegistry.register({ bindingId, enabled: true, modelId: "server-owned-fixture-model", capability, modelEngineAdapter: { providerId: "ollama" } });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ done: true, message: { content: JSON.stringify({
    turnId: "turn-1", sessionState: "Goal: prepare incoming layer. Pending: confirm measurement basis.", assistantMessage: { messageId: "message-1", text: "Confirm the period." },
    action: { type: "question", messageId: "question-1", questionSetId: "question-set-1", questions: [{ id: "period", question: "Which period?", reason: "Measurement basis", required: true, expectedAnswerType: "text" }] }
  }) } })));
  const response = await startRun(new Request("http://localhost:3000/api/agent/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
    mode: "continue_project", input: { rootKpi: "Output", unit: "km/trip", project: createIncomingGraphFixture("measured") }, executionBindingId: bindingId
  }) }));
  expect(response.status).toBe(200);
  const body = await response.json() as { runId: string };
  await vi.waitFor(() => expect(agentRuntime.store.getSnapshot(body.runId).status).toBe("needs_user_input"));
  return { runId: body.runId, dispose };
}

describe("structured selected-layer terminal ownership", () => {
  it.each([false, true])("cancels a long-paused run with an expired fence, including an earlier failed projection=%s", async failedProjection => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vdt-expired-cancel-"));
    vi.stubEnv("VDT_DATA_DIR", directory); vi.stubEnv("VDT_APP_MODE", "development_web");
    const { runId, dispose } = await startPausedRun();
    const originalCancel = VdtRunSupervisor.prototype.cancel;
    if (failedProjection) vi.spyOn(VdtRunSupervisor.prototype, "cancel").mockImplementation(async function (this: VdtRunSupervisor, reason) {
      vi.spyOn(this.outbox, "append").mockRejectedValue(Object.assign(new Error("Old writer fence expired."), { code: "WRITE_FENCE_EXPIRED" }));
      return originalCancel.call(this, reason);
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 48 * 60 * 60 * 1_000);
    try {
      const request = () => new Request(`http://localhost:3000/api/agent/runs/${runId}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"awaitTerminal":true}' });
      const receipts = await Promise.all([cancelRun(request(), { params: Promise.resolve({ runId }) }), cancelRun(request(), { params: Promise.resolve({ runId }) })]);
      for (const receipt of receipts) {
        expect(receipt.status).toBe(200);
        expect(await receipt.json()).toMatchObject({ ok: true, status: "cancelled", terminalCleanupConfirmed: true });
      }
      expect((await getPersistedSupervisorEvents(runId)).filter(event => event.type === "runtime_status" && event.payload.code === "RUN_CANCELLED")).toHaveLength(1);
      expect(agentRuntime.store.getSnapshot(runId).pendingQuestions).toBeUndefined();
      expect(agentRuntime.store.getSnapshot(runId).executionSummary?.sessionEpoch).toBe(1);
      expect(isStructuredModelAgentRunActive(runId)).toBe(false);
      const replay = await cancelRun(request(), { params: Promise.resolve({ runId }) });
      expect(replay.status).toBe(200);
      expect(await replay.json()).toMatchObject({ ok: true, status: "cancelled", terminalCleanupConfirmed: true });
    } finally {
      vi.useRealTimers(); dispose(); fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([false, true])("waits for actual close, retaining unknown cleanup on timeout=%s", async timeout => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vdt-terminal-handoff-"));
    vi.stubEnv("VDT_DATA_DIR", directory); vi.stubEnv("VDT_APP_MODE", "development_web");
    const { runId, dispose } = await startPausedRun();
    const originalClose = VdtRunSupervisor.prototype.close;
    let release!: () => void; let closeStarted = false;
    vi.spyOn(VdtRunSupervisor.prototype, "close").mockImplementation(async function (this: VdtRunSupervisor) {
      closeStarted = true; await new Promise<void>(resolve => { release = resolve; }); return originalClose.call(this);
    });
    try {
      const pending = cancelStructuredModelAgentRun(runId, true).then(value => ({ value }), error => ({ error }));
      await vi.waitFor(() => expect(closeStarted).toBe(true));
      expect(isStructuredModelAgentRunActive(runId)).toBe(true);
      let settled = false; void pending.then(() => { settled = true; }); await Promise.resolve(); expect(settled).toBe(false);
      if (timeout) {
        // A second call owns a fresh bounded wait; cancelled status alone is not proof.
        vi.useFakeTimers();
        const bounded = cancelStructuredModelAgentRun(runId, true).then(value => ({ value }), error => ({ error }));
        await vi.advanceTimersByTimeAsync(5_001);
        expect(await bounded).toMatchObject({ error: { code: "MODEL_AGENT_CLEANUP_PENDING" } });
        expect(isStructuredModelAgentRunActive(runId)).toBe(true); vi.useRealTimers();
      }
      release(); await pending;
      await vi.waitFor(() => expect(isStructuredModelAgentRunActive(runId)).toBe(false));
      const receipt = await cancelRun(new Request(`http://localhost:3000/api/agent/runs/${runId}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"awaitTerminal":true}' }), { params: Promise.resolve({ runId }) });
      expect(receipt.status).toBe(200); expect(await receipt.json()).toMatchObject({ ok: true, terminalCleanupConfirmed: true, status: "cancelled" });
      expect(agentRuntime.store.getSnapshot(runId).status).toBe("cancelled");
    } finally {
      release?.(); await vi.waitFor(() => expect(isStructuredModelAgentRunActive(runId)).toBe(false));
      dispose(); fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
