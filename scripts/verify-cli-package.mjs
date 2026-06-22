import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliManifest = JSON.parse(readFileSync(join(root, "packages/cli/package.json"), "utf8"));
const releaseDir = join(root, "output", "release", `v${cliManifest.version}`);
const tarballName = readdirSync(releaseDir).find((name) => name.endsWith(".tgz"));
if (!tarballName) throw new Error("Run pnpm package:alpha before the clean-install verification.");
const tarball = join(releaseDir, tarballName);
const installDir = mkdtempSync(join(tmpdir(), "vdt-cli-release-"));

function run(command, args) {
  return execFileSync(command, args, { cwd: installDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

try {
  writeFileSync(join(installDir, "package.json"), '{"name":"vdt-clean-install","private":true,"type":"module"}\n');
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball]);
  const bin = join(installDir, "node_modules", ".bin", process.platform === "win32" ? "vdt.cmd" : "vdt");
  const cliEntry = join(installDir, "node_modules", "@vdt-studio", "cli", "dist", "cli.mjs");
  if (!run(bin, ["--help"]).includes("VDT Studio CLI")) throw new Error("Installed vdt --help failed.");
  const doctor = JSON.parse(run(bin, ["doctor"]));
  if (!doctor.ok || !doctor.runner?.localOnly) throw new Error("Installed vdt doctor did not enforce a local-only runner.");
  const validation = JSON.parse(run(bin, ["validate", join(root, "examples", "production-volume.json")]));
  if (!validation.valid) throw new Error("Installed vdt validate rejected the checked-in example.");

  const imported = await import(pathToFileURL(join(installDir, "node_modules", "@vdt-studio", "cli", "dist", "index.mjs")));
  if (typeof imported.runCli !== "function" || typeof imported.readProject !== "function") {
    throw new Error("Published CLI exports are incomplete.");
  }

  const port = String(18765 + Math.floor(Math.random() * 1000));
  const runner = spawn(process.execPath, [cliEntry, "runner", "start"], {
    cwd: installDir,
    env: { ...process.env, LOCAL_RUNNER_PORT: port },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  runner.stdout.on("data", (chunk) => { output += String(chunk); });
  runner.stderr.on("data", (chunk) => { output += String(chunk); });
  const deadline = Date.now() + 10_000;
  while (!output.includes("Pairing code:") && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  if (!output.includes("Pairing code:")) throw new Error(`Packaged runner did not start:\n${output}`);
  const health = await fetch(`http://127.0.0.1:${port}/v1/health`).then((response) => response.json());
  if (health.ok !== true) throw new Error("Packaged runner health check failed.");
  runner.kill("SIGTERM");
  await new Promise((resolveWait) => runner.once("exit", resolveWait));
  process.stdout.write(`Clean install verified: ${tarballName}\n`);
} finally {
  rmSync(installDir, { recursive: true, force: true });
}
