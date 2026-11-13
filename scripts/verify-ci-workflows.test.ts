import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyCiWorkflows } from "./verify-ci-workflows.mjs";

const tempDirs: string[] = [];
const names = ["quality", "e2e", "e2e-desktop", "windows-storage-native", "package", "package-desktop", "security", "release"];
async function createFixture(change?: { name: string; transform: (text: string) => string }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vdt-ci-workflows-")); tempDirs.push(root);
  await mkdir(path.join(root, ".github/workflows"), { recursive: true });
  for (const name of names) {
    const source = await readFile(new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8");
    await writeFile(path.join(root, `.github/workflows/${name}.yml`), change?.name === name ? change.transform(source) : source);
  }
  await mkdir(path.join(root, ".github/scripts"), { recursive: true });
  const helper = await readFile(new URL("../.github/scripts/windows-storage-standard-user.ps1", import.meta.url), "utf8");
  await writeFile(path.join(root, ".github/scripts/windows-storage-standard-user.ps1"),
    change?.name === "windows-storage-standard-user" ? change.transform(helper) : helper);
  return root;
}
afterEach(async () => { await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

describe("workflow structure verification", () => {
  it("accepts the actual workflows without claiming installed-app qualification", async () => {
    const result = verifyCiWorkflows(await createFixture());
    expect(result.workflows).toHaveLength(8);
    expect(result.scope).toContain("installed qualification is separate");
  });
  it("requires the built-app environment on the actual browser test step", async () => {
    const root = await createFixture({ name: "e2e", transform: text => text.replace('VDT_E2E_USE_BUILD: "1"', 'VDT_E2E_USE_BUILD: "0"') });
    expect(() => verifyCiWorkflows(root)).toThrow(/VDT_E2E_USE_BUILD/);
  });
  it("does not accept the saved-copy subset as the full browser gate", async () => {
    const root = await createFixture({ name: "e2e", transform: text => text.replace("run: pnpm test:e2e\n", "run: pnpm test:e2e:saved-copy\n") });
    expect(() => verifyCiWorkflows(root)).toThrow(/browser test step/);
  });
  it("does not accept a commented-out native builder as executable coverage", async () => {
    const root = await createFixture({ name: "package-desktop", transform: text => text.replace("          scripts/package-macos-alpha.sh", "          # scripts/package-macos-alpha.sh") });
    expect(() => verifyCiWorkflows(root)).toThrow(/executable gate/);
  });
  it("requires retained native installers and failure evidence", async () => {
    const root = await createFixture({ name: "package-desktop", transform: text => text.replace("if: always()", "if: success()") });
    expect(() => verifyCiWorkflows(root)).toThrow(/retain installers/);
  });
  it("rejects a candidate verification step detached from source identity", async () => {
    const root = await createFixture({ name: "package-desktop", transform: text => text.replaceAll("--source-commit", "--unverified-commit") });
    expect(() => verifyCiWorkflows(root)).toThrow(/against the source commit/);
  });
  it("rejects publication permissions in a build-only workflow", async () => {
    const root = await createFixture({ name: "release", transform: text => text.replace("contents: read", "contents: write") });
    expect(() => verifyCiWorkflows(root)).toThrow(/must not publish/);
  });
  it("rejects the retired macOS runner in the platform matrix", async () => {
    const root = await createFixture({ name: "package", transform: text => text.replace("macos-15", "macos-14") });
    expect(() => verifyCiWorkflows(root)).toThrow(/active Mac and Windows/);
  });
  it("requires Windows storage evidence even on failure", async () => {
    const root = await createFixture({ name: "windows-storage-native", transform: text => text.replace("if: always()", "if: success()") });
    expect(() => verifyCiWorkflows(root)).toThrow(/Windows storage must preserve failure evidence/);
  });
  it("rejects a Windows storage helper that no longer runs the literal migration matrix", async () => {
    const root = await createFixture({ name: "windows-storage-standard-user", transform: text => text.replaceAll("sequence-3-windows-matrix.ts", "storage-probe.ts") });
    expect(() => verifyCiWorkflows(root)).toThrow(/missing required gate: sequence-3-windows-matrix/);
  });
  it("still requires the phase 7 executable gate", async () => {
    const root = await createFixture({ name: "quality", transform: text => text.replace("pnpm phase7:verify", "echo phase7:verify") });
    expect(() => verifyCiWorkflows(root)).toThrow(/phase7:verify/);
  });
});
