import { z } from "zod";

export const agentQuestionSchema = z.object({
  id: z.string().min(1).max(120),
  question: z.string().min(1).max(500),
  reason: z.string().min(1).max(600),
  required: z.boolean(),
  expectedAnswerType: z.enum(["text", "number", "single_choice", "multi_choice"]).optional(),
  answerKind: z.enum(["text", "number", "single_choice", "multi_choice", "field_group"]).optional(),
  options: z.array(z.union([
    z.string().max(160),
    z.object({
      id: z.string().min(1).max(120),
      label: z.string().min(1).max(160),
      value: z.string().min(1).max(500),
      revealsFields: z.array(z.object({
        id: z.string().min(1).max(120),
        label: z.string().min(1).max(160),
        kind: z.enum(["text", "number"]),
        unit: z.string().max(80).optional(),
        required: z.boolean().optional(),
        placeholder: z.string().max(200).optional()
      })).max(12).optional(),
      requiresFreeText: z.boolean().optional()
    })
  ])).max(20).optional(),
  fields: z.array(z.object({
    id: z.string().min(1).max(120),
    label: z.string().min(1).max(160),
    kind: z.enum(["text", "number"]),
    unit: z.string().max(80).optional(),
    required: z.boolean().optional(),
    placeholder: z.string().max(200).optional()
  })).max(12).optional(),
  freeTextAllowed: z.boolean().optional(),
  placeholder: z.string().max(200).optional(),
  defaultValue: z.union([z.string(), z.number(), z.array(z.string())]).optional()
});

export const agentEventTypeSchema = z.enum([
  "run_started",
  "classification",
  "skill_search",
  "skill_selected",
  "skill_read",
  "clarifying_questions",
  "user_answer_received",
  "user_instruction",
  "assistant_message",
  "plan_proposed",
  "tool_call_started",
  "tool_call_completed",
  "graph_patch",
  "graph_validation",
  "manual_change_observed",
  "repair_started",
  "final_report",
  "run_completed",
  "error"
]);

export const agentPhaseSchema = z.enum([
  "classifying_request",
  "retrieving_skills",
  "reading_skills",
  "asking_clarifying_questions",
  "planning_decomposition",
  "building_graph",
  "validating_graph",
  "repairing_graph",
  "applying_graph",
  "reporting"
]);

export const agentEventSchema = z.object({
  id: z.string(),
  runId: z.string(),
  seq: z.number().int().positive(),
  timestamp: z.string(),
  phase: agentPhaseSchema,
  type: agentEventTypeSchema,
  title: z.string(),
  message: z.string(),
  metadata: z.record(z.unknown()).optional(),
  patch: z.unknown().optional(),
  questions: z.array(agentQuestionSchema).optional()
});
