import { mkdtemp, rm, symlink, truncate } from "node:fs/promises";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { PARSER_RESOURCE_LIMITS } from "@vdt-studio/data-harness";
import { productionVolumeProject } from "@vdt-studio/vdt-core";
import { acquireWindowsStorageProfile, openWindowsStorage } from "../../../../../packages/vdt-storage/src/windows-storage";
import {
  listLibraryDatasetFiles,
  readDatasetFile,
  readDiscoveryRun,
  saveDatasetFile,
  saveDiscoveryRun,
  updateLibraryDatasetFile,
  withRetainedDatasetForAnalysis
} from "./store";

const { openDatabase } = vi.hoisted(() => ({ openDatabase: vi.fn() }));
// Exercise the real native adapter while Windows database admission remains closed.
vi.mock("@vdt-studio/storage", async (importOriginal) => ({
  ...await importOriginal<typeof import("@vdt-studio/storage")>(),
  openVdtDatabase: openDatabase
}));

const runtime = process.env.VDT_WINDOWS_DATA_TEST_RUNTIME;
const parent = process.env.VDT_WINDOWS_DATA_TEST_PRIVATE_PARENT;

it.runIf(process.platform === "win32" && process.arch === "x64" && Boolean(runtime && parent))(
  "uses the native profile session for dataset and discovery lifecycle operations",
  async () => {
    const workspace = await mkdtemp(path.join(parent!, "data-store-"));
    const root = path.join(workspace, "profile");
    const owner = { dataDir: root, projectId: "project_native", vdtId: "vdt_native" };
    openDatabase.mockImplementation((_cwd: string, { dataDir }: { dataDir: string }) => {
      expect(dataDir).toBe(root);
      const lease = acquireWindowsStorageProfile(root, () => openWindowsStorage(runtime!, root));
      return { dataDir, close: lease.release };
    });
    const seed = openWindowsStorage(runtime!, root, true);
    try {
      const projects = seed.createChild("projects");
      projects.createChild(owner.projectId).close();
      projects.close();
      const bytes = Buffer.from("Name,Value\nA,1");
      const datasetId = "dataset_native";
      const metadata = {
        fileName: "native.csv", mimeType: "text/csv", sizeBytes: bytes.byteLength,
        contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        storageRef: datasetId, uploadedAt: "2026-11-13T00:00:00Z",
        projectId: owner.projectId, vdtId: owner.vdtId
      };
      const file = { datasetId, metadata, bytes, textPreview: bytes.toString() };
      await saveDatasetFile(file, owner);
      await expect(saveDatasetFile(file, owner)).rejects.toMatchObject({ code: "DATASET_ALREADY_EXISTS" });
      expect((await readDatasetFile(datasetId, owner))?.bytes).toEqual(new Uint8Array(bytes));
      const cancelled = new AbortController();
      cancelled.abort();
      const consume = vi.fn();
      await expect(withRetainedDatasetForAnalysis(datasetId, owner, cancelled.signal, consume))
        .rejects.toMatchObject({ code: "DATA_PARSER_CANCELLED" });
      expect(consume).not.toHaveBeenCalled();
      await withRetainedDatasetForAnalysis(datasetId, owner, undefined, async (source) => {
        expect(source?.metadata.contentHash).toBe(metadata.contentHash);
      });
      await updateLibraryDatasetFile(datasetId, owner, { action: "rename", displayName: "Native retained source" });
      await updateLibraryDatasetFile(datasetId, owner, { action: "archive" });
      expect(await listLibraryDatasetFiles(owner)).toEqual([]);
      await updateLibraryDatasetFile(datasetId, owner, { action: "restore" });
      await updateLibraryDatasetFile(datasetId, owner, { action: "attach", vdtId: "vdt_other" });
      expect(await listLibraryDatasetFiles(owner)).toMatchObject([{ displayName: "Native retained source", vdtIds: ["vdt_native", "vdt_other"].sort() }]);
      await updateLibraryDatasetFile(datasetId, owner, { action: "detach", vdtId: "vdt_other" });
      expect(await listLibraryDatasetFiles(owner)).toMatchObject([{ vdtIds: [owner.vdtId] }]);

      const snapshot = {
        runId: "run_native", datasetId, projectId: productionVolumeProject.id, workspaceProjectId: owner.projectId,
        vdtId: owner.vdtId, status: "waiting_review" as const, phase: "change_set_validation" as const, file: metadata,
        events: [], warnings: [], tables: [], observations: [], auditLog: [], cacheKeys: [], validationResults: [],
        createdAt: metadata.uploadedAt, updatedAt: metadata.uploadedAt
      };
      await saveDiscoveryRun(snapshot, owner, productionVolumeProject);
      await saveDiscoveryRun({ ...snapshot, status: "failed" }, owner);
      expect(await readDiscoveryRun(snapshot.runId, owner)).toMatchObject({ status: "failed", projectId: productionVolumeProject.id });
      await symlink(root, path.join(root, "projects", owner.projectId, "files", "unsafe"), "junction");
      await expect(readDatasetFile("unsafe", owner)).rejects.toThrow();
      expect(await listLibraryDatasetFiles(owner)).toHaveLength(1);

      const payload = path.join(root, "projects", owner.projectId, "files", datasetId, "payload.bin");
      await truncate(payload, bytes.length + 1);
      await expect(withRetainedDatasetForAnalysis(datasetId, owner, undefined, async () => undefined))
        .rejects.toMatchObject({ code: "DATA_SOURCE_INTEGRITY_FAILED" });

      const oversized = { ...file, datasetId: "legacy_large", metadata: { ...metadata, storageRef: "legacy_large" }, bytes: Buffer.alloc(PARSER_RESOURCE_LIMITS.fileBytes + 1) };
      oversized.metadata.sizeBytes = oversized.bytes.byteLength;
      oversized.metadata.contentHash = `sha256:${createHash("sha256").update(oversized.bytes).digest("hex")}`;
      await saveDatasetFile(oversized, owner);
      await expect(withRetainedDatasetForAnalysis(oversized.datasetId, owner, undefined, async () => undefined))
        .rejects.toMatchObject({ code: "DATA_FILE_TOO_LARGE" });
    } finally {
      seed.close();
      openDatabase.mockReset();
      await rm(workspace, { recursive: true, force: true });
    }
  }
);
