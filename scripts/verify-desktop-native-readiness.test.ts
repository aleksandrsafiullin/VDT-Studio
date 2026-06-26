import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyDesktopNativeReadiness } from "./verify-desktop-native-readiness.mjs";

const tempDirs: string[] = [];

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function createFixture(options: { signed?: boolean; selfContained?: boolean; tauriCliPinned?: boolean; installerTarget?: boolean } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vdt-native-readiness-"));
  tempDirs.push(root);
  await writeJson(path.join(root, "apps/desktop/package.json"), {
    name: "@vdt-studio/desktop",
      dependencies: options.tauriCliPinned ? { "@tauri-apps/cli": "2.0.0" } : {}
    });
  await writeJson(path.join(root, "apps/desktop/src-tauri/tauri.conf.json"), {
    bundle: {
      active: true,
      targets: options.installerTarget ? ["all"] : ["app"],
      resources: [
        "sidecars/vdt-local-runtime",
        "sidecars/vdt-local-runtime.cmd",
        "sidecars/vdt-local-runtime.mjs",
        "sidecars/vdt-local-runtime.manifest.json",
        "sidecars/vdt-agent-skills"
      ],
      macOS: { signingIdentity: options.signed ? "Developer ID Application: Example" : "-" }
    }
  });
  await writeJson(path.join(root, "apps/desktop/src-tauri/sidecars/vdt-local-runtime.manifest.json"), {
    selfContained: options.selfContained === true,
    ...(options.selfContained ? {} : { requiresNode: ">=24 <25" })
  });
  return root;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("verify-desktop-native-readiness", () => {
  it("reports native desktop release blockers from repository configuration", async () => {
    const root = await createFixture();
    const result = verifyDesktopNativeReadiness(root, { ...process.env, PATH: "" });

    expect(result.ok).toBe(false);
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining([
        "MISSING_CARGO",
        "MISSING_RUSTC",
        "MISSING_TAURI_CLI",
        "TAURI_CLI_NOT_PINNED",
        "UNSIGNED_MACOS_BUNDLE",
        "MISSING_MACOS_INSTALLER_TARGET",
        "MISSING_WINDOWS_INSTALLER_TARGET",
        "SIDECAR_NOT_SELF_CONTAINED",
        "SIDECAR_REQUIRES_NODE"
      ])
    );
  });

  it("keeps configuration blockers separate from toolchain blockers", async () => {
    const root = await createFixture({ signed: true, selfContained: true, tauriCliPinned: true, installerTarget: true });
    const result = verifyDesktopNativeReadiness(root, { ...process.env, PATH: "" });

    expect(result.ok).toBe(false);
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining(["MISSING_CARGO", "MISSING_RUSTC", "MISSING_TAURI_CLI"])
    );
    expect(result.blockers.map((blocker) => blocker.code)).not.toContain("UNSIGNED_MACOS_BUNDLE");
    expect(result.blockers.map((blocker) => blocker.code)).not.toContain("SIDECAR_NOT_SELF_CONTAINED");
  });

  it("reports unsigned and Node-dependent sidecars as release blockers", async () => {
    const root = await createFixture();
    const result = verifyDesktopNativeReadiness(root);

    expect(result.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining(["UNSIGNED_MACOS_BUNDLE", "SIDECAR_NOT_SELF_CONTAINED", "SIDECAR_REQUIRES_NODE"])
    );
  });

  it("does not require the development runtime bundle resource for self-contained sidecars", async () => {
    const root = await createFixture({ signed: true, selfContained: true, tauriCliPinned: true, installerTarget: true });
    await writeJson(path.join(root, "apps/desktop/src-tauri/tauri.conf.json"), {
      bundle: {
        active: true,
        targets: ["all"],
        resources: ["sidecars/vdt-local-runtime", "sidecars/vdt-local-runtime.manifest.json"],
        macOS: { signingIdentity: "Developer ID Application: Example" }
      }
    });
    const result = verifyDesktopNativeReadiness(root, { ...process.env, PATH: "" });

    expect(result.blockers.map((blocker) => blocker.code)).not.toContain("MISSING_SIDECAR_RESOURCE");
  });
});
