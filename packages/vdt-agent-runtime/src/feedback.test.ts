import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  feedbackFromForbiddenFields,
  feedbackFromToolEnvelope,
  feedbackFromValidation,
  feedbackFromZodError,
  formatFeedbackForPrompt
} from "./feedback";

describe("structured feedback", () => {
  it("maps schema and forbidden-field failures into retryable prompt feedback", () => {
    const schema = z.object({ type: z.literal("call_tool"), toolName: z.string() });
    const parsed = schema.safeParse({ type: "call_tool" });
    if (parsed.success) throw new Error("Expected schema parse to fail.");

    const schemaFeedback = feedbackFromZodError(parsed.error, { taskType: "agent_decision" });
    const forbiddenFeedback = feedbackFromForbiddenFields(["nodes", "driverPlan"]);

    expect(schemaFeedback).toMatchObject({
      kind: "schema_validation_failed",
      severity: "error",
      retryable: true,
      target: { taskType: "agent_decision", fieldPath: "toolName" }
    });
    expect(forbiddenFeedback).toMatchObject({
      kind: "forbidden_field",
      retryable: true,
      actual: ["nodes", "driverPlan"]
    });
    expect(formatFeedbackForPrompt([schemaFeedback, forbiddenFeedback])).toContain("forbidden_field");
  });

  it("maps tool envelopes and validation failures into next-tool hints", () => {
    const invalidArgs = feedbackFromToolEnvelope({
      toolName: "vdt.add_driver",
      ok: false,
      error: { code: "INVALID_TOOL_ARGS", message: "Expected string", details: [{ path: ["name"] }] },
      projectChanged: false,
      emittedEventIds: []
    });
    const validation = feedbackFromValidation({
      valid: false,
      errors: [{
        type: "invalid_graph",
        severity: "error",
        message: "Root node has no formula.",
        nodeId: "root",
        repairHints: ["Set a root formula."]
      }],
      warnings: []
    });

    expect(invalidArgs).toMatchObject({
      kind: "invalid_tool_args",
      target: { toolName: "vdt.add_driver" },
      retryable: true
    });
    expect(validation).toMatchObject({
      kind: "graph_validation_failed",
      target: { nodeId: "root" },
      suggestedNextTools: expect.arrayContaining(["vdt.set_formula"])
    });
  });
});
