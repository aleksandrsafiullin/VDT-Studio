import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = resolve(dirname(SCRIPT_PATH), "..");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function commandVersion(command, args, options = {}) {
  try {
    return {
      ok: true,
      output: execFileSync(command, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }).trim()
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, output: message };
  }
}

function addBlocker(blockers, code, message, evidence) {
  blockers.push({ code, message, evidence });
}

export function verifyDesktopNativeReadiness(root = DEFAULT_ROOT, env = process.env) {
  const blockers = [];
  const warnings = [];
  const versions = {};

  const cargo = commandVersion("cargo", ["--version"], { cwd: root, env });
  versions.cargo = cargo.ok ? cargo.output : null;
  if (!cargo.ok) addBlocker(blockers, "MISSING_CARGO", "Rust Cargo is required for native Tauri build verification.", cargo.output);

  const rustc = commandVersion("rustc", ["--version"], { cwd: root, env });
  versions.rustc = rustc.ok ? rustc.output : null;
  if (!rustc.ok) addBlocker(blockers, "MISSING_RUSTC", "rustc is required for native Tauri build verification.", rustc.output);

  const tauri = commandVersion("pnpm", ["--filter", "@vdt-studio/desktop", "exec", "tauri", "--version"], {
    cwd: root,
    env
  });
  versions.tauri = tauri.ok ? tauri.output : null;
  if (!tauri.ok) {
    addBlocker(
      blockers,
      "MISSING_TAURI_CLI",
      "The desktop workspace must expose the Tauri CLI before native build verification can run.",
      tauri.output
    );
  }

  const desktopPackage = readJson(join(root, "apps/desktop/package.json"));
  const desktopDependencies = {
    ...(desktopPackage.dependencies ?? {}),
    ...(desktopPackage.devDependencies ?? {}),
    ...(desktopPackage.optionalDependencies ?? {})
  };
  if (!desktopDependencies["@tauri-apps/cli"]) {
    addBlocker(
      blockers,
      "TAURI_CLI_NOT_PINNED",
      "apps/desktop/package.json must pin @tauri-apps/cli so clean installs can run tauri build reproducibly.",
      "missing @tauri-apps/cli dependency"
    );
  }

  const tauriConfig = readJson(join(root, "apps/desktop/src-tauri/tauri.conf.json"));
  const signingIdentity = tauriConfig.bundle?.macOS?.signingIdentity;
  if (signingIdentity === "-" || typeof signingIdentity !== "string" || signingIdentity.trim().length === 0) {
    addBlocker(
      blockers,
      "UNSIGNED_MACOS_BUNDLE",
      "macOS signing identity must be configured before signed desktop installers can be claimed.",
      `signingIdentity=${JSON.stringify(signingIdentity)}`
    );
  }

  const targets = tauriConfig.bundle?.targets;
  if (!Array.isArray(targets) || !targets.some((target) => target === "dmg" || target === "all")) {
    addBlocker(
      blockers,
      "MISSING_MACOS_INSTALLER_TARGET",
      "Desktop release config must include a macOS installer target such as dmg or all.",
      `targets=${JSON.stringify(targets)}`
    );
  }
  if (!Array.isArray(targets) || !targets.some((target) => target === "msi" || target === "nsis" || target === "all")) {
    addBlocker(
      blockers,
      "MISSING_WINDOWS_INSTALLER_TARGET",
      "Desktop release config must include a Windows installer target such as msi, nsis or all.",
      `targets=${JSON.stringify(targets)}`
    );
  }

  const sidecarManifest = readJson(join(root, "apps/desktop/src-tauri/sidecars/vdt-local-runtime.manifest.json"));
  if (sidecarManifest.selfContained !== true) {
    addBlocker(
      blockers,
      "SIDECAR_NOT_SELF_CONTAINED",
      "The embedded runtime sidecar must be a self-contained binary before clean desktop installs can avoid a separate Node requirement.",
      `selfContained=${JSON.stringify(sidecarManifest.selfContained)}`
    );
  }
  if (sidecarManifest.requiresNode) {
    addBlocker(
      blockers,
      "SIDECAR_REQUIRES_NODE",
      "The production desktop sidecar must not require a separate Node installation.",
      `requiresNode=${JSON.stringify(sidecarManifest.requiresNode)}`
    );
  }

  const resources = tauriConfig.bundle?.resources;
  const requiredResources = sidecarManifest.selfContained === true
    ? ["sidecars/vdt-local-runtime", "sidecars/vdt-local-runtime.manifest.json"]
    : [
        "sidecars/vdt-local-runtime",
        "sidecars/vdt-local-runtime.cmd",
        "sidecars/vdt-local-runtime.mjs",
        "sidecars/vdt-local-runtime.manifest.json",
        "sidecars/vdt-agent-skills"
      ];
  for (const required of requiredResources) {
    if (!Array.isArray(resources) || !resources.includes(required)) {
      addBlocker(blockers, "MISSING_SIDECAR_RESOURCE", `Desktop bundle resources must include ${required}.`, `resources=${JSON.stringify(resources)}`);
    }
  }

  if (tauriConfig.bundle?.active !== true) {
    addBlocker(blockers, "BUNDLE_DISABLED", "Tauri bundle.active must be true for native release builds.", `active=${JSON.stringify(tauriConfig.bundle?.active)}`);
  }

  if (versions.cargo && versions.rustc && versions.tauri && blockers.length > 0) {
    warnings.push("Native toolchain is present, but release configuration still has blockers.");
  }

  return {
    ok: blockers.length === 0,
    versions,
    blockers,
    warnings
  };
}

if (process.argv[1] === SCRIPT_PATH) {
  const result = verifyDesktopNativeReadiness(DEFAULT_ROOT);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}
