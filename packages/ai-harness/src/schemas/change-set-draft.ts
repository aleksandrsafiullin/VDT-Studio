import { z } from "zod";
import type { VdtAiTaskType } from "@vdt-studio/vdt-core";
import { nowIso, warning } from "@vdt-studio/vdt-core";
import type { VdtChangeSet, VdtEdgeChange, VdtNodePatch, VdtNodeUpdate } from "@vdt-studio/vdt-core";
import {
  aiAssumptionsSchema,
  aiEdgeRelationSchema,
  aiNodeIdSchema,
  aiNodeTypeSchema,
  aiQuestionsForUserSchema,
  aiWarningsSchema
} from "./shared";

const aiNodePatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(1_000).optional(),
  type: aiNodeTypeSchema.optional(),
  unit: z.string().max(80).optional(),
  formula: z.string().max(500).optional(),
  aiConfidence: z.number().min(0).max(1).optional(),
  aiRationale: z.string().max(1_000).optional(),
  controllability: z.enum(["high", "medium", "low", "none"]).optional(),
  materiality: z.enum(["high", "medium", "low", "unknown"]).optional()
});

export const aiChangeSetAdditionSchema = z.object({
  id: aiNodeIdSchema,
  nodeId: aiNodeIdSchema,
  parentNodeId: aiNodeIdSchema,
  relation: aiEdgeRelationSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(1_000).optional(),
  type: aiNodeTypeSchema.optional(),
  unit: z.string().max(80).optional(),
  formula: z.string().max(500).optional(),
  aiConfidence: z.number().min(0).max(1).optional(),
  aiRationale: z.string().max(1_000).optional(),
  controllability: z.enum(["high", "medium", "low", "none"]).optional(),
  materiality: z.enum(["high", "medium", "low", "unknown"]).optional()
});

export const aiChangeSetUpdateSchema = z.object({
  id: aiNodeIdSchema,
  nodeId: aiNodeIdSchema,
  patch: aiNodePatchSchema
});

export const aiChangeSetDeletionSchema = z.object({
  id: aiNodeIdSchema,
  nodeId: aiNodeIdSchema,
  cascadeEdges: z.boolean().optional()
});

export const aiChangeSetEdgeAddSchema = z.object({
  id: aiNodeIdSchema,
  action: z.literal("add"),
  edge: z.object({
    id: aiNodeIdSchema,
    sourceNodeId: aiNodeIdSchema,
    targetNodeId: aiNodeIdSchema,
    relation: aiEdgeRelationSchema,
    label: z.string().max(80).optional(),
    aiConfidence: z.number().min(0).max(1).optional()
  })
});

export const aiChangeSetEdgeRemoveSchema = z.object({
  id: aiNodeIdSchema,
  action: z.literal("remove"),
  edgeId: aiNodeIdSchema
});

export const aiChangeSetEdgeUpdateSchema = z.object({
  id: aiNodeIdSchema,
  action: z.literal("update"),
  edgeId: aiNodeIdSchema,
  patch: z.object({
    sourceNodeId: aiNodeIdSchema.optional(),
    targetNodeId: aiNodeIdSchema.optional(),
    relation: aiEdgeRelationSchema.optional(),
    label: z.string().max(80).optional(),
    aiConfidence: z.number().min(0).max(1).optional()
  })
});

export const aiChangeSetEdgeChangeSchema = z.discriminatedUnion("action", [
  aiChangeSetEdgeAddSchema,
  aiChangeSetEdgeRemoveSchema,
  aiChangeSetEdgeUpdateSchema
]);

export const aiChangeSetDraftSchema = z.object({
  id: aiNodeIdSchema.optional(),
  additions: z.array(aiChangeSetAdditionSchema).max(15).default([]),
  updates: z.array(aiChangeSetUpdateSchema).max(10).default([]),
  deletions: z.array(aiChangeSetDeletionSchema).max(5).default([]),
  edgeChanges: z.array(aiChangeSetEdgeChangeSchema).max(20).default([]),
  assumptions: aiAssumptionsSchema.optional(),
  questions: aiQuestionsForUserSchema.optional(),
  warnings: aiWarningsSchema.optional()
});

export type AiChangeSetDraft = z.infer<typeof aiChangeSetDraftSchema>;

export function aiChangeSetDraftToVdtChangeSet(
  draft: AiChangeSetDraft,
  options: { taskType: VdtAiTaskType; backendId: string; changeSetId: string }
): VdtChangeSet {
  return {
    id: draft.id ?? options.changeSetId,
    taskType: options.taskType,
    backendId: options.backendId,
    createdAt: nowIso(),
    additions: draft.additions.map((entry) => ({
      id: entry.id,
      nodeId: entry.nodeId,
      parentNodeId: entry.parentNodeId,
      relation: entry.relation,
      name: entry.name,
      description: entry.description,
      type: entry.type,
      unit: entry.unit,
      formula: entry.formula,
      aiConfidence: entry.aiConfidence,
      aiRationale: entry.aiRationale,
      controllability: entry.controllability,
      materiality: entry.materiality
    })),
    updates: draft.updates.map(
      (entry): VdtNodeUpdate => ({
        id: entry.id,
        nodeId: entry.nodeId,
        patch: entry.patch as VdtNodePatch
      })
    ),
    deletions: draft.deletions.map((entry) => ({
      id: entry.id,
      nodeId: entry.nodeId,
      cascadeEdges: entry.cascadeEdges
    })),
    edgeChanges: draft.edgeChanges.map((entry): VdtEdgeChange => {
      if (entry.action === "add") {
        return {
          id: entry.id,
          action: "add" as const,
          edge: {
            ...entry.edge,
            aiGenerated: true
          }
        };
      }
      if (entry.action === "remove") {
        return {
          id: entry.id,
          action: "remove" as const,
          edgeId: entry.edgeId
        };
      }
      return {
        id: entry.id,
        action: "update" as const,
        edgeId: entry.edgeId,
        patch: entry.patch
      } as VdtEdgeChange;
    }),
    assumptions: draft.assumptions ?? [],
    questions: draft.questions ?? [],
    warnings: (draft.warnings ?? []).map((item) =>
      warning({
        severity: item.severity,
        type: "weak_business_logic",
        message: item.message,
        nodeId: item.nodeId,
        edgeId: item.edgeId
      })
    )
  };
}
