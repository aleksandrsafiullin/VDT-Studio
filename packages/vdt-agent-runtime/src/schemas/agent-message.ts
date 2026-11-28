import { z } from "zod";
import { aiPersonalisationSchema, researchModeSchema } from "./agent-run";

const answerValueSchema = z.union([z.string(), z.number(), z.array(z.string())]);

const agentAnswerPayloadSchema = z.object({
  questionId: z.string().min(1).max(120),
  selectedOptionIds: z.array(z.string().min(1).max(160)).max(20).optional(),
  freeText: z.string().max(2_000).optional(),
  fields: z.record(z.string(), z.union([z.string(), z.number()])).optional()
});

export const manualProjectChangeSchema = z.object({
  kind: z.enum([
    "node_updated",
    "node_deleted",
    "node_position_updated",
    "edge_updated",
    "project_replaced",
    "change_set_applied"
  ]),
  nodeId: z.string().max(160).optional(),
  edgeId: z.string().max(160).optional(),
  patch: z.record(z.string(), z.unknown()).optional(),
  summary: z.string().max(500).optional()
});

const checkpointId = z.string().min(1).max(160);
export const agentAnswerCaptureSchema = z.object({
  runId: checkpointId,
  projectId: checkpointId,
  vdtId: checkpointId,
  questionSetId: checkpointId,
  questionEventId: checkpointId,
  questionId: checkpointId,
  turnId: z.uuid()
}).strict();
export const agentQuestionExpectationSchema = agentAnswerCaptureSchema.extend({
  captureSessionId: z.uuid(),
  recognitionProof: z.uuid()
}).strict();
export type AgentAnswerCapture = z.infer<typeof agentAnswerCaptureSchema>;
export const agentProposalExpectationSchema = z.object({
  runId: checkpointId,
  projectId: checkpointId,
  vdtId: checkpointId,
  proposalId: checkpointId,
  baseRevisionId: checkpointId,
  baseRevision: z.number().int().nonnegative()
}).strict();
export type AgentQuestionExpectation = z.infer<typeof agentQuestionExpectationSchema>;
export type AgentProposalExpectation = z.infer<typeof agentProposalExpectationSchema>;

export const agentUserMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("user_answer"),
    expectedQuestion: agentQuestionExpectationSchema.optional(),
    answers: z.record(z.string(), answerValueSchema).optional(),
    structuredAnswers: z.array(agentAnswerPayloadSchema).max(20).optional()
  }),
  z.object({
    type: z.literal("manual_project_change"),
    projectRevision: z.number().int().nonnegative().optional(),
    change: manualProjectChangeSchema
  }),
  z.object({
    type: z.literal("user_instruction"),
    personalisation: aiPersonalisationSchema.optional(),
    text: z.string().trim().min(1).max(2_000),
    selectedNodeId: z.string().max(160).nullable().optional(),
    activeScenarioId: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/).max(128).nullable().optional(),
    researchMode: researchModeSchema.optional()
  }),
  z.object({
    type: z.literal("deepen_node"),
    selectedNodeId: z.string().trim().min(1).max(160)
  }),
  z.object({
    type: z.literal("continue_run")
  }),
  z.object({
    type: z.literal("approval"),
    expectedProposal: agentProposalExpectationSchema.optional(),
    approved: z.boolean(),
    proposalId: z.string().trim().min(1).max(160).optional(),
    selectedChangeIds: z.array(z.string().trim().min(1).max(160)).max(200).optional()
  })
]);
