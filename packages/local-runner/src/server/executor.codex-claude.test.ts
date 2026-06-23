import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createManifestRegistry } from "./manifests";
import { executeCompletion } from "./executor";

const fakeCodex = fileURLToPath(new URL("./fixtures/fake-codex.cjs", import.meta.url));
const fakeClaude = fileURLToPath(new URL("./fixtures/fake-claude.cjs", import.meta.url));
const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function codexManifest() {
  return createManifestRegistry().get("codex_subscription")!;
}

function claudeManifest() {
  return createManifestRegistry().get("claude_subscription")!;
}

function fakeCodexExecutor(env: NodeJS.ProcessEnv = process.env) {
  return { env, resolveExecutable: async () => fakeCodex };
}

function fakeClaudeExecutor(env: NodeJS.ProcessEnv = process.env) {
  return { env, resolveExecutable: async () => fakeClaude };
}

describe("codex subscription executor", () => {
  it("executes certified codex manifest through adapter parseOutput", async () => {
    const result = await executeCompletion(
      codexManifest(),
      {
        requestId: crypto.randomUUID(),
        backendId: "codex_subscription",
        taskType: "generate_tree",
        schemaId: "connection-test-v1",
        input: { probe: true }
      },
      new AbortController().signal,
      fakeCodexExecutor()
    );
    expect(result.schemaValid).toBe(true);
    expect(result.output).toMatchObject({ ok: true });
  });

  it("returns schema-valid generate-tree output from fake codex JSONL", async () => {
    const result = await executeCompletion(
      codexManifest(),
      {
        requestId: crypto.randomUUID(),
        backendId: "codex_subscription",
        taskType: "generate_tree",
        schemaId: "generate-tree-v1",
        input: { prompt: "Build a tree", businessContext: "repair-secret" }
      },
      new AbortController().signal,
      fakeCodexExecutor()
    );
    expect(result.schemaValid).toBe(true);
    expect(result.output).toMatchObject({ projectTitle: "Fake Codex tree", rootNodeId: "root" });
  });

  it("fails schema validation for bad-schema fake mode", async () => {
    await expect(
      executeCompletion(
        codexManifest(),
        {
          requestId: crypto.randomUUID(),
          backendId: "codex_subscription",
          taskType: "generate_tree",
          schemaId: "generate-tree-v1",
          input: {}
        },
        new AbortController().signal,
        fakeCodexExecutor({ ...process.env, VDT_FAKE_CODEX_MODE: "bad-schema" })
      )
    ).rejects.toMatchObject({ code: "SCHEMA_INVALID" });
  });

  it("repairs one invalid codex schema response", async () => {
    const result = await executeCompletion(
      codexManifest(),
      {
        requestId: crypto.randomUUID(),
        backendId: "codex_subscription",
        taskType: "generate_tree",
        schemaId: "generate-tree-v1",
        input: { prompt: "Build a tree", businessContext: "repair-secret" }
      },
      new AbortController().signal,
      fakeCodexExecutor({ ...process.env, VDT_FAKE_CODEX_MODE: "repairable" })
    );

    expect(result.schemaValid).toBe(true);
    expect(result.repaired).toBe(true);
    expect(result.output).toMatchObject({ projectTitle: "Fake Codex tree", rootNodeId: "root" });
  });

  it("cancels slow fake codex runs", async () => {
    const controller = new AbortController();
    const tempRoot = await makeTempDir("vdt-codex-cancel-");
    const completion = executeCompletion(
      codexManifest(),
      {
        requestId: crypto.randomUUID(),
        backendId: "codex_subscription",
        taskType: "generate_tree",
        schemaId: "generate-tree-v1",
        input: {}
      },
      controller.signal,
      { ...fakeCodexExecutor({ ...process.env, VDT_FAKE_CODEX_MODE: "slow" }), tempRoot }
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    controller.abort();
    await expect(completion).rejects.toMatchObject({ code: "CANCELLED" });
  });
});

describe("claude subscription executor", () => {
  it("executes certified claude manifest through adapter parseOutput", async () => {
    const result = await executeCompletion(
      claudeManifest(),
      {
        requestId: crypto.randomUUID(),
        backendId: "claude_subscription",
        taskType: "generate_tree",
        schemaId: "connection-test-v1",
        input: { probe: true }
      },
      new AbortController().signal,
      fakeClaudeExecutor()
    );
    expect(result.schemaValid).toBe(true);
    expect(result.output).toMatchObject({ ok: true });
  });

  it("returns schema-valid generate-tree output from fake claude JSON", async () => {
    const result = await executeCompletion(
      claudeManifest(),
      {
        requestId: crypto.randomUUID(),
        backendId: "claude_subscription",
        taskType: "generate_tree",
        schemaId: "generate-tree-v1",
        input: { prompt: "Build a tree", businessContext: "repair-secret" }
      },
      new AbortController().signal,
      fakeClaudeExecutor()
    );
    expect(result.schemaValid).toBe(true);
    expect(result.output).toMatchObject({ projectTitle: "Fake Claude tree", rootNodeId: "root" });
  });

  it("fails schema validation for bad-schema fake mode", async () => {
    await expect(
      executeCompletion(
        claudeManifest(),
        {
          requestId: crypto.randomUUID(),
          backendId: "claude_subscription",
          taskType: "generate_tree",
          schemaId: "generate-tree-v1",
          input: {}
        },
        new AbortController().signal,
        fakeClaudeExecutor({ ...process.env, VDT_FAKE_CLAUDE_MODE: "bad-schema" })
      )
    ).rejects.toMatchObject({ code: "SCHEMA_INVALID" });
  });

  it("repairs one invalid claude schema response", async () => {
    const result = await executeCompletion(
      claudeManifest(),
      {
        requestId: crypto.randomUUID(),
        backendId: "claude_subscription",
        taskType: "generate_tree",
        schemaId: "generate-tree-v1",
        input: { prompt: "Build a tree", businessContext: "repair-secret" }
      },
      new AbortController().signal,
      fakeClaudeExecutor({ ...process.env, VDT_FAKE_CLAUDE_MODE: "repairable" })
    );

    expect(result.schemaValid).toBe(true);
    expect(result.repaired).toBe(true);
    expect(result.output).toMatchObject({ projectTitle: "Fake Claude tree", rootNodeId: "root" });
  });

  it("cancels slow fake claude runs", async () => {
    const controller = new AbortController();
    const tempRoot = await makeTempDir("vdt-claude-cancel-");
    const completion = executeCompletion(
      claudeManifest(),
      {
        requestId: crypto.randomUUID(),
        backendId: "claude_subscription",
        taskType: "generate_tree",
        schemaId: "generate-tree-v1",
        input: {}
      },
      controller.signal,
      { ...fakeClaudeExecutor({ ...process.env, VDT_FAKE_CLAUDE_MODE: "slow" }), tempRoot }
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    controller.abort();
    await expect(completion).rejects.toMatchObject({ code: "CANCELLED" });
  });
});
