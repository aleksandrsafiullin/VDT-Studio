import type { VdtProject } from "@vdt-studio/vdt-core";
import { z } from "zod";
import { TASK_LIMITS } from "../tasks/registry";
import {
  aiAssumptionsSchema,
  aiNodeIdSchema,
  aiNodeTypeSchema,
  aiQuestionsForUserSchema,
  aiWarningsSchema
} from "./shared";
import { buildBranchExcerpt, projectExcerptSchema } from "./project-excerpt";
import { aiChangeSetEdgeChangeSchema } from "./change-set-draft";

const limits = TASK_LIMITS.simplify_branch;
const maxRemovals = limits.maxChanges?.maxDeletions ?? 5;
const maxUpdates = limits.maxChanges?.maxUpdates ?? 10;
const maxEdgeChanges = limits.maxChanges?.maxEdgeChanges ?? 20;

export const simplifyBranchContextSchema = z.object({
  goal: z.string().max(500).optional(),
  preserveNodeIds: z.array(aiNodeIdSchema).max(20).optional()
});

export const simplifyBranchNodeRemovalSchema = z.object({
  nodeId: aiNodeIdSchema,
  mergeIntoNodeId: aiNodeIdSchema.optional(),
  rationale: z.string().min(1).max(1_000)
});

export const simplifyBranchNodeUpdateSchema = z.object({
  nodeId: aiNodeIdSchema,
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(1_000).optional(),
  type: aiNodeTypeSchema.optional(),
  unit: z.string().max(80).optional(),
  formula: z.string().max(500).optional(),
  aiRationale: z.string().max(1_000).optional()
});

export const simplifyBranchInputSchema = z.object({
  projectTitle: z.string().max(160).optional(),
  industry: z.string().max(160).optional(),
  businessContext: z.string().max(2_000).optional(),
  branchRootNodeId: aiNodeIdSchema,
  excerpt: projectExcerptSchema,
  context: simplifyBranchContextSchema.optional()
});

export const simplifyBranchOutputSchema = z
  .object({
    branchRootNodeId: aiNodeIdSchema,
    nodeRemovals: z.array(simplifyBranchNodeRemovalSchema).max(maxRemovals),
    nodeUpdates: z.array(simplifyBranchNodeUpdateSchema).max(maxUpdates).default([]),
    edgeChanges: z.array(aiChangeSetEdgeChangeSchema).max(maxEdgeChanges),
    rationale: z.string().min(1).max(2_000),
    assumptions: aiAssumptionsSchema,
    questionsForUser: aiQuestionsForUserSchema,
    warnings: aiWarningsSchema
  })
  .superRefine((output, context) => {
    const removalIds = new Set<string>();
    for (const removal of output.nodeRemovals) {
      if (removalIds.has(removal.nodeId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nodeRemovals"],
          message: `Duplicate removal node id: ${removal.nodeId}`
        });
      }
      removalIds.add(removal.nodeId);

      if (removal.nodeId === output.branchRootNodeId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nodeRemovals"],
          message: "Cannot remove the branch root node."
        });
      }
    }

    const updateIds = new Set<string>();
    for (const update of output.nodeUpdates) {
      if (updateIds.has(update.nodeId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nodeUpdates"],
          message: `Duplicate update node id: ${update.nodeId}`
        });
      }
      updateIds.add(update.nodeId);
    }
  });

export type SimplifyBranchContext = z.infer<typeof simplifyBranchContextSchema>;
export type SimplifyBranchInput = z.infer<typeof simplifyBranchInputSchema>;
export type SimplifyBranchOutput = z.infer<typeof simplifyBranchOutputSchema>;

export function buildSimplifyBranchInput(
  project: VdtProject,
  branchRootNodeId: string,
  context?: SimplifyBranchContext
): SimplifyBranchInput {
  return simplifyBranchInputSchema.parse({
    projectTitle: project.name,
    industry: project.industry,
    businessContext: project.businessContext ?? project.description,
    branchRootNodeId,
    excerpt: buildBranchExcerpt(project, branchRootNodeId),
    ...(context ? { context } : {})
  });
}
