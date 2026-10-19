import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveReleaseDirectory } from "./release-paths.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = resolve(dirname(SCRIPT_PATH), "..");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sanitizeSpdxId(value) {
  return String(value).replace(/[^A-Za-z0-9.-]/g, "-");
}

function workspacePackage(root, relativePath) {
  const manifest = readJson(join(root, relativePath, "package.json"));
  return {
    name: manifest.name,
    versionInfo: manifest.version ?? "NOASSERTION",
    SPDXID: `SPDXRef-Package-${sanitizeSpdxId(manifest.name)}`,
    downloadLocation: "NOASSERTION",
    filesAnalyzed: false,
    licenseConcluded: "NOASSERTION",
    licenseDeclared: manifest.license ?? "NOASSERTION",
    copyrightText: "NOASSERTION",
    externalRefs: [
      {
        referenceCategory: "PACKAGE-MANAGER",
        referenceType: "purl",
        referenceLocator: `pkg:npm/${encodeURIComponent(manifest.name)}@${encodeURIComponent(manifest.version ?? "0.0.0")}`
      }
    ]
  };
}

function localDependencyPackages(root) {
  const workspacePaths = [".", ...["apps", "packages"].flatMap((parent) =>
    readdirSync(join(root, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(root, parent, entry.name, "package.json")))
      .map((entry) => `${parent}/${entry.name}`)
      .sort()
  )];
  return workspacePaths.map((relativePath) => workspacePackage(root, relativePath));
}

function lockfilePackageRefs(root) {
  const lockfile = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
  const packagesSection = lockfile.split(/\npackages:\r?\n/)[1]?.split(/\nsnapshots:\r?\n/)[0];
  if (!packagesSection) throw new Error("Lockfile packages section is required for the release SBOM.");
  const refs = new Map();
  const packagePattern = /^  (?! )(['"]?)([^\n]+?)\1:\r?$/gm;
  let match;
  while ((match = packagePattern.exec(packagesSection)) !== null) {
    const key = match[2];
    const separator = key.indexOf("@", key.startsWith("@") ? 1 : 0);
    if (separator < 1) continue;
    const name = key.slice(0, separator);
    const rawVersion = key.slice(separator + 1);
    if (!name || !rawVersion || rawVersion.startsWith("link:")) continue;
    const nextEntry = packagesSection.slice(packagePattern.lastIndex).search(/^  \S/m);
    const details = packagesSection.slice(packagePattern.lastIndex, nextEntry < 0 ? undefined : packagePattern.lastIndex + nextEntry);
    const tarballVersion = details.match(/^    version: ['"]?([^'"\s]+)['"]?\r?$/m)?.[1];
    const version = /^https?:/.test(rawVersion) ? tarballVersion : rawVersion.split("(")[0];
    if (!version) throw new Error(`Lockfile tarball package is missing its version: ${key}`);
    const refKey = `${name}@${version}`;
    refs.set(refKey, {
      name,
      versionInfo: version,
      SPDXID: `SPDXRef-Package-${sanitizeSpdxId(refKey)}`,
      downloadLocation: /^https?:/.test(rawVersion) ? rawVersion : "NOASSERTION",
      filesAnalyzed: false,
      licenseConcluded: "NOASSERTION",
      licenseDeclared: "NOASSERTION",
      copyrightText: "NOASSERTION",
      externalRefs: [
        {
          referenceCategory: "PACKAGE-MANAGER",
          referenceType: "purl",
          referenceLocator: `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`
        }
      ]
    });
  }
  return [...refs.values()].sort((left, right) => left.name.localeCompare(right.name) || left.versionInfo.localeCompare(right.versionInfo));
}

function releasePackage(root, releaseDir) {
  const cliManifest = readJson(join(root, "packages/cli/package.json"));
  const tarballName = readdirSync(releaseDir).find((name) => name.endsWith(".tgz"));
  if (!tarballName) throw new Error("Release tarball is required before generating the SBOM.");
  return {
    name: cliManifest.name,
    versionInfo: cliManifest.version,
    SPDXID: "SPDXRef-ReleaseArtifact-VDTStudioCLI",
    downloadLocation: "NOASSERTION",
    filesAnalyzed: false,
    licenseConcluded: cliManifest.license ?? "NOASSERTION",
    licenseDeclared: cliManifest.license ?? "NOASSERTION",
    copyrightText: "NOASSERTION",
    checksums: [
      {
        algorithm: "SHA256",
        checksumValue: sha256(join(releaseDir, tarballName))
      }
    ],
    externalRefs: [
      {
        referenceCategory: "PACKAGE-MANAGER",
        referenceType: "purl",
        referenceLocator: `pkg:npm/${encodeURIComponent(cliManifest.name)}@${encodeURIComponent(cliManifest.version)}`
      }
    ]
  };
}

export function generateReleaseSbom(root = DEFAULT_ROOT, { releaseDir: override } = {}) {
  const cliManifest = readJson(join(root, "packages/cli/package.json"));
  const releaseDir = resolveReleaseDirectory(root, cliManifest.version, override);
  const release = releasePackage(root, releaseDir);
  const workspacePackages = localDependencyPackages(root);
  const lockPackages = lockfilePackageRefs(root);
  const packages = [release, ...workspacePackages, ...lockPackages];
  const document = {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `VDT Studio ${cliManifest.version} alpha release SBOM`,
    documentNamespace: `https://vdt-studio.local/spdx/vdt-studio-${cliManifest.version}-${Date.now()}`,
    creationInfo: {
      created: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      creators: ["Tool: scripts/generate-release-sbom.mjs"]
    },
    documentDescribes: [release.SPDXID],
    packages,
    relationships: workspacePackages.map((pkg) => ({
      spdxElementId: release.SPDXID,
      relationshipType: "CONTAINS",
      relatedSpdxElement: pkg.SPDXID
    }))
  };
  const outputPath = join(releaseDir, "sbom.spdx.json");
  writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return { outputPath, packageCount: packages.length, releaseArtifact: basename(outputPath) };
}

if (process.argv[1] === SCRIPT_PATH) {
  const result = generateReleaseSbom(DEFAULT_ROOT, { releaseDir: process.env.VDT_RELEASE_DIR });
  process.stdout.write(`Release SBOM generated: ${result.outputPath}; packages=${result.packageCount}\n`);
}
