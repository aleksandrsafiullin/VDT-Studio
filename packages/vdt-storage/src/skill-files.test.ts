import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalSkillRepository } from "./skill-library";

let root: string, repository: LocalSkillRepository;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "vdt-skill-files-")); repository = new LocalSkillRepository(root); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe("editable skill files", () => {
  it("moves the previous files root into skills without changing files, history or selections", () => {
    const legacy = path.join(root, "skill-library-v1", "files");
    fs.mkdirSync(path.join(legacy, "Производство", "output", "references"), { recursive: true });
    const raw = "---\nname: output\ndescription: Externally edited\n---\n# Өндіріс\r\nEdited 🛠\n";
    const resource = Buffer.from([0, 1, 255, 128]);
    fs.writeFileSync(path.join(legacy, "Производство", "output", "SKILL.md"), raw);
    fs.writeFileSync(path.join(legacy, "Производство", "output", "references", "custom.bin"), resource);
    const version = repository.publish({ id: "user.one", raw, expectedVersion: 0 });
    const selection = repository.select("project", "vdt", { skillId: version.id, version: version.version, contentHash: version.contentHash, source: "user", reason: "Chosen", rootKpi: "Output" });
    repository.initializeFiles();
    repository.markSeed("user.one");

    expect(repository.files.rootPath).toBe(path.join(root, "skills"));
    expect(repository.files.read("Производство/output/SKILL.md")).toBe(raw);
    expect(fs.readFileSync(path.join(root, "skills", "Производство", "output", "references", "custom.bin"))).toEqual(resource);
    expect(fs.existsSync(legacy)).toBe(false);
    const reopened = new LocalSkillRepository(root);
    expect(reopened.files.scan().files).toEqual([{ path: "Производство/output/SKILL.md", raw }]);
    expect(reopened.get(version.id, version.version)).toEqual(version);
    expect(reopened.getSelection("project", "vdt")).toEqual(selection);
    expect(reopened.filesInitialized).toBe(true);
    expect(reopened.hasSeed("user.one")).toBe(true);
  });
  it("preserves both roots when a new skills folder already exists", () => {
    const legacy = path.join(root, "skill-library-v1", "files");
    fs.mkdirSync(legacy, { recursive: true });
    fs.mkdirSync(path.join(root, "skills"));
    fs.writeFileSync(path.join(legacy, "SKILL.md"), "Previous editor bytes");
    fs.writeFileSync(path.join(root, "skills", "SKILL.md"), "New editor bytes");
    expect(() => repository.files.folder()).toThrow(/Both skills/);
    expect(fs.readFileSync(path.join(legacy, "SKILL.md"), "utf8")).toBe("Previous editor bytes");
    expect(fs.readFileSync(path.join(root, "skills", "SKILL.md"), "utf8")).toBe("New editor bytes");
  });
  it.each(["previous", "new"])("rejects a symbolic link at the %s working root during migration", kind => {
    const legacy = path.join(root, "skill-library-v1", "files");
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    if (kind === "previous") fs.symlinkSync(os.tmpdir(), legacy);
    else {
      fs.mkdirSync(legacy);
      fs.symlinkSync(os.tmpdir(), path.join(root, "skills"));
    }
    expect(() => repository.files.folder()).toThrow(/ordinary directory/);
    expect(fs.existsSync(legacy)).toBe(true);
  });
  it("persists nested Unicode folders and moves files without changing bytes", () => {
    repository.files.createFolder("", "Производство");
    repository.files.createFolder("Производство", "Өндіріс");
    const original = repository.files.create("", "Выработка", "user.one", "Markdown\r\nӨндіріс 🛠\n");
    const moved = repository.files.moveFile(original, "Производство/Өндіріс");
    const renamed = repository.files.renameFolder("Производство", "Завод");
    const reopened = new LocalSkillRepository(root).files.scan();
    expect(renamed).toBe("Завод");
    expect(reopened.folders).toEqual(["", "Завод", "Завод/Өндіріс"]);
    expect(reopened.files).toEqual([{ path: moved.replace("Производство", "Завод"), raw: "Markdown\r\nӨндіріс 🛠\n" }]);
    expect(reopened.issues).toEqual([]);
  });
  it.each(["../outside", "/tmp", "a/../../tmp", "a\\b", "a//b", ".hidden", "CON", "file:", "a/", "trailing."])("refuses unsafe folder path %s", folder => {
    expect(() => repository.files.folder(folder)).toThrow();
  });
  it("never traverses a symbolic link or opens a hard-linked file", () => {
    repository.files.folder();
    fs.symlinkSync(os.tmpdir(), path.join(repository.files.rootPath, "outside"));
    expect(() => repository.files.create("outside", "Escape", "user.escape", "no")).toThrow(/symbolic/);
    const file = repository.files.create("", "Skill", "user.one", "original");
    fs.linkSync(repository.files.filePath(file), path.join(root, "linked.md"));
    expect(() => repository.files.read(file)).toThrow(/unlinked/);
    expect(repository.files.scan().issues).toHaveLength(2);
  });
  it("rejects stale file replacement and leaves the external editor's bytes intact", () => {
    const file = repository.files.create("", "Skill", "user.one", "A");
    fs.writeFileSync(repository.files.filePath(file), "Editor change");
    expect(() => repository.files.replace(file, "B", "A")).toThrow(/changed/);
    expect(repository.files.read(file)).toBe("Editor change");
    expect(fs.readdirSync(repository.files.rootPath).filter(name => name.startsWith(".skill-save"))).toEqual([]);
  });
  it("creates ordinary skill packages and never replaces existing seed files or resources", () => {
    const relative = repository.files.createPackage("", "Production output", "Instructions");
    expect(relative).toBe("production-output/SKILL.md");
    expect(repository.files.writeSeedFile(relative, "Replacement")).toBe(false);
    repository.files.writeSeedFile("production-output/references/README.md", "Supporting documentation");
    repository.files.writeSeedFile("production-output/references/values.yaml", "value: 1\n");
    expect(repository.files.read(relative)).toBe("Instructions");
    expect(repository.files.scan().files).toEqual([{ path: relative, raw: "Instructions" }]);
    expect(() => repository.files.createPackage("", "Production output", "Replacement")).toThrow(/already exists/);
  });
});
