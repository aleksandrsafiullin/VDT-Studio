import { createHash } from "node:crypto";
import { copyFileSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = resolve(dirname(SCRIPT_PATH), "..");

export function verifyParserWorker(directory) {
  const worker = join(directory, "parser-worker.cjs");
  const manifestFile = join(directory, "parser-worker.manifest.json");
  for (const file of [worker, manifestFile]) {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Parser worker resources must be regular files.");
  }
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  const bytes = readFileSync(worker);
  if (manifest.schemaVersion !== 1 || manifest.entrypoint !== "parser-worker.cjs" || manifest.byteLength !== bytes.length || manifest.sha256 !== createHash("sha256").update(bytes).digest("hex")) {
    throw new Error("Parser worker resource digest does not match its manifest.");
  }
  return manifest;
}

export function copyParserWorker(destination, root = DEFAULT_ROOT) {
  const source = join(root, "packages/data-harness/src");
  verifyParserWorker(source);
  for (const name of ["parser-worker.cjs", "parser-worker.manifest.json"]) copyFileSync(join(source, name), join(destination, name));
  return verifyParserWorker(destination);
}

if (process.argv[1] === SCRIPT_PATH) {
  if (process.argv.length !== 3) throw new Error("Usage: node scripts/copy-parser-worker.mjs DIST_DIRECTORY");
  copyParserWorker(resolve(process.argv[2]));
}
