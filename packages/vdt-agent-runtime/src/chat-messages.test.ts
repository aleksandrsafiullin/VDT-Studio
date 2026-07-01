import { describe, expect, it } from "vitest";
import type { VdtAgentQuestion } from "@vdt-studio/vdt-agent";
import { describeAnswerPayloads } from "./chat-messages";

describe("chat message helpers", () => {
  it("describes structured answers with user-facing question, option, and field labels", () => {
    const questions: VdtAgentQuestion[] = [
      {
        id: "root_kpi_definition",
        question: "What should the model measure?",
        reason: "The root KPI must be defined before graph creation.",
        required: true,
        answerKind: "single_choice",
        freeTextAllowed: true,
        options: [
          { id: "monthly_production", label: "Monthly production", value: "monthly_production" }
        ]
      },
      {
        id: "period_scope",
        question: "What period length should the excavation output cover?",
        reason: "Calendar time uses period days.",
        required: true,
        answerKind: "field_group",
        fields: [
          { id: "period_days", label: "Period length", kind: "number", unit: "days", required: true }
        ]
      }
    ];

    const text = describeAnswerPayloads([
      { questionId: "root_kpi_definition", selectedOptionIds: ["monthly_production"], freeText: "Ore excavation per year" },
      { questionId: "period_scope", fields: { period_days: 365 } }
    ], questions);

    expect(text).toContain("What should the model measure?");
    expect(text).toContain("Monthly production");
    expect(text).toContain("Ore excavation per year");
    expect(text).toContain("Period length (days): 365");
    expect(text).not.toContain("root_kpi_definition:");
    expect(text).not.toContain("period_days:");
  });

});
