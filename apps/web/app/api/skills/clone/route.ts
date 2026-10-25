import { publishManagedSkill, readAvailableSkill } from "@vdt-studio/vdt-agent";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { readSkillBody, skillErrorResponse } from "../service";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const body = z.object({ id: z.string().min(1).max(160), version: z.number().int().positive().optional(), folder: z.string().max(700).optional(), title: z.string().trim().min(1).max(160).optional() }).strict().parse(await readSkillBody(request));
    const { skill: original, card } = await readAvailableSkill(body.id, body.version);
    const raw = original.raw.replace(/^title:.*$/m, () => `title: ${JSON.stringify(body.title ?? `${original.title} (copy)`)}`);
    const skill = publishManagedSkill({ id: `user.${randomUUID()}`, expectedVersion: 0, raw, folder: body.folder, lineage: { skillId: card.id, version: card.version, contentHash: card.contentHash } });
    return Response.json({ ok: true, skill }, { status: 201 });
  } catch (error) { return skillErrorResponse(error); }
}
