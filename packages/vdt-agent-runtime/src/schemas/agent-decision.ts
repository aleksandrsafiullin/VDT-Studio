import { z } from "zod";
import { agentQuestionSchema } from "./agent-event";

const agentToolCallSchema = z.object({
  toolName: z.string().min(1).max(120),
  args: z.record(z.unknown())
});

export const agentDecisionV1Schema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("call_tool"),
    ...agentToolCallSchema.shape,
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

export const agentDecisionSchema = z.discriminatedUnion("type", [
  ...agentDecisionV1Schema.options,
  z.object({
    type: z.literal("call_tools"),
    calls: z.array(agentToolCallSchema).min(2).max(6),
    statusMessage: z.string().min(1).max(500)
  })
]);

export type AgentDecisionV1 = z.infer<typeof agentDecisionV1Schema>;
export type AgentToolCall = z.infer<typeof agentToolCallSchema>;
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

export class AgentDecisionForbiddenFieldsError extends Error {
  readonly fields: string[];

  constructor(fields: readonly string[]) {
    super(`AgentDecision includes forbidden full-plan fields: ${fields.join(", ")}.`);
    this.name = "AgentDecisionForbiddenFieldsError";
    this.fields = [...fields];
  }
}

export function parseAndGuardAgentDecision(output: unknown): AgentDecision {
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const record = output as Record<string, unknown>;
    const forbidden = FORBIDDEN_AGENT_DECISION_FIELDS.filter((field) => field in record);
    if (forbidden.length > 0) {
      throw new AgentDecisionForbiddenFieldsError(forbidden);
    }
  }
  return agentDecisionSchema.parse(output);
}
