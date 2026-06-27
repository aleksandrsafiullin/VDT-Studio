import { z } from "zod";
import { agentQuestionSchema } from "./agent-event";

export const agentDecisionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("call_tool"),
    toolName: z.string().min(1).max(120),
    args: z.record(z.unknown()),
    statusMessage: z.string().min(1).max(500)
  }),
  z.object({
    type: z.literal("ask_user"),
    questions: z.array(agentQuestionSchema).min(1).max(5),
    statusMessage: z.string().min(1).max(500)
  }),
  z.object({
    type: z.literal("finish"),
    summary: z.string().min(1).max(2_000),
    nextSuggestedActions: z.array(z.string().max(300)).max(10).default([])
  })
]);

export type AgentDecision = z.infer<typeof agentDecisionSchema>;

export const FORBIDDEN_AGENT_DECISION_FIELDS = [
  "driverPlan",
  "nodes",
  "edges",
  "rootFormula",
  "project",
  "fullProject",
  "fullGraph",
  "selectedSkillIds"
] as const;

export function parseAndGuardAgentDecision(output: unknown): AgentDecision {
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const record = output as Record<string, unknown>;
    const forbidden = FORBIDDEN_AGENT_DECISION_FIELDS.filter((field) => field in record);
    if (forbidden.length > 0) {
      throw new Error(`AgentDecision includes forbidden full-plan fields: ${forbidden.join(", ")}.`);
    }
  }
  return agentDecisionSchema.parse(output);
}
