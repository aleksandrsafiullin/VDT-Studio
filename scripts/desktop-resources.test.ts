import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copySkillLibrary, directorySha256 } from "./desktop-resources.mjs";

const owned: string[] = [];
afterEach(async () => { await Promise.all(owned.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

describe("desktop skill resources", () => {
  it("produces the same digest with macOS metadata present and retains product tamper detection", async () => {
    const source = await mkdtemp(path.join(os.tmpdir(), "vdt-skills-source-"));
    const target = await mkdtemp(path.join(os.tmpdir(), "vdt-skills-target-"));
    owned.push(source, target);
    await mkdir(path.join(source, "mining"));
    await writeFile(path.join(source, "registry.md"), "registry\n");
    await writeFile(path.join(source, "mining/skill.md"), "canonical\n");
    const expected = directorySha256(source);
    await writeFile(path.join(source, ".DS_Store"), "source Finder metadata");
    copySkillLibrary(source, target);
    await expect(readFile(path.join(target, ".DS_Store"))).rejects.toThrow();
    await writeFile(path.join(target, "mining/.DS_Store"), "local Finder metadata");
    expect(directorySha256(target)).toBe(expected);
    await writeFile(path.join(target, "mining/skill.md"), "tampered\n");
    expect(directorySha256(target)).not.toBe(expected);
  });

  it("preserves unexpected existing files and rejects a stale generated library", async () => {
    const source = await mkdtemp(path.join(os.tmpdir(), "vdt-skills-source-"));
    const target = await mkdtemp(path.join(os.tmpdir(), "vdt-skills-target-"));
    owned.push(source, target);
    await writeFile(path.join(source, "registry.md"), "registry\n");
    await writeFile(path.join(target, "unexpected.md"), "preserve for review\n");
    expect(() => copySkillLibrary(source, target)).toThrow(/unexpected product files/);
    expect(await readFile(path.join(target, "unexpected.md"), "utf8")).toBe("preserve for review\n");
  });
});
