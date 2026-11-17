import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { createServer, request, type Server } from "node:http";
import { createRequire } from "node:module";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CURSOR_CHECKPOINT_PROTOCOL_VERSION } from "../packages/model-bridge/src/agent-engines/cursor-resume-checkpoint-transport";
import { buildEnvironment, verifyResourceTree, WINDOWS_NODE } from "./package-windows-alpha.mjs";

const require = createRequire(import.meta.url);
const { guardedHandler, loadPackagedCursorIsolation } = require("../apps/desktop/packaged-web.cjs");
const owned: string[] = [];
const servers: Server[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, "close"); child.kill(); await closed;
    }
  }
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections(); server.close(() => resolve());
  })));
  await Promise.all(owned.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temp() {
  const root = await mkdtemp(path.join(os.tmpdir(), "vdt-windows-runtime-"));
  owned.push(root); return root;
}

async function guardedServer() {
  const guard = guardedHandler((req: any, res: any) => res.end(JSON.stringify({ forwarded: req.headers.forwarded ?? null })));
  const server = createServer(guard.handle); servers.push(server);
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port.");
  const port = address.port;
  const send = (url = "/", headers: Record<string, string> = {}) => new Promise<{ status: number; headers: any; body: string }>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path: url, headers: { host: "127.0.0.1:37541", ...headers } }, (res) => {
      let body = ""; res.on("data", (data) => body += data); res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    }); req.on("error", reject); req.end();
  });
  return { send, bootstrap: `/__vdt_start/${guard.bootstrapToken}` };
}

describe("packaged web authority shared by Mac and Windows", () => {
  it("requires the one-use private bootstrap and strips proxy headers after session admission", async () => {
    const { send, bootstrap } = await guardedServer();
    expect((await send()).status).toBe(403);
    const start = await send(bootstrap);
    expect(start.status).toBe(303);
    const setCookie = start.headers["set-cookie"][0];
    expect(setCookie).toContain("HttpOnly; SameSite=Strict");
    expect((await send(bootstrap)).status).toBe(403);
    const cookie = setCookie.split(";")[0];
    const result = await send("/api/project", { cookie, origin: "http://127.0.0.1:37541", forwarded: "host=attacker.example" });
    expect(result).toMatchObject({ status: 200, body: '{"forwarded":null}' });
  });
  it("rejects foreign host, origin and fetch-site even with a valid cookie", async () => {
    const { send, bootstrap } = await guardedServer();
    const start = await send(bootstrap);
    const cookie = start.headers["set-cookie"][0].split(";")[0];
    for (const headers of [
      { host: "attacker.example", cookie }, { origin: "https://attacker.example", cookie },
      { "sec-fetch-site": "cross-site", cookie }, { host: "localhost:37541", cookie }
    ]) expect((await send("/", headers)).status).toBe(403);
  });
  it("does not consume the bootstrap for a foreign request", async () => {
    const { send, bootstrap } = await guardedServer();
    expect((await send(bootstrap, { origin: "https://attacker.example" })).status).toBe(403);
    expect((await send(bootstrap)).status).toBe(303);
  });
});

describe("packaged Cursor isolation resource", () => {
  it("loads only the exact bytes pinned by the bootstrap manifest", async () => {
    const root = await temp();
    const resource = path.join(root, "cursor-isolation.cjs");
    const bundled = 'exports.createPackagedCursorActivation = () => ({ marker: require("node:path").basename(__filename) });';
    await writeFile(resource, bundled);
    const digest = createHash("sha256").update(bundled).digest("hex");
    await expect(loadPackagedCursorIsolation(root, undefined)).resolves.toBeUndefined();
    await expect(loadPackagedCursorIsolation(root, digest)).resolves.toEqual({ marker: "cursor-isolation.cjs" });
    await writeFile(resource, "throw new Error('untrusted code was evaluated');");
    await expect(loadPackagedCursorIsolation(root, digest)).rejects.toThrow("failed integrity verification");
  });

  it("stages only the target resource from the archived release manifest", async () => {
    const root = await temp();
    const source = path.join(root, "apps", "desktop");
    const scripts = path.join(root, "scripts");
    const resources = path.join(root, "resources");
    await Promise.all([
      mkdir(path.join(source, "cursor-isolation"), { recursive: true }),
      mkdir(scripts),
      mkdir(resources)
    ]);
    const bundled = "exports.createPackagedCursorActivation = () => ({ marker: true });";
    const digest = createHash("sha256").update(bundled).digest("hex");
    const bootstrap = (await readFile(path.resolve("apps/desktop/packaged-web.cjs"), "utf8"))
      .replace(/const cursorIsolationResourceManifest = Object.freeze\([^;]*\);/,
        `const cursorIsolationResourceManifest = Object.freeze({ "darwin-arm64": "${digest}" });`);
    await Promise.all([
      writeFile(path.join(source, "packaged-web.cjs"), bootstrap),
      writeFile(path.join(source, "cursor-isolation", "darwin-arm64.cjs"), bundled),
      cp(path.resolve("scripts/stage-packaged-cursor-isolation.cjs"), path.join(scripts, "stage-packaged-cursor-isolation.cjs"))
    ]);
    const { stagePackagedCursorIsolation } = require(path.join(scripts, "stage-packaged-cursor-isolation.cjs"));
    expect(stagePackagedCursorIsolation(resources, "win32", "x64")).toEqual([]);
    expect(await readdir(resources)).toEqual([]);
    expect(stagePackagedCursorIsolation(resources, "darwin", "arm64")).toEqual(["cursor-isolation.cjs"]);
    expect(await readFile(path.join(resources, "cursor-isolation.cjs"), "utf8")).toBe(bundled);
  });

  it("stages only the three measured Windows resources and rejects a modified worker", async () => {
    const root = await temp();
    const source = path.join(root, "apps", "desktop");
    const activation = path.join(source, "cursor-isolation");
    const workers = path.join(activation, "windows-cursor-worker");
    const scripts = path.join(root, "scripts");
    const resources = path.join(root, "resources");
    await Promise.all([mkdir(workers, { recursive: true }), mkdir(scripts), mkdir(resources)]);
    const assets = {
      activation: ["win32-x64.cjs", "exports.createPackagedCursorActivation = () => ({});"],
      worker: ["vdt-windows-cursor-worker.exe", "synthetic worker bytes"],
      preload: ["proxy-preload.cjs", "synthetic preload bytes"]
    } as const;
    const entry = Object.fromEntries(Object.entries(assets).map(([key, [, bytes]]) =>
      [key, createHash("sha256").update(bytes).digest("hex")]));
    const bootstrap = (await readFile(path.resolve("apps/desktop/packaged-web.cjs"), "utf8"))
      .replace(/const cursorIsolationResourceManifest = Object.freeze\([^;]*\);/,
        `const cursorIsolationResourceManifest = Object.freeze(${JSON.stringify({ "win32-x64": entry })});`);
    const worker = path.join(workers, assets.worker[0]);
    await Promise.all([
      writeFile(path.join(source, "packaged-web.cjs"), bootstrap),
      writeFile(path.join(activation, assets.activation[0]), assets.activation[1]),
      writeFile(worker, "modified worker"),
      writeFile(path.join(workers, assets.preload[0]), assets.preload[1]),
      writeFile(path.join(workers, "unlisted.cjs"), "private fixture"),
      cp(path.resolve("scripts/stage-packaged-cursor-isolation.cjs"), path.join(scripts, "stage-packaged-cursor-isolation.cjs"))
    ]);
    const { stagePackagedCursorIsolation } = require(path.join(scripts, "stage-packaged-cursor-isolation.cjs"));
    expect(() => stagePackagedCursorIsolation(resources, "win32", "x64")).toThrow("failed integrity verification");
    expect(await readdir(resources)).toEqual([]);
    await writeFile(worker, assets.worker[1]);
    expect(stagePackagedCursorIsolation(resources, "win32", "x64")).toEqual([
      "cursor-isolation.cjs", "windows-cursor-worker/vdt-windows-cursor-worker.exe",
      "windows-cursor-worker/proxy-preload.cjs"
    ]);
    expect(await readdir(path.join(resources, "windows-cursor-worker"))).toEqual([
      assets.preload[0], assets.worker[0]
    ]);
  });

  it("builds a pinned Windows activation from exact reviewed model records", async () => {
    const root = await temp();
    const { buildWindowsCursorIsolation } = require(path.resolve("scripts/build-windows-cursor-isolation.cjs"));
    const hash = (text: string) => createHash("sha256").update(text).digest("hex");
    const digest = `sha256:${hash("synthetic evidence")}`;
    const evidence = {
      evidenceHash: digest, testedAt: "2026-11-17T00:00:00.000Z", cliVersion: "2026.11.13-eacade1",
      protocolVersion: CURSOR_CHECKPOINT_PROTOCOL_VERSION,
      toolCatalogHash: digest, payloadHash: digest, policyHash: digest, vendorPolicyHash: digest,
      platform: { os: "win32", arch: "x64", runtimeVersion: "v24.22.2" },
      modelId: "grok-4.7-low", catalogModelDisplayName: "Grok 4.7 Low", runtimeModelDisplayName: "Grok 4.7 256K Low"
    };
    const profile = {
      payloadRoot: String.raw`V:\Cursor\payload`, systemRoot: String.raw`C:\Windows`, privateRoot: String.raw`V:\Cursor\private`,
      workerExecutableHash: `sha256:${hash("worker")}`, proxyPreloadHash: `sha256:${hash("preload")}`,
      egressPolicyHash: digest, ignoredReviewNotes: "synthetic review note must remain outside the package"
    };
    const profilePath = path.join(root, "profile.json");
    const bundlePath = path.join(root, "win32-x64.cjs");
    await Promise.all([
      writeFile(path.join(root, "vdt-windows-cursor-worker.exe"), "worker"),
      writeFile(path.join(root, "proxy-preload.cjs"), "preload"),
      writeFile(profilePath, JSON.stringify({ ...profile, evidences: [evidence, evidence] }))
    ]);
    await expect(buildWindowsCursorIsolation(profilePath, root, bundlePath)).rejects.toThrow("repeats a model identifier");
    await writeFile(profilePath, JSON.stringify({ ...profile, evidence: { ...evidence, protocolVersion: 1 } }));
    await expect(buildWindowsCursorIsolation(profilePath, root, bundlePath)).rejects.toThrow("exact x64 host and model");
    await writeFile(profilePath, JSON.stringify({
      ...profile, evidences: [evidence, {
        ...evidence, modelId: "grok-4.7-xhigh",
        catalogModelDisplayName: "Grok 4.7 Extra High", runtimeModelDisplayName: "Grok 4.7 256K Extra High"
      }]
    }));
    const pins = await buildWindowsCursorIsolation(profilePath, root, bundlePath);
    const bundled = await readFile(bundlePath, "utf8");
    expect(pins).toEqual({ activation: hash(bundled), worker: hash("worker"), preload: hash("preload") });
    expect(bundled).toContain(evidence.modelId);
    expect(bundled).toContain("grok-4.7-xhigh");
    expect(bundled).not.toContain(profile.ignoredReviewNotes);
  });

  it("rejects unmeasured relative dependencies even from the pinned module", async () => {
    const root = await temp();
    const bundled = 'exports.createPackagedCursorActivation = () => require("./unverified.cjs");';
    await writeFile(path.join(root, "cursor-isolation.cjs"), bundled);
    await writeFile(path.join(root, "unverified.cjs"), "module.exports = { marker: true };");
    const digest = createHash("sha256").update(bundled).digest("hex");
    await expect(loadPackagedCursorIsolation(root, digest)).rejects.toThrow("dependencies must be self-contained");
  });
});

describe("Windows process activation barrier", () => {
  async function launch() {
    const root = await temp(); await mkdir(path.join(root, "sidecars"));
    await cp(path.resolve("apps/desktop/windows-runtime.cjs"), path.join(root, "windows-runtime.cjs"));
    await writeFile(path.join(root, "sidecars/vdt-local-runtime.mjs"),
      'export function runLocalRuntimeSidecar() { process.stdout.write("activated\\n"); process.stdin.on("end",()=>process.exit(0)); }');
    const child = spawn(process.execPath, [path.join(root, "windows-runtime.cjs"), "sidecar"], { stdio: ["pipe", "pipe", "pipe"] });
    children.push(child); let output = ""; child.stdout!.on("data", (data) => output += data);
    return { child, output: () => output };
  }
  it("loads no runtime before activation, accepts fragmented private frame, exits when host pipe closes", async () => {
    const { child, output } = await launch();
    await new Promise((resolve) => setTimeout(resolve, 75)); expect(output()).toBe("");
    child.stdin!.write("sta"); await new Promise((resolve) => setTimeout(resolve, 25)); expect(output()).toBe("");
    const ready = once(child.stdout!, "data"); child.stdin!.write("rt\n"); await ready;
    expect(output()).toBe("activated\n");
    const closed = once(child, "close"); child.stdin!.end(); expect((await closed)[0]).toBe(0);
  });
  it("starts the generated sidecar after activation and completes hello, ready and EOF", async () => {
    const root = await temp();
    await mkdir(path.join(root, "sidecars"));
    await cp(path.resolve("apps/desktop/windows-runtime.cjs"), path.join(root, "windows-runtime.cjs"));
    await cp(path.resolve("apps/desktop/src-tauri/sidecars/vdt-local-runtime.mjs"), path.join(root, "sidecars/vdt-local-runtime.mjs"));
    const child = spawn(process.execPath, [path.join(root, "windows-runtime.cjs"), "sidecar"], {
      cwd: root,
      env: { ...process.env, VDT_DATA_DIR: path.join(root, "profile"), VDT_HARNESS_CONFIG: path.join(root, "harnesses.json") },
      stdio: ["pipe", "pipe", "pipe"],
    });
    children.push(child);
    const closed = once(child, "close");
    const lines = createInterface({ input: child.stdout! });
    const readFrame = async () => JSON.parse((await Promise.race([
      once(lines, "line").then(([line]) => line),
      closed.then(([code]) => { throw new Error(`Sidecar exited before its frame: ${code}`); }),
    ])) as string);
    let bytesBeforeActivation = 0;
    const countOutput = (bytes: Buffer) => { bytesBeforeActivation += bytes.length; };
    child.stdout!.on("data", countOutput);
    await new Promise(resolve => setTimeout(resolve, 75));
    expect(bytesBeforeActivation).toBe(0);
    child.stdout!.off("data", countOutput);
    const hello = readFrame();
    child.stdin!.write("start\n");
    const frame = await hello;
    expect(frame).toMatchObject({ type: "hello", protocolVersion: 1, nonce: expect.any(String) });
    const ready = readFrame();
    child.stdin!.write(JSON.stringify({ type: "ready", protocolVersion: 1, nonce: frame.nonce }) + "\n");
    expect(await ready).toMatchObject({ type: "event", event: "runtime_ready", protocolVersion: 1 });
    child.stdin!.end();
    expect(await closed).toEqual([0, null]);
    lines.close();
  });
  it("rejects an invalid frame without loading the runtime", async () => {
    const { child, output } = await launch();
    const closed = once(child, "close"); child.stdin!.end("wrong\n");
    expect((await closed)[0]).toBe(1); expect(output()).toBe("");
  });
});

describe("Windows package inputs", () => {
  it("pins the exact Node archive and derives archive build identity without shell input", () => {
    expect(WINDOWS_NODE.sha256).toMatch(/^[a-f0-9]{64}$/);
    const result = buildEnvironment({ stage: "C:\\owned stage", version: "0.1.0-alpha.2",
      sourceCommit: "a".repeat(40), buildTime: "2026-11-13T10:00:00.000Z",
      inherited: { NODE_OPTIONS: "--require unsafe", NODE_PATH: "unsafe", VDT_NEXT_DIST_DIR: "old" } });
    expect(result).toMatchObject({ NEXT_PUBLIC_VDT_BUILD_COMMIT: "a".repeat(40), NEXT_PUBLIC_VDT_BUILD_DIRTY: "false",
      NEXT_PUBLIC_VDT_BUILD_TIME: "2026-11-13T10:00:00.000Z" });
    expect(result.NODE_OPTIONS).toBeUndefined(); expect(result.NODE_PATH).toBeUndefined(); expect(result.VDT_NEXT_DIST_DIR).toBeUndefined();
  });
  it("rejects private files and links escaping a package", async () => {
    const root = await temp(); const outside = await temp();
    await writeFile(path.join(root, ".env.local"), "synthetic");
    expect(() => verifyResourceTree(root)).toThrow(/Private resource/);
    await rm(path.join(root, ".env.local"));
    await symlink(outside, path.join(root, "outside"), process.platform === "win32" ? "junction" : "dir");
    expect(() => verifyResourceTree(root)).toThrow(/escapes/);
  });
});

it("marks packaged web storage activation only after the private startup frame", async () => {
  const root = await temp();
  await cp(path.resolve("apps/desktop/windows-runtime.cjs"), path.join(root, "windows-runtime.cjs"));
  await writeFile(path.join(root, "packaged-web.cjs"),
    'exports.start=()=>process.stdout.write(JSON.stringify(globalThis[Symbol.for("vdt-studio.packaged-windows-storage.activation.v1")]));');
  const child = spawn(process.execPath, [path.join(root, "windows-runtime.cjs"), "web"], {
    env: { ...process.env, VDT_WINDOWS_STORAGE_RUNTIME_DIR: "verified-runtime", VDT_DATA_DIR: "profile" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.push(child);
  const closed = once(child, "close");
  let output = "";
  child.stdout!.on("data", data => output += data);
  await new Promise(resolve => setTimeout(resolve, 75));
  expect(output).toBe("");
  child.stdin!.end("start\n");
  expect((await closed)[0]).toBe(0);
  expect(JSON.parse(output)).toEqual({ runtimeDirectory: "verified-runtime", profilePath: "profile" });
});


it("relocates absolute traced junctions only to an already present standalone counterpart", async () => {
  const source = await temp();
  const standalone = path.join(source, "apps/web/.next/standalone");
  const original = path.join(source, "node_modules/package");
  const traced = path.join(standalone, "node_modules/package");
  const link = path.join(standalone, "node_modules/alias");
  await mkdir(original, { recursive: true });
  await mkdir(traced, { recursive: true });
  await symlink(original, link, process.platform === "win32" ? "junction" : "dir");
  verifyResourceTree(standalone, source);
  verifyResourceTree(standalone);
  const missing = path.join(source, "node_modules/untraced");
  await mkdir(missing);
  await symlink(missing, path.join(standalone, "untraced"), process.platform === "win32" ? "junction" : "dir");
  expect(() => verifyResourceTree(standalone, source)).toThrow(/escapes its root: untraced/);
});
