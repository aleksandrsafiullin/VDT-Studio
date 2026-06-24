import { request as httpRequest, type Server } from "node:http";
import { spawnSync } from "node:child_process";
import { lstat, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { AuditEvent, BackendManifest } from "../cli/types";
import { schemaTasks, VDT_SCHEMA_IDS } from "@vdt-studio/model-bridge";
import { createLocalRunnerServer, getRunnerPairingInfo, type LocalRunnerServer } from "./app";

const origin = "http://127.0.0.1:3000";
const servers: Server[] = [];
const fixture = fileURLToPath(new URL("./fixtures/fake-backend.mjs", import.meta.url));
const fakeCursor = fileURLToPath(new URL("./fixtures/fake-cursor.cjs", import.meta.url));
const fakeCodex = fileURLToPath(new URL("./fixtures/fake-codex.cjs", import.meta.url));
const fakeClaude = fileURLToPath(new URL("./fixtures/fake-claude.cjs", import.meta.url));

function isLoopbackAvailable(): boolean {
  const script = [
    "const net = require('node:net');",
    "const server = net.createServer();",
    "const timeout = setTimeout(() => process.exit(2), 1500);",
    "server.once('error', () => process.exit(1));",
    "server.listen(0, '127.0.0.1', () => {",
    "  server.close(() => { clearTimeout(timeout); process.exit(0); });",
    "});"
  ].join("\n");
  return spawnSync(process.execPath, ["-e", script], { stdio: "ignore", timeout: 2_500 }).status === 0;
}

const hasLoopback = isLoopbackAvailable();

async function start(options: Parameters<typeof createLocalRunnerServer>[0] = { host: "127.0.0.1", port: 0 }) {
  const server = createLocalRunnerServer({ ...options, auditSink: options.auditSink ?? (() => undefined) });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
  servers.push(server);
  return server;
}

async function call(
  server: Server,
  path: string,
  options: { method?: string; body?: unknown; token?: string; origin?: string; headers?: Record<string, string> } = {}
) {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server has no TCP address.");
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  return new Promise<{ status: number; body: any; headers: Record<string, string | string[] | undefined> }>((resolve, reject) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port: address.port,
      path,
      method: options.method ?? "GET",
      headers: {
        ...(options.origin === "omit" ? {} : { origin: options.origin ?? origin }),
        ...(body === undefined ? {} : { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) }),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...options.headers
      }
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve({ status: response.statusCode ?? 0, body: raw ? JSON.parse(raw) : undefined, headers: response.headers });
      });
    });
    request.once("error", reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

async function pair(server: LocalRunnerServer) {
  const code = getRunnerPairingInfo(server).code;
  const response = await call(server, "/v1/pair", { method: "POST", body: { code } });
  expect(response.status).toBe(200);
  return response.body.session.token as string;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe.skipIf(!hasLoopback)("Phase 2 transport and pairing", () => {
  it("refuses non-loopback binding", () => {
    expect(() => createLocalRunnerServer({ host: "0.0.0.0", port: 8765 })).toThrow("127.0.0.1");
  });

  it("exposes only public health before pairing", async () => {
    const server = await start();
    expect((await call(server, "/v1/health", { origin: "omit" })).body).toMatchObject({ ok: true, pairingRequired: true });
    const protectedResponse = await call(server, "/v1/backends");
    expect(protectedResponse.status).toBe(401);
    expect(protectedResponse.body.error.code).toBe("PAIRING_REQUIRED");
  });

  it("pairs once, returns a high-entropy token, and unpairs it", async () => {
    const server = await start({ host: "127.0.0.1", port: 0, pairing: { pairingCode: "123456" } });
    const invalid = await call(server, "/v1/pair", { method: "POST", body: { code: "000000" } });
    expect(invalid.status).toBe(401);
    const paired = await call(server, "/v1/pair", { method: "POST", body: { code: "123456" } });
    expect(paired.body.session.token.length).toBeGreaterThanOrEqual(40);
    const token = paired.body.session.token as string;
    expect((await call(server, "/v1/backends", { token })).status).toBe(200);
    expect((await call(server, "/v1/unpair", { method: "POST", body: {}, token })).status).toBe(200);
    expect((await call(server, "/v1/backends", { token })).status).toBe(401);
  });

  it("rate limits pairing attempts and expires codes", async () => {
    const limited = await start({ host: "127.0.0.1", port: 0, pairing: { pairingCode: "123456", maxAttempts: 1 } });
    await call(limited, "/v1/pair", { method: "POST", body: { code: "000000" } });
    expect((await call(limited, "/v1/pair", { method: "POST", body: { code: "123456" } })).body.error.code).toBe("PAIRING_RATE_LIMITED");

    let now = 0;
    const expired = await start({ host: "127.0.0.1", port: 0, pairing: { pairingCode: "123456", codeTtlMs: 1, now: () => now } });
    now = 2;
    expect((await call(expired, "/v1/pair", { method: "POST", body: { code: "123456" } })).body.error.code).toBe("PAIRING_CODE_EXPIRED");

    now = 0;
    const stale = await start({ host: "127.0.0.1", port: 0, pairing: { pairingCode: "123456", tokenTtlMs: 1, now: () => now } });
    const staleToken = await pair(stale);
    now = 2;
    expect((await call(stale, "/v1/backends", { token: staleToken })).body.error.code).toBe("PAIRING_REQUIRED");
  });

  it("enforces Origin, JSON content type, body limit, and CORS auth headers", async () => {
    const server = await start();
    const badOrigin = await call(server, "/v1/pair", { method: "POST", body: { code: "000000" }, origin: "https://evil.example" });
    expect(badOrigin.body.error.code).toBe("ORIGIN_NOT_ALLOWED");
    const missingOrigin = await call(server, "/v1/pair", { method: "POST", body: { code: "000000" }, origin: "omit" });
    expect(missingOrigin.body.error.code).toBe("ORIGIN_REQUIRED");
    const media = await call(server, "/v1/pair", { method: "POST", headers: { "content-type": "text/plain" } });
    expect(media.status).toBe(415);
    const large = await call(server, "/v1/pair", { method: "POST", body: { data: "x".repeat(2 * 1024 * 1024) } });
    expect(large.status).toBe(413);
    const preflight = await call(server, "/v1/pair", { method: "OPTIONS" });
    expect(preflight.headers["access-control-allow-headers"]).toContain("authorization");
    const badHost = await call(server, "/v1/health", { origin: "omit", headers: { host: "evil.example" } });
    expect(badHost.body.error.code).toBe("INVALID_HOST");
  });
});

describe.skipIf(!hasLoopback)("schema allowlist", () => {
  it.each(VDT_SCHEMA_IDS)("accepts mock completion for schema %s", async (schemaId) => {
    const server = await start();
    const token = await pair(server);
    const response = await call(server, "/v1/completions", {
      method: "POST",
      token,
      body: {
        requestId: crypto.randomUUID(),
        backendId: "mock",
        taskType: schemaTasks[schemaId],
        schemaId,
        input: {}
      }
    });
    expect(response.status).toBe(200);
    expect(response.body.run.status).toBe("succeeded");
    expect(response.body.output).toBeDefined();
  });

  it("rejects unknown schema ID", async () => {
    const server = await start();
    const token = await pair(server);
    const response = await call(server, "/v1/completions", {
      method: "POST",
      token,
      body: {
        requestId: crypto.randomUUID(),
        backendId: "mock",
        taskType: "generate_tree",
        schemaId: "not-a-registered-schema-v1",
        input: {}
      }
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_SCHEMA_ID");
  });

  it("rejects schema/task mismatch", async () => {
    const server = await start();
    const token = await pair(server);
    const response = await call(server, "/v1/completions", {
      method: "POST",
      token,
      body: {
        requestId: crypto.randomUUID(),
        backendId: "mock",
        taskType: "review_model",
        schemaId: "generate-tree-v1",
        input: {}
      }
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_SCHEMA_ID");
  });
});

describe.skipIf(!hasLoopback)("Phase 2 completion contract", () => {
  it("publishes manifests without executable names or arguments", async () => {
    const server = await start();
    const token = await pair(server);
    const response = await call(server, "/v1/backends", { token });
    expect(response.body.backends.length).toBeGreaterThan(3);
    expect(JSON.stringify(response.body)).not.toContain("executableAliases");
    expect(JSON.stringify(response.body)).not.toContain('"args"');
  });

  it("rejects browser-selected command, args, schema, env, and unknown fields", async () => {
    const server = await start();
    const token = await pair(server);
    for (const field of ["command", "args", "schema", "env", "providerConfig"]) {
      const response = await call(server, "/v1/completions", {
        method: "POST", token,
        body: { requestId: crypto.randomUUID(), backendId: "mock", taskType: "generate_tree", schemaId: "generate-tree-v1", input: {}, [field]: "forbidden" }
      });
      expect(response.body.error.code).toBe("FORBIDDEN_FIELD");
    }
    const oversizedPrompt = await call(server, "/v1/completions", {
      method: "POST", token,
      body: {
        requestId: crypto.randomUUID(), backendId: "mock", taskType: "generate_tree",
        schemaId: "generate-tree-v1", input: { prompt: "x".repeat(600 * 1024) }
      }
    });
    expect(oversizedPrompt.body.error.code).toBe("PROMPT_TOO_LARGE");
  });

  it("runs an approved mock request, records status, and emits redacted audit metadata", async () => {
    const audit: AuditEvent[] = [];
    const server = await start({ host: "127.0.0.1", port: 0, auditSink: (event) => audit.push(event) });
    const token = await pair(server);
    const requestId = crypto.randomUUID();
    const input = { projectTitle: "Tree", rootNodeId: "root", nodes: [{}], edges: [], assumptions: [], questionsForUser: [], warnings: [] };
    const response = await call(server, "/v1/completions", {
      method: "POST", token,
      body: { requestId, backendId: "mock", taskType: "generate_tree", schemaId: "generate-tree-v1", input }
    });
    expect(response.status).toBe(200);
    expect(response.body.run.status).toBe("succeeded");
    expect((await call(server, `/v1/runs/${requestId}`, { token })).body.run.output).toEqual(input);
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0])).not.toContain("projectTitle");
  });

  it("rejects duplicate request ids and uncertified subscription backends", async () => {
    const unsafeManifest: BackendManifest = {
      id: "unsafe_subscription",
      label: "Unsafe test backend",
      kind: "subscription_cli",
      supportLevel: "experimental",
      taskTypes: ["generate_tree"],
      schemaIds: ["connection-test-v1", "generate-tree-v1"],
      modelSelection: false,
      cli: { executableAliases: ["unsafe-test"], args: [], versionArgs: ["--version"] },
      safety: { toolsDisabled: false, requiresOsSandbox: true, certified: false }
    };
    const server = await start({ host: "127.0.0.1", port: 0, manifests: [unsafeManifest], executor: { resolveExecutable: async () => fixture } });
    const token = await pair(server);
    const requestId = crypto.randomUUID();
    const body = { requestId, backendId: "mock", taskType: "generate_tree", schemaId: "generate-tree-v1", input: { projectTitle: "x", rootNodeId: "r", nodes: [{}], edges: [], assumptions: [], questionsForUser: [], warnings: [] } };
    expect((await call(server, "/v1/completions", { method: "POST", token, body })).status).toBe(200);
    expect((await call(server, "/v1/completions", { method: "POST", token, body })).body.error.code).toBe("DUPLICATE_REQUEST_ID");

    const uncertified = await call(server, "/v1/backends/unsafe_subscription/test", { method: "POST", token, body: {} });
    expect(uncertified.body.error.code).toBe("UNSAFE_CONFIGURATION");
  });
});

describe.skipIf(!hasLoopback)("cursor subscription backend", () => {
  const cursorExecutor = {
    resolveExecutable: async (manifest: BackendManifest) =>
      manifest.id === "cursor_subscription" ? fakeCursor : process.execPath
  };

  it("runs certified cursor connection test with fake executable override", async () => {
    const server = await start({ host: "127.0.0.1", port: 0, executor: cursorExecutor });
    const token = await pair(server);
    const response = await call(server, "/v1/backends/cursor_subscription/test", { method: "POST", token, body: {} });
    expect(response.body.error?.code).not.toBe("UNSAFE_CONFIGURATION");
    expect(response.status).toBe(200);
    expect(response.body.output).toMatchObject({ ok: true });
  });

  it("completes generate-tree-v1 through cursor fake stream-json", async () => {
    const audit: AuditEvent[] = [];
    const server = await start({ host: "127.0.0.1", port: 0, executor: cursorExecutor, auditSink: (event) => audit.push(event) });
    const token = await pair(server);
    const requestId = crypto.randomUUID();
    const response = await call(server, "/v1/completions", {
      method: "POST",
      token,
      body: {
        requestId,
        backendId: "cursor_subscription",
        taskType: "generate_tree",
        schemaId: "generate-tree-v1",
        input: { prompt: "Build a tree" }
      }
    });
    expect(response.status).toBe(200);
    expect(response.body.run.status).toBe("succeeded");
    expect(response.body.output).toMatchObject({ projectTitle: "Fake Cursor tree", rootNodeId: "root" });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0])).not.toContain("Build a tree");
  });

  it("cancels slow cursor completions", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vdt-runner-cursor-"));
    const server = await start({
      host: "127.0.0.1",
      port: 0,
      executor: {
        tempRoot,
        env: { ...process.env, VDT_FAKE_CURSOR_MODE: "slow" },
        resolveExecutable: async (manifest) => (manifest.id === "cursor_subscription" ? fakeCursor : process.execPath)
      }
    });
    const token = await pair(server);
    const requestId = crypto.randomUUID();
    const completion = call(server, "/v1/completions", {
      method: "POST",
      token,
      body: {
        requestId,
        backendId: "cursor_subscription",
        taskType: "generate_tree",
        schemaId: "generate-tree-v1",
        input: {}
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await call(server, `/v1/completions/${requestId}/cancel`, { method: "POST", token, body: {} })).status).toBe(202);
    const completed = await completion;
    expect(completed.body.error.code).toBe("CANCELLED");
    expect((await call(server, `/v1/runs/${requestId}`, { token })).body.run.status).toBe("cancelled");
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("does not forward unrelated file-path environment to cursor", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vdt-runner-cursor-honey-"));
    const repoDir = await mkdtemp(path.join(os.tmpdir(), "vdt-runner-cursor-repo-"));
    const honeyPath = path.join(repoDir, "honey.txt");
    await writeFile(honeyPath, "secret", { encoding: "utf8", mode: 0o600 });
    const server = await start({
      host: "127.0.0.1",
      port: 0,
      executor: {
        tempRoot,
        env: { ...process.env, VDT_FAKE_CURSOR_MODE: "honey-read", HONEY_PATH: honeyPath },
        resolveExecutable: async (manifest) => (manifest.id === "cursor_subscription" ? fakeCursor : process.execPath)
      }
    });
    const token = await pair(server);
    const response = await call(server, "/v1/backends/cursor_subscription/test", { method: "POST", token, body: {} });
    expect(response.status).toBe(200);
    expect(response.body.output).toMatchObject({ ok: true });
    expect(JSON.stringify(response.body.output)).not.toContain("secret");
    expect(JSON.stringify(response.body.output)).not.toContain("leaked");
    await rm(tempRoot, { recursive: true, force: true });
    await rm(repoDir, { recursive: true, force: true });
  }, 30_000);
});

describe.skipIf(!hasLoopback)("codex subscription backend", () => {
  const codexExecutor = {
    resolveExecutable: async (manifest: BackendManifest) =>
      manifest.id === "codex_subscription" ? fakeCodex : process.execPath
  };

  it("runs certified codex connection test with fake executable override", async () => {
    const server = await start({ host: "127.0.0.1", port: 0, executor: codexExecutor });
    const token = await pair(server);
    const response = await call(server, "/v1/backends/codex_subscription/test", { method: "POST", token, body: {} });
    expect(response.body.error?.code).not.toBe("UNSAFE_CONFIGURATION");
    expect(response.status).toBe(200);
    expect(response.body.output).toMatchObject({ ok: true });
  });

  it("completes generate-tree-v1 through codex fake JSONL", async () => {
    const server = await start({ host: "127.0.0.1", port: 0, executor: codexExecutor });
    const token = await pair(server);
    const response = await call(server, "/v1/completions", {
      method: "POST",
      token,
      body: {
        requestId: crypto.randomUUID(),
        backendId: "codex_subscription",
        taskType: "generate_tree",
        schemaId: "generate-tree-v1",
        input: { prompt: "Build a tree" }
      }
    });
    expect(response.status).toBe(200);
    expect(response.body.run.status).toBe("succeeded");
    expect(response.body.output).toMatchObject({ projectTitle: "Fake Codex tree", rootNodeId: "root" });
  });
});

describe.skipIf(!hasLoopback)("claude subscription backend", () => {
  const claudeExecutor = {
    resolveExecutable: async (manifest: BackendManifest) =>
      manifest.id === "claude_subscription" ? fakeClaude : process.execPath
  };

  it("runs certified claude connection test with fake executable override", async () => {
    const server = await start({ host: "127.0.0.1", port: 0, executor: claudeExecutor });
    const token = await pair(server);
    const response = await call(server, "/v1/backends/claude_subscription/test", { method: "POST", token, body: {} });
    expect(response.body.error?.code).not.toBe("UNSAFE_CONFIGURATION");
    expect(response.status).toBe(200);
    expect(response.body.output).toMatchObject({ ok: true });
  });

  it("completes generate-tree-v1 through claude fake JSON", async () => {
    const server = await start({ host: "127.0.0.1", port: 0, executor: claudeExecutor });
    const token = await pair(server);
    const response = await call(server, "/v1/completions", {
      method: "POST",
      token,
      body: {
        requestId: crypto.randomUUID(),
        backendId: "claude_subscription",
        taskType: "generate_tree",
        schemaId: "generate-tree-v1",
        input: { prompt: "Build a tree" }
      }
    });
    expect(response.status).toBe(200);
    expect(response.body.run.status).toBe("succeeded");
    expect(response.body.output).toMatchObject({ projectTitle: "Fake Claude tree", rootNodeId: "root" });
  });
});

describe.skipIf(!hasLoopback)("manifest-driven CLI execution", () => {
  const manifest = (mode: string): BackendManifest => ({
    id: `fake_${mode}`,
    label: `Fake ${mode}`,
    kind: "custom_cli",
    supportLevel: "experimental",
    taskTypes: ["generate_tree"],
    schemaIds: ["connection-test-v1", "generate-tree-v1"],
    modelSelection: false,
    cli: { executableAliases: ["fake"], args: [fixture, mode], versionArgs: ["--version"] },
    safety: { toolsDisabled: true, requiresOsSandbox: false, certified: true }
  });

  const sandboxManifest = (): BackendManifest => ({
    id: "sandbox_certified",
    label: "Sandbox Certified",
    kind: "custom_cli",
    supportLevel: "experimental",
    taskTypes: ["generate_tree"],
    schemaIds: ["connection-test-v1", "generate-tree-v1"],
    modelSelection: false,
    cli: { executableAliases: ["fake"], args: [fixture, "valid"], versionArgs: ["--version"] },
    safety: { toolsDisabled: true, requiresOsSandbox: true, certified: true }
  });

  it("rejects OS-sandbox-required manifests because runtime certification is cross-platform only", async () => {
    const server = await start({
      host: "127.0.0.1", port: 0, manifests: [sandboxManifest()],
      executor: { resolveExecutable: async () => process.execPath }
    });
    const token = await pair(server);
    const response = await call(server, "/v1/backends/sandbox_certified/test", { method: "POST", token, body: {} });
    expect(response.body.error?.code).toBe("UNSAFE_CONFIGURATION");
  });

  it("executes only reviewed manifest args with a filtered environment and cleans the temp cwd", async () => {
    const server = await start({
      host: "127.0.0.1", port: 0, manifests: [manifest("valid")],
      executor: { env: { PATH: process.env.PATH, HOME: process.env.HOME, SECRET_TOKEN: "never" }, resolveExecutable: async () => process.execPath }
    });
    const token = await pair(server);
    const rejected = await call(server, "/v1/backends/fake_valid/test", { method: "POST", token, body: { command: "/bin/sh" } });
    expect(rejected.body.error.code).toBe("UNKNOWN_FIELD");
    const response = await call(server, "/v1/backends/fake_valid/test", { method: "POST", token, body: {} });
    expect(response.status).toBe(200);
    expect(response.body.output.envKeys).not.toContain("SECRET_TOKEN");
    expect(response.body.output.envKeys).toEqual(expect.arrayContaining(["HOME", "NO_COLOR", "PATH"]));
    await expect(lstat(response.body.output.cwd)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cancels an active process and normalizes cancellation", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vdt-runner-test-"));
    const server = await start({
      host: "127.0.0.1", port: 0, manifests: [manifest("slow")],
      executor: { tempRoot, resolveExecutable: async () => process.execPath }
    });
    const token = await pair(server);
    const requestId = crypto.randomUUID();
    const completion = call(server, "/v1/completions", {
      method: "POST", token,
      body: { requestId, backendId: "fake_slow", taskType: "generate_tree", schemaId: "generate-tree-v1", input: {} }
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await call(server, `/v1/completions/${requestId}/cancel`, { method: "POST", token, body: {} })).status).toBe(202);
    const completed = await completion;
    expect(completed.body.error.code).toBe("CANCELLED");
    expect((await call(server, `/v1/runs/${requestId}`, { token })).body.run.status).toBe("cancelled");
    expect(await readdir(tempRoot)).toEqual([]);
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("caps process output and never returns stderr", async () => {
    const server = await start({
      host: "127.0.0.1", port: 0, manifests: [manifest("large"), manifest("stderr")],
      executor: { resolveExecutable: async () => process.execPath }
    });
    const token = await pair(server);
    const large = await call(server, "/v1/backends/fake_large/test", { method: "POST", token, body: {} });
    expect(large.body.error).toEqual({ code: "OUTPUT_LINE_TOO_LARGE", message: "Backend output line exceeded the configured limit." });
    const stderr = await call(server, "/v1/backends/fake_stderr/test", { method: "POST", token, body: {} });
    expect(stderr.body.error.code).toBe("BACKEND_EXIT_FAILED");
    expect(JSON.stringify(stderr.body)).not.toContain("sensitive prompt");
  }, 15_000);
});
