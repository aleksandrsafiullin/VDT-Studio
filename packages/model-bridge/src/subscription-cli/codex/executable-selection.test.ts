import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectSubscriptionCli } from "../../detection";
import { CODEX_SELECTION_LIMITS, selectCodexExecutable } from "./executable-selection";

const directories: string[] = [];

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "vdt-codex-selection-test-"));
  directories.push(directory);
  return realpath(directory);
}

async function installation(version: string, directory?: string): Promise<string> {
  const root = directory ?? await tempDirectory();
  await mkdir(root, { recursive: true });
  const executable = path.join(root, "codex");
  await writeFile(executable, `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(version + "\n")});\n`, { mode: 0o700 });
  return executable;
}

function searchPath(...executables: string[]): string {
  return executables.map((executable) => path.dirname(executable)).join(path.delimiter);
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe.skipIf(process.platform === "win32")("Codex executable selection", () => {
  it("selects a newer installed CLI after an older npm CLI on PATH", async () => {
    const old = await installation("codex-cli 0.146.0");
    const current = await installation("codex-cli 0.162.0-alpha.17.2");
    const options = { path: searchPath(old, current) };
    await expect(selectCodexExecutable(options)).resolves.toMatchObject({ executable: current, version: "codex-cli 0.162.0-alpha.17.2" });
    await expect(detectSubscriptionCli("codex", options)).resolves.toMatchObject({ installed: true, executable: current, version: "codex-cli 0.162.0-alpha.17.2" });
  });

  it("compares an already installed app CLI with PATH candidates without changing PATH", async () => {
    const old = await installation("codex-cli 0.146.0");
    const bundled = await installation("codex-cli 0.164.0-alpha.11.1");
    await expect(selectCodexExecutable({ path: searchPath(old), applicationDirectories: [path.dirname(bundled)] }))
      .resolves.toMatchObject({ executable: bundled, version: "codex-cli 0.164.0-alpha.11.1" });
    // An explicit host PATH keeps deterministic, isolated discovery unless opted in.
    await expect(selectCodexExecutable({ path: searchPath(old) })).resolves.toMatchObject({ executable: old });
  });

  it("discovers the reviewed macOS app location even when it is missing from the server PATH", async () => {
    const old = await installation("codex-cli 0.146.0");
    const hostHome = await tempDirectory();
    const bundled = await installation("codex-cli 0.164.0-alpha.11.1", path.join(hostHome, "Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS"));
    await expect(selectCodexExecutable({ platform: "darwin", env: { PATH: searchPath(old), HOME: hostHome }, executableCheck: async (candidate) => [old, bundled].includes(candidate) }))
      .resolves.toMatchObject({ executable: bundled });
  });

  it.each([
    ["0.162.0-alpha.17.2", "0.162.0", true],
    ["0.162.0-alpha.2", "0.162.0-alpha.11", true],
    ["0.162.0+first", "0.162.0+second", false],
    ["0.162.0", "0.162.0", false],
    ["unrecognized wrapper 999.0.0", "0.146.0", true]
  ])("uses deterministic semver precedence for %s and %s", async (firstVersion, secondVersion, selectSecond) => {
    const first = await installation(firstVersion);
    const second = await installation(secondVersion);
    const selected = await selectCodexExecutable({ path: searchPath(first, second) });
    expect(selected?.executable).toBe(selectSecond ? second : first);
  });

  it("keeps an installed/unverified first-path fallback when every version probe fails", async () => {
    const first = await installation("unknown");
    const second = await installation("unknown");
    const versionProbe = vi.fn(async () => { throw new Error("private subprocess details"); });
    await expect(selectCodexExecutable({ path: searchPath(first, second), versionProbe })).resolves.toEqual({
      executable: first, alias: "codex", version: null, error: "Codex CLI version probe failed."
    });
  });

  it("rejects relative paths, repo symlinks, directories, missing files and nonexecutables before any version probe", async () => {
    const directory = await tempDirectory();
    const unsafeLinkDirectory = path.join(directory, "repo-link");
    const directoryCandidate = path.join(directory, "directory");
    const nonexecutableDirectory = path.join(directory, "nonexecutable");
    await mkdir(unsafeLinkDirectory);
    await mkdir(path.join(directoryCandidate, "codex"), { recursive: true });
    await mkdir(nonexecutableDirectory);
    await symlink(fileURLToPath(new URL("./fixtures/success-structured.json", import.meta.url)), path.join(unsafeLinkDirectory, "codex"));
    await writeFile(path.join(nonexecutableDirectory, "codex"), "unused", { mode: 0o600 });
    const valid = await installation("0.162.0");
    const versionProbe = vi.fn(async () => ({ stdout: "codex-cli 0.162.0", stderr: "" }));
    const selected = await selectCodexExecutable({
      path: ["relative-tools", unsafeLinkDirectory, directoryCandidate, nonexecutableDirectory, path.join(directory, "missing"), path.dirname(valid)].join(path.delimiter),
      versionProbe
    });
    expect(selected?.executable).toBe(valid);
    expect(versionProbe.mock.calls).toEqual([[valid, ["--version"]]]);
  });

  it("deduplicates realpaths and keeps executableCheck as an additional host filter", async () => {
    const original = await installation("0.162.0");
    const aliasDirectory = await tempDirectory();
    await symlink(original, path.join(aliasDirectory, "codex"));
    const versionProbe = vi.fn(async () => ({ stdout: "0.162.0", stderr: "" }));
    await selectCodexExecutable({ path: [path.dirname(original), aliasDirectory].join(path.delimiter), versionProbe });
    expect(versionProbe).toHaveBeenCalledTimes(1);
    await expect(selectCodexExecutable({ path: path.dirname(original), executableCheck: async () => false, versionProbe })).resolves.toBeNull();
  });

  it("bounds the number of candidate probes and simultaneous processes", async () => {
    const root = await tempDirectory();
    const executables = await Promise.all(Array.from({ length: CODEX_SELECTION_LIMITS.maxCandidates + 1 }, (_, index) => installation("0.146.0", path.join(root, String(index)))));
    let active = 0;
    let maximumActive = 0;
    const versionProbe = vi.fn(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active -= 1;
      return { stdout: "0.146.0", stderr: "" };
    });
    await selectCodexExecutable({ path: searchPath(...executables), versionProbe });
    expect(versionProbe).toHaveBeenCalledTimes(CODEX_SELECTION_LIMITS.maxCandidates);
    expect(maximumActive).toBeLessThanOrEqual(CODEX_SELECTION_LIMITS.concurrency);
  });

  it.skipIf(process.platform === "win32")("terminates a hung version wrapper and its owned grandchild", async () => {
    const directory = await tempDirectory();
    const executable = path.join(directory, "codex");
    const pidFile = path.join(directory, "grandchild.pid");
    await writeFile(executable, `#!${process.execPath}\nconst { spawn } = require('node:child_process');\nconst child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });\nrequire('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));\nsetInterval(() => {}, 1000);\n`, { mode: 0o700 });
    let grandchild: number | undefined;
    try {
      await expect(selectCodexExecutable({ path: directory })).resolves.toMatchObject({ version: null, error: "Codex CLI version probe failed." });
      grandchild = Number(await readFile(pidFile, "utf8"));
      await expect.poll(() => {
        try { process.kill(grandchild!, 0); return true; } catch { return false; }
      }, { timeout: 2_000 }).toBe(false);
    } finally {
      grandchild ??= Number(await readFile(pidFile, "utf8").catch(() => "0"));
      if (grandchild > 0) { try { process.kill(grandchild, "SIGKILL"); } catch { /* Already terminated. */ } }
    }
  }, 6_000);
});
