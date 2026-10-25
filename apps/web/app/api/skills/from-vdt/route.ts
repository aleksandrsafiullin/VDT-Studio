import { validateStrictVdtProjectCommit } from "@vdt-studio/storage";
import { z } from "zod";
import { authorSkillFromVdt } from "@/lib/skill-author";
import { selectedProvider } from "@/lib/smart-kpi-service";
import { createManagedAwareAiProvider } from "../../agent/runs/managed-ai-provider";
import { readSkillBody, requireVdt, skillErrorResponse } from "../service";

export const runtime = "nodejs";
export const maxDuration = 120;
export async function POST(request: Request) {
  let admitted = false;
  try {
    const input = z.object({ projectId: z.string().max(128), vdtId: z.string().max(128), project: z.unknown(),
      providerId: z.enum(["openai_compatible", "anthropic", "gemini", "azure_openai", "local_runner"]), providerConfig: z.record(z.unknown()),
    }).strict().parse(await readSkillBody(request));
    requireVdt(input.projectId, input.vdtId);
    const { project } = validateStrictVdtProjectCommit(input.project);
    const controller = new AbortController(), abort = () => controller.abort();
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) abort();
    const timeout = setTimeout(abort, 90_000);
    try {
      admitted = true;
      const provider = input.providerId === "local_runner"
        ? createManagedAwareAiProvider({ providerId: input.providerId, providerConfig: { ...input.providerConfig, timeoutMs: 90_000 } }, request.url)
        : await selectedProvider({ input: {}, providerId: input.providerId, providerConfig: input.providerConfig, timeoutMs: 90_000 }, controller.signal, request.url, 256 * 1024);
      const result = await authorSkillFromVdt(provider, project, controller.signal);
      return Response.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
    } finally { clearTimeout(timeout); request.signal.removeEventListener("abort", abort); }
  } catch (error) {
    // Upstream error text may contain provider details; never send it to UI.
    if (admitted) return Response.json({ ok: false, error: { code: "SKILL_AUTHOR_FAILED", message: "Skill Author could not prepare the draft. Check the selected provider and try again." } }, { status: 422 });
    return skillErrorResponse(error);
  }
}
