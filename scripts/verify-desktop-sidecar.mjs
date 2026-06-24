import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const SIDECAR_LAUNCHER = "apps/desktop/src-tauri/sidecars/vdt-local-runtime";
const SIDECAR_WINDOWS_LAUNCHER = "apps/desktop/src-tauri/sidecars/vdt-local-runtime.cmd";
const SIDECAR_BUNDLE = "apps/desktop/src-tauri/sidecars/vdt-local-runtime.mjs";
const SIDECAR_MANIFEST = "apps/desktop/src-tauri/sidecars/vdt-local-runtime.manifest.json";
const TAURI_RESOURCE_PATH = "sidecars/vdt-local-runtime";
const TAURI_WINDOWS_RESOURCE_PATH = "sidecars/vdt-local-runtime.cmd";
const TAURI_BUNDLE_RESOURCE_PATH = "sidecars/vdt-local-runtime.mjs";
const TAURI_MANIFEST_RESOURCE_PATH = "sidecars/vdt-local-runtime.manifest.json";

function fail(message) {
  throw new Error(`Desktop sidecar verification failed: ${message}`);
}

function verifyBundleMatchesSource(root, expectedDigest) {
  if (resolve(root) !== DEFAULT_ROOT) return;
  const tempDir = mkdtempSync(join(tmpdir(), "vdt-sidecar-build-"));
  const outputPath = join(tempDir, "vdt-local-runtime.mjs");
  try {
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
        `--outfile=${outputPath}`
      ],
      { cwd: root, stdio: "ignore" }
    );
    const rebuiltDigest = createHash("sha256").update(readFileSync(outputPath)).digest("hex");
    if (rebuiltDigest !== expectedDigest) {
      fail("sidecar runtime bundle is stale; run pnpm desktop:sidecar:prepare.");
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function verifyDesktopSidecar(root = DEFAULT_ROOT) {
  const tauriConfig = JSON.parse(readFileSync(join(root, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"));
  const manifestPath = join(root, SIDECAR_MANIFEST);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const resources = tauriConfig.bundle?.resources;
  if (!Array.isArray(resources) || !resources.includes(TAURI_RESOURCE_PATH)) {
    fail("tauri bundle resources must include the reviewed sidecar launcher.");
  }
  if (manifest.kind === "node-runtime-bundle" && !resources.includes(TAURI_WINDOWS_RESOURCE_PATH)) {
    fail("tauri bundle resources must include the Windows sidecar launcher.");
  }
  if (manifest.kind === "node-runtime-bundle" && !resources.includes(TAURI_BUNDLE_RESOURCE_PATH)) {
    fail("tauri bundle resources must include the bundled sidecar runtime.");
  }
  if (!resources.includes(TAURI_MANIFEST_RESOURCE_PATH)) {
    fail("tauri bundle resources must include the sidecar integrity manifest.");
  }

  const sidecarHost = readFileSync(join(root, "apps/desktop/src-tauri/src/sidecar_host.rs"), "utf8");
  if (!sidecarHost.includes(`PACKAGED_SIDECAR_RELATIVE_PATH: &str = "${TAURI_RESOURCE_PATH}"`)) {
    fail("Rust sidecar host packaged path must match the Tauri resource path.");
  }
  if (!sidecarHost.includes(`WINDOWS_PACKAGED_SIDECAR_RELATIVE_PATH: &str = "${TAURI_WINDOWS_RESOURCE_PATH}"`)) {
    fail("Rust sidecar host Windows packaged path must match the Tauri resource path.");
  }
  if (!sidecarHost.includes("PACKAGED_SIDECAR_RELATIVE_PATHS")) {
    fail("Rust sidecar host must resolve platform-specific sidecar launcher paths.");
  }

  const launcherPath = join(root, SIDECAR_LAUNCHER);
  const windowsLauncherPath = join(root, SIDECAR_WINDOWS_LAUNCHER);
  const bundlePath = join(root, SIDECAR_BUNDLE);
  const stat = statSync(launcherPath);
  if (!stat.isFile()) fail("sidecar launcher is not a file.");
  if ((stat.mode & 0o111) === 0) fail("sidecar launcher must be executable.");

  const text = readFileSync(launcherPath, "utf8");
  let windowsText = "";
  if (manifest.schemaVersion !== 1) fail("sidecar manifest schemaVersion must be 1.");
  if (manifest.protocolVersion !== 1) fail("sidecar manifest protocolVersion must be 1.");
  if (manifest.launcher !== "vdt-local-runtime") fail("sidecar manifest launcher name is incorrect.");
  const launcherDigest = createHash("sha256").update(text).digest("hex");

  if (manifest.kind === "self-contained-sidecar") {
    if (manifest.entrypoint !== TAURI_RESOURCE_PATH) fail("self-contained sidecar manifest entrypoint is incorrect.");
    if (manifest.selfContained !== true) fail("self-contained sidecar manifest must declare selfContained=true.");
    if (manifest.requiresNode) fail("self-contained sidecar manifest must not declare a Node runtime requirement.");
    if (manifest.sidecarSha256 !== launcherDigest) fail("self-contained sidecar SHA-256 does not match the integrity manifest.");
  } else if (manifest.kind === "node-runtime-bundle") {
    const bundleStat = statSync(bundlePath);
    const windowsStat = statSync(windowsLauncherPath);
    if (!bundleStat.isFile()) fail("sidecar runtime bundle is not a file.");
    if (!windowsStat.isFile()) fail("Windows sidecar launcher is not a file.");
    if (bundleStat.size < 50_000) fail("sidecar runtime bundle is unexpectedly small.");
    const bundle = readFileSync(bundlePath, "utf8");
    windowsText = readFileSync(windowsLauncherPath, "utf8");
    if (manifest.entrypoint !== TAURI_BUNDLE_RESOURCE_PATH) fail("sidecar manifest entrypoint is incorrect.");
    if (manifest.selfContained !== false) fail("node runtime bundle must not claim to be self-contained.");
    if (manifest.requiresNode !== ">=24 <25") fail("node runtime bundle must declare the Node runtime requirement.");
    const bundleDigest = createHash("sha256").update(bundle).digest("hex");
    if (manifest.launcherSha256 !== launcherDigest) fail("sidecar launcher SHA-256 does not match the integrity manifest.");
    if (manifest.windowsLauncherSha256 !== createHash("sha256").update(windowsText).digest("hex")) {
      fail("Windows sidecar launcher SHA-256 does not match the integrity manifest.");
    }
    if (manifest.bundleSha256 !== bundleDigest) fail("sidecar bundle SHA-256 does not match the integrity manifest.");
    verifyBundleMatchesSource(root, bundleDigest);
    if (!text.startsWith("#!/bin/sh")) fail("sidecar launcher must use an explicit POSIX shell shebang.");
    if (!windowsText.startsWith("@echo off")) fail("Windows sidecar launcher must use an explicit cmd entrypoint.");
    if (!text.includes("vdt-local-runtime.mjs")) fail("sidecar launcher must target the bundled runtime entrypoint.");
    if (!windowsText.includes("vdt-local-runtime.mjs")) fail("Windows sidecar launcher must target the bundled runtime entrypoint.");
    if (!bundle.includes("runLocalRuntimeSidecar")) fail("sidecar bundle must contain the reviewed runtime entrypoint.");
    if (/from\s+["']\.\.\//.test(bundle) || /packages\/local-runner\/src\/sidecar\/index\.ts/.test(bundle)) {
      fail("sidecar runtime bundle must not import workspace source files at runtime.");
    }
  } else {
    fail(`unsupported sidecar manifest kind: ${String(manifest.kind)}`);
  }

  if (text.includes("--import tsx") || text.includes("node_modules") || text.includes("packages/local-runner/src")) {
    fail("sidecar launcher must not depend on tsx, node_modules or workspace source paths.");
  }
  if (windowsText.includes("--import tsx") || windowsText.includes("node_modules") || windowsText.includes("packages/local-runner/src")) {
    fail("Windows sidecar launcher must not depend on tsx, node_modules or workspace source paths.");
  }
  if (/\b(?:TOKEN|SECRET|KEY|PASSWORD)=/.test(text)) fail("sidecar launcher must not embed secrets.");
  if (/\b(?:TOKEN|SECRET|KEY|PASSWORD)=/.test(windowsText)) fail("Windows sidecar launcher must not embed secrets.");
  if (text.includes("$@") || text.includes(" $*")) fail("sidecar launcher must not forward frontend-controlled arguments.");
  if (windowsText.includes("%*") || /%[1-9]/.test(windowsText)) fail("Windows sidecar launcher must not forward frontend-controlled arguments.");

  return {
    launcher: SIDECAR_LAUNCHER,
    windowsLauncher: SIDECAR_WINDOWS_LAUNCHER,
    bundle: SIDECAR_BUNDLE,
    manifest: SIDECAR_MANIFEST,
    sha256: launcherDigest
  };
}

if (process.argv[1] === SCRIPT_PATH) {
  const result = verifyDesktopSidecar(DEFAULT_ROOT);
  process.stdout.write(`Desktop sidecar verified: ${result.launcher}\n`);
}
