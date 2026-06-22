import { describe, expect, it } from "vitest";
import { INVALID_SCHEMA_FIXTURES, VALID_SCHEMA_FIXTURES } from "./fixtures/schema-fixtures";
import {
  getRegisteredJsonSchema,
  schemaIdForTask,
  schemaSupportsTask,
  schemaTasks,
  validateRegisteredSchema,
  VDT_OUTPUT_SCHEMA_IDS,
  VDT_SCHEMA_IDS
} from "./schema-registry";

describe("schema registry", () => {
  it("exposes JSON schemas for every registered schema id", () => {
    for (const schemaId of VDT_SCHEMA_IDS) {
      expect(getRegisteredJsonSchema(schemaId)).toBeDefined();
    }
  });

  it("maps each output schema id to its canonical task type", () => {
    for (const schemaId of VDT_OUTPUT_SCHEMA_IDS) {
      const taskType = schemaTasks[schemaId];
      expect(schemaSupportsTask(schemaId, taskType)).toBe(true);
      expect(schemaIdForTask(taskType)).toBe(schemaId);
    }
  });

  it("validates golden fixtures for every output schema id", () => {
    for (const schemaId of VDT_OUTPUT_SCHEMA_IDS) {
      expect(validateRegisteredSchema(schemaId, VALID_SCHEMA_FIXTURES[schemaId])).toBe(true);
    }
  });

  it("rejects invalid fixtures for every output schema id", () => {
    for (const schemaId of VDT_OUTPUT_SCHEMA_IDS) {
      expect(validateRegisteredSchema(schemaId, INVALID_SCHEMA_FIXTURES[schemaId])).toBe(false);
    }
  });

  it("validates connection-test-v1", () => {
    expect(validateRegisteredSchema("connection-test-v1", { ok: true })).toBe(true);
    expect(validateRegisteredSchema("connection-test-v1", { ok: false })).toBe(false);
  });

  it("schemaIdForTask returns the expected schema for each task", () => {
    expect(schemaIdForTask("deepen_node")).toBe("deepen-node-v1");
    expect(schemaIdForTask("review_model")).toBe("review-model-v1");
    expect(schemaIdForTask("generate_executive_summary")).toBe("generate-executive-summary-v1");
  });
});
