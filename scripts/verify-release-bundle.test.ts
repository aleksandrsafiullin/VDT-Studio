import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyReleaseBundle } from "./verify-release-bundle.mjs";

const tempDirs: string[] = [];

async function createFixture(options: { tarSecretFile?: boolean; desktopSecret?: boolean; badChecksum?: boolean } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vdt-release-bundle-fixture-"));
  tempDirs.push(root);

  const version = "1.2.3-test";
  const releaseDir = path.join(root, "output/release", `v${version}`);
  const packageDir = path.join(root, "payload/package");
  const desktopDir = path.join(root, "apps/desktop/src-tauri");
  await mkdir(packageDir, { recursive: true });
  await mkdir(path.join(root, "packages/cli"), { recursive: true });
  await mkdir(path.join(desktopDir, "sidecars"), { recursive: true });

  await writeFile(path.join(root, "packages/cli/package.json"), JSON.stringify({ name: "@vdt-studio/cli", version }));
  await writeFile(path.join(packageDir, "package.json"), JSON.stringify({ name: "@vdt-studio/cli", version }));
  await writeFile(path.join(packageDir, "README.md"), "VDT Studio CLI\n");
  await writeFile(path.join(packageDir, "index.mjs"), "export const ok = true;\n");
  if (options.tarSecretFile) {
    await writeFile(path.join(packageDir, ".env"), "OPENAI_API_KEY=sk-thisShouldNeverShip1234567890\n");
  }

  await writeFile(
    path.join(desktopDir, "tauri.conf.json"),
    JSON.stringify({ bundle: { resources: ["sidecars/vdt-local-runtime"] } })
  );
  await writeFile(
    path.join(desktopDir, "sidecars/vdt-local-runtime"),
    options.desktopSecret
      ? "#!/bin/sh\nOPENAI_API_KEY=sk-thisShouldNeverShip1234567890\n"
      : "#!/bin/sh\nexec node --import tsx packages/local-runner/src/sidecar/index.ts\n"
  );

  await mkdir(releaseDir, { recursive: true });
  const tarballName = "vdt-studio-cli-1.2.3-test.tgz";
  const tarballPath = path.join(releaseDir, tarballName);
  execFileSync("tar", ["-czf", tarballPath, "-C", path.join(root, "payload"), "package"]);
  const digest = createHash("sha256").update(await readFile(tarballPath)).digest("hex");
  const manifestDigest = options.badChecksum ? "0".repeat(64) : digest;
  await writeFile(path.join(releaseDir, "SHA256SUMS"), `${manifestDigest}  ${tarballName}\n`);
  await writeFile(path.join(releaseDir, "manifest.json"), JSON.stringify({ artifact: tarballName, sha256: manifestDigest, sbom: "sbom.spdx.json" }));
  await writeFile(path.join(releaseDir, "sbom.spdx.json"), JSON.stringify({
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: "fixture",
    documentDescribes: ["SPDXRef-ReleaseArtifact-VDTStudioCLI"],
    creationInfo: { created: "2026-06-23T00:00:00Z", creators: ["Tool: fixture"] },
    packages: [
      {
        name: "@vdt-studio/cli",
        SPDXID: "SPDXRef-ReleaseArtifact-VDTStudioCLI",
        versionInfo: version,
        downloadLocation: "NOASSERTION",
        filesAnalyzed: false,
        licenseConcluded: "NOASSERTION",
        licenseDeclared: "NOASSERTION",
        copyrightText: "NOASSERTION",
        checksums: [{ algorithm: "SHA256", checksumValue: digest }]
      },
      {
        name: "dependency",
        SPDXID: "SPDXRef-Package-dependency",
        versionInfo: "1.0.0",
        downloadLocation: "NOASSERTION",
        filesAnalyzed: false,
        licenseConcluded: "NOASSERTION",
        licenseDeclared: "NOASSERTION",
        copyrightText: "NOASSERTION"
      }
    ]
  }));

  return root;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("verify-release-bundle", () => {
  it("passes a release tarball and desktop resources without secret material", async () => {
    const root = await createFixture();

    expect(verifyReleaseBundle(root)).toMatchObject({
      tarball: "vdt-studio-cli-1.2.3-test.tgz",
      sbomPackages: 2,
      desktopResources: ["apps/desktop/src-tauri/sidecars/vdt-local-runtime"]
    });
  });

  it("fails if release checksums do not match the tarball", async () => {
    const root = await createFixture({ badChecksum: true });

    expect(() => verifyReleaseBundle(root)).toThrow(/SHA256SUMS digest/);
  });

  it("fails if the SBOM artifact checksum does not match the tarball", async () => {
    const root = await createFixture();
    const sbomPath = path.join(root, "output/release/v1.2.3-test/sbom.spdx.json");
    const sbom = JSON.parse(await readFile(sbomPath, "utf8"));
    sbom.packages[0].checksums[0].checksumValue = "0".repeat(64);
    await writeFile(sbomPath, JSON.stringify(sbom));

    expect(() => verifyReleaseBundle(root)).toThrow(/SBOM checksum/);
  });

  it("fails if a secret-like file is present in the tarball", async () => {
    const root = await createFixture({ tarSecretFile: true });

    expect(() => verifyReleaseBundle(root)).toThrow(/secret-like file/);
  });

  it("fails if a desktop bundle resource embeds an API key", async () => {
    const root = await createFixture({ desktopSecret: true });

    expect(() => verifyReleaseBundle(root)).toThrow(/OpenAI API key|secret environment assignment/);
  });
});
