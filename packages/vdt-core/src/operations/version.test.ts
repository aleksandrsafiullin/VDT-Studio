import { describe, expect, it } from "vitest";
import { productionVolumeProject } from "../examples/production-volume";
import type { VdtProject } from "../types";
import { cloneProject } from "../utils";
import { createVersionSnapshot, MAX_VERSION_SNAPSHOTS } from "../versioning/snapshot";
import { applyVersionOperation, compareVersionOperation, listVersionOperations } from "./version";

const now = "2026-11-24T09:00:00.000Z";

function withRecovery(project: VdtProject): VdtProject {
  return {
    ...project,
    scenarios: [
      ...project.scenarios,
      {
        id: "recovery",
        name: "Recovery",
        overrides: [{ nodeId: "unplanned_downtime", value: 90 }],
        createdAt: now,
        updatedAt: now
      }
    ],
    dataSources: [{ id: "manual_recovery", name: "Recovery estimate", type: "manual" }]
  };
}

describe("shared version operations", () => {
  it("saves the scenario override and replays the save without creating another version", () => {
    const project = withRecovery(cloneProject(productionVolumeProject));
    const command = { kind: "save", name: " Recovery review " } as const;
    const context = { operationId: "save/recovery", now };
    const saved = applyVersionOperation(project, command, context);
    if (saved.status !== "ok") throw new Error(saved.message);

    const reopened = JSON.parse(JSON.stringify(saved.project)) as VdtProject;
    expect(reopened.versions).toHaveLength(project.versions.length + 1);
    expect(reopened.versions.at(-1)?.projectSnapshot.scenarios).toEqual(project.scenarios);
    expect(reopened.versions.at(-1)?.projectSnapshot.dataSources).toEqual(project.dataSources);
    expect(listVersionOperations(reopened)[0]).toEqual({
      id: saved.result.versionId, name: "Recovery review", createdAt: now
    });
    expect(applyVersionOperation(project, command, context)).toEqual(saved);
    expect(applyVersionOperation(reopened, command, { ...context, now: "2026-11-24T10:00:00.000Z" }))
      .toEqual({ ...saved, project: reopened });
  });

  it("restores the oldest version at the cap and can recover the prior model from its checkpoint", () => {
    let project = cloneProject(productionVolumeProject);
    for (let i = 0; i < MAX_VERSION_SNAPSHOTS; i++) {
      project = createVersionSnapshot(project, { name: `Version ${i}` });
    }
    const oldest = project.versions[0]!;
    const current = withRecovery({
      ...project,
      graph: {
        ...project.graph,
        nodes: project.graph.nodes.map((node) =>
          node.id === "unplanned_downtime" ? { ...node, baselineValue: 80 } : node
        )
      }
    });
    const command = { kind: "restore", versionId: oldest.id } as const;
    const context = { operationId: "restore/oldest", now };
    const restored = applyVersionOperation(current, command, context);
    if (restored.status !== "ok" || restored.result.kind !== "restore") throw new Error("Restore failed");
    expect(restored.project.graph).toEqual(oldest.projectSnapshot.graph);
    expect(restored.project.scenarios).toEqual(oldest.projectSnapshot.scenarios);
    expect(restored.project.dataSources).toEqual(oldest.projectSnapshot.dataSources);
    expect(restored.project.versions).toHaveLength(MAX_VERSION_SNAPSHOTS);
    expect(restored.project.versions.some((version) => version.id === oldest.id)).toBe(false);
    expect(applyVersionOperation(current, command, context)).toEqual(restored);

    const recovered = applyVersionOperation(
      restored.project,
      { kind: "restore", versionId: restored.result.checkpointVersionId },
      { operationId: "restore/pre-restore", now: "2026-11-24T10:00:00.000Z" }
    );
    if (recovered.status !== "ok") throw new Error(recovered.message);
    expect(recovered.project.graph).toEqual(current.graph);
    expect(recovered.project.scenarios).toEqual(current.scenarios);
    expect(recovered.project.dataSources).toEqual(current.dataSources);
    expect(recovered.project.versions).toHaveLength(MAX_VERSION_SNAPSHOTS);
  });

  it("compares base results and reports a distinct scenario and source change", () => {
    const project = createVersionSnapshot(cloneProject(productionVolumeProject), { name: "Before recovery" });
    const versionId = project.versions.at(-1)!.id;
    const result = compareVersionOperation(withRecovery(project), { versionId });
    expect(result).toMatchObject({
      status: "ok",
      result: {
        versionId,
        changes: [],
        root: { comparable: true, delta: 0 },
        scenariosChanged: true,
        dataSourcesChanged: true
      }
    });
    expect(compareVersionOperation(project, { versionId: "missing" })).toMatchObject({
      status: "error",
      code: "VERSION_NOT_FOUND"
    });
  });
});
