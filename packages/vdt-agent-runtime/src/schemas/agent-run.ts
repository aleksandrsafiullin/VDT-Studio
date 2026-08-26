import { z } from "zod";

const boundedString = (max: number) => z.string().trim().min(1).max(max);
const optionalBoundedString = (max: number) =>
  z.preprocess(
    (value) => typeof value === "string" && value.trim().length === 0 ? undefined : value,
    boundedString(max).optional()
  );
const safeId = (max = 128) => boundedString(max).regex(
  /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
  "Must use only letters, numbers, underscores, or hyphens."
);

export const researchModeSchema = z.enum(["auto", "on", "off"]);

const agentStartRequestCommonShape = {
  mode: z.enum(["generate_vdt", "continue_project", "deepen_node", "review_project"]),
  input: z.object({
    prompt: optionalBoundedString(2_000),
    rootKpi: optionalBoundedString(160),
    industry: optionalBoundedString(160),
    businessContext: optionalBoundedString(2_000),
    unit: optionalBoundedString(80),
    timePeriod: optionalBoundedString(80),
    goal: optionalBoundedString(1_000),
    levelOfDetail: z.preprocess(
      (value) => typeof value === "string" && value.trim().length === 0 ? undefined : value,
      z.union([z.enum(["low", "medium", "high"]), boundedString(40)]).optional()
    ),
    project: z.unknown().optional(),
    selectedNodeId: optionalBoundedString(160)
  }),
  workspace: z.object({
    projectId: safeId(),
    projectName: optionalBoundedString(160),
    industry: optionalBoundedString(160),
    description: optionalBoundedString(1_000),
    vdtId: safeId().optional()
  }).optional(),
  options: z.object({
    autoApplyPatches: z.boolean().optional(),
    askBeforeFirstPatch: z.boolean().optional(),
    maxSteps: z.number().int().min(1).max(60).optional(),
    maxAutoDepth: z.number().int().min(1).max(8).optional(),
    continueWithAssumptions: z.boolean().optional(),
    researchMode: researchModeSchema.optional()
  }).optional()
} as const;

/**
 * New execution-profile starts cross the public boundary with one opaque,
 * server-managed binding ID. The strict object deliberately rejects client
 * attempts to choose an adapter, executable, model, or security policy.
 */
const executionBindingStartRequestSchema = z.object({
  ...agentStartRequestCommonShape,
  executionBindingId: safeId(160)
}).strict();

/**
 * Temporary compatibility shape for the existing micro-CLI/provider loop.
 * It remains intentionally separate so a request cannot combine a binding ID
 * with caller-managed provider configuration.
 */
const legacyProviderStartRequestSchema = z.object({
  ...agentStartRequestCommonShape,
  providerId: boundedString(120),
  providerConfig: z.record(z.unknown()).optional()
}).strict().superRefine((value, ctx) => {
  for (const forbidden of [
    "command",
    "executable",
    "args",
    "argsText",
    "cwd",
    "env",
    "schema",
    "systemPrompt",
    "userPrompt",
    "executionProfile",
    "engineAdapterId",
    "securityConfig"
  ]) {
    if (value.providerConfig && forbidden in value.providerConfig) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerConfig", forbidden],
        message: `providerConfig must not include ${forbidden}.`
      });
    }
  }
});

export const agentStartRequestSchema = z.union([
  executionBindingStartRequestSchema,
  legacyProviderStartRequestSchema
]);
