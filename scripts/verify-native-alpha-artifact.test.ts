import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyNativeAlphaArtifact } from "./verify-native-alpha-artifact.mjs";

const roots: string[] = [];
const sourceCommit = "a".repeat(40);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture(platform: "darwin" | "win32" = "darwin", signed = true) {
  const root = await mkdtemp(path.join(tmpdir(), "vdt-native-artifact-")); roots.push(root);
  const application = path.join(root, platform === "darwin" ? "VDT Studio.app" : "application");
  const resources = platform === "darwin" ? path.join(application, "Contents/Resources") : application;
  const architecture = platform === "darwin" ? "arm64" : "x64";
  const version = "0.1.0-alpha.2";
  const installer = `VDT-Studio-${version}-${architecture}${platform === "darwin" ? ".dmg" : "-setup.exe"}`;
  const installerBytes = "installer fixture";
  const put = async (name: string, contents: string) => { await mkdir(path.dirname(name), { recursive: true }); await writeFile(name, contents); };
  const metadata = { schemaVersion: 1, platform, architecture, version, sourceCommit, nodeVersion: "24.22.2", signed, qualification: "unverified", installer: { fileName: installer, sha256: sha(installerBytes) } };
  await put(path.join(root, installer), installerBytes);
  const metadataPath = path.join(root, platform === "darwin" ? "macos-package.json" : "windows-package.json");
  await put(metadataPath, JSON.stringify(metadata));
  await put(path.join(root, "SOURCE_COMMIT"), sourceCommit + "\n");
  await put(path.join(root, "SHA256SUMS"), `${sha(installerBytes)}  ${installer}\n`);
  await put(path.join(resources, "build-info.json"), JSON.stringify({ version, sourceCommit, dirty: false, buildTime: "2026-11-13T00:00:00.000Z", platform, architecture }));
  await put(path.join(application, platform === "darwin" ? "Contents/Helpers/node" : "runtime/node.exe"), "embedded runtime fixture");
  await put(path.join(application, platform === "darwin" ? "Contents/MacOS/vdt-studio-desktop" : "vdt-studio-desktop.exe"), "application fixture");
  await put(path.join(resources, "packaged-web.cjs"), "web host fixture");
  if (platform === "win32") {
    await put(path.join(resources, "windows-runtime.cjs"), "windows host fixture");
    await put(path.join(resources, "web/apps/web/.next/server/instrumentation.js"), "storage startup fixture");
    const addon = Buffer.alloc(88);
    addon.writeUInt16LE(0x5a4d, 0);
    addon.writeUInt32LE(64, 0x3c);
    addon.writeUInt32LE(0x4550, 64);
    addon.writeUInt16LE(0x8664, 68);
    addon.writeUInt16LE(0x2000, 86);
    await writeFile(path.join(resources, "runtime/windows-storage.node"), addon);
    await put(path.join(resources, "runtime/windows-storage.manifest.json"), JSON.stringify({
      schemaVersion: 1, fileName: "windows-storage.node", architecture, nodeApiVersion: 8,
      nodeVersion: metadata.nodeVersion, sha256: createHash("sha256").update(addon).digest("hex")
    }));
  }
  await put(path.join(resources, "web/apps/web/server.js"), "Next server fixture");
  await put(path.join(resources, "web/apps/web/.next/required-server-files.json"), JSON.stringify({ config: { images: { unoptimized: true } } }));
  const noticeBytes = "upstream notice";
  const noticeHash = sha(noticeBytes);
  const noticePath = path.join(resources, "THIRD-PARTY-NOTICES/texts", `${noticeHash}.txt`);
  await put(noticePath, noticeBytes);
  await put(path.join(resources, "THIRD-PARTY-NOTICES/inventory.json"), JSON.stringify({
    schemaVersion: 1, packages: ["npm", "cargo"].map(ecosystem => ({
      ecosystem, name: "fixture", version: "1.0.0", notices: [{ path: "LICENSE", sha256: noticeHash }]
    }))
  }));
  const workerPath = path.join(resources, "web/apps/web/.next/server/chunks/static/media/worker-hash.cjs");
  await put(workerPath, "parser worker fixture");
  await put(path.join(resources, "parser-worker.manifest.json"), JSON.stringify({ schemaVersion: 1, entrypoint: "parser-worker.cjs", sha256: sha("parser worker fixture"), byteLength: Buffer.byteLength("parser worker fixture") }));
  for (const name of ["vdt-local-runtime", "vdt-local-runtime.cmd", "vdt-local-runtime.mjs"]) await put(path.join(resources, "sidecars", name), name);
  await mkdir(path.join(resources, "sidecars/vdt-agent-skills"));
  await put(path.join(resources, "sidecars/vdt-local-runtime.manifest.json"), JSON.stringify({ schemaVersion: 1, protocolVersion: 1, kind: "node-runtime-bundle", launcherSha256: sha("vdt-local-runtime"), windowsLauncherSha256: sha("vdt-local-runtime.cmd"), bundleSha256: sha("vdt-local-runtime.mjs"), skillLibrarySha256: sha("") }));
  const command = vi.fn((name: string, args: string[]) => {
    if (args[0] === "--version") return "v24.22.2";
    if (args[0] === "-e") return "10";
    if (name === "codesign" && args.includes("--display")) return "Authority=Developer ID Application: Fixture\nTeamIdentifier=FIXTURE123";
    return "passed";
  });
  return { root, resources, installer, metadata, metadataPath, workerPath, noticePath, command };
}

describe("native alpha artifact verification", () => {
  it("rejects enabled image optimization before loading executable resources", async () => {
    const f = await fixture();
    await writeFile(path.join(f.resources, "web/apps/web/.next/required-server-files.json"), JSON.stringify({ config: { images: { unoptimized: false } } }));
    expect(() => verifyNativeAlphaArtifact(f.root, { sourceCommit, platform: "darwin", command: f.command })).toThrow(/image optimization must be disabled/);
    expect(f.command).not.toHaveBeenCalled();
  });
  it.each([
    ["darwin", "node_modules/.pnpm/sharp@0.35.5/node_modules/sharp/package.json"],
    ["win32", "node_modules/@img/sharp-win32-x64/package.json"],
    ["darwin", "apps/web/lib/libvips-cpp.8.18.7.dylib"]
  ] as const)("rejects unused native image resources in %s packaging at %s", async (platform, relative) => {
    const f = await fixture(platform);
    const unexpected = path.join(f.resources, "web", relative);
    await mkdir(path.dirname(unexpected), { recursive: true });
    await writeFile(unexpected, "unneeded image resource");
    expect(() => verifyNativeAlphaArtifact(f.root, { sourceCommit, platform, command: f.command })).toThrow(/unused native image resource/);
    expect(f.command).not.toHaveBeenCalled();
  });
  it("checks actual Mac trust commands while keeping installed/live qualification unverified", async () => {
    const f = await fixture();
    expect(verifyNativeAlphaArtifact(f.root, { sourceCommit, platform: "darwin", command: f.command })).toMatchObject({ artifactIntegrity: "passed", distributionTrust: "passed", installedApplicationQualification: "unverified", liveProviderQualification: "unverified", releaseReady: false });
    expect(f.command).toHaveBeenCalledWith("xcrun", ["stapler", "validate", path.join(f.root, f.installer)]);
    expect(f.command.mock.calls.some(([name]) => name === "spctl")).toBe(true);
  });
  it("checks Windows Authenticode independently of the metadata signed flag", async () => {
    const f = await fixture("win32");
    verifyNativeAlphaArtifact(f.root, { sourceCommit, platform: "win32", command: f.command });
    expect(f.command.mock.calls.some(([name]) => name === "pwsh.exe")).toBe(true);
    const command = (name: string, args: string[]) => { if (name === "pwsh.exe") throw new Error("Authenticode failed"); return f.command(name, args); };
    expect(() => verifyNativeAlphaArtifact(f.root, { sourceCommit, platform: "win32", command })).toThrow(/Authenticode failed/);
  });
  it("fails when the packaged Windows Node cannot resolve Next dependencies", async () => {
    const f = await fixture("win32");
    const command = (name: string, args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }) => {
      if (args[0] === "-e" && args[1].includes("styled-jsx/package.json")) {
        expect(name).toBe(path.join(f.resources, "runtime/node.exe"));
        expect(args[2]).toBe(path.join(f.resources, "web"));
        expect(options?.cwd).toBe(path.join(f.resources, "web/apps/web"));
        expect(options?.env?.NODE_PATH).toBeUndefined();
        throw new Error("missing packaged styled-jsx");
      }
      return f.command(name, args);
    };
    expect(() => verifyNativeAlphaArtifact(f.root, { sourceCommit, platform: "win32", command }))
      .toThrow(/missing packaged styled-jsx/);
  });
  it("rejects altered Windows storage addon bytes before loading the addon", async () => {
    const f = await fixture("win32");
    await writeFile(path.join(f.resources, "runtime/windows-storage.node"), "different addon");
    expect(() => verifyNativeAlphaArtifact(f.root, { sourceCommit, platform: "win32", command: f.command }))
      .toThrow(/addon metadata or checksum/);
    expect(f.command).not.toHaveBeenCalled();
  });
  it("never promotes explicitly unsigned validation to distribution trust", async () => {
    const f = await fixture("darwin", false);
    expect(() => verifyNativeAlphaArtifact(f.root, { sourceCommit, platform: "darwin", command: f.command })).toThrow(/unsigned validation/);
    expect(verifyNativeAlphaArtifact(f.root, { sourceCommit, platform: "darwin", allowUnsignedValidation: true, command: f.command })).toMatchObject({ distributionTrust: "unverified-validation-only", releaseReady: false });
    expect(f.command.mock.calls.some(([name]) => name === "xcrun")).toBe(false);
  });
  it("rejects a different commit before running executable resources", async () => {
    const f = await fixture();
    expect(() => verifyNativeAlphaArtifact(f.root, { sourceCommit: "b".repeat(40), platform: "darwin", command: f.command })).toThrow(/source commit mismatch/);
    expect(f.command).not.toHaveBeenCalled();
  });
  it("rejects altered installer bytes even if its filename remains unchanged", async () => {
    const f = await fixture(); await writeFile(path.join(f.root, f.installer), "different installer");
    expect(() => verifyNativeAlphaArtifact(f.root, { sourceCommit, platform: "darwin", command: f.command })).toThrow(/checksum/);
  });
  it("rejects absent or altered traced parser workers", async () => {
    const f = await fixture(); await writeFile(f.workerPath, "different worker bytes");
    expect(() => verifyNativeAlphaArtifact(f.root, { sourceCommit, platform: "darwin", command: f.command })).toThrow(/no parser worker matching/);
    expect(f.command).not.toHaveBeenCalled();
  });
  it("rejects stale application identity behind matching external metadata", async () => {
    const f = await fixture();
    const identity = JSON.parse(await readFile(path.join(f.resources, "build-info.json"), "utf8"));
    await writeFile(path.join(f.resources, "build-info.json"), JSON.stringify({ ...identity, sourceCommit: "c".repeat(40) }));
    expect(() => verifyNativeAlphaArtifact(f.root, { sourceCommit, platform: "darwin", command: f.command })).toThrow(/application build identity/);
  });
  it("rejects altered sidecar resources", async () => {
    const f = await fixture(); await writeFile(path.join(f.resources, "sidecars/vdt-local-runtime.cmd"), "different launcher");
    expect(() => verifyNativeAlphaArtifact(f.root, { sourceCommit, platform: "darwin", command: f.command })).toThrow(/sidecar hash mismatch/);
  });
  it("rejects a changed upstream notice before loading the embedded runtime", async () => {
    const f = await fixture();
    await writeFile(f.noticePath, "altered notice");
    expect(() => verifyNativeAlphaArtifact(f.root, { sourceCommit, platform: "darwin", command: f.command }))
      .toThrow(/notice hash mismatch/);
    expect(f.command).not.toHaveBeenCalled();
  });
  it("rejects a runtime that reports a different Node version", async () => {
    const f = await fixture();
    expect(() => verifyNativeAlphaArtifact(f.root, { sourceCommit, platform: "darwin", command: (name: string, args: string[]) => args[0] === "--version" ? "v26.0.0" : f.command(name, args) })).toThrow(/embedded Node version/);
  });
});
