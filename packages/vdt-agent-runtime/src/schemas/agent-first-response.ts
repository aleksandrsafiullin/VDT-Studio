import { z } from "zod";
import { agentQuestionSchema } from "./agent-event";

export const publicAgentStatusSchema = z.object({
  phase: z.enum([
    "reading_request",
    "asking_questions",
    "planning_model",
    "running_subagents",
    "building_draft",
    "checking_model",
    "waiting_user",
    "ready",
    "retryable_error"
  ]),
  message: z.string().min(1).max(500),
  progress: z.object({
    completed: z.number().finite(),
    total: z.number().finite()
  }).optional()
});

export const firstResponseSchema = z.object({
  assistantMessage: z.string().trim().min(1).max(2_000),
  nextAction: z.enum(["ask_user", "continue_building"]),
  questions: z.array(agentQuestionSchema).max(5).default([]),
  publicStatus: publicAgentStatusSchema.default({
    phase: "planning_model",
    message: "Planning the VDT from your request."
  })
});

export type FirstResponseOutput = z.infer<typeof firstResponseSchema>;

export interface FirstResponseInput {
  brief: {
    rootKpi: string;
    unit?: string | undefined;
    period?: string | undefined;
    industry?: string | undefined;
    businessContext?: string | undefined;
  };
  currentUserMessage: string;
  currentProjectSummary?: {
    title: string;
    rootNodeName: string;
    unit?: string | undefined;
  } | undefined;
  visibleChatSummary?: string | undefined;
}

