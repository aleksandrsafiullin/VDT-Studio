import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftSkillMarkdown, UNIVERSAL_SKILL_ID } from "@vdt-studio/vdt-agent";
import { LocalSkillRepository } from "@vdt-studio/storage";
import { openVdtStorageDatabase } from "../vdt/storage-database";
import { GET, POST } from "./route";
import { POST as clone } from "./clone/route";
import { GET as getSelection, POST as select } from "./selection/route";
import { POST as files } from "./files/route";
import { openSkillPath } from "@/lib/open-skill-path";

vi.mock("@/lib/open-skill-path", () => ({ openSkillPath: vi.fn(async () => {}) }));

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "vdt-skill-api-")); vi.stubEnv("VDT_DATA_DIR", root); vi.stubEnv("VDT_APP_MODE", "development_web"); vi.mocked(openSkillPath).mockClear(); });
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
const request = (url: string, body: unknown, origin = "http://localhost:3000") => new Request(`http://localhost:3000/api/skills${url}`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
const markdown = () => draftSkillMarkdown({ title: "Production method", domain: "custom", description: "Custom production decomposition", patterns: ["Special production"], instructions: "## Method\n\nMultiply operating hours by the measured production rate. Validate units and time periods." });

describe("local skills API", () => {
  it("initializes a unified writable library and creates portable SKILL.md packages in the same folder", async () => {
    const result = await (await GET(new Request("http://localhost:3000/api/skills"))).json();
    expect(result.skills.length).toBeGreaterThan(1);
    expect(result.files.rootPath).toBe(path.join(root, "skills"));
    for (const skill of result.skills) {
      expect(skill).not.toHaveProperty("kind");
      expect(skill.filePath).toMatch(/\/SKILL\.md$/);
      expect(fs.statSync(path.join(result.files.rootPath, skill.filePath)).mode & 0o200).toBe(0o200);
    }
    const raw = '---\nname: production-output\ndescription: Explain production volume from measured operating inputs.\n---\n\n# Production output\n\nDecompose capacity and productive time with consistent units.\n';
    const response = await POST(request("", { raw })), created = (await response.json()).skill;
    expect(response.status).toBe(201);
    expect(created.filePath).toBe("production-output/SKILL.md");
    expect(fs.readFileSync(path.join(result.files.rootPath, created.filePath), "utf8")).toBe(raw);
    expect((await files(request("/files", { action: "open.skill", id: UNIVERSAL_SKILL_ID }))).status).toBe(200);
    expect(openSkillPath).toHaveBeenLastCalledWith(path.join(result.files.rootPath, "generic/logical-kpi-decomposition/SKILL.md"));
    expect(result.files.issues).toEqual([]);
  });
  it("reflects external folder moves and deletions without restoring removed skills", async () => {
    await GET(new Request("http://localhost:3000/api/skills"));
    const repository = new LocalSkillRepository();
    repository.files.renameFolder("generic/logical-kpi-decomposition", "our-method");
    expect((await files(request("/files", { action: "open.skill", id: UNIVERSAL_SKILL_ID }))).status).toBe(200);
    const filename = path.join(repository.files.rootPath, "generic/our-method/SKILL.md");
    expect(openSkillPath).toHaveBeenLastCalledWith(filename);
    fs.unlinkSync(filename);
    expect((await files(request("/files", { action: "open.skill", id: UNIVERSAL_SKILL_ID }))).status).toBe(404);
    expect(fs.existsSync(filename)).toBe(false);
    const result = await (await GET(new Request("http://localhost:3000/api/skills"))).json();
    expect(result.skills.some((skill: { id: string }) => skill.id === UNIVERSAL_SKILL_ID)).toBe(false);
    expect((await files(request("/files", { action: "folder.create", parent: "", name: "Removed UI management" }))).status).toBe(400);
  });
  it("blocks traversal, symlinks, URL/command inputs and cross-origin OS launches", async () => {
    for (const body of [
      { action: "open.folder", folder: "../outside" }, { action: "open.file", filePath: "/etc/passwd.md" },
      { action: "open.file", filePath: "https://attacker.example/file.md" },
      { action: "open.folder", folder: "", command: "/bin/sh" }, { action: "folder.create", parent: "", name: "../escape" }
    ]) expect((await files(request("/files", body))).status).toBe(400);
    const repository = new LocalSkillRepository(); repository.files.folder();
    fs.symlinkSync(os.tmpdir(), path.join(repository.files.rootPath, "outside"));
    expect((await files(request("/files", { action: "open.folder", folder: "outside" }))).status).toBe(400);
    expect((await files(request("/files", { action: "open.folder", folder: "" }, "https://attacker.example"))).status).toBe(403);
    const rebound = new Request("http://attacker.example:3000/api/skills/files", { method: "POST", headers: { "content-type": "application/json", origin: "http://attacker.example:3000" }, body: JSON.stringify({ action: "open.folder", folder: "" }) });
    expect((await files(rebound)).status).toBe(403);
    vi.stubEnv("VDT_APP_MODE", "hosted_web");
    expect((await files(request("/files", { action: "open.folder", folder: "" }))).status).toBe(403);
    expect(openSkillPath).not.toHaveBeenCalled();
  });
  it("creates, edits and reads immutable skill versions", async () => {
    const created = await POST(request("", { raw: markdown() })), first = (await created.json()).skill;
    expect(created.status).toBe(201);
    const updated = await POST(request("", { id: first.id, expectedVersion: first.version, raw: first.raw.replace("Production method", "Edited method") }));
    expect(updated.status).toBe(200);
    const old = await GET(new Request(`http://localhost:3000/api/skills?id=${first.id}&version=1`));
    expect((await old.json()).skill.title).toBe("Production method");
    expect((await POST(request("", { id: first.id, expectedVersion: 1, raw: markdown() }))).status).toBe(409);
  });
  it("retains clone API compatibility and allows editing supplied identities", async () => {
    const response = await clone(request("/clone", { id: UNIVERSAL_SKILL_ID }));
    const { skill } = await response.json();
    expect(response.status).toBe(201);
    expect(skill.id).toMatch(/^user\./);
    expect(skill).not.toHaveProperty("kind");
    expect(skill.lineage.skillId).toBe(UNIVERSAL_SKILL_ID);
    expect((await POST(request("", { id: UNIVERSAL_SKILL_ID, expectedVersion: 1, raw: markdown() }))).status).toBe(200);
  });
  it("persists manual selection per VDT and rejects stale Context", async () => {
    const db = openVdtStorageDatabase(process.cwd());
    try { db.createProject({ id: "p", name: "Project" }); db.createVdt({ id: "v", projectId: "p", name: "Tree", rootKpi: "Unfamiliar KPI" }); } finally { db.close(); }
    const initial = await getSelection(new Request("http://localhost:3000/api/skills/selection?projectId=p&vdtId=v"));
    const current = await initial.json();
    expect(current.skill.id).toBe(UNIVERSAL_SKILL_ID);
    const input = { projectId: "p", vdtId: "v", skillId: "finance.revenue_profit", expectedRevision: current.selection.revision };
    expect((await select(request("/selection", input))).status).toBe(200);
    expect((await select(request("/selection", input))).status).toBe(409);
    const reopened = await getSelection(new Request("http://localhost:3000/api/skills/selection?projectId=p&vdtId=v"));
    expect((await reopened.json()).skill).toMatchObject({ id: "finance.revenue_profit", source: "user" });
  });
  it("lets the user select another skill after the default was deleted from the folder", async () => {
    await GET(new Request("http://localhost:3000/api/skills"));
    fs.unlinkSync(path.join(root, "skills/generic/logical-kpi-decomposition/SKILL.md"));
    const db = openVdtStorageDatabase(process.cwd());
    try { db.createProject({ id: "p", name: "Project" }); db.createVdt({ id: "v", projectId: "p", name: "Tree", rootKpi: "Unfamiliar KPI" }); } finally { db.close(); }
    const response = await getSelection(new Request("http://localhost:3000/api/skills/selection?projectId=p&vdtId=v"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ skill: null, needsReselection: true });
    expect((await select(request("/selection", { projectId: "p", vdtId: "v", skillId: "finance.revenue_profit", expectedRevision: 0 }))).status).toBe(200);
  });
  it("keeps hosted access, cross-origin writes and oversized bodies closed", async () => {
    expect((await POST(request("", { raw: markdown() }, "https://attacker.example"))).status).toBe(403);
    expect((await POST(request("", { raw: "x".repeat(513 * 1024) }))).status).toBe(413);
    vi.stubEnv("VDT_APP_MODE", "hosted_web");
    expect((await GET(new Request("http://localhost:3000/api/skills"))).status).toBe(403);
    expect((await POST(request("", { raw: markdown() }))).status).toBe(403);
  });
  it("admits a direct 127.0.0.1 browser origin reconstructed by Next as localhost", async () => {
    const input = new Request("http://localhost:3000/api/skills", { method: "POST", headers: { "content-type": "application/json", host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" }, body: JSON.stringify({ raw: markdown() }) });
    expect((await POST(input)).status).toBe(201);
    const crossPort = new Request("http://localhost:3000/api/skills", { method: "POST", headers: { "content-type": "application/json", host: "127.0.0.1:9999", origin: "http://127.0.0.1:9999" }, body: JSON.stringify({ raw: markdown() }) });
    expect((await POST(crossPort)).status).toBe(403);
  });
  it("rejects mismatched VDT ownership before recording selection", async () => {
    const db = openVdtStorageDatabase(process.cwd());
    try { db.createProject({ id: "p", name: "Project" }); db.createVdt({ id: "v", projectId: "p", name: "Tree", rootKpi: "Output" }); } finally { db.close(); }
    const response = await getSelection(new Request("http://localhost:3000/api/skills/selection?projectId=another&vdtId=v"));
    expect(response.status).toBe(404);
  });
  it("lets Context recover when a bundled selected version is no longer shipped", async () => {
    const db = openVdtStorageDatabase(process.cwd());
    try { db.createProject({ id: "p", name: "Project" }); db.createVdt({ id: "v", projectId: "p", name: "Tree", rootKpi: "Output" }); } finally { db.close(); }
    new LocalSkillRepository().select("p", "v", { skillId: "finance.revenue_profit", version: 999, contentHash: "sha256:old", source: "user", reason: "Old version", rootKpi: "Output" }, 0);
    const response = await getSelection(new Request("http://localhost:3000/api/skills/selection?projectId=p&vdtId=v")), body = await response.json();
    expect(response.status).toBe(200);
    expect(body.needsReselection).toBe(true);
    expect((await select(request("/selection", { projectId: "p", vdtId: "v", skillId: "finance.revenue_profit", version: 2, expectedRevision: body.selection.revision }))).status).toBe(200);
  });
});
