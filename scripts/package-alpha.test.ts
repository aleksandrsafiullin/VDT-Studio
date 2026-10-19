import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { packageAlpha } from "./package-alpha.mjs";
import { claimReleaseDirectory } from "./release-paths.mjs";

const owned: string[] = [];
afterEach(async () => { await Promise.all(owned.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

describe("alpha artifact preservation", () => {
  it("refuses to overwrite an existing candidate before starting a build", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "vdt-alpha-preserve-"));
    owned.push(root);
    await mkdir(path.join(root, "packages/cli"), { recursive: true });
    await writeFile(path.join(root, "packages/cli/package.json"), JSON.stringify({ version: "1.2.3" }));
    const releaseDir = path.join(root, "output/release/v1.2.3");
    await mkdir(releaseDir, { recursive: true });
    const artifact = path.join(releaseDir, "previous.tgz");
    await writeFile(artifact, "previous reviewed artifact");
    expect(() => packageAlpha(root)).toThrow(/existing artifacts were preserved/);
    expect(await readFile(artifact, "utf8")).toBe("previous reviewed artifact");
    expect(await readdir(releaseDir)).toEqual(["previous.tgz"]);
  });

  it("allows only one owner of a candidate directory", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vdt-alpha-claim-"));
    owned.push(dir);
    const release = claimReleaseDirectory(dir);
    try { expect(() => claimReleaseDirectory(dir)).toThrow(/not empty/); }
    finally { release(); }
    expect(await readdir(dir)).toEqual([]);
  });
});
