import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { selectCodexExecutable } from "./executable-selection";
import { selectSmartCodexExecutable, confirmSmartCodexAdmissionCleanup } from "./smart-policy";

const directories: string[] = [], children: number[] = [];
function alive(pid: number) {
  try { return !execFileSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().startsWith("Z"); }
  catch { return false; }
}
async function waitPid(file: string) {
  for (let i = 0; i < 100; i++) { const pid = Number(await readFile(file, "utf8").catch(() => "")); if (pid) { children.push(pid); return pid; } await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error("Owned version fixture did not start.");
}
async function fixture(escape = false) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vdt-smart-probe-test-")); directories.push(dir);
  const pidPath = path.join(dir, "child.pid");
  await writeFile(path.join(dir, "codex"), `#!${process.execPath}\nconst {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit',detached:${escape}});fs.writeFileSync(${JSON.stringify(pidPath)},String(child.pid));console.log('codex-cli 0.146.0');setInterval(()=>{},1000);\n`, { mode: 0o700 });
  return { dir, pidPath };
}
afterEach(async () => {
  for (const pid of children.splice(0)) { if (alive(pid)) { try { process.kill(pid, "SIGKILL"); } catch {} } }
  await new Promise(resolve => setTimeout(resolve, 30));
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe.skipIf(process.platform === "win32")("Smart version probes own descendant cleanup", () => {
  it("deduplicates pre-scheduler admissions and never probes again after unknown cleanup", async () => {
    const { dir, pidPath } = await fixture(true), env = { ...process.env, PATH: dir }, controller = new AbortController();
    const first = selectSmartCodexExecutable(env, controller.signal), duplicate = selectSmartCodexExecutable(env, new AbortController().signal); void first.catch(() => {}); void duplicate.catch(() => {});
    const pid = await waitPid(pidPath); controller.abort();
    const errors = await Promise.allSettled([first, duplicate]);
    expect(errors.every(result => result.status === "rejected" && result.reason.code === "CLEANUP_UNCONFIRMED")).toBe(true);
    const failure = (errors[0] as PromiseRejectedResult).reason; directories.push(failure.retainedDirectory);
    await expect(selectSmartCodexExecutable(env, new AbortController().signal)).rejects.toMatchObject({ code: "CLEANUP_UNCONFIRMED" });
    expect(Number(await readFile(pidPath, "utf8"))).toBe(pid);
    process.kill(pid, "SIGKILL"); for (let i = 0; i < 100 && alive(pid); i++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(alive(pid)).toBe(false); confirmSmartCodexAdmissionCleanup(env, { terminalCleanupConfirmedByHost: true });
  });
  it("caller cancellation kills a wrapper and its inherited-pipe child before returning", async () => {
    const { dir, pidPath } = await fixture(), controller = new AbortController();
    const pending = selectCodexExecutable({ path: dir, env: { PATH: dir }, signal: controller.signal, requireConfirmedCleanup: true }); void pending.catch(() => {});
    const pid = await waitPid(pidPath); expect(alive(pid)).toBe(true); controller.abort();
    await expect(pending).rejects.toThrow(); expect(alive(pid)).toBe(false);
  });
  it("probe timeout kills the owned process group and never starts a completion", async () => {
    const { dir, pidPath } = await fixture();
    const pending = selectCodexExecutable({ path: dir, env: { PATH: dir }, requireConfirmedCleanup: true });
    const pid = await waitPid(pidPath); await expect(pending).resolves.toMatchObject({ version: null, error: "Codex CLI version probe failed." }); expect(alive(pid)).toBe(false);
  });
  it("bounds escaped descendant pipes, retains the exact owned directory, and returns quarantine", async () => {
    const { dir, pidPath } = await fixture(true), controller = new AbortController();
    const started = Date.now(), pending = selectCodexExecutable({ path: dir, env: { PATH: dir }, signal: controller.signal, requireConfirmedCleanup: true }); void pending.catch(() => {});
    const pid = await waitPid(pidPath); controller.abort();
    let failure: unknown; try { await pending; } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: "CLEANUP_UNCONFIRMED" }); expect(Date.now() - started).toBeLessThan(4000);
    const retained = (failure as { retainedDirectory: string }).retainedDirectory;
    expect(path.basename(retained)).toMatch(/^vdt-codex-selection-/); directories.push(retained);
    expect(alive(pid)).toBe(true); process.kill(pid, "SIGKILL");
    for (let i = 0; i < 100 && alive(pid); i++) await new Promise(resolve => setTimeout(resolve, 10)); expect(alive(pid)).toBe(false);
  });
});
