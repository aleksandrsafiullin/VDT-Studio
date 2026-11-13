import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { productionVolumeProject } from "@vdt-studio/vdt-core";
import { expect, test } from "vitest";
import { __openWindowsVdtDatabaseForTests, openVdtDatabase } from "./sqlite";

const runtime = process.env.VDT_WINDOWS_DATA_TEST_RUNTIME;
const parent = process.env.VDT_WINDOWS_DATA_TEST_PRIVATE_PARENT;

test.runIf(process.platform === "win32" && Boolean(runtime && parent))(
  "opens, migrates, writes and reopens a standard-user NTFS storage profile while production admission stays guarded",
  () => {
    const workspace = fs.mkdtempSync(path.join(parent!, "core-storage-"));
    const profile = path.join(workspace, "profile");
    try {
      expect(() => openVdtDatabase(workspace, { dataDir: profile })).toThrow(/reviewed Windows/);
      expect(fs.existsSync(profile)).toBe(false);
      const first = __openWindowsVdtDatabaseForTests(workspace, { dataDir: profile }, runtime!);
      try {
        first.createProject({ id: "native", name: "Native storage" });
        first.createVdt({ id: "tree", projectId: "native", name: "Tree", rootKpi: "Production" });
        first.saveVdtRevision({
          id: "revision_native", projectId: "native", vdtId: "tree", revisionNo: 1,
          source: "user", project: productionVolumeProject
        });
        const second = __openWindowsVdtDatabaseForTests(workspace, { dataDir: profile }, runtime!);
        try { expect(second.getProject("native")?.name).toBe("Native storage"); }
        finally { second.close(); }
      } finally { first.close(); }
      const reopened = __openWindowsVdtDatabaseForTests(workspace, { dataDir: profile }, runtime!);
      try {
        expect(reopened.getVdt("tree")?.activeRevisionId).toBe("revision_native");
        expect(reopened.readVdtRevision(reopened.getVdtRevision("revision_native")!)).toEqual(productionVolumeProject);
      } finally { reopened.close(); }
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  }
);


async function terminateAtFault(workspace: string, profile: string, fault: string): Promise<void> {
  const ready = path.join(workspace, "fault-ready");
  const child = spawn(process.execPath, [
    "--import", "tsx", fileURLToPath(new URL("./windows-storage-crash-child.ts", import.meta.url)),
    runtime!, profile, fault, ready
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  const exit = once(child, "exit");
  try {
    const deadline = Date.now() + 30_000;
    while (!fs.existsSync(ready)) {
      if (child.exitCode !== null || child.signalCode !== null || Date.now() > deadline) {
        throw new Error(`Child did not reach ${fault}: ${stderr}`);
      }
      await delay(20);
    }
    expect(fs.readFileSync(ready, "utf8")).toBe(fault);
    expect(child.kill("SIGKILL")).toBe(true);
    await exit;
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exit;
  }
}

test.runIf(process.platform === "win32" && Boolean(runtime && parent)).each([
  "after_attempt_reserved", "after_stage_fsynced", "after_head_reserved", "after_final_published", "before_finalize"
])("recovers atomic revision after Windows process termination at %s", async (fault) => {
  const workspace = fs.mkdtempSync(path.join(parent!, "revision-crash-"));
  const profile = path.join(workspace, "profile");
  try {
    const first = __openWindowsVdtDatabaseForTests(workspace, { dataDir: profile, revisionLeaseMs: 0 }, runtime!);
    try {
      first.createProject({ id: "native", name: "Native storage" });
      first.createVdt({ id: "tree", projectId: "native", name: "Tree", rootKpi: "Production" });
      first.saveVdtRevision({
        id: "revision_native", projectId: "native", vdtId: "tree", revisionNo: 1,
        source: "user", project: productionVolumeProject
      });
    } finally { first.close(); }
    await terminateAtFault(workspace, profile, fault);
    const reopened = __openWindowsVdtDatabaseForTests(workspace, { dataDir: profile, revisionLeaseMs: 0 }, runtime!);
    try {
      expect(reopened.listVdtRevisions("tree")).toHaveLength(2);
      expect(reopened.getVdtRevisionHead("tree")).toMatchObject({ pendingRevisionId: null, commitGeneration: 2 });
      expect(reopened.readVdtRevision(reopened.getVdtRevision("revision_native")!)).toEqual(productionVolumeProject);
    } finally { reopened.close(); }
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
}, 60_000);
