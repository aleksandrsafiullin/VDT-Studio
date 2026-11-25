import type { VdtAiTaskType, VdtProject, VdtVersion } from "../types";
import { cloneProject, nowIso } from "../utils";

/** FIFO cap — oldest snapshots evicted when exceeded. */
export const MAX_VERSION_SNAPSHOTS = 20;

export interface CreateVersionSnapshotOptions {
  name: string;
  description?: string | undefined;
  taskType?: VdtAiTaskType | undefined;
}

interface SnapshotIdentity {
  id: string;
  createdAt: string;
}

export class VersionNotFoundError extends Error {
  constructor(versionId: string) {
    super(`Version not found: ${versionId}`);
    this.name = "VersionNotFoundError";
  }
}

export function createVersionSnapshot(
  project: VdtProject,
  options: CreateVersionSnapshotOptions,
  identity?: SnapshotIdentity
): VdtProject {
  const { id, createdAt } = identity ?? nextSnapshotIdentity(project);
  const version: VdtVersion = {
    id,
    name: options.name,
    ...(options.description !== undefined ? { description: options.description } : {}),
    ...(options.taskType !== undefined ? { taskType: options.taskType } : {}),
    projectSnapshot: cloneProject({ ...project, versions: [] }),
    createdAt
  };

  const versions = [...project.versions.slice(-(MAX_VERSION_SNAPSHOTS - 1)), version];

  return {
    ...project,
    versions,
    updatedAt: createdAt
  };
}

function nextSnapshotIdentity(project: VdtProject): SnapshotIdentity {
  const createdAt = nowIso();
  const prefix = `version_${Date.parse(createdAt)}_`;
  const sequence = project.versions.reduce((next, entry) => {
    const suffix = entry.id.startsWith(prefix) ? Number(entry.id.slice(prefix.length)) : NaN;
    return Number.isFinite(suffix) ? Math.max(next, suffix + 1) : next;
  }, project.versions.length);
  return { id: `${prefix}${String(sequence).padStart(8, "0")}`, createdAt };
}

/**
 * Restore graph/scenarios and related model state from a snapshot.
 * Preserves project identity (id, name, metadata), aiSettings, and the full
 * version history so users can switch between snapshots without losing history.
 */
export function restoreVersionSnapshot(project: VdtProject, versionId: string, restoredAt = nowIso()): VdtProject {
  const version = project.versions.find((entry) => entry.id === versionId);
  if (!version) {
    throw new VersionNotFoundError(versionId);
  }

  const snapshot = version.projectSnapshot;

  return {
    ...project,
    rootNodeId: snapshot.rootNodeId,
    graph: cloneProject(snapshot.graph),
    scenarios: cloneProject(snapshot.scenarios),
    dataSources: cloneProject(snapshot.dataSources),
    aiReview:
      snapshot.aiReview !== undefined
        ? cloneProject(snapshot.aiReview)
        : undefined,
    updatedAt: restoredAt
  };
}

export function listVersions(project: VdtProject): VdtVersion[] {
  // A stable sort keeps later snapshots first when timestamps coincide.
  return [...project.versions].reverse().sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)
  );
}

/** Resolve the target before adding the checkpoint, which may evict it at the FIFO cap. */
export function restoreVersionWithCheckpoint(
  project: VdtProject,
  versionId: string,
  checkpointName: string,
  identity?: SnapshotIdentity
) {
  const restored = restoreVersionSnapshot(project, versionId, identity?.createdAt);
  const checkpointed = createVersionSnapshot(project, {
    name: checkpointName,
    description: "State before restoration. Select this version to return to it."
  }, identity);
  return {
    project: { ...restored, versions: checkpointed.versions },
    checkpointVersionId: checkpointed.versions[checkpointed.versions.length - 1]!.id
  };
}
