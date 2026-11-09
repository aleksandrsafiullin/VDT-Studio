import { validateStrictVdtProjectCommit } from "@vdt-studio/storage";
import { z } from "zod";
import { authorSkillFromVdt, SkillAuthorInputError } from "@/lib/skill-author";
import { skillAuthorSource } from "@/lib/skill-workflow";
import { selectedProvider } from "@/lib/smart-kpi-service";
import { skillAuthorTimeoutMs } from "@/lib/skill-author-deadline";
import { createManagedAwareAiProvider } from "../../agent/runs/managed-ai-provider";
import { readSkillBody, requireVdt, skillErrorResponse } from "../service";
import { skillAuthorBudgetResponse, skillAuthorInterruptionResponse, withSkillAuthorDeadline } from "../author-deadline";

export const runtime = "nodejs";
export const maxDuration = 330;
export async function POST(request: Request) {
  let admitted = false;
  try {
    const input = z.object({ projectId: z.string().max(128), vdtId: z.string().max(128), project: z.unknown(),
      providerId: z.enum(["openai_compatible", "anthropic", "gemini", "azure_openai", "local_runner"]), providerConfig: z.record(z.unknown()),
      feedback: z.string().max(4000).optional(),
    }).strict().parse(await readSkillBody(request));
    requireVdt(input.projectId, input.vdtId);
    const { project } = validateStrictVdtProjectCommit(input.project);
    skillAuthorSource(project);
    const timeoutMs = skillAuthorTimeoutMs(input.providerId);
    const result = await withSkillAuthorDeadline(request.signal, timeoutMs, async signal => {
      admitted = true;
      const provider = input.providerId === "local_runner"
        ? createManagedAwareAiProvider({ providerId: input.providerId, providerConfig: { ...input.providerConfig, timeoutMs } }, request.url)
        : await selectedProvider({ input: {}, providerId: input.providerId, providerConfig: input.providerConfig, timeoutMs }, signal, request.url, 256 * 1024);
      return authorSkillFromVdt(provider, project, signal, input.feedback);
    });
    return Response.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const interruption = skillAuthorInterruptionResponse(error) ?? skillAuthorBudgetResponse(error);
    if (interruption) return interruption;
    // Upstream error text may contain provider details; never send it to UI.
    if (admitted && !(error instanceof SkillAuthorInputError)) return Response.json({ ok: false, error: { code: "SKILL_AUTHOR_FAILED", message: "Skill Author could not prepare the draft. Check the selected provider and try again." } }, { status: 422 });
    return skillErrorResponse(error);
  }
}
