import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createManifestRegistry } from "./manifests";
import { executeCompletion } from "./executor";

const fakeCursor = fileURLToPath(new URL("./fixtures/fake-cursor.cjs", import.meta.url));
const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function cursorManifest() {
  return createManifestRegistry().get("cursor_subscription")!;
}

function fakeCursorExecutor(env: NodeJS.ProcessEnv = process.env) {
  return {
    env,
    resolveExecutable: async () => fakeCursor
  };
}

describe("cursor subscription executor", () => {
  it("executes certified cursor manifest through open-design-style ephemeral workspace mode", async () => {
    const result = await executeCompletion(
      cursorManifest(),
      {
        requestId: crypto.randomUUID(),
        backendId: "cursor_subscription",
        taskType: "generate_tree",
        schemaId: "connection-test-v1",
        input: { probe: true }
      },
      new AbortController().signal,
      fakeCursorExecutor()
    );
    expect(result.schemaValid).toBe(true);
    expect(result.output).toMatchObject({ ok: true });
  });

  it("returns schema-valid generate-tree output from stream-json fake", async () => {
    const result = await executeCompletion(
      cursorManifest(),
      {
        requestId: crypto.randomUUID(),
        backendId: "cursor_subscription",
        taskType: "generate_tree",
        schemaId: "generate-tree-v1",
        input: { prompt: "Build a tree" }
      },
      new AbortController().signal,
      fakeCursorExecutor()
    );
    expect(result.schemaValid).toBe(true);
    expect(result.output).toMatchObject({ projectTitle: "Fake Cursor tree", rootNodeId: "root" });
  });

  it("resolves from schema-valid Cursor stream output before a slow process close", async () => {
    const startedAt = Date.now();
    const result = await executeCompletion(
      cursorManifest(),
      {
        requestId: crypto.randomUUID(),
        backendId: "cursor_subscription",
        taskType: "generate_tree",
        schemaId: "generate-tree-v1",
        input: { prompt: "Build a tree" },
        timeoutMs: 2_000
      },
      new AbortController().signal,
      fakeCursorExecutor({ ...process.env, VDT_FAKE_CURSOR_MODE: "result-then-slow" })
    );
    expect(Date.now() - startedAt).toBeLessThan(1_500);
    expect(result.schemaValid).toBe(true);
    expect(result.output).toMatchObject({ projectTitle: "Fake Cursor tree", rootNodeId: "root" });
  });

  it("fails schema validation for bad-schema fake mode", async () => {
    await expect(
      executeCompletion(
        cursorManifest(),
        {
          requestId: crypto.randomUUID(),
          backendId: "cursor_subscription",
          taskType: "generate_tree",
          schemaId: "generate-tree-v1",
          input: {}
        },
        new AbortController().signal,
        fakeCursorExecutor({ ...process.env, VDT_FAKE_CURSOR_MODE: "bad-schema" })
      )
    ).rejects.toMatchObject({ code: "SCHEMA_INVALID" });
  });

  it("repairs one invalid cursor schema response", async () => {
    const result = await executeCompletion(
      cursorManifest(),
      {
        requestId: crypto.randomUUID(),
        backendId: "cursor_subscription",
        taskType: "generate_tree",
        schemaId: "generate-tree-v1",
        input: { prompt: "Build a tree", businessContext: "repair-secret" }
      },
      new AbortController().signal,
      fakeCursorExecutor({ ...process.env, VDT_FAKE_CURSOR_MODE: "repairable" })
    );

    expect(result.schemaValid).toBe(true);
    expect(result.repaired).toBe(true);
    expect(result.output).toMatchObject({ projectTitle: "Fake Cursor tree", rootNodeId: "root" });
  });

  it("cancels slow fake cursor runs", async () => {
    const controller = new AbortController();
    const tempRoot = await makeTempDir("vdt-cursor-cancel-");
    const completion = executeCompletion(
      cursorManifest(),
      {
        requestId: crypto.randomUUID(),
        backendId: "cursor_subscription",
        taskType: "generate_tree",
        schemaId: "generate-tree-v1",
        input: {}
      },
      controller.signal,
      { ...fakeCursorExecutor({ ...process.env, VDT_FAKE_CURSOR_MODE: "slow" }), tempRoot }
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    controller.abort();
    await expect(completion).rejects.toMatchObject({ code: "CANCELLED" });
    expect(await import("node:fs/promises").then((fs) => fs.readdir(tempRoot))).toEqual([]);
  });

  it("does not forward unrelated file-path environment to cursor", async () => {
    const tempRoot = await makeTempDir("vdt-cursor-honey-");
    const repoDir = await makeTempDir("vdt-cursor-repo-");
    const honeyPath = path.join(repoDir, "honey.txt");
    await writeFile(honeyPath, "secret", { encoding: "utf8", mode: 0o600 });

    const result = await executeCompletion(
      cursorManifest(),
      {
        requestId: crypto.randomUUID(),
        backendId: "cursor_subscription",
        taskType: "generate_tree",
        schemaId: "connection-test-v1",
        input: { probe: true }
      },
      new AbortController().signal,
      {
        tempRoot,
        env: { ...process.env, VDT_FAKE_CURSOR_MODE: "honey-read", HONEY_PATH: honeyPath },
        resolveExecutable: async () => fakeCursor
      }
    );
    expect(result.output).toMatchObject({ ok: true });
    expect(JSON.stringify(result.output)).not.toContain("secret");
    expect(JSON.stringify(result.output)).not.toContain("leaked");
  }, 30_000);
});
