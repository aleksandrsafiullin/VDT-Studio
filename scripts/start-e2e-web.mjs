import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { developmentWebEnvironment } from "./development-web-environment.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const web = path.join(root, "apps/web");
const require = createRequire(path.join(web, "package.json"));
const next = path.join(path.dirname(require.resolve("next/package.json")), "dist/bin/next");
const nextCommand = process.env.VDT_E2E_USE_BUILD === "1" ? "start" : "dev";
// Never inherit a developer's VDT_DATA_DIR or use the application's .vdt store.
const savedCopyRoot = process.env.VDT_E2E_SAVED_COPY_ROOT;
if (savedCopyRoot && (realpathSync(tmpdir()) !== savedCopyRoot || !path.basename(savedCopyRoot).startsWith("vdt-saved-copy-e2e-"))) {
  throw new Error("Saved-copy E2E requires a disposable runner-owned directory.");
}
const dataDir = mkdtempSync(path.join(tmpdir(), "vdt-e2e-data-"));
const savedCopyMarker = savedCopyRoot && path.join(savedCopyRoot, "server-owner.json");
if (savedCopyMarker) writeFileSync(savedCopyMarker, JSON.stringify({ dataDir, launcherPid: process.pid }), { flag: "wx", mode: 0o600 });
const reportDir = path.join(root, "output/playwright");
mkdirSync(reportDir, { recursive: true });
const reportPath = path.join(reportDir, `${path.basename(dataDir)}.json`);
const report = { dataDir, launcherPid: process.pid, nextCommand, cleaned: false };
writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(`E2E temporary storage: ${dataDir}`);
const child = spawn(process.execPath, [next, nextCommand, "--hostname", "127.0.0.1", "--port", "3100"], {
  cwd: web,
  stdio: "inherit",
  env: {
    ...developmentWebEnvironment(),
    VDT_DATA_DIR: dataDir,
    VDT_ALLOW_MOCK_PROVIDER: "true",
    NEXT_PUBLIC_VDT_ENABLE_STANDALONE_RUNNER: "true",
    // The admission smoke uses the real route with a synthetic key.
    ...(nextCommand === "start" ? { VDT_MODEL_AGENT_ENABLED: "true" } : {}),
    VDT_CLI_SESSION_CANARY_ENABLED: "false",
    VDT_LOCAL_MODEL_AGENT_ENABLED: "false",
    VDT_AGENT_LEGACY_COMPATIBILITY_ENABLED: "false",
    NEXT_TELEMETRY_DISABLED: "1"
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => { if (child.exitCode === null && child.signalCode === null) child.kill(signal); });
}
child.once("error", (error) => {
  console.error(`E2E web server failed: ${error.message}`);
  process.exitCode = 1;
});
child.once("close", (code, signal) => {
  // The directly owned Next process has closed its streams and workers.
  rmSync(dataDir, { recursive: true, force: true });
  if (savedCopyMarker) unlinkSync(savedCopyMarker);
  writeFileSync(reportPath, JSON.stringify({ ...report, cleaned: true, exitCode: code, signal }, null, 2) + "\n");
  console.log(`E2E temporary storage cleaned: ${dataDir}`);
  process.exitCode = signal === "SIGTERM" || signal === "SIGINT" ? 0 : code ?? 1;
});
