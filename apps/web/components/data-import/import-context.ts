import type { PublicAgentExecutionBindingSummary } from "@/lib/agent-client";
import { appleIsExpected, appleRecoveryMessage, type AppleFirstLaunchStatus } from "@/lib/apple-first-launch";
import type { ExecutionSettings } from "@/lib/execution-mode-catalog";
import { resolveExecutionSettings } from "@/lib/execution-mode-resolver";
import { taskExecutionAssertion } from "@/lib/task-execution-expectation";
import type { EditorHandoffAttempt } from "@/lib/editor-handoff-controller";
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

export function requestIncomingKpisFromFile(targetNodeId: string, source: "node_action" | "agent_composer_attachment" = "node_action", handoff?: EditorHandoffAttempt) {
  return !window.dispatchEvent(new CustomEvent(FILE_IMPORT_REQUEST_EVENT, { detail: { targetNodeId, source, ...(handoff ? { handoff } : {}) }, cancelable: true }));
}

interface AnalysisSelection {
  executionSettings: ExecutionSettings;
  appleNativePreview?: { binding: PublicAgentExecutionBindingSummary; settings: ExecutionSettings } | undefined;
  appleFirstLaunch?: AppleFirstLaunchStatus | undefined;
  runnerPairingToken?: string | undefined;
}

function fileImportAnalysisExecution(state: AnalysisSelection) {
  const { executionSettings, appleNativePreview, appleFirstLaunch, runnerPairingToken } = state;
  const apple = appleNativePreview?.settings === executionSettings ? appleNativePreview.binding : undefined;
  if (apple) {
    const admission = apple.admission;
    if (!apple.bindingId || !apple.appleIdentity?.locale || apple.backendId !== "apple_foundation_models"
      || admission?.mode !== "local" || admission.profileVersion !== 1 || admission.providerId !== apple.backendId
      || !admission.modelId || admission.modelId !== apple.modelId || admission.modelRevision === undefined) {
      throw new Error("Reconnect the Apple on-device model before analyzing the file.");
    }
    const { mode, profileVersion, providerId, modelId, modelRevision } = admission;
    return { providerId, providerConfig: { bindingId: apple.bindingId },
      expectedExecution: { mode, profileVersion, providerId, modelId, modelRevision } };
  }
  if (appleIsExpected(executionSettings.analyticalSourceChoice, appleFirstLaunch)) {
    throw new Error(appleRecoveryMessage(appleFirstLaunch));
  }
  const { providerId, providerConfig } = resolveExecutionSettings(executionSettings);
  if (providerId === "mock" || providerId === "apple_foundation_models") {
    throw new Error("Select an AI provider in Settings, or choose Analyze file locally.");
  }
  const config = providerId === "local_runner" && runnerPairingToken
    ? { ...providerConfig, pairingToken: runnerPairingToken } : providerConfig;
  return { providerId, providerConfig: config, ...taskExecutionAssertion(providerId, config) };
}

export function captureFileImportAnalysisExecution(state: AnalysisSelection) {
  const request = fileImportAnalysisExecution(state);
  const key = JSON.stringify(request);
  return {
    request,
    assertCurrent(current: AnalysisSelection) {
      if (current.executionSettings === state.executionSettings) {
        try { if (JSON.stringify(fileImportAnalysisExecution(current)) === key) return; } catch { /* Selection lost admission. */ }
      }
      throw new Error("The AI selection changed. Analyze the retained file again with the current selection.");
    }
  };
}
