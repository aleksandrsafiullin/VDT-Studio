import { mkdtemp, rm, mkdir, writeFile, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { codexSmartMetadataIdentity, readCodexSmartDefaultModel } from "./smart-policy";
const directories: string[] = [];
async function home() { const root = await mkdtemp(path.join(os.tmpdir(), "vdt-smart-binding-test-")); directories.push(root); const codex = path.join(root, ".codex"); await mkdir(codex); return { env: { ...process.env, HOME: root, CODEX_HOME: codex, VDT_CODEX_SESSION_MODEL: "" }, codex }; }
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
describe("nonsecret Codex Smart binding metadata", () => {
  it("preserves the actual configured top-level/default env model in a private profile", async () => {
    const { env, codex } = await home();
    await writeFile(path.join(codex, "config.toml"), 'model = "configured-default" # keep this selection\napi_key="synthetic-never-identity"\n[profiles.work]\nmodel="different-profile"\n');
    await expect(readCodexSmartDefaultModel(env)).resolves.toBe("configured-default");
    await expect(readCodexSmartDefaultModel({ ...env, VDT_CODEX_SESSION_MODEL: "host-binding-selected" })).resolves.toBe("host-binding-selected");
    await writeFile(path.join(codex, "config.toml"), '[profiles.work]\nmodel="profile-only"\n');
    await expect(readCodexSmartDefaultModel(env)).resolves.toBeUndefined();
  });
  it("reuses passive reload and invalidates catalog/config or credential metadata changes separately", async () => {
    const { env, codex } = await home();
    for (const file of ["config.toml", "models_cache.json", "auth.json"]) await writeFile(path.join(codex, file), "synthetic-never-identity");
    const first = await codexSmartMetadataIdentity(env, "/host/codex", "codex-cli 0.146.0");
    expect(await codexSmartMetadataIdentity({ ...env }, "/host/codex", "codex-cli 0.146.0")).toEqual(first);
    expect(JSON.stringify(first)).not.toContain("synthetic-never-identity");
    await utimes(path.join(codex, "models_cache.json"), new Date("2026-01-01"), new Date("2026-01-01"));
    const catalog = await codexSmartMetadataIdentity(env, "/host/codex", "codex-cli 0.146.0"); expect(catalog.bindingVersion).not.toBe(first.bindingVersion); expect(catalog.credentialEpoch).toBe(first.credentialEpoch);
    await utimes(path.join(codex, "auth.json"), new Date("2026-02-01"), new Date("2026-02-01"));
    const replaced = await codexSmartMetadataIdentity(env, "/host/codex", "codex-cli 0.146.0"); expect(replaced.credentialEpoch).not.toBe(first.credentialEpoch); expect(replaced.bindingVersion).toBe(catalog.bindingVersion);
    expect((await codexSmartMetadataIdentity(env, "/host/codex", "codex-cli 0.147.0")).bindingVersion).not.toBe(replaced.bindingVersion);
  });
  it("rejects unbounded/unparseable or flag-like default selections", async () => {
    const { env, codex } = await home();
    for (const text of ['model = "--unsafe"', 'model = "has whitespace"', 'model = ["not-a-model"]', "x".repeat(65_537)]) {
      await writeFile(path.join(codex, "config.toml"), text); await expect(readCodexSmartDefaultModel(env)).rejects.toThrow();
    }
  });
});
