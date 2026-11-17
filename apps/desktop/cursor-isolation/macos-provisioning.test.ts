import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, link, lstat, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertMacCursorDedicatedAuth,
  measureMacCursorPayload
} from "../../../packages/model-bridge/src/agent-engines/cursor-macos-isolation";
import { discoverMacCursorPayload, stopMacCursorLoginGroup } from "./macos-provisioning";

const ownedHomes: string[] = [];
const version = "2026.11.11-b912975";

async function homeFixture() {
  const home = await mkdtemp(path.join(await realpath(tmpdir()), "vdt-cursor-profile-test-"));
  ownedHomes.push(home);
  const release = path.join(home, ".local", "share", "cursor-agent", "versions", version);
  const launcher = path.join(home, ".local", "bin", "cursor-agent");
  const executable = path.join(release, "cursor-agent");
  await mkdir(release, { recursive: true, mode: 0o700 });
  await mkdir(path.dirname(launcher), { recursive: true, mode: 0o700 });
  await writeFile(executable, "synthetic vendor payload", { mode: 0o700 });
  return { home, release, launcher, executable };
}

afterEach(async () => {
  await Promise.all(ownedHomes.splice(0).map(home => rm(home, { recursive: true })));
});

describe.skipIf(process.platform === "win32")("macOS official Cursor profile", () => {
  it("requires the official launcher link and derives an exact vendor version from it", async () => {
    const { home, release, launcher, executable } = await homeFixture();
    await expect(discoverMacCursorPayload(home)).rejects.toMatchObject({ code: "CURSOR_NOT_INSTALLED" });
    await symlink(executable, launcher);
    const discovered = await discoverMacCursorPayload(home);
    expect(discovered).toMatchObject({ source: release, version });
    const first = await measureMacCursorPayload(discovered.source, discovered.device);
    await writeFile(executable, "same official location with different payload");
    const changed = await measureMacCursorPayload(discovered.source, discovered.device);
    expect(changed.payloadHash).not.toBe(first.payloadHash);
  });

  it("rejects an external launcher target and an executable shim at the official path", async () => {
    const { home, launcher } = await homeFixture();
    const foreign = path.join(home, "cursor-agent");
    await writeFile(foreign, "not the official launcher", { mode: 0o700 });
    await symlink(foreign, launcher);
    await expect(discoverMacCursorPayload(home)).rejects.toMatchObject({ code: "CURSOR_CHECKPOINT_UNSAFE_ENVIRONMENT" });
    await rm(launcher);
    await writeFile(launcher, "synthetic shim", { mode: 0o700 });
    await expect(discoverMacCursorPayload(home)).rejects.toMatchObject({ code: "CURSOR_CHECKPOINT_UNSAFE_ENVIRONMENT" });
  });

  it("rejects credential links, public permissions, and an empty credential object", async () => {
    const { home } = await homeFixture();
    const auth = path.join(home, "auth.json");
    const external = path.join(home, "other.json");
    const mock = JSON.stringify({ accessToken: "synthetic-test-access", refreshToken: "synthetic-test-refresh" });
    await writeFile(external, mock, { mode: 0o600 });
    await symlink(external, auth);
    await expect(assertMacCursorDedicatedAuth(auth)).rejects.toThrow();
    await rm(auth);
    await link(external, auth);
    await expect(assertMacCursorDedicatedAuth(auth)).rejects.toThrow();
    await rm(auth);
    await writeFile(auth, "{}", { mode: 0o600 });
    await expect(assertMacCursorDedicatedAuth(auth)).rejects.toThrow();
    await writeFile(auth, mock);
    await chmod(auth, 0o644);
    await expect(assertMacCursorDedicatedAuth(auth)).rejects.toThrow();
    await chmod(auth, 0o600);
    await expect(assertMacCursorDedicatedAuth(auth)).resolves.toBeUndefined();
  });

  it("rejects symlinks anywhere in the candidate payload before executing it", async () => {
    const { release, executable } = await homeFixture();
    await symlink(executable, path.join(release, "node"));
    await expect(measureMacCursorPayload(release, (await lstat(release)).dev)).rejects.toThrow("unsupported filesystem entry");
  });
});

describe.skipIf(process.platform !== "darwin")("macOS Cursor sign-in process ownership", () => {
  it("kills a descendant left in the group after the synthetic leader exits", async () => {
    const leader = spawn(process.execPath, ["-e", `
      const { spawn } = require("node:child_process");
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      child.once("spawn", () => {
        process.stdout.write(String(child.pid), () => process.exit(0));
      });
    `], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const group = leader.pid!;
    try {
      let output = "";
      leader.stdout.on("data", data => { output += data.toString(); });
      await once(leader, "close");
      const descendant = Number(output);
      expect(descendant).toBeGreaterThan(1);
      expect(process.kill(descendant, 0)).toBe(true);
      await expect(stopMacCursorLoginGroup(group)).resolves.toBe(true);
      expect(() => process.kill(-group, 0)).toThrow();
    } finally {
      await stopMacCursorLoginGroup(group);
    }
  });

  it("distinguishes an absent group from a process cleanup permission failure", async () => {
    const missing = Object.assign(new Error(), { code: "ESRCH" });
    const denied = Object.assign(new Error(), { code: "EPERM" });
    const kill = vi.spyOn(process, "kill")
      .mockImplementationOnce(() => { throw missing; })
      .mockImplementationOnce(() => { throw denied; });
    try {
      await expect(stopMacCursorLoginGroup(400)).resolves.toBe(true);
      await expect(stopMacCursorLoginGroup(400)).resolves.toBe(false);
      expect(kill).toHaveBeenCalledWith(-400, "SIGKILL");
    } finally {
      kill.mockRestore();
    }
  });
});
