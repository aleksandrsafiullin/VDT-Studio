import { randomUUID } from "node:crypto";
import { LocalSkillRepository, SkillLibraryError, skillContentHash, type SkillFileIssue, type StoredSkillSelection, type StoredSkillVersion } from "@vdt-studio/storage";
import { z } from "zod";
import { loadDefaultSkillLibrary, loadDefaultSkillResources, parseFrontmatter, parseSkillMarkdown, readExecutableSkillTopology, type VdtSkill, type VdtSkillLibrary } from "./index";

export const UNIVERSAL_SKILL_ID = "generic.logical_kpi_decomposition";
export interface SkillCard {
  id: string; title: string; description: string; domain: string; version: number; contentHash: string;
  updatedAt?: string; lineage?: StoredSkillVersion["lineage"]; sourceVdt?: StoredSkillVersion["sourceVdt"];
  folder: string; filePath?: string;
}
export interface SkillPin extends SkillCard { path: string; raw: string; source: StoredSkillSelection["source"]; reason: string }

export const skillAuthorDraftSchema = z.object({
  title: z.string().trim().min(1).max(160), description: z.string().trim().min(1).max(600),
  domain: z.string().trim().min(1).max(100), patterns: z.array(z.string().trim().min(1).max(160)).min(1).max(20),
  instructions: z.string().trim().min(40).max(28_000)
}).strict();
export type SkillAuthorDraft = z.infer<typeof skillAuthorDraftSchema>;

export interface ManagedSkillFiles {
  rootPath: string; folders: string[]; paths: Record<string, string>; issues: SkillFileIssue[];
}

/** Admit externally saved Markdown without writing over the editor's file.
 * Immutable host versions own identity/version; fileHash remembers the exact
 * admitted working bytes, including a possibly older frontmatter version. */
export function synchronizeSkillFiles(repository = new LocalSkillRepository()): ManagedSkillFiles {
  let snapshot = repository.files.scan();
  if (!repository.filesInitialized) {
    const present = new Set(snapshot.files.map(file => fileIdentity(file.raw)));
    for (const record of repository.list()) {
      if (!present.has(record.id)) repository.files.create("", parseSkillMarkdown(record.id, record.raw).title, record.id, record.raw);
    }
    repository.initializeFiles();
    snapshot = repository.files.scan();
  }
  const state: ManagedSkillFiles = { rootPath: repository.files.rootPath, folders: snapshot.folders, paths: {}, issues: [...snapshot.issues] };
  const groups = new Map<string, typeof snapshot.files>();
  for (const file of snapshot.files) {
    const id = fileIdentity(file.raw);
    if (id) groups.set(id, [...groups.get(id) ?? [], file]);
    else if (/(?:^|\/)skill\.md$/i.test(file.path) || /^id:/m.test(file.raw)) state.issues.push({ path: file.path, message: "Add a name and description to the skill's YAML frontmatter, or restore its existing id." });
  }
  for (const [id, files] of groups) {
    state.paths[id] = files[0]!.path;
    if (files.length !== 1) { for (const file of files) state.issues.push({ path: file.path, message: "Duplicate skill identity. Give the copied skill a different name (and remove any copied id)." }); continue; }
    const file = files[0]!;
    try {
      const previous = repository.get(id), fileHash = skillContentHash(file.raw);
      if (previous && (fileHash === previous.fileHash || fileHash === previous.contentHash)) continue;
      const { raw } = prepareSkillMarkdown(file.raw, id, (previous?.version ?? 0) + 1);
      repository.publish({ id, raw, expectedVersion: previous?.version ?? 0, fileHash,
        ...(previous?.lineage ? { lineage: previous.lineage } : {}), ...(previous?.sourceVdt ? { sourceVdt: previous.sourceVdt } : {}) });
    } catch (error) { state.issues.push({ path: file.path, message: error instanceof Error ? error.message : "The skill could not be synchronized." }); }
  }
  return state;
}

function fileIdentity(raw: string): string | undefined {
  try {
    const { attributes } = parseFrontmatter(raw);
    if (typeof attributes.id === "string" && attributes.id.trim()) return attributes.id.trim();
    if (typeof attributes.name === "string" && attributes.name.trim()) return `user.${skillContentHash(attributes.name.trim().normalize("NFKC").toLocaleLowerCase()).slice(7, 39)}`;
  } catch { /* The visible issue will identify the malformed SKILL.md. */ }
  return undefined;
}

export async function loadAvailableSkillLibrary(repository = new LocalSkillRepository()): Promise<VdtSkillLibrary & { files: ManagedSkillFiles }> {
  const seedIssues = await initializeSkillLibrary(repository);
  const files = synchronizeSkillFiles(repository);
  files.issues.push(...seedIssues);
  const skills = repository.list().filter(record => files.paths[record.id]).map(record => parseSkillMarkdown(files.paths[record.id]!, record.raw));
  return { registry: skills.map(skill => ({
    id: skill.id, path: skill.path, domain: skill.domain, matchingTerms: skill.frontmatter.patterns,
    kpiPatterns: skill.frontmatter.kpiPatterns, inputRequirements: skill.frontmatter.requires,
    expectedOutputs: skill.frontmatter.outputs, confidenceHints: "Verify that this file's guidance applies to the current context.", whenNotToUse: "Outside the declared scope."
  })), skills, byId: new Map(skills.map(skill => [skill.id, skill])), files };
}

async function initializeSkillLibrary(repository: LocalSkillRepository): Promise<SkillFileIssue[]> {
  const bundled = await loadDefaultSkillLibrary(), resources = await loadDefaultSkillResources();
  const current = synchronizeSkillFiles(repository), issues: SkillFileIssue[] = [];
  for (const skill of bundled.skills) {
    if (repository.hasSeed(skill.id)) continue;
    const relative = `${skill.path.replace(/\.(md|markdown)$/i, "")}/SKILL.md`;
    const packageFolder = relative.slice(0, relative.lastIndexOf("/"));
    try {
      if (!current.paths[skill.id]) {
        const created = repository.files.writeSeedFile(relative, skill.raw);
        if (!created && fileIdentity(repository.files.read(relative)) !== skill.id) throw new SkillLibraryError("SKILL_CONFLICT", "This folder already contains another skill; its files were kept.");
        for (const [name, raw] of Object.entries(resources[skill.id] ?? {})) repository.files.writeSeedFile(`${packageFolder}/${name}`, raw);
      }
      repository.installSeed({ id: skill.id, version: skill.frontmatter.version ?? 1, raw: skill.raw });
      repository.markSeed(skill.id);
    } catch (error) { issues.push({ path: relative, message: error instanceof Error ? error.message : "Could not initialize this supplied skill." }); }
  }
  return issues;
}

export function skillCard(skill: VdtSkill, record?: StoredSkillVersion | null, filePath?: string): SkillCard {
  const relative = filePath ?? skill.path;
  return { id: skill.id, title: skill.title, description: skill.frontmatter.description ?? "", domain: skill.domain,
    version: record?.version ?? skill.frontmatter.version ?? 1, contentHash: skillContentHash(skill.raw),
    folder: relative?.includes("/") ? relative.slice(0, relative.lastIndexOf("/")) : "", ...(filePath ? { filePath } : {}),
    ...(record ? { updatedAt: record.createdAt } : {}), ...(record?.lineage ? { lineage: record.lineage } : {}), ...(record?.sourceVdt ? { sourceVdt: record.sourceVdt } : {}) };
}

export async function readAvailableSkill(id: string, version?: number, repository = new LocalSkillRepository()): Promise<{ skill: VdtSkill; card: SkillCard }> {
  await initializeSkillLibrary(repository);
  const files = synchronizeSkillFiles(repository);
  const record = repository.get(id, version);
  const skill = record ? parseSkillMarkdown(files.paths[id] ?? `${id}/SKILL.md`, record.raw) : undefined;
  if (!skill || version === undefined && !files.paths[id]) throw new SkillLibraryError("SKILL_NOT_FOUND", "Skill was not found in the skills folder.");
  const card = skillCard(skill, record, files.paths[id]);
  if (skill.id !== id || record && skill.frontmatter.version !== record.version) throw new SkillLibraryError("SKILL_CORRUPT", "Stored skill identity check failed.");
  if (version !== undefined && version !== card.version) throw new SkillLibraryError("SKILL_NOT_FOUND", "This skill version is unavailable.");
  return { skill, card };
}

/** Provisional lexical recall only. The agent can explicitly select another
 * skill after reading it; scores are never semantic confidence. */
export function rankSkillCandidates(query: string, library: VdtSkillLibrary) {
  const normalize = (text: string) => text.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const normalized = ` ${normalize(query)} `;
  const scored = library.skills.filter(skill => skill.id !== UNIVERSAL_SKILL_ID).map(skill => {
    const terms = [...new Set([...skill.frontmatter.kpiPatterns, ...skill.frontmatter.patterns, skill.title].map(normalize).filter(Boolean))];
    const matches = terms.filter(term => normalized.includes(` ${term} `));
    const score = matches.reduce((max, term) => Math.max(max, term === normalize(query) ? 1000 : term.split(" ").length * 20 + term.length), 0);
    return { skill, score, matchedTerms: matches, reason: "Preliminary match to the KPI and request context." };
  }).filter(candidate => candidate.score > 0).sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id));
  const universal = library.byId.get(UNIVERSAL_SKILL_ID);
  return scored.length ? scored : universal ? [{ skill: universal, score: 1, matchedTerms: [] as string[], reason: "Universal skill: no specific preliminary match was found." }] : [];
}

export async function pinAvailableSkill(id: string, source: SkillPin["source"], reason: string, version?: number, repository = new LocalSkillRepository()): Promise<SkillPin> {
  const { skill, card } = await readAvailableSkill(id, version, repository);
  return { ...card, path: skill.path, raw: skill.raw, source, reason };
}

export async function resolveVdtSkill(input: { projectId?: string; vdtId?: string; rootKpi: string; context?: string }, repository = new LocalSkillRepository()): Promise<{ pin: SkillPin; selection?: StoredSkillSelection }> {
  const selection = input.projectId && input.vdtId ? repository.getSelection(input.projectId, input.vdtId) : null;
  if (selection && (selection.source !== "auto" || selection.rootKpi === input.rootKpi)) {
    const pin = await pinAvailableSkill(selection.skillId, selection.source, selection.reason, selection.version, repository);
    if (pin.contentHash !== selection.contentHash) throw new SkillLibraryError("SKILL_VERSION_CHANGED", "The selected skill content changed. Choose a skill again in Context.");
    return { pin, selection };
  }
  const candidate = rankSkillCandidates(input.rootKpi, await loadAvailableSkillLibrary(repository))[0];
  if (!candidate) throw new SkillLibraryError("SKILL_NOT_FOUND", "Universal skill is unavailable.");
  const pin = await pinAvailableSkill(candidate.skill.id, "auto", candidate.reason, undefined, repository);
  if (!input.projectId || !input.vdtId) return { pin };
  try {
    const next = repository.select(input.projectId, input.vdtId, { skillId: pin.id, version: pin.version, contentHash: pin.contentHash, source: "auto", reason: pin.reason, rootKpi: input.rootKpi }, selection?.revision ?? 0);
    return { pin, selection: next };
  } catch (error) {
    if (!(error instanceof SkillLibraryError) || error.code !== "SKILL_CONFLICT") throw error;
    const concurrent = repository.getSelection(input.projectId, input.vdtId)!;
    return { pin: await pinAvailableSkill(concurrent.skillId, concurrent.source, concurrent.reason, concurrent.version, repository), selection: concurrent };
  }
}

export function draftSkillMarkdown(draft: SkillAuthorDraft): string {
  const quote = (value: string) => JSON.stringify(value.replace(/[\r\n]+/g, " "));
  return `---\nid: user.draft\ntitle: ${quote(draft.title)}\ndescription: ${quote(draft.description)}\ndomain: ${quote(draft.domain)}\nversion: 1\npatterns:\n${draft.patterns.map(pattern => `  - ${quote(pattern)}`).join("\n")}\nkpi_patterns:\n${draft.patterns.map(pattern => `  - ${quote(pattern)}`).join("\n")}\nrequires:\n  - site_specific_inputs\noutputs:\n  - root_kpi\n---\n\n${draft.instructions}\n`;
}

export function publishManagedSkill(input: { raw: string; id?: string | undefined; expectedVersion?: number | undefined; folder?: string | undefined; lineage?: StoredSkillVersion["lineage"]; sourceVdt?: StoredSkillVersion["sourceVdt"] }, repository = new LocalSkillRepository()) {
  const attributes = parseFrontmatter(input.raw).attributes;
  const id = input.id ?? (typeof attributes.name === "string" ? fileIdentity(input.raw) : undefined) ?? `user.${randomUUID()}`;
  const expectedVersion = input.expectedVersion ?? 0;
  if (input.id && input.expectedVersion === undefined) throw new SkillLibraryError("INVALID_VERSION", "Editing requires the expected skill version.");
  const files = synchronizeSkillFiles(repository), previous = input.id ? repository.get(input.id) : null;
  if ((previous?.version ?? 0) !== expectedVersion) throw new SkillLibraryError("SKILL_CONFLICT", "This skill changed. Refresh the library before saving.");
  const { raw, skill } = prepareSkillMarkdown(input.raw, id, expectedVersion + 1);
  let filePath = files.paths[id];
  if (filePath && files.issues.some(issue => issue.path === filePath)) throw new SkillLibraryError("SKILL_CONFLICT", "Fix the working file issue before saving this skill.");
  const existingRaw = filePath ? repository.files.read(filePath) : undefined;
  const created = !filePath;
  const working = !input.id && typeof attributes.name === "string" && attributes.id === undefined ? input.raw : raw;
  if (!filePath) filePath = repository.files.createPackage(input.folder ?? "", typeof attributes.name === "string" ? attributes.name : skill.title, working);
  let record: StoredSkillVersion;
  try {
    record = repository.publish({ id, raw, expectedVersion, fileHash: skillContentHash(working),
      ...(input.lineage ?? previous?.lineage ? { lineage: input.lineage ?? previous?.lineage } : {}),
      ...(input.sourceVdt ?? previous?.sourceVdt ? { sourceVdt: input.sourceVdt ?? previous?.sourceVdt } : {}) });
  } catch (error) { if (created) repository.files.removeIfUnchanged(filePath, working); throw error; }
  if (existingRaw !== undefined) repository.files.replace(filePath, raw, existingRaw);
  return { ...skillCard(skill, record, filePath), raw };
}

function prepareSkillMarkdown(input: string, id: string, version: number) {
  if (Buffer.byteLength(input, "utf8") > 128 * 1024) throw new SkillLibraryError("SKILL_TOO_LARGE", "Skill must be at most 128 KiB.");
  const parsed = parseFrontmatter(input), attributes = parsed.attributes;
  const portable = typeof attributes.name === "string" && attributes.name.trim();
  if (portable && (attributes.name!.toString().length > 120 || typeof attributes.description !== "string" || !attributes.description.trim() || attributes.description.length > 600)) throw new SkillLibraryError("INVALID_SKILL", "A SKILL.md needs a name (up to 120 characters) and description (up to 600 characters).");
  // Portable name/description skills receive VDT metadata only in the immutable
  // runtime artifact. Their working files remain ordinary external Markdown.
  const title = parsed.body.match(/^#\s+(.+)$/m)?.[1]?.trim().slice(0, 160) ?? (portable ? String(attributes.name).replace(/[-_]+/g, " ") : "");
  const raw = input.replace(/^(---\r?\n)[\s\S]*?\r?\n---/, frontmatter => {
    const set = (key: string, value: string, always = false) => {
      if (new RegExp(`^${key}:`, "m").test(next)) { if (always) next = next.replace(new RegExp(`^${key}:.*$`, "m"), () => `${key}: ${value}`); }
      else next = next.replace(/\r?\n---$/, () => `\n${key}: ${value}\n---`);
    };
    let next = frontmatter;
    set("id", id, true);
    if (portable) {
      set("title", JSON.stringify(title)); set("domain", "custom");
      set("patterns", `\n  - ${JSON.stringify(title)}`); set("kpi_patterns", `\n  - ${JSON.stringify(title)}`);
      set("requires", "\n  - site_specific_inputs"); set("outputs", "\n  - root_kpi");
    }
    if (/^version:/m.test(next)) next = next.replace(/^version:.*$/m, `version: ${version}`);
    else next = next.replace(/^---/, `---\nversion: ${version}`);
    return next;
  });
  if (Buffer.byteLength(raw, "utf8") > 128 * 1024) throw new SkillLibraryError("SKILL_TOO_LARGE", "Skill must be at most 128 KiB after assigning its identity and version.");
  const skill = parseSkillMarkdown(`user/${id}.md`, raw);
  if (skill.body.length < 20) throw new SkillLibraryError("INVALID_SKILL", "Add instructions describing when and how to use this skill.");
  readExecutableSkillTopology(skill); // Reject malformed declarative blocks at save.
  return { raw, skill };
}
