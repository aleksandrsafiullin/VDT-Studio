import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cursorLaunchTarget, resolveWindowsCursorShim } from "./windows-launch";

describe("official Cursor Windows payload", () => {
  let data: string;
  let root: string;
  let shim: string;
  async function release(name: string) {
    const folder = path.join(root, "versions", name);
    await mkdir(folder);
    await writeFile(path.join(folder, "index.js"), "");
    await writeFile(path.join(folder, "node.exe"), "");
    return folder;
  }
  beforeEach(async () => {
    data = await mkdtemp(path.join(os.tmpdir(), "cursor windows "));
    root = path.join(data, "cursor-agent");
    shim = path.join(root, "agent.cmd");
    await mkdir(path.join(root, "versions"), { recursive: true });
    await writeFile(shim, "fixture only");
  });
  afterEach(async () => { await rm(data, { recursive: true, force: true }); });
  it("pins the unique latest completed date with literal argument boundaries", async () => {
    await release("2026.9.30-aaaa");
    const selected = await release("2026.11.13-08-01-00-bbbb");
    const entry = await resolveWindowsCursorShim(shim, data);
    await release("2026.11.14-cccc");
    const input = ['model & | %! " with space', "second"];
    const target = cursorLaunchTarget(entry, input, { NODE_ENV: "test", NODE_OPTIONS: "--require unwanted", NODE_PATH: "unwanted" }, { platform: "win32", localAppData: data });
    expect(target.executable).toBe(path.join(selected, "node.exe"));
    expect(target.args).toEqual([path.join(selected, "index.js"), ...input]);
    expect(target.env?.NODE_OPTIONS).toBeUndefined();
    expect(target.env?.NODE_PATH).toBeUndefined();
    expect(target.env).toEqual({ NODE_ENV: "test", CURSOR_INVOKED_AS: "agent.cmd" });
    expect(cursorLaunchTarget(entry, [], {} as NodeJS.ProcessEnv, { platform: "win32", localAppData: data }).env)
      .toEqual({ CURSOR_INVOKED_AS: "agent.cmd" });
    expect(await resolveWindowsCursorShim(shim, data)).toContain("2026.11.14-cccc");
  });
  it("refuses same-date ambiguity and pending promotion", async () => {
    await release("2026.11.13-bbbb");
    await release("2026.11.13-08-01-00-cccc");
    await expect(resolveWindowsCursorShim(shim, data)).rejects.toMatchObject({ issue: "ambiguous" });
    await mkdir(path.join(root, "versions", "2026.11.14-cccc.new"));
    await expect(resolveWindowsCursorShim(shim, data)).rejects.toMatchObject({ issue: "pending" });
  });
  it.skipIf(process.platform === "win32")("rejects a redirected entrypoint and foreign alias", async () => {
    const folder = await release("2026.11.13-bbbb");
    const pinned = await resolveWindowsCursorShim(shim, data);
    await rm(path.join(folder, "index.js"));
    await symlink(shim, path.join(folder, "index.js"));
    await expect(resolveWindowsCursorShim(shim, data)).rejects.toMatchObject({ issue: "unsupported" });
    expect(() => cursorLaunchTarget(pinned, [], undefined, { platform: "win32", localAppData: data }))
      .toThrow(/could not be verified/);
    await expect(resolveWindowsCursorShim(path.join(data, "agent.cmd"), data)).rejects.toMatchObject({ issue: "unsupported" });
  });
});
