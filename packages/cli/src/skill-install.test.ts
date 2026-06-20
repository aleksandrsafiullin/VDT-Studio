import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applySkillBundlePlan,
  planSkillBundle,
  resolveSkillsDirectory,
  type SkillBundlePlan
} from "./skill-install";

const tempRoots: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("skill directory resolution", () => {
  it("uses native directories for the primary agent targets", () => {
    const home = path.join(path.sep, "home", "user");
    expect(resolveSkillsDirectory("claude", { home })).toBe(path.join(home, ".claude", "skills"));
    expect(resolveSkillsDirectory("codex", { home })).toBe(path.join(home, ".codex", "skills"));
    expect(resolveSkillsDirectory("cursor", { home })).toBe(path.join(home, ".cursor", "skills"));
    expect(resolveSkillsDirectory("copilot", { home })).toBe(path.join(home, ".copilot", "skills"));
    expect(resolveSkillsDirectory("gemini", { home })).toBe(path.join(home, ".gemini", "skills"));
    expect(resolveSkillsDirectory("opencode", { home })).toBe(path.join(home, ".config", "opencode", "skills"));
  });

  it("honors CODEX_HOME semantics and provides a config fallback", () => {
    expect(resolveSkillsDirectory("codex", { home: "/home/user", codexHome: "/opt/codex" })).toBe("/opt/codex/skills");
    expect(resolveSkillsDirectory("qwen", { home: "/home/user" })).toBe("/home/user/.config/qwen/skills");
    expect(() => resolveSkillsDirectory("../escape", { home: "/home/user" })).toThrow("Invalid agent target");
  });
});

describe("skill bundle planner and applier", () => {
  it("plans the checked-in Value Driver Tree bundle from the default source", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "vdt-skill-install-"));
    tempRoots.push(root);
    const plan = await planSkillBundle({
      action: "install",
      agent: "gemini",
      home: root,
      bundles: ["value-driver-tree"]
    });

    expect(plan.targetRoot).toBe(path.join(root, ".gemini", "skills"));
    expect(plan.operations.some((operation) => operation.path.endsWith(path.join("value-driver-tree", "SKILL.md")))).toBe(true);
    await applySkillBundlePlan(plan);
    expect(await readFile(path.join(plan.targetRoot, "value-driver-tree", "SKILL.md"), "utf8")).toContain("Make the model calculable");
  });

  it("creates a serializable dry-run plan without changing the target", async () => {
    const fixture = await createFixture();
    const plan = await installPlan(fixture);

    expect(plan.changed).toBe(true);
    expect(plan.operations.map((operation) => operation.kind)).toEqual(["write-file", "write-file", "write-file"]);
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
    await expect(readFile(path.join(fixture.targetRoot, "sample-skill", "SKILL.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("installs and updates files idempotently", async () => {
    const fixture = await createFixture();
    await applySkillBundlePlan(await installPlan(fixture));

    expect(await readFile(path.join(fixture.targetRoot, "sample-skill", "SKILL.md"), "utf8")).toContain("Sample skill");
    expect((await installPlan(fixture)).operations).toEqual([]);

    await writeFile(path.join(fixture.sourceRoot, "sample-skill", "SKILL.md"), "---\nname: sample-skill\ndescription: Updated\n---\n", "utf8");
    const update = await installPlan(fixture);
    expect(update.operations).toHaveLength(2);
    await applySkillBundlePlan(update);
    expect(await readFile(path.join(fixture.targetRoot, "sample-skill", "SKILL.md"), "utf8")).toContain("Updated");
  });

  it("uninstalls bundle files while preserving foreign files", async () => {
    const fixture = await createFixture();
    await applySkillBundlePlan(await installPlan(fixture));
    const foreignPath = path.join(fixture.targetRoot, "sample-skill", "notes.txt");
    await writeFile(foreignPath, "keep", "utf8");

    const uninstall = await planSkillBundle({
      action: "uninstall",
      agent: "claude",
      home: fixture.root,
      sourceRoot: fixture.sourceRoot,
      targetRoot: fixture.targetRoot
    });
    await applySkillBundlePlan(uninstall);

    expect(await readFile(foreignPath, "utf8")).toBe("keep");
    await expect(readFile(path.join(fixture.targetRoot, "sample-skill", "SKILL.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(planSkillBundle({
      action: "uninstall",
      agent: "claude",
      home: fixture.root,
      sourceRoot: fixture.sourceRoot,
      targetRoot: fixture.targetRoot
    })).rejects.toThrow("without a valid VDT Studio ownership manifest");
  });

  it("preserves a managed skill file after the user modifies it", async () => {
    const fixture = await createFixture();
    await applySkillBundlePlan(await installPlan(fixture));
    const skillPath = path.join(fixture.targetRoot, "sample-skill", "SKILL.md");
    await writeFile(skillPath, "user edited", "utf8");
    const uninstall = await planSkillBundle({
      action: "uninstall",
      agent: "claude",
      home: fixture.root,
      sourceRoot: fixture.sourceRoot,
      targetRoot: fixture.targetRoot
    });
    await applySkillBundlePlan(uninstall);
    expect(await readFile(skillPath, "utf8")).toBe("user edited");
  });

  it("never claims or overwrites a foreign same-name directory", async () => {
    const fixture = await createFixture();
    const foreignRoot = path.join(fixture.targetRoot, "sample-skill");
    await mkdir(foreignRoot, { recursive: true });
    const foreignSkill = path.join(foreignRoot, "SKILL.md");
    await writeFile(foreignSkill, "foreign skill", "utf8");

    await expect(installPlan(fixture)).rejects.toThrow("without a valid VDT Studio ownership manifest");
    expect(await readFile(foreignSkill, "utf8")).toBe("foreign skill");
  });

  it("rejects a forged or modified ownership manifest", async () => {
    const fixture = await createFixture();
    await applySkillBundlePlan(await installPlan(fixture));
    const manifestPath = path.join(fixture.targetRoot, "sample-skill", ".vdt-studio-skill.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { fingerprint: string };
    manifest.fingerprint = "0".repeat(64);
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");

    await expect(installPlan(fixture)).rejects.toThrow("fingerprint is invalid");
    await expect(planSkillBundle({
      action: "uninstall",
      agent: "claude",
      home: fixture.root,
      sourceRoot: fixture.sourceRoot,
      targetRoot: fixture.targetRoot
    })).rejects.toThrow("fingerprint is invalid");
  });

  it("upgrades only unchanged managed files and preserves user edits", async () => {
    const fixture = await createFixture();
    await applySkillBundlePlan(await installPlan(fixture));
    const skillPath = path.join(fixture.targetRoot, "sample-skill", "SKILL.md");
    const agentPath = path.join(fixture.targetRoot, "sample-skill", "agents", "openai.yaml");
    await writeFile(skillPath, "user edited", "utf8");
    await writeFile(path.join(fixture.sourceRoot, "sample-skill", "SKILL.md"), "source update", "utf8");
    await writeFile(path.join(fixture.sourceRoot, "sample-skill", "agents", "openai.yaml"), "source agent update", "utf8");

    await applySkillBundlePlan(await installPlan(fixture));
    expect(await readFile(skillPath, "utf8")).toBe("user edited");
    expect(await readFile(agentPath, "utf8")).toBe("source agent update");

    await applySkillBundlePlan(await planSkillBundle({
      action: "uninstall",
      agent: "claude",
      home: fixture.root,
      sourceRoot: fixture.sourceRoot,
      targetRoot: fixture.targetRoot
    }));
    expect(await readFile(skillPath, "utf8")).toBe("user edited");
    await expect(readFile(agentPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves a file modified after uninstall planning", async () => {
    const fixture = await createFixture();
    await applySkillBundlePlan(await installPlan(fixture));
    const uninstall = await planSkillBundle({
      action: "uninstall",
      agent: "claude",
      home: fixture.root,
      sourceRoot: fixture.sourceRoot,
      targetRoot: fixture.targetRoot
    });
    const skillPath = path.join(fixture.targetRoot, "sample-skill", "SKILL.md");
    await writeFile(skillPath, "edited after planning", "utf8");
    await applySkillBundlePlan(uninstall);
    expect(await readFile(skillPath, "utf8")).toBe("edited after planning");
  });

  it("rejects malformed bundles and path traversal", async () => {
    const fixture = await createFixture();
    await expect(installPlan(fixture, ["../escape"])).rejects.toThrow("Invalid skill bundle name");
    await mkdir(path.join(fixture.sourceRoot, "missing-skill-file"));
    await writeFile(path.join(fixture.sourceRoot, "missing-skill-file", "notes.txt"), "not a skill", "utf8");
    await expect(installPlan(fixture, ["missing-skill-file"])).rejects.toThrow("must contain SKILL.md");
  });

  it("rejects overlapping roots and operations outside the planned bundle", async () => {
    const fixture = await createFixture();
    await expect(planSkillBundle({
      action: "install",
      agent: "claude",
      home: fixture.root,
      sourceRoot: fixture.sourceRoot,
      targetRoot: fixture.sourceRoot
    })).rejects.toThrow("must not overlap");

    const plan = await installPlan(fixture);
    plan.operations[0] = { kind: "remove-file", path: path.join(fixture.root, "outside.txt"), sha256: "0".repeat(64) };
    await expect(applySkillBundlePlan(plan)).rejects.toThrow("outside its target bundles");
  });
});

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "vdt-skill-install-"));
  tempRoots.push(root);
  const sourceRoot = path.join(root, "source");
  const targetRoot = path.join(root, "target");
  const bundleRoot = path.join(sourceRoot, "sample-skill");
  await mkdir(path.join(bundleRoot, "agents"), { recursive: true });
  await writeFile(
    path.join(bundleRoot, "SKILL.md"),
    "---\nname: sample-skill\ndescription: Sample skill\n---\n\n# Sample skill\n",
    "utf8"
  );
  await writeFile(path.join(bundleRoot, "agents", "openai.yaml"), 'interface:\n  display_name: "Sample"\n', "utf8");
  return { root, sourceRoot, targetRoot };
}

function installPlan(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  bundles?: string[]
): Promise<SkillBundlePlan> {
  return planSkillBundle({
    action: "install",
    agent: "claude",
    home: fixture.root,
    sourceRoot: fixture.sourceRoot,
    targetRoot: fixture.targetRoot,
    bundles
  });
}
