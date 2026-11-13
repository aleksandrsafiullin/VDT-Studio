#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, symlinkSync,
  realpathSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { pnpmInvocation } from "./package-manager.mjs";

export const WINDOWS_NODE = Object.freeze({
  version: "24.22.2",
  archive: "node-v24.22.2-win-x64.zip",
  sha256: "ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2"
});
const SCRIPT = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(SCRIPT), "..");

export function buildEnvironment({ stage, version, sourceCommit, buildTime, inherited = process.env }) {
  if (!/^[a-f0-9]{40}$/.test(sourceCommit) || new Date(buildTime).toISOString() !== buildTime) {
    throw new Error("Windows build identity requires an exact commit and ISO UTC timestamp.");
  }
  const env = { ...inherited, CI: "true", CARGO_BUILD_JOBS: inherited.CARGO_BUILD_JOBS || "4",
    CARGO_INCREMENTAL: "0", CARGO_TARGET_DIR: join(stage, "cargo-target"),
    CARGO_HOME: join(stage, "cargo-home"), COREPACK_HOME: join(stage, "corepack"),
    XDG_CACHE_HOME: join(stage, "cache"), npm_config_cache: join(stage, "cache/npm"),
    PNPM_HOME: join(stage, "pnpm-home"),
    TMPDIR: join(stage, "temp"), TMP: join(stage, "temp"), TEMP: join(stage, "temp"),
    NEXT_TELEMETRY_DISABLED: "1", VDT_NEXT_STANDALONE: "1", VDT_DATA_DIR: join(stage, "data"),
    VDT_APP_MODE: "desktop", NEXT_PUBLIC_VDT_APP_MODE: "desktop",
    NEXT_PUBLIC_VDT_BUILD_VERSION: version, NEXT_PUBLIC_VDT_BUILD_COMMIT: sourceCommit,
    NEXT_PUBLIC_VDT_BUILD_DIRTY: "false", NEXT_PUBLIC_VDT_BUILD_TIME: buildTime };
  for (const name of ["NODE_OPTIONS", "NODE_PATH", "VDT_NEXT_DIST_DIR", "VDT_DESKTOP_SELF_CONTAINED_SIDECAR"]) delete env[name];
  return env;
}

function inside(root, file) {
  const name = relative(root, file);
  return name !== ".." && !name.startsWith(`..${sep}`) && !isAbsolute(name);
}

export function verifyResourceTree(root, archivedSource) {
  const base = realpathSync(root);
  const source = archivedSource && realpathSync(archivedSource);
  for (const entry of readdirSync(base, { withFileTypes: true, recursive: true })) {
    const file = join(entry.parentPath, entry.name);
    const name = relative(base, file);
    if ([".env", ".vdt", ".npmrc", ".git"].includes(entry.name) || entry.name.startsWith(".env.")) {
      throw new Error(`Private resource must not enter a Windows package: ${name}`);
    }
    if (!entry.isSymbolicLink()) continue;
    const target = resolve(dirname(file), readlinkSync(file));
    if (inside(base, target)) continue;
    // Next recreates traced pnpm junctions using their original absolute
    // checkout targets. Relocate only to a counterpart already traced.
    const relocated = source && inside(source, target) ? join(base, relative(source, target)) : null;
    if (!relocated || !inside(base, relocated) || !existsSync(relocated)) {
      throw new Error(`Package resource link escapes its root: ${name}`);
    }
    const type = lstatSync(relocated).isDirectory() ? "junction" : "file";
    rmSync(file);
    symlinkSync(relocated, file, type);
  }
  for (const entry of readdirSync(base, { withFileTypes: true, recursive: true })) {
    if (!entry.isSymbolicLink()) continue;
    const file = join(entry.parentPath, entry.name);
    let target;
    try { target = realpathSync(file); }
    catch { throw new Error(`Package resource link cannot be resolved: ${relative(base, file)}`); }
    if (target === base || !inside(base, target) || inside(target, dirname(file))) {
      throw new Error(`Package resource link escapes its root or creates a cycle: ${relative(base, file)}`);
    }
  }
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: "inherit", windowsHide: true, ...options });
}
function pnpm(args, options) {
  const invocation = pnpmInvocation(args, { env: options.env });
  return run(invocation.command, invocation.args, options);
}
function hash(file) { return createHash("sha256").update(readFileSync(file)).digest("hex"); }
function freeSpace(path) {
  const stats = statfsSync(path);
  if (Number(stats.bavail) * Number(stats.bsize) < 10 * 1024 ** 3) {
    throw new Error(`The native build requires 10 GiB free on ${path}.`);
  }
}
function signature(path, env) {
  const script = "$s=Get-AuthenticodeSignature -LiteralPath $env:VDT_VERIFY_FILE; " +
    "@{status=$s.Status.ToString();thumbprint=$s.SignerCertificate.Thumbprint}|ConvertTo-Json -Compress";
  return JSON.parse(run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...env, VDT_VERIFY_FILE: path }, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8"
  }));
}

function stageStorageAddon({ source, stage, native, env, thumbprint, unsigned }) {
  const output = join(stage, "storage-addon");
  const build = join(source, "packages/vdt-storage/native/build-windows-storage-addon.ps1");
  run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", build, "-OutputDirectory", output], { cwd: source, env });
  const binary = join(native, "runtime/windows-storage.node");
  cpSync(join(output, "windows-storage.node"), binary);
  if (!unsigned) {
    const sdkRoot = join(env["ProgramFiles(x86)"], "Windows Kits/10/bin");
    const versions = readdirSync(sdkRoot)
      .filter((version) => /^10\.0\.\d+\.\d+$/.test(version))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    const signtool = versions.map((version) => join(sdkRoot, version, "x64/signtool.exe")).find(existsSync);
    if (!signtool) throw new Error("Windows SDK x64 SignTool is required to sign the native storage addon.");
    run(signtool, ["sign", "/sha1", thumbprint, "/fd", "SHA256", "/tr", "http://timestamp.digicert.com",
      "/td", "SHA256", binary], { cwd: source, env });
    const trust = signature(binary, env);
    if (trust.status !== "Valid" || trust.thumbprint?.toLowerCase() !== thumbprint.toLowerCase()) {
      throw new Error("Windows native storage addon Authenticode verification failed.");
    }
  }
  const manifest = { schemaVersion: 1, fileName: "windows-storage.node", architecture: "x64",
    nodeApiVersion: 8, nodeVersion: WINDOWS_NODE.version, sha256: hash(binary) };
  writeFileSync(join(native, "runtime/windows-storage.manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return join(output, "windows-storage-dependents.txt");
}

export async function packageWindows(args = process.argv.slice(2)) {
  const unsigned = args.includes("--allow-unsigned-validation");
  const positional = args.filter((arg) => arg !== "--allow-unsigned-validation");
  if (positional.length < 1 || positional.length > 2 || positional.some((arg) => arg.startsWith("--"))) {
    throw new Error("Usage: pnpm desktop:package:windows EMPTY_OUTPUT_DIR [GIT_REF] [--allow-unsigned-validation]");
  }
  if (process.platform !== "win32" || process.arch !== "x64" || process.versions.node.split(".")[0] !== "24") {
    throw new Error("Windows packaging requires Windows x64 with Node 24; cross-host output is not native qualification.");
  }
  // Resolve pnpm before creating any output; a shell .cmd shim is never invoked.
  pnpmInvocation([], { env: process.env });
  const output = resolve(positional[0]);
  if (!isAbsolute(output)) throw new Error("The output directory must resolve to an absolute path.");
  mkdirSync(output, { recursive: true });
  if (readdirSync(output).length) throw new Error("The Windows output directory must be empty.");
  freeSpace(output);
  const sourceCommit = run("git", ["rev-parse", "--verify", `${positional[1] || "HEAD"}^{commit}`], {
    cwd: REPO, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8"
  }).trim();
  const thumbprint = process.env.VDT_WINDOWS_CERTIFICATE_THUMBPRINT?.trim();
  if (!unsigned && !/^[a-f0-9]{40}$/i.test(thumbprint || "")) {
    throw new Error("Set VDT_WINDOWS_CERTIFICATE_THUMBPRINT for a signed candidate, or explicitly select --allow-unsigned-validation.");
  }
  const stage = mkdtempSync(join(output, ".vdt-windows-stage-"));
  const marker = join(stage, ".owned-by-vdt-windows-package");
  writeFileSync(marker, sourceCommit);
  try {
    for (const name of ["source", "data", "temp", "cargo-home", "corepack", "cache", "pnpm-home"]) mkdirSync(join(stage, name));
    run("git", ["archive", "--format=tar", `--output=${join(stage, "source.tar")}`, sourceCommit], { cwd: REPO });
    run("tar.exe", ["-xf", join(stage, "source.tar"), "-C", join(stage, "source")]);
    const source = join(stage, "source");
    const version = JSON.parse(readFileSync(join(source, "package.json"), "utf8")).version;
    const desktopVersion = JSON.parse(readFileSync(join(source, "apps/desktop/package.json"), "utf8")).version;
    if (version !== desktopVersion) throw new Error("Root and desktop candidate versions differ.");
    const buildTime = new Date().toISOString();
    const env = buildEnvironment({ stage, version, sourceCommit, buildTime });
    const buildInfo = { version, sourceCommit, dirty: false, buildTime, platform: "win32", architecture: "x64" };
    pnpm(["install", "--frozen-lockfile", "--store-dir", join(stage, "pnpm-store")], { cwd: source, env });
    pnpm(["desktop:sidecar:prepare"], { cwd: source, env });
    pnpm(["desktop:verify"], { cwd: source, env });
    // NFT resolves Windows profile-relative paths while tracing. Keep its
    // profile inside the owned stage and leave native tool discovery alone.
    const buildProfile = join(stage, "build-profile");
    const webEnv = { ...env, USERPROFILE: buildProfile,
      LOCALAPPDATA: join(buildProfile, "AppData", "Local"),
      APPDATA: join(buildProfile, "AppData", "Roaming") };
    mkdirSync(webEnv.LOCALAPPDATA, { recursive: true });
    mkdirSync(webEnv.APPDATA, { recursive: true });
    pnpm(["build:web"], { cwd: source, env: webEnv });
    const web = join(source, "apps/web");
    for (const resource of ["public", ".next/static", ".next/server/chunks/static"]) {
      cpSync(join(web, resource), join(web, ".next/standalone/apps/web", resource), { recursive: true, dereference: false, verbatimSymlinks: true });
    }
    verifyResourceTree(join(web, ".next/standalone"), source);
    const response = await fetch(`https://nodejs.org/dist/v${WINDOWS_NODE.version}/${WINDOWS_NODE.archive}`, {
      signal: AbortSignal.timeout(120_000)
    });
    if (!response.ok) throw new Error(`Pinned Node download failed: HTTP ${response.status}.`);
    const nodeBytes = Buffer.from(await response.arrayBuffer());
    if (nodeBytes.length > 100 * 1024 ** 2 || createHash("sha256").update(nodeBytes).digest("hex") !== WINDOWS_NODE.sha256) {
      throw new Error("Pinned Windows Node archive checksum mismatch.");
    }
    const archive = join(stage, WINDOWS_NODE.archive);
    writeFileSync(archive, nodeBytes);
    run("tar.exe", ["-xf", archive, "-C", stage]);
    const native = join(source, "apps/desktop/src-tauri");
    const resources = JSON.parse(readFileSync(join(native, "tauri.windows.conf.json"), "utf8")).bundle.resources;
    mkdirSync(join(native, "runtime"));
    const nodeRoot = join(stage, WINDOWS_NODE.archive.slice(0, -4));
    cpSync(join(nodeRoot, "node.exe"), join(native, "runtime/node.exe"));
    cpSync(join(nodeRoot, "LICENSE"), join(native, "runtime/LICENSE-Node.txt"));
    const storageEnv = { ...env, Path: [nodeRoot, env.Path ?? env.PATH ?? ""].join(";") };
    delete storageEnv.PATH;
    const storageDependents = stageStorageAddon({ source, stage, native, env: storageEnv, thumbprint, unsigned });
    cpSync(join(source, "LICENSE"), join(native, "LICENSE-VDT-Studio.txt"));
    cpSync(join(source, "apps/desktop/packaged-web.cjs"), join(native, "packaged-web.cjs"));
    cpSync(join(source, "apps/desktop/windows-runtime.cjs"), join(native, "windows-runtime.cjs"));
    cpSync(join(source, "packages/data-harness/src/parser-worker.manifest.json"), join(native, "parser-worker.manifest.json"));
    // Materialize only the already checked internal links, avoiding Windows
    // symlink privileges and absolute staging junctions in the installed app.
    cpSync(join(web, ".next/standalone"), join(native, "web"), { recursive: true, dereference: true });
    writeFileSync(join(native, "build-info.json"), JSON.stringify(buildInfo, null, 2) + "\n");
    const signingConfig = join(stage, "windows-signing.json");
    writeFileSync(signingConfig, JSON.stringify({ bundle: { windows: unsigned
      ? { certificateThumbprint: null, signCommand: null }
      : { certificateThumbprint: thumbprint, digestAlgorithm: "sha256", tsp: true,
          timestampUrl: "http://timestamp.digicert.com" } } }));
    pnpm(["exec", "tauri", "icon", "../web/public/favicon.svg", "--output", join(native, "icons")], {
      cwd: join(source, "apps/desktop"), env
    });
    pnpm(["exec", "tauri", "build", "--bundles", "nsis", "--ci", "--target", "x86_64-pc-windows-msvc",
      "--config", signingConfig, "--", "--locked"], { cwd: join(source, "apps/desktop"), env });
    const release = join(env.CARGO_TARGET_DIR, "x86_64-pc-windows-msvc/release");
    const installers = readdirSync(join(release, "bundle/nsis")).filter((file) => file.endsWith("-setup.exe"));
    if (installers.length !== 1) throw new Error("Expected exactly one Windows installer.");
    const installerName = `VDT-Studio-${version}-x64-setup.exe`;
    const builtInstaller = join(release, "bundle/nsis", installers[0]);
    const builtApplication = join(release, "vdt-studio-desktop.exe");
    const installerSignature = signature(builtInstaller, env);
    const applicationSignature = signature(builtApplication, env);
    const nodeSignature = signature(join(native, "runtime/node.exe"), env);
    if (!unsigned && ([installerSignature, applicationSignature, nodeSignature].some((value) => value.status !== "Valid") ||
        [installerSignature, applicationSignature].some((value) => value.thumbprint?.toLowerCase() !== thumbprint.toLowerCase()))) {
      throw new Error("Native Authenticode verification failed for the installer, application or bundled Node.");
    }
    const application = join(output, "application");
    mkdirSync(application);
    cpSync(builtApplication, join(application, "vdt-studio-desktop.exe"));
    for (const resource of resources) {
      const target = join(application, resource);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(join(native, resource), target, { recursive: true, dereference: true });
    }
    verifyResourceTree(application);
    cpSync(builtInstaller, join(output, installerName));
    cpSync(storageDependents, join(output, "windows-storage-dependents.txt"));
    const sha256 = hash(join(output, installerName));
    writeFileSync(join(output, "SHA256SUMS"), `${sha256}  ${installerName}\n`);
    writeFileSync(join(output, "SOURCE_COMMIT"), sourceCommit + "\n");
    writeFileSync(join(output, "windows-package.json"), JSON.stringify({
      schemaVersion: 1, ...buildInfo, nodeVersion: WINDOWS_NODE.version,
      installer: { fileName: installerName, sha256, signatureStatus: installerSignature.status },
      applicationSignature, nodeSignature, signed: !unsigned, qualification: "unverified",
      validationOnly: unsigned, note: "A successful build does not qualify Windows storage or clean-machine use."
    }, null, 2) + "\n");
    return { output, sourceCommit, installerName, signed: !unsigned };
  } finally {
    // All build subprocesses are synchronous and have returned before cleanup.
    // Never remove an existing/shared cache, profile or another build's stage.
    if (existsSync(marker) && readFileSync(marker, "utf8") === sourceCommit && dirname(stage) === output) {
      rmSync(stage, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT) {
  packageWindows().then((result) => console.log(JSON.stringify(result))).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
