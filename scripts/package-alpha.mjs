import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateReleaseSbom } from "./generate-release-sbom.mjs";
import { runPnpm } from "./package-manager.mjs";
import { claimReleaseDirectory, resolveReleaseDirectory } from "./release-paths.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = resolve(dirname(SCRIPT_PATH), "..");

export function packageAlpha(root = DEFAULT_ROOT, { releaseDir: override } = {}) {
  const cliRoot = join(root, "packages/cli");
  const manifest = JSON.parse(readFileSync(join(cliRoot, "package.json"), "utf8"));
  const releaseDir = resolveReleaseDirectory(root, manifest.version, override);
  const releaseClaim = claimReleaseDirectory(releaseDir);
  let temporary;
  try {
    temporary = mkdtempSync(join(tmpdir(), "vdt-alpha-package-"));
    const packageDir = join(temporary, "package");
    mkdirSync(join(packageDir, "dist"), { recursive: true });
    const { buildSync } = createRequire(join(cliRoot, "package.json"))("esbuild");
    for (const [entry, output] of [["index.ts", "index.mjs"], ["bin.ts", "cli.mjs"]]) {
      buildSync({
        entryPoints: [join(cliRoot, "src", entry)],
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node24",
        outfile: join(packageDir, "dist", output)
      });
    }
    chmodSync(join(packageDir, "dist/cli.mjs"), 0o755);
    const { devDependencies: _dev, scripts: _scripts, ...publishedManifest } = manifest;
    writeFileSync(join(packageDir, "package.json"), `${JSON.stringify(publishedManifest, null, 2)}\n`);
    copyFileSync(join(cliRoot, "README.md"), join(packageDir, "README.md"));
    runPnpm(["pack", "--pack-destination", releaseDir], { cwd: packageDir, stdio: "inherit" });

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
      sha256: digest,
      sbom: "sbom.spdx.json"
    }, null, 2)}\n`, "utf8");
    generateReleaseSbom(root, { releaseDir });
    return { tarball, releaseDir };
  } finally {
    if (temporary) rmSync(temporary, { recursive: true, force: true });
    releaseClaim();
  }
}

if (process.argv[1] === SCRIPT_PATH) {
  const result = packageAlpha(DEFAULT_ROOT, { releaseDir: process.env.VDT_RELEASE_DIR });
  process.stdout.write(`${result.tarball}\n`);
}
