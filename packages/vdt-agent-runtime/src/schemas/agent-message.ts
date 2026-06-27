import { z } from "zod";

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
  patch: z.record(z.unknown()).optional(),
  summary: z.string().max(500).optional()
});

export const agentUserMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("user_answer"),
    answers: z.record(z.union([z.string(), z.number(), z.array(z.string())]))
  }),
  z.object({
    type: z.literal("manual_project_change"),
    projectRevision: z.number().int().nonnegative().optional(),
    change: manualProjectChangeSchema
  }),
  z.object({
    type: z.literal("user_instruction"),
    text: z.string().trim().min(1).max(2_000),
    selectedNodeId: z.string().max(160).optional()
  }),
  z.object({
    type: z.literal("approval"),
    approved: z.boolean(),
    selectedChangeIds: z.array(z.string()).optional()
  })
]);
