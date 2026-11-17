import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const temporaryRoot = realpathSync(os.tmpdir());
const relative = path.relative(root, temporaryRoot);
if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
  throw new Error("Set TMPDIR to a temporary directory outside the checkout.");
}
const require = createRequire(import.meta.url);
const playwright = path.join(path.dirname(require.resolve("@playwright/test/package.json")), "cli.js");
const owned = mkdtempSync(path.join(temporaryRoot, "vdt-saved-copy-e2e-"));
const child = spawn(process.execPath, [playwright, "test", "-c", "tests/e2e/saved-copy-playwright.config.ts", ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, TMPDIR: owned, TEMP: owned, TMP: owned, VDT_E2E_USE_BUILD: "1", VDT_E2E_SAVED_COPY_ROOT: owned }
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.once("error", error => { console.error(error.message); process.exitCode = 1; });
child.once("close", (code, signal) => {
  // The server owns its profile. A marker left behind means cleanup could
  // not be confirmed, so preserve the complete test root for inspection.
  const marker = path.join(owned, "server-owner.json");
  if (existsSync(marker)) {
    console.error(`Saved-copy server cleanup was not confirmed. Retained ${owned}`);
    process.exitCode = 1;
    return;
  }
  rmSync(owned, { recursive: true });
  process.exitCode = code ?? (signal ? 1 : process.exitCode ?? 0);
});
