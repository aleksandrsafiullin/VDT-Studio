import type { VdtProject } from "../types";
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
  return mutateProjectGraph(source, filtered);
}
