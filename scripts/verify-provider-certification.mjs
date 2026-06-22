import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const registrySource = readFileSync(join(root, "packages/model-bridge/src/registry.ts"), "utf8");
const registryIds = [...registrySource.matchAll(/\{\s*id:\s*"([^"]+)"/g)].map((match) => match[1]);
const certification = JSON.parse(readFileSync(join(root, "release/provider-certification.json"), "utf8"));
const documentedIds = certification.backends.map((entry) => entry.id);
const missing = registryIds.filter((id) => !documentedIds.includes(id));
const unknown = documentedIds.filter((id) => !registryIds.includes(id));
if (missing.length || unknown.length) {
  throw new Error(`Provider certification drift. Missing: ${missing.join(", ") || "none"}; unknown: ${unknown.join(", ") || "none"}.`);
}
for (const entry of certification.backends) {
  if (!entry.status || !entry.evidence || typeof entry.liveVerified !== "boolean") {
    throw new Error(`Incomplete certification record for ${entry.id}.`);
  }
}
process.stdout.write(`Provider certification records verified: ${documentedIds.length}\n`);
