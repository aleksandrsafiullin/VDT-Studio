import { EventEmitter } from "node:events";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { execFile, spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CODEX_SELECTION_LIMITS, selectCodexExecutable } from "./executable-selection";

vi.mock("node:child_process", () => ({ spawn: vi.fn(), execFile: vi.fn() }));

const hostProcess = process;
const directories: string[] = [];

function childProcess(pid: number) {
  return Object.assign(new EventEmitter(), {
    pid,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
    unref: vi.fn()
  });
}

async function probe(platform: NodeJS.Platform) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "vdt-codex-probe-events-"));
  const directory = await realpath(temporary);
  directories.push(directory);
  await writeFile(path.join(directory, "codex"), "mocked process only", { mode: 0o700 });
  const kill = vi.fn(() => true);
  vi.stubGlobal("process", Object.create(hostProcess, { platform: { value: platform }, kill: { value: kill } }));
  const child = childProcess(123456);
  const killer = childProcess(123457);
  let notifyStarted!: () => void;
  const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
  vi.mocked(spawn).mockImplementation((() => {
    notifyStarted();
    return child;
  }) as unknown as typeof spawn);
  // Model a taskkill process whose callback/close never arrives either.
  vi.mocked(execFile).mockImplementation((() => killer) as unknown as typeof execFile);
  vi.useFakeTimers();
  const pending = selectCodexExecutable({ path: directory, platform: hostProcess.platform });
  await started;
  return { pending, child, killer, kill };
}

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Codex version probe hard deadlines", () => {
  it("settles a POSIX exited parent with inherited pipes still open", async () => {
    const { pending, child, kill } = await probe("darwin");
    child.stdout.write("codex-cli 0.162.0\n");
    child.emit("exit", 0);
    await vi.advanceTimersByTimeAsync(CODEX_SELECTION_LIMITS.versionTimeoutMs + CODEX_SELECTION_LIMITS.terminationGraceMs + 1);
    await expect(pending).resolves.toMatchObject({ version: null, error: "Codex CLI version probe failed." });
    expect(kill).toHaveBeenCalledWith(-child.pid, "SIGKILL");
    expect(child.stdout.destroyed).toBe(true);
    expect(child.stderr.destroyed).toBe(true);
    expect(child.unref).toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
  });

  it("bounds Windows taskkill and probe settlement without either close event", async () => {
    const { pending, child, killer } = await probe("win32");
    child.emit("exit", 0);
    await vi.advanceTimersByTimeAsync(CODEX_SELECTION_LIMITS.versionTimeoutMs + CODEX_SELECTION_LIMITS.taskkillTimeoutMs + 1);
    expect(killer.kill).toHaveBeenCalledWith("SIGKILL");
    expect(killer.stdout.destroyed).toBe(true);
    expect(killer.stderr.destroyed).toBe(true);
    expect(killer.unref).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(CODEX_SELECTION_LIMITS.terminationGraceMs);
    await expect(pending).resolves.toMatchObject({ version: null, error: "Codex CLI version probe failed." });
    expect(child.stdout.destroyed).toBe(true);
    expect(child.stderr.destroyed).toBe(true);
    expect(child.unref).toHaveBeenCalled();
  });

  it("settles an output-limit failure without waiting for exit or close", async () => {
    const { pending, child } = await probe("darwin");
    child.stdout.write(Buffer.alloc(CODEX_SELECTION_LIMITS.maxVersionBytes + 1));
    await vi.advanceTimersByTimeAsync(CODEX_SELECTION_LIMITS.terminationGraceMs + 1);
    await expect(pending).resolves.toMatchObject({ version: null, error: "Codex CLI version probe failed." });
    expect(child.stdout.destroyed).toBe(true);
    expect(child.stderr.destroyed).toBe(true);
  });
});
