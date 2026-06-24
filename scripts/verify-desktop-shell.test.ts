import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyDesktopShell } from "./verify-desktop-shell.mjs";

const tempDirs: string[] = [];

const commands = [
  "ai_list_backends",
  "ai_test_backend",
  "ai_list_models",
  "ai_complete",
  "ai_cancel",
  "ai_get_run",
  "open_provider_auth",
  "get_app_mode"
];

async function writeFixture(options: {
  permission?: string;
  packageDependency?: string;
  directProcessSpawn?: boolean;
  missingAutoStart?: boolean;
  missingRuntimeCleanup?: boolean;
  missingIntegrityGuard?: boolean;
  missingStartupTimeout?: boolean;
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vdt-desktop-fixture-"));
  tempDirs.push(root);
  await mkdir(path.join(root, "apps/desktop/src-tauri/src"), { recursive: true });
  await mkdir(path.join(root, "apps/desktop/src-tauri/capabilities"), { recursive: true });

  await writeFile(
    path.join(root, "apps/desktop/package.json"),
    JSON.stringify({
      name: "@vdt-studio/desktop",
      version: "0.1.0",
      private: true,
      dependencies: options.packageDependency ? { [options.packageDependency]: "1.0.0" } : {}
    })
  );
  await writeFile(
    path.join(root, "apps/desktop/src-tauri/tauri.conf.json"),
    JSON.stringify({
      identifier: "com.vdtstudio.desktop",
      build: {
        beforeDevCommand: "NEXT_PUBLIC_VDT_APP_MODE=desktop pnpm --filter @vdt-studio/web dev",
        beforeBuildCommand: "NEXT_PUBLIC_VDT_APP_MODE=desktop pnpm --filter @vdt-studio/web build"
      },
      bundle: {
        active: true,
        targets: ["all"],
        resources: [
          "sidecars/vdt-local-runtime",
          "sidecars/vdt-local-runtime.cmd",
          "sidecars/vdt-local-runtime.mjs",
          "sidecars/vdt-local-runtime.manifest.json"
        ],
        macOS: { signingIdentity: "-" }
      }
    })
  );
  await writeFile(
    path.join(root, "apps/desktop/src-tauri/capabilities/default.json"),
    JSON.stringify({ permissions: options.permission ? [options.permission] : [] })
  );
  await writeFile(path.join(root, "apps/desktop/src-tauri/Cargo.toml"), "[package]\nname = \"desktop\"\n[dependencies]\nsha2 = \"0.10\"\n");
  await writeFile(
    path.join(root, "apps/desktop/src-tauri/src/lib.rs"),
    [
      "mod sidecar_host;",
      "use sidecar_host::DesktopRuntime;",
      ...(options.directProcessSpawn ? ["use std::process::Command;"] : []),
      ...commands.map((command) => `fn ${command}() {}`),
      "fn checked_auth(backend_id: String, runtime: DesktopRuntime) { runtime.open_provider_auth(&backend_id); }",
      options.missingAutoStart
        ? "fn run() { tauri::Builder::default().manage(DesktopRuntime::default()); }"
        : "fn run() { tauri::Builder::default().manage(DesktopRuntime::default()).setup(|app| { let runtime = app.state::<DesktopRuntime>(); let resource_dir = app.path().resource_dir().unwrap(); runtime.set_resource_dir(resource_dir); runtime.start(); Ok(()) }); }"
    ].join("\n")
  );
  await writeFile(
    path.join(root, "apps/desktop/src-tauri/src/sidecar_host.rs"),
    [
      "use std::process::{Command, Stdio};",
      "use sha2::{Digest, Sha256};",
      "pub struct DesktopRuntime;",
      "impl Default for DesktopRuntime { fn default() -> Self { Self } }",
      "const PACKAGED_SIDECAR_RELATIVE_PATH: &str = \"sidecars/vdt-local-runtime\";",
      "const WINDOWS_PACKAGED_SIDECAR_RELATIVE_PATH: &str = \"sidecars/vdt-local-runtime.cmd\";",
      "const PACKAGED_SIDECAR_RELATIVE_PATHS: &[&str] = &[PACKAGED_SIDECAR_RELATIVE_PATH, WINDOWS_PACKAGED_SIDECAR_RELATIVE_PATH];",
      "const DEV_SIDECAR_PATH_ENV: &str = \"VDT_DESKTOP_SIDECAR_PATH\";",
      "const NODE_BUNDLE_KIND: &str = \"node-runtime-bundle\";",
      "const SELF_CONTAINED_KIND: &str = \"self-contained-sidecar\";",
      "const STARTUP_HANDSHAKE_TIMEOUT_MS: u64 = 5000;",
      "const MAX_CRASH_RESTARTS: usize = 3;",
      "const SIDECAR_CRASH_LOOP: &str = \"SIDECAR_CRASH_LOOP\";",
      "impl DesktopRuntime { pub fn set_resource_dir(&self, resource_dir: std::path::PathBuf) {} pub fn start(&self) { self.lock_or_start()?; } fn lock_or_start(&self) {} }",
      ...(options.missingRuntimeCleanup ? [] : ["impl Drop for DesktopRuntime { fn drop(&mut self) { let mut sidecar = Some(()); drop(sidecar.take()); } }"]),
      "fn complete(mut request: serde_json::Value) { let payload = request.as_object_mut().unwrap(); payload.remove(\"requestId\"); payload.remove(\"providerId\"); }",
      "struct SidecarManifest { launcher_sha256: String, windows_launcher_sha256: String, bundle_sha256: String, sidecar_sha256: String }",
      "fn verify_sidecar_integrity(binary: &std::path::PathBuf) -> Result<(), &'static str> { let _hasher = Sha256::new(); let _ = NODE_BUNDLE_KIND; let _ = SELF_CONTAINED_KIND; let _ = SidecarManifest { launcher_sha256: String::new(), windows_launcher_sha256: String::new(), bundle_sha256: String::new(), sidecar_sha256: String::new() }; Err(\"SIDECAR_INTEGRITY_FAILED\") }",
      ...(options.missingStartupTimeout ? [] : ["fn read_startup_frame() { recv_timeout(); let _ = \"SIDECAR_START_TIMEOUT\"; let mut child = spawn(); child.kill(); child.wait(); }"]),
      options.missingIntegrityGuard
        ? "fn start(binary: std::path::PathBuf) { let _child = Command::new(&binary).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn(); }"
        : "fn start(binary: std::path::PathBuf) { verify_sidecar_integrity(&binary)?; read_startup_frame(); let _child = Command::new(&binary).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn(); }",
      "struct SidecarProcess { child: std::process::Child }",
      "impl Drop for SidecarProcess { fn drop(&mut self) { self.child.kill(); self.child.wait(); } }"
    ].join("\n")
  );
  return root;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("verify-desktop-shell", () => {
  it("passes the current desktop scaffold", () => {
    expect(verifyDesktopShell()).toMatchObject({ commandCount: 8 });
  });

  it("fails if a generic native permission is enabled", async () => {
    const root = await writeFixture({ permission: "fs:default" });
    expect(() => verifyDesktopShell(root)).toThrow(/default desktop capability must not enable generic permissions/);
  });

  it("fails if a banned plugin dependency is declared", async () => {
    const root = await writeFixture({ packageDependency: "@tauri-apps/plugin-shell" });
    expect(() => verifyDesktopShell(root)).toThrow(/declares banned desktop dependency/);
  });

  it("fails if process spawning leaks into the Tauri command surface", async () => {
    const root = await writeFixture({ directProcessSpawn: true });
    expect(() => verifyDesktopShell(root)).toThrow(/must not spawn processes directly/);
  });

  it("fails if the desktop runtime is not auto-started during setup", async () => {
    const root = await writeFixture({ missingAutoStart: true });
    expect(() => verifyDesktopShell(root)).toThrow(/auto-started during app setup/);
  });

  it("fails if desktop runtime cleanup is missing", async () => {
    const root = await writeFixture({ missingRuntimeCleanup: true });
    expect(() => verifyDesktopShell(root)).toThrow(/clean up the sidecar process/);
  });

  it("fails if sidecar integrity is not checked before launch", async () => {
    const root = await writeFixture({ missingIntegrityGuard: true });
    expect(() => verifyDesktopShell(root)).toThrow(/verify sidecar integrity before launch/);
  });

  it("fails if sidecar startup handshake timeout is missing", async () => {
    const root = await writeFixture({ missingStartupTimeout: true });
    expect(() => verifyDesktopShell(root)).toThrow(/startup handshake must fail closed on timeout/);
  });
});
