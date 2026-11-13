import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
// Reuse the workspace's pinned build tool, as desktop sidecar preparation does.
const requireCli = createRequire(resolve(root, "packages/cli/package.json"));
const { build } = requireCli("esbuild");
const output = resolve(root, "packages/data-harness/src/parser-worker.cjs");
const manifestPath = resolve(root, "packages/data-harness/src/parser-worker.manifest.json");
const sourcePaths = ["parser-worker-entry.ts", "parser.ts", "parser-primitives.ts", "parser-limits.ts", "workbook-preflight.ts"];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const result = await build({
  absWorkingDir: root,
  entryPoints: ["packages/data-harness/src/parser-worker-entry.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  outfile: output,
  write: false,
  legalComments: "eof",
  logLevel: "silent"
});
const bytes = result.outputFiles[0].contents;
const manifest = `${JSON.stringify({ schemaVersion: 1, entrypoint: "parser-worker.cjs", sha256: hash(bytes), byteLength: bytes.byteLength,
  sources: Object.fromEntries(sourcePaths.map((name) => [`packages/data-harness/src/${name}`, hash(readFileSync(resolve(root, "packages/data-harness/src", name)))]))
}, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if (!Buffer.from(bytes).equals(readFileSync(output)) || manifest !== readFileSync(manifestPath, "utf8")) {
    throw new Error("Parser worker is stale. Run node packages/data-harness/scripts/build-parser-worker.mjs and review the generated changes.");
  }
  process.stdout.write("Parser worker verified.\n");
} else {
  writeFileSync(output, bytes);
  writeFileSync(manifestPath, manifest);
  process.stdout.write(`Parser worker prepared (${bytes.byteLength} bytes).\n`);
}
