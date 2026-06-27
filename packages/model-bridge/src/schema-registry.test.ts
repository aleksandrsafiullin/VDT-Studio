import { describe, expect, it } from "vitest";
import { INVALID_SCHEMA_FIXTURES, VALID_SCHEMA_FIXTURES } from "./fixtures/schema-fixtures";
import {
  getRegisteredJsonSchema,
  getStrictResponseJsonSchema,
  normalizeRegisteredSchemaOutput,
  schemaIdForTask,
  schemaSupportsTask,
  schemaTasks,
  validateRegisteredSchemaDetailed,
  validateRegisteredSchema,
  VDT_OUTPUT_SCHEMA_IDS,
  VDT_SCHEMA_IDS
} from "./schema-registry";

function assertStrictObjects(schema: unknown, path = "$"): void {
  if (Array.isArray(schema)) {
    schema.forEach((entry, index) => assertStrictObjects(entry, `${path}[${index}]`));
    return;
  }
  if (typeof schema !== "object" || schema === null) return;
  const record = schema as Record<string, unknown>;

  if (record.type === "object") {
    expect(record.additionalProperties, path).toBe(false);
    const properties = typeof record.properties === "object" && record.properties !== null
      ? record.properties as Record<string, unknown>
      : {};
    expect(record.required, path).toEqual(Object.keys(properties));
    for (const [key, value] of Object.entries(properties)) {
      assertStrictObjects(value, `${path}.properties.${key}`);
    }
  }

  if (record.type === "array") {
    assertStrictObjects(record.items, `${path}.items`);
  }
  if (Array.isArray(record.anyOf)) {
    record.anyOf.forEach((entry, index) => assertStrictObjects(entry, `${path}.anyOf[${index}]`));
  }
}

describe("schema registry", () => {
  it("exposes JSON schemas for every registered schema id", () => {
    for (const schemaId of VDT_SCHEMA_IDS) {
      expect(getRegisteredJsonSchema(schemaId)).toBeDefined();
    }
  });

  it("keeps every registered object schema closed to top-level drift", () => {
    for (const schemaId of VDT_SCHEMA_IDS) {
      expect(getRegisteredJsonSchema(schemaId)).toMatchObject({
        type: "object",
        additionalProperties: false
      });
    }
  });

  it("emits OpenAI-compatible strict response schemas for every registered schema id", () => {
    for (const schemaId of VDT_SCHEMA_IDS) {
      assertStrictObjects(getStrictResponseJsonSchema(schemaId));
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

  it("rejects top-level schema drift and reports the offending path", () => {
    const output = {
      ...(VALID_SCHEMA_FIXTURES["generate-tree-v1"] as Record<string, unknown>),
      unapprovedProviderField: "drift"
    };

    const result = validateRegisteredSchemaDetailed("generate-tree-v1", output);

    expect(validateRegisteredSchema("generate-tree-v1", output)).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("$.unapprovedProviderField is not an approved field.");
  });

  it("rejects disconnected generate-tree nodes before project conversion", () => {
    const output = {
      ...(VALID_SCHEMA_FIXTURES["generate-tree-v1"] as Record<string, unknown>),
      nodes: [
        { id: "production_volume", name: "Production Volume", type: "root_kpi" },
        { id: "number_of_trucks", name: "Number of trucks", type: "input" }
      ],
      edges: []
    };

    const result = validateRegisteredSchemaDetailed("generate-tree-v1", output);

    expect(validateRegisteredSchema("generate-tree-v1", output)).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'Node "number_of_trucks" must be reachable from root "production_volume" through visual decomposition edges.'
    );
  });

  it("orients reversible generate-tree edges from the root", () => {
    const output = {
      ...(VALID_SCHEMA_FIXTURES["generate-tree-v1"] as Record<string, unknown>),
      rootNodeId: "production_volume",
      nodes: [
        { id: "production_volume", name: "Production Volume", type: "root_kpi" },
        { id: "number_of_trucks", name: "Number of trucks", type: "input" }
      ],
      edges: [
        {
          id: "edge_child_root",
          sourceNodeId: "number_of_trucks",
          targetNodeId: "production_volume",
          relation: "positive_driver"
        }
      ]
    };

    expect(validateRegisteredSchema("generate-tree-v1", output)).toBe(false);

    const normalized = normalizeRegisteredSchemaOutput("generate-tree-v1", output) as Record<string, unknown>;

    expect(validateRegisteredSchema("generate-tree-v1", normalized)).toBe(true);
    expect(normalized.edges).toEqual([
      expect.objectContaining({ sourceNodeId: "production_volume", targetNodeId: "number_of_trucks" })
    ]);
  });

  it("deduplicates generate-tree visual edge pairs", () => {
    const output = {
      ...(VALID_SCHEMA_FIXTURES["generate-tree-v1"] as Record<string, unknown>),
      rootNodeId: "production_volume",
      nodes: [
        { id: "production_volume", name: "Production Volume", type: "root_kpi" },
        { id: "number_of_trucks", name: "Number of trucks", type: "input" }
      ],
      edges: [
        {
          id: "edge_formula",
          sourceNodeId: "production_volume",
          targetNodeId: "number_of_trucks",
          relation: "formula_dependency"
        },
        {
          id: "edge_driver",
          sourceNodeId: "production_volume",
          targetNodeId: "number_of_trucks",
          relation: "multiplicative_driver"
        }
      ]
    };

    expect(validateRegisteredSchema("generate-tree-v1", output)).toBe(false);

    const normalized = normalizeRegisteredSchemaOutput("generate-tree-v1", output) as Record<string, unknown>;

    expect(validateRegisteredSchema("generate-tree-v1", normalized)).toBe(true);
    expect(normalized.edges).toEqual([
      expect.objectContaining({ id: "edge_driver", relation: "multiplicative_driver" })
    ]);
  });

  it("enforces registered nested string and array caps", () => {
    const tooLongHeadline = {
      ...(VALID_SCHEMA_FIXTURES["generate-executive-summary-v1"] as Record<string, unknown>),
      headline: "x".repeat(12_001)
    };
    const tooManyRecommendations = {
      ...(VALID_SCHEMA_FIXTURES["generate-executive-summary-v1"] as Record<string, unknown>),
      recommendations: Array.from({ length: 251 }, () => "Validate inputs")
    };

    expect(validateRegisteredSchemaDetailed("generate-executive-summary-v1", tooLongHeadline).errors).toContain(
      "$.headline must be at most 12000 character(s)."
    );
    expect(validateRegisteredSchemaDetailed("generate-executive-summary-v1", tooManyRecommendations).errors).toContain(
      "$.recommendations must contain at most 250 item(s)."
    );
  });

  it("validates connection-test-v1", () => {
    expect(validateRegisteredSchema("connection-test-v1", { ok: true })).toBe(true);
    expect(validateRegisteredSchema("connection-test-v1", { ok: false })).toBe(false);
  });

  it("schemaIdForTask returns the expected schema for each task", () => {
    expect(schemaIdForTask("agent_decision")).toBe("agent-decision-v1");
    expect(schemaIdForTask("agent_plan")).toBe("agent-plan-v1");
    expect(schemaIdForTask("deepen_node")).toBe("deepen-node-v1");
    expect(schemaIdForTask("review_model")).toBe("review-model-v1");
    expect(schemaIdForTask("generate_executive_summary")).toBe("generate-executive-summary-v1");
  });
});
