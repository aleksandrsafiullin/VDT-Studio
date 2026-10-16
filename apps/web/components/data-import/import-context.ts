import type { VdtNode, VdtProject } from "@vdt-studio/vdt-core";

export interface FileImportTargetContext {
  projectId: string;
  vdtId: string;
  graphProjectId: string;
  targetNodeId: string;
  targetFingerprint: string;
}

interface ImportWorkspace {
  activeProjectId?: string | undefined;
  activeVdtId?: string | undefined;
}

// Moving a card does not change the KPI being reviewed.
function targetFingerprint(node: VdtNode): string {
  return JSON.stringify(Object.fromEntries(Object.entries(node).filter(([key]) => key !== "position" && key !== "updatedAt")));
}

export function captureFileImportTarget(
  project: VdtProject,
  workspace: ImportWorkspace,
  targetNodeId: string
): FileImportTargetContext | undefined {
  const node = project.graph.nodes.find((candidate) => candidate.id === targetNodeId);
  if (!workspace.activeProjectId || !workspace.activeVdtId || !project.id || !node) return undefined;
  return {
    projectId: workspace.activeProjectId,
    vdtId: workspace.activeVdtId,
    graphProjectId: project.id,
    targetNodeId,
    targetFingerprint: targetFingerprint(node)
  };
}

export function fileImportContextError(
  context: FileImportTargetContext,
  project: VdtProject,
  workspace: ImportWorkspace
): string | undefined {
  if (workspace.activeProjectId !== context.projectId || workspace.activeVdtId !== context.vdtId || project.id !== context.graphProjectId) {
    return "The active project or VDT changed. Reopen file import for the intended KPI.";
  }
  const target = project.graph.nodes.find((node) => node.id === context.targetNodeId);
  if (!target || targetFingerprint(target) !== context.targetFingerprint) {
    return "The target KPI changed or was removed. Analyze the file again for the current KPI.";
  }
  if (target.formula?.trim() || project.graph.edges.some((edge) => edge.sourceNodeId === target.id)) {
    return "The target KPI already has a formula or incoming KPIs. Choose an undecomposed KPI.";
  }
  return undefined;
}

export const FILE_IMPORT_REQUEST_EVENT = "vdt:incoming-kpis-from-file";

export function requestIncomingKpisFromFile(targetNodeId: string, source: "node_action" | "agent_composer_attachment" = "node_action") {
  window.dispatchEvent(new CustomEvent(FILE_IMPORT_REQUEST_EVENT, { detail: { targetNodeId, source } }));
}
