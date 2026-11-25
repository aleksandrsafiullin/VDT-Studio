import type { VdtProject } from "../types";
import { applyWorkspaceChange } from "../operations/workspace-change";
import { cloneProject } from "../utils";
import type { VdtChangeSet } from "./types";
import { filterChangeSet, mutateProjectGraph } from "./mutate";

export function previewChangeSet(
  project: VdtProject,
  changeSet: VdtChangeSet,
  selection?: ReadonlySet<string>
): VdtProject {
  const source = cloneProject(project);
  const filtered = filterChangeSet(changeSet, selection);
  if (filtered.workspaceChange) {
    const result = applyWorkspaceChange(source, filtered.workspaceChange);
    return result.status === "ok" ? cloneProject(result.project) : source;
  }
  return mutateProjectGraph(source, filtered);
}
