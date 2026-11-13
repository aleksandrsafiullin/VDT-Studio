import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { directorySha256 } from "./desktop-resources.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SHA = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const fail = (message) => { throw new Error(`Native alpha artifact verification failed: ${message}`); };
const digest = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

function file(root, relative) {
  const target = resolve(root, relative);
  if (!target.startsWith(resolve(root) + sep)) fail(`resource escapes package: ${relative}`);
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`resource is not a regular file: ${relative}`);
  if (!realpathSync(target).startsWith(realpathSync(root) + sep)) fail(`resource resolves outside package: ${relative}`);
  return target;
}

function json(root, relative) {
  const path = file(root, relative);
  if (lstatSync(path).size > 512 * 1024) fail(`metadata is too large: ${relative}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024, ...options });
  if (result.error || result.status !== 0) fail(`${command} failed: ${result.error?.message ?? result.stderr ?? result.status}`);
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
}

function verifyResources(resources) {
  file(resources, "packaged-web.cjs");
  file(resources, "web/apps/web/server.js");
  json(resources, "web/apps/web/.next/required-server-files.json");
  const sidecar = json(resources, "sidecars/vdt-local-runtime.manifest.json");
  if (sidecar.schemaVersion !== 1 || sidecar.protocolVersion !== 1 || sidecar.kind !== "node-runtime-bundle") fail("unexpected alpha sidecar contract");
  for (const [name, key] of [["vdt-local-runtime", "launcherSha256"], ["vdt-local-runtime.cmd", "windowsLauncherSha256"], ["vdt-local-runtime.mjs", "bundleSha256"]]) {
    if (!SHA.test(sidecar[key]) || digest(file(resources, `sidecars/${name}`)) !== sidecar[key]) fail(`sidecar hash mismatch: ${name}`);
  }
  if (!SHA.test(sidecar.skillLibrarySha256) || directorySha256(join(resources, "sidecars/vdt-agent-skills")) !== sidecar.skillLibrarySha256) fail("skill library hash mismatch");
  const worker = json(resources, "parser-worker.manifest.json");
  if (worker.schemaVersion !== 1 || worker.entrypoint !== "parser-worker.cjs" || !SHA.test(worker.sha256) || !Number.isSafeInteger(worker.byteLength) || worker.byteLength < 1) fail("invalid parser worker manifest");
  const server = join(resources, "web/apps/web/.next/server");
  let workerFound = false;
  for (const entry of readdirSync(server, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".cjs")) continue;
    const target = file(resources, join(entry.parentPath, entry.name).slice(resolve(resources).length + 1));
    if (lstatSync(target).size === worker.byteLength && digest(target) === worker.sha256) workerFound = true;
  }
  if (!workerFound) fail("the traced server has no parser worker matching the packaged manifest");
  return { sidecarSha256: sidecar.bundleSha256, skillLibrarySha256: sidecar.skillLibrarySha256, parserWorkerSha256: worker.sha256 };
}

/** Checks packaged bytes and OS trust. This does not certify installed user flows. */
export function verifyNativeAlphaArtifact(directory, {
  sourceCommit, platform = process.platform, allowUnsignedValidation = false, command = run
} = {}) {
  if (!COMMIT.test(sourceCommit)) fail("an independently supplied full source commit is required");
  if (!new Set(["darwin", "win32"]).has(platform)) fail("run on the target Mac or Windows host");
  const output = realpathSync(directory);
  const metadata = json(output, platform === "darwin" ? "macos-package.json" : "windows-package.json");
  const architecture = platform === "darwin" ? "arm64" : "x64";
  if (metadata.schemaVersion !== 1 || metadata.platform !== platform || metadata.architecture !== architecture) fail("platform metadata does not match the candidate host contract");
  if (metadata.sourceCommit !== sourceCommit || readFileSync(file(output, "SOURCE_COMMIT"), "utf8").trim() !== sourceCommit) fail("source commit mismatch");
  if (!/^\d+\.\d+\.\d+-alpha\.\d+$/.test(metadata.version) || !/^24\.\d+\.\d+$/.test(metadata.nodeVersion)) fail("invalid alpha version or embedded Node version");
  const installerName = `VDT-Studio-${metadata.version}-${architecture}${platform === "darwin" ? ".dmg" : "-setup.exe"}`;
  if (metadata.installer?.fileName !== installerName || !SHA.test(metadata.installer.sha256)) fail("invalid installer metadata");
  const installer = file(output, installerName);
  const installerSha256 = digest(installer);
  const sums = readFileSync(file(output, "SHA256SUMS"), "utf8").trim().split(/\r?\n/);
  if (metadata.installer.sha256 !== installerSha256 || sums.length !== 1 || sums[0] !== `${installerSha256}  ${installerName}`) fail("installer checksum/manifest mismatch");
  if (typeof metadata.signed !== "boolean" || (!metadata.signed && !allowUnsignedValidation)) fail("unsigned validation artifacts cannot pass the release trust gate");

  const application = join(output, platform === "darwin" ? "VDT Studio.app" : "application");
  const resources = platform === "darwin" ? join(application, "Contents/Resources") : application;
  const identity = json(resources, "build-info.json");
  if (identity.sourceCommit !== sourceCommit || identity.version !== metadata.version || identity.dirty !== false || identity.platform !== platform || identity.architecture !== architecture || !Number.isFinite(Date.parse(identity.buildTime))) fail("packaged application build identity mismatch");
  const node = platform === "darwin" ? file(application, "Contents/Helpers/node") : file(application, "runtime/node.exe");
  const resourcesResult = verifyResources(resources);
  let trustVerified = false;
  let storageAddon;
  if (platform === "darwin") {
    file(application, "Contents/MacOS/vdt-studio-desktop");
    command("codesign", ["--verify", "--deep", "--strict", application]);
    command("codesign", ["--verify", "--strict", installer]);
    if (metadata.signed) {
      const teams = new Set();
      for (const target of [application, node, installer]) {
        const signature = command("codesign", ["--display", "--verbose=4", target]);
        if (!signature.includes("Authority=Developer ID Application:") || !/^TeamIdentifier=\w+/m.test(signature)) fail("candidate does not carry a Developer ID signature");
        teams.add(signature.match(/^TeamIdentifier=(\w+)/m)[1]);
      }
      if (teams.size !== 1) fail("application, embedded Node and installer signing teams differ");
      if (!allowUnsignedValidation) {
        command("xcrun", ["stapler", "validate", installer]);
        command("spctl", ["--assess", "--type", "execute", "--verbose=2", application]);
        trustVerified = true;
      }
    }
  } else {
    file(application, "vdt-studio-desktop.exe");
    file(application, "windows-runtime.cjs");
    file(resources, "web/apps/web/.next/server/instrumentation.js");
    storageAddon = json(application, "runtime/windows-storage.manifest.json");
    const addon = file(application, "runtime/windows-storage.node");
    if (storageAddon.schemaVersion !== 1 || storageAddon.fileName !== "windows-storage.node" ||
        storageAddon.architecture !== architecture || storageAddon.nodeApiVersion !== 8 ||
        storageAddon.nodeVersion !== metadata.nodeVersion || !SHA.test(storageAddon.sha256) ||
        digest(addon) !== storageAddon.sha256) fail("native Windows storage addon metadata or checksum mismatch");
    const bytes = readFileSync(addon);
    if (bytes.length < 64 || bytes.readUInt16LE(0) !== 0x5a4d) fail("native Windows storage addon is not a PE image");
    const offset = bytes.readUInt32LE(0x3c);
    if (offset < 64 || offset > bytes.length - 24 || bytes.readUInt32LE(offset) !== 0x4550 ||
        bytes.readUInt16LE(offset + 4) !== 0x8664 || !(bytes.readUInt16LE(offset + 22) & 0x2000)) {
      fail("native Windows storage addon is not an x64 PE DLL");
    }
    if (metadata.signed) {
      command("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", join(dirname(SCRIPT_PATH), "verify-windows-artifact-signatures.ps1"), "-ArtifactDirectory", output, "-InstallerFile", installerName]);
      trustVerified = !allowUnsignedValidation;
    }
  }
  const nodeVersion = command(node, ["--version"]).trim();
  if (nodeVersion !== `v${metadata.nodeVersion}`) fail("embedded Node version does not match package metadata");
  if (storageAddon) {
    const addon = file(application, "runtime/windows-storage.node");
    const loadedAbi = command(node, ["-e", "require(process.argv[1]); process.stdout.write(process.versions.napi)", addon]);
    if (!/^\d+$/.test(loadedAbi) || Number(loadedAbi) < storageAddon.nodeApiVersion) {
      fail("embedded Node cannot load the required storage addon ABI");
    }
  }
  return {
    schemaVersion: 1, sourceCommit, version: metadata.version, platform, architecture,
    installer: { fileName: installerName, sha256: installerSha256 }, nodeVersion: metadata.nodeVersion,
    ...resourcesResult, ...(storageAddon && { storageAddon }), artifactIntegrity: "passed", distributionTrust: trustVerified ? "passed" : "unverified-validation-only",
    installedApplicationQualification: "unverified", liveProviderQualification: "unverified",
    releaseReady: false
  };
}

if (process.argv[1] === SCRIPT_PATH) {
  const args = process.argv.slice(2);
  const directory = args.shift();
  const commitIndex = args.indexOf("--source-commit");
  const sourceCommit = commitIndex >= 0 ? args.splice(commitIndex, 2)[1] : undefined;
  const allowUnsignedValidation = args.length === 1 && args[0] === "--allow-unsigned-validation";
  if (!directory || (args.length && !allowUnsignedValidation)) {
    throw new Error("Usage: node scripts/verify-native-alpha-artifact.mjs OUTPUT_DIR --source-commit FULL_SHA [--allow-unsigned-validation]");
  }
  try {
    const result = verifyNativeAlphaArtifact(directory, { sourceCommit, allowUnsignedValidation });
    writeFileSync(join(directory, "native-artifact-verification.json"), JSON.stringify(result, null, 2) + "\n");
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (error) {
    const result = { schemaVersion: 1, sourceCommit, platform: process.platform, artifactIntegrity: "failed", releaseReady: false, error: error instanceof Error ? error.message : String(error) };
    try { writeFileSync(join(directory, "native-artifact-verification.json"), JSON.stringify(result, null, 2) + "\n"); }
    catch { /* Missing output directory must not replace the original failure. */ }
    process.stderr.write(JSON.stringify(result, null, 2) + "\n");
    process.exitCode = 1;
  }
}
