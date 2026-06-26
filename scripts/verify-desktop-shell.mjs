import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = resolve(dirname(SCRIPT_PATH), "..");

const REQUIRED_COMMANDS = [
  "ai_list_backends",
  "ai_detect_subscription_clis",
  "ai_test_backend",
  "ai_list_models",
  "ai_complete",
  "ai_cancel",
  "ai_get_run",
  "open_provider_auth",
  "get_app_mode"
];

const BANNED_TERMS = [
  "shell",
  "run_command",
  "execute",
  "read_file",
  "write_file",
  "open_path",
  "@tauri-apps/plugin-shell",
  "@tauri-apps/plugin-fs",
  "@tauri-apps/plugin-opener",
  "tauri-plugin-shell",
  "tauri-plugin-fs"
];

function read(root, relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function fail(message) {
  throw new Error(`Desktop shell verification failed: ${message}`);
}

export function verifyDesktopShell(root = DEFAULT_ROOT) {
  const packageJson = JSON.parse(read(root, "apps/desktop/package.json"));
  if (packageJson.name !== "@vdt-studio/desktop") fail("apps/desktop/package.json has the wrong package name.");

  const tauriConfig = JSON.parse(read(root, "apps/desktop/src-tauri/tauri.conf.json"));
  if (tauriConfig.identifier !== "com.vdtstudio.desktop") fail("tauri identifier is not set.");
  if (!String(tauriConfig.build?.beforeDevCommand ?? "").includes("NEXT_PUBLIC_VDT_APP_MODE=desktop")) {
    fail("beforeDevCommand must force desktop app mode.");
  }
  if (!String(tauriConfig.build?.beforeBuildCommand ?? "").includes("NEXT_PUBLIC_VDT_APP_MODE=desktop")) {
    fail("beforeBuildCommand must force desktop app mode.");
  }
  if (tauriConfig.bundle?.active !== true) fail("desktop bundle must be active.");
  const targets = tauriConfig.bundle?.targets;
  if (!Array.isArray(targets) || !(targets.includes("all") || (targets.includes("dmg") && (targets.includes("msi") || targets.includes("nsis"))))) {
    fail("desktop bundle targets must cover both macOS and Windows installers.");
  }
  const resources = tauriConfig.bundle?.resources;
  if (!Array.isArray(resources) || !resources.includes("sidecars/vdt-local-runtime")) {
    fail("desktop bundle must include the reviewed sidecar launcher resource.");
  }
  if (!resources.includes("sidecars/vdt-local-runtime.cmd")) {
    fail("desktop bundle must include the Windows sidecar launcher resource.");
  }
  if (!resources.includes("sidecars/vdt-local-runtime.mjs")) {
    fail("desktop bundle must include the bundled sidecar runtime resource.");
  }
  if (!resources.includes("sidecars/vdt-local-runtime.manifest.json")) {
    fail("desktop bundle must include the sidecar integrity manifest resource.");
  }
  if (!resources.includes("sidecars/vdt-agent-skills")) {
    fail("desktop bundle must include the packaged VDT agent skill library resource.");
  }
  if (tauriConfig.bundle?.macOS?.signingIdentity !== "-") fail("macOS signing identity placeholder must be explicit.");

  const capability = JSON.parse(read(root, "apps/desktop/src-tauri/capabilities/default.json"));
  if (Array.isArray(capability.permissions) && capability.permissions.length > 0) {
    fail("default desktop capability must not enable generic permissions.");
  }

  const rustSource = read(root, "apps/desktop/src-tauri/src/lib.rs");
  for (const command of REQUIRED_COMMANDS) {
    if (!rustSource.includes(`fn ${command}`)) fail(`missing reviewed command implementation: ${command}.`);
    if (!rustSource.includes(command)) fail(`missing reviewed command handler: ${command}.`);
  }
  if (!rustSource.includes("mod sidecar_host;")) fail("desktop runtime sidecar host module is not registered.");
  if (!rustSource.includes(".manage(DesktopRuntime::default())")) fail("desktop runtime state is not managed by Tauri.");
  if (!rustSource.includes(".setup(|app|")) fail("desktop runtime sidecar must be auto-started during app setup.");
  if (!rustSource.includes("app.state::<DesktopRuntime>()")) fail("desktop setup must retrieve the managed runtime state.");
  if (!rustSource.includes("app.path().resource_dir()") || !rustSource.includes("runtime.set_resource_dir(")) {
    fail("desktop setup must pass the Tauri resource directory to the sidecar host.");
  }
  if (!rustSource.includes("runtime.start()")) fail("desktop setup must start the managed runtime sidecar.");
  if (rustSource.includes("DESKTOP_LOCAL_AI_PLACEHOLDER")) fail("desktop command surface still returns placeholder local AI responses.");
  if (!rustSource.includes(".open_provider_auth(&backend_id)")) {
    fail("open_provider_auth must delegate to the reviewed desktop runtime sidecar host.");
  }
  if (!rustSource.includes(".detect_subscription_clis(agent_id.as_deref())")) {
    fail("ai_detect_subscription_clis must delegate to the reviewed desktop runtime sidecar host.");
  }
  if (rustSource.includes("std::process") || rustSource.includes("Command::new")) {
    fail("desktop command surface must not spawn processes directly.");
  }

  const sidecarHost = read(root, "apps/desktop/src-tauri/src/sidecar_host.rs");
  const cargoToml = read(root, "apps/desktop/src-tauri/Cargo.toml");
  if (!cargoToml.includes("sha2")) fail("desktop sidecar host must declare a SHA-256 implementation dependency.");
  if (!sidecarHost.includes("Command::new(&binary)")) fail("sidecar host must start only the reviewed sidecar binary path.");
  if (!sidecarHost.includes(".stdin(Stdio::piped())") || !sidecarHost.includes(".stdout(Stdio::piped())")) {
    fail("sidecar host must communicate through private stdio pipes.");
  }
  if (sidecarHost.includes(".arg(") || sidecarHost.includes(".args(")) {
    fail("sidecar host must not pass arbitrary command arguments.");
  }
  if (!sidecarHost.includes("PACKAGED_SIDECAR_RELATIVE_PATH")) fail("sidecar host must define a packaged sidecar path.");
  if (!sidecarHost.includes("WINDOWS_PACKAGED_SIDECAR_RELATIVE_PATH")) fail("sidecar host must define a Windows sidecar launcher path.");
  if (!sidecarHost.includes("PACKAGED_SIDECAR_RELATIVE_PATHS")) fail("sidecar host must resolve platform-specific sidecar paths.");
  if (!sidecarHost.includes("set_resource_dir")) fail("sidecar host must receive the Tauri resource directory.");
  if (!sidecarHost.includes("VDT_DESKTOP_SIDECAR_PATH")) fail("sidecar host must make the development sidecar override explicit.");
  if (!sidecarHost.includes("verify_sidecar_integrity(&binary)?")) fail("sidecar host must verify sidecar integrity before launch.");
  if (!sidecarHost.includes("struct SidecarManifest")) fail("sidecar host must parse the sidecar integrity manifest.");
  if (!sidecarHost.includes("sha2::{Digest, Sha256}") || !sidecarHost.includes("Sha256::new()")) {
    fail("sidecar host must verify sidecar SHA-256 digests before launch.");
  }
  for (const field of ["launcher_sha256", "windows_launcher_sha256", "bundle_sha256", "sidecar_sha256"]) {
    if (!sidecarHost.includes(field)) fail(`sidecar host must validate manifest field: ${field}.`);
  }
  if (!sidecarHost.includes("SIDECAR_INTEGRITY_FAILED")) fail("sidecar host must fail closed on sidecar integrity errors.");
  if (!sidecarHost.includes("NODE_BUNDLE_KIND") || !sidecarHost.includes("SELF_CONTAINED_KIND")) {
    fail("sidecar host must support both current Node-bundle and future self-contained sidecar manifests.");
  }
  if (!sidecarHost.includes('payload.remove("requestId")')) fail("sidecar host must remove requestId from completion payload before pipe transport.");
  if (!sidecarHost.includes('payload.remove("providerId")')) fail("sidecar host must remove frontend-only providerId before pipe transport.");
  if (!sidecarHost.includes("MAX_CRASH_RESTARTS") || !sidecarHost.includes("SIDECAR_CRASH_LOOP")) {
    fail("sidecar host must enforce a bounded repeated-crash policy.");
  }
  if (!sidecarHost.includes("STARTUP_HANDSHAKE_TIMEOUT_MS") || !sidecarHost.includes("read_startup_frame")) {
    fail("sidecar host must enforce a bounded startup handshake timeout.");
  }
  if (!sidecarHost.includes("recv_timeout") || !sidecarHost.includes("SIDECAR_START_TIMEOUT")) {
    fail("sidecar host startup handshake must fail closed on timeout.");
  }
  if (!sidecarHost.includes("child.kill()") || !sidecarHost.includes("child.wait()")) {
    fail("sidecar host must terminate a child that fails startup.");
  }
  if (!sidecarHost.includes("pub fn start(&self)") || !sidecarHost.includes("self.lock_or_start()?")) {
    fail("desktop runtime must expose an explicit auto-start entrypoint.");
  }
  if (!sidecarHost.includes('self.request("detect_clis"')) {
    fail("desktop runtime must expose subscription CLI detection through the sidecar protocol.");
  }
  if (!sidecarHost.includes("impl Drop for DesktopRuntime") || !sidecarHost.includes("sidecar.take()")) {
    fail("desktop runtime must clean up the sidecar process on shutdown.");
  }
  if (!sidecarHost.includes("impl Drop for SidecarProcess") || !sidecarHost.includes("self.child.kill()") || !sidecarHost.includes("self.child.wait()")) {
    fail("sidecar process cleanup must terminate and wait for the child process.");
  }

  const scannedFiles = [
    "apps/desktop/src-tauri/Cargo.toml",
    "apps/desktop/src-tauri/tauri.conf.json",
    "apps/desktop/src-tauri/src/lib.rs",
    "apps/desktop/src-tauri/src/sidecar_host.rs",
    "apps/desktop/src-tauri/capabilities/default.json"
  ];
  for (const file of scannedFiles) {
    const text = read(root, file).toLowerCase();
    for (const banned of BANNED_TERMS) {
      if (text.includes(banned.toLowerCase())) fail(`${file} contains banned desktop capability term: ${banned}.`);
    }
  }

  const packageDependencyText = JSON.stringify({
    dependencies: packageJson.dependencies ?? {},
    devDependencies: packageJson.devDependencies ?? {},
    optionalDependencies: packageJson.optionalDependencies ?? {}
  }).toLowerCase();
  for (const banned of BANNED_TERMS) {
    if (packageDependencyText.includes(banned.toLowerCase())) {
      fail(`apps/desktop/package.json declares banned desktop dependency: ${banned}.`);
    }
  }

  return { commandCount: REQUIRED_COMMANDS.length };
}

if (process.argv[1] === SCRIPT_PATH) {
  const result = verifyDesktopShell(DEFAULT_ROOT);
  process.stdout.write(`Desktop shell verified: ${result.commandCount} reviewed commands; no generic shell/filesystem capability enabled.\n`);
}
