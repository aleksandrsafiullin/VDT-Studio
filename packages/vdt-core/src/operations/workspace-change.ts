import type { VdtProject } from "../types";
import type { OperationContext } from "./context";
import { applyScenarioOperation, type ScenarioCommand } from "./scenario";
import { applyVersionOperation, type VersionCommand } from "./version";

/** A single host-prepared scenario or version command, applied as a unit. */
export type VdtWorkspaceChange = {
  id: string;
  context: OperationContext;
} & (
  | { kind: "scenario"; command: ScenarioCommand }
  | { kind: "version"; command: VersionCommand }
);

export function applyWorkspaceChange(project: VdtProject, change: VdtWorkspaceChange) {
  return change.kind === "scenario"
    ? applyScenarioOperation(project, change.command, change.context)
    : applyVersionOperation(project, change.command, change.context);
}
