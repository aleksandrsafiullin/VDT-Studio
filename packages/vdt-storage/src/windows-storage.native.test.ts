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
