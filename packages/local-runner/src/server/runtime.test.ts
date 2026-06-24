import { describe, expect, it } from "vitest";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AuditEvent } from "../cli/types";
import {
  createLocalRuntimeContext,
  completeRuntime,
  getRuntimeRun,
  listRuntimeBackends,
  listRuntimeModels,
  openRuntimeProviderAuth,
  parseCompletionPayload
} from "./runtime";

const fakeCodex = fileURLToPath(new URL("./fixtures/fake-codex.cjs", import.meta.url));
const fakeCursor = fileURLToPath(new URL("./fixtures/fake-cursor.cjs", import.meta.url));

describe("local runtime contract", () => {
  it("lists public manifests without executable details", () => {
    const context = createLocalRuntimeContext({ auditSink: () => undefined });
    const result = listRuntimeBackends(context);
    expect(result.statusCode).toBe(200);
    expect(result.payload).toMatchObject({ ok: true });
    expect(JSON.stringify(result.payload)).toContain("\"id\":\"mock\"");
    expect(result.payload).toMatchObject({
      backends: expect.arrayContaining([
        expect.objectContaining({ id: "mock", backendId: "mock", mode: "local_http", status: "available" }),
        expect.objectContaining({ id: "codex_subscription", backendId: "codex_subscription", mode: "subscription_cli" })
      ])
    });
    expect(JSON.stringify(result.payload)).not.toContain("executableAliases");
  });

  it("returns provider-owned authentication instructions for subscription backends", () => {
    const context = createLocalRuntimeContext({ auditSink: () => undefined });
    const result = openRuntimeProviderAuth("codex_subscription", context);

    expect(result.statusCode).toBe(200);
    expect(result.payload).toMatchObject({
      ok: true,
      backendId: "codex_subscription",
      action: "instructions",
      label: "Codex CLI authentication",
      docsUrl: "https://developers.openai.com/codex/cli"
    });
    expect(JSON.stringify(result.payload)).not.toContain("command");
  });

  it("lists subscription CLI models through provider adapters", async () => {
    const context = createLocalRuntimeContext({
      auditSink: () => undefined,
      executor: {
        resolveExecutable: async (manifest) => manifest.id === "cursor_subscription" ? fakeCursor : fakeCodex
      }
    });

    await expect(listRuntimeModels("codex_subscription", context)).resolves.toMatchObject({
      statusCode: 200,
      payload: { ok: true, backendId: "codex_subscription", models: ["gpt-5.5", "gpt-5.2"] }
    });
    await expect(listRuntimeModels("cursor_subscription", context)).resolves.toMatchObject({
      statusCode: 200,
      payload: { ok: true, backendId: "cursor_subscription", models: ["auto", "gpt-5.5-high"] }
    });
  });

  it("canonicalizes symlinked provider executables before adapter execution", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "vdt-symlink-provider-"));
    try {
      const codexLink = path.join(tempDir, "codex");
      await symlink(fakeCodex, codexLink);
      const context = createLocalRuntimeContext({
        auditSink: () => undefined,
        executor: { resolveExecutable: async () => codexLink }
      });

      await expect(listRuntimeModels("codex_subscription", context)).resolves.toMatchObject({
        statusCode: 200,
        payload: { ok: true, backendId: "codex_subscription", models: ["gpt-5.5", "gpt-5.2"] }
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects provider authentication actions for local model backends", () => {
    const context = createLocalRuntimeContext({ auditSink: () => undefined });

    expect(() => openRuntimeProviderAuth("ollama", context)).toThrow("Provider authentication is only available");
  });

  it("runs mock completion outside the HTTP transport and records the run", async () => {
    const context = createLocalRuntimeContext({ auditSink: () => undefined });
    const request = parseCompletionPayload({
      requestId: crypto.randomUUID(),
      backendId: "mock",
      taskType: "generate_tree",
      schemaId: "generate-tree-v1",
      input: {
        projectTitle: "Tree",
        rootNodeId: "root",
        nodes: [{ id: "root", name: "Root", type: "root_kpi" }],
        edges: [],
        assumptions: [],
        questionsForUser: [],
        warnings: []
      }
    });

    const result = await completeRuntime(request, context);
    expect(result.statusCode).toBe(200);
    expect(result.payload).toMatchObject({ ok: true, run: { requestId: request.requestId, status: "succeeded" } });

    const stored = getRuntimeRun(request.requestId, context);
    expect(stored.payload).toMatchObject({ ok: true, run: { requestId: request.requestId, status: "succeeded" } });
  });

  it("records failed repair attempts in audit metadata and run snapshots", async () => {
    const audit: AuditEvent[] = [];
    let calls = 0;
    const context = createLocalRuntimeContext({
      auditSink: (event) => audit.push(event),
      executor: {
        fetch: async () => {
          calls += 1;
          return new Response(
            JSON.stringify({ choices: [{ message: { content: JSON.stringify({ invalid: true }) } }] }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
      }
    });
    const request = parseCompletionPayload({
      requestId: crypto.randomUUID(),
      backendId: "ollama",
      taskType: "generate_tree",
      schemaId: "generate-tree-v1",
      input: { prompt: "Build a tree" }
    });

    const result = await completeRuntime(request, context);

    expect(calls).toBe(2);
    expect(result.statusCode).toBe(502);
    expect(result.payload).toMatchObject({
      ok: false,
      run: { status: "failed", repairAttempted: true, repairSucceeded: false },
      error: { code: "SCHEMA_INVALID" }
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      errorCode: "SCHEMA_INVALID",
      repairAttempted: true,
      repairSucceeded: false,
      schemaValid: false
    });
  });

  it("rejects browser-selected executable fields before execution", () => {
    expect(() => parseCompletionPayload({
      requestId: crypto.randomUUID(),
      backendId: "mock",
      taskType: "generate_tree",
      schemaId: "generate-tree-v1",
      input: {},
      args: ["--unsafe"]
    })).toThrow("Completion body must not include args.");
  });
});
