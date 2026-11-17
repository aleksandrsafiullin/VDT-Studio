const { readFileSync, writeFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const { createRequire } = require("node:module");
const { isAbsolute, resolve } = require("node:path");

async function buildMacCursorIsolation(profileName, destination) {
  if (!isAbsolute(profileName) || !isAbsolute(destination)) {
    throw new Error("The reviewed macOS Cursor profile and output paths must be absolute.");
  }
  const { evidence, evidences, privateRoot, payloadMount, dedicatedOAuthFile, qaEgressDiagnostics } =
    JSON.parse(readFileSync(profileName, "utf8"));
  const entries = evidence === undefined ? evidences : [evidence];
  if ((evidence !== undefined && evidences !== undefined)
    || !Array.isArray(entries) || entries.length === 0 || entries.some(entry => typeof entry?.modelId !== "string")
    || new Set(entries.map(entry => entry.modelId)).size !== entries.length
    || ![privateRoot, payloadMount, dedicatedOAuthFile].every(
    directory => typeof directory === "string" && isAbsolute(directory)
  )) {
    throw new Error("The macOS Cursor activation profile is incomplete.");
  }
  const reviewed = entries.map(entry => {
    const {
      evidenceHash, testedAt, cliVersion, protocolVersion, toolCatalogHash, payloadHash, policyHash, vendorPolicyHash,
      platform: { os, arch, runtimeVersion }, modelId, catalogModelDisplayName, runtimeModelDisplayName
    } = entry;
    return {
      evidenceHash, testedAt, cliVersion, protocolVersion, toolCatalogHash, payloadHash, policyHash, vendorPolicyHash,
      platform: { os, arch, runtimeVersion }, modelId, catalogModelDisplayName, runtimeModelDisplayName
    };
  });
  const profile = {
    ...(evidence === undefined ? { evidences: reviewed } : { evidence: reviewed[0] }),
    privateRoot, payloadMount, dedicatedOAuthFile,
    ...(qaEgressDiagnostics === true ? { qaEgressDiagnostics } : {})
  };
  // tsx already pins the repository's esbuild dependency.
  const esbuild = createRequire(require.resolve("tsx"))("esbuild");
  const built = await esbuild.build({
    entryPoints: [resolve(__dirname, "../apps/desktop/cursor-isolation/macos-activation.ts")],
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    write: false,
    define: { __VDT_MAC_CURSOR_PROFILE__: JSON.stringify(profile) }
  });
  const bytes = built.outputFiles[0].contents;
  writeFileSync(destination, bytes, { flag: "wx", mode: 0o600 });
  return createHash("sha256").update(bytes).digest("hex");
}

if (require.main === module) {
  if (process.argv.length !== 4) throw new Error("Expected a reviewed macOS Cursor profile and output path.");
  buildMacCursorIsolation(...process.argv.slice(2)).then(hash => process.stdout.write(hash + "\n")).catch(error => {
    process.stderr.write(error.message + "\n");
    process.exitCode = 1;
  });
}

module.exports = { buildMacCursorIsolation };
