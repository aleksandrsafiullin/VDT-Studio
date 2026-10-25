import { LocalSkillRepository } from "@vdt-studio/storage";
import { loadAvailableSkillLibrary, publishManagedSkill, readAvailableSkill, skillCard } from "@vdt-studio/vdt-agent";
import { z } from "zod";
import { assertLocalSkillAccess, readSkillBody, skillErrorResponse } from "./service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertLocalSkillAccess();
    const query = new URL(request.url).searchParams, id = query.get("id");
    if (id) {
      const version = query.has("version") ? z.coerce.number().int().positive().parse(query.get("version")) : undefined;
      const { skill, card } = await readAvailableSkill(id, version);
      return Response.json({ ok: true, skill: { ...card, raw: skill.raw } }, { headers: { "cache-control": "no-store" } });
    }
    const repository = new LocalSkillRepository(), library = await loadAvailableSkillLibrary(repository);
    return Response.json({ ok: true, skills: library.skills.map(skill => skillCard(skill, repository.get(skill.id), library.files.paths[skill.id])),
      files: { rootPath: library.files.rootPath, folders: library.files.folders, issues: library.files.issues } }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return skillErrorResponse(error); }
}

const publishSchema = z.object({ raw: z.string().min(1).max(128 * 1024), id: z.string().max(160).optional(), expectedVersion: z.number().int().min(0).optional(),
  folder: z.string().max(700).optional(),
  sourceVdt: z.object({ projectId: z.string().max(128), vdtId: z.string().max(128), rootKpi: z.string().max(160) }).strict().optional() }).strict();

export async function POST(request: Request) {
  try {
    const body = publishSchema.parse(await readSkillBody(request));
    const repository = new LocalSkillRepository();
    await loadAvailableSkillLibrary(repository);
    const skill = publishManagedSkill(body, repository);
    return Response.json({ ok: true, skill }, { status: body.id ? 200 : 201 });
  } catch (error) { return skillErrorResponse(error); }
}
