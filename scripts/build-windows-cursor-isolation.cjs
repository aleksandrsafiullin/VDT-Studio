const { createHash } = require("node:crypto");
const { lstatSync, readFileSync, writeFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const { isAbsolute, join, resolve, win32 } = require("node:path");
const { measurePackagedCursorIsolation } = require("../apps/desktop/packaged-web.cjs");

const sha = /^sha256:[a-f0-9]{64}$/;

function isWindowsDirectory(value) {
  return typeof value === "string" && /^[A-Za-z]:\\[^:]+$/.test(value)
    && !/[\x00-\x1f\x7f/]/.test(value) && win32.normalize(value) === value;
}

function reviewedEvidence(evidence) {
  const {
    evidenceHash, testedAt, cliVersion, protocolVersion, toolCatalogHash, payloadHash, policyHash, vendorPolicyHash,
    platform: { os, arch, runtimeVersion } = {}, modelId, catalogModelDisplayName, runtimeModelDisplayName
  } = evidence ?? {};
  if (![evidenceHash, toolCatalogHash, payloadHash, policyHash, vendorPolicyHash].every(hash => sha.test(hash))
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(testedAt)
    || !Number.isFinite(Date.parse(testedAt)) || new Date(testedAt).toISOString() !== testedAt
    || !/^\d{4}\.\d{2}\.\d{2}-[a-f0-9]{7,40}$/.test(cliVersion)
    || protocolVersion !== "vdt-cursor-checkpoint-v1"
    || os !== "win32" || arch !== "x64" || !/^v24\.\d+\.\d+$/.test(runtimeVersion)
    || !/^grok[-_.][a-z0-9][a-z0-9_.-]{0,149}$/.test(modelId)
    || ![catalogModelDisplayName, runtimeModelDisplayName].every(label => /^Grok [A-Za-z0-9 .()+_-]{1,100}$/.test(label))) {
    throw new Error("The reviewed Windows Cursor evidence does not identify an exact x64 host and model.");
  }
  return {
    evidenceHash, testedAt, cliVersion, protocolVersion, toolCatalogHash, payloadHash, policyHash, vendorPolicyHash,
    platform: { os, arch, runtimeVersion }, modelId, catalogModelDisplayName, runtimeModelDisplayName
  };
}

async function buildWindowsCursorIsolation(profileName, workers, destination) {
  if (![profileName, workers, destination].every(isAbsolute)) {
    throw new Error("The reviewed Windows Cursor profile, worker directory and output paths must be absolute.");
  }
  const {
    evidence, evidences, payloadRoot, systemRoot, privateRoot, workerExecutableHash, proxyPreloadHash, egressPolicyHash
  } = JSON.parse(readFileSync(profileName, "utf8"));
  if (![payloadRoot, systemRoot, privateRoot].every(isWindowsDirectory)
    || ![workerExecutableHash, proxyPreloadHash, egressPolicyHash].every(hash => sha.test(hash))
    || !lstatSync(workers).isDirectory()) {
    throw new Error("The reviewed Windows Cursor activation profile is incomplete.");
  }
  const worker = workerExecutableHash.slice(7);
  const preload = proxyPreloadHash.slice(7);
  measurePackagedCursorIsolation(join(workers, "vdt-windows-cursor-worker.exe"), worker);
  measurePackagedCursorIsolation(join(workers, "proxy-preload.cjs"), preload);

  if (evidence === undefined ? !Array.isArray(evidences) || !evidences.length : evidences !== undefined) {
    throw new Error("Supply either one reviewed evidence record or a nonempty list of reviewed records.");
  }
  const models = evidence === undefined ? evidences.map(reviewedEvidence) : [reviewedEvidence(evidence)];
  if (new Set(models.map(record => record.modelId)).size !== models.length) {
    throw new Error("The reviewed Windows Cursor profile repeats a model identifier.");
  }
  const profile = {
    ...(evidence === undefined ? { evidences: models } : { evidence: models[0] }),
    payloadRoot, systemRoot, privateRoot,
    workerExecutableHash, proxyPreloadHash, egressPolicyHash
  };
  const esbuild = createRequire(require.resolve("tsx"))("esbuild");
  const built = await esbuild.build({
    entryPoints: [resolve(__dirname, "../apps/desktop/cursor-isolation/windows-activation.ts")],
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    write: false,
    define: { __VDT_WINDOWS_CURSOR_PROFILE__: JSON.stringify(profile) }
  });
  const bytes = built.outputFiles[0].contents;
  writeFileSync(destination, bytes, { flag: "wx", mode: 0o600 });
  return { activation: createHash("sha256").update(bytes).digest("hex"), worker, preload };
}

if (require.main === module) {
  if (process.argv.length !== 5) throw new Error("Expected a reviewed Windows Cursor profile, worker directory and output path.");
  buildWindowsCursorIsolation(...process.argv.slice(2)).then(entry => {
    process.stdout.write(JSON.stringify(entry) + "\n");
  }).catch(error => {
    process.stderr.write(error.message + "\n");
    process.exitCode = 1;
  });
}

module.exports = { buildWindowsCursorIsolation };
