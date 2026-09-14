import { describe, expect, it } from "vitest";
import { z } from "zod";
import { agentQuestionSchema } from "./schemas/agent-event";
import {
  SCHEMA_ISSUE_SUMMARY_MAX_CHARS,
  SCHEMA_ISSUE_SUMMARY_MAX_ISSUES,
  schemaIssueSummary
} from "./schema-issue-summary";

describe("schemaIssueSummary", () => {
  it("names field paths and expected types for several invalid arguments", () => {
    const schema = z.object({
      drivers: z.array(z.object({
        parentNodeId: z.string(),
        name: z.string(),
        assumptions: z.array(z.string()).optional()
      })).min(2),
      parentFormula: z.string().optional()
    });
    const parsed = schema.safeParse({
      drivers: [
        { parentNodeId: 12, name: true, assumptions: "do-not-echo-assumption-text" },
        { parentNodeId: null, name: { secret: "hidden-object" }, assumptions: "also-hidden" }
      ],
      parentFormula: 3
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const summary = schemaIssueSummary(parsed.error.issues);
    expect(summary).toContain("drivers.0.parentNodeId (invalid_type: expected=string received=number)");
    expect(summary).toContain("drivers.0.name (invalid_type: expected=string received=boolean)");
    expect(summary).toContain("drivers.0.assumptions (invalid_type: expected=array received=string)");
    expect(summary).toContain("drivers.1.parentNodeId (invalid_type: expected=string received=null)");
    expect(summary).not.toContain("do-not-echo-assumption-text");
    expect(summary).not.toContain("also-hidden");
    expect(summary).not.toContain("hidden-object");
  });

  it("caps issue count and total length without echoing values", () => {
    const shape = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [
        `field_${"x".repeat(40)}_${index}`,
        z.string()
      ])
    );
    const parsed = z.object(shape).safeParse({
      hostile: `secret-value-must-not-appear`
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const summary = schemaIssueSummary(parsed.error.issues);
    expect(parsed.error.issues.length).toBeGreaterThan(SCHEMA_ISSUE_SUMMARY_MAX_ISSUES);
    expect((summary.match(/invalid_type/g) ?? []).length).toBeLessThanOrEqual(SCHEMA_ISSUE_SUMMARY_MAX_ISSUES);
    expect(summary.endsWith("…")).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(SCHEMA_ISSUE_SUMMARY_MAX_CHARS);
    expect(summary).not.toContain("secret-value");
  });

  it("keeps the question unrecognized-keys format", () => {
    const parsed = agentQuestionSchema.strict().array().safeParse([
      {
        id: "fleet-topology",
        question: "Should the fleet be split into two branches?",
        reason: "Truck classes differ materially.",
        required: true,
        label: "Should the fleet be split into two branches?",
        type: "choice"
      }
    ]);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const summary = schemaIssueSummary(parsed.error.issues);
    expect(summary).toContain("0 (unrecognized_keys: label|type)");
    expect(summary).not.toContain("Should the fleet");
  });
});
