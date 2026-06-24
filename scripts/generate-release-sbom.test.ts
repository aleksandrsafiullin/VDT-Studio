import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateReleaseSbom } from "./generate-release-sbom.mjs";

const tempDirs: string[] = [];

async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "vdt-sbom-fixture-"));
  tempDirs.push(root);
  const packagePaths = [
    ".",
    "apps/web",
    "apps/desktop",
    "packages/ai-harness",
    "packages/cli",
    "packages/local-runner",
    "packages/model-bridge",
    "packages/ui",
    "packages/vdt-core"
  ];
  for (const relativePath of packagePaths) {
    await mkdir(path.join(root, relativePath), { recursive: true });
  }
  await writeJson(path.join(root, "package.json"), { name: "vdt-studio", version: "0.1.0-alpha.0", license: "MIT" });
  for (const relativePath of packagePaths.filter((entry) => entry !== ".")) {
    await writeJson(path.join(root, relativePath, "package.json"), {
      name: `@vdt-studio/${path.basename(relativePath)}`,
      version: relativePath === "packages/cli" ? "0.1.0-alpha.0" : "0.1.0",
      license: "MIT"
    });
  }
  await writeFile(
    path.join(root, "pnpm-lock.yaml"),
    [
      "lockfileVersion: '9.0'",
      "",
      "packages:",
      "",
      "  react@19.2.7:",
      "    resolution: {integrity: sha512-test}",
      "",
      "  '@scope/pkg@1.2.3':",
      "    resolution: {integrity: sha512-test}",
      "",
      "snapshots:",
      ""
    ].join("\n")
  );
  const releaseDir = path.join(root, "output/release/v0.1.0-alpha.0");
  await mkdir(releaseDir, { recursive: true });
  const tarball = path.join(releaseDir, "vdt-studio-cli-0.1.0-alpha.0.tgz");
  await writeFile(tarball, "artifact");
  return { root, tarball };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("generate-release-sbom", () => {
  it("writes an SPDX 2.3 document describing the release artifact", async () => {
    const { root, tarball } = await createFixture();
    const digest = createHash("sha256").update(await readFile(tarball)).digest("hex");

    const result = generateReleaseSbom(root);
    const sbom = JSON.parse(await readFile(path.join(root, "output/release/v0.1.0-alpha.0/sbom.spdx.json"), "utf8"));

    expect(result.packageCount).toBeGreaterThan(10);
    expect(sbom).toMatchObject({
      spdxVersion: "SPDX-2.3",
      dataLicense: "CC0-1.0",
      documentDescribes: ["SPDXRef-ReleaseArtifact-VDTStudioCLI"]
    });
    expect(sbom.packages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          SPDXID: "SPDXRef-ReleaseArtifact-VDTStudioCLI",
          checksums: [{ algorithm: "SHA256", checksumValue: digest }]
        }),
        expect.objectContaining({ name: "react", versionInfo: "19.2.7" }),
        expect.objectContaining({ name: "@scope/pkg", versionInfo: "1.2.3" })
      ])
    );
  });
});
