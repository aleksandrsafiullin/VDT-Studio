import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalSkillRepository, skillContentHash } from "./skill-library";

let root: string, repository: LocalSkillRepository;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "vdt-skills-storage-")); repository = new LocalSkillRepository(root); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe("local skill repository", () => {
  it("retains byte-exact immutable versions across restart", () => {
    const original = "Атауы\r\n\nUnicode: өндіріс 🛠\n";
    const first = repository.publish({ id: "user.test", raw: original, expectedVersion: 0 });
    repository.publish({ id: first.id, raw: "Changed", expectedVersion: 1 });
    const reopened = new LocalSkillRepository(root);
    expect(reopened.get(first.id, 1)?.raw).toBe(original);
    expect(reopened.get(first.id)?.version).toBe(2);
    expect(reopened.list()).toHaveLength(1);
    expect(first.contentHash).toBe(skillContentHash(original));
  });
  it("rejects stale editors without overwriting history", () => {
    repository.publish({ id: "user.test", raw: "A", expectedVersion: 0 });
    expect(() => repository.publish({ id: "user.test", raw: "B", expectedVersion: 0 })).toThrow(/changed/);
    expect(repository.get("user.test")?.raw).toBe("A");
  });
  it("preserves a supplied version and accepts subsequent edits to that same identity", () => {
    repository.installSeed({ id: "mining.excavation", raw: "Original", version: 18 });
    repository.markSeed("mining.excavation");
    repository.publish({ id: "mining.excavation", raw: "Edited on disk", expectedVersion: 18 });
    expect(repository.get("mining.excavation", 18)?.raw).toBe("Original");
    expect(repository.get("mining.excavation")?.version).toBe(19);
    expect(new LocalSkillRepository(root).hasSeed("mining.excavation")).toBe(true);
  });
  it.each(["../escape", "user../escape", "/absolute", "user..unsafe"])("rejects path traversal %s", id => {
    expect(() => repository.get(id)).toThrow(/identifier/);
  });
  it("rejects symlinked storage subdirectories", () => {
    fs.mkdirSync(path.join(root, "skill-library-v1"));
    fs.symlinkSync(os.tmpdir(), path.join(root, "skill-library-v1", "skills"));
    expect(() => repository.list()).toThrow(/application-owned/);
  });
  it("scopes VDT selections and uses revision conflicts", () => {
    const input = { skillId: "user.one", version: 1, contentHash: skillContentHash("A"), source: "user" as const, reason: "Chosen", rootKpi: "Output" };
    const selection = repository.select("project", "vdt", input, 0);
    expect(repository.getSelection("project", "other")).toBeNull();
    expect(() => repository.select("project", "vdt", { ...input, skillId: "user.two" }, 0)).toThrow(/changed/);
    expect(repository.getSelection("project", "vdt")).toEqual(selection);
  });
  it("checks content integrity and leaves no staging files", () => {
    repository.publish({ id: "user.test", raw: "A", expectedVersion: 0 });
    const dir = path.join(root, "skill-library-v1", "skills", "user.test");
    expect(fs.readdirSync(dir)).toEqual(["000000001.json"]);
    fs.writeFileSync(path.join(dir, "000000001.json"), JSON.stringify({ id: "user.test", version: 1, schemaVersion: "local_skill_version.v1", raw: "tampered", contentHash: skillContentHash("A") }));
    expect(() => repository.get("user.test")).toThrow(/integrity/);
  });
});
