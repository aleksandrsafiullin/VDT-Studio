import { readFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

const preload = readFileSync(new URL("./proxy-preload.cjs", import.meta.url), "utf8");
const scope = `C:\\QA\\VdtCursorSession${"1".repeat(32)}`;
const home = path.win32.join(scope, "state");
const policyDir = path.win32.join(scope, "policy");
const config = path.win32.join(policyDir, "cli-config.json");
const draftPath = `\\\\?\\${config.toUpperCase()}.1212.00112233-4455-6677-8899-aabbccddeeff.tmp`;
const policy = {
  version: 1,
  editor: { vimMode: false },
  approvalMode: "allowlist",
  permissions: { allow: [], deny: ["Shell(*)"] },
  sandbox: { mode: "disabled", readBoundary: "workspace" }
};

function fixture() {
  const underlying = {
    readFile: vi.fn<(filename: string, encoding: string) => Promise<string>>(async () => JSON.stringify(policy)),
    writeFile: vi.fn<(filename: string, data: string, encoding: string) => Promise<void>>(async () => {}),
    rename: vi.fn<(source: string, destination: string) => Promise<void>>(async () => {}),
    rm: vi.fn<(filename: string) => Promise<void>>(async () => {})
  };
  const files = { ...underlying };
  const chmod = vi.fn<(filename: string, mode: number) => void>();
  const stat = vi.fn<(filename: string) => void>();
  const realpath = Object.assign(vi.fn((filename: string) => filename), {
    native: vi.fn((filename: string) => filename)
  });
  const syncFiles = {
    readFileSync: () => JSON.stringify(policy),
    chmodSync: chmod,
    lstatSync: stat,
    realpathSync: realpath
  };
  const modules = new Map<string, unknown>([
    ["node:fs", syncFiles],
    ["node:fs/promises", files],
    ["node:os", { userInfo: () => ({}) }],
    ["node:net", { Socket: class { connect() {} } }],
    ["node:module", { syncBuiltinESMExports() {} }],
    ["node:path", path],
    ["node:util", { isDeepStrictEqual }]
  ]);
  runInNewContext(preload, {
    require: (id: string) => modules.get(id),
    process: {
      pid: 1212, platform: "win32",
      env: { HOME: home, USERPROFILE: home, CURSOR_CONFIG_DIR: policyDir }
    },
    Buffer
  });
  return { files, underlying, syncFiles, chmod, stat, realpath };
}

it("stages the exact Windows atomic config transaction in memory and retains the read-only policy", async () => {
  const { files, underlying } = fixture();
  const approved = { ...policy, privacyCache: { ghostMode: true }, network: { useHttp1ForAgent: false } };
  await files.writeFile(draftPath, JSON.stringify({
    ...approved,
    model: { displayName: "Grok" },
    selectedModel: { modelId: "grok-4.7-low" },
    modelParameters: {},
    modelSelectionHistory: ["grok-4.7-low"]
  }), "utf8");
  expect(JSON.parse(await files.readFile(config, "utf8"))).toEqual(policy);
  await files.rename(draftPath, config);
  expect(JSON.parse(await files.readFile(config, "utf8"))).toEqual(approved);
  expect(underlying.writeFile).not.toHaveBeenCalled();
  expect(underlying.rename).not.toHaveBeenCalled();
});

it("rejects changes to the policy and lets Windows handle other file writes", async () => {
  const { files, underlying } = fixture();
  for (const hostile of [
    { ...policy, permissions: { allow: ["Shell(*)"], deny: [] } },
    { ...policy, autoAcceptWebSearch: true },
    { ...policy, network: { useHttp1ForAgent: false, endpoint: "https://example.com" } },
    { ...policy, webFetchDomainAllowlist: ["example.com"] }
  ]) {
    await expect(files.writeFile(draftPath, JSON.stringify(hostile), "utf8")).rejects.toMatchObject({ code: "EPERM" });
  }
  await expect(files.rename(draftPath, config)).rejects.toMatchObject({ code: "EPERM" });
  const unrelated = path.win32.join(home, "state.json");
  await files.writeFile(unrelated, "state", "utf8");
  expect(underlying.writeFile).toHaveBeenCalledExactlyOnceWith(unrelated, "state", "utf8");
  expect(JSON.parse(await files.readFile(config, "utf8"))).toEqual(policy);
});

it("uses real FS operations for only the mapped vendor persistence namespace", () => {
  const { syncFiles, chmod, stat, realpath } = fixture();
  const physical = path.win32.join(home, "cursor-private-persist");
  syncFiles.chmodSync("\\tmp\\cursor-agent-persist-user", 0o700);
  expect(chmod).toHaveBeenCalledExactlyOnceWith(physical, 0o700);

  syncFiles.lstatSync("C:\\TMP\\CURSOR-AGENT-PERSIST-USER\\completions\\case.status");
  expect(stat).toHaveBeenLastCalledWith(path.win32.join(physical, "completions", "case.status"));
  expect(syncFiles.realpathSync.native("C:/tmp/cursor-agent-persist-user")).toBe(physical);
  expect(realpath.native).toHaveBeenCalledExactlyOnceWith(physical);

  const outside = "D:\\tmp\\cursor-agent-persist-user";
  syncFiles.lstatSync(outside);
  expect(stat).toHaveBeenLastCalledWith(outside);
  expect(() => syncFiles.lstatSync("\\tmp\\cursor-agent-persist-user\\..\\elsewhere"))
    .toThrow("Invalid Cursor persistent-session path");
});
