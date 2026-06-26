import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const launcherPath = resolve(root, "apps/desktop/src-tauri/sidecars/vdt-local-runtime");
const windowsLauncherPath = resolve(root, "apps/desktop/src-tauri/sidecars/vdt-local-runtime.cmd");
const bundlePath = resolve(root, "apps/desktop/src-tauri/sidecars/vdt-local-runtime.mjs");
const manifestPath = resolve(root, "apps/desktop/src-tauri/sidecars/vdt-local-runtime.manifest.json");
const skillSourcePath = resolve(root, "packages/vdt-agent/skills");
const skillResourcePath = resolve(root, "apps/desktop/src-tauri/sidecars/vdt-agent-skills");
const selfContainedSource = process.env.VDT_DESKTOP_SELF_CONTAINED_SIDECAR;

const launcher = `#!/bin/sh
set -eu

SIDECAR_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ENTRYPOINT="$SIDECAR_DIR/vdt-local-runtime.mjs"

if [ ! -f "$ENTRYPOINT" ]; then
  echo "VDT desktop sidecar runtime bundle is missing." >&2
  exit 127
fi

exec "\${VDT_NODE:-node}" "$ENTRYPOINT"
`;

const windowsLauncher = `@echo off
setlocal

set "SIDECAR_DIR=%~dp0"
set "ENTRYPOINT=%SIDECAR_DIR%vdt-local-runtime.mjs"

if not exist "%ENTRYPOINT%" (
  echo VDT desktop sidecar runtime bundle is missing. 1>&2
  exit /b 127
)

if defined VDT_NODE (
  "%VDT_NODE%" "%ENTRYPOINT%"
) else (
  node "%ENTRYPOINT%"
)
exit /b %ERRORLEVEL%
`;

mkdirSync(dirname(launcherPath), { recursive: true });
function directorySha256(directory) {
  const hash = createHash("sha256");
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.isFile()) {
        const rel = relative(directory, path).replaceAll("\\", "/");
        hash.update(rel);
        hash.update("\0");
        hash.update(readFileSync(path));
        hash.update("\0");
      }
    }
  };
  walk(directory);
  return hash.digest("hex");
}

if (selfContainedSource) {
  const source = resolve(selfContainedSource);
  const sourceStat = statSync(source);
  if (!sourceStat.isFile()) {
    throw new Error(`VDT_DESKTOP_SELF_CONTAINED_SIDECAR must point to a file: ${source}`);
  }
  copyFileSync(source, launcherPath);
  chmodSync(launcherPath, 0o755);
  const sidecar = readFileSync(launcherPath);
  const sidecarDigest = createHash("sha256").update(sidecar).digest("hex");
  writeFileSync(
    manifestPath,
    `${JSON.stringify({
      schemaVersion: 1,
      kind: "self-contained-sidecar",
      protocolVersion: 1,
      launcher: "vdt-local-runtime",
      entrypoint: "sidecars/vdt-local-runtime",
      sidecarSha256: sidecarDigest,
      selfContained: true
    }, null, 2)}\n`,
    "utf8"
  );
  process.stdout.write(`Desktop self-contained sidecar prepared at ${launcherPath}\n`);
  process.exit(0);
}

rmSync(skillResourcePath, { recursive: true, force: true });
cpSync(skillSourcePath, skillResourcePath, { recursive: true });

execFileSync(
  "pnpm",
  [
    "--filter",
    "@vdt-studio/cli",
    "exec",
    "esbuild",
    "../../packages/local-runner/src/sidecar/index.ts",
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--target=node24",
    `--outfile=${bundlePath}`
  ],
  { cwd: root, stdio: "inherit" }
);
writeFileSync(launcherPath, launcher, { mode: 0o755 });
chmodSync(launcherPath, 0o755);
writeFileSync(windowsLauncherPath, windowsLauncher, "utf8");
const launcherDigest = createHash("sha256").update(launcher).digest("hex");
const windowsLauncherDigest = createHash("sha256").update(windowsLauncher).digest("hex");
const bundleDigest = createHash("sha256").update(readFileSync(bundlePath)).digest("hex");
const skillLibraryDigest = directorySha256(skillResourcePath);
writeFileSync(
  manifestPath,
  `${JSON.stringify({
    schemaVersion: 1,
    kind: "node-runtime-bundle",
    protocolVersion: 1,
    launcher: "vdt-local-runtime",
    entrypoint: "sidecars/vdt-local-runtime.mjs",
    launcherSha256: launcherDigest,
    windowsLauncherSha256: windowsLauncherDigest,
    bundleSha256: bundleDigest,
    skillLibrarySha256: skillLibraryDigest,
    selfContained: false,
    requiresNode: ">=24 <25"
  }, null, 2)}\n`,
  "utf8"
);
process.stdout.write(`Desktop sidecar runtime bundle prepared at ${bundlePath}\n`);
