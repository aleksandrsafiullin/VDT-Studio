import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Development/CI evidence only. A completed probe is never production admission
// and does not certify ACL policy, namespace durability or crash recovery.
const arguments_ = process.argv.slice(2);
let parent = os.tmpdir();
let output;
for (let index = 0; index < arguments_.length; index += 2) {
  const flag = arguments_[index];
  const value = arguments_[index + 1];
  if (!value || !["--parent", "--output"].includes(flag)) {
    throw new Error("Usage: node probe-windows-storage.mjs [--parent EXISTING_ABSOLUTE_DIRECTORY] [--output NEW_REPORT_JSON]");
  }
  if (flag === "--parent") parent = value;
  else output = path.resolve(value);
}
if (process.platform !== "win32") {
  console.error("Real Windows is required. Cross-compilation or a mocked platform is not native storage evidence.");
  process.exit(2);
}
if (!path.isAbsolute(parent) || !fs.statSync(parent).isDirectory() || fs.lstatSync(parent).isSymbolicLink()) {
  throw new Error("Probe parent must be an existing absolute real directory; do not pass a user profile as the probe itself.");
}
if (output && fs.existsSync(output)) throw new Error("Refusing to overwrite an existing evidence report.");

const source = fileURLToPath(new URL("../native/windows-storage-probe.rs", import.meta.url));
const temporary = fs.mkdtempSync(path.join(parent, "vdt-windows-storage-"));
const marker = path.join(temporary, ".owner");
const owner = randomUUID();
fs.writeFileSync(marker, owner, { flag: "wx" });
let compilationMayStillBeRunning = false;
let result;
try {
  const executable = path.join(temporary, "storage-probe.exe");
  const nativeDirectory = path.join(temporary, "native");
  fs.mkdirSync(nativeDirectory);
  const compile = spawnSync("rustc", ["--edition=2021", source, "-o", executable], {
    encoding: "utf8", timeout: 60_000, windowsHide: true, maxBuffer: 1024 * 1024
  });
  if (compile.error?.code === "ETIMEDOUT") compilationMayStillBeRunning = true;
  if (compile.error || compile.status !== 0) {
    throw new Error(`Native probe compilation failed: ${compile.error?.message ?? compile.stderr.trim()}`);
  }
  const native = spawnSync(executable, [nativeDirectory], {
    encoding: "utf8", timeout: 15_000, windowsHide: true, maxBuffer: 1024 * 1024
  });
  if (native.error || native.status !== 0) {
    throw new Error(`Native probe execution failed: ${native.error?.message ?? native.stderr.trim()}`);
  }
  const observation = JSON.parse(native.stdout);
  if (observation.schemaVersion !== "windows_storage_primitive_probe.v1" ||
      observation.productionAdmission !== false || observation.certifiesCrashDurability !== false) {
    throw new Error("Unexpected probe evidence contract.");
  }
  result = {
    schemaVersion: "windows_storage_capability_observation.v1",
    observedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    osRelease: os.release(),
    nodeProcessArchitecture: process.arch,
    nativeArchitecture: os.machine(),
    environmentArchitecture: {
      processorArchitecture: process.env.PROCESSOR_ARCHITECTURE ?? null,
      processorArchitectureW6432: process.env.PROCESSOR_ARCHITEW6432 ?? null
    },
    observation,
    conclusion: "DIAGNOSTIC_ONLY_NOT_WINDOWS_STORAGE_QUALIFICATION",
    cleanup: { ownedTemporaryDirectoryRemoved: false }
  };
} finally {
  if (compilationMayStillBeRunning) {
    // A timed-out rustc may have a linker child. Preserve this run's directory
    // for explicit process inspection instead of deleting files still in use.
    console.error(`Retained owned probe artifacts after compiler timeout: ${temporary}`);
  } else if (fs.readFileSync(marker, "utf8") === owner) {
    fs.rmSync(temporary, { recursive: true, force: true });
    if (result) result.cleanup.ownedTemporaryDirectoryRemoved = true;
  } else {
    throw new Error("Probe ownership marker changed; refusing cleanup.");
  }
}
const json = `${JSON.stringify(result, null, 2)}\n`;
if (output) fs.writeFileSync(output, json, { flag: "wx" });
process.stdout.write(json);
