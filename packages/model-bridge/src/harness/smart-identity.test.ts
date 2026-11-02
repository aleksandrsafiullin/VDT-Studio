import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveSmartHarnessIdentity } from "./smart-identity";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
describe.skipIf(process.platform === "win32")("Smart native Claude metadata matches execution admission", () => {
  it("offers Off only for a compatible model on a verified direct account without performing inference", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "vdt-claude-smart-capabilities-")); directories.push(directory);
    const log = path.join(directory, "calls.jsonl"), auth = path.join(directory, "auth-method");
    await writeFile(auth, "claude.ai");
    await writeFile(path.join(directory, "claude"), `#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n');if(args.includes('--version'))console.log('Claude Code 2.1.310');else if(args.join(' ')==='auth status')console.log(JSON.stringify({authMethod:fs.readFileSync(${JSON.stringify(auth)},'utf8')}));else process.exit(91);`, { mode: 0o700 });
    const env = { PATH: directory, HOME: directory, NODE_ENV: "test" };
    const resolve = (model = "claude-sonnet-4-6", reasoning?: boolean) => resolveSmartHarnessIdentity("claude_subscription", model, AbortSignal.timeout(2000), env, reasoning);
    expect((await resolve()).reasoningValues).toEqual([false]);
    expect((await resolve("claude-sonnet-4-6", false)).reasoningValues).toEqual([false]);
    expect((await resolve("claude-sonnet-5-5")).reasoningValues).toEqual([]);
    await writeFile(auth, "third_party");
    expect((await resolve()).reasoningValues).toEqual([]);
    await expect(resolve("claude-sonnet-4-6", false)).rejects.toMatchObject({ code: "REASONING_UNSUPPORTED" });
    const calls = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    expect(calls).toHaveLength(10);
    expect(calls.every(args => args.join(" ") === "--version" || args.join(" ") === "auth status")).toBe(true);
  });
});
