import { LocalSkillRepository, SkillLibraryError } from "@vdt-studio/storage";
import { loadAvailableSkillLibrary } from "@vdt-studio/vdt-agent";
import { z } from "zod";
import { openSkillPath } from "@/lib/open-skill-path";
import { hasSameLocalOrigin } from "@/lib/local-request-origin";
import { readSkillBody, skillErrorResponse } from "../service";

export const runtime = "nodejs";
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open.folder"), folder: z.string().max(700) }).strict(),
  z.object({ action: z.literal("open.file"), filePath: z.string().max(700) }).strict(),
  z.object({ action: z.literal("open.skill"), id: z.string().min(1).max(160) }).strict()
]);

export async function POST(request: Request) {
  try {
    const body = actionSchema.parse(await readSkillBody(request));
    if (!hasSameLocalOrigin(request)) throw new SkillLibraryError("ORIGIN_REJECTED", "File actions require the local application's own origin.");
    const repository = new LocalSkillRepository(), library = await loadAvailableSkillLibrary(repository);
    switch (body.action) {
      case "open.folder": await repository.files.openInEditor(body.folder, "folder", openSkillPath); break;
      case "open.file": await repository.files.openInEditor(body.filePath, "file", openSkillPath); break;
      case "open.skill": {
        const filePath = library.files.paths[body.id];
        if (!filePath) throw new SkillLibraryError("SKILL_NOT_FOUND", "This skill was moved or removed. Refresh the library to see the current files.");
        await repository.files.openInEditor(filePath, "file", openSkillPath);
        break;
      }
    }
    return Response.json({ ok: true });
  } catch (error) { return skillErrorResponse(error); }
}
