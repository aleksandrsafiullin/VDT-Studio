import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyProviderCertification } from "./verify-provider-certification.mjs";

const tempDirs: string[] = [];

async function makeFixtureRoot(options: { registryStatus?: string; docsStatus?: string } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vdt-certification-fixture-"));
  tempDirs.push(root);
  await mkdir(path.join(root, "release"), { recursive: true });
  await mkdir(path.join(root, "packages/model-bridge/src"), { recursive: true });
  await mkdir(path.join(root, "packages/local-runner/src/server"), { recursive: true });
  await mkdir(path.join(root, "docs"), { recursive: true });

  await writeFile(
    path.join(root, "release/provider-certification.json"),
    JSON.stringify({
      backends: [
        { id: "mock", status: "supported", liveVerified: true, evidence: "fixture" },
        { id: "codex_subscription", status: "alpha", liveVerified: false, evidence: "fixture" }
      ]
    })
  );
  await writeFile(
    path.join(root, "packages/model-bridge/src/registry.ts"),
    [
      'export const MODEL_BACKEND_DEFINITIONS = Object.freeze([',
      '  { id: "mock", label: "Mock", mode: "api", capabilities: cloud, releaseStatus: "supported" },',
      `  { id: "codex_subscription", label: "Codex CLI", mode: "subscription_cli", capabilities: subscription(false), releaseStatus: "${options.registryStatus ?? "alpha"}" }`,
      "]);"
    ].join("\n")
  );
  await writeFile(
    path.join(root, "packages/local-runner/src/server/manifests.ts"),
    [
      "export const BUILTIN_BACKEND_MANIFESTS = Object.freeze([",
      '  { id: "mock", label: "Safe Mock", kind: "mock", supportLevel: "supported" },',
      '  { id: "codex_subscription", label: "Codex CLI", kind: "subscription_cli", supportLevel: "alpha" }',
      "]);"
    ].join("\n")
  );
  await writeFile(
    path.join(root, "docs/provider-compatibility.md"),
    [
      "# Provider Compatibility",
      "",
      "## Canonical release status",
      "",
      "| Backend ID | Release status |",
      "| --- | --- |",
      "| `mock` | `supported` |",
      `| \`codex_subscription\` | \`${options.docsStatus ?? "alpha"}\` |`,
      "",
      "## Next section"
    ].join("\n")
  );
  return root;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("verify-provider-certification", () => {
  it("passes when certification, registry, manifests, and docs agree", async () => {
    const root = await makeFixtureRoot();
    expect(verifyProviderCertification(root)).toMatchObject({
      count: 2,
      registryCount: 2,
      manifestCount: 2,
      docsCount: 2
    });
  });

  it("fails when registry status drifts from canonical certification", async () => {
    const root = await makeFixtureRoot({ registryStatus: "supported" });
    expect(() => verifyProviderCertification(root)).toThrow(/Registry status drift for codex_subscription/);
  });

  it("fails when provider compatibility docs drift from canonical certification", async () => {
    const root = await makeFixtureRoot({ docsStatus: "supported" });
    expect(() => verifyProviderCertification(root)).toThrow(/Documentation status drift for codex_subscription/);
  });
});
