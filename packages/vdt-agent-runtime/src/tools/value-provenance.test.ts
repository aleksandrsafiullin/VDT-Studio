import { describe, expect, it } from "vitest";
import { VdtBuilderSession } from "@vdt-studio/vdt-core";
import { AgentRunStore } from "../run-store";
import { AgentToolError, type AgentToolContext } from "../tool-registry";
import { groundedAnswerRecord } from "../chat-messages";
import { assertUserProvidedValueGrounded, runHasUserAnswerForNode } from "./value-provenance";

describe("value provenance", () => {
  it("treats a question id or field-group answer as grounding for that node", () => {
    const { context, store, runId } = provenanceContext();
    expect(runHasUserAnswerForNode(context, "payload_t")).toBe(false);

    store.updateRun(runId, { answers: { payload_t: 40 } });
    expect(runHasUserAnswerForNode(context, "payload_t")).toBe(true);

    store.updateRun(runId, { answers: { required_numeric_inputs: "payload_t: 40; haul_distance_km: 2.7" } });
    expect(runHasUserAnswerForNode(context, "payload_t")).toBe(true);
    expect(runHasUserAnswerForNode(context, "truck_count")).toBe(false);
  });

  it("grounds user_provided_value from a pending question field or persisted field key", () => {
    const { context, store, runId } = provenanceContext();
    store.updateRun(runId, {
      pendingQuestions: [{
        id: "q1",
        question: "What payload should the model use?",
        reason: "Payload is a required numeric input.",
        required: true,
        fields: [{ id: "payload_t", label: "Payload", kind: "number", unit: "t" }]
      }],
      answers: { q1: 40 }
    });
    expect(runHasUserAnswerForNode(context, "payload_t")).toBe(true);

    const persisted = groundedAnswerRecord(
      {},
      { q1: 40 },
      undefined,
      [{
        id: "q1",
        question: "What payload should the model use?",
        reason: "Payload is a required numeric input.",
        required: true,
        fields: [{ id: "payload_t", label: "Payload", kind: "number", unit: "t" }]
      }]
    );
    store.updateRun(runId, { answers: persisted, pendingQuestions: undefined });
    expect(Object.prototype.hasOwnProperty.call(persisted, "payload_t")).toBe(true);
    expect(persisted.q1).toBe(40);
    expect(persisted.payload_t).toBe(40);
    expect(runHasUserAnswerForNode(context, "payload_t")).toBe(true);
    expect(() => assertUserProvidedValueGrounded(context, "payload_t")).not.toThrow();
  });

  it("rejects user_provided_value when this run has no answer for the node", () => {
    const { context } = provenanceContext();
    expect(() => assertUserProvidedValueGrounded(context, "payload_t")).toThrow(AgentToolError);
    try {
      assertUserProvidedValueGrounded(context, "payload_t");
    } catch (error) {
      expect(error).toMatchObject({
        code: "USER_PROVIDED_VALUE_UNGROUNDED"
      });
    }
  });
});

function provenanceContext(): { context: AgentToolContext; store: AgentRunStore; runId: string } {
  const store = new AgentRunStore({ now: () => "2026-09-13T00:00:00.000Z" });
  const run = store.createRun({
    mode: "generate_vdt",
    input: { rootKpi: "Haulage" },
    providerId: "mock",
    options: { autoApplyPatches: true }
  });
  const builder = new VdtBuilderSession({ now: () => "2026-09-13T00:00:00.000Z" });
  return {
    store,
    runId: run.runId,
    context: {
      runId: run.runId,
      store,
      emit: (event) => store.appendEvent(run.runId, event),
      getRun: () => store.getSnapshot(run.runId),
      updateRun: (patch) => store.updateRun(run.runId, patch),
      builder,
      signal: run.abortController.signal
    }
  };
}
