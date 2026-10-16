import { describe, expect, it } from "vitest";
import { VALID_SCHEMA_FIXTURES } from "./fixtures/schema-fixtures";
import { getRegisteredJsonSchema, getStrictResponseJsonSchema, normalizeRegisteredSchemaOutput, validateRegisteredSchema, validateRegisteredSchemaDetailed } from "./schema-registry";

const raw = () => structuredClone(VALID_SCHEMA_FIXTURES["analyze-raw-dataset-v1"]) as Record<string, unknown>;
const timestampOptions = () => ({
  tableId: "table_1", categoryColumns: ["Class", "System", "Reason"],
  duration: { mode: "timestamps", startColumn: "Start", endColumn: "End", format: "dmy", timezoneOffsetMinutes: 300 },
  normalization: { mode: "per_day", basis: "calendar_days", denominator: 4 }, period: { start: "2026-02-01", end: "2026-02-04" }
});

function valid(schemaId: "data-agent-decision-v1" | "analyze-raw-dataset-v1" | "review-dataset-proposal-v1", value: unknown) {
  expect(validateRegisteredSchema(schemaId, value)).toBe(true);
  expect(validateRegisteredSchemaDetailed(schemaId, value)).toEqual({ valid: true, errors: [] });
}
function invalid(value: unknown) {
  expect(validateRegisteredSchema("analyze-raw-dataset-v1", value)).toBe(false);
  expect(validateRegisteredSchemaDetailed("analyze-raw-dataset-v1", value).valid).toBe(false);
}

describe("canonical data task contracts", () => {
  it("preserves timestamp and additive numeric mapping proposals through canonical validation", () => {
    for (const schemaId of ["analyze-raw-dataset-v1", "review-dataset-proposal-v1"] as const) {
      valid(schemaId, { ...raw(), incomingKpiOptions: timestampOptions() });
      valid(schemaId, { ...raw(), incomingKpiOptions: { tableId: "table_1", categoryColumns: ["Category"], duration: { mode: "column", column: "Amount", unit: "target" }, normalization: { mode: "period_total" } } });
      const strict = JSON.stringify(getStrictResponseJsonSchema(schemaId));
      for (const field of ["incomingKpiOptions", "categoryColumns", "startColumn", "timezoneOffsetMinutes", "denominator"]) expect(strict).toContain(field);
      expect(strict).not.toContain('"confirmed"');
      expect(strict).not.toContain('"clarificationAnswers"');
    }
  });

  it("normalizes only known optional nulls in the selected mapping branch", () => {
    const input = { ...raw(), incomingKpiOptions: {
      tableId: "table_1", categoryColumns: ["Reason"],
      duration: { mode: "timestamps", startColumn: "Start", endColumn: "End", format: null, timezoneOffsetMinutes: null },
      normalization: null, period: null, numberFormat: null, missingCategoryPolicy: null
    } };
    const normalized = normalizeRegisteredSchemaOutput("analyze-raw-dataset-v1", input);
    valid("analyze-raw-dataset-v1", normalized);
    expect(normalized).toMatchObject({ incomingKpiOptions: { duration: { mode: "timestamps", startColumn: "Start", endColumn: "End" } } });
    expect((normalized as typeof input).incomingKpiOptions).not.toHaveProperty("normalization");
    expect((normalized as typeof input).incomingKpiOptions).not.toHaveProperty("period");
    expect((normalized as typeof input).incomingKpiOptions.duration).not.toHaveProperty("timezoneOffsetMinutes");
    expect(normalizeRegisteredSchemaOutput("analyze-raw-dataset-v1", { ...raw(), incomingKpiOptions: null })).not.toHaveProperty("incomingKpiOptions");
  });

  it("keeps unknown human fields and required or array nulls for rejection", () => {
    for (const human of [{ confirmed: false }, { confirmed: null }, { clarificationAnswers: {} }, { clarificationAnswers: null }]) {
      const input = { ...raw(), incomingKpiOptions: { ...timestampOptions(), ...human } };
      const normalized = normalizeRegisteredSchemaOutput("analyze-raw-dataset-v1", input);
      expect(normalized).toMatchObject({ incomingKpiOptions: human });
      invalid(normalized);
    }
    for (const options of [
      { ...timestampOptions(), duration: { mode: "timestamps", startColumn: null, endColumn: "End", format: null } },
      { ...timestampOptions(), categoryColumns: ["Reason", null] },
      { ...timestampOptions(), duration: { mode: "invalid", startColumn: "Start", endColumn: "End", format: null } }
    ]) invalid(normalizeRegisteredSchemaOutput("analyze-raw-dataset-v1", { ...raw(), incomingKpiOptions: options }));
  });

  it("retains and rejects own JSON prototype-looking keys at root, mapping and tool-input levels", () => {
    for (const key of ["constructor", "toString", "__proto__"]) {
      for (const value of [null, {}]) {
        const unknown = JSON.parse(`{"${key}":${JSON.stringify(value)}}`) as Record<string, unknown>;
        const root = normalizeRegisteredSchemaOutput("analyze-raw-dataset-v1", { ...raw(), ...unknown }) as Record<string, unknown>;
        expect(Object.hasOwn(root, key)).toBe(true);
        expect(root[key]).toEqual(value);
        invalid(root);
        const nested = normalizeRegisteredSchemaOutput("analyze-raw-dataset-v1", { ...raw(), incomingKpiOptions: { ...timestampOptions(), ...unknown } }) as Record<string, unknown>;
        expect(Object.hasOwn(nested.incomingKpiOptions as object, key)).toBe(true);
        invalid(nested);
        const tool = normalizeRegisteredSchemaOutput("data-agent-decision-v1", {
          type: "tool_call", toolName: "table.preview", rationale: "Inspect source examples.", input: { tableId: "table_1", ...unknown }
        }) as Record<string, unknown>;
        expect(Object.hasOwn(tool.input as object, key)).toBe(true);
        expect(validateRegisteredSchema("data-agent-decision-v1", tool)).toBe(false);
        expect(validateRegisteredSchemaDetailed("data-agent-decision-v1", tool).valid).toBe(false);
      }
    }
  });

  it("does not accept inherited required fields or discriminator values", () => {
    const inheritedDecision = Object.assign(Object.create({ type: "tool_call", toolName: "table.preview" }), {
      rationale: "Inspect source examples.", input: { tableId: "table_1", limit: null }
    });
    const normalized = normalizeRegisteredSchemaOutput("data-agent-decision-v1", inheritedDecision);
    expect(normalized).toBe(inheritedDecision);
    expect(validateRegisteredSchema("data-agent-decision-v1", normalized)).toBe(false);
    const inheritedAnalysis = Object.assign(Object.create({ datasetId: "dataset_1" }), raw());
    delete inheritedAnalysis.datasetId;
    invalid(inheritedAnalysis);
  });

  it("rejects invalid mapping enums, fractional offsets, nonpositive denominators and empty fields canonically", () => {
    for (const options of [
      { ...timestampOptions(), duration: { mode: "column", column: "Duration", unit: "weeks" } },
      { ...timestampOptions(), duration: { ...timestampOptions().duration, format: "guess" } },
      { ...timestampOptions(), duration: { ...timestampOptions().duration, timezoneOffsetMinutes: 300.5 } },
      { ...timestampOptions(), duration: { ...timestampOptions().duration, timezoneOffsetMinutes: 841 } },
      { ...timestampOptions(), numberFormat: "guess" },
      { ...timestampOptions(), normalization: { mode: "per_day", basis: "observed_days", denominator: 4 } },
      { ...timestampOptions(), normalization: { mode: "per_day", basis: "calendar_days", denominator: 0 } },
      { ...timestampOptions(), normalization: { mode: "per_day", basis: "calendar_days", denominator: -1 } },
      { ...timestampOptions(), tableId: "" },
      { ...timestampOptions(), categoryColumns: [""] },
      { ...timestampOptions(), missingCategoryPolicy: "drop_rows" },
      { ...timestampOptions(), period: { start: "01/02/2026", end: "04/02/2026" } }
    ]) invalid({ ...raw(), incomingKpiOptions: options });
    invalid({ ...raw(), summary: { ...(raw().summary as object), rowCount: 2.5 } });
  });

  it("represents every allowlisted tool with its real closed arguments", () => {
    const schema = getRegisteredJsonSchema("data-agent-decision-v1");
    const branches = schema.anyOf as Array<{ properties: { type: { const: string }; toolName?: { enum: string[] } } }>;
    const names = branches.flatMap((branch) => branch.properties.toolName?.enum ?? []);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("table.preview");
    const preview = { type: "tool_call", toolName: "table.preview", rationale: "Inspect ambiguous timestamp examples.", input: { tableId: "table_1", limit: 8 } };
    valid("data-agent-decision-v1", preview);
    const strict = getStrictResponseJsonSchema("data-agent-decision-v1");
    expect(strict).not.toHaveProperty("properties");
    const strictPreview = (strict.anyOf as Array<{ properties: { toolName?: { enum: string[] }; input: unknown } }>).find((branch) => branch.properties.toolName?.enum.includes("table.preview"));
    expect(strictPreview?.properties.input).toMatchObject({ properties: { tableId: { type: "string" }, limit: expect.any(Object) } });
    const optionalLimit = normalizeRegisteredSchemaOutput("data-agent-decision-v1", { ...preview, input: { tableId: "table_1", limit: null } });
    expect(optionalLimit).toMatchObject({ input: { tableId: "table_1" } });
    valid("data-agent-decision-v1", optionalLimit);
    for (const input of [{ tableId: "table_1", limit: 1.5 }, { tableId: "table_1", limit: 0 }, { tableId: "table_1", limit: 51 }, { tableId: "" }, { tableId: null }, { tableId: "table_1", unknown: null }]) {
      expect(validateRegisteredSchema("data-agent-decision-v1", normalizeRegisteredSchemaOutput("data-agent-decision-v1", { ...preview, input }))).toBe(false);
    }
    expect(validateRegisteredSchema("data-agent-decision-v1", { ...preview, toolName: "column.profile" })).toBe(false);
    expect(validateRegisteredSchema("data-agent-decision-v1", { ...preview, toolName: "shell.exec" })).toBe(false);
  });

  it("supports genuine ask-user and full typed final analysis, rejecting empty final objects", () => {
    valid("data-agent-decision-v1", { type: "ask_user", questions: ["Which timezone and denominator should apply?"], rationale: "The extract is ambiguous." });
    valid("data-agent-decision-v1", { type: "final_proposal", rationale: "The observed columns support this mapping.", result: { ...raw(), incomingKpiOptions: timestampOptions() } });
    expect(validateRegisteredSchema("data-agent-decision-v1", { type: "final_proposal", rationale: "Done.", result: {} })).toBe(false);
    expect(validateRegisteredSchema("data-agent-decision-v1", { type: "ask_user", questions: [""], rationale: "Ambiguous." })).toBe(false);
  });

  it("leaves unrelated task normalization and schema behavior unchanged", () => {
    const output = { ...(VALID_SCHEMA_FIXTURES["explain-node-v1"] as Record<string, unknown>), unexpected: null };
    expect(normalizeRegisteredSchemaOutput("explain-node-v1", output)).toBe(output);
    expect(validateRegisteredSchema("explain-node-v1", output)).toBe(false);
    expect(getStrictResponseJsonSchema("agent-decision-v2")).toHaveProperty("properties.argsJson");
  });
});
