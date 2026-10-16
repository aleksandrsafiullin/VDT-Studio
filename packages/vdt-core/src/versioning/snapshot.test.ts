import { describe, expect, it, vi } from "vitest";
import { cloneProject, createVersionSnapshot, listVersions, MAX_VERSION_SNAPSHOTS, productionVolumeProject, restoreVersionWithCheckpoint } from "../index";

describe("checkpointed restoration", () => {
  it("keeps unique sortable IDs during rapid saves at the history limit", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-17T08:00:00Z"));
      let project = cloneProject(productionVolumeProject);
      for (let i = 0; i < MAX_VERSION_SNAPSHOTS * 3 + 5; i++) project = createVersionSnapshot(project, { name: `v${i}` });
      expect(project.versions).toHaveLength(MAX_VERSION_SNAPSHOTS);
      expect(new Set(project.versions.map((version) => version.id)).size).toBe(MAX_VERSION_SNAPSHOTS);
      expect(listVersions(project)[0]?.name).toBe("v64");
      const target = project.versions[0]!;
      const result = restoreVersionWithCheckpoint(project, target.id, "Backup");
      expect(result.project.graph).toEqual(target.projectSnapshot.graph);
      expect(result.project.versions.at(-1)?.id).toBe(result.checkpointVersionId);
      expect(result.project.versions.at(-1)?.projectSnapshot).toEqual({ ...project, versions: [] });
      expect(project.versions[0]?.id).toBe(target.id);
    } finally { vi.useRealTimers(); }
  });
});
