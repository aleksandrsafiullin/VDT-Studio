import { describe, expect, it } from "vitest";
import { projectNativeInputBatchSchema, restoreNativeLocalModelOutput } from "./local-model-output-projection";

describe("native numeric input wire projection", () => {
  it("presents bounded unique target keys while preserving model-chosen values and provenance constraints", () => {
    const item = { type: "object", properties: { nodeId: { type: "string" }, value: { type: "number", const: 4 },
      provenance: { const: "user_provided_value" }, note: { enum: ["4 machines"] } }, required: ["nodeId", "value", "provenance", "note"], additionalProperties: false };
    const schema = { type: "object", properties: { values: { type: "array", items: { anyOf: [item] } } } };
    const native = projectNativeInputBatchSchema("vdt.fill_input_values_batch", schema, { nativeInputBatch: {
      schemaVersion: "values_by_node_id.v1", batches: [["first", "second"], ["last"]]
    } });
    expect(native).toMatchObject({ properties: { values: { anyOf: [
      { type: "object", maxProperties: 2, additionalProperties: false, properties: {
        first: { anyOf: [{ required: ["value", "provenance", "note"], properties: { value: { const: 4 }, note: { enum: ["4 machines"] } } }] },
        second: expect.any(Object)
      } }, { type: "object", maxProperties: 1, properties: { last: expect.any(Object) } }
    ] } } });
    expect(JSON.stringify(native)).not.toContain('"nodeId"');
    expect(schema.properties.values.items.anyOf[0]!.properties).toHaveProperty("nodeId");
    expect(projectNativeInputBatchSchema("vdt.update_node", schema, {})).toBe(schema);
  });

  it("restores only selected keys without rounding, autofilling other inputs or changing formulas", () => {
    const raw = { action: { type: "action_batch", batch: { calls: [
      { toolName: "vdt.fill_input_values_batch", args: { values: { second: { value: 1.23456789, provenance: "default_assumption", note: "Editable estimate" } } } },
      { toolName: "vdt.set_formula", args: { nodeId: "root", formula: "second * 2" } }
    ] } } };
    const before = JSON.stringify(raw);
    const restored = restoreNativeLocalModelOutput(raw);
    expect(restored.action.batch.calls[0]!.args.values).toEqual([{ nodeId: "second", value: 1.23456789, provenance: "default_assumption", note: "Editable estimate" }]);
    expect(restored.action.batch.calls[1]).toEqual(raw.action.batch.calls[1]);
    expect(JSON.stringify(raw)).toBe(before);
    const canonical = { action: { type: "action_batch", batch: { calls: [{ toolName: "vdt.fill_input_values_batch", args: { values: [{ nodeId: "known", value: 0 }] } }] } } };
    expect(restoreNativeLocalModelOutput(canonical)).toEqual(canonical);
  });

  it("rejects ambiguous map entries rather than replacing an explicit target", () => {
    expect(() => restoreNativeLocalModelOutput({ action: { type: "action_batch", batch: { calls: [{
      toolName: "vdt.fill_input_values_batch", args: { values: { first: { nodeId: "other", value: 4 } } }
    }] } } })).toThrow("Invalid native numeric input entry");
  });

  it("normalizes object key order deterministically for canonical idempotency hashes", () => {
    const wrap = (values: unknown) => ({ action: { type: "action_batch", batch: { calls: [{ toolName: "vdt.fill_input_values_batch", args: { values } }] } } });
    expect(restoreNativeLocalModelOutput(wrap({ beta: { value: 2 }, alpha: { value: 1 } })))
      .toEqual(restoreNativeLocalModelOutput(wrap({ alpha: { value: 1 }, beta: { value: 2 } })));
  });
});
