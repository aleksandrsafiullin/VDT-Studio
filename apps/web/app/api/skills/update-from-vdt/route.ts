import { LocalSkillRepository, SkillLibraryError, skillContentHash, validateStrictVdtProjectCommit } from "@vdt-studio/storage";
import { loadAvailableSkillLibrary, UNIVERSAL_SKILL_ID } from "@vdt-studio/vdt-agent";
import { z } from "zod";
import { authorSkillUpdateFromVdt, SkillAuthorInputError } from "@/lib/skill-author";
import { skillAuthorSource, type SkillUpdateTarget } from "@/lib/skill-workflow";
import { selectedProvider } from "@/lib/smart-kpi-service";
import { skillAuthorTimeoutMs } from "@/lib/skill-author-deadline";
import { createManagedAwareAiProvider } from "../../agent/runs/managed-ai-provider";
import { readSkillBody, requireVdt, skillErrorResponse } from "../service";
import { skillAuthorBudgetResponse, skillAuthorInterruptionResponse, withSkillAuthorDeadline } from "../author-deadline";

export const runtime = "nodejs";
export const maxDuration = 330;

const inputSchema = z.object({
  projectId: z.string().min(1).max(128), vdtId: z.string().min(1).max(128), project: z.unknown(),
  providerId: z.enum(["openai_compatible", "anthropic", "gemini", "azure_openai", "local_runner"]), providerConfig: z.record(z.string(), z.unknown()),
  base: z.object({ id: z.string().min(1).max(160), version: z.number().int().positive(), contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict(),
  selectionRevision: z.number().int().positive(), feedback: z.string().max(4000).optional()
}).strict();

async function updateContext(input: z.infer<typeof inputSchema>) {
  const repository = new LocalSkillRepository(), library = await loadAvailableSkillLibrary(repository);
  const selection = repository.getSelection(input.projectId, input.vdtId);
  if (!selection || selection.revision !== input.selectionRevision || selection.skillId !== input.base.id
    || selection.version !== input.base.version || selection.contentHash !== input.base.contentHash) {
    throw new SkillLibraryError("SKILL_CONFLICT", "The tree's selected skill changed. Reload its Context before preparing an update.");
  }
  if (selection.skillId === UNIVERSAL_SKILL_ID) throw new SkillLibraryError("UNIVERSAL_SKILL_UPDATE", "Create a new thematic skill from this tree instead of updating the shared universal method.");
  const base = repository.get(selection.skillId, selection.version), latest = repository.get(selection.skillId), filePath = library.files.paths[selection.skillId];
  if (!base || base.contentHash !== selection.contentHash || !latest || !filePath
    || library.files.issues.some(issue => issue.path === filePath)) {
    throw new SkillLibraryError("SKILL_CONFLICT", "The selected skill is missing or its working file needs attention. Fix it in the library before preparing an update.");
  }
  const raw = repository.files.read(filePath), fileHash = skillContentHash(raw);
  if (fileHash !== (latest.fileHash ?? latest.contentHash)) throw new SkillLibraryError("SKILL_CONFLICT", "The working skill changed while it was being read. Prepare the update again.");
  const target: SkillUpdateTarget = { id: latest.id, version: latest.version, contentHash: latest.contentHash, fileHash,
    baseVersion: base.version, baseContentHash: base.contentHash, selectionRevision: selection.revision };
  return { baseRaw: base.raw, raw, target };
}

export async function POST(request: Request) {
  let admitted = false;
  try {
    const input = inputSchema.parse(await readSkillBody(request));
    requireVdt(input.projectId, input.vdtId);
    const { project } = validateStrictVdtProjectCommit(input.project);
    skillAuthorSource(project);
    const context = await updateContext(input);
    const timeoutMs = skillAuthorTimeoutMs(input.providerId);
    const proposal = await withSkillAuthorDeadline(request.signal, timeoutMs, async signal => {
      admitted = true;
      const provider = input.providerId === "local_runner"
        ? createManagedAwareAiProvider({ providerId: input.providerId, providerConfig: { ...input.providerConfig, timeoutMs } }, request.url)
        : await selectedProvider({ input: {}, providerId: input.providerId, providerConfig: input.providerConfig, timeoutMs }, signal, request.url, 256 * 1024);
      const proposal = await authorSkillUpdateFromVdt(provider, project, context, signal, input.feedback);
      signal.throwIfAborted();
      requireVdt(input.projectId, input.vdtId);
      const current = await updateContext(input);
      signal.throwIfAborted();
      if (JSON.stringify(current.target) !== JSON.stringify(context.target) || current.raw !== context.raw) {
        throw new SkillLibraryError("SKILL_CONFLICT", "The working skill changed during preparation. Prepare the update again to review its current content.");
      }
      return proposal;
    });
    return Response.json({ ok: true, proposal }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const interruption = skillAuthorInterruptionResponse(error) ?? skillAuthorBudgetResponse(error);
    if (interruption) return interruption;
    if (admitted && !(error instanceof SkillLibraryError) && !(error instanceof SkillAuthorInputError)) {
      return Response.json({ ok: false, error: { code: "SKILL_AUTHOR_FAILED", message: "Skill Author could not prepare the update. Check the selected provider and try again." } }, { status: 422 });
    }
    return skillErrorResponse(error);
  }
}
