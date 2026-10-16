import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { detectSubscriptionCli } from "@vdt-studio/model-bridge/node";
import { executeCompletion, listBackendModels } from "./executor";
import { createManifestRegistry } from "./manifests";

const fakeCodex = fileURLToPath(new URL("./fixtures/fake-codex.cjs", import.meta.url));
const directories: string[] = [];

async function installations() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "vdt-codex-path-consistency-"));
  const root = await realpath(temporary);
  directories.push(root);
  const source = await readFile(fakeCodex, "utf8");
  const old = path.join(root, "old", "codex");
  const current = path.join(root, "current", "codex");
  await mkdir(path.dirname(old));
  await mkdir(path.dirname(current));
  await writeFile(old, source.replace("codex-cli 0.128.0", "codex-cli 0.146.0").replaceAll("gpt-5.5", "gpt-5.6-sol"), { mode: 0o700 });
  await writeFile(current, source.replace("codex-cli 0.128.0", "codex-cli 0.162.0-alpha.17.2").replaceAll("gpt-5.5", "gpt-6.1-sol"), { mode: 0o700 });
  return { old, current, env: { PATH: [path.dirname(old), path.dirname(current), path.dirname(process.execPath)].join(path.delimiter), HOME: root } };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe.skipIf(process.platform === "win32")("Codex selection across detection, model discovery and execution", () => {
  it("uses the newer later-on-PATH installation for all three operations", async () => {
    const { old, current, env } = await installations();
    const manifest = createManifestRegistry().get("codex_subscription")!;
    expect((await detectSubscriptionCli("codex", { path: env.PATH })).executable).toBe(current);
    const models = await listBackendModels(manifest, new AbortController().signal, { env });
    expect(models).toContain("gpt-6.1-sol");
    expect(models).not.toContain("gpt-5.6-sol");
    const spawned: string[] = [];
    const result = await executeCompletion(manifest, {
      requestId: crypto.randomUUID(), backendId: manifest.id, taskType: "generate_tree",
      schemaId: "connection-test-v1", input: { probe: true }
    }, new AbortController().signal, {
      env,
      spawn: (command, args, options) => {
        spawned.push(command);
        return spawn(command, [...args], options) as ChildProcessWithoutNullStreams;
      }
    });
    expect(result.output).toEqual({ ok: true });
    expect(spawned).toEqual([current]);
    expect(spawned).not.toContain(old);
  });

  it("keeps an explicitly injected host resolver authoritative", async () => {
    const { old, env } = await installations();
    const models = await listBackendModels(createManifestRegistry().get("codex_subscription")!, new AbortController().signal, {
      env, resolveExecutable: async () => old
    });
    expect(models).toContain("gpt-5.6-sol");
    expect(models).not.toContain("gpt-6.1-sol");
  });
});
