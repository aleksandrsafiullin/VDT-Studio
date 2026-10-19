import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runPnpm } from "./package-manager.mjs";
import { resolveReleaseDirectory } from "./release-paths.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliManifest = JSON.parse(readFileSync(join(root, "packages/cli/package.json"), "utf8"));
const releaseDir = resolveReleaseDirectory(root, cliManifest.version, process.env.VDT_RELEASE_DIR);
const tarballName = readdirSync(releaseDir).find((name) => name.endsWith(".tgz"));
if (!tarballName) throw new Error("Run pnpm package:alpha before the clean-install verification.");
const tarball = join(releaseDir, tarballName);
const installDir = mkdtempSync(join(tmpdir(), "vdt-cli-release-"));

function run(args) {
  return runPnpm(args, {
    cwd: installDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      npm_config_update_notifier: "false",
      npm_config_audit: "false",
      npm_config_fund: "false"
    }
  });
}

async function canListenOnLoopback(port) {
  const server = createServer();
  return await new Promise((resolve) => {
    server.once("error", (error) => {
      resolve({ ok: false, error });
    });
    server.listen(Number(port), "127.0.0.1", () => {
      server.close(() => resolve({ ok: true }));
    });
  });
}

let runner;
let runnerClosed;
let runnerDidClose = false;
try {
  writeFileSync(join(installDir, "package.json"), JSON.stringify({
    name: "vdt-clean-install", private: true, type: "module",
    dependencies: { [cliManifest.name]: `file:${tarball.replaceAll("\\", "/")}` }
  }));
  run(["install", "--offline", "--ignore-scripts", "--no-frozen-lockfile", "--store-dir", join(installDir, ".pnpm-store")]);
  const cliEntry = join(installDir, "node_modules", "@vdt-studio", "cli", "dist", "cli.mjs");
  if (!run(["exec", "vdt", "--help"]).includes("VDT Studio CLI")) throw new Error("Installed vdt --help failed.");
  const doctor = JSON.parse(run(["exec", "vdt", "doctor"]));
  if (!doctor.ok || !doctor.runner?.localOnly) throw new Error("Installed vdt doctor did not enforce a local-only runner.");
  const validation = JSON.parse(run(["exec", "vdt", "validate", join(root, "examples", "production-volume.json")]));
  if (!validation.valid) throw new Error("Installed vdt validate rejected the checked-in example.");

  const imported = await import(pathToFileURL(join(installDir, "node_modules", "@vdt-studio", "cli", "dist", "index.mjs")));
  if (typeof imported.runCli !== "function" || typeof imported.readProject !== "function") {
    throw new Error("Published CLI exports are incomplete.");
  }

  const port = String(18765 + Math.floor(Math.random() * 1000));
  const loopback = await canListenOnLoopback(port);
  if (!loopback.ok) {
    const error = loopback.error;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Loopback preflight failed; runner health was not verified: ${message}`);
  }
  runner = spawn(process.execPath, [cliEntry, "runner", "start"], {
    cwd: installDir,
    env: { ...process.env, LOCAL_RUNNER_PORT: port },
    stdio: ["ignore", "pipe", "pipe"]
  });
  runnerClosed = new Promise((resolveClosed) => runner.once("close", () => {
    runnerDidClose = true;
    resolveClosed();
  }));
  let output = "";
  runner.on("error", (error) => { output += error.message; });
  runner.stdout.on("data", (chunk) => { output += String(chunk); });
  runner.stderr.on("data", (chunk) => { output += String(chunk); });
  const deadline = Date.now() + 10_000;
  while (!runnerDidClose && !output.includes("Pairing code:") && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  if (!output.includes("Pairing code:")) throw new Error(`Packaged runner did not start:\n${output}`);
  const health = await fetch(`http://127.0.0.1:${port}/v1/health`).then((response) => response.json());
  if (health.ok !== true) throw new Error("Packaged runner health check failed.");
  process.stdout.write(`Clean install verified: ${tarballName}\n`);
} finally {
  if (runner && !runnerDidClose) {
    runner.kill("SIGTERM");
    const timer = setTimeout(() => { if (!runnerDidClose) runner.kill("SIGKILL"); }, 5_000);
    try { await runnerClosed; }
    finally { clearTimeout(timer); }
  }
  rmSync(installDir, { recursive: true, force: true });
}
