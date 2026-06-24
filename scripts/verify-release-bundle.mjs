import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const MAX_TEXT_SCAN_BYTES = 2_000_000;

const SECRET_FILE_PATTERNS = [
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.pypirc$/i,
  /(^|\/)id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i,
  /\.(?:pem|p12|pfx|key)$/i,
  /(^|\/)(?:credentials|secrets?)(?:\.json|\.ya?ml|\.txt)?$/i
];

const SECRET_VALUE_PATTERNS = [
  { label: "private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: "OpenAI API key", pattern: /sk-[A-Za-z0-9_-]{20,}/ },
  { label: "Anthropic API key", pattern: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { label: "GitHub token", pattern: /gh[pousr]_[A-Za-z0-9_]{30,}/ },
  { label: "Google API key", pattern: /AIza[0-9A-Za-z_-]{20,}/ },
  { label: "AWS access key", pattern: /AKIA[0-9A-Z]{16}/ },
  {
    label: "secret environment assignment",
    pattern: /\b[A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY)[A-Z0-9_]*\s*=\s*["']?(?!\s*(?:$|redacted|placeholder|example|test|dummy|changeme|none|null|undefined|0)\b)[^"'\s]{8,}/
  }
];

function fail(message) {
  throw new Error(`Release bundle verification failed: ${message}`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function normalizeTarEntry(entry) {
  return entry.replace(/\\/g, "/").replace(/^\.\//, "");
}

function assertSafeRelativePath(relativePath, label) {
  const normalized = normalize(relativePath);
  if (normalized.startsWith(sep) || normalized.startsWith("..") || normalized.includes(`${sep}..${sep}`) || normalized === "..") {
    fail(`${label} contains a path traversal entry: ${relativePath}`);
  }
}

function fileDigest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function walkFiles(root) {
  const pending = [root];
  const files = [];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    const stat = statSync(current);
    if (stat.isDirectory()) {
      for (const name of readdirSync(current)) pending.push(join(current, name));
    } else if (stat.isFile()) {
      files.push(current);
    }
  }
  return files.sort();
}

function isTextBuffer(buffer) {
  return !buffer.includes(0);
}

function scanFileForSecrets(path, displayPath) {
  const normalizedDisplay = normalizeTarEntry(displayPath);
  for (const pattern of SECRET_FILE_PATTERNS) {
    if (pattern.test(normalizedDisplay)) fail(`secret-like file is bundled: ${normalizedDisplay}`);
  }

  const buffer = readFileSync(path);
  if (buffer.length > MAX_TEXT_SCAN_BYTES || !isTextBuffer(buffer)) return;
  const text = buffer.toString("utf8");
  for (const { label, pattern } of SECRET_VALUE_PATTERNS) {
    if (pattern.test(text)) fail(`${label} detected in ${normalizedDisplay}`);
  }
}

function verifyChecksums(releaseDir, tarballName, tarballPath) {
  const expectedDigest = fileDigest(tarballPath);
  const sumsPath = join(releaseDir, "SHA256SUMS");
  const sums = readFileSync(sumsPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const matchingLine = sums.find((line) => line.endsWith(`  ${tarballName}`));
  if (!matchingLine) fail(`SHA256SUMS does not include ${tarballName}.`);
  const [actualDigest] = matchingLine.split(/\s+/);
  if (actualDigest !== expectedDigest) fail(`SHA256SUMS digest for ${tarballName} does not match the artifact.`);

  const manifest = readJson(join(releaseDir, "manifest.json"));
  if (manifest.artifact !== tarballName) fail("release manifest artifact does not match the packaged tarball.");
  if (manifest.sha256 !== expectedDigest) fail("release manifest sha256 does not match the packaged tarball.");
  if (manifest.sbom !== "sbom.spdx.json") fail("release manifest must reference sbom.spdx.json.");
}

function verifySbom(releaseDir, tarballName, tarballPath) {
  const expectedDigest = fileDigest(tarballPath);
  const sbomPath = join(releaseDir, "sbom.spdx.json");
  const sbom = readJson(sbomPath);
  if (sbom.spdxVersion !== "SPDX-2.3") fail("release SBOM must use SPDX-2.3.");
  if (sbom.dataLicense !== "CC0-1.0") fail("release SBOM must declare CC0-1.0 data license.");
  if (!Array.isArray(sbom.documentDescribes) || !sbom.documentDescribes.includes("SPDXRef-ReleaseArtifact-VDTStudioCLI")) {
    fail("release SBOM must describe the CLI release artifact.");
  }
  if (!Array.isArray(sbom.packages)) fail("release SBOM packages must be an array.");
  const releasePackage = sbom.packages.find((entry) => entry?.SPDXID === "SPDXRef-ReleaseArtifact-VDTStudioCLI");
  if (!releasePackage) fail("release SBOM is missing the CLI release artifact package.");
  if (releasePackage.name !== "@vdt-studio/cli") fail("release SBOM artifact package has the wrong name.");
  const checksum = releasePackage.checksums?.find((entry) => entry?.algorithm === "SHA256");
  if (checksum?.checksumValue !== expectedDigest) fail(`release SBOM checksum for ${tarballName} does not match the artifact.`);
  if (sbom.packages.length < 2) fail("release SBOM must include dependency package entries.");
  return { packageCount: sbom.packages.length };
}

function verifyTarball(tarballPath) {
  const entries = execFileSync("tar", ["-tzf", tarballPath], { encoding: "utf8" })
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(normalizeTarEntry);

  for (const entry of entries) {
    assertSafeRelativePath(entry, "release tarball");
  }

  const tempDir = mkdtempSync(join(tmpdir(), "vdt-release-bundle-"));
  try {
    execFileSync("tar", ["-xzf", tarballPath, "-C", tempDir], { stdio: "ignore" });
    for (const file of walkFiles(tempDir)) {
      scanFileForSecrets(file, normalizeTarEntry(file.slice(tempDir.length + 1)));
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  return entries.length;
}

function desktopResourcePaths(root) {
  const tauriConfigPath = join(root, "apps/desktop/src-tauri/tauri.conf.json");
  let tauriConfig;
  try {
    tauriConfig = readJson(tauriConfigPath);
  } catch {
    return [];
  }

  const resources = tauriConfig.bundle?.resources;
  if (!Array.isArray(resources)) return [];
  return resources
    .filter((entry) => typeof entry === "string")
    .map((entry) => {
      assertSafeRelativePath(entry, "desktop bundle resource");
      return join(root, "apps/desktop/src-tauri", entry);
    });
}

export function verifyReleaseBundle(root = DEFAULT_ROOT) {
  const cliManifest = readJson(join(root, "packages/cli/package.json"));
  const releaseDir = join(root, "output/release", `v${cliManifest.version}`);
  const tarballs = readdirSync(releaseDir).filter((name) => name.endsWith(".tgz"));
  if (tarballs.length !== 1) fail(`expected exactly one release tarball, found ${tarballs.length}.`);

  const tarballName = tarballs[0];
  const tarballPath = join(releaseDir, tarballName);
  verifyChecksums(releaseDir, tarballName, tarballPath);
  const sbom = verifySbom(releaseDir, tarballName, tarballPath);
  const tarballEntries = verifyTarball(tarballPath);

  const resources = desktopResourcePaths(root);
  for (const resourcePath of resources) {
    scanFileForSecrets(resourcePath, resourcePath.slice(root.length + 1));
  }

  return {
    tarball: tarballName,
    tarballEntries,
    sbomPackages: sbom.packageCount,
    desktopResources: resources.map((resourcePath) => resourcePath.slice(root.length + 1))
  };
}

if (process.argv[1] === SCRIPT_PATH) {
  const result = verifyReleaseBundle(DEFAULT_ROOT);
  process.stdout.write(
    `Release bundle verified: ${result.tarball}; entries=${result.tarballEntries}; sbomPackages=${result.sbomPackages}; desktopResources=${result.desktopResources.length}\n`
  );
}
