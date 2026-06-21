import { request as httpRequest, type Server } from "node:http";
import { lstat, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { AuditEvent, BackendManifest } from "../cli/types";
import { createLocalRunnerServer, getRunnerPairingInfo, type LocalRunnerServer } from "./app";

const origin = "http://127.0.0.1:3000";
const servers: Server[] = [];
const fixture = fileURLToPath(new URL("./fixtures/fake-backend.mjs", import.meta.url));

async function start(options: Parameters<typeof createLocalRunnerServer>[0] = { host: "127.0.0.1", port: 0 }) {
  const server = createLocalRunnerServer({ ...options, auditSink: options.auditSink ?? (() => undefined) });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
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

describe("Phase 2 transport and pairing", () => {
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

describe("Phase 2 completion contract", () => {
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

  it("rejects duplicate request ids and uncertified subscription execution", async () => {
    const server = await start();
    const token = await pair(server);
    const requestId = crypto.randomUUID();
    const body = { requestId, backendId: "mock", taskType: "generate_tree", schemaId: "generate-tree-v1", input: { projectTitle: "x", rootNodeId: "r", nodes: [{}], edges: [], assumptions: [], questionsForUser: [], warnings: [] } };
    expect((await call(server, "/v1/completions", { method: "POST", token, body })).status).toBe(200);
    expect((await call(server, "/v1/completions", { method: "POST", token, body })).body.error.code).toBe("DUPLICATE_REQUEST_ID");

    const unsafe = await call(server, "/v1/backends/cursor_subscription/test", { method: "POST", token, body: {} });
    expect(unsafe.body.error.code).toBe("UNSAFE_CONFIGURATION");
  });
});

describe("manifest-driven CLI execution", () => {
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
