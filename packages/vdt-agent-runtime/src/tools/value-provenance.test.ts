import { describe, expect, it } from "vitest";
import { VdtBuilderSession } from "@vdt-studio/vdt-core";
import { AgentRunStore } from "../run-store";
import { AgentToolError, type AgentToolContext } from "../tool-registry";
import { groundedAnswerRecord } from "../chat-messages";
import { collectLiteralUserQuantities } from "../value-provenance-contract";
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

  it("accepts a single numeric quantity quoted verbatim from the original user request", () => {
    const { context, store, runId } = provenanceContext();
    store.getState(runId).request.input.prompt = "У нас 10 самосвалов; откатка 2,5 км.";
    expect(() => assertUserProvidedValueGrounded(context, "trucks", { value: 10, quote: "10 самосвалов" })).not.toThrow();
    expect(() => assertUserProvidedValueGrounded(context, "distance", { value: 2.5, quote: "откатка 2,5 км" })).not.toThrow();
    expect(() => assertUserProvidedValueGrounded(context, "trucks", { value: 10, quote: 'Из запроса: «10 самосвалов»' })).not.toThrow();
    for (const evidence of [
      { value: 11, quote: "10 самосвалов" },
      { value: 10, quote: "10 trucks" },
      { value: 10, quote: "У нас 10 самосвалов; откатка 2,5 км." },
      { value: 10, quote: "10" },
      { value: 10, quote: "15 экскаваторов" }
    ]) expect(() => assertUserProvidedValueGrounded(context, "trucks", evidence)).toThrow(AgentToolError);
  });

  it("suggests only literal excerpts for the rejected number without interpreting its target", () => {
    const { context, store, runId } = provenanceContext();
    store.getState(runId).request.input.prompt = "Дано: 4 экскаватора, 10 самосвалов; откатка 2,5 км.";
    store.appendChatMessage(runId, { role: "assistant", kind: "assistant_message", text: "4 trucks" });
    try {
      assertUserProvidedValueGrounded(context, "uninterpreted_target", { value: 4, quote: "Number of excavators: 4" });
      throw new Error("Expected provenance rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentToolError);
      expect((error as Error).message).toContain('"4 экскаватора"');
      expect((error as Error).message).not.toContain("4 trucks");
      expect((error as Error).message).not.toContain("10 самосвалов");
    }
    expect(() => assertUserProvidedValueGrounded(context, "target", { value: 4, quote: 'Источник: "10 самосвалов"' })).toThrow(AgentToolError);
  });

  it("sends and accepts a verbatim written cardinal as a supplied value", () => {
    const { context, store, runId } = provenanceContext();
    const prompt = "Пять одинаковых самосвалов. Плечо 3 км. Погрузка 3 минуты. Available time: 9 hours.";
    store.getState(runId).request.input.prompt = prompt;
    expect(collectLiteralUserQuantities([prompt]).quantities).toEqual([
      { value: 5, quote: "Пять одинаковых самосвалов" },
      { value: 3, quote: "Плечо 3 км" },
      { value: 3, quote: "Погрузка 3 минуты", unit: "min" },
      { value: 9, quote: "Available time: 9 hours", unit: "h" }
    ]);
    expect(() => assertUserProvidedValueGrounded(context, "trucks", { value: 5, quote: "Пять одинаковых самосвалов" })).not.toThrow();
    expect(() => assertUserProvidedValueGrounded(context, "trucks", { value: 4, quote: "Пять одинаковых самосвалов" })).toThrow(AgentToolError);
    expect(() => assertUserProvidedValueGrounded(context, "trucks", { value: 5, quote: "5 одинаковых самосвалов" })).toThrow(/Пять одинаковых самосвалов/);
  });

  it.each([
    ["Relabeling each takes 12 minutes", 12, "min/item"],
    ["На одну повторную расшифровку уходит в среднем 20 минут", 20, "min/item"],
    ["Edit time is 2.5 minutes per document", 2.5, "min/item"],
    ["250 recordings were checked", 250, "items"],
    ["Проверили 180 рукописей", 180, "items"],
    ["12 minutes each month", 12, "min"],
    ["Ремонт занимает 10 дней/год", 10, "day/year"],
    ["The loader makes 20 lifts per hour", 20, "lift/h"],
    ["The bucket lifts 2 tonnes per lift", 2, "t/lift"],
    ["За цикл забирает 2 тонны", 2, "t/cycle"],
    ["Доступно 3 с опцией резервирования", 3, undefined],
    ["The allowance is 8 hours per installation", 8, undefined]
  ])("retains only the literal time or count basis in %s", (quote, value, unit) => {
    expect(collectLiteralUserQuantities([quote]).quantities).toEqual([{ quote, value, ...(unit ? { unit } : {}) }]);
  });

  it("retains a cycle rate when the time basis precedes a singular machine", () => {
    const prompt = "За чистый час одна машина делает 25 рабочих циклов";
    expect(collectLiteralUserQuantities([prompt]).quantities).toContainEqual({
      value: 25, quote: "машина делает 25 рабочих циклов", unit: "cycle/h"
    });
  });

  it("does not ground a partial quote of a larger quantity", () => {
    const { context, store, runId } = provenanceContext();
    const prompt = "Двадцать пять самосвалов. 40 тонн за рейс. Twenty-five trucks and a one-way distance of 3 km. Work lasts пять с половиной часов. Net change is minus five vehicles.";
    store.getState(runId).request.input.prompt = prompt;
    for (const evidence of [
      { value: 5, quote: "пять самосвалов" },
      { value: 5, quote: "five trucks" },
      { value: 5, quote: "five vehicles" },
      { value: 5, quote: "Work lasts пять" },
      { value: 0, quote: "0 тонн за рейс" },
      { value: 1, quote: "a one-way distance" }
    ]) expect(() => assertUserProvidedValueGrounded(context, "trucks", evidence)).toThrow(AgentToolError);
    expect(collectLiteralUserQuantities([prompt]).quantities.map(({ value }) => value)).toEqual([40, 3]);
  });

  it("never treats an assistant message or a tool output as quoted user evidence", () => {
    const { context, store, runId } = provenanceContext();
    store.appendChatMessage(runId, { role: "assistant", kind: "assistant_message", text: "25 trucks" });
    expect(() => assertUserProvidedValueGrounded(context, "trucks", { value: 25, quote: "25 trucks" })).toThrow(AgentToolError);
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
