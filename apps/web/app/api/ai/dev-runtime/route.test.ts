import { chmod, copyFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalRuntimeContext } from "@vdt-studio/local-runner/server-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const fakeCodex = fileURLToPath(new URL("../../../../../../packages/local-runner/src/server/fixtures/fake-codex.cjs", import.meta.url));

function request(body: unknown) {
  return new Request("http://localhost:3000/api/ai/dev-runtime", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function readJson(response: Response) {
  return await response.json() as {
    ok?: boolean;
    error?: string | { code?: string; message?: string };
    backendId?: string;
    models?: string[];
    run?: {
      requestId?: string;
      status?: string;
      progress?: { phase?: string; label?: string };
    };
  };
}

describe("development local runtime API route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete (globalThis as typeof globalThis & { __vdtStudioDevelopmentRuntime?: unknown }).__vdtStudioDevelopmentRuntime;
  });

  it("is not available outside development_web mode", async () => {
    vi.stubEnv("VDT_APP_MODE", "hosted_web");

    const response = await POST(request({ operation: "test", backendId: "codex_subscription" }));
    const body = await readJson(response);

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
  });

  it("allows localhost production builds through the development runtime mode gate", async () => {
    vi.stubEnv("VDT_APP_MODE", undefined);
    vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", undefined);
    vi.stubEnv("NODE_ENV", "production");

    const response = await POST(request({}));
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Unsupported operation: (missing)");
  });

  it("tests a subscription backend through the managed runtime without pairing", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "vdt-dev-runtime-"));
    try {
      const fakeCodexExecutable = path.join(tempDir, "codex");
      await copyFile(fakeCodex, fakeCodexExecutable);
      await chmod(fakeCodexExecutable, 0o700);
      vi.stubEnv("VDT_APP_MODE", "development_web");
      vi.stubEnv("PATH", `${tempDir}${path.delimiter}${process.env.PATH ?? ""}`);

      const response = await POST(request({ operation: "test", backendId: "codex_subscription" }));
      const body = await readJson(response);

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("lists local HTTP models through the managed runtime", async () => {
    vi.stubEnv("VDT_APP_MODE", "development_web");
    (globalThis as typeof globalThis & { __vdtStudioDevelopmentRuntime?: unknown }).__vdtStudioDevelopmentRuntime =
      createLocalRuntimeContext({
        executor: {
          fetch: async () =>
            new Response(JSON.stringify({ data: [{ id: "qwen3:latest" }] }), {
              status: 200,
              headers: { "content-type": "application/json" }
            })
        }
      });

    const response = await POST(request({ operation: "list_models", backendId: "ollama" }));
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.backendId).toBe("ollama");
    expect(body.models).toEqual(["qwen3:latest"]);
  });

  it("returns run progress snapshots for polling clients", async () => {
    vi.stubEnv("VDT_APP_MODE", "development_web");
    const requestId = crypto.randomUUID();
    const input = {
      projectTitle: "Tree",
      rootNodeId: "root",
      nodes: [{ id: "root", name: "Root", type: "root_kpi" }],
      edges: [],
      assumptions: [],
      questionsForUser: [],
      warnings: []
    };

    const completeResponse = await POST(request({
      operation: "complete",
      request: {
        requestId,
        backendId: "mock",
        taskType: "generate_tree",
        schemaId: "generate-tree-v1",
        input
      }
    }));
    const completeBody = await readJson(completeResponse);
    expect(completeResponse.status).toBe(200);
    expect(completeBody.run).toMatchObject({
      requestId,
      status: "succeeded",
      progress: { phase: "complete", label: "Complete" }
    });

    const runResponse = await POST(request({ operation: "run", requestId }));
    const runBody = await readJson(runResponse);
    expect(runResponse.status).toBe(200);
    expect(runBody.run).toMatchObject({
      requestId,
      status: "succeeded",
      progress: { phase: "complete", label: "Complete" }
    });
  });
});
