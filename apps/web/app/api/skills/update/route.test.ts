import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalSkillRepository, skillContentHash } from "@vdt-studio/storage";
import { loadAvailableSkillLibrary, publishManagedSkill, readAvailableSkill, UNIVERSAL_SKILL_ID } from "@vdt-studio/vdt-agent";
import { openVdtStorageDatabase } from "../../vdt/storage-database";
import { POST } from "./route";

let root: string, repository: LocalSkillRepository;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "vdt-skill-update-api-"));
  vi.stubEnv("VDT_DATA_DIR", root); vi.stubEnv("VDT_APP_MODE", "development_web");
  repository = new LocalSkillRepository();
  const db = openVdtStorageDatabase(process.cwd());
  try { db.createProject({ id: "p", name: "Project" }); db.createVdt({ id: "v", projectId: "p", name: "Tree", rootKpi: "Output" }); }
  finally { db.close(); }
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

const markdown = '---\nname: operating-volume\ndescription: Model volume from capacity and productive time.\n---\n\n# Operating volume\n\nMultiply capacity by productive time. Verify matching units and periods.\n';
const request = (body: unknown, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/skills/update", {
  method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body)
});
async function fixture() {
  await loadAvailableSkillLibrary(repository);
  const skill = publishManagedSkill({ raw: markdown }, repository);
  const selection = repository.select("p", "v", { skillId: skill.id, version: skill.version, contentHash: skill.contentHash,
    source: "user", reason: "Used to build this tree", rootKpi: "Output" }, 0);
  const target = { id: skill.id, version: skill.version, contentHash: skill.contentHash, fileHash: skillContentHash(markdown),
    baseVersion: skill.version, baseContentHash: skill.contentHash, selectionRevision: selection.revision };
  return { skill, selection, target, body: { projectId: "p", vdtId: "v", target, raw: `${markdown}\nCheck capacity and time refer to the same population.\n` } };
}

describe("reviewed tree-to-skill update API", () => {
  it("publishes a new version and preserves pinned content, resources and the source tree", async () => {
    const { skill, selection, body } = await fixture();
    repository.files.writeSeedFile(`${skill.folder}/references/checks.md`, "# Retained supporting checks\n");
    const db = openVdtStorageDatabase(process.cwd());
    let originalVdt;
    try { originalVdt = db.getVdt("v"); } finally { db.close(); }
    const response = await POST(request(body)), result = await response.json();
    expect(response.status).toBe(200);
    expect(result.skill).toMatchObject({ id: skill.id, version: 2 });
    expect(repository.getSelection("p", "v")).toEqual(selection);
    expect(repository.get(skill.id, 1)?.raw).toBe(skill.raw);
    expect(repository.files.read(skill.filePath!)).toBe(body.raw);
    expect(repository.files.read(skill.filePath!)).not.toMatch(/^id:|^version:/m);
    expect(fs.readFileSync(path.join(repository.files.rootPath, skill.folder, "references/checks.md"), "utf8")).toContain("Retained supporting checks");
    const reopened = openVdtStorageDatabase(process.cwd());
    try { expect(reopened.getVdt("v")).toEqual(originalVdt); } finally { reopened.close(); }
  });
  it("can update a newer library version while preserving an older source pin", async () => {
    const { skill, selection, body } = await fixture();
    const currentRaw = `${markdown}\nA later library clarification.\n`;
    fs.writeFileSync(repository.files.filePath(skill.filePath!), currentRaw);
    const current = await readAvailableSkill(skill.id, undefined, repository);
    body.target = { ...body.target, version: current.card.version, contentHash: current.card.contentHash, fileHash: skillContentHash(currentRaw) };
    body.raw = `${currentRaw}\nAccepted new tree learning.\n`;
    expect((await POST(request(body))).status).toBe(200);
    expect(repository.get(skill.id)?.version).toBe(3);
    expect(repository.getSelection("p", "v")).toEqual(selection);
    expect(repository.get(skill.id, 2)?.raw).toBe(current.skill.raw);
  });
  it("reports a visible but unconfirmed-durability update without reverting its working file", async () => {
    const { skill, selection, body } = await fixture(), fsync = fs.fsyncSync.bind(fs);
    const historyDirectory = fs.statSync(path.join(root, "skill-library-v1", "skills", skill.id));
    let failed = false;
    vi.spyOn(fs, "fsyncSync").mockImplementation(fd => {
      const stat = fs.fstatSync(fd);
      if (!failed && stat.isDirectory() && stat.dev === historyDirectory.dev && stat.ino === historyDirectory.ino) {
        failed = true;
        throw Object.assign(new Error("Directory fsync failed after publication."), { code: "EIO" });
      }
      fsync(fd);
    });
    const response = await POST(request(body));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatchObject({ code: "SKILL_COMMITTED_WITH_ERROR", message: expect.stringMatching(/version 2 is visible/) });
    expect(repository.get(skill.id)?.version).toBe(2);
    expect(repository.files.read(skill.filePath!)).toBe(body.raw);
    expect(repository.getSelection("p", "v")).toEqual(selection);
  });
  it.each(["version", "contentHash", "fileHash", "baseVersion", "baseContentHash", "selectionRevision"])("rejects stale %s without overwriting the working file", async field => {
    const { skill, body } = await fixture();
    const target = { ...body.target, [field]: field.endsWith("Hash") ? `sha256:${"0".repeat(64)}` : 99 };
    expect((await POST(request({ ...body, target }))).status).toBe(409);
    expect(repository.files.read(skill.filePath!)).toBe(markdown);
    expect(repository.get(skill.id)?.version).toBe(1);
  });
  it.each(["valid", "invalid", "deleted", "duplicate"])("retains a %s external file change after draft preparation", async kind => {
    const { skill, body } = await fixture(), filename = repository.files.filePath(skill.filePath!);
    let expected: string | undefined = markdown;
    if (kind === "valid") fs.writeFileSync(filename, expected = `${markdown}\nAn editor's newer save.\n`);
    if (kind === "invalid") fs.writeFileSync(filename, expected = "An incomplete editor save without YAML.");
    if (kind === "deleted") { fs.unlinkSync(filename); expected = undefined; }
    if (kind === "duplicate") fs.copyFileSync(filename, path.join(repository.files.rootPath, "duplicate.md"));
    expect((await POST(request(body))).status).toBe(409);
    if (expected === undefined) expect(fs.existsSync(filename)).toBe(false);
    else expect(fs.readFileSync(filename, "utf8")).toBe(expected);
    expect(repository.get(skill.id)?.version).toBe(kind === "valid" ? 2 : 1);
  });
  it("rejects identity changes, malformed executable formulas and no-op saves", async () => {
    const { skill, body } = await fixture();
    expect((await POST(request({ ...body, raw: body.raw.replace("name: operating-volume", "name: another-method") }))).status).toBe(409);
    expect((await POST(request({ ...body, raw: `${body.raw}\n\`\`\`vdt-topology\n{}\n\`\`\`\n` }))).status).toBe(400);
    const unchanged = await POST(request({ ...body, raw: markdown }));
    expect(unchanged.status).toBe(400);
    expect((await unchanged.json()).error.code).toBe("SKILL_NO_CHANGES");
    expect(repository.get(skill.id)?.version).toBe(1);
    expect(repository.files.read(skill.filePath!)).toBe(markdown);
  });
  it("requires the source selection to remain the same", async () => {
    const { skill, selection, body } = await fixture();
    repository.select("p", "v", { ...selection, source: "user", reason: "Reselected after review" }, selection.revision);
    expect((await POST(request(body))).status).toBe(409);
    expect(repository.get(skill.id)?.version).toBe(1);
  });
  it("rejects universal updates, wrong tree ownership and untrusted requests", async () => {
    const { body } = await fixture();
    expect((await POST(request({ ...body, target: { ...body.target, id: UNIVERSAL_SKILL_ID } }))).status).toBe(400);
    expect((await POST(request({ ...body, projectId: "another" }))).status).toBe(404);
    expect((await POST(request(body, "https://attacker.example"))).status).toBe(403);
    expect((await POST(request({ ...body, raw: "x".repeat(513 * 1024) }))).status).toBe(413);
    vi.stubEnv("VDT_APP_MODE", "hosted_web");
    expect((await POST(request(body))).status).toBe(403);
  });
});
