import type { VdtProject } from "../types";
import { compareVersionProjects } from "../versioning/compare";
import { versionDisplayName } from "../versioning/names";
import { createVersionSnapshot, listVersions, restoreVersionWithCheckpoint } from "../versioning/snapshot";
import type { OperationContext } from "./context";

export type VersionCommand =
  | { kind: "save"; name: string }
  | { kind: "rename"; versionId: string; name: string }
  | { kind: "restore"; versionId: string };

type VersionNotFound = { status: "error"; code: "VERSION_NOT_FOUND"; message: string };

export type VersionOperationResult =
  | {
      status: "ok";
      project: VdtProject;
      result: { operationId: string; versionId: string } & (
        | { kind: "save" | "rename" }
        | { kind: "restore"; checkpointVersionId: string; restoredVersionName: string }
      );
    }
  | VersionNotFound
  | { status: "error"; code: "INVALID_VERSION_NAME"; message: string };

function versionNotFound(): VersionNotFound {
  return { status: "error", code: "VERSION_NOT_FOUND", message: "This version is no longer available. Select another version." };
}

export function applyVersionOperation(
  project: VdtProject,
  command: VersionCommand,
  { operationId, now }: OperationContext
): VersionOperationResult {
  const identity = { id: `version_operation_${encodeURIComponent(operationId)}`, createdAt: now };
  if (command.kind === "save") {
    const result = { kind: command.kind, operationId, versionId: identity.id };
    if (project.versions.some((version) => version.id === identity.id)) {
      return { status: "ok", project, result };
    }
    const name = command.name.trim().slice(0, 160);
    if (!name) return { status: "error", code: "INVALID_VERSION_NAME", message: "Enter a version name." };
    return { status: "ok", project: createVersionSnapshot(project, { name }, identity), result };
  }

  const version = project.versions.find((entry) => entry.id === command.versionId);
  if (!version) return versionNotFound();
  if (command.kind === "rename") {
    const name = command.name.trim().slice(0, 160);
    if (!name) return { status: "error", code: "INVALID_VERSION_NAME", message: "Enter a version name." };
    return {
      status: "ok",
      project: {
        ...project,
        updatedAt: now,
        versions: project.versions.map((entry) => entry === version ? { ...entry, name } : entry)
      },
      result: { kind: command.kind, operationId, versionId: version.id }
    };
  }

  const restoredVersionName = versionDisplayName(version);
  const restored = restoreVersionWithCheckpoint(project, version.id, `Before restoring “${restoredVersionName}”`, identity);
  return {
    status: "ok",
    project: restored.project,
    result: {
      kind: command.kind,
      operationId,
      versionId: version.id,
      checkpointVersionId: restored.checkpointVersionId,
      restoredVersionName
    }
  };
}

export function listVersionOperations(project: VdtProject) {
  return listVersions(project).map((version) => ({
    id: version.id,
    name: versionDisplayName(version),
    createdAt: version.createdAt
  }));
}

export function compareVersionOperation(project: VdtProject, { versionId }: { versionId: string }) {
  const version = project.versions.find((entry) => entry.id === versionId);
  if (!version) return versionNotFound();
  return {
    status: "ok" as const,
    result: {
      versionId,
      versionName: versionDisplayName(version),
      ...compareVersionProjects(version.projectSnapshot, project)
    }
  };
}
