const { lstatSync, mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const {
  cursorIsolationResourceName, measurePackagedCursorIsolation, packagedCursorIsolationDigest,
  packagedCursorIsolationEntry
} = require("../apps/desktop/packaged-web.cjs");

const workerDirectory = "windows-cursor-worker";
const workerResources = {
  worker: "vdt-windows-cursor-worker.exe",
  preload: "proxy-preload.cjs"
};

function stagePackagedCursorIsolation(destination, platform, architecture) {
  const source = join(__dirname, "../apps/desktop/cursor-isolation");
  const digest = packagedCursorIsolationDigest(platform, architecture);
  const entry = packagedCursorIsolationEntry(platform, architecture);
  if (entry === undefined) return [];
  const bytes = measurePackagedCursorIsolation(join(source, `${platform}-${architecture}.cjs`), digest);
  const resources = [cursorIsolationResourceName];

  if (platform === "win32") {
    const workerSource = join(source, workerDirectory);
    if (!lstatSync(workerSource).isDirectory()) throw new Error("Invalid Windows Cursor worker resource directory.");
    const assets = Object.entries(workerResources).map(([key, filename]) => ({
      filename, bytes: measurePackagedCursorIsolation(join(workerSource, filename), entry[key])
    }));
    const target = join(destination, workerDirectory);
    mkdirSync(target);
    for (const asset of assets) {
      writeFileSync(join(target, asset.filename), asset.bytes, { flag: "wx", mode: 0o644 });
      resources.push(`${workerDirectory}/${asset.filename}`);
    }
  }

  writeFileSync(join(destination, cursorIsolationResourceName), bytes, { flag: "wx", mode: 0o644 });
  return resources;
}

if (require.main === module) {
  if (process.argv.length !== 5) throw new Error("Expected resource directory, platform and architecture.");
  const [destination, platform, architecture] = process.argv.slice(2);
  const resources = stagePackagedCursorIsolation(destination, platform, architecture);
  if (resources.length) process.stdout.write(platform === "win32" ? JSON.stringify(resources) : resources[0]);
}

module.exports = { stagePackagedCursorIsolation };
