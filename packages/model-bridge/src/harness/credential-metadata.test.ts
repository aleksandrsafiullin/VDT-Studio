import { afterEach, describe, expect, it, vi } from "vitest";
import { chmod, copyFile, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { builtinHarness } from "./catalog";
import { harnessEnvironment, harnessOpaqueIdentity, withHarnessSession } from "./rpc-session";
import { vibeKeyringMetadata } from "./credential-metadata";
import * as credentialMetadata from "./credential-metadata";
import { resolveSmartHarnessIdentity } from "./smart-identity";

const roots: string[] = [];
async function scratch() { const root = await mkdtemp(path.join(tmpdir(), "vdt-credential-metadata-test-")); roots.push(root); return root; }
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe("provider-owned account/config roots", () => {
  it("keeps a Smart credential epoch when the route module is loaded again in the same process", async () => {
    const home = await scratch();
    const harness = builtinHarness("cursor-agent")!;
    const env = { HOME: home };
    const first = harnessOpaqueIdentity(harness, "/owned/fixture", "1.0.0", env);
    vi.resetModules();
    const { harnessOpaqueIdentity: readmit } = await import("./rpc-session");
    expect(readmit(harness, "/owned/fixture", "1.0.0", env)).toEqual(first);
    const changed = readmit(harness, "/owned/fixture", "1.0.0", { HOME: path.join(home, "other-profile") });
    expect(changed.credentialEpoch).not.toBe(first.credentialEpoch);
  });

  it.each([
    ["kimi", "KIMI_CODE_HOME", "config.toml"], ["pi", "PI_CODING_AGENT_DIR", "auth.json"], ["vibe", "VIBE_HOME", ".env"],
    ["qwen", "QWEN_HOME", "settings.json"], ["grok-build", "GROK_HOME", "auth.json"], ["kilo", "XDG_DATA_HOME", "kilo/auth.json"],
    ["kilo", "XDG_CONFIG_HOME", "kilo/kilo.jsonc"], ["kilo", "KILO_CONFIG_DIR", "kilo.jsonc"]
  ] as const)("uses %s's documented %s root and fingerprints its real credential/config file", async (id, variable, filename) => {
    const root = await scratch(), h = builtinHarness(id)!, env = { ...process.env, [variable]: root };
    const options = { vibeCredentialSource: "file" as const };
    expect(harnessEnvironment(h, env)[variable]).toBe(root);
    const before = harnessOpaqueIdentity(h, "/owned/fixture", "1.0.0", env, options);
    const target = path.join(root, filename); await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "synthetic-account-fixture-only");
    const after = harnessOpaqueIdentity(h, "/owned/fixture", "1.0.0", env, options);
    expect(after.credentialEpoch).not.toBe(before.credentialEpoch);
    expect(harnessOpaqueIdentity(h, "/owned/fixture", "1.0.0", env, options)).toEqual(after);
    expect(JSON.stringify(after)).not.toContain(root);
  });
  it("keeps a cloned Vibe profile on its configured root and shell credential", async () => {
    const root = await scratch(), h = { ...builtinHarness("vibe")!, id: "custom-vibe" as const, backendId: "custom-vibe_subscription", baseHarness: "vibe" as const };
    const env = { ...process.env, VIBE_HOME: root, MISTRAL_API_KEY: "synthetic-credential-no-network", GROK_HOME: "/must-not-inherit", VIBE_UNREVIEWED_SETTING: "must-not-inherit" };
    const actual = harnessEnvironment(h, env);
    expect(actual.VIBE_HOME).toBe(root); expect(actual.MISTRAL_API_KEY).toBe(env.MISTRAL_API_KEY);
    expect(actual.GROK_HOME).toBeUndefined(); expect(actual.VIBE_UNREVIEWED_SETTING).toBeUndefined();
    const options = { vibeCredentialSource: "env" as const, platform: "linux" as const, keychainSearchList: () => { throw new Error("Keyring must not be inspected for a verified env source"); } };
    const first = harnessOpaqueIdentity(h, "/owned/fixture", "1.0.0", env, options);
    const rotated = harnessOpaqueIdentity(h, "/owned/fixture", "1.0.0", { ...env, MISTRAL_API_KEY: "another-synthetic-credential" }, options);
    expect(rotated.credentialEpoch).not.toBe(first.credentialEpoch);
    expect(JSON.stringify(rotated)).not.toContain("synthetic");
  });
  it("resolves relative and tilde roots against the host rather than the private subprocess cwd", async () => {
    const root = await scratch(), h = builtinHarness("qwen")!;
    expect(harnessEnvironment(h, { HOME: root, QWEN_HOME: "~/my-qwen" }).QWEN_HOME).toBe(path.join(root, "my-qwen"));
    expect(harnessEnvironment(h, { HOME: root, QWEN_HOME: "relative-qwen" }).QWEN_HOME).toBe(path.resolve("relative-qwen"));
  });
  it.each(["env", "file", "none"] as const)("does not depend on an uninspectable keyring for Vibe's verified %s source", async source => {
    const root = await scratch(), h = builtinHarness("vibe")!;
    const options = { platform: "win32" as const, vibeCredentialSource: source, keychainSearchList: () => { throw new Error("Do not inspect"); } };
    const env = { HOME: root, VIBE_HOME: root };
    expect(harnessOpaqueIdentity(h, "/owned/fixture", "1.0.0", env, options)).toEqual(harnessOpaqueIdentity(h, "/owned/fixture", "1.0.0", env, options));
  });
  it("takes credential source only from the owned Vibe metadata response for its unchanged default model", async () => {
    const fixture = fileURLToPath(new URL("./fixtures/fake-harness.cjs", import.meta.url)), h = { ...builtinHarness("vibe")!, command: fixture };
    await withHarnessSession(h, AbortSignal.timeout(3000), async session => {
      await session.selectModel("test-model", AbortSignal.timeout(1000));
      expect(await session.credentialSource(AbortSignal.timeout(1000))).toBe("file");
      await session.selectModel("different-provider-model", AbortSignal.timeout(1000));
      expect(await session.credentialSource(AbortSignal.timeout(1000))).toBeUndefined();
    }, { env: { ...process.env, NODE_ENV: "test" } });
  });
  it.each(["process_env", "vibe_home_env_file"])("admits Smart with Vibe's verified %s source without inspecting a keyring", async source => {
    const root = await scratch(), executable = path.join(root, "fake-vibe.cjs"), log = path.join(root, "commands.jsonl");
    await copyFile(fileURLToPath(new URL("./fixtures/fake-harness.cjs", import.meta.url)), executable); await chmod(executable, 0o700);
    await symlink(executable, path.join(root, "vibe-acp"));
    await writeFile(path.join(root, ".env"), "MISTRAL_API_KEY=synthetic-fixture-only");
    const keychain = vi.spyOn(credentialMetadata, "vibeKeyringMetadata").mockImplementation(() => { throw new Error("Keyring inspection must not be needed for this selected credential source"); });
    const env = { ...process.env, NODE_ENV: "test", PATH: `${root}${path.delimiter}${path.dirname(process.execPath)}`, HOME: root, VIBE_HOME: root, VDT_HARNESS_CONFIG: path.join(root, "profiles.json"), VDT_FAKE_HARNESS_LOG: log, VDT_FAKE_VIBE_AUTH_SOURCE: source, ...(source === "process_env" ? { MISTRAL_API_KEY: "synthetic-shell-key" } : {}) };
    const first = await resolveSmartHarnessIdentity("vibe_subscription", "test-model", AbortSignal.timeout(5000), env, false);
    const second = await resolveSmartHarnessIdentity("vibe_subscription", "test-model", AbortSignal.timeout(5000), env, false);
    expect(second).toEqual(first); expect(keychain).not.toHaveBeenCalled();
    expect(await readFile(log, "utf8")).toContain('"method":"_auth/status"');
    expect(await readFile(log, "utf8")).not.toContain('"method":"session/prompt"');
    expect(JSON.stringify(first)).not.toContain("synthetic");
  });
});

describe("Vibe non-secret macOS credential-store generation", () => {
  it("does not invalidate verified Smart epochs during ordinary chat metadata refresh", async () => {
    const root = await scratch(), keychain = path.join(root, "fixture.keychain-db"), h = builtinHarness("vibe")!;
    await writeFile(keychain, "owned encrypted-store fixture");
    const env = { HOME: root, VIBE_HOME: root }, keychainSearchList = () => [keychain];
    const smartOptions = { platform: "darwin" as const, vibeCredentialSource: "file" as const, keychainSearchList };
    const before = harnessOpaqueIdentity(h, "/owned/fixture", "1.0.0", env, smartOptions);
    const chat = harnessOpaqueIdentity(h, "/owned/fixture", "1.0.0", env, { platform: "darwin", purpose: "chat", keychainSearchList });
    expect(chat.credentialEpoch).not.toBe(before.credentialEpoch);
    expect(harnessOpaqueIdentity(h, "/owned/fixture", "1.0.0", env, smartOptions)).toEqual(before);
    expect(harnessOpaqueIdentity(h, "/owned/fixture", "1.0.0", env, { platform: "darwin", purpose: "chat", keychainSearchList })).toEqual(chat);
  });
  it("keeps unqualified chat working on an unknown keyring host without admitting Smart", async () => {
    const root = await scratch(), env = { HOME: root, VIBE_HOME: root }, h = builtinHarness("vibe")!;
    const options = { platform: "linux" as const };
    const before = harnessOpaqueIdentity(h, "/owned/fixture", "1.0.0", env, { ...options, vibeCredentialSource: "file" });
    expect(() => harnessOpaqueIdentity(h, "/owned/fixture", "1.0.0", env, { ...options, purpose: "chat" })).not.toThrow();
    expect(() => harnessOpaqueIdentity(h, "/owned/fixture", "1.0.0", env, options)).toThrowError(expect.objectContaining({ code: "CREDENTIAL_IDENTITY_UNVERIFIED" }));
    expect(harnessOpaqueIdentity(h, "/owned/fixture", "1.0.0", env, { ...options, vibeCredentialSource: "file" })).toEqual(before);
  });
  it("keeps a stable epoch for unchanged encrypted stores and invalidates main/WAL/journal changes", async () => {
    const root = await scratch(), keychain = path.join(root, "fixture.keychain-db"), h = builtinHarness("vibe")!;
    await writeFile(keychain, "fixture encrypted store, not a credential");
    const env = { HOME: root, VIBE_HOME: path.join(root, "vibe") }, options = { platform: "darwin" as const, keychainSearchList: () => [keychain] };
    let prior = harnessOpaqueIdentity(h, "/owned/fixture", "1.0.0", env, options);
    expect(harnessOpaqueIdentity(h, "/owned/fixture", "1.0.0", env, options)).toEqual(prior);
    for (const file of [keychain, `${keychain}-wal`, `${keychain}-journal`]) {
      await writeFile(file, "changed fixture encrypted-store bytes");
      const current = harnessOpaqueIdentity(h, "/owned/fixture", "1.0.0", env, options);
      expect(current.credentialEpoch).not.toBe(prior.credentialEpoch); prior = current;
    }
    expect(JSON.stringify(prior)).not.toContain(keychain);
  });
  it("tracks canonical stores/sidecars and search-list precedence", async () => {
    const root = await scratch(), first = path.join(root, "one.keychain-db"), second = path.join(root, "two.keychain-db"), alias = path.join(root, "alias.keychain-db");
    await writeFile(first, "first fixture encrypted DB"); await writeFile(second, "second fixture encrypted DB"); await symlink(first, alias);
    const env = { HOME: root }, h = builtinHarness("vibe")!, options = { platform: "darwin" as const, keychainSearchList: () => [alias, second] };
    const original = harnessOpaqueIdentity(h, "/owned/fixture", "1.0.0", env, options);
    await writeFile(`${first}-wal`, "canonical WAL changed");
    const changed = harnessOpaqueIdentity(h, "/owned/fixture", "1.0.0", env, options);
    expect(changed.credentialEpoch).not.toBe(original.credentialEpoch);
    expect(harnessOpaqueIdentity(h, "/owned/fixture", "1.0.0", env, { ...options, keychainSearchList: () => [second, alias] }).credentialEpoch).not.toBe(changed.credentialEpoch);
  });
  it("fails explicitly when the real store cannot be inspected, without reporting a fake stable epoch", async () => {
    const root = await scratch();
    for (const options of [
      { platform: "linux" as const }, { platform: "win32" as const },
      { platform: "darwin" as const, keychainSearchList: () => [] },
      { platform: "darwin" as const, keychainSearchList: () => [path.join(root, "missing.keychain-db")] },
      { platform: "darwin" as const, keychainSearchList: () => { throw new Error("private diagnostics"); } }
    ]) {
      expect(() => vibeKeyringMetadata({ HOME: root }, options)).toThrowError(expect.objectContaining({ code: "CREDENTIAL_IDENTITY_UNVERIFIED" }));
      try { vibeKeyringMetadata({ HOME: root }, options); } catch (error) { expect((error as Error).message).not.toContain("private diagnostics"); }
    }
  });
});
