import { z } from "zod";
import { LocalSkillRepository, SkillLibraryError } from "@vdt-studio/storage";
import { readAvailableSkill, UNIVERSAL_SKILL_ID } from "@vdt-studio/vdt-agent";
import { assertLocalSkillAccess, getVdtSkill, readSkillBody, setVdtSkill, skillErrorResponse } from "../service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const ids = { projectId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/), vdtId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/) };
export async function GET(request: Request) {
  try {
    assertLocalSkillAccess();
    const query = Object.fromEntries(new URL(request.url).searchParams), input = z.object({ ...ids, rootKpi: z.string().trim().min(1).max(160).optional() }).parse(query);
    try {
      const { pin, selection } = await getVdtSkill(input.projectId, input.vdtId, input.rootKpi);
      const { raw, ...skill } = pin; void raw;
      return Response.json({ ok: true, skill, selection }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      if (!(error instanceof SkillLibraryError) || !["SKILL_NOT_FOUND", "SKILL_VERSION_CHANGED"].includes(error.code)) throw error;
      const selection = new LocalSkillRepository().getSelection(input.projectId, input.vdtId);
      if (!selection) return Response.json({ ok: true, skill: null, needsReselection: true, message: "Choose a skill from your folder. The default skill is no longer in the library." });
      const current = await readAvailableSkill(selection.skillId).catch(() => readAvailableSkill(UNIVERSAL_SKILL_ID)).catch(() => null);
      if (!current) return Response.json({ ok: true, skill: null, selection, needsReselection: true, message: "The selected skill is unavailable. Choose another skill from your folder." });
      const { card } = current;
      return Response.json({ ok: true, skill: { ...card, source: selection.source, reason: "The previously selected version is unavailable or changed. Choose a current skill to continue." },
        selection, needsReselection: true }, { headers: { "cache-control": "no-store" } });
    }
  } catch (error) { return skillErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const input = z.object({ ...ids, skillId: z.string().min(1).max(160), version: z.number().int().positive().optional(), expectedRevision: z.number().int().min(0) }).strict().parse(await readSkillBody(request));
    const { pin, selection } = await setVdtSkill(input);
    const { raw, ...skill } = pin; void raw;
    return Response.json({ ok: true, skill, selection });
  } catch (error) { return skillErrorResponse(error); }
}
