import { fileURLToPath } from "node:url";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalRuntimeContext } from "../server/runtime";
import { SidecarHostError, SidecarProcessHost } from "./host";
import { SIDECAR_PROTOCOL_VERSION } from "./protocol";
import { handleSidecarCancel, handleSidecarRequest } from "./runtime";

const sidecarEntrypoint = fileURLToPath(new URL("./index.ts", import.meta.url));
const fakeCodex = fileURLToPath(new URL("../server/fixtures/fake-codex.cjs", import.meta.url));
const fakeCursor = fileURLToPath(new URL("../server/fixtures/fake-cursor.cjs", import.meta.url));
const TEST_HANDSHAKE_TIMEOUT_MS = 5000;
const hosts: SidecarProcessHost[] = [];

function createRuntimeHost() {
  const host = new SidecarProcessHost({
    command: process.execPath,
    args: ["--import", "tsx", sidecarEntrypoint],
    env: { ...process.env },
    handshakeTimeoutMs: TEST_HANDSHAKE_TIMEOUT_MS
  });
  hosts.push(host);
  return host;
}

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.stop()));
});

describe("local runtime sidecar", () => {
  it("starts, handshakes, and lists runtime backends without HTTP pairing", async () => {
    const host = createRuntimeHost();
    await host.start();
    const payload = await host.request("list_backends");
    expect(payload).toMatchObject({ ok: true, backends: expect.arrayContaining([expect.objectContaining({ id: "mock" })]) });
    expect(JSON.stringify(payload)).not.toContain("executableAliases");
  });

  it("runs mock completion through the sidecar protocol", async () => {
    const host = createRuntimeHost();
    const payload = await host.request("complete", {
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
    expect(payload).toMatchObject({ ok: true, run: { status: "succeeded" }, output: { projectTitle: "Mock tree" } });
  });

  it("propagates runtime errors as structured failed responses", async () => {
    const host = createRuntimeHost();
    await expect(host.request("test_backend", { backendId: "not_a_backend" })).rejects.toMatchObject({
      code: "SIDECAR_REQUEST_FAILED",
      message: "UNKNOWN_BACKEND: Unknown backendId."
    });
  });

  it("returns provider authentication instructions through the sidecar protocol", async () => {
    const host = createRuntimeHost();
    await expect(host.request("open_provider_auth", { backendId: "claude_subscription" })).resolves.toMatchObject({
      ok: true,
      backendId: "claude_subscription",
      action: "instructions",
      label: "Claude Code authentication",
      docsUrl: "https://docs.anthropic.com/en/docs/claude-code"
    });
  });

  it("routes model listing through the runtime adapters", async () => {
    const context = createLocalRuntimeContext({
      auditSink: () => undefined,
      executor: { resolveExecutable: async () => fakeCodex }
    });
    await expect(handleSidecarRequest({
      protocolVersion: SIDECAR_PROTOCOL_VERSION,
      type: "request",
      requestId: crypto.randomUUID(),
      method: "list_models",
      payload: { backendId: "codex_subscription" }
    }, context)).resolves.toMatchObject({
      ok: true,
      payload: { ok: true, backendId: "codex_subscription", models: ["gpt-5.5", "gpt-5.2"] }
    });
  });

  it("routes subscription CLI detection through the sidecar protocol", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "vdt-sidecar-detect-"));
    try {
      await symlink(fakeCodex, path.join(tempDir, "codex"));
      await symlink(fakeCursor, path.join(tempDir, "agent"));
      const context = createLocalRuntimeContext({
        auditSink: () => undefined,
        detection: { path: tempDir, probeTimeoutMs: 5_000 }
      });

      await expect(handleSidecarRequest({
        protocolVersion: SIDECAR_PROTOCOL_VERSION,
        type: "request",
        requestId: crypto.randomUUID(),
        method: "detect_clis",
        payload: { agentId: "cursor-agent" }
      }, context)).resolves.toMatchObject({
        ok: true,
        payload: {
          ok: true,
          agents: [
            expect.objectContaining({
              id: "cursor-agent",
              installed: true,
              alias: "agent",
              status: "ready"
            })
          ],
          modelsByAgent: { "cursor-agent": ["auto", "gpt-5.5-high"] }
        }
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("cancels an active sidecar runtime completion request", async () => {
    let abortHandler: (() => void) | undefined;
    let fetchStarted: (() => void) | undefined;
    const fetchStartedPromise = new Promise<void>((resolve) => {
      fetchStarted = resolve;
    });
    const context = createLocalRuntimeContext({
      auditSink: () => undefined,
      executor: {
        fetch: async (_url, init) => {
          fetchStarted?.();
          await new Promise((_resolve, reject) => {
            abortHandler = () => reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
            init?.signal?.addEventListener("abort", abortHandler, { once: true });
          });
          throw new Error("Expected abort before local HTTP response.");
        }
      }
    });
    const requestId = crypto.randomUUID();
    const response = handleSidecarRequest({
      protocolVersion: SIDECAR_PROTOCOL_VERSION,
      type: "request",
      requestId,
      method: "complete",
      payload: {
        backendId: "ollama",
        taskType: "generate_tree",
        schemaId: "generate-tree-v1",
        input: { projectTitle: "Tree", rootNodeId: "root", nodes: [{}], edges: [], assumptions: [], questionsForUser: [], warnings: [] },
        timeoutMs: 1000
      }
    }, context);

    await fetchStartedPromise;
    handleSidecarCancel({ protocolVersion: SIDECAR_PROTOCOL_VERSION, type: "cancel", requestId }, context);
    expect(abortHandler).toBeDefined();
    await expect(response).resolves.toMatchObject({
      ok: false,
      error: { code: "CANCELLED", message: "Completion was cancelled." }
    });
  });

  it("rejects malformed stdout protocol by failing the host", async () => {
    const host = new SidecarProcessHost({
      command: process.execPath,
      args: ["-e", "process.stdout.write('log on stdout\\n')"],
      handshakeTimeoutMs: TEST_HANDSHAKE_TIMEOUT_MS
    });
    hosts.push(host);
    await expect(host.start()).rejects.toBeInstanceOf(SidecarHostError);
  });
});
