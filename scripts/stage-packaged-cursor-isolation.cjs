const { createHash } = require("node:crypto");
const { lstatSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const { isAbsolute, join } = require("node:path");
const {
  cursorIsolationResourceName, measurePackagedCursorIsolation, packagedCursorIsolationDigest,
  packagedCursorIsolationEntry
} = require("../apps/desktop/packaged-web.cjs");

const workerDirectory = "windows-cursor-worker";
const workerResources = {
  worker: "vdt-windows-cursor-worker.exe",
  preload: "proxy-preload.cjs"
};
const desktop = join(__dirname, "../apps/desktop");
const qualificationRecords = join(__dirname, "../release/cursor-checkpoint-qualification.json");
const manifestTemplate = "const cursorIsolationResourceManifest = Object.freeze({});";
const rawSha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const reviewedEgress = "sha256:e85c2a78593dd9f33614cd7e1325ecac77ad36073d973fd3d75679f6e6d784d3";

function exactKeys(value, fields) {
  return value && typeof value === "object" && Object.keys(value).length === fields.length
    && fields.every(key => Object.hasOwn(value, key));
}

function readCursorQualification(platform, arch) {
  const records = JSON.parse(readFileSync(qualificationRecords, "utf8"));
  if (!exactKeys(records, ["darwin-arm64", "win32-x64"])) throw new Error("Invalid Cursor qualification targets.");
  const entries = records[`${platform}-${arch}`];
  const hashes = ["evidenceHash", "toolCatalogHash", "payloadHash", "policyHash", "vendorPolicyHash"];
  const labels = ["catalogModelDisplayName", "runtimeModelDisplayName"];
  if (!Array.isArray(entries) || entries.some(entry =>
    !exactKeys(entry, [...hashes, ...labels, "cliVersion", "protocolVersion", "testedAt", "platform", "modelId"])
    || !hashes.every(key => typeof entry[key] === "string" && /^sha256:[a-f0-9]{64}$/.test(entry[key]))
    || !labels.every(key => typeof entry[key] === "string" && /^Grok [A-Za-z0-9 .()+_-]{1,100}$/.test(entry[key]))
    || typeof entry.cliVersion !== "string" || !/^\d{4}\.\d{2}\.\d{2}-[a-f0-9]{7,40}$/.test(entry.cliVersion)
    || entry.protocolVersion !== "vdt-cursor-checkpoint-v1"
    || !Number.isFinite(Date.parse(entry.testedAt)) || new Date(entry.testedAt).toISOString() !== entry.testedAt
    || !exactKeys(entry.platform, ["os", "arch", "runtimeVersion"]) || entry.platform.os !== platform
    || entry.platform.arch !== arch || !/^v24\.\d+\.\d+$/.test(entry.platform.runtimeVersion)
    || !["grok-4.7-low", "grok-4.7-xhigh"].includes(entry.modelId))
    || new Set(entries.map(entry => entry.modelId)).size !== entries.length) {
    throw new Error("Invalid reviewed Cursor qualification records.");
  }
  return entries;
}

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

/** Build app-owned modules from the release archive. Vendor files and local
 * authentication are never inputs to a standard installer. */
async function stageStandardCursorIsolation(destination, platform, arch, workers, workerPolicyHash) {
  const target = `${platform}-${arch}`;
  if (!isAbsolute(destination) || !["darwin-arm64", "win32-x64"].includes(target)
    || (platform === "win32"
      ? !workers || !isAbsolute(workers) || !/^sha256:[a-f0-9]{64}$/.test(workerPolicyHash)
      : workers !== undefined || workerPolicyHash !== undefined)) {
    throw new Error("Invalid standard Cursor isolation packaging target.");
  }
  const evidences = readCursorQualification(platform, arch);
  if (workerPolicyHash && evidences.some(evidence => evidence.policyHash !== workerPolicyHash)) {
    throw new Error("The built Windows Cursor worker does not match the reviewed policy.");
  }
  const bootstrap = readFileSync(join(desktop, "packaged-web.cjs"), "utf8");
  if (bootstrap.split(manifestTemplate).length !== 2) throw new Error("Expected one Cursor digest slot in the bootstrap.");

  const resources = [cursorIsolationResourceName];
  const assets = workers && Object.entries(workerResources).map(([key, name]) => {
    const source = join(workers, name);
    const info = lstatSync(source);
    if (!info.isFile() || info.size > 8 * 1024 * 1024) throw new Error("Invalid built Windows Cursor worker file.");
    const bytes = readFileSync(source);
    return { key, name, bytes, digest: rawSha256(bytes) };
  });
  const workerDigests = Object.fromEntries((assets || []).map(({ key, digest }) => [key, digest]));
  const profile = { standard: true, evidences, ...(assets && {
    workerExecutableHash: `sha256:${workerDigests.worker}`,
    proxyPreloadHash: `sha256:${workerDigests.preload}`,
    egressPolicyHash: reviewedEgress
  }) };
  const mac = platform === "darwin";
  const esbuild = createRequire(require.resolve("tsx"))("esbuild");
  const build = await esbuild.build({
    absWorkingDir: desktop,
    entryPoints: [mac ? "cursor-isolation/macos-activation.ts" : "cursor-isolation/windows-activation.ts"],
    bundle: true, platform: "node", target: "node24", format: "cjs", write: false,
    define: { [mac ? "__VDT_MAC_CURSOR_PROFILE__" : "__VDT_WINDOWS_CURSOR_PROFILE__"]: JSON.stringify(profile) }
  });
  const activation = build.outputFiles[0].contents;
  const digest = rawSha256(activation);
  if (assets) {
    const target = join(destination, workerDirectory);
    mkdirSync(target);
    for (const { name, bytes } of assets) {
      writeFileSync(join(target, name), bytes, { flag: "wx", mode: 0o644 });
      resources.push(`${workerDirectory}/${name}`);
    }
  }
  const entry = mac ? digest : { activation: digest, ...workerDigests };
  const pinnedBootstrap = bootstrap.replace(manifestTemplate,
    `const cursorIsolationResourceManifest = Object.freeze(${JSON.stringify({ [target]: entry })});`);
  writeFileSync(join(destination, cursorIsolationResourceName), activation, { flag: "wx", mode: 0o644 });
  writeFileSync(join(destination, "packaged-web.cjs"), pinnedBootstrap, { flag: "wx", mode: 0o644 });
  return { resources, digests: { activation: digest, ...workerDigests } };
}

if (require.main === module) {
  const [destination, platform, architecture, workers, workerPolicyHash, ...extra] = process.argv.slice(2);
  if (!destination || extra.length) throw new Error("Expected resource directory, platform, architecture and Windows worker directory.");
  stageStandardCursorIsolation(destination, platform, architecture, workers, workerPolicyHash).then(result => {
    process.stdout.write(JSON.stringify(result));
  }).catch(error => {
    process.stderr.write(error.message + "\n");
    process.exitCode = 1;
  });
}

module.exports = { stagePackagedCursorIsolation, stageStandardCursorIsolation };
