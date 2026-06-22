import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "packages/cli/package.json"), "utf8"));
const releaseDir = join(root, "output", "release", `v${manifest.version}`);

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });
execFileSync("pnpm", ["--filter", "@vdt-studio/cli", "build"], { cwd: root, stdio: "inherit" });
execFileSync("pnpm", ["--filter", "@vdt-studio/cli", "pack", "--pack-destination", releaseDir], {
  cwd: root,
  stdio: "inherit"
});

const tarballs = readdirSync(releaseDir).filter((name) => name.endsWith(".tgz"));
if (tarballs.length !== 1) throw new Error(`Expected one CLI tarball, found ${tarballs.length}.`);
const tarball = join(releaseDir, tarballs[0]);
const entries = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).trim().split("\n");
const forbidden = entries.filter((entry) =>
  /(^|\/)(src|skills|node_modules)(\/|$)|\.DS_Store$/.test(entry)
);
if (forbidden.length > 0) throw new Error(`Forbidden files in release tarball:\n${forbidden.join("\n")}`);
for (const required of ["package/dist/cli.mjs", "package/dist/index.mjs", "package/package.json", "package/README.md"]) {
  if (!entries.includes(required)) throw new Error(`Release tarball is missing ${required}.`);
}

const digest = createHash("sha256").update(readFileSync(tarball)).digest("hex");
writeFileSync(join(releaseDir, "SHA256SUMS"), `${digest}  ${tarballs[0]}\n`, "utf8");
writeFileSync(join(releaseDir, "manifest.json"), `${JSON.stringify({
  name: manifest.name,
  version: manifest.version,
  node: manifest.engines.node,
  artifact: tarballs[0],
  sha256: digest
}, null, 2)}\n`, "utf8");
process.stdout.write(`${tarball}\n`);
