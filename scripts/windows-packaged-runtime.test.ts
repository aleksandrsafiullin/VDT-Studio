import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer, request, type Server } from "node:http";
import { createRequire } from "node:module";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildEnvironment, verifyResourceTree, WINDOWS_NODE } from "./package-windows-alpha.mjs";

const require = createRequire(import.meta.url);
const { guardedHandler } = require("../apps/desktop/packaged-web.cjs");
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

describe("Windows process activation barrier", () => {
  async function launch() {
    const root = await temp(); await mkdir(path.join(root, "sidecars"));
    await cp(path.resolve("apps/desktop/windows-runtime.cjs"), path.join(root, "windows-runtime.cjs"));
    await writeFile(path.join(root, "sidecars/vdt-local-runtime.mjs"),
      'process.stdout.write("activated\\n"); process.stdin.on("end",()=>process.exit(0)); process.stdin.resume();');
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
