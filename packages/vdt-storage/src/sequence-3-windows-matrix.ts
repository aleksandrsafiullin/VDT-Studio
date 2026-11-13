import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { hashFramed } from "./canonical";
import { MATRIX_MANIFEST, MATRIX_MIGRATION_ID } from "./sequence-3-windows-matrix-fixtures";
import { matrixSha } from "./sequence-3-windows-matrix-observe";
import { verifyMatrixCase, type MatrixCase, type MatrixObservation, type MatrixResult } from "./sequence-3-windows-matrix-verify";

const specification = fs.readFileSync(new URL("./migrations/sequence-3-fault-vectors.v1.json", import.meta.url));
const frozen = JSON.parse(specification.toString()) as { cases: MatrixCase[] };
assert.equal(frozen.cases.length, 65);
const childPath = fileURLToPath(new URL("./sequence-3-windows-matrix-child.ts", import.meta.url));
const repository = fileURLToPath(new URL("../../../", import.meta.url));
const [runtimeInput, parentInput, outputInput] = process.argv.slice(2);
const smoke = process.platform === "darwin" && runtimeInput === "--mac-smoke";
const runtime = runtimeInput && (smoke ? runtimeInput : path.resolve(runtimeInput));
const parent = parentInput && path.resolve(parentInput);
const output = outputInput && path.resolve(outputInput);
assert((smoke || process.platform === "win32" && process.arch === "x64") && /^v24\./.test(process.version), "Windows x64 Node 24 required unless running explicit Mac smoke");
assert(runtime && parent && output, "Usage: matrix RUNTIME_DIRECTORY PRIVATE_NTFS_PARENT EVIDENCE_FILE");
const workspace = fs.mkdtempSync(path.join(parent, "sequence3-matrix-"));
const failures: unknown[] = [];
const cases: unknown[] = [];
const observations: unknown[] = [];
const sqlite = new DatabaseSync(":memory:");
const sqliteVersion = String(sqlite.prepare("SELECT sqlite_version() AS version").get()?.version);
sqlite.close();

function argumentsFor(root: string, mode: string, fixture: string, fault = "", index = "none", handshake = "") {
  return ["--import", "tsx", childPath, runtime!, root, mode, fixture, fault, index, handshake];
}

function invoke(root: string, mode: string, fixture: string) {
  const child = spawnSync(process.execPath, argumentsFor(root, mode, fixture), {
    cwd: repository, encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024
  });
  assert.ifError(child.error);
  assert(child.stdout.trim(), child.stderr);
  const result = JSON.parse(child.stdout.trim()) as Exclude<MatrixResult, { kind: "signal" }> & MatrixObservation;
  assert.equal(child.signal, null);
  assert.equal(child.status, result.kind === "storage_error" ? 1 : 0, child.stderr);
  return { ...result, exitCode: child.status };
}

async function crash(root: string, fixture: string, fault: string, index: number | null, mode = "execute") {
  const handshake = path.join(workspace, "child-handshake.json");
  const child = spawn(process.execPath, argumentsFor(root, mode, fixture, fault, index === null ? "none" : String(index), handshake),
    { cwd: repository, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const exit = once(child, "close") as Promise<[number | null, NodeJS.Signals | null]>;
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (data) => { stdout = (stdout + data.toString()).slice(-4096); });
  child.stderr?.on("data", (data) => { stderr = (stderr + data.toString()).slice(-4096); });
  const deadline = Date.now() + 30_000;
  try {
    while (!fs.existsSync(handshake)) {
      if (child.exitCode !== null || child.signalCode !== null || Date.now() >= deadline) {
        throw new Error(`Child did not reach ${fault} (exit ${child.exitCode}, signal ${child.signalCode}): ${stdout} ${stderr}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    let marker: { pid: number; point: string; adoptionIndex: number | null } | undefined;
    while (!marker && Date.now() < deadline) {
      try { marker = JSON.parse(fs.readFileSync(handshake, "utf8")); }
      catch { await new Promise((resolve) => setTimeout(resolve, 10)); }
    }
    assert(marker);
    assert.equal(marker.pid, child.pid);
    assert.equal(marker.point, fault);
    assert.equal(marker.adoptionIndex, index);
    assert(child.kill("SIGKILL"));
    const [exitCode, signal] = await exit;
    assert.equal(exitCode, null, "Node/libuv did not report the required SIGKILL termination");
    assert.equal(signal, "SIGKILL");
    return { kind: "signal" as const, exitCode, signal, marker, mechanism: smoke ? "Node ChildProcess.kill(SIGKILL) on macOS" : "Node ChildProcess.kill(SIGKILL) via Windows TerminateProcess" };
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exit;
    fs.rmSync(handshake, { force: true });
  }
}

try {
  const windowsOnly = new Set(["windows_unsupported", "artifact_checksum_mismatch", "invalid_transform_output"]);
  const selected = smoke ? frozen.cases.filter((spec) => spec.kind !== "crash" && !windowsOnly.has(spec.fixture)) : frozen.cases;
  for (const spec of selected) {
    const caseFolder = fs.mkdtempSync(path.join(workspace, "case-"));
    const root = path.join(caseFolder, "profile");
    let observation: Record<string, unknown> = { caseId: spec.caseId };
    try {
      assert.equal(invoke(root, "seed", spec.fixture).kind, "success");
      if (["partial_pending", "partial_evidence", "backup_failure", "artifact_checksum_mismatch"].includes(spec.fixture)) {
        observation.pristineSeed = invoke(root, "inspect", spec.fixture);
        const point = spec.fixture === "partial_pending" ? "after_foreign_key_pending_created"
          : spec.fixture === "partial_evidence" ? "after_foreign_key_evidence_created" : "after_later_applying_persisted";
        observation.preparation = await crash(root, spec.fixture, point, null, "prepare");
        observation.preparedState = invoke(root, "inspect", spec.fixture);
        if (spec.fixture === "backup_failure") {
          assert.equal(invoke(root, "corrupt_backup", spec.fixture).kind, "success");
        }
      }
      const pre = invoke(root, "inspect", spec.fixture);
      const result = spec.kind === "crash" ? await crash(root, spec.fixture, spec.faultPoint!, spec.adoptionIndex) : invoke(root, "execute", spec.fixture);
      observation = { ...observation, pre, result };
      const post = invoke(root, "inspect", spec.fixture);
      const reopen = invoke(root, "reopen", spec.fixture);
      const first = invoke(root, "inspect", spec.fixture);
      const finalReopen = invoke(root, "final", spec.fixture);
      const final = invoke(root, "inspect", spec.fixture);
      observation = { ...observation, post, reopen, first, finalReopen, final };
      if (!smoke) for (const snapshot of [pre, post, first, final]) assert.equal(snapshot.nativeNamespaceVerified, true);
      cases.push(verifyMatrixCase(spec, pre, result, post, reopen, first, finalReopen, final));
      console.log(JSON.stringify({ caseId: spec.caseId, matchedExpectedPolicy: true }));
    } catch (error) {
      failures.push({ caseId: spec.caseId, error: error instanceof Error ? error.message : String(error) });
      console.error(JSON.stringify(failures.at(-1)));
    } finally {
      observations.push(observation);
      fs.rmSync(caseFolder, { recursive: true, force: true });
    }
  }
  fs.writeFileSync(output + ".observations.json", JSON.stringify({ platform: process.platform, smoke, failures, observations }, null, 2) + "\n", { flag: "wx" });
  assert.equal(failures.length, 0, `${failures.length} frozen cases did not match; see observations`);
  if (!smoke) assert.equal(cases.length, 65);
  if (!smoke) fs.writeFileSync(output, JSON.stringify({
    schemaVersion: "sequence_3_gate_r2_fault_execution_evidence.v1", migrationSequence: 3, migrationId: MATRIX_MIGRATION_ID,
    manifestHash: MATRIX_MANIFEST, faultSpecRawSha256: matrixSha(specification),
    faultVectorsHash: hashFramed("vdt-studio/migration-fault-vectors", "migration_fault_vectors_hash.v1",
      { migrationSequence: 3, migrationId: MATRIX_MIGRATION_ID }, specification),
    faultSpecCaseCount: 65, platform: { processPlatform: process.platform, processArch: process.arch,
      nodeVersion: process.version, sqliteVersion, filesystemType: "NTFS" }, cases
  }, null, 2) + "\n", { flag: "wx" });
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}
