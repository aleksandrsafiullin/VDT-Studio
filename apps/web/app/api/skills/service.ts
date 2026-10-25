import { LocalSkillRepository, SkillLibraryError } from "@vdt-studio/storage";
import { pinAvailableSkill, resolveVdtSkill } from "@vdt-studio/vdt-agent";
import { aiRouteGuardStatus, readAiRouteBody } from "@/lib/ai-route-body";
import { openVdtStorageDatabase } from "../vdt/storage-database";
import { resolveTrustedStorageWriteMode } from "../vdt/storage-write-adapter";

export function assertLocalSkillAccess() {
  if (!resolveTrustedStorageWriteMode()) throw new SkillLibraryError("LOCAL_SKILLS_ONLY", "Skills are available in the local application.");
}

export async function readSkillBody(request: Request) {
  assertLocalSkillAccess();
  // Next can reconstruct request.url with localhost while the browser used
  // 127.0.0.1. Only the validated direct local Host may reconcile that origin.
  return JSON.parse((await readAiRouteBody(request, 512 * 1024, { allowLocalHostReconstruction: true })).text) as unknown;
}

export function skillErrorResponse(error: unknown): Response {
  const code = error instanceof SkillLibraryError ? error.code : (error as { code?: string })?.code ?? "INVALID_SKILL";
  const status = aiRouteGuardStatus(error) ?? (code === "LOCAL_SKILLS_ONLY" ? 403 : code === "SKILL_NOT_FOUND" || code === "VDT_NOT_FOUND" ? 404 : code === "SKILL_CONFLICT" ? 409 : 400);
  return Response.json({ ok: false, error: { code, message: error instanceof Error ? error.message : "Skill operation failed." } }, { status });
}

export function requireVdt(projectId: string, vdtId: string) {
  const database = openVdtStorageDatabase(process.cwd());
  try {
    const vdt = database.getVdt(vdtId);
    if (!vdt || vdt.projectId !== projectId || !database.getProject(projectId)) throw new SkillLibraryError("VDT_NOT_FOUND", "VDT was not found in this project.");
    return vdt;
  } finally { database.close(); }
}

export async function getVdtSkill(projectId: string, vdtId: string, rootKpi?: string) {
  const vdt = requireVdt(projectId, vdtId);
  return resolveVdtSkill({ projectId, vdtId, rootKpi: rootKpi ?? vdt.rootKpi ?? vdt.name });
}

export async function setVdtSkill(input: { projectId: string; vdtId: string; skillId: string; version?: number | undefined; expectedRevision: number }) {
  const vdt = requireVdt(input.projectId, input.vdtId);
  const pin = await pinAvailableSkill(input.skillId, "user", "Selected by you in Context.", input.version);
  const selection = new LocalSkillRepository().select(input.projectId, input.vdtId, { skillId: pin.id, version: pin.version,
    contentHash: pin.contentHash, source: pin.source, reason: pin.reason, rootKpi: vdt.rootKpi ?? vdt.name }, input.expectedRevision);
  return { pin, selection };
}
