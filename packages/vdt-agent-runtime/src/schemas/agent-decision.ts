import { z } from "zod";
import { agentQuestionSchema } from "./agent-event";

export const vdtBuildPlanSchema = z.object({
  title: z.string().min(1).max(200),
  steps: z.array(z.string().min(1).max(240)).min(1).max(12),
  selectedSkillIds: z.array(z.string().min(1).max(160)).max(10).default([]),
  firstLevelDriverIds: z.array(z.string().min(1).max(160)).max(20).default([])
});

export const agentDecisionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ask_user"),
    statusMessage: z.string().min(1).max(400),
    questions: z.array(agentQuestionSchema).min(1).max(5),
    rationaleSummary: z.string().max(600).optional()
  }),
  z.object({
    type: z.literal("use_tool"),
    toolName: z.string().min(1).max(120),
    args: z.record(z.unknown()),
    statusMessage: z.string().min(1).max(400),
    rationaleSummary: z.string().max(600).optional()
  }),
  z.object({
    type: z.literal("propose_plan"),
    statusMessage: z.string().min(1).max(400),
    plan: vdtBuildPlanSchema,
    requiresUserApproval: z.boolean().default(false),
    rationaleSummary: z.string().max(600).optional()
  }),
  z.object({
    type: z.literal("finish"),
    statusMessage: z.string().min(1).max(400),
    summary: z.string().min(1).max(2_000),
    nextSuggestedActions: z.array(z.string().max(200)).max(6).default([])
  })
]);

export type AgentDecision = z.infer<typeof agentDecisionSchema>;
