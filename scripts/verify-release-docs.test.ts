import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyReleaseDocs } from "./verify-release-docs.mjs";

const tempDirs: string[] = [];

const fixtureDocs: Record<string, string> = {
  "docs/architecture/desktop-local-execution.md": "reviewed commands\ndesktop:verify\nself-contained packaged sidecar binary\n",
  "docs/architecture/runtime-protocol.md": "private pipes\nbounded frame size\nstartup handshake\n",
  "docs/security/local-ai-threat-model.md": "Hosted web mode is API/BYOK only\nUNSAFE_CONFIGURATION\ndesktop:native:preflight\n",
  "docs/provider-compatibility.md": "Cursor\nCodex\nClaude\nGemini\nCopilot\n",
  "docs/desktop-installation.md": "Do not claim clean-machine desktop installation support\nNode installation\ndesktop:native:preflight\ncross-platform desktop bundle targets\nVDT_DESKTOP_SELF_CONTAINED_SIDECAR\n",
  "docs/development/standalone-runner.md": "not the production desktop Local AI user journey\nloopback\npairing\n",
  "docs/release-checklist.md": "pnpm release:verify\npnpm desktop:native:preflight\nManual Evidence\n"
};

async function createFixture(overrides: Record<string, string | null> = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vdt-release-docs-"));
  tempDirs.push(root);
  for (const [file, text] of Object.entries({ ...fixtureDocs, ...overrides })) {
    if (text === null) continue;
    const filePath = path.join(root, file);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, text);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("verify-release-docs", () => {
  it("passes when required release documents contain the expected guardrails", async () => {
    const root = await createFixture();

    expect(verifyReleaseDocs(root).docs).toHaveLength(7);
  });

  it("fails when a required release document is missing", async () => {
    const root = await createFixture({ "docs/security/local-ai-threat-model.md": null });

    expect(() => verifyReleaseDocs(root)).toThrow(/missing required document/);
  });

  it("fails when documentation advertises forbidden unsupported claims", async () => {
    const root = await createFixture({
      "docs/desktop-installation.md":
        "Do not claim clean-machine desktop installation support\nNode installation\ndesktop:native:preflight\ncross-platform desktop bundle targets\nVDT_DESKTOP_SELF_CONTAINED_SIDECAR\nall providers supported\n"
    });

    expect(() => verifyReleaseDocs(root)).toThrow(/forbidden claim/);
  });
});
