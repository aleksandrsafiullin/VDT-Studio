import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveBuildIdentity } from "./build-identity.mjs";

const root = mkdtempSync(path.join(os.tmpdir(), "vdt-build-identity-"));
const version = "0.1.0-alpha.2";
const fixedTime = "2026-11-13T12:00:00.000Z";
writeFileSync(path.join(root, "package.json"), JSON.stringify({ version }));
const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], {
  encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]
}).trim();
git("init");
git("add", "package.json");
git("-c", "user.name=VDT Test", "-c", "user.email=test@example.invalid", "commit", "-m", "fixture");
const commit = git("rev-parse", "HEAD");
const archive = path.join(root, "archive");
mkdirSync(archive);
writeFileSync(path.join(archive, "package.json"), readFileSync(path.join(root, "package.json")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("public build identity", () => {
  it("reports the real checkout and cannot falsely label local edits clean", () => {
    const fields = resolveBuildIdentity(root, {}, () => new Date(fixedTime));
    expect(fields).toEqual({
      NEXT_PUBLIC_VDT_BUILD_VERSION: version,
      NEXT_PUBLIC_VDT_BUILD_COMMIT: commit,
      NEXT_PUBLIC_VDT_BUILD_DIRTY: "true",
      NEXT_PUBLIC_VDT_BUILD_TIME: fixedTime
    });
    expect(() => resolveBuildIdentity(root, { NEXT_PUBLIC_VDT_BUILD_DIRTY: "false" })).toThrow(/dirty state differs/);
    expect(() => resolveBuildIdentity(root, { NEXT_PUBLIC_VDT_BUILD_COMMIT: "a".repeat(40) })).toThrow(/commit differs/);
  });

  it("does not attribute a nested source archive to its enclosing checkout", () => {
    const fields = resolveBuildIdentity(archive, {}, () => new Date(fixedTime));
    expect(fields.NEXT_PUBLIC_VDT_BUILD_COMMIT).toBe("unknown");
    expect(fields.NEXT_PUBLIC_VDT_BUILD_DIRTY).toBe("unknown");
    expect(() => resolveBuildIdentity(archive, { NEXT_PUBLIC_VDT_BUILD_DIRTY: "false" })).toThrow(/unidentified source archive/);
  });

  it("accepts the packaging entrypoint's exact archived identity and allowlists fields", () => {
    const fields = resolveBuildIdentity(archive, {
      NEXT_PUBLIC_VDT_BUILD_COMMIT: commit,
      NEXT_PUBLIC_VDT_BUILD_DIRTY: "false",
      NEXT_PUBLIC_VDT_BUILD_TIME: fixedTime,
      OPENAI_API_KEY: "synthetic-secret-never-exported",
      HOME: "/private/user-home"
    });
    expect(fields.NEXT_PUBLIC_VDT_BUILD_COMMIT).toBe(commit);
    expect(fields.NEXT_PUBLIC_VDT_BUILD_DIRTY).toBe("false");
    expect(JSON.stringify(fields)).not.toContain("secret");
    expect(Object.keys(fields)).toHaveLength(4);
  });

  it.each([
    { NEXT_PUBLIC_VDT_BUILD_COMMIT: "main" },
    { NEXT_PUBLIC_VDT_BUILD_COMMIT: "/private/personal/path" },
    { NEXT_PUBLIC_VDT_BUILD_VERSION: "0.1.0-other" },
    { NEXT_PUBLIC_VDT_BUILD_TIME: "yesterday" },
    { NEXT_PUBLIC_VDT_BUILD_DIRTY: "0" }
  ])("rejects an invalid or contradictory packaging identity: %j", (env) => {
    expect(() => resolveBuildIdentity(archive, env)).toThrow(/identity|differs/);
  });
});
