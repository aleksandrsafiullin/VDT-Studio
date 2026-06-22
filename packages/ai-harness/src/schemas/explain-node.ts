import type { VdtProject } from "@vdt-studio/vdt-core";
import { z } from "zod";
import { TASK_LIMITS } from "../tasks/registry";
import { aiNodeIdSchema } from "./shared";
import { buildNodeNeighborhoodExcerpt, projectExcerptSchema } from "./project-excerpt";

const limits = TASK_LIMITS.explain_node;
const maxTextBytes = limits.maxTextSectionBytes ?? 8 * 1024;

export const explainNodeInputSchema = z.object({
  projectTitle: z.string().max(160).optional(),
  industry: z.string().max(160).optional(),
  businessContext: z.string().max(2_000).optional(),
  nodeId: aiNodeIdSchema,
  excerpt: projectExcerptSchema
});

export const explainNodeOutputSchema = z.object({
  nodeId: aiNodeIdSchema,
  explanation: z.string().min(1).max(maxTextBytes),
  keyDrivers: z.array(z.string().max(200)).max(20),
  assumptions: z.array(z.string().max(500)).max(30),
  questionsForUser: z.array(z.string().max(500)).max(30)
});

export type ExplainNodeInput = z.infer<typeof explainNodeInputSchema>;
export type ExplainNodeOutput = z.infer<typeof explainNodeOutputSchema>;

export interface ExplainNodeResult extends ExplainNodeOutput {}

export function buildExplainNodeInput(project: VdtProject, nodeId: string): ExplainNodeInput {
  return explainNodeInputSchema.parse({
    projectTitle: project.name,
    industry: project.industry,
    businessContext: project.businessContext ?? project.description,
    nodeId,
    excerpt: buildNodeNeighborhoodExcerpt(project, nodeId)
  });
}
