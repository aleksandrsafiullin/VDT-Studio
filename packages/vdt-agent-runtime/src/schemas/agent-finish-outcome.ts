import { z } from "zod";
import { agentOutcomeSchema } from "./agent-run";

const finishOutcomeFields = {
  outcome: agentOutcomeSchema,
  policyVersion: z.string().min(1).max(80),
  missingInputs: z.array(z.object({
    nodeId: z.string(),
    nodeName: z.string(),
    explicit: z.boolean(),
    requiredForRoot: z.boolean()
  }).strict()).max(24).optional(),
  missingInputCount: z.number().int().nonnegative().optional(),
  rootValue: z.number().finite().optional()
};

export const finishOutcomeSchema = z.object({
  ...finishOutcomeFields,
  projectRevision: z.number().int().nonnegative(),
  projectHash: z.string().regex(/^sha256:[a-f0-9]{64}$/)
}).strict();
