import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statfsSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { developmentWebEnvironment } from "../../scripts/development-web-environment.mjs";

const repository = fileURLToPath(new URL("../../", import.meta.url)), web = path.join(repository, "apps/web");
const disk = statfsSync(web);
if (disk.bavail * disk.bsize < 10 * 1024 ** 3) throw new Error("Less than 10 GiB free; the Smart browser build was not started.");
const owned = realpathSync(mkdtempSync(path.join(tmpdir(), "vdt-smart-kpi-e2e-"))), app = path.join(owned, "app"), dataDir = path.join(owned, "data");
mkdirSync(app); mkdirSync(dataDir);
// Preserve the monorepo's existing root dependency fallback (notably
// TypeScript) without installing or changing any dependency directory.
symlinkSync(path.join(repository, "node_modules"), path.join(owned, "node_modules"), "dir");
const marker = path.join(owned, ".owned-by-smart-kpi-harness"), nonce = `${process.pid}:${path.basename(owned)}`;
writeFileSync(marker, nonce);
// Source remains live/read-only; generated configs and all build output are
// private copies. In particular Next cannot rewrite the user's next-env/tsconfig.
for (const directory of ["components", "lib", "styles", "public", "node_modules"]) symlinkSync(path.join(web, directory), path.join(app, directory), "dir");
// Next's route watcher does not enumerate a symlinked app root. Mirror only
// directory names and link individual live source files; never copy sources.
const linkRoutes = (source, target) => {
  mkdirSync(target);
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    if (entry.isDirectory()) linkRoutes(path.join(source, entry.name), path.join(target, entry.name));
    else symlinkSync(path.join(source, entry.name), path.join(target, entry.name), "file");
  }
};
linkRoutes(path.join(web, "app"), path.join(app, "app"));
for (const file of ["package.json", "next-env.d.ts", "postcss.config.mjs"]) copyFileSync(path.join(web, file), path.join(app, file));
writeFileSync(path.join(app, "tailwind.config.ts"), readFileSync(path.join(web, "tailwind.config.ts"), "utf8").replace("../../packages/ui/src", path.join(repository, "packages/ui/src")));
symlinkSync(path.join(web, "next.config.mjs"), path.join(app, "next.config.mjs"));
const config = JSON.parse(readFileSync(path.join(web, "tsconfig.json"), "utf8"));
config.extends = path.join(repository, "tsconfig.base.json");
config.include = ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next-smart/types/**/*.ts"];
config.compilerOptions = { ...config.compilerOptions, baseUrl: ".", incremental: false };
writeFileSync(path.join(app, "tsconfig.json"), JSON.stringify(config, null, 2));
const reportDirectory = path.join(repository, "output/smart-kpi-suggestions"); mkdirSync(reportDirectory, { recursive: true });
const reportFile = path.join(reportDirectory, `${path.basename(owned)}.json`), log = createWriteStream(path.join(reportDirectory, `${path.basename(owned)}.log`));
const sourceHashes = () => Object.fromEntries(["next-env.d.ts", "tsconfig.json"].map(file => [file, createHash("sha256").update(readFileSync(path.join(web, file))).digest("hex")]));
const report = { owned, app, dataDir, distDir: path.join(app, ".next-smart"), launcherPid: process.pid, sourceConfigBefore: sourceHashes(), cleaned: false };
writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n");
const require = createRequire(path.join(web, "package.json")), next = path.join(path.dirname(require.resolve("next/package.json")), "dist/bin/next");
createRequire(path.join(app, "package.json")).resolve("typescript/lib/typescript.js");
const child = spawn(process.execPath, [next, "dev", "--hostname", "127.0.0.1", "--port", "3100"], { cwd: app, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
  env: { ...developmentWebEnvironment(), VDT_DATA_DIR: dataDir, VDT_NEXT_DIST_DIR: ".next-smart", VDT_ALLOW_MOCK_PROVIDER: "true", NEXT_PUBLIC_VDT_ENABLE_STANDALONE_RUNNER: "true",
    VDT_CLI_SESSION_CANARY_ENABLED: "false", VDT_LOCAL_MODEL_AGENT_ENABLED: "false", VDT_AGENT_LEGACY_COMPATIBILITY_ENABLED: "false", NEXT_TELEMETRY_DISABLED: "1", CI: "1" } });
console.log(`Smart E2E owned view: ${owned}`);
for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { log.write(chunk); (stream === child.stderr ? process.stderr : process.stdout).write(chunk); });
const signalOwned = signal => { if (!child.pid) return; try { process.kill(process.platform === "win32" ? child.pid : -child.pid, signal); } catch (error) { if (error.code !== "ESRCH") throw error; } };
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => signalOwned(signal));
child.once("error", error => { console.error(error.message); process.exitCode = 1; });
child.once("close", async (code, signal) => {
  const groupAlive = () => { if (!child.pid || process.platform === "win32") return false; try { process.kill(-child.pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; } };
  const deadline = Date.now() + 3000;
  while (groupAlive() && Date.now() < deadline) { signalOwned(Date.now() > deadline - 1000 ? "SIGKILL" : "SIGTERM"); await new Promise(resolve => setTimeout(resolve, 50)); }
  const confirmed = !groupAlive(), belongs = realpathSync(owned) === owned && readFileSync(marker, "utf8") === nonce;
  if (confirmed && belongs) rmSync(owned, { recursive: true, force: true });
  writeFileSync(reportFile, JSON.stringify({ ...report, childPid: child.pid, sourceConfigAfter: sourceHashes(), cleaned: confirmed && belongs, exitCode: code, signal, ...(confirmed ? {} : { reason: "Owned process group cleanup unconfirmed; directory retained." }) }, null, 2) + "\n");
  log.end(); console.log(`Smart E2E owned build/storage cleaned: ${confirmed && belongs}`);
  process.exitCode = !confirmed ? 1 : signal === "SIGTERM" || signal === "SIGINT" ? 0 : code ?? 1;
});
