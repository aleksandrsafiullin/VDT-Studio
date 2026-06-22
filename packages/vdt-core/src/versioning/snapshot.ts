import type { VdtAiTaskType, VdtProject, VdtVersion } from "../types";
import { cloneProject, nowIso } from "../utils";

/** FIFO cap — oldest snapshots evicted when exceeded. */
export const MAX_VERSION_SNAPSHOTS = 20;

export interface CreateVersionSnapshotOptions {
  name: string;
  description?: string | undefined;
  taskType?: VdtAiTaskType | undefined;
}

export class VersionNotFoundError extends Error {
  constructor(versionId: string) {
    super(`Version not found: ${versionId}`);
    this.name = "VersionNotFoundError";
  }
}

export function createVersionSnapshot(
  project: VdtProject,
  options: CreateVersionSnapshotOptions
): VdtProject {
  const createdAt = nowIso();
  const version: VdtVersion = {
    id: `version_${Date.now()}_${project.versions.length}`,
    name: options.name,
    ...(options.description !== undefined ? { description: options.description } : {}),
    ...(options.taskType !== undefined ? { taskType: options.taskType } : {}),
    projectSnapshot: { ...cloneProject(project), versions: [] },
    createdAt
  };

  const versions =
    project.versions.length >= MAX_VERSION_SNAPSHOTS
      ? [...project.versions.slice(-(MAX_VERSION_SNAPSHOTS - 1)), version]
      : [...project.versions, version];

  return {
    ...project,
    versions,
    updatedAt: createdAt
  };
}

/**
 * Restore graph/scenarios and related model state from a snapshot.
 * Preserves project identity (id, name, metadata), aiSettings, and the full
 * version history so users can switch between snapshots without losing history.
 */
export function restoreVersionSnapshot(project: VdtProject, versionId: string): VdtProject {
  const version = project.versions.find((entry) => entry.id === versionId);
  if (!version) {
    throw new VersionNotFoundError(versionId);
  }

  const snapshot = version.projectSnapshot;
  const restoredAt = nowIso();

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
  return [...project.versions].sort((left, right) => {
    const byCreatedAt =
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    if (byCreatedAt !== 0) {
      return byCreatedAt;
    }
    return right.id.localeCompare(left.id);
  });
}
