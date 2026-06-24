import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyCiWorkflows } from "./verify-ci-workflows.mjs";

const tempDirs: string[] = [];

async function writeWorkflow(root: string, file: string, text: string) {
  const filePath = path.join(root, file);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text);
}

async function createFixture(overrides: Record<string, string> = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vdt-ci-workflows-"));
  tempDirs.push(root);

  const workflows: Record<string, string> = {
    ".github/workflows/quality.yml":
      "name: Quality\nsteps:\n- run: pnpm lint\n- run: pnpm typecheck\n- run: pnpm test\n- run: pnpm build\n- run: pnpm ci:verify\n- run: pnpm phase7:verify\n- run: pnpm docs:verify\n- run: pnpm evaluation:verify\n- run: pnpm desktop:verify\n",
    ".github/workflows/e2e.yml":
      "name: E2E\nsteps:\n- run: pnpm exec playwright install --with-deps chromium webkit\n- run: pnpm test:e2e\n",
    ".github/workflows/e2e-desktop.yml":
      "name: Desktop E2E Foundation\nstrategy:\n  matrix:\n    os: [macos-14, windows-latest]\nruns-on: ${{ matrix.os }}\nsteps:\n- run: pnpm desktop:verify\n- run: pnpm vitest run scripts/verify-desktop-shell.test.ts scripts/verify-desktop-sidecar.test.ts\n",
    ".github/workflows/package.yml":
      "name: Package\nmatrix:\n  os: [ubuntu-latest, macos-14, windows-latest]\nsteps:\n- run: pnpm package:alpha\n- run: pnpm release:bundle:verify\n- run: pnpm package:verify\n",
    ".github/workflows/package-desktop.yml":
      "name: Desktop Package\non:\n  workflow_dispatch:\nstrategy:\n  matrix:\n    os: [macos-14, windows-latest]\nruns-on: ${{ matrix.os }}\nsteps:\n- run: pnpm desktop:sidecar:prepare\n- run: pnpm desktop:verify\n- run: pnpm desktop:native:preflight\n",
    ".github/workflows/security.yml": "name: Security\nsteps:\n- run: pnpm security:audit\n- run: pnpm certification:verify\n",
    ".github/workflows/release.yml":
      "name: Release\nsteps:\n- run: pnpm release:verify\n- run: pnpm test:e2e\nfiles:\n  output/release/v*/vdt-studio-cli-*.tgz\n  output/release/v*/SHA256SUMS\n  output/release/v*/manifest.json\n  output/release/v*/sbom.spdx.json\n"
  };

  for (const [file, text] of Object.entries({ ...workflows, ...overrides })) {
    await writeWorkflow(root, file, text);
  }

  return root;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("verify-ci-workflows", () => {
  it("passes when CI contains the required release and desktop gates", async () => {
    const root = await createFixture();

    expect(verifyCiWorkflows(root).workflows).toContain(".github/workflows/package-desktop.yml");
  });

  it("fails when the desktop native preflight gate is not wired", async () => {
    const root = await createFixture({
      ".github/workflows/package-desktop.yml":
        "name: Desktop Package\non:\n  workflow_dispatch:\nstrategy:\n  matrix:\n    os: [macos-14, windows-latest]\nruns-on: ${{ matrix.os }}\nsteps:\n- run: pnpm desktop:sidecar:prepare\n- run: pnpm desktop:verify\n"
    });

    expect(() => verifyCiWorkflows(root)).toThrow(/desktop:native:preflight/);
  });

  it("fails when package verification does not scan the release bundle", async () => {
    const root = await createFixture({
      ".github/workflows/package.yml":
        "name: Package\nmatrix:\n  os: [ubuntu-latest, macos-14, windows-latest]\nsteps:\n- run: pnpm package:alpha\n- run: pnpm package:verify\n"
    });

    expect(() => verifyCiWorkflows(root)).toThrow(/release:bundle:verify/);
  });

  it("fails when the Phase 7 verification gate is not wired", async () => {
    const root = await createFixture({
      ".github/workflows/quality.yml":
        "name: Quality\nsteps:\n- run: pnpm lint\n- run: pnpm typecheck\n- run: pnpm test\n- run: pnpm build\n- run: pnpm ci:verify\n- run: pnpm docs:verify\n- run: pnpm evaluation:verify\n- run: pnpm desktop:verify\n"
    });

    expect(() => verifyCiWorkflows(root)).toThrow(/phase7:verify/);
  });
});
