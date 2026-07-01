"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  applyChangeSet,
  calculateGraph,
  cloneProject,
  createVersionSnapshot,
  DEFAULT_CANVAS_LAYOUT,
  diffChangeSet,
  importProjectJson,
  layoutGraph,
  productionVolumeProject,
  restoreVersionSnapshot as restoreProjectVersionSnapshot,
  stableSnakeId,
  uniqueId,
  VdtBuilderSession,
  type VdtAiTaskType,
  type VdtChangeSet,
  type VdtNode,
  type VdtProject,
  type VdtScenario
} from "@vdt-studio/vdt-core";
import {
  type AiAdvisoryResult,
  type AiExplanationResult,
  type GenerateVdtInput,
  type OpenAiCompatibleProviderConfig,
  type RunAiTaskInputMap,
  type RunAiTaskResult
} from "@vdt-studio/ai-harness";
import { makeId } from "@/lib/id";
import {
  createAgentClient,
  type AgentAnswerPayload as RuntimeAgentAnswerPayload,
  type AgentChatMessage as RuntimeAgentChatMessage,
  type ManualProjectChange,
  type PublicAgentStatus as RuntimePublicAgentStatus,
  type RetryableAgentError as RuntimeRetryableAgentError,
  type VdtAgentEvent as RuntimeAgentEvent,
  type VdtAgentQuestion as RuntimeAgentQuestion,
  type VdtAgentRunSnapshot as RuntimeAgentRunSnapshot,
  type VdtAgentStartRequest
} from "@/lib/agent-client";
import { hasLocalAiUi, resolveVdtAppMode } from "@/lib/app-mode";
import { formatExecutionModeSummary } from "@/lib/format-execution-summary";
import {
  createAiExecutionClient,
  HOSTED_WEB_LOCAL_AI_MESSAGE,
  type AiExecutionProgressEvent,
  type AiExecutionProgressPhase,
  type CliAgentDetectionSnapshot,
  type VdtAgentEvent,
  type VdtAgentPhase,
  type VdtAgentRun,
  type VdtAgentSelectedSkill
} from "@/lib/ai-execution-client";
import {
  applyUiPreference,
  DEFAULT_UI,
  mergeUiPreferences,
  setPanelWidth as applyPanelWidth,
  type UiPreferences
} from "./ui-preferences";
import { collectExistingPositions } from "./layout-positions";
import { scrubPersistedProviderSecrets } from "./provider-persistence";
import {
  applyGatewayPreset,
  applyLocalRunnerPreset,
  DEFAULT_EXECUTION_SETTINGS,
  DEFAULT_PRESET_BY_PROTOCOL,
  GATEWAY_TO_PRESET,
  getCliCatalogEntry,
  persistedExecutionSettings,
  type ExecutionSettings,
  type GatewayPresetId,
  type CliAgentId,
  type ByokGateway,
  type ByokProtocol,
  type ExecutionMode,
  type MemoryModelMode,
  type CliModelSelection,
  type LocalRunnerPresetId
} from "@/lib/execution-mode-catalog";
import {
  migrateLegacyProviderToExecutionSettings,
  migratePersistedStateToV2,
  reconcilePersistedExecutionSettings,
  resolveExecutionSettings,
  syncLegacyProviderFromExecutionSettings,
  validateExecutionForGenerate
} from "@/lib/execution-mode-resolver";
import {
  clearByokFieldError,
  hasByokFieldErrors,
  validateByokSettings,
  type ByokFieldErrors
} from "@/lib/byok-validation";
import {
  createStoredProject,
  createStoredVdt,
  deleteStoredProject,
  deleteStoredVdt,
  fetchStoredProjectExplorerSummary,
  loadStoredVdt,
  saveStoredVdtRevision,
  updateStoredProject,
  updateStoredVdt,
  type StoredProjectSummary,
  type StoredVdtRecord,
  type StoredVdtStatus
} from "@/lib/vdt-storage-client";
import {
  mergeCliDetectionAgents,
  patchSelectedCliCommandAfterRescan,
  resolveCliCommandForAgent
} from "@/lib/cli-detection";
import inventoryLevelExample from "../../../../examples/inventory-level.json";
import maintenanceCostExample from "../../../../examples/maintenance-cost.json";
import oeeExample from "../../../../examples/oee.json";

export {
  BASE_LEFT_PANEL_WIDTH,
  BASE_RIGHT_PANEL_WIDTH,
  BASE_WORKSPACE_SECTION_MIN_HEIGHT,
  COLLAPSED_PANEL_WIDTH,
  DEFAULT_KPI_HORIZONTAL_GAP,
  DEFAULT_KPI_VERTICAL_GAP,
  DEFAULT_LEFT_PANEL_WIDTH,
  DEFAULT_RIGHT_PANEL_WIDTH,
  DEFAULT_UI,
  MAX_KPI_HORIZONTAL_GAP,
  MAX_KPI_VERTICAL_GAP,
  MIN_KPI_HORIZONTAL_GAP,
  MIN_KPI_VERTICAL_GAP,
  type UiPreferences
} from "./ui-preferences";

export type ProviderId = "mock" | "local_cli" | "openai_compatible" | "anthropic" | "azure_openai" | "gemini" | "local_runner";
export type ExampleProjectId = "production_volume" | "oee" | "inventory_level" | "maintenance_cost";
export type GenerateActivityPhase =
  | "preparing_request"
  | "starting_backend"
  | "waiting_provider"
  | "validating_schema"
  | "normalizing_graph"
  | "building_canvas"
  | "ready";

export type GenerateActivityStatus = "running" | "needs_user_input" | "ready" | "error" | "cancelled";
export type GenerateActivityDetailStatus = "pending" | "running" | "complete" | "error" | "cancelled";

export interface GenerateActivityDetail {
  id: string;
  label: string;
  status: GenerateActivityDetailStatus;
  updatedAt: string;
}

export interface GenerateActivityState {
  runId: string;
  status: GenerateActivityStatus;
  phase: GenerateActivityPhase;
  phaseStartedAt: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string | undefined;
  requestId?: string | undefined;
  providerId: ProviderId;
  providerLabel: string;
  backendId?: string | undefined;
  backendLabel?: string | undefined;
  schemaId?: string | undefined;
  outputBytes?: number | undefined;
  schemaValid?: boolean | undefined;
  repairAttempted?: boolean | undefined;
  repairSucceeded?: boolean | undefined;
  errorCode?: string | undefined;
  model?: string | undefined;
  appMode: ReturnType<typeof resolveVdtAppMode>;
  canCancel: boolean;
  cancelRequested: boolean;
  message?: string | undefined;
  summary?: string | undefined;
  agentRun?: VdtAgentRun | undefined;
  runtimeAgentRun?: RuntimeAgentRunSnapshot | undefined;
  selectedSkills?: VdtAgentSelectedSkill[] | undefined;
  agentEvents?: VdtAgentEvent[] | undefined;
  agentChatMessages?: RuntimeAgentChatMessage[] | undefined;
  publicStatus?: RuntimePublicAgentStatus | undefined;
  retryableError?: RuntimeRetryableAgentError | undefined;
  agentQuestions?: RuntimeAgentQuestion[] | undefined;
  questionsForUser?: string[] | undefined;
  finalReport?: string | undefined;
  timeoutMs?: number | undefined;
  details?: GenerateActivityDetail[] | undefined;
}

export interface AgentChatHistoryEntry {
  runId: string;
  title: string;
  status: GenerateActivityStatus;
  startedAt: string;
  updatedAt: string;
  messageCount: number;
  activity: GenerateActivityState;
}

export {
  LOCAL_RUNNER_PRESET_CATALOG as LOCAL_RUNNER_PRESETS
} from "@/lib/execution-mode-catalog";

export type {
  ExecutionMode,
  ByokProtocol,
  ByokGateway,
  GatewayPresetId,
  CliAgentId,
  MemoryModelMode,
  CliModelSelection,
  ExecutionSettings,
  LocalRunnerPresetId,
  LocalRunnerPresetCatalogEntry as LocalRunnerPreset
} from "@/lib/execution-mode-catalog";

export interface ProviderTestStatus {
  kind: "success" | "error" | "info";
  message: string;
}

interface ProviderConfigState extends Partial<OpenAiCompatibleProviderConfig> {
  openAiBaseUrl?: string | undefined;
  openAiModel?: string | undefined;
  anthropicBaseUrl?: string | undefined;
  anthropicModel?: string | undefined;
  geminiBaseUrl?: string | undefined;
  geminiModel?: string | undefined;
  endpoint?: string | undefined;
  deployment?: string | undefined;
  apiVersion?: string | undefined;
  anthropicVersion?: string | undefined;
  localRunnerPresetId?: LocalRunnerPresetId | undefined;
  runnerUrl?: string | undefined;
  runnerProviderId?: "local_http_stub" | "cli_stub" | undefined;
  localBaseUrl?: string | undefined;
  localModel?: string | undefined;
  localApiKey?: string | undefined;
  command?: string | undefined;
  argsText?: string | undefined;
  timeoutSec?: number | undefined;
}

export const EXAMPLE_PROJECT_OPTIONS: { id: ExampleProjectId; label: string }[] = [
  { id: "production_volume", label: "Production Volume" },
  { id: "oee", label: "OEE" },
  { id: "inventory_level", label: "Inventory Level" },
  { id: "maintenance_cost", label: "Maintenance Cost" }
];

const exampleProjectJsonById: Record<Exclude<ExampleProjectId, "production_volume">, unknown> = {
  oee: oeeExample,
  inventory_level: inventoryLevelExample,
  maintenance_cost: maintenanceCostExample
};

interface BriefState extends GenerateVdtInput {
  rootKpi: string;
}

export interface CreateWorkspaceVdtParams {
  name?: string;
  rootKpi?: string;
  unit?: string;
  timePeriod?: string;
}

export type WorkspacePanelMode = "project" | "vdt";

export interface RefreshWorkspaceOptions {
  scopedProjectId?: string | undefined;
}

export interface VdtWorkspaceState {
  activePanel: WorkspacePanelMode;
  projectSummaries: StoredProjectSummary[];
  activeProjectId?: string | undefined;
  activeVdtId?: string | undefined;
  isLoading: boolean;
  isMutating: boolean;
  error?: string | undefined;
  lastSavedAt?: string | undefined;
}

export type RunAiActionTaskType = Exclude<VdtAiTaskType, "orchestrator_first_response" | "agent_decision" | "agent_plan" | "generate_tree">;

export type RunAiActionInput<T extends RunAiActionTaskType = RunAiActionTaskType> = Omit<
  RunAiTaskInputMap[T],
  "project" | "maxTokens" | "signal"
>;

const ADVISORY_AI_TASKS = new Set<RunAiActionTaskType>([
  "review_model",
  "check_units",
  "identify_missing_drivers",
  "identify_duplicate_drivers"
]);

const EXPLANATION_AI_TASKS = new Set<RunAiActionTaskType>([
  "explain_node",
  "explain_scenario",
  "generate_executive_summary"
]);

const AGENTIC_AI_ACTION_SCHEMA_IDS: Partial<Record<RunAiActionTaskType, string>> = {
  deepen_node: "deepen-node-v1"
};

interface VdtStudioState {
  project: VdtProject;
  workspace: VdtWorkspaceState;
  selectedNodeId: string;
  selectedEdgeId?: string | undefined;
  selectedPanelTab: "properties" | "ai" | "warnings";
  activeScenarioId: string;
  brief: BriefState;
  providerId: ProviderId;
  providerConfig: ProviderConfigState;
  executionSettings: ExecutionSettings;
  cliDetectionAgents?: CliAgentDetectionSnapshot[] | undefined;
  cliDetectionError?: string | undefined;
  isRescanningClis: boolean;
  rescanningCliId?: CliAgentId | undefined;
  cliModelByAgent: Partial<Record<CliAgentId, CliModelSelection>>;
  cliDiscoveredModelsByAgent: Partial<Record<CliAgentId, string[]>>;
  cliTestStatusByAgent: Partial<Record<CliAgentId, ProviderTestStatus>>;
  isTestingCliByAgent: Partial<Record<CliAgentId, boolean>>;
  runnerPairingToken?: string | undefined;
  runnerPairingStatus?: ProviderTestStatus | undefined;
  isPairingRunner: boolean;
  isTestingProvider: boolean;
  providerTestStatus?: ProviderTestStatus | undefined;
  byokFieldErrors?: ByokFieldErrors | undefined;
  ui: UiPreferences;
  scenarioModalOpen: boolean;
  isGenerating: boolean;
  generateActivity?: GenerateActivityState | undefined;
  agentChatHistory: AgentChatHistoryEntry[];
  activeAgentRunId?: string | undefined;
  agentRun?: RuntimeAgentRunSnapshot | undefined;
  agentEvents: RuntimeAgentEvent[];
  agentConnectionStatus: "idle" | "connecting" | "connected" | "disconnected" | "error";
  agentPendingQuestions?: RuntimeAgentQuestion[] | undefined;
  agentError?: string | undefined;
  projectRevision: number;
  aiError?: string | undefined;
  pendingChangeSet?: VdtChangeSet | undefined;
  changeSetSelection: Set<string>;
  pendingAdvisoryResult?: AiAdvisoryResult | undefined;
  pendingAdvisoryTaskType?: RunAiActionTaskType | undefined;
  pendingExplanation?: AiExplanationResult | undefined;
  pendingExplanationTaskType?: RunAiActionTaskType | undefined;
  highlightedNodeIds: string[];
  isRunningAiAction: boolean;
  aiActionError?: string | undefined;
  setBriefField: <K extends keyof BriefState>(field: K, value: BriefState[K]) => void;
  setProviderId: (providerId: ProviderId) => void;
  setProviderConfigField: <K extends keyof ProviderConfigState>(
    field: K,
    value: ProviderConfigState[K]
  ) => void;
  setExecutionMode: (executionMode: ExecutionMode) => void;
  setExecutionSettingsField: <K extends keyof ExecutionSettings>(
    field: K,
    value: ExecutionSettings[K]
  ) => void;
  setSelectedCliAgentId: (agentId: CliAgentId) => void;
  setLocalRunnerPreset: (presetId: LocalRunnerPresetId) => void;
  setByokProtocol: (protocol: ByokProtocol) => void;
  setByokGateway: (gateway: ByokGateway) => void;
  setGatewayPreset: (presetId: GatewayPresetId) => void;
  setMemoryModelMode: (mode: MemoryModelMode, cliAgentId?: CliAgentId) => void;
  setCliModelSelection: (selection: CliModelSelection) => void;
  setCliModelForAgent: (agentId: CliAgentId, selection: CliModelSelection) => void;
  rescanClis: (agentId?: CliAgentId) => Promise<void>;
  testCli: (agentId: CliAgentId) => Promise<void>;
  pairRunner: (code: string) => Promise<void>;
  unpairRunner: () => Promise<void>;
  setProviderTestState: (isTestingProvider: boolean, providerTestStatus?: ProviderTestStatus) => void;
  setByokFieldErrors: (byokFieldErrors: ByokFieldErrors | undefined) => void;
  setUiPreference: <K extends keyof UiPreferences>(field: K, value: UiPreferences[K]) => void;
  setPanelWidth: (side: "left" | "right", width: number) => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  openScenarioModal: () => void;
  closeScenarioModal: () => void;
  setScenarioModalOpen: (open: boolean) => void;
  resetUiPreferences: () => void;
  autoDistributeLayout: () => void;
  refreshWorkspace: (options?: RefreshWorkspaceOptions) => Promise<void>;
  clearHomeWorkspaceContext: () => void;
  closeWorkspaceVdtEditor: () => void;
  setWorkspacePanel: (panel: WorkspacePanelMode) => void;
  createWorkspaceProject: (name?: string) => Promise<boolean>;
  renameWorkspaceProject: (projectId: string, name: string) => Promise<boolean>;
  updateWorkspaceProjectDetails: (
    projectId: string,
    input: {
      name: string;
      clientName?: string | undefined;
      siteName?: string | undefined;
      year?: string | undefined;
    }
  ) => Promise<boolean>;
  deleteWorkspaceProject: (projectId: string) => Promise<boolean>;
  createWorkspaceVdt: (input?: string | CreateWorkspaceVdtParams) => Promise<boolean>;
  selectWorkspaceProject: (projectId: string) => Promise<boolean>;
  selectWorkspaceVdt: (vdtId: string) => Promise<boolean>;
  renameWorkspaceVdt: (vdtId: string, name: string) => Promise<boolean>;
  setWorkspaceVdtStatus: (vdtId: string, status: StoredVdtStatus) => Promise<boolean>;
  deleteWorkspaceVdt: (vdtId: string) => Promise<boolean>;
  saveActiveWorkspaceVdt: () => Promise<boolean>;
  updateNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  startNewAgentChat: () => boolean;
  openAgentChat: (runId: string) => boolean;
  startAgentRun: (
    initialInstruction?: string,
    options?: {
      mode?: VdtAgentStartRequest["mode"];
      selectedNodeId?: string;
      includeCurrentProject?: boolean;
    }
  ) => Promise<boolean>;
  resumePersistedAgentRun: () => Promise<void>;
  connectAgentEvents: (runId: string) => void;
  sendAgentAnswers: (answers: Record<string, string | number | string[]> | RuntimeAgentAnswerPayload[]) => Promise<void>;
  sendAgentApproval: (approved: boolean, selectedChangeIds?: string[] | undefined) => Promise<void>;
  sendAgentInstruction: (text: string, selectedNodeId?: string) => Promise<boolean>;
  sendManualProjectChange: (change: ManualProjectChange) => Promise<void>;
  addManualIncomingKpi: (parentNodeId: string) => void;
  requestIncomingKpisWithAi: (nodeId: string) => Promise<boolean>;
  applyAgentGraphPatch: (snapshot: RuntimeAgentRunSnapshot) => void;
  cancelAgentRun: () => Promise<void>;
  generateWithAi: () => Promise<void>;
  cancelGenerate: () => void;
  loadExample: (exampleId?: ExampleProjectId) => void;
  selectNode: (nodeId: string) => void;
  updateNode: (nodeId: string, patch: Partial<VdtNode>) => void;
  updateNodeBaselineValue: (nodeId: string, value?: number) => void;
  acceptNode: (nodeId: string) => void;
  rejectNode: (nodeId: string) => void;
  deleteNode: (nodeId: string) => void;
  createScenario: () => void;
  setActiveScenarioId: (scenarioId: string) => void;
  setMainScenario: (scenarioId: string) => void;
  renameScenario: (scenarioId: string, name: string) => void;
  deleteScenario: (scenarioId: string) => void;
  cloneScenario: (scenarioId: string) => void;
  updateScenarioOverride: (scenarioId: string, nodeId: string, value?: number) => void;
  runAiAction: <T extends RunAiActionTaskType>(taskType: T, input: RunAiActionInput<T>) => Promise<void>;
  toggleChangeSelection: (changeId: string) => void;
  applyPendingChangeSet: () => void;
  discardPendingChangeSet: () => void;
  saveAdvisoryToProject: () => void;
  applyAdvisorySuggestedChanges: () => void;
  restoreVersionSnapshot: (versionId: string) => void;
  replaceProject: (project: VdtProject) => void;
}

function buildInitialProject() {
  return cloneProject(productionVolumeProject);
}

const EMPTY_WORKSPACE: VdtWorkspaceState = {
  activePanel: "project",
  projectSummaries: [],
  isLoading: false,
  isMutating: false
};

function upsertProjectSummary(
  summaries: StoredProjectSummary[],
  summary: StoredProjectSummary
): StoredProjectSummary[] {
  const next = summaries.filter((entry) => entry.project.id !== summary.project.id);
  return [summary, ...next].sort((left, right) => {
    const updatedDelta = Date.parse(right.project.updatedAt) - Date.parse(left.project.updatedAt);
    return Number.isFinite(updatedDelta) && updatedDelta !== 0
      ? updatedDelta
      : left.project.name.localeCompare(right.project.name);
  });
}

function removeProjectSummary(summaries: StoredProjectSummary[], projectId: string): StoredProjectSummary[] {
  return summaries.filter((summary) => summary.project.id !== projectId);
}

function replaceVdtInSummaries(
  summaries: StoredProjectSummary[],
  vdt: StoredVdtRecord
): StoredProjectSummary[] {
  return summaries.map((summary) => {
    if (summary.project.id !== vdt.projectId) return summary;
    return {
      ...summary,
      vdts: summary.vdts.map((entry) => (
        entry.vdt.id === vdt.id ? { ...entry, vdt } : entry
      ))
    };
  });
}

function removeVdtFromSummaries(
  summaries: StoredProjectSummary[],
  vdtId: string
): StoredProjectSummary[] {
  return summaries.map((summary) => {
    const vdts = summary.vdts.filter((entry) => entry.vdt.id !== vdtId);
    if (vdts.length === summary.vdts.length) return summary;
    return {
      ...summary,
      counts: {
        ...summary.counts,
        vdts: Math.max(0, summary.counts.vdts - 1)
      },
      vdts
    };
  });
}

function summaryForProject(summaries: StoredProjectSummary[], projectId: string): StoredProjectSummary | undefined {
  return summaries.find((summary) => summary.project.id === projectId);
}

function summaryContainingVdt(summaries: StoredProjectSummary[], vdtId: string): StoredProjectSummary | undefined {
  return summaries.find((summary) => summary.vdts.some((entry) => entry.vdt.id === vdtId));
}

export function hasActiveWorkspaceVdt(workspace: VdtWorkspaceState): boolean {
  return Boolean(
    workspace.activeVdtId &&
    workspace.projectSummaries.some((summary) => (
      summary.vdts.some((entry) => entry.vdt.id === workspace.activeVdtId)
    ))
  );
}

function rootNodeForProject(project: VdtProject): VdtNode | undefined {
  return project.graph.nodes.find((node) => node.id === project.rootNodeId);
}

function projectSnapshotForVdt(project: VdtProject, name: string): VdtProject {
  const updatedAt = nowIso();
  return {
    ...project,
    name,
    updatedAt
  };
}

function buildDraftVdtProject(input: {
  name: string;
  rootKpi?: string | undefined;
  unit?: string | undefined;
  timePeriod?: string | undefined;
  industry?: string | undefined;
}): VdtProject {
  const builder = new VdtBuilderSession({ now: nowIso });
  builder.createDraft({
    projectTitle: input.name,
    rootKpi: input.rootKpi ?? input.name,
    ...(input.unit ? { unit: input.unit } : {}),
    ...(input.timePeriod ? { timePeriod: input.timePeriod } : {}),
    ...(input.industry ? { industry: input.industry } : {})
  });
  return builder.getProject();
}

function buildExampleProject(exampleId: ExampleProjectId = "production_volume") {
  if (exampleId === "production_volume") {
    return buildInitialProject();
  }

  return importProjectJson(JSON.stringify(exampleProjectJsonById[exampleId]));
}

function timePeriodFromRootNode(rootNode: VdtNode | undefined): string {
  return (
    rootNode?.assumptions
      ?.find((assumption) => assumption.startsWith("Time period: "))
      ?.replace("Time period: ", "")
      .trim() || "monthly"
  );
}

function briefFromProject(project: VdtProject): BriefState {
  const rootNode = project.graph.nodes.find((node) => node.id === project.rootNodeId);
  return {
    rootKpi: rootNode?.name ?? project.name,
    industry: project.industry ?? "",
    businessContext: project.businessContext ?? "",
    unit: rootNode?.unit ?? "",
    timePeriod: timePeriodFromRootNode(rootNode),
    goal: project.description ?? "",
    levelOfDetail: "medium"
  };
}

function buildAgentWorkspaceContext(
  state: Pick<VdtStudioState, "project" | "brief">
): NonNullable<VdtAgentStartRequest["workspace"]> {
  const rootNode = state.project.graph.nodes.find((node) => node.id === state.project.rootNodeId);
  const projectName = state.project.name.trim() || rootNode?.name?.trim() || state.brief.rootKpi.trim() || "VDT Studio workspace";
  const industry = state.project.industry?.trim() || state.brief.industry?.trim();
  const description = state.project.description?.trim() || state.brief.goal?.trim();
  return {
    projectId: safeWorkspaceProjectId(state.project.id || state.project.rootNodeId || projectName),
    projectName,
    ...(industry ? { industry } : {}),
    ...(description ? { description } : {})
  };
}

function safeWorkspaceProjectId(source: string): string {
  const safe = source
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^[^A-Za-z0-9]+/, "")
    .slice(0, 128)
    .replace(/[_-]+$/, "");
  return safe || "workspace";
}

function nowIso() {
  return new Date().toISOString();
}

function collectChangeEntryIds(changeSet: VdtChangeSet): Set<string> {
  return new Set([
    ...changeSet.additions.map((entry) => entry.id),
    ...changeSet.updates.map((entry) => entry.id),
    ...changeSet.deletions.map((entry) => entry.id),
    ...changeSet.edgeChanges.map((entry) => entry.id)
  ]);
}

function computeHighlightedNodeIds(project: VdtProject, changeSet: VdtChangeSet): string[] {
  const diff = diffChangeSet(project, changeSet);
  return [...diff.addedNodeIds, ...diff.updatedNodeIds, ...diff.removedNodeIds];
}

function readAdvisorySuggestedChanges(result: AiAdvisoryResult): VdtChangeSet | undefined {
  if ("suggestedChanges" in result && result.suggestedChanges) {
    return result.suggestedChanges;
  }
  return undefined;
}

function mapAiWarningToProjectWarning(
  warning: { severity: "info" | "warning" | "error"; message: string; nodeId?: string | undefined; edgeId?: string | undefined },
  index: number
) {
  return {
    id: `ai_warning_${index}_${warning.message.slice(0, 24).replace(/\s+/g, "_")}`,
    severity: warning.severity,
    type: "weak_business_logic" as const,
    message: warning.message,
    ...(warning.nodeId !== undefined ? { nodeId: warning.nodeId } : {}),
    ...(warning.edgeId !== undefined ? { edgeId: warning.edgeId } : {})
  };
}

function mergeAdvisoryIntoReview(
  existing: VdtProject["aiReview"],
  result: AiAdvisoryResult
): NonNullable<VdtProject["aiReview"]> {
  const mergedAssumptions = [...new Set([...(existing?.assumptions ?? []), ...result.assumptions])];
  const mergedQuestions = [...new Set([...(existing?.questionsForUser ?? []), ...result.questionsForUser])];
  const mergedWarnings = [...(existing?.warnings ?? [])];
  for (const [index, warning] of result.warnings.entries()) {
    const mapped = mapAiWarningToProjectWarning(warning, index);
    if (!mergedWarnings.some((entry) => entry.message === mapped.message)) {
      mergedWarnings.push(mapped);
    }
  }
  return {
    assumptions: mergedAssumptions,
    questionsForUser: mergedQuestions,
    warnings: mergedWarnings
  };
}

function canvasLayoutOptions(ui: Pick<UiPreferences, "kpiHorizontalGap" | "kpiVerticalGap">) {
  return {
    ...DEFAULT_CANVAS_LAYOUT,
    horizontalGap: ui.kpiHorizontalGap,
    verticalGap: ui.kpiVerticalGap
  };
}

function layoutProjectGraph(project: VdtProject, ui: UiPreferences = DEFAULT_UI): VdtProject {
  const existingPositions = collectExistingPositions(project.graph.nodes);
  const layout = layoutGraph(project.graph, project.rootNodeId, {
    ...canvasLayoutOptions(ui),
    existingPositions
  });
  const updatedAt = nowIso();
  return {
    ...project,
    updatedAt,
    graph: {
      ...project.graph,
      nodes: project.graph.nodes.map((node) => ({
        ...node,
        position: layout.positions.get(node.id) ?? node.position ?? { x: 0, y: 0 },
        updatedAt
      }))
    }
  };
}

function clearPendingAiActionState() {
  return {
    pendingChangeSet: undefined,
    changeSetSelection: new Set<string>(),
    pendingAdvisoryResult: undefined,
    pendingAdvisoryTaskType: undefined,
    pendingExplanation: undefined,
    pendingExplanationTaskType: undefined,
    highlightedNodeIds: [] as string[],
    aiActionError: undefined
  };
}

let activeAgentEventUnsubscribe: (() => void) | undefined;

function generateRunId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : makeId("generate");
}

function describeBackendLabel(
  providerId: ProviderId,
  providerConfig: Record<string, unknown> | undefined,
  executionSettings: ExecutionSettings
) {
  const configuredBackendId = providerConfig?.backendId;
  const backendId = typeof configuredBackendId === "string" && configuredBackendId.trim()
    ? configuredBackendId.trim()
    : providerId;

  if (executionSettings.executionMode === "local_cli" && executionSettings.selectedCliAgentId) {
    return {
      backendId,
      backendLabel: getCliCatalogEntry(executionSettings.selectedCliAgentId).displayName
    };
  }

  return {
    backendId,
    backendLabel: backendId === "mock" ? "Runtime not configured" : backendId.replace(/_/g, " ")
  };
}

function activityTimeoutMs(
  providerConfig: Record<string, unknown> | undefined,
  backendId: string | undefined
): number | undefined {
  const timeoutMs = providerConfig?.timeoutMs;
  if (typeof timeoutMs === "number" && Number.isSafeInteger(timeoutMs) && timeoutMs > 0) {
    return backendId?.endsWith("_subscription") ? Math.max(timeoutMs, 120_000) : timeoutMs;
  }

  const timeoutSec = providerConfig?.timeoutSec;
  if (typeof timeoutSec === "number" && Number.isSafeInteger(timeoutSec) && timeoutSec > 0) {
    const value = timeoutSec * 1000;
    return backendId?.endsWith("_subscription") ? Math.max(value, 120_000) : value;
  }

  return backendId?.endsWith("_subscription") ? 120_000 : undefined;
}

function buildGenerateActivity(
  runId: string,
  executionSettings: ExecutionSettings,
  providerId: ProviderId,
  providerConfig: Record<string, unknown> | undefined
): GenerateActivityState {
  const summary = formatExecutionModeSummary(executionSettings);
  const backend = describeBackendLabel(providerId, providerConfig, executionSettings);
  const timestamp = nowIso();

  return {
    runId,
    status: "running",
    phase: "preparing_request",
    phaseStartedAt: timestamp,
    startedAt: timestamp,
    updatedAt: timestamp,
    providerId,
    providerLabel: summary.primary,
    backendId: backend.backendId,
    backendLabel: backend.backendLabel,
    model: summary.secondary,
    appMode: resolveVdtAppMode(),
    canCancel: true,
    cancelRequested: false,
    timeoutMs: activityTimeoutMs(providerConfig, backend.backendId)
  };
}

function buildAiActionActivity(
  runId: string,
  taskType: RunAiActionTaskType,
  executionSettings: ExecutionSettings,
  providerId: ProviderId,
  providerConfig: Record<string, unknown> | undefined
): GenerateActivityState {
  const activity = buildGenerateActivity(runId, executionSettings, providerId, providerConfig);
  return {
    ...activity,
    schemaId: AGENTIC_AI_ACTION_SCHEMA_IDS[taskType],
    canCancel: false,
    summary: `Running ${taskType.replaceAll("_", " ")}.`
  };
}

function mapGenerateActivityPhase(
  phase: AiExecutionProgressPhase,
  currentPhase: GenerateActivityPhase
): GenerateActivityPhase {
  switch (phase) {
    case "preparing_request":
      return "preparing_request";
    case "starting_backend":
      return "starting_backend";
    case "waiting_for_provider":
      return "waiting_provider";
    case "validating_schema":
      return "validating_schema";
    case "repairing_output":
      return "normalizing_graph";
    case "building_project":
      return "building_canvas";
    case "complete":
      return "ready";
    case "error":
    case "cancelled":
      return currentPhase;
    default: {
      const exhaustive: never = phase;
      return exhaustive;
    }
  }
}

function mapGenerateActivityStatus(event: AiExecutionProgressEvent): GenerateActivityStatus {
  if (event.agentRun?.status === "needs_user_input") return "needs_user_input";
  if (event.phase === "complete" || event.status === "succeeded") return "ready";
  if (event.phase === "cancelled" || event.status === "cancelled") return "cancelled";
  if (event.phase === "error" || event.status === "failed") return "error";
  return "running";
}

function mergeActivityDetails(
  current: GenerateActivityDetail[] | undefined,
  incoming: AiExecutionProgressEvent["details"] | undefined,
  updatedAt: string,
  status: GenerateActivityStatus
): GenerateActivityDetail[] | undefined {
  const byId = new Map<string, GenerateActivityDetail>();
  for (const detail of current ?? []) {
    byId.set(detail.id, detail);
  }

  for (const detail of incoming ?? []) {
    byId.set(detail.id, {
      ...byId.get(detail.id),
      id: detail.id,
      label: detail.label,
      status: detail.status,
      updatedAt
    });
  }

  if (byId.size === 0) return undefined;

  if (status === "error" || status === "cancelled") {
    const terminalStatus = status === "error" ? "error" : "cancelled";
    for (const [id, detail] of byId) {
      byId.set(id, {
        ...detail,
        status: detail.status === "running" ? terminalStatus : detail.status,
        updatedAt: detail.status === "running" ? updatedAt : detail.updatedAt
      });
    }
  }

  if (status === "ready") {
    for (const [id, detail] of byId) {
      byId.set(id, {
        ...detail,
        status: detail.status === "pending" || detail.status === "running" ? "complete" : detail.status,
        updatedAt
      });
    }
  }

  return [...byId.values()];
}

function mergeAgentEvents(
  current: VdtAgentEvent[] | undefined,
  incoming: VdtAgentEvent[] | undefined
): VdtAgentEvent[] | undefined {
  const byId = new Map<string, VdtAgentEvent>();
  for (const event of current ?? []) {
    byId.set(event.id, event);
  }
  for (const event of incoming ?? []) {
    byId.set(event.id, event);
  }
  if (byId.size === 0) return undefined;
  return [...byId.values()].sort((left, right) => {
    const leftTime = Date.parse(left.timestamp);
    const rightTime = Date.parse(right.timestamp);
    if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return 0;
    return leftTime - rightTime;
  });
}

function mergeAgentRun(activity: GenerateActivityState, incoming: VdtAgentRun | undefined): Partial<GenerateActivityState> {
  if (!incoming) return {};
  const agentEvents = mergeAgentEvents(activity.agentEvents ?? activity.agentRun?.events, incoming.events);
  const selectedSkills = incoming.selectedSkills.length > 0
    ? incoming.selectedSkills
    : activity.selectedSkills ?? activity.agentRun?.selectedSkills;
  const questionsForUser = incoming.questionsForUser ?? activity.questionsForUser ?? activity.agentRun?.questionsForUser;
  const finalReport = incoming.finalReport ?? activity.finalReport ?? activity.agentRun?.finalReport;
  return {
    agentRun: {
      ...incoming,
      events: agentEvents ?? incoming.events,
      selectedSkills: selectedSkills ?? incoming.selectedSkills,
      ...(questionsForUser ? { questionsForUser } : {}),
      ...(finalReport ? { finalReport } : {})
    },
    selectedSkills,
    agentEvents,
    questionsForUser,
    finalReport
  };
}

function legacyAgentRunFromRuntimeSnapshot(snapshot: RuntimeAgentRunSnapshot): VdtAgentRun {
  const input = snapshot.request.input;
  const request: VdtAgentRun["request"] = {
    rootKpi: input.rootKpi ?? input.prompt ?? snapshot.project?.name ?? "Value driver tree",
    ...(input.industry !== undefined ? { industry: input.industry } : {}),
    ...(input.businessContext !== undefined ? { businessContext: input.businessContext } : {}),
    ...(input.unit !== undefined ? { unit: input.unit } : {}),
    ...(input.timePeriod !== undefined ? { timePeriod: input.timePeriod } : {}),
    ...(input.goal !== undefined ? { goal: input.goal } : {}),
    ...(input.levelOfDetail !== undefined ? { levelOfDetail: input.levelOfDetail } : {})
  };
  const resultProjectId = snapshot.project?.id ?? snapshot.draftProject?.id;
  const selectedSkills = snapshot.selectedSkills ?? [];
  const events = snapshot.events ?? [];
  return {
    runId: snapshot.runId,
    status: snapshot.status === "queued" || snapshot.status === "waiting_approval" ? "running" : snapshot.status,
    phase: mapRuntimeAgentPhase(snapshot.phase),
    request,
    selectedSkills: selectedSkills.map((skill) => ({
      id: skill.id,
      path: skill.path,
      reason: skill.reason
    })),
    events: events.map((event) => ({
      id: event.id,
      timestamp: event.timestamp,
      type: mapRuntimeAgentEventType(event.type),
      title: event.title,
      message: event.message,
      ...(event.metadata !== undefined ? { metadata: event.metadata } : {})
    })),
    ...(snapshot.pendingQuestions ? { questionsForUser: snapshot.pendingQuestions.map((question) => question.question) } : {}),
    ...(snapshot.draftProject !== undefined ? { draftGraph: snapshot.draftProject } : {}),
    ...(resultProjectId !== undefined ? { resultProjectId } : {}),
    ...(snapshot.finalReport !== undefined ? { finalReport: snapshot.finalReport } : {}),
    ...(snapshot.error !== undefined ? { error: snapshot.error } : {})
  };
}

function mapRuntimeAgentPhase(phase: RuntimeAgentRunSnapshot["phase"]): VdtAgentPhase {
  switch (phase) {
    case "building_graph":
      return "generating_graph";
    case "previewing_mutation":
      return "previewing_mutation";
    case "applying_graph":
      return "applying_graph";
    case "repairing_graph":
      return "validating_graph";
    default:
      return phase;
  }
}

function mapRuntimeAgentEventType(type: RuntimeAgentEvent["type"]): VdtAgentEvent["type"] {
  switch (type) {
    case "run_started":
    case "user_answer_received":
    case "plan_proposed":
    case "tool_call_started":
    case "tool_call_completed":
    case "manual_change_observed":
    case "repair_started":
    case "run_completed":
      return type === "plan_proposed"
        ? "planning_decomposition"
        : type === "tool_call_started"
          ? "model_call_started"
          : type === "tool_call_completed"
            ? "model_call_completed"
            : "graph_patch";
    case "mutation_proposed":
    case "mutation_applied":
    case "mutation_rejected":
      return type;
    case "assistant_message":
      return "model_call_completed";
    default:
      return type;
  }
}

function shouldRefreshAgentSnapshot(event: RuntimeAgentEvent): boolean {
  return event.type === "assistant_message" ||
    event.type === "clarifying_questions" ||
    event.type === "plan_proposed" ||
    event.type === "mutation_proposed" ||
    event.type === "mutation_applied" ||
    event.type === "mutation_rejected" ||
    event.type === "graph_patch" ||
    event.type === "graph_validation" ||
    event.type === "final_report" ||
    event.type === "error" ||
    event.type === "run_completed";
}

function mapRuntimeStatus(snapshot: RuntimeAgentRunSnapshot): GenerateActivityStatus {
  if (snapshot.status === "needs_user_input") return "needs_user_input";
  if (snapshot.status === "succeeded") return "ready";
  if (snapshot.status === "failed") return "error";
  if (snapshot.status === "cancelled") return "cancelled";
  return "running";
}

function isActiveActivity(activity: GenerateActivityState | undefined): boolean {
  return activity?.status === "running" || activity?.status === "needs_user_input";
}

function isActiveRuntimeRun(snapshot: RuntimeAgentRunSnapshot | undefined): boolean {
  return snapshot?.status === "queued" || snapshot?.status === "running" ||
    snapshot?.status === "needs_user_input" || snapshot?.status === "waiting_approval";
}

const MAX_AGENT_CHAT_HISTORY = 20;

function truncateChatTitle(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 72) return normalized;
  return `${normalized.slice(0, 69).trimEnd()}...`;
}

function titleForAgentActivity(activity: GenerateActivityState): string {
  const snapshot = activity.runtimeAgentRun;
  const firstUserMessage = activity.agentChatMessages?.find((message) => message.role === "user" && message.text?.trim());
  return truncateChatTitle(
    firstUserMessage?.text ??
    snapshot?.visibleContext?.visibleTitle ??
    snapshot?.request.input.rootKpi ??
    activity.agentRun?.request.rootKpi ??
    "Agent chat"
  );
}

function historyEntryFromActivity(activity: GenerateActivityState): AgentChatHistoryEntry {
  const messageCount = activity.agentChatMessages?.length ??
    activity.runtimeAgentRun?.chatMessages?.length ??
    activity.agentRun?.events.length ??
    0;
  return {
    runId: activity.runId,
    title: titleForAgentActivity(activity),
    status: activity.status,
    startedAt: activity.startedAt,
    updatedAt: activity.updatedAt,
    messageCount,
    activity
  };
}

function upsertAgentChatHistory(
  history: AgentChatHistoryEntry[],
  activity: GenerateActivityState | undefined
): AgentChatHistoryEntry[] {
  if (!activity) return history;
  const next = historyEntryFromActivity(activity);
  return [next, ...history.filter((entry) => entry.runId !== next.runId)]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, MAX_AGENT_CHAT_HISTORY);
}

function resumableAgentRunId(state: Pick<VdtStudioState, "activeAgentRunId" | "agentRun" | "generateActivity">): string | undefined {
  return state.activeAgentRunId ?? state.agentRun?.runId ?? state.generateActivity?.runId;
}

function applyAgentSnapshot(
  set: (partial: Partial<VdtStudioState> | ((state: VdtStudioState) => Partial<VdtStudioState>)) => void,
  snapshot: RuntimeAgentRunSnapshot
) {
  set((state) => {
    if (state.activeAgentRunId && state.activeAgentRunId !== snapshot.runId) {
      return {};
    }
    const rawProject = snapshot.project ?? snapshot.draftProject;
    const project = rawProject ? ensureScenario(rawProject) : undefined;
    const preservedSelectedNodeId = project && state.selectedNodeId
      && project.graph.nodes.some((node) => node.id === state.selectedNodeId)
      ? state.selectedNodeId
      : undefined;
    const status = mapRuntimeStatus(snapshot);
    const now = nowIso();
    const requestProviderId = snapshot.request.providerId as ProviderId;
    const requestProviderConfig = snapshot.request.providerConfig as Record<string, unknown> | undefined;
    const activity = state.generateActivity?.runId === snapshot.runId
      ? state.generateActivity
      : buildGenerateActivity(
          snapshot.runId,
          state.executionSettings,
          requestProviderId,
          requestProviderConfig
        );
    const legacyRun = legacyAgentRunFromRuntimeSnapshot(snapshot);
    const nextActivity: GenerateActivityState = {
      ...activity,
      status,
      phase: status === "ready" ? "ready" : activity.phase,
      canCancel: status === "running" || status === "needs_user_input",
      agentRun: legacyRun,
      runtimeAgentRun: snapshot,
      selectedSkills: legacyRun.selectedSkills,
      agentEvents: legacyRun.events,
      agentChatMessages: snapshot.chatMessages,
      publicStatus: snapshot.publicStatus,
      retryableError: snapshot.retryableError,
      agentQuestions: snapshot.pendingQuestions,
      questionsForUser: snapshot.pendingQuestions?.map((question) => question.question),
      finalReport: snapshot.finalReport,
      summary: snapshot.finalReport ?? activity.summary,
      message: snapshot.error?.message ?? activity.message,
      completedAt: snapshot.completedAt ?? (status === "ready" || status === "error" || status === "cancelled" ? now : activity.completedAt),
      updatedAt: snapshot.updatedAt
    };
    return {
      ...(project
        ? {
            project,
            selectedNodeId: preservedSelectedNodeId ?? project.rootNodeId,
            activeScenarioId: resolveMainScenarioId(project),
            projectRevision: state.projectRevision + 1
          }
        : {}),
      activeAgentRunId: status === "ready" || status === "error" || status === "cancelled" ? undefined : snapshot.runId,
      agentRun: snapshot,
      agentEvents: snapshot.events,
      agentPendingQuestions: snapshot.pendingQuestions,
      agentError: snapshot.error?.message,
      isGenerating: status === "running" || status === "needs_user_input",
      generateActivity: nextActivity,
      agentChatHistory: upsertAgentChatHistory(state.agentChatHistory, nextActivity)
    };
  });
}

function applyGenerateProgressEvent(
  set: (partial: Partial<VdtStudioState> | ((state: VdtStudioState) => Partial<VdtStudioState>)) => void,
  runId: string,
  event: AiExecutionProgressEvent
) {
  set((state) => {
    const activity = state.generateActivity;
    if (activity?.runId !== runId) {
      return {};
    }
    if (activity.cancelRequested || activity.status === "cancelled") {
      return {};
    }

    const status = mapGenerateActivityStatus(event);
    const phase = mapGenerateActivityPhase(event.phase, activity.phase);
    const phaseStartedAt = phase === activity.phase ? activity.phaseStartedAt : event.updatedAt;
    const completedAt = status === "ready" || status === "error" || status === "cancelled"
      ? event.updatedAt
      : activity.completedAt;
    const agentPatch = mergeAgentRun(activity, event.agentRun);

    return {
      generateActivity: {
        ...activity,
        ...agentPatch,
        status,
        phase,
        phaseStartedAt,
        requestId: event.requestId,
        providerId: (event.providerId as ProviderId | undefined) ?? activity.providerId,
        backendId: event.backendId ?? activity.backendId,
        schemaId: event.schemaId ?? activity.schemaId,
        appMode: event.appMode,
        outputBytes: event.outputBytes ?? activity.outputBytes,
        schemaValid: event.schemaValid ?? activity.schemaValid,
        repairAttempted: event.repairAttempted ?? activity.repairAttempted,
        repairSucceeded: event.repairSucceeded ?? activity.repairSucceeded,
        errorCode: event.error?.code ?? activity.errorCode,
        canCancel: (status === "running" || status === "needs_user_input") && !activity.cancelRequested,
        message: event.error?.message ?? activity.message,
        details: mergeActivityDetails(activity.details, event.details, event.updatedAt, status),
        completedAt,
        updatedAt: event.updatedAt
      }
    };
  });
}

async function runAiTask<T extends RunAiActionTaskType>(
  taskType: T,
  input: RunAiActionInput<T>,
  state: Pick<VdtStudioState, "executionSettings" | "cliDetectionAgents" | "project" | "runnerPairingToken">,
  options?: { onProgress?: (event: AiExecutionProgressEvent) => void }
): Promise<RunAiTaskResult> {
  if (state.executionSettings.executionMode === "local_cli" && !hasLocalAiUi(resolveVdtAppMode())) {
    throw new Error(HOSTED_WEB_LOCAL_AI_MESSAGE);
  }

  if (state.executionSettings.executionMode === "byok") {
    const validationErrors = validateByokSettings(state.executionSettings);
    if (hasByokFieldErrors(validationErrors)) {
      throw new Error("Fix BYOK settings before running this AI action.");
    }
  }

  const executionError = validateExecutionForGenerate(state.executionSettings, state.cliDetectionAgents);
  if (executionError) {
    throw new Error(executionError);
  }

  const { providerId, providerConfig } = resolveExecutionSettings(state.executionSettings);
  const needsPairing = requiresStandaloneRunnerPairing();
  if (providerId === "local_runner" && needsPairing && !state.runnerPairingToken) {
    throw new Error("Pair the local runner before running this AI action.");
  }

  return createAiExecutionClient().complete(
    {
      taskType,
      input: {
        project: state.project,
        ...input
      },
      providerId,
      providerConfig:
        providerId === "mock"
          ? undefined
          : providerId === "local_runner" && needsPairing
            ? { ...providerConfig, pairingToken: state.runnerPairingToken }
            : providerConfig
    },
    options?.onProgress ? { onProgress: options.onProgress } : undefined
  );
}

export function isAdvisoryAiTaskType(taskType: RunAiActionTaskType): boolean {
  return ADVISORY_AI_TASKS.has(taskType);
}

export function isExplanationAiTaskType(taskType: RunAiActionTaskType): boolean {
  return EXPLANATION_AI_TASKS.has(taskType);
}

export async function runAdvisoryOrExplainAiTask<T extends RunAiActionTaskType>(
  taskType: T,
  input: RunAiActionInput<T>
): Promise<void> {
  if (!isAdvisoryAiTaskType(taskType) && !isExplanationAiTaskType(taskType)) {
    throw new Error(`${taskType} is not an advisory or explanation task.`);
  }

  await useVdtStudioStore.getState().runAiAction(taskType, input);
}

function updateProjectNode(project: VdtProject, nodeId: string, update: (node: VdtNode) => VdtNode): VdtProject {
  const updatedAt = nowIso();
  return {
    ...project,
    updatedAt,
    graph: {
      ...project.graph,
      nodes: project.graph.nodes.map((node) => (node.id === nodeId ? update(node) : node))
    }
  };
}

function nextManualIncomingKpiName(project: VdtProject, parentNodeId: string): string {
  const childCount = project.graph.edges.filter((edge) => edge.sourceNodeId === parentNodeId).length;
  const baseName = "New incoming KPI";
  const candidate = childCount === 0 ? baseName : `${baseName} ${childCount + 1}`;
  const names = new Set(project.graph.nodes.map((node) => node.name));
  if (!names.has(candidate)) return candidate;

  let suffix = childCount + 2;
  while (names.has(`${baseName} ${suffix}`)) {
    suffix += 1;
  }
  return `${baseName} ${suffix}`;
}

function addManualIncomingKpiToProject(
  project: VdtProject,
  parentNodeId: string
): { project: VdtProject; newNodeId: string } | undefined {
  const parent = project.graph.nodes.find((node) => node.id === parentNodeId);
  if (!parent) return undefined;

  const timestamp = nowIso();
  const name = nextManualIncomingKpiName(project, parentNodeId);
  const existingNodeIds = new Set(project.graph.nodes.map((node) => node.id));
  const newNodeId = uniqueId(stableSnakeId(`${parent.name} ${name}`, "incoming_kpi"), existingNodeIds);
  const existingEdgeIds = new Set(project.graph.edges.map((edge) => edge.id));
  const edgeId = uniqueId(`edge_${parentNodeId}_${newNodeId}`, existingEdgeIds);
  const siblingCount = project.graph.edges.filter((edge) => edge.sourceNodeId === parentNodeId).length;
  const parentPosition = parent.position ?? { x: 0, y: 0 };
  const newPosition = {
    x: parentPosition.x + DEFAULT_CANVAS_LAYOUT.horizontalGap,
    y: parentPosition.y + siblingCount * Math.max(DEFAULT_CANVAS_LAYOUT.verticalGap, 96)
  };
  const parentHasFormula = Boolean(parent.formula?.trim());
  const shouldPromoteParent = parent.type !== "root_kpi" && parent.type !== "calculated";

  return {
    newNodeId,
    project: {
      ...project,
      updatedAt: timestamp,
      graph: {
        nodes: [
          ...project.graph.nodes.map((node) => {
            if (node.id !== parentNodeId) return node;
            return {
              ...node,
              ...(parentHasFormula ? {} : { formula: newNodeId }),
              ...(shouldPromoteParent ? { type: "calculated" as const } : {}),
              status: "edited" as const,
              updatedAt: timestamp
            };
          }),
          {
            id: newNodeId,
            name,
            description: `Manual incoming KPI for ${parent.name}.`,
            type: "input",
            status: "edited",
            unit: parent.unit,
            aiGenerated: false,
            position: newPosition,
            createdAt: timestamp,
            updatedAt: timestamp
          }
        ],
        edges: [
          ...project.graph.edges,
          {
            id: edgeId,
            sourceNodeId: parentNodeId,
            targetNodeId: newNodeId,
            relation: "formula_dependency",
            label: "manual input",
            aiGenerated: false
          }
        ]
      }
    }
  };
}

function buildIncomingKpisAgentInstruction(node: VdtNode): string {
  return [
    `Add incoming KPI drivers for "${node.name}".`,
    `Target node id: ${node.id}.`,
    "Use the current VDT graph context, the selected target node, and the active/selected skill context from this agent dialogue.",
    "This button click is explicit user intent to decompose this branch layer by layer until it reaches logical leaf incoming KPIs/input drivers; do not ask for approval only because the branch is deep.",
    "Decompose this KPI into the logical component KPIs/input drivers that should feed it, add those drivers to the current VDT, and set or update the formula for the target KPI so it references the new components.",
    "Preserve the existing graph context, units, and mining/business meaning. Ask only if a required data definition is genuinely missing."
  ].join("\n");
}

function defaultScenario(options?: { isMain?: boolean }): VdtScenario {
  const createdAt = nowIso();
  return {
    id: makeId("scenario"),
    name: "New scenario",
    description: "Adjust input drivers and compare impact against baseline.",
    overrides: [],
    ...(options?.isMain ? { isMain: true } : {}),
    createdAt,
    updatedAt: createdAt
  };
}

function uniqueScenarioCopyName(baseName: string, scenarios: VdtScenario[]): string {
  const root = `${baseName} copy`;
  if (!scenarios.some((scenario) => scenario.name === root)) {
    return root;
  }

  let suffix = 2;
  while (scenarios.some((scenario) => scenario.name === `${root} (${suffix})`)) {
    suffix += 1;
  }

  return `${root} (${suffix})`;
}

function ensureMainScenario(project: VdtProject): VdtProject {
  if (project.scenarios.length === 0) {
    return project;
  }

  const mainScenarios = project.scenarios.filter((scenario) => scenario.isMain === true);
  if (mainScenarios.length === 1) {
    return project;
  }

  const mainId = mainScenarios[0]?.id ?? project.scenarios[0]!.id;

  return {
    ...project,
    scenarios: project.scenarios.map((scenario) => ({
      ...scenario,
      isMain: scenario.id === mainId
    }))
  };
}

function ensureScenario(project: VdtProject) {
  if (project.scenarios.length > 0) {
    return ensureMainScenario(project);
  }

  return {
    ...project,
    scenarios: [defaultScenario({ isMain: true })]
  };
}

function resolveMainScenarioId(project: VdtProject): string {
  return project.scenarios.find((scenario) => scenario.isMain === true)?.id ?? project.scenarios[0]?.id ?? "";
}

function requiresStandaloneRunnerPairing(): boolean {
  // Development web now uses the managed Next.js local runtime route, matching
  // the desktop sidecar shape. Pairing is retained only for the legacy
  // standalone HTTP runner surface, not for the main Local AI flow.
  return false;
}

function persistedProviderConfig(config: ProviderConfigState) {
  const nextConfig: ProviderConfigState = {};
  if (config.localRunnerPresetId !== undefined) {
    nextConfig.localRunnerPresetId = config.localRunnerPresetId;
  }
  if (config.baseUrl !== undefined) {
    nextConfig.baseUrl = config.baseUrl;
  }
  if (config.model !== undefined) {
    nextConfig.model = config.model;
  }
  for (const field of ["openAiBaseUrl", "openAiModel", "anthropicBaseUrl", "anthropicModel", "geminiBaseUrl", "geminiModel"] as const) {
    if (config[field] !== undefined) nextConfig[field] = config[field];
  }
  if (config.endpoint !== undefined) {
    nextConfig.endpoint = config.endpoint;
  }
  if (config.deployment !== undefined) {
    nextConfig.deployment = config.deployment;
  }
  if (config.apiVersion !== undefined) {
    nextConfig.apiVersion = config.apiVersion;
  }
  if (config.anthropicVersion !== undefined) {
    nextConfig.anthropicVersion = config.anthropicVersion;
  }
  if (config.runnerUrl !== undefined) {
    nextConfig.runnerUrl = config.runnerUrl;
  }
  if (config.runnerProviderId !== undefined) {
    nextConfig.runnerProviderId = config.runnerProviderId;
  }
  if (config.localBaseUrl !== undefined) {
    nextConfig.localBaseUrl = config.localBaseUrl;
  }
  if (config.localModel !== undefined) {
    nextConfig.localModel = config.localModel;
  }
  if (config.command !== undefined) {
    nextConfig.command = config.command;
  }
  if (config.argsText !== undefined) {
    nextConfig.argsText = config.argsText;
  }
  if (config.timeoutSec !== undefined) {
    nextConfig.timeoutSec = config.timeoutSec;
  }
  return nextConfig;
}

function withSyncedLegacyProvider(
  executionSettings: ExecutionSettings,
  existingConfig: ProviderConfigState
): Pick<VdtStudioState, "executionSettings" | "providerId" | "providerConfig" | "providerTestStatus"> {
  const synced = syncLegacyProviderFromExecutionSettings(executionSettings, existingConfig);
  return {
    executionSettings,
    providerId: synced.providerId,
    providerConfig: synced.providerConfig as ProviderConfigState,
    providerTestStatus: undefined
  };
}

export const useVdtStudioStore = create<VdtStudioState>()(
  persist(
    (set, get) => ({
      project: buildInitialProject(),
      workspace: { ...EMPTY_WORKSPACE },
      selectedNodeId: productionVolumeProject.rootNodeId,
      activeScenarioId: productionVolumeProject.scenarios[0]?.id ?? "",
      selectedPanelTab: "properties",
      brief: {
        rootKpi: "Production Volume",
        industry: "Mining / Processing Plant",
        businessContext: "Operational performance analysis",
        unit: "tonnes/month",
        timePeriod: "monthly",
        goal: "Understand what drives production decrease",
        levelOfDetail: "medium"
      },
      providerId: "openai_compatible",
      providerConfig: {
        openAiBaseUrl: "https://api.openai.com/v1",
        openAiModel: "gpt-5.5",
        anthropicBaseUrl: "https://api.anthropic.com",
        anthropicModel: "claude-sonnet-4-6",
        geminiBaseUrl: "https://generativelanguage.googleapis.com",
        geminiModel: "gemini-2.5-pro",
        localRunnerPresetId: "ollama_openai",
        runnerUrl: "http://127.0.0.1:8765",
        runnerProviderId: "local_http_stub",
        localBaseUrl: "http://127.0.0.1:11434/v1",
        localModel: "qwen3",
        timeoutSec: 60
      },
      executionSettings: { ...DEFAULT_EXECUTION_SETTINGS },
      cliDetectionAgents: undefined,
      cliDetectionError: undefined,
      isRescanningClis: false,
      rescanningCliId: undefined,
      cliModelByAgent: {},
      cliDiscoveredModelsByAgent: {},
      cliTestStatusByAgent: {},
      isTestingCliByAgent: {},
      runnerPairingToken: undefined,
      runnerPairingStatus: undefined,
      isPairingRunner: false,
      isTestingProvider: false,
      byokFieldErrors: undefined,
      ui: { ...DEFAULT_UI },
      scenarioModalOpen: false,
      isGenerating: false,
      generateActivity: undefined,
      agentChatHistory: [],
      activeAgentRunId: undefined,
      agentRun: undefined,
      agentEvents: [],
      agentConnectionStatus: "idle",
      agentPendingQuestions: undefined,
      agentError: undefined,
      projectRevision: 0,
      changeSetSelection: new Set<string>(),
      highlightedNodeIds: [],
      isRunningAiAction: false,
      setUiPreference: (field, value) =>
        set((state) => {
          const nextUi = applyUiPreference(state.ui, field, value);
          const shouldRelayout = field === "kpiHorizontalGap" || field === "kpiVerticalGap";
          return {
            ui: nextUi,
            ...(shouldRelayout ? { project: layoutProjectGraph(state.project, nextUi) } : {})
          };
        }),
      setPanelWidth: (side, width) =>
        set((state) => ({
          ui: applyPanelWidth(state.ui, side, width)
        })),
      toggleLeftPanel: () =>
        set((state) => ({
          ui: { ...state.ui, leftPanelCollapsed: !state.ui.leftPanelCollapsed }
        })),
      toggleRightPanel: () =>
        set((state) => ({
          ui: { ...state.ui, rightPanelCollapsed: !state.ui.rightPanelCollapsed }
        })),
      openScenarioModal: () => set({ scenarioModalOpen: true }),
      closeScenarioModal: () => set({ scenarioModalOpen: false }),
      setScenarioModalOpen: (open) => set({ scenarioModalOpen: open }),
      resetUiPreferences: () =>
        set((state) => ({
          ui: { ...DEFAULT_UI },
          scenarioModalOpen: false,
          project: layoutProjectGraph(state.project, DEFAULT_UI)
        })),
      autoDistributeLayout: () =>
        set((state) => ({
          project: layoutProjectGraph(state.project, state.ui)
        })),
      refreshWorkspace: async (options) => {
        const scopedProjectId = options?.scopedProjectId;
        set((state) => ({
          workspace: {
            ...state.workspace,
            isLoading: true,
            error: undefined
          }
        }));
        try {
          const summary = await fetchStoredProjectExplorerSummary();
          set((state) => {
            const projectSummaries = summary.projects;
            let activeProjectId: string | undefined;
            let activeVdtId: string | undefined;
            let activePanel: WorkspacePanelMode = "project";

            if (scopedProjectId) {
              activeProjectId = projectSummaries.some((entry) => entry.project.id === scopedProjectId)
                ? scopedProjectId
                : undefined;
              const activeVdtSummary = state.workspace.activeVdtId
                ? projectSummaries.find((entry) => entry.vdts.some((vdtEntry) => vdtEntry.vdt.id === state.workspace.activeVdtId))
                : undefined;
              activeVdtId =
                activeProjectId &&
                activeVdtSummary &&
                activeVdtSummary.project.id === activeProjectId &&
                state.workspace.activeVdtId
                  ? state.workspace.activeVdtId
                  : undefined;
              activePanel =
                activeVdtId && state.workspace.activePanel === "vdt" && hasActiveWorkspaceVdt({
                  ...state.workspace,
                  projectSummaries,
                  activeProjectId,
                  activeVdtId
                })
                  ? "vdt"
                  : "project";
            } else {
              const activeProjectExists = state.workspace.activeProjectId
                ? projectSummaries.some((entry) => entry.project.id === state.workspace.activeProjectId)
                : false;
              const activeVdtSummary = state.workspace.activeVdtId
                ? projectSummaries.find((entry) => entry.vdts.some((vdtEntry) => vdtEntry.vdt.id === state.workspace.activeVdtId))
                : undefined;
              activeProjectId = activeProjectExists
                ? state.workspace.activeProjectId
                : activeVdtSummary?.project.id;
              activeVdtId =
                activeVdtSummary && activeProjectId && activeVdtSummary.project.id === activeProjectId
                  ? state.workspace.activeVdtId
                  : undefined;
              activePanel =
                activeVdtId && state.workspace.activePanel === "vdt" && hasActiveWorkspaceVdt({
                  ...state.workspace,
                  projectSummaries,
                  activeProjectId,
                  activeVdtId
                })
                  ? "vdt"
                  : "project";
            }

            return {
              workspace: {
                ...state.workspace,
                projectSummaries,
                activePanel,
                activeProjectId,
                activeVdtId,
                isLoading: false,
                error: undefined
              }
            };
          });
        } catch (error) {
          set((state) => ({
            workspace: {
              ...state.workspace,
              isLoading: false,
              error: error instanceof Error ? error.message : "Workspace could not be loaded."
            }
          }));
        }
      },
      clearHomeWorkspaceContext: () =>
        set((state) => ({
          workspace: {
            ...state.workspace,
            activeProjectId: undefined,
            activeVdtId: undefined,
            activePanel: "project",
            error: undefined
          }
        })),
      closeWorkspaceVdtEditor: () =>
        set((state) => ({
          workspace: {
            ...state.workspace,
            activeVdtId: undefined,
            activePanel: "project",
            error: undefined
          }
        })),
      setWorkspacePanel: (panel) =>
        set((state) => ({
          workspace: {
            ...state.workspace,
            activePanel: panel === "vdt" && !hasActiveWorkspaceVdt(state.workspace) ? "project" : panel,
            error: panel === "vdt" && !hasActiveWorkspaceVdt(state.workspace)
              ? "Create or open a saved VDT before switching to VDT management."
              : state.workspace.error
          }
        })),
      createWorkspaceProject: async (name) => {
        const projectName = name?.trim() || "New project";
        const state = get();
        set((current) => ({
          workspace: {
            ...current.workspace,
            isMutating: true,
            error: undefined
          }
        }));
        try {
          await get().saveActiveWorkspaceVdt();
          const summary = await createStoredProject({
            name: projectName,
            industry: state.project.industry ?? state.brief.industry
          });
          set((current) => ({
            workspace: {
              ...current.workspace,
              projectSummaries: upsertProjectSummary(current.workspace.projectSummaries, summary),
              activePanel: "project",
              activeProjectId: summary.project.id,
              activeVdtId: undefined,
              isMutating: false,
              error: undefined,
              lastSavedAt: nowIso()
            }
          }));
          return true;
        } catch (error) {
          set((current) => ({
            workspace: {
              ...current.workspace,
              isMutating: false,
              error: error instanceof Error ? error.message : "Project could not be created."
            }
          }));
          return false;
        }
      },
      renameWorkspaceProject: async (projectId, name) => {
        const trimmed = name.trim();
        if (!trimmed) return false;
        set((state) => ({
          workspace: { ...state.workspace, isMutating: true, error: undefined }
        }));
        try {
          const summary = await updateStoredProject(projectId, { name: trimmed });
          set((state) => ({
            workspace: {
              ...state.workspace,
              projectSummaries: upsertProjectSummary(state.workspace.projectSummaries, summary),
              isMutating: false,
              error: undefined
            }
          }));
          return true;
        } catch (error) {
          set((state) => ({
            workspace: {
              ...state.workspace,
              isMutating: false,
              error: error instanceof Error ? error.message : "Project could not be renamed."
            }
          }));
          return false;
        }
      },
      updateWorkspaceProjectDetails: async (projectId, input) => {
        const trimmedName = input.name.trim();
        if (!trimmedName) return false;

        const currentProject = summaryForProject(get().workspace.projectSummaries, projectId)?.project;
        const metadata = { ...(currentProject?.metadata ?? {}) };
        const clientName = input.clientName?.trim();
        const siteName = input.siteName?.trim();
        const year = input.year?.trim();

        if (clientName) metadata.clientName = clientName;
        else delete metadata.clientName;
        if (siteName) metadata.siteName = siteName;
        else delete metadata.siteName;
        if (year) metadata.year = year;
        else delete metadata.year;

        set((state) => ({
          workspace: { ...state.workspace, isMutating: true, error: undefined }
        }));
        try {
          const summary = await updateStoredProject(projectId, {
            name: trimmedName,
            metadata
          });
          set((state) => ({
            workspace: {
              ...state.workspace,
              projectSummaries: upsertProjectSummary(state.workspace.projectSummaries, summary),
              activePanel: "project",
              activeProjectId: summary.project.id,
              isMutating: false,
              error: undefined
            }
          }));
          return true;
        } catch (error) {
          set((state) => ({
            workspace: {
              ...state.workspace,
              isMutating: false,
              error: error instanceof Error ? error.message : "Project details could not be saved."
            }
          }));
          return false;
        }
      },
      deleteWorkspaceProject: async (projectId) => {
        set((state) => ({
          workspace: { ...state.workspace, isMutating: true, error: undefined }
        }));
        try {
          await deleteStoredProject(projectId);
          set((state) => ({
            workspace: {
              ...state.workspace,
              projectSummaries: removeProjectSummary(state.workspace.projectSummaries, projectId),
              activePanel: "project",
              activeProjectId: state.workspace.activeProjectId === projectId ? undefined : state.workspace.activeProjectId,
              activeVdtId: state.workspace.activeProjectId === projectId ? undefined : state.workspace.activeVdtId,
              isMutating: false,
              error: undefined
            }
          }));
          return true;
        } catch (error) {
          set((state) => ({
            workspace: {
              ...state.workspace,
              isMutating: false,
              error: error instanceof Error ? error.message : "Project could not be deleted."
            }
          }));
          return false;
        }
      },
      createWorkspaceVdt: async (input) => {
        const state = get();
        const activeProjectId = state.workspace.activeProjectId;
        if (!activeProjectId) {
          set((current) => ({
            workspace: {
              ...current.workspace,
              error: "Create or select a project before adding a VDT."
            }
          }));
          return false;
        }
        const params: CreateWorkspaceVdtParams =
          typeof input === "string" ? { name: input } : input ?? {};
        const rootKpi = params.rootKpi?.trim() || params.name?.trim() || "";
        const vdtName = params.name?.trim() || params.rootKpi?.trim() || "New VDT";
        set((current) => ({
          workspace: {
            ...current.workspace,
            isMutating: true,
            error: undefined
          }
        }));
        try {
          await get().saveActiveWorkspaceVdt();
          const current = get();
          const activeSummary = summaryForProject(current.workspace.projectSummaries, activeProjectId);
          const hasExplicitBrief = Boolean(params.rootKpi?.trim());
          const snapshot =
            hasActiveWorkspaceVdt(current.workspace) && !hasExplicitBrief
              ? projectSnapshotForVdt(current.project, vdtName)
              : buildDraftVdtProject({
                  name: vdtName,
                  rootKpi: rootKpi || vdtName,
                  ...(params.unit ? { unit: params.unit } : {}),
                  ...(params.timePeriod ? { timePeriod: params.timePeriod } : {}),
                  ...(activeSummary?.project.industry ? { industry: activeSummary.project.industry } : {})
                });
          const rootNode = rootNodeForProject(snapshot);
          const created = await createStoredVdt(activeProjectId, {
            name: vdtName,
            rootKpi: rootNode?.name ?? vdtName,
            unit: rootNode?.unit,
            timePeriod: rootNode?.assumptions?.find((assumption) => assumption.startsWith("Time period: "))?.replace("Time period: ", ""),
            project: snapshot
          });
          set((current) => ({
            project: snapshot,
            selectedNodeId: snapshot.rootNodeId,
            activeScenarioId: resolveMainScenarioId(snapshot),
            brief: briefFromProject(snapshot),
            generateActivity: undefined,
            activeAgentRunId: undefined,
            agentRun: undefined,
            agentEvents: [],
            agentPendingQuestions: undefined,
            agentError: undefined,
            isGenerating: false,
            workspace: {
              ...current.workspace,
              projectSummaries: upsertProjectSummary(current.workspace.projectSummaries, created.summary),
              activeProjectId,
              activeVdtId: created.vdt.id,
              activePanel: "vdt",
              isMutating: false,
              error: undefined,
              lastSavedAt: nowIso()
            },
            ...clearPendingAiActionState()
          }));
          return true;
        } catch (error) {
          set((current) => ({
            workspace: {
              ...current.workspace,
              isMutating: false,
              error: error instanceof Error ? error.message : "VDT could not be created."
            }
          }));
          return false;
        }
      },
      selectWorkspaceProject: async (projectId) => {
        await get().saveActiveWorkspaceVdt();
        const summary = summaryForProject(get().workspace.projectSummaries, projectId);
        if (!summary) {
          set((state) => ({
            workspace: {
              ...state.workspace,
              error: "Project not found."
            }
          }));
          return false;
        }
        set((state) => ({
          workspace: {
            ...state.workspace,
            activePanel: "project",
            activeProjectId: projectId,
            activeVdtId: summary.vdts.some((entry) => entry.vdt.id === state.workspace.activeVdtId)
              ? state.workspace.activeVdtId
              : undefined,
            error: undefined
          }
        }));
        return true;
      },
      selectWorkspaceVdt: async (vdtId) => {
        if (get().workspace.activeVdtId === vdtId) {
          set((state) => ({
            workspace: {
              ...state.workspace,
              activePanel: "vdt",
              error: undefined
            }
          }));
          return true;
        }
        set((state) => ({
          workspace: {
            ...state.workspace,
            activePanel: "vdt",
            isLoading: true,
            error: undefined
          }
        }));
        try {
          await get().saveActiveWorkspaceVdt();
          const loaded = await loadStoredVdt(vdtId);
          if (!loaded.activeProject) {
            throw new Error("Selected VDT does not have a saved revision yet.");
          }
          const project = ensureScenario(loaded.activeProject);
          set((state) => ({
            project,
            selectedNodeId: project.rootNodeId,
            activeScenarioId: resolveMainScenarioId(project),
            brief: briefFromProject(project),
            generateActivity: undefined,
            activeAgentRunId: undefined,
            agentRun: undefined,
            agentEvents: [],
            agentPendingQuestions: undefined,
            agentError: undefined,
            isGenerating: false,
            workspace: {
              ...state.workspace,
              projectSummaries: upsertProjectSummary(state.workspace.projectSummaries, loaded.summary),
              activePanel: "vdt",
              activeProjectId: loaded.summary.project.id,
              activeVdtId: loaded.vdt.id,
              isLoading: false,
              error: undefined
            },
            ...clearPendingAiActionState()
          }));
          return true;
        } catch (error) {
          set((state) => ({
            workspace: {
              ...state.workspace,
              isLoading: false,
              error: error instanceof Error ? error.message : "VDT could not be selected."
            }
          }));
          return false;
        }
      },
      renameWorkspaceVdt: async (vdtId, name) => {
        const trimmed = name.trim();
        if (!trimmed) return false;
        set((state) => ({
          workspace: { ...state.workspace, isMutating: true, error: undefined }
        }));
        try {
          const vdt = await updateStoredVdt(vdtId, { name: trimmed });
          set((state) => ({
            ...(state.workspace.activeVdtId === vdtId
              ? {
                  project: {
                    ...state.project,
                    name: trimmed,
                    updatedAt: nowIso()
                  },
                  brief: {
                    ...state.brief,
                    rootKpi: state.brief.rootKpi || trimmed
                  }
                }
              : {}),
            workspace: {
              ...state.workspace,
              projectSummaries: replaceVdtInSummaries(state.workspace.projectSummaries, vdt),
              isMutating: false,
              error: undefined
            }
          }));
          return true;
        } catch (error) {
          set((state) => ({
            workspace: {
              ...state.workspace,
              isMutating: false,
              error: error instanceof Error ? error.message : "VDT could not be renamed."
            }
          }));
          return false;
        }
      },
      setWorkspaceVdtStatus: async (vdtId, status) => {
        set((state) => ({
          workspace: { ...state.workspace, isMutating: true, error: undefined }
        }));
        try {
          const vdt = await updateStoredVdt(vdtId, { status });
          set((state) => ({
            workspace: {
              ...state.workspace,
              projectSummaries: replaceVdtInSummaries(state.workspace.projectSummaries, vdt),
              isMutating: false,
              error: undefined
            }
          }));
          return true;
        } catch (error) {
          set((state) => ({
            workspace: {
              ...state.workspace,
              isMutating: false,
              error: error instanceof Error ? error.message : "VDT status could not be updated."
            }
          }));
          return false;
        }
      },
      deleteWorkspaceVdt: async (vdtId) => {
        set((state) => ({
          workspace: { ...state.workspace, isMutating: true, error: undefined }
        }));
        try {
          const currentWorkspace = get().workspace;
          const currentSummaries = currentWorkspace.projectSummaries;
          const owningSummary = summaryContainingVdt(currentSummaries, vdtId);
          await deleteStoredVdt(vdtId);
          const nextSummaries = removeVdtFromSummaries(currentSummaries, vdtId);
          const replacementVdtId =
            currentWorkspace.activePanel === "vdt" && currentWorkspace.activeVdtId === vdtId
              ? summaryForProject(nextSummaries, owningSummary?.project.id ?? "")?.vdts[0]?.vdt.id
              : undefined;
          set((state) => ({
            workspace: {
              ...state.workspace,
              projectSummaries: nextSummaries,
              activeVdtId: state.workspace.activeVdtId === vdtId ? undefined : state.workspace.activeVdtId,
              isMutating: false,
              error: undefined
            }
          }));
          if (replacementVdtId) {
            return get().selectWorkspaceVdt(replacementVdtId);
          }
          return true;
        } catch (error) {
          set((state) => ({
            workspace: {
              ...state.workspace,
              isMutating: false,
              error: error instanceof Error ? error.message : "VDT could not be deleted."
            }
          }));
          return false;
        }
      },
      saveActiveWorkspaceVdt: async () => {
        const state = get();
        const activeVdtId = state.workspace.activeVdtId;
        if (!activeVdtId) return false;
        set((current) => ({
          workspace: {
            ...current.workspace,
            isMutating: true,
            error: undefined
          }
        }));
        try {
          const rootNode = rootNodeForProject(state.project);
          const vdt = await updateStoredVdt(activeVdtId, {
            name: state.project.name,
            rootKpi: rootNode?.name ?? state.brief.rootKpi,
            unit: rootNode?.unit ?? state.brief.unit,
            timePeriod: state.brief.timePeriod
          });
          await saveStoredVdtRevision(activeVdtId, {
            project: state.project,
            source: "user",
            summary: "Manual workspace save"
          });
          set((current) => ({
            workspace: {
              ...current.workspace,
              projectSummaries: replaceVdtInSummaries(current.workspace.projectSummaries, vdt),
              isMutating: false,
              error: undefined,
              lastSavedAt: nowIso()
            }
          }));
          void get().refreshWorkspace({ scopedProjectId: get().workspace.activeProjectId });
          return true;
        } catch (error) {
          set((current) => ({
            workspace: {
              ...current.workspace,
              isMutating: false,
              error: error instanceof Error ? error.message : "VDT could not be saved."
            }
          }));
          return false;
        }
      },
      updateNodePosition: (nodeId, position) => {
        set((state) => ({
          project: updateProjectNode(state.project, nodeId, (node) => ({
            ...node,
            position,
            updatedAt: nowIso()
          })),
          projectRevision: state.projectRevision + 1
        }));
        void get().sendManualProjectChange({
          kind: "node_position_updated",
          nodeId,
          patch: { position },
          summary: `User moved node "${nodeId}".`
        });
      },
      setBriefField: (field, value) =>
        set((state) => ({
          brief: {
            ...state.brief,
            [field]: value
          }
        })),
      setProviderId: (providerId) => {
        const providerConfig = { ...get().providerConfig, apiKey: undefined };
        set({
          providerId,
          providerConfig,
          providerTestStatus: undefined,
          executionSettings: migrateLegacyProviderToExecutionSettings(providerId, providerConfig)
        });
      },
      setProviderConfigField: (field, value) =>
        set((state) => {
          const providerConfig = {
            ...state.providerConfig,
            [field]: value
          };
          return {
            providerConfig,
            providerTestStatus: undefined,
            executionSettings: migrateLegacyProviderToExecutionSettings(state.providerId, providerConfig)
          };
        }),
      setExecutionMode: (executionMode) =>
        set((state) => ({
          ...withSyncedLegacyProvider({ ...state.executionSettings, executionMode }, state.providerConfig),
          byokFieldErrors: undefined
        })),
      setExecutionSettingsField: (field, value) =>
        set((state) => ({
          ...withSyncedLegacyProvider(
            {
              ...state.executionSettings,
              [field]: value
            },
            state.providerConfig
          ),
          byokFieldErrors: clearByokFieldError(state.byokFieldErrors, field)
        })),
      setSelectedCliAgentId: (agentId) =>
        set((state) => {
          const command = resolveCliCommandForAgent(agentId, state.cliDetectionAgents);
          const cliModelSelection =
            state.cliModelByAgent[agentId] ??
            state.executionSettings.cliModelSelection ?? { source: "agent_default" };

          return withSyncedLegacyProvider(
            {
              ...state.executionSettings,
              selectedCliAgentId: agentId,
              executionMode: "local_cli",
              localRunnerPresetId: "custom_cli_json",
              runnerProviderId: "cli_stub",
              command,
              cliModelSelection
            },
            state.providerConfig
          );
        }),
      setLocalRunnerPreset: (presetId) =>
        set((state) =>
          withSyncedLegacyProvider(
            applyLocalRunnerPreset(state.executionSettings, presetId),
            state.providerConfig
          )
        ),
      setByokProtocol: (protocol) =>
        set((state) => ({
          ...withSyncedLegacyProvider(
            applyGatewayPreset(
              {
                ...state.executionSettings,
                byokProtocol: protocol,
                byokGateway: "none"
              },
              DEFAULT_PRESET_BY_PROTOCOL[protocol]
            ),
            state.providerConfig
          ),
          byokFieldErrors: undefined
        })),
      setByokGateway: (gateway) =>
        set((state) => {
          const nextState =
            gateway === "none"
              ? withSyncedLegacyProvider(
                  applyGatewayPreset(
                    state.executionSettings,
                    DEFAULT_PRESET_BY_PROTOCOL[state.executionSettings.byokProtocol ?? "openai"]
                  ),
                  state.providerConfig
                )
              : withSyncedLegacyProvider(
                  applyGatewayPreset(state.executionSettings, GATEWAY_TO_PRESET[gateway]),
                  state.providerConfig
                );

          return {
            ...nextState,
            byokFieldErrors: undefined
          };
        }),
      setGatewayPreset: (presetId) =>
        set((state) => ({
          ...withSyncedLegacyProvider(applyGatewayPreset(state.executionSettings, presetId), state.providerConfig),
          byokFieldErrors: undefined
        })),
      setMemoryModelMode: (mode, cliAgentId) =>
        set((state) => ({
          executionSettings: {
            ...state.executionSettings,
            memoryModelMode: mode,
            memoryCliAgentId: mode === "selected_cli" ? cliAgentId : undefined
          }
        })),
      setCliModelSelection: (selection) =>
        set((state) => ({
          executionSettings: {
            ...state.executionSettings,
            cliModelSelection: selection
          }
        })),
      setCliModelForAgent: (agentId, selection) =>
        set((state) => {
          const cliModelByAgent = {
            ...state.cliModelByAgent,
            [agentId]: selection
          };
          const executionSettings =
            state.executionSettings.selectedCliAgentId === agentId
              ? {
                  ...state.executionSettings,
                  cliModelSelection: selection
                }
              : state.executionSettings;

          return {
            cliModelByAgent,
            executionSettings
          };
        }),
      rescanClis: async (agentId) => {
        set({
          isRescanningClis: true,
          rescanningCliId: agentId,
          cliDetectionError: undefined
        });

        try {
          const payload = await createAiExecutionClient().detectSubscriptionClis(agentId);

          set((state) => {
            let cliDetectionAgents: CliAgentDetectionSnapshot[];

            if (!agentId) {
              cliDetectionAgents = payload.agents;
            } else {
              const nextAgent = payload.agents[0];
              if (!nextAgent) {
                return {
                  isRescanningClis: false,
                  rescanningCliId: undefined
                };
              }

              cliDetectionAgents = mergeCliDetectionAgents(state.cliDetectionAgents, nextAgent, agentId);
            }

            const patchedExecutionSettings = patchSelectedCliCommandAfterRescan(
              state.executionSettings,
              cliDetectionAgents,
              agentId
            );

            const scanUpdate = {
              cliDetectionAgents,
              cliDiscoveredModelsByAgent: agentId
                ? {
                    ...state.cliDiscoveredModelsByAgent,
                    [agentId]: payload.modelsByAgent?.[agentId] ?? []
                  }
                : payload.modelsByAgent ?? {},
              cliDetectionError: undefined,
              isRescanningClis: false,
              rescanningCliId: undefined
            };

            if (patchedExecutionSettings === state.executionSettings) {
              return scanUpdate;
            }

            return {
              ...scanUpdate,
              ...withSyncedLegacyProvider(patchedExecutionSettings, state.providerConfig)
            };
          });
        } catch (error) {
          set({
            cliDetectionAgents: [],
            cliDetectionError: error instanceof Error ? error.message : "CLI detection failed.",
            isRescanningClis: false,
            rescanningCliId: undefined
          });
        }
      },
      testCli: async (agentId) => {
        const state = get();
        const catalog = getCliCatalogEntry(agentId);
        const timeoutSec = state.executionSettings.timeoutSec ?? 60;
        const modelSelection = state.cliModelByAgent[agentId];
        const model = modelSelection?.source === "custom" ? modelSelection.customModel : undefined;
        const testFingerprint = JSON.stringify({ agentId, model, timeoutSec });
        const resolved = resolveExecutionSettings({
          ...state.executionSettings,
          executionMode: "local_cli",
          selectedCliAgentId: agentId,
          localRunnerPresetId: "custom_cli_json",
          runnerProviderId: "cli_stub",
          command: resolveCliCommandForAgent(agentId, state.cliDetectionAgents),
          cliModelSelection: model ? { source: "custom", customModel: model } : { source: "agent_default" }
        });

        set((current) => ({
          isTestingCliByAgent: {
            ...current.isTestingCliByAgent,
            [agentId]: true
          },
          cliTestStatusByAgent: {
            ...current.cliTestStatusByAgent,
            [agentId]: undefined
          }
        }));

        let nextStatus: ProviderTestStatus | undefined;

        try {
          const needsPairing = requiresStandaloneRunnerPairing();
          if (needsPairing && !state.runnerPairingToken) {
            throw new Error("Pair the local runner before testing a subscription backend.");
          }
          await createAiExecutionClient().testBackend(String(resolved.providerConfig?.backendId ?? agentId), {
            providerId: resolved.providerId,
            providerConfig: {
              ...resolved.providerConfig,
              ...(needsPairing ? { pairingToken: state.runnerPairingToken } : {})
            }
          });

          nextStatus = {
            kind: "success",
            message: `${catalog.displayName} connection test passed.`
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "CLI test failed.";
          nextStatus = {
            kind: "error",
            message
          };
        } finally {
          const currentState = get();
          const currentModelSelection = currentState.cliModelByAgent[agentId];
          const currentFingerprint = JSON.stringify({
            agentId,
            model: currentModelSelection?.source === "custom" ? currentModelSelection.customModel : undefined,
            timeoutSec: currentState.executionSettings.timeoutSec ?? 60
          });

          set((current) => ({
            isTestingCliByAgent: {
              ...current.isTestingCliByAgent,
              [agentId]: false
            },
            cliTestStatusByAgent:
              currentFingerprint === testFingerprint
                ? {
                    ...current.cliTestStatusByAgent,
                    [agentId]: nextStatus
                  }
                : current.cliTestStatusByAgent
          }));
        }
      },
      pairRunner: async (code) => {
        const runnerUrl = get().executionSettings.runnerUrl ?? "http://127.0.0.1:8765";
        set({ isPairingRunner: true, runnerPairingStatus: undefined, runnerPairingToken: undefined });
        try {
          const { token } = await createAiExecutionClient().pairStandaloneRunner(runnerUrl, code);
          set({
            runnerPairingToken: token,
            runnerPairingStatus: { kind: "success", message: "Local runner paired for this browser session." },
            isPairingRunner: false
          });
        } catch (error) {
          set({
            runnerPairingToken: undefined,
            runnerPairingStatus: { kind: "error", message: error instanceof Error ? error.message : "Runner pairing failed." },
            isPairingRunner: false
          });
        }
      },
      unpairRunner: async () => {
        const state = get();
        const token = state.runnerPairingToken;
        if (!token) return;
        const runnerUrl = state.executionSettings.runnerUrl ?? "http://127.0.0.1:8765";
        try {
          await createAiExecutionClient().unpairStandaloneRunner(runnerUrl, token);
        } finally {
          set({ runnerPairingToken: undefined, runnerPairingStatus: undefined });
        }
      },
      setProviderTestState: (isTestingProvider, providerTestStatus) =>
        set({ isTestingProvider, providerTestStatus }),
      setByokFieldErrors: (byokFieldErrors) => set({ byokFieldErrors }),
      connectAgentEvents: (runId) => {
        activeAgentEventUnsubscribe?.();
        set({ agentConnectionStatus: "connecting" });
        activeAgentEventUnsubscribe = createAgentClient().subscribe(runId, {
          onOpen: () => set({ agentConnectionStatus: "connected" }),
          onEvent: (event) => {
            set((state) => {
              if (state.agentRun?.runId !== runId && state.activeAgentRunId !== runId) return {};
              const byId = new Map(state.agentEvents.map((entry) => [entry.id, entry]));
              byId.set(event.id, event);
              const agentEvents = [...byId.values()].sort((left, right) => left.seq - right.seq);
              const legacyEvents = agentEvents.map((entry) => ({
                id: entry.id,
                timestamp: entry.timestamp,
                type: mapRuntimeAgentEventType(entry.type),
                title: entry.title,
                message: entry.message,
                ...(entry.metadata !== undefined ? { metadata: entry.metadata } : {})
              }));
              return {
                agentEvents,
                generateActivity: state.generateActivity?.runId === runId
                  ? {
                      ...state.generateActivity,
                      agentEvents: legacyEvents,
                      updatedAt: event.timestamp
                    }
                  : state.generateActivity
              };
            });
            if (shouldRefreshAgentSnapshot(event)) {
              void createAgentClient().getRun(runId)
                .then((snapshot) => applyAgentSnapshot(set, snapshot))
                .catch((error) => {
                  const message = error instanceof Error ? error.message : "Agent run could not be refreshed.";
                  set({ agentError: message, aiError: message, agentConnectionStatus: "error" });
                });
            }
          },
          onError: () => set({ agentConnectionStatus: "error" })
        });
      },
      resumePersistedAgentRun: async () => {
        const state = get();
        const runId = resumableAgentRunId(state);
        if (!runId) return;
        if (!isActiveActivity(state.generateActivity) && !isActiveRuntimeRun(state.agentRun)) return;
        if (state.agentConnectionStatus === "connecting" || state.agentConnectionStatus === "connected") return;

        set({ agentConnectionStatus: "connecting" });
        try {
          const snapshot = await createAgentClient().getRun(runId);
          applyAgentSnapshot(set, snapshot);
          if (isActiveRuntimeRun(snapshot)) {
            get().connectAgentEvents(runId);
          } else {
            set({ agentConnectionStatus: "disconnected" });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Agent run could not be reattached.";
          set((current) => ({
            activeAgentRunId: undefined,
            isGenerating: false,
            agentConnectionStatus: "error",
            agentError: message,
            aiError: message,
            generateActivity: current.generateActivity?.runId === runId
              ? {
                  ...current.generateActivity,
                  status: "error",
                  canCancel: false,
                  message: "Saved agent thread was restored, but the backend run could not be reattached.",
                  retryableError: {
                    code: "PROVIDER_UNAVAILABLE",
                    message: "Saved agent thread was restored, but the backend run could not be reattached. Start a new instruction to continue from the saved context.",
                    retryCount: 0,
                    createdAt: nowIso()
                  },
                  updatedAt: nowIso()
                }
              : current.generateActivity
          }));
        }
      },
      startNewAgentChat: () => {
        activeAgentEventUnsubscribe?.();
        activeAgentEventUnsubscribe = undefined;
        set((state) => ({
          agentChatHistory: upsertAgentChatHistory(state.agentChatHistory, state.generateActivity),
          generateActivity: undefined,
          activeAgentRunId: undefined,
          agentRun: undefined,
          agentEvents: [],
          agentPendingQuestions: undefined,
          agentError: undefined,
          aiError: undefined,
          isGenerating: false,
          agentConnectionStatus: "disconnected"
        }));
        return true;
      },
      openAgentChat: (runId) => {
        const state = get();
        const entry = state.agentChatHistory.find((candidate) => candidate.runId === runId);
        if (!entry) return false;
        const snapshot = entry.activity.runtimeAgentRun;
        const active = isActiveRuntimeRun(snapshot);
        activeAgentEventUnsubscribe?.();
        activeAgentEventUnsubscribe = undefined;
        set((current) => ({
          agentChatHistory: upsertAgentChatHistory(current.agentChatHistory, current.generateActivity),
          generateActivity: entry.activity,
          activeAgentRunId: active ? runId : undefined,
          agentRun: snapshot,
          agentEvents: snapshot?.events ?? [],
          agentPendingQuestions: snapshot?.pendingQuestions,
          agentError: snapshot?.error?.message,
          aiError: undefined,
          isGenerating: active,
          agentConnectionStatus: active ? "connecting" : "idle"
        }));
        if (active) {
          void createAgentClient().getRun(runId)
            .then((latestSnapshot) => {
              applyAgentSnapshot(set, latestSnapshot);
              if (isActiveRuntimeRun(latestSnapshot)) {
                get().connectAgentEvents(runId);
              } else {
                set({ agentConnectionStatus: "disconnected" });
              }
            })
            .catch((error) => {
              const message = error instanceof Error ? error.message : "Agent run could not be loaded.";
              set({
                aiError: message,
                agentError: message,
                isGenerating: false,
                agentConnectionStatus: "error"
              });
            });
        }
        return true;
      },
      startAgentRun: async (initialInstruction, options) => {
        if (get().isGenerating) return false;
        const state = get();
        const { executionSettings, cliDetectionAgents } = state;
        if (executionSettings.executionMode === "local_cli" && !hasLocalAiUi(resolveVdtAppMode())) {
          set({ aiError: HOSTED_WEB_LOCAL_AI_MESSAGE, generateActivity: undefined });
          return false;
        }
        if (executionSettings.executionMode === "byok") {
          const validationErrors = validateByokSettings(executionSettings);
          if (hasByokFieldErrors(validationErrors)) {
            set({
              byokFieldErrors: validationErrors,
              aiError: "Fix BYOK settings before starting the agent.",
              generateActivity: undefined
            });
            return false;
          }
        }
        const executionError = validateExecutionForGenerate(executionSettings, cliDetectionAgents);
        if (executionError) {
          set({ aiError: executionError, generateActivity: undefined });
          return false;
        }
        const { providerId, providerConfig } = resolveExecutionSettings(state.executionSettings);
        if (providerId === "mock") {
          set({ aiError: "Configure a real provider before starting the agent.", generateActivity: undefined });
          return false;
        }
        set({
          isGenerating: true,
          aiError: undefined,
          agentError: undefined,
          agentEvents: [],
          agentPendingQuestions: undefined,
          agentConnectionStatus: "connecting",
          ...clearPendingAiActionState()
        });
        try {
          const prompt = initialInstruction?.trim();
          const input: VdtAgentStartRequest["input"] = {
            ...state.brief,
            ...(prompt ? { prompt } : {}),
            ...(options?.selectedNodeId ? { selectedNodeId: options.selectedNodeId } : {}),
            ...(options?.includeCurrentProject ? { project: state.project } : {})
          };
          const response = await createAgentClient().startRun({
            mode: options?.mode ?? "generate_vdt",
            input,
            workspace: buildAgentWorkspaceContext(state),
            providerId,
            providerConfig,
            options: {
              autoApplyPatches: true,
              continueWithAssumptions: false,
              maxSteps: 30
            }
          });
          set({ activeAgentRunId: response.runId });
          applyAgentSnapshot(set, response.snapshot);
          get().connectAgentEvents(response.runId);
          return true;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Agent run could not be started.";
          set({
            aiError: message,
            agentError: message,
            isGenerating: false,
            agentConnectionStatus: "error"
          });
          return false;
        }
      },
      sendAgentAnswers: async (answers) => {
        const runId = get().agentRun?.runId ?? get().activeAgentRunId ?? get().generateActivity?.runId;
        if (!runId) {
          const message = "Agent run was not found. Reload the page or start a new run.";
          set({ agentError: message, aiError: message });
          return;
        }
        const submittedAt = nowIso();
        set((state) => ({
          aiError: undefined,
          agentError: undefined,
          isGenerating: true,
          activeAgentRunId: state.activeAgentRunId ?? runId,
          agentConnectionStatus: state.agentConnectionStatus === "idle" ? "connecting" : state.agentConnectionStatus,
          generateActivity: state.generateActivity?.runId === runId
            ? {
                ...state.generateActivity,
                status: "running",
                canCancel: true,
                cancelRequested: false,
                publicStatus: {
                  phase: "planning_model",
                  message: "Reading your answer...",
                  updatedAt: submittedAt
                },
                retryableError: undefined,
                message: undefined,
                completedAt: undefined,
                updatedAt: submittedAt
              }
            : state.generateActivity
        }));
        try {
          const snapshot = await createAgentClient().sendMessage(runId, {
            type: "user_answer",
            ...(Array.isArray(answers) ? { structuredAnswers: answers } : { answers })
          });
          applyAgentSnapshot(set, snapshot);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Agent answers could not be sent.";
          const failedAt = nowIso();
          set((state) => ({
            agentError: message,
            aiError: message,
            agentConnectionStatus: "error",
            isGenerating: state.generateActivity?.runId === runId ? true : state.isGenerating,
            generateActivity: state.generateActivity?.runId === runId
              ? {
                  ...state.generateActivity,
                  status: "needs_user_input",
                  canCancel: true,
                  publicStatus: {
                    phase: "waiting_user",
                    message: `Could not send answer: ${message}`,
                    updatedAt: failedAt
                  },
                  message,
                  updatedAt: failedAt
                }
              : state.generateActivity
          }));
        }
      },
      sendAgentApproval: async (approved, selectedChangeIds) => {
        const runId = get().agentRun?.runId ?? get().activeAgentRunId ?? get().generateActivity?.runId;
        if (!runId) {
          const message = "Agent run was not found. Reload the page or start a new run.";
          set({ agentError: message, aiError: message });
          return;
        }
        const submittedAt = nowIso();
        set((state) => ({
          aiError: undefined,
          agentError: undefined,
          isGenerating: true,
          activeAgentRunId: state.activeAgentRunId ?? runId,
          agentConnectionStatus: state.agentConnectionStatus === "idle" ? "connecting" : state.agentConnectionStatus,
          generateActivity: state.generateActivity?.runId === runId
            ? {
                ...state.generateActivity,
                status: "running",
                canCancel: true,
                cancelRequested: false,
                publicStatus: {
                  phase: "planning_model",
                  message: approved ? "Sending approval to the agent..." : "Rejecting pending agent action...",
                  updatedAt: submittedAt
                },
                retryableError: undefined,
                message: undefined,
                completedAt: undefined,
                updatedAt: submittedAt
              }
            : state.generateActivity
        }));
        try {
          const snapshot = await createAgentClient().sendMessage(runId, {
            type: "approval",
            approved,
            ...(selectedChangeIds && selectedChangeIds.length > 0 ? { selectedChangeIds } : {})
          });
          applyAgentSnapshot(set, snapshot);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Agent approval could not be sent.";
          const failedAt = nowIso();
          set((state) => ({
            agentError: message,
            aiError: message,
            agentConnectionStatus: "error",
            isGenerating: state.generateActivity?.runId === runId ? true : state.isGenerating,
            generateActivity: state.generateActivity?.runId === runId
              ? {
                  ...state.generateActivity,
                  status: "running",
                  canCancel: true,
                  publicStatus: {
                    phase: "waiting_user",
                    message: `Could not send approval: ${message}`,
                    updatedAt: failedAt
                  },
                  message,
                  updatedAt: failedAt
                }
              : state.generateActivity
          }));
        }
      },
      sendAgentInstruction: async (text, selectedNodeId) => {
        const trimmed = text.trim();
        if (!trimmed) return false;
        const currentRun = get().agentRun;
        const activity = get().generateActivity;
        if (
          currentRun?.status === "failed" ||
          currentRun?.status === "succeeded" ||
          currentRun?.status === "cancelled"
        ) {
          return false;
        }
        const activityRunId = activity && isActiveActivity(activity) ? activity.runId : undefined;
        const runId = currentRun?.runId ?? get().activeAgentRunId ?? activityRunId;
        if (!runId) {
          set((state) => ({
            brief: {
              ...state.brief,
              businessContext: [state.brief.businessContext, `Agent instruction: ${trimmed}`]
                .filter(Boolean)
                .join("\n")
            }
          }));
          return true;
        }
        const submittedAt = nowIso();
        set((state) => ({
          aiError: undefined,
          agentError: undefined,
          activeAgentRunId: state.activeAgentRunId ?? runId,
          agentConnectionStatus: state.agentConnectionStatus === "idle" ? "connecting" : state.agentConnectionStatus,
          generateActivity: state.generateActivity?.runId === runId
            ? {
                ...state.generateActivity,
                status: "running",
                canCancel: true,
                retryableError: undefined,
                publicStatus: {
                  phase: "planning_model",
                  message: "Sending your instruction to the agent...",
                  updatedAt: submittedAt
                },
                message: undefined,
                completedAt: undefined,
                updatedAt: submittedAt
              }
            : state.generateActivity
        }));
        try {
          const snapshot = await createAgentClient().sendMessage(runId, {
            type: "user_instruction",
            text: trimmed,
            ...(selectedNodeId ? { selectedNodeId } : {})
          });
          applyAgentSnapshot(set, snapshot);
          return true;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Agent instruction could not be sent.";
          const failedAt = nowIso();
          set((state) => ({
            agentError: message,
            aiError: message,
            agentConnectionStatus: "error",
            generateActivity: state.generateActivity?.runId === runId
              ? {
                  ...state.generateActivity,
                  status: "needs_user_input",
                  canCancel: true,
                  publicStatus: {
                    phase: "waiting_user",
                    message: `Could not send instruction: ${message}`,
                    updatedAt: failedAt
                  },
                  message,
                  updatedAt: failedAt
                }
              : state.generateActivity
          }));
          return false;
        }
      },
      sendManualProjectChange: async (change) => {
        const runId = get().activeAgentRunId;
        if (!runId) return;
        try {
          const snapshot = await createAgentClient().sendMessage(runId, {
            type: "manual_project_change",
            projectRevision: get().projectRevision,
            change
          });
          applyAgentSnapshot(set, snapshot);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Manual change could not be sent to the agent.";
          set({ agentError: message });
        }
      },
      addManualIncomingKpi: (parentNodeId) => {
        let addedNodeId: string | undefined;
        let parentName = parentNodeId;
        set((state) => {
          const result = addManualIncomingKpiToProject(state.project, parentNodeId);
          if (!result) return {};
          addedNodeId = result.newNodeId;
          parentName = state.project.graph.nodes.find((node) => node.id === parentNodeId)?.name ?? parentNodeId;
          return {
            project: layoutProjectGraph(result.project, state.ui),
            selectedNodeId: result.newNodeId,
            selectedPanelTab: "properties",
            projectRevision: state.projectRevision + 1
          };
        });
        if (!addedNodeId) return;
        void get().sendManualProjectChange({
          kind: "change_set_applied",
          nodeId: addedNodeId,
          summary: `User added manual incoming KPI "${addedNodeId}" under "${parentName}".`
        });
      },
      requestIncomingKpisWithAi: async (nodeId) => {
        const state = get();
        const node = state.project.graph.nodes.find((candidate) => candidate.id === nodeId);
        if (!node) {
          const message = "Select an existing KPI before asking the agent to add incoming KPIs.";
          set({ aiError: message, agentError: message });
          return false;
        }

        set({ selectedNodeId: nodeId, aiError: undefined, agentError: undefined });
        const instruction = buildIncomingKpisAgentInstruction(node);
        const canContinueCurrentRun = isActiveRuntimeRun(state.agentRun) || isActiveActivity(state.generateActivity);
        if (canContinueCurrentRun) {
          return get().sendAgentInstruction(instruction, nodeId);
        }

        return get().startAgentRun(instruction, {
          mode: "continue_project",
          selectedNodeId: nodeId,
          includeCurrentProject: true
        });
      },
      applyAgentGraphPatch: (snapshot) => applyAgentSnapshot(set, snapshot),
      cancelAgentRun: async () => {
        const runId = get().activeAgentRunId ?? get().agentRun?.runId;
        if (!runId) return;
        try {
          await createAgentClient().cancel(runId);
          const snapshot = await createAgentClient().getRun(runId);
          applyAgentSnapshot(set, snapshot);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Agent run could not be cancelled.";
          set({ agentError: message, aiError: message });
        } finally {
          activeAgentEventUnsubscribe?.();
          activeAgentEventUnsubscribe = undefined;
          set({ agentConnectionStatus: "disconnected" });
        }
      },
      cancelGenerate: () => {
        const activity = get().generateActivity;
        if (!activity || (activity.status !== "running" && activity.status !== "needs_user_input")) return;
        if (get().activeAgentRunId) {
          const requestedAt = nowIso();
          set({
            generateActivity: {
              ...activity,
              cancelRequested: true,
              canCancel: false,
              message: "Cancelling agent run...",
              updatedAt: requestedAt
            }
          });
          void get().cancelAgentRun();
          return;
        }
        const completedAt = nowIso();
        set({
          isGenerating: false,
          generateActivity: {
            ...activity,
            status: "cancelled",
            cancelRequested: true,
            canCancel: false,
            message: "Generation cancelled.",
            details: mergeActivityDetails(activity.details, undefined, completedAt, "cancelled"),
            completedAt,
            updatedAt: completedAt
          }
        });
      },
      generateWithAi: async () => {
        if (get().isGenerating) return;

        const state = get();
        const { brief, executionSettings, cliDetectionAgents } = state;

        if (executionSettings.executionMode === "local_cli" && !hasLocalAiUi(resolveVdtAppMode())) {
          set({ aiError: HOSTED_WEB_LOCAL_AI_MESSAGE, generateActivity: undefined });
          return;
        }

        if (executionSettings.executionMode === "byok") {
          const validationErrors = validateByokSettings(executionSettings);
          if (hasByokFieldErrors(validationErrors)) {
            set({
              byokFieldErrors: validationErrors,
              aiError: "Fix BYOK settings before generating.",
              generateActivity: undefined
            });
            return;
          }
        }

        const executionError = validateExecutionForGenerate(executionSettings, cliDetectionAgents);
        if (executionError) {
          set({ aiError: executionError, generateActivity: undefined });
          return;
        }

        const { providerId, providerConfig } = resolveExecutionSettings(executionSettings);
        const runnerPairingToken = get().runnerPairingToken;
        const needsPairing = requiresStandaloneRunnerPairing();
        if (needsPairing && !runnerPairingToken) {
          set({ aiError: "Pair the local runner before generating.", generateActivity: undefined });
          return;
        }

        set({
          isGenerating: true,
          aiError: undefined,
          ...clearPendingAiActionState(),
          byokFieldErrors: undefined,
          activeAgentRunId: undefined,
          agentRun: undefined,
          agentEvents: [],
          agentPendingQuestions: undefined,
          agentError: undefined,
          agentConnectionStatus: "connecting"
        });

        try {
          const response = await createAgentClient().startRun({
            mode: "generate_vdt",
            input: brief,
            workspace: buildAgentWorkspaceContext(state),
            providerId,
            providerConfig:
              providerId === "mock"
                ? undefined
                : needsPairing
                  ? { ...providerConfig, pairingToken: runnerPairingToken }
                  : providerConfig,
            options: {
              autoApplyPatches: true,
              continueWithAssumptions: false,
              maxSteps: 30
            }
          });
          set({ activeAgentRunId: response.runId });
          applyAgentSnapshot(set, response.snapshot);
          if (isActiveRuntimeRun(response.snapshot)) {
            get().connectAgentEvents(response.runId);
          } else {
            set({ agentConnectionStatus: "disconnected" });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Agent run could not be started.";
          set({
            aiError: message,
            agentError: message,
            isGenerating: false,
            agentConnectionStatus: "error"
          });
        }
      },
      loadExample: (exampleId = "production_volume") => {
        const project = ensureScenario(buildExampleProject(exampleId));
        set({
          project,
          brief: briefFromProject(project),
          selectedNodeId: project.rootNodeId,
          activeScenarioId: resolveMainScenarioId(project),
          generateActivity: undefined,
          aiError: undefined,
          ...clearPendingAiActionState()
        });
      },
      replaceProject: (project) => {
        const nextProject = ensureScenario(project);
        set((state) => ({
          project: nextProject,
          selectedNodeId: nextProject.rootNodeId,
          activeScenarioId: resolveMainScenarioId(nextProject),
          generateActivity: undefined,
          aiError: undefined,
          projectRevision: state.projectRevision + 1,
          ...clearPendingAiActionState()
        }));
        void get().sendManualProjectChange({
          kind: "project_replaced",
          summary: "User replaced the current project."
        });
      },
      selectNode: (nodeId) => set({ selectedNodeId: nodeId }),
      updateNode: (nodeId, patch) => {
        set((state) => ({
          project: updateProjectNode(state.project, nodeId, (node) => ({
            ...node,
            ...patch,
            status: patch.status ?? (node.aiGenerated ? "edited" : node.status),
            updatedAt: nowIso()
          })),
          projectRevision: state.projectRevision + 1
        }));
        void get().sendManualProjectChange({
          kind: "node_updated",
          nodeId,
          patch,
          summary: `User updated node "${nodeId}".`
        });
      },
      updateNodeBaselineValue: (nodeId, value) => {
        set((state) => ({
          project: updateProjectNode(state.project, nodeId, (node) => {
            if (value === undefined) {
              const next = { ...node, status: node.aiGenerated ? "needs_data" : node.status, updatedAt: nowIso() };
              delete next.baselineValue;
              delete next.value;
              return next;
            }

            return {
              ...node,
              baselineValue: value,
              status: node.aiGenerated ? "edited" : node.status,
              updatedAt: nowIso()
            };
          }),
          projectRevision: state.projectRevision + 1
        }));
        void get().sendManualProjectChange({
          kind: "node_updated",
          nodeId,
          patch: { baselineValue: value },
          summary: `User updated node "${nodeId}" baseline value.`
        });
      },
      acceptNode: (nodeId) =>
        set((state) => ({
          project: updateProjectNode(state.project, nodeId, (node) => ({
            ...node,
            status: "accepted",
            updatedAt: nowIso()
          }))
        })),
      rejectNode: (nodeId) =>
        set((state) => ({
          project: updateProjectNode(state.project, nodeId, (node) => ({
            ...node,
            status: "rejected",
            updatedAt: nowIso()
          }))
        })),
      deleteNode: (nodeId) => {
        let deleted = false;
        set((state) => {
          if (nodeId === state.project.rootNodeId) {
            return {};
          }

          const project = {
            ...state.project,
            updatedAt: nowIso(),
            graph: {
              nodes: state.project.graph.nodes.filter((node) => node.id !== nodeId),
              edges: state.project.graph.edges.filter(
                (edge) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId
              )
            }
          };

          deleted = true;
          return {
            project,
            selectedNodeId: project.rootNodeId,
            projectRevision: state.projectRevision + 1
          };
        });
        if (deleted) {
          void get().sendManualProjectChange({
            kind: "node_deleted",
            nodeId,
            summary: `User deleted node "${nodeId}".`
          });
        }
      },
      createScenario: () =>
        set((state) => {
          const scenario = defaultScenario();
          return {
            activeScenarioId: scenario.id,
            project: {
              ...state.project,
              scenarios: [...state.project.scenarios, scenario],
              updatedAt: nowIso()
            }
          };
        }),
      setActiveScenarioId: (scenarioId) => set({ activeScenarioId: scenarioId }),
      setMainScenario: (scenarioId) =>
        set((state) => {
          if (!state.project.scenarios.some((scenario) => scenario.id === scenarioId)) {
            return state;
          }

          const updatedAt = nowIso();
          return {
            project: {
              ...state.project,
              updatedAt,
              scenarios: state.project.scenarios.map((scenario) => ({
                ...scenario,
                isMain: scenario.id === scenarioId,
                updatedAt: scenario.id === scenarioId || scenario.isMain ? updatedAt : scenario.updatedAt
              }))
            }
          };
        }),
      renameScenario: (scenarioId, name) =>
        set((state) => {
          const trimmed = name.trim();
          if (!trimmed) {
            return state;
          }

          const scenario = state.project.scenarios.find((candidate) => candidate.id === scenarioId);
          if (!scenario || scenario.name === trimmed) {
            return state;
          }

          const updatedAt = nowIso();
          return {
            project: {
              ...state.project,
              updatedAt,
              scenarios: state.project.scenarios.map((candidate) =>
                candidate.id === scenarioId ? { ...candidate, name: trimmed, updatedAt } : candidate
              )
            }
          };
        }),
      deleteScenario: (scenarioId) =>
        set((state) => {
          if (state.project.scenarios.length <= 1) {
            return state;
          }

          const index = state.project.scenarios.findIndex((candidate) => candidate.id === scenarioId);
          if (index === -1) {
            return state;
          }

          const deletedScenario = state.project.scenarios[index];
          const wasMain = deletedScenario?.isMain === true;
          let scenarios = state.project.scenarios.filter((candidate) => candidate.id !== scenarioId);
          if (wasMain) {
            const promoteId = scenarios[Math.min(index, scenarios.length - 1)]!.id;
            scenarios = scenarios.map((scenario) => ({
              ...scenario,
              isMain: scenario.id === promoteId
            }));
          }

          const nextActive =
            state.activeScenarioId === scenarioId
              ? scenarios[Math.min(index, scenarios.length - 1)]!.id
              : state.activeScenarioId;

          return {
            activeScenarioId: nextActive,
            project: {
              ...state.project,
              scenarios,
              updatedAt: nowIso()
            }
          };
        }),
      cloneScenario: (scenarioId) =>
        set((state) => {
          const source = state.project.scenarios.find((candidate) => candidate.id === scenarioId);
          if (!source) {
            return state;
          }

          const now = nowIso();
          const clone: VdtScenario = {
            id: makeId("scenario"),
            name: uniqueScenarioCopyName(source.name, state.project.scenarios),
            description: source.description ?? defaultScenario().description,
            overrides: source.overrides.map((override) => ({ ...override })),
            createdAt: now,
            updatedAt: now
          };

          return {
            activeScenarioId: clone.id,
            project: {
              ...state.project,
              scenarios: [...state.project.scenarios, clone],
              updatedAt: nowIso()
            }
          };
        }),
      updateScenarioOverride: (scenarioId, nodeId, value) =>
        set((state) => {
          if (state.project.graph.nodes.find((n) => n.id === nodeId)?.fixedInScenario === true) {
            return state;
          }

          return {
            project: {
              ...state.project,
              updatedAt: nowIso(),
              scenarios: state.project.scenarios.map((scenario) => {
                if (scenario.id !== scenarioId) {
                  return scenario;
                }

                const overrides = scenario.overrides.filter((override) => override.nodeId !== nodeId);
                if (value !== undefined) {
                  overrides.push({ nodeId, value });
                }

                return {
                  ...scenario,
                  overrides,
                  updatedAt: nowIso()
                };
              })
            }
          };
        }),
      runAiAction: async (taskType, input) => {
        const actionRunId = AGENTIC_AI_ACTION_SCHEMA_IDS[taskType] ? generateRunId() : undefined;
        const stateBeforeRun = get();
        const resolvedExecution = actionRunId ? resolveExecutionSettings(stateBeforeRun.executionSettings) : undefined;
        set({
          isRunningAiAction: true,
          aiActionError: undefined,
          pendingAdvisoryResult: undefined,
          pendingAdvisoryTaskType: undefined,
          pendingExplanation: undefined,
          pendingExplanationTaskType: undefined,
          ...(actionRunId && resolvedExecution
            ? {
                generateActivity: buildAiActionActivity(
                  actionRunId,
                  taskType,
                  stateBeforeRun.executionSettings,
                  resolvedExecution.providerId,
                  resolvedExecution.providerConfig
                )
              }
            : {})
        });

        try {
          const result = await runAiTask(
            taskType,
            input,
            get(),
            actionRunId
              ? { onProgress: (event) => applyGenerateProgressEvent(set, actionRunId, event) }
              : undefined
          );
          const project = get().project;

          switch (result.kind) {
            case "change_set":
              set((state) => {
                const activity = actionRunId && state.generateActivity?.runId === actionRunId
                  ? state.generateActivity
                  : undefined;
                const completedAt = nowIso();
                const agentPatch = activity ? mergeAgentRun(activity, result.agentRun) : {};
                const finalReport = agentPatch.finalReport ?? activity?.finalReport ?? activity?.agentRun?.finalReport;
                return {
                  pendingChangeSet: result.changeSet,
                  changeSetSelection: collectChangeEntryIds(result.changeSet),
                  highlightedNodeIds: computeHighlightedNodeIds(project, result.changeSet),
                  pendingAdvisoryResult: undefined,
                  pendingAdvisoryTaskType: undefined,
                  pendingExplanation: undefined,
                  pendingExplanationTaskType: undefined,
                  selectedPanelTab: "ai",
                  isRunningAiAction: false,
                  ...(activity
                    ? {
                        generateActivity: {
                          ...activity,
                          ...agentPatch,
                          status: "ready",
                          phase: "ready",
                          phaseStartedAt: completedAt,
                          canCancel: false,
                          summary: finalReport ?? `Prepared ${result.changeSet.additions.length} graph change${result.changeSet.additions.length === 1 ? "" : "s"}.`,
                          finalReport,
                          details: mergeActivityDetails(activity.details, undefined, completedAt, "ready"),
                          completedAt,
                          updatedAt: completedAt
                        }
                      }
                    : {})
                };
              });
              return;
            case "advisory":
              set({
                pendingChangeSet: undefined,
                changeSetSelection: new Set<string>(),
                highlightedNodeIds: [],
                pendingExplanation: undefined,
                pendingExplanationTaskType: undefined,
                pendingAdvisoryResult: result.result,
                pendingAdvisoryTaskType: taskType,
                aiActionError: undefined,
                selectedPanelTab: "ai",
                isRunningAiAction: false
              });
              return;
            case "explanation":
              set({
                pendingChangeSet: undefined,
                changeSetSelection: new Set<string>(),
                highlightedNodeIds: [],
                pendingAdvisoryResult: undefined,
                pendingAdvisoryTaskType: undefined,
                pendingExplanation: result.result,
                pendingExplanationTaskType: taskType,
                aiActionError: undefined,
                selectedPanelTab: "ai",
                isRunningAiAction: false
              });
              return;
            case "project":
              throw new Error("Unexpected project result from run-task.");
            default: {
              const exhaustive: never = result;
              throw new Error(`Unsupported AI task result: ${String(exhaustive)}`);
            }
          }
        } catch (error) {
          set((state) => {
            const activity = actionRunId && state.generateActivity?.runId === actionRunId
              ? state.generateActivity
              : undefined;
            const completedAt = nowIso();
            const message = error instanceof Error ? error.message : "AI task failed.";
            return {
              aiActionError: message,
              isRunningAiAction: false,
              ...(activity
                ? {
                    generateActivity: {
                      ...activity,
                      status: "error",
                      canCancel: false,
                      message,
                      details: mergeActivityDetails(activity.details, undefined, completedAt, "error"),
                      completedAt,
                      updatedAt: completedAt
                    }
                  }
                : {})
            };
          });
        }
      },
      toggleChangeSelection: (changeId) =>
        set((state) => {
          const changeSetSelection = new Set(state.changeSetSelection);
          if (changeSetSelection.has(changeId)) {
            changeSetSelection.delete(changeId);
          } else {
            changeSetSelection.add(changeId);
          }
          return { changeSetSelection };
        }),
      applyPendingChangeSet: () => {
        let appliedChangeSetId: string | undefined;
        set((state) => {
          if (!state.pendingChangeSet || state.changeSetSelection.size === 0) {
            return {};
          }

          const taskType = state.pendingChangeSet.taskType;
          const snapshotted = createVersionSnapshot(state.project, {
            name: `Before ${taskType} apply`,
            taskType
          });
          const applied = applyChangeSet(snapshotted, state.pendingChangeSet, state.changeSetSelection);
          if (!applied.success) {
            return {
              aiActionError:
                applied.warnings.map((warningItem) => warningItem.message).join("; ") ||
                "Change set could not be applied."
            };
          }

          const laidOut = layoutProjectGraph(applied.project, state.ui);
          calculateGraph(laidOut);

          appliedChangeSetId = state.pendingChangeSet.id;
          return {
            project: laidOut,
            projectRevision: state.projectRevision + 1,
            ...clearPendingAiActionState()
          };
        });
        if (appliedChangeSetId) {
          void get().sendManualProjectChange({
            kind: "change_set_applied",
            summary: `User applied change set "${appliedChangeSetId}".`
          });
        }
      },
      discardPendingChangeSet: () => set(clearPendingAiActionState()),
      saveAdvisoryToProject: () =>
        set((state) => {
          if (!state.pendingAdvisoryResult) {
            return {};
          }

          return {
            project: {
              ...state.project,
              updatedAt: nowIso(),
              aiReview: mergeAdvisoryIntoReview(state.project.aiReview, state.pendingAdvisoryResult)
            }
          };
        }),
      applyAdvisorySuggestedChanges: () =>
        set((state) => {
          if (!state.pendingAdvisoryResult) {
            return {};
          }

          const suggestedChanges = readAdvisorySuggestedChanges(state.pendingAdvisoryResult);
          if (!suggestedChanges) {
            return {
              aiActionError: "This advisory result does not include a change-set draft."
            };
          }

          return {
            pendingChangeSet: suggestedChanges,
            changeSetSelection: collectChangeEntryIds(suggestedChanges),
            highlightedNodeIds: computeHighlightedNodeIds(state.project, suggestedChanges),
            aiActionError: undefined,
            selectedPanelTab: "ai"
          };
        }),
      restoreVersionSnapshot: (versionId) =>
        set((state) => {
          try {
            const restored = ensureScenario(restoreProjectVersionSnapshot(state.project, versionId));
            const laidOut = layoutProjectGraph(restored, state.ui);
            calculateGraph(laidOut);

            return {
              project: laidOut,
              selectedNodeId: laidOut.rootNodeId,
              activeScenarioId: resolveMainScenarioId(laidOut),
              ...clearPendingAiActionState()
            };
          } catch (error) {
            return {
              aiActionError:
                error instanceof Error ? error.message : "Version snapshot could not be restored."
            };
          }
        })
    }),
    {
      name: "vdt-studio-state",
      version: 2,
      storage: createJSONStorage(() => localStorage),
      migrate: (persistedState, version) => {
        // v2: legacy providerId/providerConfig hydrate into executionSettings via migratePersistedStateToV2.
        let state = scrubPersistedProviderSecrets(persistedState);
        if (version < 2) {
          state = migratePersistedStateToV2(state);
        }
        return state as Partial<VdtStudioState>;
      },
      // Session/ephemeral fields are intentionally omitted: runnerPairingToken, cliTestStatusByAgent,
      // providerTestStatus (see PARTIALIZE_EPHEMERAL_STATE_KEYS in provider-persistence.ts).
      partialize: (state) => ({
        project: state.project,
        workspace: {
          activePanel: state.workspace.activePanel,
          projectSummaries: state.workspace.projectSummaries,
          activeProjectId: state.workspace.activeProjectId,
          activeVdtId: state.workspace.activeVdtId,
          isLoading: false,
          isMutating: false,
          lastSavedAt: state.workspace.lastSavedAt
        },
        selectedNodeId: state.selectedNodeId,
        activeScenarioId: state.activeScenarioId,
        brief: state.brief,
        providerId: state.providerId,
        providerConfig: persistedProviderConfig(state.providerConfig),
        executionSettings: persistedExecutionSettings(state.executionSettings),
        ui: state.ui,
        generateActivity: state.generateActivity,
        agentChatHistory: state.agentChatHistory,
        activeAgentRunId: state.activeAgentRunId,
        agentRun: state.agentRun,
        agentEvents: state.agentEvents,
        agentPendingQuestions: state.agentPendingQuestions,
        agentError: state.agentError
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<VdtStudioState> | undefined;
        const providerConfig = persistedProviderConfig(persisted?.providerConfig ?? currentState.providerConfig);
        const ui = mergeUiPreferences(persisted?.ui);
        const executionSettings = reconcilePersistedExecutionSettings(
          persisted?.providerId,
          providerConfig,
          persisted?.executionSettings
        );
        const synced = syncLegacyProviderFromExecutionSettings(executionSettings, providerConfig);
        const project = ensureScenario(persisted?.project ?? currentState.project);
        const mergedWorkspace = {
          ...EMPTY_WORKSPACE,
          ...(persisted?.workspace ?? currentState.workspace),
          isLoading: false,
          isMutating: false,
          error: undefined
        };
        const persistedActiveVdtExists = hasActiveWorkspaceVdt(mergedWorkspace);
        const activeWorkspacePanel: WorkspacePanelMode =
          persistedActiveVdtExists && mergedWorkspace.activePanel === "vdt" ? "vdt" : "project";
        const workspace: VdtWorkspaceState = {
          ...mergedWorkspace,
          activeVdtId: persistedActiveVdtExists ? mergedWorkspace.activeVdtId : undefined,
          activePanel: activeWorkspacePanel
        };
        const generateActivity = persisted?.generateActivity;
        const agentRun = persisted?.agentRun;
        const hasActiveAgentRun = isActiveActivity(generateActivity) || isActiveRuntimeRun(agentRun);
        const activeAgentRunId = hasActiveAgentRun
          ? persisted?.activeAgentRunId ?? agentRun?.runId ?? generateActivity?.runId
          : undefined;

        return {
          ...currentState,
          ...persisted,
          project,
          workspace,
          activeScenarioId: resolveMainScenarioId(project),
          providerId: synced.providerId,
          providerConfig: persistedProviderConfig(synced.providerConfig as ProviderConfigState),
          executionSettings,
          ui,
          generateActivity,
          agentChatHistory: persisted?.agentChatHistory ?? [],
          activeAgentRunId,
          agentRun,
          agentEvents: persisted?.agentEvents ?? [],
          agentPendingQuestions: persisted?.agentPendingQuestions,
          isGenerating: hasActiveAgentRun,
          agentConnectionStatus: hasActiveAgentRun ? "disconnected" : "idle"
        };
      }
    }
  )
);

export function useCurrentCalculation() {
  return useVdtStudioStore((state) => calculateGraph(state.project));
}
