import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SidecarProcessHost } from "../packages/local-runner/src/sidecar/host";
import { verifyDesktopSidecar } from "./verify-desktop-sidecar.mjs";

const tempDirs: string[] = [];
const hosts: SidecarProcessHost[] = [];

async function directorySha256(directory: string) {
  const hash = createHash("sha256");
  const walk = async (current: string) => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const entryPath = path.resolve(current, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile()) {
        const rel = path.relative(directory, entryPath).replaceAll("\\", "/");
        hash.update(rel);
        hash.update("\0");
        hash.update(await readFile(entryPath));
        hash.update("\0");
      }
    }
  };
  await walk(directory);
  return hash.digest("hex");
}

async function writeSkillLibrary(root: string) {
  const skillsRoot = path.join(root, "apps/desktop/src-tauri/sidecars/vdt-agent-skills");
  const files = {
    "registry.md": "| Skill ID | Path | Domain | Matching terms | Primary KPI patterns | Input requirements | Expected outputs | Confidence hints | When not to use |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n",
    "finance/revenue-profit.md": "---\nid: finance.revenue_profit\n---\n",
    "generic/logical-kpi-decomposition.md": "---\nid: generic.logical_kpi_decomposition\n---\n",
    "mining/haulage-truck-cycle.md": "---\nid: mining.haulage_truck_cycle\n---\n",
    "mining/production-volume.md": "---\nid: mining.production_volume\n---\n",
    "saas/funnel-growth.md": "---\nid: saas.funnel_growth\n---\n"
  };
  for (const [file, text] of Object.entries(files)) {
    const filePath = path.join(skillsRoot, file);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, text);
  }
  return directorySha256(skillsRoot);
}

async function writeLauncher(text: string, mode = 0o755) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vdt-sidecar-fixture-"));
  tempDirs.push(root);
  const launcherPath = path.join(root, "apps/desktop/src-tauri/sidecars/vdt-local-runtime");
  const windowsLauncherPath = path.join(root, "apps/desktop/src-tauri/sidecars/vdt-local-runtime.cmd");
  const bundlePath = path.join(root, "apps/desktop/src-tauri/sidecars/vdt-local-runtime.mjs");
  const manifestPath = path.join(root, "apps/desktop/src-tauri/sidecars/vdt-local-runtime.manifest.json");
  const configPath = path.join(root, "apps/desktop/src-tauri/tauri.conf.json");
  const hostPath = path.join(root, "apps/desktop/src-tauri/src/sidecar_host.rs");
  await mkdir(path.dirname(launcherPath), { recursive: true });
  await mkdir(path.dirname(configPath), { recursive: true });
  await mkdir(path.dirname(hostPath), { recursive: true });
  const skillLibrarySha256 = await writeSkillLibrary(root);
  const bundle = `export function runLocalRuntimeSidecar() {}\nconst packagedSkills = "vdt-agent-skills";\n${"// bundled runtime\n".repeat(4000)}`;
  const windowsLauncher = "@echo off\nset \"ENTRYPOINT=%~dp0vdt-local-runtime.mjs\"\nnode \"%ENTRYPOINT%\"\n";
  await writeFile(launcherPath, text);
  await writeFile(windowsLauncherPath, windowsLauncher);
  await writeFile(bundlePath, bundle);
  await chmod(launcherPath, mode);
  await writeFile(manifestPath, JSON.stringify({
    schemaVersion: 1,
    kind: "node-runtime-bundle",
    protocolVersion: 1,
    launcher: "vdt-local-runtime",
    entrypoint: "sidecars/vdt-local-runtime.mjs",
    launcherSha256: createHash("sha256").update(text).digest("hex"),
    windowsLauncherSha256: createHash("sha256").update(windowsLauncher).digest("hex"),
    bundleSha256: createHash("sha256").update(bundle).digest("hex"),
    skillLibrarySha256,
    selfContained: false,
    requiresNode: ">=24 <25"
  }));
  await writeFile(configPath, JSON.stringify({
    bundle: {
      resources: [
        "sidecars/vdt-local-runtime",
        "sidecars/vdt-local-runtime.cmd",
        "sidecars/vdt-local-runtime.mjs",
        "sidecars/vdt-local-runtime.manifest.json",
        "sidecars/vdt-agent-skills"
      ]
    }
  }));
  await writeFile(hostPath, [
    "const PACKAGED_SIDECAR_RELATIVE_PATH: &str = \"sidecars/vdt-local-runtime\";",
    "const WINDOWS_PACKAGED_SIDECAR_RELATIVE_PATH: &str = \"sidecars/vdt-local-runtime.cmd\";",
    "const PACKAGED_SIDECAR_RELATIVE_PATHS: &[&str] = &[PACKAGED_SIDECAR_RELATIVE_PATH, WINDOWS_PACKAGED_SIDECAR_RELATIVE_PATH];"
  ].join("\n"));
  return root;
}

async function writeSelfContainedSidecar() {
  const root = await mkdtemp(path.join(os.tmpdir(), "vdt-self-contained-sidecar-fixture-"));
  tempDirs.push(root);
  const launcherPath = path.join(root, "apps/desktop/src-tauri/sidecars/vdt-local-runtime");
  const manifestPath = path.join(root, "apps/desktop/src-tauri/sidecars/vdt-local-runtime.manifest.json");
  const configPath = path.join(root, "apps/desktop/src-tauri/tauri.conf.json");
  const hostPath = path.join(root, "apps/desktop/src-tauri/src/sidecar_host.rs");
  await mkdir(path.dirname(launcherPath), { recursive: true });
  await mkdir(path.dirname(configPath), { recursive: true });
  await mkdir(path.dirname(hostPath), { recursive: true });
  const binary = `#!/bin/sh\nprintf '{"protocolVersion":1,"type":"event","event":"ready","payload":{}}\\n'\n`;
  await writeFile(launcherPath, binary);
  await chmod(launcherPath, 0o755);
  await writeFile(manifestPath, JSON.stringify({
    schemaVersion: 1,
    kind: "self-contained-sidecar",
    protocolVersion: 1,
    launcher: "vdt-local-runtime",
    entrypoint: "sidecars/vdt-local-runtime",
    sidecarSha256: createHash("sha256").update(binary).digest("hex"),
    selfContained: true
  }));
  await writeFile(configPath, JSON.stringify({ bundle: { resources: ["sidecars/vdt-local-runtime", "sidecars/vdt-local-runtime.manifest.json"] } }));
  await writeFile(hostPath, [
    "const PACKAGED_SIDECAR_RELATIVE_PATH: &str = \"sidecars/vdt-local-runtime\";",
    "const WINDOWS_PACKAGED_SIDECAR_RELATIVE_PATH: &str = \"sidecars/vdt-local-runtime.cmd\";",
    "const PACKAGED_SIDECAR_RELATIVE_PATHS: &[&str] = &[PACKAGED_SIDECAR_RELATIVE_PATH, WINDOWS_PACKAGED_SIDECAR_RELATIVE_PATH];"
  ].join("\n"));
  return root;
}

afterEach(async () => {
  await Promise.all([
    ...hosts.splice(0).map((host) => host.stop()),
    ...tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  ]);
});

describe("verify-desktop-sidecar", () => {
  it("passes the current development sidecar launcher", () => {
    expect(verifyDesktopSidecar()).toMatchObject({
      launcher: "apps/desktop/src-tauri/sidecars/vdt-local-runtime",
      windowsLauncher: "apps/desktop/src-tauri/sidecars/vdt-local-runtime.cmd",
      bundle: "apps/desktop/src-tauri/sidecars/vdt-local-runtime.mjs",
      manifest: "apps/desktop/src-tauri/sidecars/vdt-local-runtime.manifest.json"
    });
  });

  it("starts the development sidecar launcher and lists backends over pipes", async () => {
    const host = new SidecarProcessHost({
      command: path.join(process.cwd(), "apps/desktop/src-tauri/sidecars/vdt-local-runtime"),
      handshakeTimeoutMs: 5000
    });
    hosts.push(host);
    await host.start();
    await expect(host.request("list_backends")).resolves.toMatchObject({
      ok: true,
      backends: expect.arrayContaining([
        expect.objectContaining({ id: "mock", backendId: "mock", mode: "local_http", status: "available" })
      ])
    });
  });

  it("runs agentic generate_tree through the packaged sidecar launcher", async () => {
    const host = new SidecarProcessHost({
      command: path.join(process.cwd(), "apps/desktop/src-tauri/sidecars/vdt-local-runtime"),
      handshakeTimeoutMs: 5000
    });
    hosts.push(host);
    await host.start();
    await expect(host.request("complete", {
      backendId: "mock",
      taskType: "generate_tree",
      schemaId: "generate-tree-v1",
      input: {
        rootKpi: "Production Volume",
        industry: "Mining",
        businessContext: "Production volume throughput"
      }
    })).resolves.toMatchObject({
      ok: true,
      run: {
        status: "succeeded",
        agentRun: {
          status: "succeeded",
          selectedSkills: expect.arrayContaining([expect.objectContaining({ id: "mining.production_volume" })])
        }
      }
    });
  });

  it("fails if the launcher is not executable", async () => {
    const root = await writeLauncher("#!/bin/sh\nexec node vdt-local-runtime.mjs\n", 0o644);
    expect(() => verifyDesktopSidecar(root)).toThrow(/must be executable/);
  });

  it("fails if the launcher forwards arbitrary arguments", async () => {
    const root = await writeLauncher([
      "#!/bin/sh",
      "ENTRYPOINT=vdt-local-runtime.mjs",
      "exec node \"$ENTRYPOINT\" \"$@\""
    ].join("\n"));
    expect(() => verifyDesktopSidecar(root)).toThrow(/must not forward/);
  });

  it("fails if the Tauri bundle resource does not include the launcher", async () => {
    const root = await writeLauncher("#!/bin/sh\nexec node vdt-local-runtime.mjs\n");
    await writeFile(path.join(root, "apps/desktop/src-tauri/tauri.conf.json"), JSON.stringify({ bundle: { resources: [] } }));
    expect(() => verifyDesktopSidecar(root)).toThrow(/bundle resources/);
  });

  it("fails if the Tauri bundle resource does not include the Windows launcher", async () => {
    const root = await writeLauncher("#!/bin/sh\nexec node vdt-local-runtime.mjs\n");
    await writeFile(path.join(root, "apps/desktop/src-tauri/tauri.conf.json"), JSON.stringify({
      bundle: {
        resources: [
          "sidecars/vdt-local-runtime",
          "sidecars/vdt-local-runtime.mjs",
          "sidecars/vdt-local-runtime.manifest.json"
        ]
      }
    }));
    expect(() => verifyDesktopSidecar(root)).toThrow(/Windows sidecar launcher/);
  });

  it("fails if the Tauri bundle resource does not include the VDT agent skill library", async () => {
    const root = await writeLauncher("#!/bin/sh\nexec node vdt-local-runtime.mjs\n");
    await writeFile(path.join(root, "apps/desktop/src-tauri/tauri.conf.json"), JSON.stringify({
      bundle: {
        resources: [
          "sidecars/vdt-local-runtime",
          "sidecars/vdt-local-runtime.cmd",
          "sidecars/vdt-local-runtime.mjs",
          "sidecars/vdt-local-runtime.manifest.json"
        ]
      }
    }));
    expect(() => verifyDesktopSidecar(root)).toThrow(/skill library/);
  });

  it("fails if the packaged VDT agent skill library is missing a required skill", async () => {
    const root = await writeLauncher("#!/bin/sh\nexec node vdt-local-runtime.mjs\n");
    await rm(path.join(root, "apps/desktop/src-tauri/sidecars/vdt-agent-skills/mining/production-volume.md"));
    await expect(stat(path.join(root, "apps/desktop/src-tauri/sidecars/vdt-agent-skills/mining/production-volume.md"))).rejects.toThrow();
    expect(() => verifyDesktopSidecar(root)).toThrow(/production-volume/);
  });

  it("fails if the sidecar launcher hash does not match the manifest", async () => {
    const root = await writeLauncher("#!/bin/sh\nexec node vdt-local-runtime.mjs\n");
    await writeFile(path.join(root, "apps/desktop/src-tauri/sidecars/vdt-local-runtime"), [
      "#!/bin/sh",
      "exec node vdt-local-runtime.mjs",
      "# tampered"
    ].join("\n"));
    expect(() => verifyDesktopSidecar(root)).toThrow(/SHA-256/);
  });

  it("fails if the bundled runtime hash does not match the manifest", async () => {
    const root = await writeLauncher("#!/bin/sh\nexec node vdt-local-runtime.mjs\n");
    await writeFile(
      path.join(root, "apps/desktop/src-tauri/sidecars/vdt-local-runtime.mjs"),
      `export function runLocalRuntimeSidecar() {}\n${"// tampered bundled runtime\n".repeat(4000)}`
    );
    expect(() => verifyDesktopSidecar(root)).toThrow(/bundle SHA-256/);
  });

  it("fails if the launcher depends on workspace TypeScript sources", async () => {
    const root = await writeLauncher("#!/bin/sh\nENTRYPOINT=vdt-local-runtime.mjs\nexec node --import tsx packages/local-runner/src/sidecar/index.ts \"$ENTRYPOINT\"\n");
    expect(() => verifyDesktopSidecar(root)).toThrow(/must not depend/);
  });

  it("accepts a self-contained sidecar manifest without a Node runtime requirement", async () => {
    const root = await writeSelfContainedSidecar();

    expect(verifyDesktopSidecar(root)).toMatchObject({
      launcher: "apps/desktop/src-tauri/sidecars/vdt-local-runtime",
      manifest: "apps/desktop/src-tauri/sidecars/vdt-local-runtime.manifest.json"
    });
  });
});
