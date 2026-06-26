import { z } from "zod";

const boundedString = (max: number) => z.string().trim().min(1).max(max);

export const agentStartRequestSchema = z.object({
  mode: z.enum(["generate_vdt", "continue_project", "deepen_node", "review_project"]),
  input: z.object({
    prompt: boundedString(2_000).optional(),
    rootKpi: boundedString(160).optional(),
    industry: boundedString(160).optional(),
    businessContext: boundedString(2_000).optional(),
    unit: boundedString(80).optional(),
    timePeriod: boundedString(80).optional(),
    goal: boundedString(1_000).optional(),
    levelOfDetail: z.union([z.enum(["low", "medium", "high"]), boundedString(40)]).optional(),
    project: z.unknown().optional(),
    selectedNodeId: boundedString(160).optional()
  }),
  providerId: boundedString(120),
  providerConfig: z.record(z.unknown()).optional(),
  options: z.object({
    autoApplyPatches: z.boolean().optional(),
    askBeforeFirstPatch: z.boolean().optional(),
    maxSteps: z.number().int().min(1).max(30).optional(),
    continueWithAssumptions: z.boolean().optional()
  }).optional()
}).superRefine((value, ctx) => {
  for (const forbidden of ["command", "args", "argsText", "cwd", "env", "schema", "systemPrompt", "userPrompt"]) {
    if (value.providerConfig && forbidden in value.providerConfig) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerConfig", forbidden],
        message: `providerConfig must not include ${forbidden}.`
      });
    }
  }
});
