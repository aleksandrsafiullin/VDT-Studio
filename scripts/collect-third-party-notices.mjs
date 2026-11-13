import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(import.meta.url);
const REPO = dirname(dirname(SCRIPT));
const SUPPLEMENTS = join(dirname(SCRIPT), "third-party-notices");
const NOTICE = /^(?:licen[sc]es?|copying|copyrights?|notices?|third[-_ ]party[-_ ](?:licenses?|notices?)|unlicense)(?:[._ -].*)?$/i;
const TEXT = /\.(?:txt|md|rst|markdown|html|json|adoc|org)$/i;
const sorted = (values) => [...values].sort();
const portable = (path) => path.split(sep).join("/");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));

function noticeFiles(root, declaredFile) {
  const files = new Set();
  function visit(directory, noticeDirectory = false) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") {
        visit(path, noticeDirectory || NOTICE.test(entry.name));
      } else if (entry.isFile() && (noticeDirectory || NOTICE.test(entry.name)) &&
          (!entry.name.includes(".") || TEXT.test(entry.name) || /^(?:LICENSE|COPYING)\.(?:apache(?:-2\.0)?|bsd|mit|mpl|gpl|lgpl|isc|unicode|zlib)$/i.test(entry.name))) {
        files.add(path);
      }
    }
  }
  visit(root);
  if (declaredFile) {
    const path = resolve(root, declaredFile);
    const local = relative(root, path);
    if (!local || local === ".." || local.startsWith(".." + sep) || isAbsolute(local)) {
      throw new Error("Declared license file is outside its package.");
    }
    files.add(path);
  }
  return sorted(files);
}

function installedPackages(source) {
  const packages = [];
  function physicalDirectory(directory) {
    return lstatSync(directory, { throwIfNoEntry: false })?.isDirectory() === true;
  }
  function addDirectory(directory) {
    if (!physicalDirectory(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const root = join(directory, entry.name);
      if (entry.name.startsWith("@")) {
        addDirectory(root);
        continue;
      }
      const manifestPath = join(root, "package.json");
      if (lstatSync(manifestPath, { throwIfNoEntry: false })?.isFile()) {
        const manifest = json(manifestPath);
        packages.push({ ecosystem: "npm", name: manifest.name, version: manifest.version, license: manifest.license, root });
      }
      addDirectory(join(root, "node_modules"));
    }
  }

  const modules = join(source, "node_modules");
  addDirectory(modules);
  const store = join(modules, ".pnpm");
  if (physicalDirectory(modules) && physicalDirectory(store)) {
    for (const entry of readdirSync(store, { withFileTypes: true })) {
      if (entry.isDirectory()) addDirectory(join(store, entry.name, "node_modules"));
    }
  }
  for (const group of ["apps", "packages"]) {
    const parent = join(source, group);
    if (!physicalDirectory(parent)) continue;
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (entry.isDirectory()) addDirectory(join(parent, entry.name, "node_modules"));
    }
  }
  if (!packages.length) throw new Error("No installed pnpm packages found.");
  return packages;
}

function cargoPackages(metadata) {
  if (!metadata.resolve?.nodes?.length) throw new Error("Cargo metadata lacks a resolved target graph.");
  const ids = new Set(metadata.resolve.nodes.map((node) => node.id));
  return metadata.packages.filter((pkg) => pkg.source && ids.has(pkg.id)).map((pkg) => ({
    ecosystem: "cargo", name: pkg.name, version: pkg.version, license: pkg.license,
    declaredFile: pkg.license_file, root: dirname(pkg.manifest_path)
  }));
}

export function collectThirdPartyNotices(source, output, metadata) {
  const crates = cargoPackages(metadata);
  if (!crates.length) throw new Error("No resolved external Cargo packages found.");
  const inventory = new Map();
  const byHash = new Map();
  const supplementalSources = json(join(SUPPLEMENTS, "sources.json"));
  for (const pkg of [...installedPackages(source), ...crates]) {
    const { ecosystem, name, version, license, root, declaredFile } = pkg;
    const files = noticeFiles(root, declaredFile);
    // The native sharp payload ships an upstream licensing table in its README.
    const supplemental = ecosystem === "npm" && (name.startsWith("@img/sharp-libvips-") || name === "@img/sharp-win32-x64")
      ? [join(root, "README.md")].filter(existsSync)
      : [];
    const notices = sorted(new Set([...files, ...supplemental])).map((file) => {
      const sha256 = createHash("sha256").update(readFileSync(file)).digest("hex");
      byHash.set(sha256, file);
      return { path: portable(relative(root, file)), sha256, ...(supplemental.includes(file) ? { supplemental: true } : {}) };
    });
    if (typeof name !== "string" || typeof version !== "string") throw new Error("Package metadata lacks name or version.");
    for (const item of supplementalSources) {
      if (item.ecosystem !== ecosystem || item.name !== name || item.version !== version) continue;
      const { sha256, url } = item;
      if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Invalid supplemental notice digest.");
      const file = join(SUPPLEMENTS, sha256 + ".txt");
      if (createHash("sha256").update(readFileSync(file)).digest("hex") !== sha256) {
        throw new Error(`Supplemental notice checksum mismatch: ${name}@${version}`);
      }
      byHash.set(sha256, file);
      notices.push({ path: new URL(url).pathname.split("/").at(-1), sha256, supplemental: true, source: url });
    }
    const entry = { ecosystem, name, version, license: typeof license === "string" ? license : null, notices };
    // Package manager peer variants can share identical upstream notice bytes.
    inventory.set(JSON.stringify(entry), entry);
  }

  mkdirSync(output);
  mkdirSync(join(output, "texts"));
  for (const hash of sorted(byHash.keys())) {
    copyFileSync(byHash.get(hash), join(output, "texts", hash + ".txt"));
  }
  writeFileSync(join(output, "inventory.json"), JSON.stringify({
    schemaVersion: 1,
    scope: "Installed pnpm packages (including build dependencies) and external crates in the resolved Cargo target graph.",
    review: "Empty notice lists and any embedded components need review. Texts are indexed by SHA-256 and stored as supplied by upstream packages.",
    packages: sorted(inventory.keys()).map((key) => inventory.get(key))
  }, null, 2) + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT) {
  const [output, target] = process.argv.slice(2);
  if (!output || !target || process.argv.length !== 4) {
    console.error("Usage: node scripts/collect-third-party-notices.mjs OUTPUT_DIR RUST_TARGET");
    process.exitCode = 1;
  } else {
    const metadata = JSON.parse(execFileSync("cargo", [
      "metadata", "--format-version", "1", "--locked", "--offline", "--filter-platform", target,
      "--manifest-path", join(REPO, "apps/desktop/src-tauri/Cargo.toml")
    ], { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true }));
    collectThirdPartyNotices(REPO, resolve(output), metadata);
  }
}
