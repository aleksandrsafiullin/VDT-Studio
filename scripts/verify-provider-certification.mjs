import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = resolve(dirname(SCRIPT_PATH), "..");

const ALLOWED_STATUSES = new Set([
  "supported",
  "beta",
  "alpha",
  "experimental",
  "beta-blocked",
  "experimental-disabled"
]);

function readText(root, relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function readJson(root, relativePath) {
  return JSON.parse(readText(root, relativePath));
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

export function parseModelRegistryStatuses(source) {
  return [...source.matchAll(/\{\s*id:\s*"([^"]+)"[\s\S]*?mode:\s*"([^"]+)"[\s\S]*?releaseStatus:\s*"([^"]+)"/g)]
    .map((match) => ({ id: match[1], mode: match[2], status: match[3] }));
}

export function parseManifestSupportLevels(source) {
  return [...source.matchAll(/\{\s*id:\s*"([^"]+)"[\s\S]*?kind:\s*"([^"]+)"[\s\S]*?supportLevel:\s*"([^"]+)"/g)]
    .map((match) => ({ id: match[1], kind: match[2], status: match[3] }));
}

export function parseProviderCompatibilityStatuses(source) {
  const section = source.match(/## Canonical release status\s*\n([\s\S]*?)(?:\n## |\s*$)/);
  if (!section) return new Map();

  const statuses = new Map();
  for (const line of section[1].split(/\r?\n/)) {
    const match = line.match(/^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/);
    if (match) statuses.set(match[1], match[2]);
  }
  return statuses;
}

export function verifyProviderCertification(root = DEFAULT_ROOT) {
  const errors = [];
  const certification = readJson(root, "release/provider-certification.json");
  const records = Array.isArray(certification.backends) ? certification.backends : [];
  const certifiedIds = records.map((entry) => entry.id);
  const certifiedById = new Map(records.map((entry) => [entry.id, entry]));

  for (const duplicate of duplicateValues(certifiedIds)) {
    errors.push(`Duplicate certification record for ${duplicate}.`);
  }

  for (const entry of records) {
    if (!entry || typeof entry !== "object") {
      errors.push("Certification records must be objects.");
      continue;
    }
    if (typeof entry.id !== "string" || entry.id.length === 0) {
      errors.push("Certification record is missing id.");
    }
    if (typeof entry.status !== "string" || !ALLOWED_STATUSES.has(entry.status)) {
      errors.push(`Invalid certification status for ${entry.id ?? "unknown"}: ${String(entry.status)}.`);
    }
    if (typeof entry.evidence !== "string" || entry.evidence.trim().length === 0) {
      errors.push(`Incomplete certification record for ${entry.id}: evidence is required.`);
    }
    if (typeof entry.liveVerified !== "boolean") {
      errors.push(`Incomplete certification record for ${entry.id}: liveVerified boolean is required.`);
    }
  }

  const registryStatuses = parseModelRegistryStatuses(readText(root, "packages/model-bridge/src/registry.ts"));
  const registryIds = registryStatuses.map((entry) => entry.id);
  for (const duplicate of duplicateValues(registryIds)) {
    errors.push(`Duplicate model registry backend ${duplicate}.`);
  }

  const missingFromCertification = registryIds.filter((id) => !certifiedById.has(id));
  const unknownInCertification = certifiedIds.filter((id) => !registryIds.includes(id));
  if (missingFromCertification.length || unknownInCertification.length) {
    errors.push(
      `Provider certification drift. Missing: ${missingFromCertification.join(", ") || "none"}; unknown: ${unknownInCertification.join(", ") || "none"}.`
    );
  }

  for (const registryEntry of registryStatuses) {
    const certified = certifiedById.get(registryEntry.id);
    if (!certified) continue;
    if (certified.status !== registryEntry.status) {
      errors.push(
        `Registry status drift for ${registryEntry.id}: registry=${registryEntry.status}; certification=${certified.status}.`
      );
    }
    if (
      (registryEntry.mode === "subscription_cli" || registryEntry.mode === "custom_cli") &&
      certified.status === "supported" &&
      certified.liveVerified !== true
    ) {
      errors.push(`${registryEntry.id} cannot be supported without live verification.`);
    }
  }

  const manifestStatuses = parseManifestSupportLevels(readText(root, "packages/local-runner/src/server/manifests.ts"));
  for (const duplicate of duplicateValues(manifestStatuses.map((entry) => entry.id))) {
    errors.push(`Duplicate local-runner manifest ${duplicate}.`);
  }
  for (const manifestEntry of manifestStatuses) {
    const certified = certifiedById.get(manifestEntry.id);
    if (!certified) {
      errors.push(`Local-runner manifest ${manifestEntry.id} is missing from provider-certification.json.`);
      continue;
    }
    if (certified.status !== manifestEntry.status) {
      errors.push(
        `Local-runner status drift for ${manifestEntry.id}: manifest=${manifestEntry.status}; certification=${certified.status}.`
      );
    }
  }

  const docsStatuses = parseProviderCompatibilityStatuses(readText(root, "docs/provider-compatibility.md"));
  if (docsStatuses.size === 0) {
    errors.push("docs/provider-compatibility.md is missing the Canonical release status table.");
  }
  for (const entry of records) {
    const docsStatus = docsStatuses.get(entry.id);
    if (docsStatus === undefined) {
      errors.push(`docs/provider-compatibility.md is missing status for ${entry.id}.`);
    } else if (docsStatus !== entry.status) {
      errors.push(`Documentation status drift for ${entry.id}: docs=${docsStatus}; certification=${entry.status}.`);
    }
  }
  for (const docsId of docsStatuses.keys()) {
    if (!certifiedById.has(docsId)) errors.push(`docs/provider-compatibility.md documents unknown backend ${docsId}.`);
  }

  if (errors.length > 0) {
    const error = new Error(`Provider certification verification failed:\n- ${errors.join("\n- ")}`);
    error.errors = errors;
    throw error;
  }

  return {
    count: records.length,
    registryCount: registryStatuses.length,
    manifestCount: manifestStatuses.length,
    docsCount: docsStatuses.size
  };
}

if (process.argv[1] === SCRIPT_PATH) {
  const result = verifyProviderCertification(DEFAULT_ROOT);
  process.stdout.write(
    `Provider certification records verified: ${result.count}; registry=${result.registryCount}; manifests=${result.manifestCount}; docs=${result.docsCount}\n`
  );
}
