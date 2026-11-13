import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request } from "node:http";
import path from "node:path";
import { createInterface } from "node:readline";

const [application, expectedCommit, workParent] = process.argv.slice(2);
assert(process.platform === "win32" && process.arch === "x64", "Windows x64 is required");
assert(application && path.isAbsolute(application) && workParent && path.isAbsolute(workParent));
assert.match(expectedCommit ?? "", /^[a-f0-9]{40}$/);
const shell = path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const token = spawnSync(shell, ["-NoProfile", "-NonInteractive", "-Command",
  "[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"
], { encoding: "utf8", timeout: 10_000, windowsHide: true });
assert.equal(token.status, 0);
assert.equal(token.stdout.trim(), "False", "Smoke must run without an administrator token");

const readJson = (filename) => JSON.parse(readFileSync(filename, "utf8"));
const build = readJson(path.join(application, "build-info.json"));
assert.equal(build.sourceCommit, expectedCommit);
assert.equal(build.dirty, false);
assert.equal(build.platform, "win32");
assert.equal(build.architecture, "x64");
const runtime = path.join(application, "runtime");
const manifest = readJson(path.join(runtime, "windows-storage.manifest.json"));
assert.equal(manifest.fileName, "windows-storage.node");
const addonSha256 = createHash("sha256").update(readFileSync(path.join(runtime, manifest.fileName))).digest("hex");
assert.equal(addonSha256, manifest.sha256);
const web = path.join(application, "web", "apps", "web");
assert(existsSync(path.join(web, ".next", "server", "instrumentation.js")), "Compiled Next instrumentation is missing");

const work = mkdtempSync(path.join(workParent, "vdt-standalone-smoke-"));
const profile = path.join(work, "profile");
let child;
let closed;
let gracefulExit;
let sidecarExit;
let timedOut = false;
const origin = "http://127.0.0.1:37541";
let stderrBytes = 0;
let preActivationOutput = false;
let activated = false;

function send(port, pathname, cookie, host = "127.0.0.1:37541", body) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path: pathname, method: body ? "POST" : "GET", headers: {
      Host: host, Origin: origin, "Sec-Fetch-Site": "same-origin", ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {})
    } }, (response) => {
      const chunks = [];
      let length = 0;
      response.on("data", (chunk) => {
        length += chunk.length;
        if (length > 128 * 1024) req.destroy(new Error("Smoke response exceeded its limit"));
        else chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.setTimeout(10_000, () => req.destroy(new Error("Smoke request timed out")));
    req.on("error", reject);
    req.end(body);
  });
}

async function verifySidecar(env) {
  const sidecar = spawn(path.join(runtime, "node.exe"), [path.join(application, "windows-runtime.cjs"), "sidecar"], {
    cwd: web, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true
  });
  const complete = new Promise(resolve => sidecar.once("close", (code, signal) => resolve({ code, signal })));
  let rejectFailure;
  const failure = new Promise((_, reject) => { rejectFailure = reject; });
  failure.catch(() => undefined);
  sidecar.on("error", () => rejectFailure(new Error("Could not spawn packaged sidecar")));
  sidecar.stdin.on("error", () => rejectFailure(new Error("Packaged sidecar input pipe failed")));
  sidecar.stderr.resume();
  let activated = false;
  let pending = Buffer.alloc(0);
  let resolveFrame;
  sidecar.stdout.on("data", bytes => {
    if (!activated) {
      rejectFailure(new Error("Packaged sidecar produced output before activation"));
      return;
    }
    if (bytes.length + pending.length > 4096) {
      rejectFailure(new Error("Packaged sidecar handshake exceeded its byte bound"));
      return;
    }
    pending = Buffer.concat([pending, bytes]);
    const newline = pending.indexOf(10);
    if (newline === -1) return;
    if (!resolveFrame || newline !== pending.length - 1) {
      rejectFailure(new Error("Unexpected packaged sidecar handshake output"));
      return;
    }
    try {
      resolveFrame(JSON.parse(pending.toString("utf8")));
    } catch {
      rejectFailure(new Error("Invalid packaged sidecar handshake frame"));
    }
    resolveFrame = undefined;
    pending = Buffer.alloc(0);
  });
  const earlyExit = complete.then(() => { throw new Error("Packaged sidecar exited before completing its handshake"); });
  earlyExit.catch(() => undefined);
  const nextFrame = () => Promise.race([new Promise(resolve => { resolveFrame = resolve; }), failure, earlyExit]);
  let timeout;
  try {
    await Promise.race([new Promise(resolve => setTimeout(resolve, 200)), failure, earlyExit]);
    const helloFrame = nextFrame();
    activated = true;
    timeout = setTimeout(() => rejectFailure(new Error("Packaged sidecar handshake timed out")), 5_000);
    sidecar.stdin.write("start\n");
    const hello = await helloFrame;
    if (hello.type !== "hello" || hello.protocolVersion !== 1 || typeof hello.nonce !== "string") {
      throw new Error("Invalid packaged sidecar hello");
    }
    const readyFrame = nextFrame();
    sidecar.stdin.write(JSON.stringify({ protocolVersion: 1, type: "ready", nonce: hello.nonce }) + "\n");
    const ready = await readyFrame;
    if (ready.protocolVersion !== 1 || ready.type !== "event" || ready.event !== "runtime_ready") {
      throw new Error("Packaged sidecar did not acknowledge readiness");
    }
    clearTimeout(timeout);
    timeout = setTimeout(() => sidecar.kill(), 5_000);
    sidecar.stdin.end();
    const exit = await Promise.race([complete, failure]);
    assert.deepEqual(exit, { code: 0, signal: null });
    return exit;
  } finally {
    clearTimeout(timeout);
    if (sidecar.exitCode === null && sidecar.signalCode === null) sidecar.kill();
    await complete;
  }
}

try {
  const env = { ...process.env, VDT_APP_MODE: "desktop", NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
    VDT_DATA_DIR: profile, VDT_WINDOWS_STORAGE_RUNTIME_DIR: runtime };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  child = spawn(path.join(runtime, "node.exe"), [path.join(application, "windows-runtime.cjs"), "web"], {
    cwd: web, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true
  });
  closed = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
  const lines = createInterface({ input: child.stdout });
  child.stderr.on("data", (chunk) => {
    stderrBytes += chunk.length;
    if (stderrBytes <= 64 * 1024) process.stderr.write(chunk);
  });
  child.stdout.on("data", () => { if (!activated) preActivationOutput = true; });
  const startup = Promise.race([
    once(lines, "line").then(([line]) => line),
    once(child, "error").then(([error]) => { throw error; }),
    once(child.stdin, "error").then(([error]) => { throw error; }),
    closed.then(({ code, signal }) => { throw new Error(`Packaged runtime exited during startup (${code}, ${signal}; ${stderrBytes} stderr bytes)`); })
  ]);
  // Attach a handler before waiting so early startup errors remain observable.
  startup.catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert(!preActivationOutput && !existsSync(profile), "Runtime loaded before private activation");
  activated = true;
  child.stdin.write("start\n");
  const timeout = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 30_000);
  let frame;
  try { frame = JSON.parse(await startup); }
  finally { clearTimeout(timeout); }
  assert(!timedOut);
  assert.deepEqual(Object.keys(frame).sort(), ["backendPort", "bootstrap"]);
  assert(Number.isSafeInteger(frame.backendPort) && frame.backendPort >= 1024 && frame.backendPort <= 65535 && frame.backendPort !== 37541);
  assert.match(frame.bootstrap, /^[a-f0-9]{64}$/);
  const { backendPort: port } = frame;
  assert.equal((await send(port, "/api/vdt/projects")).status, 403);
  const bootstrap = await send(port, `/__vdt_start/${frame.bootstrap}`);
  assert.equal(bootstrap.status, 303);
  assert.equal(bootstrap.headers.location, "/");
  assert.match(bootstrap.headers["set-cookie"]?.[0] ?? "", /^vdt_desktop_session=[a-f0-9]{64}; HttpOnly; SameSite=Strict; Path=\/$/);
  const cookie = bootstrap.headers["set-cookie"][0].split(";")[0];
  assert.equal((await send(port, "/favicon.svg", cookie)).status, 200);
  assert.equal((await send(port, "/_next/image?url=%2Ffavicon.svg&w=64&q=75", cookie)).status, 404,
    "Unused image optimization must be disabled in the authenticated compiled server");
  assert.equal((await send(port, `/__vdt_start/${frame.bootstrap}`)).status, 403);
  assert.equal((await send(port, "/api/vdt/projects", cookie, "localhost:37541")).status, 403);
  const projects = await send(port, "/api/vdt/projects", cookie);
  assert.equal(projects.status, 200);
  assert.deepEqual(JSON.parse(projects.body), { schemaVersion: "project_explorer_response.v1", ok: true, projects: [] });
  const created = await send(port, "/api/vdt/projects", cookie, undefined,
    JSON.stringify({ id: "standalone_smoke", name: "Standalone smoke" }));
  assert.equal(created.status, 201);
  const readback = await send(port, "/api/vdt/projects?projectId=standalone_smoke", cookie);
  assert.equal(readback.status, 200);
  assert.equal(JSON.parse(readback.body).projects[0]?.project?.id, "standalone_smoke");
  const identity = await send(port, "/api/support/build", cookie);
  assert.equal(identity.status, 200);
  const publicBuild = JSON.parse(identity.body);
  assert.equal(publicBuild.commit, expectedCommit);
  assert.equal(publicBuild.version, build.version);
  assert.equal(publicBuild.dirty, false);
  assert.equal(publicBuild.platform, "win32");
  assert.equal(publicBuild.architecture, "x64");
  assert.equal(publicBuild.nodeVersion, `v${manifest.nodeVersion}`);
  assert(existsSync(path.join(profile, "app.sqlite")), "The activated runtime did not initialize storage");
  child.stdin.end();
  const stop = setTimeout(() => child.kill("SIGKILL"), 5_000);
  try { gracefulExit = await closed; }
  finally { clearTimeout(stop); }
  assert.deepEqual(gracefulExit, { code: 0, signal: null });
  sidecarExit = await verifySidecar({ ...env,
    VDT_BUNDLED_SKILLS_DIR: path.join(application, "sidecars/vdt-agent-skills"),
    VDT_HARNESS_CONFIG: path.join(profile, "harnesses.json"),
  });
} finally {
  if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  if (closed) await closed;
  rmSync(work, { recursive: true, force: true });
  assert(!existsSync(work), "Smoke directory was retained");
}
console.log(JSON.stringify({ sourceCommit: expectedCommit, addonSha256, nodeVersion: manifest.nodeVersion,
  standardUser: true, compiledStandalone: true, storageRouteStatus: 200, storageWriteStatus: 201, bootstrapOneUse: true,
  staticAssetStatus: 200, imageOptimizationStatus: 404, gracefulExit, sidecarPreActivationQuiet: true, sidecarReady: true, sidecarExit, retainedWork: false }));
