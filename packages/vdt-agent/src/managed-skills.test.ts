import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalSkillRepository, skillContentHash } from "@vdt-studio/storage";
import { draftSkillMarkdown, loadAvailableSkillLibrary, publishManagedSkill, rankSkillCandidates, readAvailableSkill, resolveVdtSkill, synchronizeSkillFiles, UNIVERSAL_SKILL_ID } from "./managed-skills";
import { loadDefaultSkillLibrary } from "./index";

let root: string, repository: LocalSkillRepository;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "vdt-managed-skills-")); repository = new LocalSkillRepository(root); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
const draft = (title = "Өндіріс") => draftSkillMarkdown({ title, description: "A reusable method", domain: "custom", patterns: ["Өндіріс көлемі", "Выпуск продукции"], instructions: "## When to use\n\nUse measured quantities with consistent units, then validate every dependency." });

describe("managed skill integration", () => {
  it("initializes one writable disk library with all supplied skills and their supporting files", async () => {
    const original = await loadDefaultSkillLibrary(), available = await loadAvailableSkillLibrary(repository);
    expect(available.skills.map(skill => skill.id).sort()).toEqual(original.skills.map(skill => skill.id).sort());
    for (const skill of available.skills) {
      expect(skill.path).toMatch(/\/SKILL\.md$/);
      expect(repository.files.read(skill.path)).toBe(original.byId.get(skill.id)?.raw);
      expect(fs.statSync(repository.files.filePath(skill.path)).mode & 0o200).toBe(0o200);
    }
    const folder = path.join(repository.files.rootPath, "mining/excavation");
    expect(fs.readFileSync(path.join(folder, "references/excavation-defaults.yaml"), "utf8")).toContain(":");
    expect(JSON.parse(fs.readFileSync(path.join(folder, "evals/excavation.evals.json"), "utf8"))).toBeDefined();
  });
  it("uses edits to a supplied skill without duplicates and retains previously pinned bytes", async () => {
    const initial = await resolveVdtSkill({ projectId: "p", vdtId: "v", rootKpi: "Revenue" }, repository);
    const file = initial.pin.filePath!;
    const original = repository.files.read(file), changed = `${original}\n## My local guidance\n\nReview the operating scope before applying this approach.\n`;
    fs.writeFileSync(repository.files.filePath(file), changed);
    const available = await loadAvailableSkillLibrary(new LocalSkillRepository(root));
    expect(available.skills.filter(skill => skill.id === initial.pin.id)).toHaveLength(1);
    expect(available.byId.get(initial.pin.id)?.body).toContain("My local guidance");
    expect(repository.files.read(file)).toBe(changed);
    expect((await resolveVdtSkill({ projectId: "p", vdtId: "v", rootKpi: "Revenue" }, repository)).pin.contentHash).toBe(initial.pin.contentHash);
    expect((await readAvailableSkill(initial.pin.id, undefined, repository)).card.version).toBe(initial.pin.version + 1);
    expect((await readAvailableSkill(initial.pin.id, initial.pin.version, repository)).skill.raw).toBe(initial.pin.raw);
  });
  it("respects external deletion of supplied files after restart while retaining history", async () => {
    const original = await readAvailableSkill(UNIVERSAL_SKILL_ID, undefined, repository);
    fs.unlinkSync(repository.files.filePath(original.card.filePath!));
    const available = await loadAvailableSkillLibrary(new LocalSkillRepository(root));
    expect(available.byId.has(UNIVERSAL_SKILL_ID)).toBe(false);
    await expect(readAvailableSkill(UNIVERSAL_SKILL_ID, undefined, repository)).rejects.toThrow(/not found/);
    expect((await readAvailableSkill(UNIVERSAL_SKILL_ID, original.card.version, repository)).skill.raw).toBe(original.skill.raw);
    expect(fs.existsSync(repository.files.filePath(original.card.filePath!))).toBe(false);
  });
  it("loads portable name/description SKILL.md files and ignores companion documentation", async () => {
    await loadAvailableSkillLibrary(repository);
    const raw = '---\nname: delivery-throughput\ndescription: Explain delivery volume from capacity and operating time.\n---\n\n# Delivery throughput\n\nMultiply active capacity by productive operating time.\n';
    repository.files.writeSeedFile("Logistics/delivery/SKILL.md", raw);
    repository.files.writeSeedFile("Logistics/delivery/references/README.md", "# Supporting information\n\nNo skill frontmatter is needed here.");
    const library = await loadAvailableSkillLibrary(repository);
    const skill = library.skills.find(skill => skill.frontmatter.name === "delivery-throughput")!;
    expect(skill.title).toBe("Delivery throughput");
    expect(library.files.issues).toEqual([]);
    expect(repository.files.read("Logistics/delivery/SKILL.md")).toBe(raw);
    repository.files.renameFolder("Logistics", "Operations");
    expect((await loadAvailableSkillLibrary(repository)).byId.get(skill.id)?.path).toBe("Operations/delivery/SKILL.md");
    const created = publishManagedSkill({ raw: raw.replace("delivery-throughput", "warehouse-throughput") }, repository);
    expect(created.filePath).toBe("warehouse-throughput/SKILL.md");
    expect(repository.files.read(created.filePath!)).not.toMatch(/^id:|^version:/m);
  });
  it("admits external edits as new immutable versions without rewriting the editor's file", async () => {
    repository.files.createFolder("", "Производство");
    const first = publishManagedSkill({ raw: draft(), folder: "Производство" }, repository);
    const external = first.raw.replace("A reusable method", "A changed reusable method");
    fs.writeFileSync(repository.files.filePath(first.filePath!), external);
    const library = await loadAvailableSkillLibrary(repository);
    expect(library.files.paths[first.id]).toBe(first.filePath);
    expect(library.byId.get(first.id)?.frontmatter.version).toBe(2);
    expect(repository.files.read(first.filePath!)).toBe(external);
    expect((await readAvailableSkill(first.id, 1, repository)).skill.raw).toBe(first.raw);
    synchronizeSkillFiles(repository); synchronizeSkillFiles(repository);
    expect(repository.get(first.id)?.version).toBe(2);
    expect((await readAvailableSkill(first.id, undefined, repository)).card.folder).toBe("Производство/өндіріс");
    // An explicit restore writes canonical bytes; the editor's old version field
    // must not manufacture a third content version.
    fs.writeFileSync(repository.files.filePath(first.filePath!), repository.get(first.id)!.raw);
    synchronizeSkillFiles(repository);
    expect(repository.get(first.id)?.version).toBe(2);
  });
  it("keeps invalid and duplicate working files visible without replacing last valid content", () => {
    const first = publishManagedSkill({ raw: draft() }, repository);
    fs.writeFileSync(repository.files.filePath(first.filePath!), first.raw.replace(/^title:.*$/m, ""));
    expect(synchronizeSkillFiles(repository).issues[0]?.path).toBe(first.filePath);
    expect(repository.get(first.id)?.version).toBe(1);
    fs.writeFileSync(repository.files.filePath(first.filePath!), first.raw);
    fs.copyFileSync(repository.files.filePath(first.filePath!), path.join(repository.files.rootPath, "duplicate.md"));
    expect(synchronizeSkillFiles(repository).issues).toHaveLength(2);
    expect(repository.get(first.id)?.raw).toBe(first.raw);
  });
  it("preserves identity and version when folders move or files are renamed in the file manager", async () => {
    repository.files.createFolder("", "First"); repository.files.createFolder("", "Second");
    const first = publishManagedSkill({ raw: draft(), folder: "First" }, repository);
    const moved = repository.files.moveFile(first.filePath!, "Second");
    fs.renameSync(repository.files.filePath(moved), path.join(repository.files.rootPath, "Second", "renamed.md"));
    const read = await readAvailableSkill(first.id, undefined, repository);
    expect(read.card).toMatchObject({ id: first.id, version: 1, folder: "Second", filePath: "Second/renamed.md" });
    expect(read.skill.raw).toBe(first.raw);
  });
  it("exports legacy user records once and does not resurrect removed working files on refresh", () => {
    repository.publish({ id: "user.legacy", raw: draft().replace("user.draft", "user.legacy"), expectedVersion: 0 });
    const file = synchronizeSkillFiles(repository).paths["user.legacy"]!;
    expect(repository.files.read(file)).toContain("Өндіріс");
    fs.unlinkSync(repository.files.filePath(file));
    expect(synchronizeSkillFiles(new LocalSkillRepository(root)).paths["user.legacy"]).toBeUndefined();
    expect(repository.get("user.legacy")?.version).toBe(1);
  });
  it("discovers valid Markdown created directly in a subfolder", () => {
    synchronizeSkillFiles(repository);
    repository.files.createFolder("", "External");
    repository.files.create("External", "Outside", "user.external", draft("External method").replace("user.draft", "user.external"));
    expect(synchronizeSkillFiles(repository).issues).toEqual([]);
    expect(repository.get("user.external")?.raw).toContain("External method");
  });
  it("adds created skills to the same initialized library", async () => {
    const created = publishManagedSkill({ raw: draft() }, repository);
    const available = await loadAvailableSkillLibrary(repository);
    expect(available.byId.get(created.id)?.raw).toBe(created.raw);
    expect(available.byId.has(UNIVERSAL_SKILL_ID)).toBe(true);
    expect(available.skills.filter(skill => skill.id === UNIVERSAL_SKILL_ID)).toHaveLength(1);
  });
  it("routes Unicode KPI patterns without a fixed domain enum", async () => {
    const created = publishManagedSkill({ raw: draft() }, repository);
    for (const query of ["Өндіріс көлемі", "Выпуск продукции"]) expect(rankSkillCandidates(query, await loadAvailableSkillLibrary(repository))[0]?.skill.id).toBe(created.id);
    expect(rankSkillCandidates("completely unfamiliar zzz KPI", await loadAvailableSkillLibrary(repository))[0]?.skill.id).toBe(UNIVERSAL_SKILL_ID);
  });
  it("reads old versions after editing and rejects stale saves", async () => {
    const first = publishManagedSkill({ raw: draft('A "quoted" name') }, repository);
    const next = publishManagedSkill({ id: first.id, raw: draft("Second"), expectedVersion: first.version }, repository);
    expect(next.version).toBe(2);
    expect((await readAvailableSkill(first.id, 1, repository)).card.title).toBe('A "quoted" name');
    expect(() => publishManagedSkill({ id: first.id, raw: draft(), expectedVersion: 1 }, repository)).toThrow(/changed/);
  });
  it("does not overwrite an existing portable identity when creating a same-name skill", () => {
    const raw = '---\nname: production-volume\ndescription: A reusable volume method.\n---\n\n# Production volume\n\nMultiply capacity by productive operating time.\n';
    const first = publishManagedSkill({ raw }, repository);
    expect(() => publishManagedSkill({ raw: `${raw}\nAn unrelated proposed method.\n` }, repository)).toThrow(/already exists/);
    expect(repository.get(first.id)?.version).toBe(1);
    expect(repository.files.read(first.filePath!)).toBe(raw);
  });
  it("keeps portable working files portable when explicitly updating their instructions", () => {
    const raw = '---\nname: production-volume\ndescription: A reusable volume method.\n---\n\n# Production volume\n\nMultiply capacity by productive operating time.\n';
    const first = publishManagedSkill({ raw }, repository), changed = `${raw}\nCheck all input periods match.\n`;
    const second = publishManagedSkill({ id: first.id, expectedVersion: first.version, raw: changed }, repository);
    expect(second.version).toBe(2);
    expect(repository.files.read(first.filePath!)).toBe(changed);
    expect(repository.files.read(first.filePath!)).not.toMatch(/^id:|^version:/m);
    expect(repository.get(first.id, 1)?.raw).toBe(first.raw);
    expect(() => publishManagedSkill({ id: first.id, expectedVersion: 2, raw: changed.replace("name: production-volume", "name: renamed-method") }, repository)).toThrow(/name/);
  });
  it("rejects removed working files and no-op edits without recreating files or versions", () => {
    const first = publishManagedSkill({ raw: draft() }, repository);
    expect(() => publishManagedSkill({ id: first.id, expectedVersion: 1, raw: first.raw }, repository)).toThrow(/no changes/);
    expect(repository.get(first.id)?.version).toBe(1);
    fs.unlinkSync(repository.files.filePath(first.filePath!));
    expect(() => publishManagedSkill({ id: first.id, expectedVersion: 1, raw: draft("Changed") }, repository)).toThrow(/removed/);
    expect(repository.files.scan().files).toEqual([]);
    expect(repository.get(first.id)?.version).toBe(1);
  });
  it("does not publish a version when guarded working-file replacement fails", () => {
    const first = publishManagedSkill({ raw: draft() }, repository);
    vi.spyOn(repository.files, "replace").mockImplementationOnce(() => { throw new Error("The editor changed its file."); });
    expect(() => publishManagedSkill({ id: first.id, expectedVersion: 1, raw: draft("Changed") }, repository)).toThrow(/editor changed/);
    expect(repository.get(first.id)?.version).toBe(1);
    expect(repository.files.read(first.filePath!)).toBe(first.raw);
  });
  it("restores its own working bytes when immutable publication fails", () => {
    const first = publishManagedSkill({ raw: draft() }, repository);
    vi.spyOn(repository, "publish").mockImplementationOnce(() => { throw new Error("History write failed."); });
    expect(() => publishManagedSkill({ id: first.id, expectedVersion: 1, raw: draft("Changed") }, repository)).toThrow(/History write/);
    expect(repository.get(first.id)?.version).toBe(1);
    expect(repository.files.read(first.filePath!)).toBe(first.raw);
  });
  it.each(["create", "update"])("keeps %s working bytes consistent when directory fsync fails after publication", operation => {
    const original = '---\nname: publication-fault\ndescription: A method used to test publication recovery.\n---\n\n# Publication fault\n\nCheck the method uses consistent input units and periods.\n';
    const first = operation === "update" ? publishManagedSkill({ raw: original }, repository) : undefined;
    const changed = `${original}\nNew reviewed guidance that must survive the final storage failure.\n`;
    const fsync = fs.fsyncSync.bind(fs);
    let failed = false;
    vi.spyOn(fs, "fsyncSync").mockImplementation(fd => {
      if (!failed && fs.fstatSync(fd).isDirectory()) {
        failed = true;
        throw Object.assign(new Error("Directory fsync failed after the immutable link."), { code: "EIO" });
      }
      fsync(fd);
    });
    expect(() => publishManagedSkill({ raw: changed, ...(first ? { id: first.id, expectedVersion: first.version } : {}) }, repository)).toThrow(/is visible.*final storage check failed/);
    const record = repository.list()[0]!;
    expect(failed).toBe(true);
    expect(record.version).toBe(first ? 2 : 1);
    expect(record.raw).toContain("New reviewed guidance");
    expect(record.fileHash).toBe(skillContentHash(changed));
    const files = repository.files.scan().files;
    expect(files).toHaveLength(1);
    expect(files[0]!.raw).toBe(changed);
    expect(synchronizeSkillFiles(repository).issues).toEqual([]);
    expect(repository.get(record.id)?.version).toBe(record.version);
    if (first) expect(repository.get(record.id, 1)?.raw).toBe(first.raw);
  });
  it("preserves the reviewed working file when publication visibility cannot be read", () => {
    const first = publishManagedSkill({ raw: draft() }, repository), get = repository.get.bind(repository);
    const proposed = draft("Changed");
    vi.spyOn(repository, "publish").mockImplementationOnce(() => { throw Object.assign(new Error("Publication failed."), { code: "EIO" }); });
    const visibility = vi.spyOn(repository, "get").mockImplementation((id, version) => {
      if (version === first.version + 1) throw Object.assign(new Error("Storage cannot be read."), { code: "EIO" });
      return get(id, version);
    });
    expect(() => publishManagedSkill({ id: first.id, expectedVersion: 1, raw: proposed }, repository)).toThrow(/outcome could not be confirmed.*working file was kept/);
    visibility.mockRestore();
    expect(repository.get(first.id)?.version).toBe(1);
    expect(repository.files.read(first.filePath!)).toContain('title: "Changed"');
  });
  it("preserves an external save made after the swap when publication fails", () => {
    const first = publishManagedSkill({ raw: draft() }, repository), external = `${first.raw}\nA newer editor save that must survive.\n`;
    vi.spyOn(repository, "publish").mockImplementationOnce(() => {
      fs.writeFileSync(repository.files.filePath(first.filePath!), external);
      throw new Error("History write failed.");
    });
    expect(() => publishManagedSkill({ id: first.id, expectedVersion: 1, raw: draft("Changed") }, repository)).toThrow(/History write/);
    expect(repository.get(first.id)?.version).toBe(1);
    expect(repository.files.read(first.filePath!)).toBe(external);
  });
  it("does not let another host synchronize intermediate working bytes during a managed save", () => {
    const first = publishManagedSkill({ raw: draft() }, repository), publish = repository.publish.bind(repository);
    vi.spyOn(repository, "publish").mockImplementationOnce(input => {
      const other = new LocalSkillRepository(root), refresh = synchronizeSkillFiles(other);
      expect(refresh.issues.find(issue => issue.path === first.filePath)?.message).toMatch(/Another process/);
      expect(other.get(first.id)?.version).toBe(1);
      return publish(input);
    });
    const second = publishManagedSkill({ id: first.id, expectedVersion: 1, raw: draft("Changed") }, repository);
    expect(second.version).toBe(2);
    expect(repository.files.read(first.filePath!)).toBe(second.raw);
  });
  it("persists the preliminary choice and preserves a manual selection across changed KPIs", async () => {
    const first = await resolveVdtSkill({ projectId: "p", vdtId: "v", rootKpi: "Unfamiliar KPI" }, repository);
    expect(first.pin.id).toBe(UNIVERSAL_SKILL_ID);
    const user = publishManagedSkill({ raw: draft() }, repository);
    repository.select("p", "v", { skillId: user.id, version: user.version, contentHash: user.contentHash, source: "user", reason: "My preference", rootKpi: "Unfamiliar KPI" }, first.selection!.revision);
    const changed = await resolveVdtSkill({ projectId: "p", vdtId: "v", rootKpi: "Revenue" }, repository);
    expect(changed.pin.id).toBe(user.id);
    expect(changed.pin.source).toBe("user");
  });
  it("reconsiders only automatic choices after the Root KPI changes", async () => {
    await resolveVdtSkill({ projectId: "p", vdtId: "v", rootKpi: "Unfamiliar KPI" }, repository);
    const next = await resolveVdtSkill({ projectId: "p", vdtId: "v", rootKpi: "Revenue" }, repository);
    expect(next.pin.id).toBe("finance.revenue_profit");
    expect(next.selection!.revision).toBe(2);
  });
  it("preserves fork lineage across subsequent edits", () => {
    const lineage = { skillId: UNIVERSAL_SKILL_ID, version: 1, contentHash: "sha256:source" };
    const copy = publishManagedSkill({ raw: draft(), lineage }, repository);
    const updated = publishManagedSkill({ id: copy.id, expectedVersion: 1, raw: draft("Edited copy") }, repository);
    expect(updated.lineage).toEqual(lineage);
  });
  it("rejects malformed files and broken executable blocks without publishing orphan files", () => {
    expect(() => publishManagedSkill({ raw: "no frontmatter" }, repository)).toThrow();
    expect(() => publishManagedSkill({ raw: `${draft()}\n\`\`\`vdt-topology\n{}\n\`\`\`\n` }, repository)).toThrow();
    const raw = draft("At the size boundary");
    expect(() => publishManagedSkill({ raw: raw + " ".repeat(128 * 1024 - Buffer.byteLength(raw, "utf8")) }, repository)).toThrow(/128 KiB/);
    expect(repository.files.scan().files).toEqual([]);
  });
});
