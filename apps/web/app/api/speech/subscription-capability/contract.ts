import { z } from "zod";

const scope = z.literal("installed_codex_cli");
export const codexSpeechCapabilityRequest = { scope: scope.value } as const;
export const codexSpeechCapabilityRequestSchema = z.object({ scope }).strict();

export const codexSpeechCapabilityResponseSchema = z.object({
  scope,
  protocol: z.discriminatedUnion("surface", [
    z.object({ surface: z.literal("unknown"), cliVersion: z.null(), buildFingerprint: z.null() }).strict(),
    z.object({
      surface: z.enum(["experimental", "stable", "unsupported"]),
      cliVersion: z.string().max(160).regex(/^\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?(?:\+[0-9a-z.-]+)?$/i),
      buildFingerprint: z.string().regex(/^[a-f0-9]{64}$/)
    }).strict()
  ]),
  accountVoiceAvailability: z.literal("unknown")
}).strict();

export type CodexSpeechCapability = z.infer<typeof codexSpeechCapabilityResponseSchema>;
