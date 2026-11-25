import { describe, expect, it } from "vitest";
import {
  AGENT_FINISH_MISSING_VALUE_PROMPT_RULE,
  AGENT_HIERARCHY_PROMPT_RULE,
  AGENT_CONTEXT_GROUP_PROMPT_RULE,
  AGENT_FILE_SCOPE_PROMPT_RULE,
  AGENT_QUESTION_PROMPT_RULE,
  AGENT_OUTCOME_PROMPT_RULE,
  modelAgentStructuredTurnSchema,
  AGENT_QUESTION_WRITEBACK_PROMPT_RULE,
  AGENT_RESEARCH_PROVIDER_FAILED_PROMPT_RULE,
  AGENT_RESEARCH_UNCONFIGURED_PROMPT_RULE,
  CHECKPOINT_ACTION_BATCH_CONTRACT_PROMPT_RULE,
  CHECKPOINT_FINISH_ORDER_PROMPT_RULE
} from "@vdt-studio/vdt-agent-runtime";
import {
  buildOpenAiNativeActionPrompt, MODEL_AGENT_SYSTEM_PROMPT, namedExcelFinishBlocker,
  OPENAI_STRUCTURAL_SKILL_PROMPT, structuralUserAnswers, OPENAI_STRUCTURAL_RELATIONSHIP_PROMPT, structuralRelationshipQuestion
} from "./supervisor-runtime";
import {OLLAMA_MODEL_AGENT_SYSTEM_PROMPT} from "./local-model-provider";
import {SHARED_PROMPT_RULES} from "../../../../../../packages/model-bridge/src/agent-engines/resume-checkpoint-engine-core";

describe("MODEL_AGENT_SYSTEM_PROMPT", () => {
  it("requires the same level-by-level plan and repair contract for API, CLI and local agents",()=>{
    for(const prompt of [MODEL_AGENT_SYSTEM_PROMPT,OLLAMA_MODEL_AGENT_SYSTEM_PROMPT,SHARED_PROMPT_RULES.finishOrder]){
      expect(prompt).toContain(AGENT_HIERARCHY_PROMPT_RULE);
      expect(prompt).toContain(AGENT_CONTEXT_GROUP_PROMPT_RULE);
      expect(prompt).toContain(AGENT_FILE_SCOPE_PROMPT_RULE);
    }
  });
  it("wires the shared writeback and finish constants onto the in-product model agent", () => {
    expect(MODEL_AGENT_SYSTEM_PROMPT).toContain(AGENT_QUESTION_PROMPT_RULE);
    expect(MODEL_AGENT_SYSTEM_PROMPT).toContain(AGENT_QUESTION_WRITEBACK_PROMPT_RULE);
    expect(MODEL_AGENT_SYSTEM_PROMPT).toContain(AGENT_FINISH_MISSING_VALUE_PROMPT_RULE);
    expect(MODEL_AGENT_SYSTEM_PROMPT).toContain(AGENT_RESEARCH_UNCONFIGURED_PROMPT_RULE);
    expect(MODEL_AGENT_SYSTEM_PROMPT).toContain(AGENT_RESEARCH_PROVIDER_FAILED_PROMPT_RULE);
    expect(MODEL_AGENT_SYSTEM_PROMPT).toContain(CHECKPOINT_ACTION_BATCH_CONTRACT_PROMPT_RULE);
    expect(MODEL_AGENT_SYSTEM_PROMPT).toContain(CHECKPOINT_FINISH_ORDER_PROMPT_RULE);
  });
});

it("requires the requested named workbook at the current saved revision before finish", () => {
  const instant = "2026-11-25T00:00:00.000Z";
  const scenarios = [
    { id: "default-scenario", name: "Baseline", overrides: [], createdAt: instant, updatedAt: instant },
    { id: "scenario-2", name: "Recovery", overrides: [], createdAt: instant, updatedAt: instant }
  ];
  const artifact = (scenarioId: string, revisionId: string) => ({
    id: "workbook", runId: "run", type: "excel_workbook" as const, summary: "Workbook",
    payload: { scenarioId, revisionId }, createdAt: instant
  });
  const prompt = "Give me an editable Excel workbook for Recovery.";
  expect(namedExcelFinishBlocker(scenarios, prompt, "revision-2", [
    artifact("default-scenario", "revision-2"), artifact("scenario-2", "revision-1")
  ])).toMatchObject({
    accepted: false, code: "EXCEL_REQUESTED_ARTIFACT_MISSING",
    payload: { scenarioId: "scenario-2", savedRevisionId: "revision-2" }
  });
  expect(namedExcelFinishBlocker(scenarios, prompt, "revision-2", [artifact("scenario-2", "revision-2")])).toBeUndefined();
  expect(namedExcelFinishBlocker(scenarios, "Give me an Excel workbook for the active scenario.", "revision-2", undefined)).toBeUndefined();
  expect(namedExcelFinishBlocker(scenarios, "Why did you create a workbook for Recovery earlier?", "revision-2", undefined)).toBeUndefined();
  expect(namedExcelFinishBlocker(scenarios, "Do not export a workbook for Recovery.", "revision-2", undefined)).toBeUndefined();
});

describe("OpenAI native action prompt", () => {
  it.each([undefined, "Plan the user's editable factor tree."])("teaches the native batch envelope and structural goal for phase %s", phasePrompt => {
    const prompt = buildOpenAiNativeActionPrompt(phasePrompt);
    expect(prompt).toContain("action.batch.calls");
    expect(prompt).toContain("action.type=question");
    expect(prompt).toContain("approval.request, user.request_approval and run.request_finish must each be the only call");
    expect(prompt).toContain("If user.ask is offered as a tool, call it alone");
    expect(prompt).not.toContain(CHECKPOINT_ACTION_BATCH_CONTRACT_PROMPT_RULE);
    expect(prompt).toContain(AGENT_OUTCOME_PROMPT_RULE);
    expect(prompt).toContain("leave unavailable measurements blank");
    expect(prompt).toContain("an unresolved process relationship materially changes the formula");
  });
});

it("clarifies structure before selecting an unpinned skill and carries prior user answers forward", () => {
  const prompt = buildOpenAiNativeActionPrompt(OPENAI_STRUCTURAL_SKILL_PROMPT);
  expect(prompt).toContain("ask one focused question before choosing a skill or writing a formula");
  expect(prompt).toContain("hostObservation.confirmedUserAnswers");
  expect(prompt).toContain("carry that answer forward instead of re-asking");
  expect(prompt).toContain("only when the user supplied process or domain evidence");
});

it("projects submitted answer labels and ignores unanswered or earlier-run questions", () => {
  const message = {
    id: "question-message", runId: "current-run", role: "assistant" as const, kind: "question" as const,
    createdAt: "2026-11-24T00:00:00.000Z",
    questions: [
      { id: "resources", question: "Do the tasks share a resource?", reason: "The relationship changes the formula.", required: true,
        options: [{ id: "shared", label: "The tasks share one machine", value: "shared" }] },
      { id: "measurement", question: "What is the rate?", reason: "This remains unknown.", required: true }
    ]
  };
  expect(structuralUserAnswers({
    runId: "current-run", chatMessages: [message, { ...message, runId: "old-run", questions: [
      { id: "old", question: "An unrelated question?", reason: "This is from another run.", required: true }
    ] }], answers: { resources: ["shared"], old: "Ignore" }
  })).toEqual([{ question: "Do the tasks share a resource?", answer: ["The tasks share one machine"] }]);
});

it("uses a closed relationship assessment and emits the normal text question envelope", () => {
  expect(OPENAI_STRUCTURAL_RELATIONSHIP_PROMPT).toContain("Do not propose a formula");
  expect(OPENAI_STRUCTURAL_RELATIONSHIP_PROMPT).toContain("Use the scope and KPI unit the user actually specified");
  expect(OPENAI_STRUCTURAL_SKILL_PROMPT).not.toMatch(/mining|excavation/i);
  expect(structuralRelationshipQuestion("exchange-1", { question: null })).toBeUndefined();
  expect(() => structuralRelationshipQuestion("exchange-1", { question: null, skill: "test" })).toThrow();
  const question = { text: "Do these teams handle the same orders or different orders?", reason: "Overlap changes how the outputs combine." };
  const turn = modelAgentStructuredTurnSchema.parse(structuralRelationshipQuestion("exchange-1", { question }));
  expect(turn.action).toMatchObject({ type: "question", questions: [{
    question: question.text, reason: question.reason, expectedAnswerType: "text"
  }] });
});
