import { LocalSkillRepository, SkillLibraryError, skillContentHash } from "@vdt-studio/storage";
import { loadAvailableSkillLibrary, parseFrontmatter, publishManagedSkill, synchronizeSkillFiles, UNIVERSAL_SKILL_ID } from "@vdt-studio/vdt-agent";
import { z } from "zod";
import { readSkillBody, requireVdt, skillErrorResponse } from "../service";

export const runtime = "nodejs";

const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const version = z.number().int().positive().max(999_999_999);
const updateSchema = z.object({
  projectId: z.string().min(1).max(128), vdtId: z.string().min(1).max(128),
  raw: z.string().min(1).max(128 * 1024),
  target: z.object({
    id: z.string().min(1).max(160), version, contentHash: hash, fileHash: hash,
    baseVersion: version, baseContentHash: hash, selectionRevision: version
  }).strict()
}).strict();

/** Explicit human-reviewed update. Preparation never grants publishing rights;
 * every selection, immutable version and editable file guard is checked again. */
export async function POST(request: Request) {
  try {
    const input = updateSchema.parse(await readSkillBody(request));
    const vdt = requireVdt(input.projectId, input.vdtId), target = input.target;
    if (target.id === UNIVERSAL_SKILL_ID) throw new SkillLibraryError("SKILL_UPDATE_UNIVERSAL", "Save a new thematic skill from this tree instead of updating the universal skill.");
    const repository = new LocalSkillRepository();
    await loadAvailableSkillLibrary(repository);
    const skill = repository.withSelectionWriteLock(input.projectId, input.vdtId, () => repository.withSkillWriteLock(target.id, () => {
      const selection = repository.getSelection(input.projectId, input.vdtId);
      if (!selection || selection.revision !== target.selectionRevision || selection.skillId !== target.id
        || selection.version !== target.baseVersion || selection.contentHash !== target.baseContentHash) {
        throw new SkillLibraryError("SKILL_CONFLICT", "The skill selected for this tree changed. Prepare the update again.");
      }
      const base = repository.get(target.id, target.baseVersion), latest = repository.get(target.id);
      if (!base || base.contentHash !== target.baseContentHash || !latest || latest.version !== target.version || latest.contentHash !== target.contentHash) {
        throw new SkillLibraryError("SKILL_CONFLICT", "This skill changed after review. Prepare the update again.");
      }
      // A fresh scan enforces current identity, uniqueness and valid editor bytes.
      // It cannot restore a removed working file from historical content.
      const files = synchronizeSkillFiles(repository);
      const filePath = files.paths[target.id];
      if (!filePath || files.issues.some(issue => issue.path === filePath)) throw new SkillLibraryError("SKILL_CONFLICT", "The working skill was removed or needs attention. Refresh the library before updating.");
      const working = repository.files.read(filePath);
      if (skillContentHash(working) !== target.fileHash) throw new SkillLibraryError("SKILL_CONFLICT", "The skill file changed after review. Prepare the update again.");
      const original = parseFrontmatter(working).attributes, proposed = parseFrontmatter(input.raw).attributes;
      if (original.id !== proposed.id || original.name !== proposed.name) throw new SkillLibraryError("SKILL_CONFLICT", "Keep the used skill's identity when updating it. Save a new skill to change its identity.");
      return publishManagedSkill({ id: target.id, expectedVersion: target.version, expectedContentHash: target.contentHash,
        expectedFileHash: target.fileHash, raw: input.raw,
        sourceVdt: { projectId: input.projectId, vdtId: input.vdtId, rootKpi: vdt.rootKpi ?? vdt.name } }, repository);
    }));
    return Response.json({ ok: true, skill }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return skillErrorResponse(error); }
}
