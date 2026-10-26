"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  applyChangeSet,
  normalizeInstructionPreferences,
  validInstructionPreferences,
  type InstructionPreferences,
  calculateGraph,
  cloneProject,
  kpiCanonicalJson,
  createVersionSnapshot,
  DEFAULT_CANVAS_LAYOUT,
  diffChangeSet,
  importProjectJson,
  layoutGraph,
  productionVolumeProject,
  restoreVersionSnapshot as restoreProjectVersionSnapshot,
  restoreVersionWithCheckpoint,
  stableSnakeId,
  uniqueId,
  VdtBuilderSession,
  validateIncomingKpiChangeSet,
  type VdtChangeSet,
  type VdtNode,
  type VdtProject,
  type VdtScenario
} from "@vdt-studio/vdt-core";
import {
  type GenerateVdtInput,
  type OpenAiCompatibleProviderConfig
} from "@vdt-studio/ai-harness";
import { AGENT_DECISION_TIMEOUT_FLOOR_MS } from "@vdt-studio/local-runner/timeout-limits";
import { makeId } from "@/lib/id";
import type { ProjectCardMetadata } from "@/lib/project-metadata";
import { workspacePersonalisation } from "@/lib/personalisation";
import { studioStateStorage } from "@/lib/smart-kpi-journal";
import { apiKeyScope } from "@/lib/api-key-persistence";
import type { SmartKpiIncomingActions } from "@/lib/smart-kpi-incoming-contract";
import { canUndoSmartKpi, createSmartKpiActions, guardSmartKpiActions, hasSmartKpiRebase, smartKpiBlockedReason,
  type SmartKpiApplyInput, type SmartKpiApplyResult, type SmartKpiMutationView, type SmartKpiOperation, type SmartKpiRebase, type SmartKpiUndo } from "@/lib/smart-kpi-transaction";
import { fileImportContextError, type FileImportTargetContext } from "@/components/data-import/import-context";
import {
  buildAgentPublicStartRequest
} from "@/lib/agent-start-resolver";
import { prepareOpenAiAgentBinding } from "@/lib/openai-agent-binding";
import {
  createAgentClient,
  type AgentAnswerPayload as RuntimeAgentAnswerPayload,
  type AgentChatMessage as RuntimeAgentChatMessage,
  type ManualProjectChange,
  type PublicAgentStatus as RuntimePublicAgentStatus,
  type ResearchMode,
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
import { changeSnapshotName, versionDisplayName } from "./version-presentation";
import { scrubPersistedProviderSecrets } from "./provider-persistence";
import { normalizeRemovedCliAgentIds, reconcileRemovedCliSelections } from "@/lib/cli-subscription-preferences";
import {
  resolveExecutionCategory,
  resolveSavedLocalModelSelection,
  selectExecutionCategory,
  selectLocalModelPreset,
  type ExecutionCategory
} from "@/lib/execution-category";
import {
  applyGatewayPreset,
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
  fetchStoredVdtRevisionState,
  loadStoredVdt,
  revisionCasFromHead,
  runtimeCasFromState,
  saveStoredVdtRevision,
  updateStoredProject,
  updateStoredVdt,
  VdtStorageRequestError,
  type CreateStoredVdtInput,
  type SaveStoredVdtRevisionInput,
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

export type GenerateActivityStatus = "running" | "needs_user_input" | "recovery_required" | "ready" | "error" | "cancelled";
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
  vdtId?: string | undefined;
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
  pendingRevisionCommit?: PendingWorkspaceRevisionCommit | undefined;
  pendingVdtCreate?: PendingWorkspaceVdtCreate | undefined;
}

interface PendingWorkspaceRevisionCommit {
  vdtId: string;
  input: SaveStoredVdtRevisionInput;
  projectRevision: number;
}

interface PendingWorkspaceVdtCreate {
  projectId: string;
  input: CreateStoredVdtInput;
  projectRevision: number;
  localProjectAtStart: VdtProject;
}

export interface VdtStudioState {
  personalisation: InstructionPreferences;
  savePersonalisation: (preferences: InstructionPreferences) => boolean;
  project: VdtProject;
  workspace: VdtWorkspaceState;
  selectedNodeId: string;
  selectedEdgeId?: string | undefined;
  selectedPanelTab: "properties" | "warnings";
  activeScenarioId: string;
  brief: BriefState;
  providerId: ProviderId;
  providerConfig: ProviderConfigState;
  executionSettings: ExecutionSettings;
  removedCliAgentIds: CliAgentId[];
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
  smartKpiMutation: SmartKpiMutationView;
  smartKpiBlockedReason?: string | undefined;
  smartKpiOperation?: SmartKpiOperation | undefined;
  smartKpiUndo?: SmartKpiUndo | undefined;
  smartKpiRebaseRequired?: SmartKpiRebase | undefined;
  smartKpiConflictOperation?: SmartKpiOperation | undefined;
  smartKpiFencedRunIds: string[];
  pendingIncomingKpiRestart?: { runId: string; workspaceId: string; vdtId: string | null; terminalCleanupConfirmed?: true } | undefined;
  buildIncomingKpiContext: SmartKpiIncomingActions["buildIncomingKpiContext"];
  previewIncomingKpiBatch: SmartKpiIncomingActions["previewIncomingKpiBatch"];
  applySmartKpiSuggestion: (input: SmartKpiApplyInput) => Promise<SmartKpiApplyResult>;
  undoSmartKpiSuggestion: () => Promise<boolean>;
  reconcilePendingSmartKpiCommit: () => Promise<boolean>;
  aiError?: string | undefined;
  pendingChangeSet?: VdtChangeSet | undefined;
  pendingFileImport?: { changeSetId: string; context: FileImportTargetContext } | undefined;
  changeSetSelection: Set<string>;
  highlightedNodeIds: string[];
  aiActionError?: string | undefined;
  versionRestoreUndo?: {
    checkpointVersionId: string;
    restoredVersionName: string;
    restoredProject: VdtProject;
    activeVdtId?: string | undefined;
    previousScenarioId: string;
    previousNodeId: string;
  } | undefined;
  setBriefField: <K extends keyof BriefState>(field: K, value: BriefState[K]) => void;
  setProviderId: (providerId: ProviderId) => void;
  setProviderConfigField: <K extends keyof ProviderConfigState>(
    field: K,
    value: ProviderConfigState[K]
  ) => void;
  setExecutionMode: (executionMode: ExecutionMode) => void;
  setExecutionCategory: (category: ExecutionCategory) => void;
  setExecutionSettingsField: <K extends keyof ExecutionSettings>(
    field: K,
    value: ExecutionSettings[K]
  ) => void;
  restoreApiKeyFromVault: (scope: string, value: string) => void;
  setSelectedCliAgentId: (agentId: CliAgentId) => void;
  removeCliAgent: (agentId: CliAgentId) => void;
  restoreCliAgent: (agentId: CliAgentId) => void;
  setLocalRunnerPreset: (presetId: LocalRunnerPresetId) => void;
  setByokProtocol: (protocol: ByokProtocol) => void;
  setByokGateway: (gateway: ByokGateway) => void;
  setGatewayPreset: (presetId: GatewayPresetId) => void;
  setMemoryModelMode: (mode: MemoryModelMode, cliAgentId?: CliAgentId) => void;
  setCliModelSelection: (selection: CliModelSelection) => void;
  setCliModelForAgent: (agentId: CliAgentId, selection: CliModelSelection) => void;
  rescanClis: (agentId?: CliAgentId, options?: { fresh?: boolean; testRevision?: number }) => Promise<void>;
  clearCliTestStatus: (agentId: CliAgentId) => void;
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
  createWorkspaceProject: (name?: string, details?: Partial<ProjectCardMetadata>) => Promise<boolean>;
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
  selectWorkspaceVdt: (vdtId: string, options?: { expectedProjectId?: string | undefined }) => Promise<boolean>;
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
      researchMode?: ResearchMode | undefined;
      executionBindingId?: string | undefined;
    }
  ) => Promise<boolean>;
  resumePersistedAgentRun: () => Promise<void>;
  connectAgentEvents: (runId: string) => void;
  sendAgentAnswers: (answers: Record<string, string | number | string[]> | RuntimeAgentAnswerPayload[]) => Promise<void>;
  continueAgentRun: () => Promise<void>;
  sendAgentApproval: (
    approved: boolean,
    selectedChangeIds?: string[] | undefined,
    proposalId?: string | undefined
  ) => Promise<void>;
  sendAgentInstruction: (text: string, selectedNodeId?: string, researchMode?: ResearchMode) => Promise<boolean>;
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
  deleteNode: (nodeId: string) => void;
  createScenario: () => void;
  setActiveScenarioId: (scenarioId: string) => void;
  setMainScenario: (scenarioId: string) => void;
  renameScenario: (scenarioId: string, name: string) => void;
  deleteScenario: (scenarioId: string) => void;
  cloneScenario: (scenarioId: string) => void;
  updateScenarioOverride: (scenarioId: string, nodeId: string, value?: number) => void;
  updateScenarioComment: (scenarioId: string, nodeId: string, text: string) => void;
  stageDataDiscoveryChangeSet: (changeSet: VdtChangeSet, context?: FileImportTargetContext) => boolean;
  toggleChangeSelection: (changeId: string) => void;
  applyPendingChangeSet: () => void;
  discardPendingChangeSet: () => void;
  saveVersionSnapshot: (name: string) => string | undefined;
  renameVersionSnapshot: (versionId: string, name: string) => void;
  restoreVersionSnapshot: (versionId: string) => boolean;
  undoVersionRestore: () => boolean;
}

export function canUndoVersionRestore(state: Pick<VdtStudioState, "project" | "workspace" | "versionRestoreUndo">): boolean {
  const undo = state.versionRestoreUndo;
  return Boolean(undo && state.workspace.activeVdtId === undo.activeVdtId &&
    state.project.id === undo.restoredProject.id && state.project.rootNodeId === undo.restoredProject.rootNodeId &&
    state.project.graph === undo.restoredProject.graph && state.project.scenarios === undo.restoredProject.scenarios &&
    state.project.dataSources === undo.restoredProject.dataSources && state.project.aiReview === undo.restoredProject.aiReview &&
    state.project.versions.some((version) => version.id === undo.checkpointVersionId));
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

function replaceVdtCommitState(
  summaries: StoredProjectSummary[],
  input: {
    vdt: StoredVdtRecord;
    head: StoredProjectSummary["vdts"][number]["head"];
    runtimeState: StoredProjectSummary["runtimeState"];
  }
): StoredProjectSummary[] {
  return summaries.map((summary) => {
    if (summary.project.id !== input.vdt.projectId) return summary;
    return {
      ...summary,
      runtimeState: input.runtimeState,
      vdts: summary.vdts.map((entry) => (
        entry.vdt.id === input.vdt.id
          ? { ...entry, head: input.head }
          : entry
      ))
    };
  });
}

function shouldRetainPendingStorageOperation(error: unknown): boolean {
  return !(error instanceof VdtStorageRequestError) || error.retryable;
}

function isRevisionStateConflict(error: unknown): error is VdtStorageRequestError {
  return error instanceof VdtStorageRequestError && (
    error.code === "REVISION_CONFLICT" ||
    error.code === "PROJECT_WRITE_STATE_CHANGED" ||
    error.code === "IDEMPOTENCY_KEY_REUSE"
  );
}

function workspaceStorageError(error: unknown, fallback: string): string {
  if (isRevisionStateConflict(error)) {
    return "This VDT changed on the server. Your local edits are still open; reload or rebase before saving again.";
  }
  return error instanceof Error ? error.message : fallback;
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

export function shouldContinueOpenVdt(state: Pick<VdtStudioState, "project" | "workspace">): boolean {
  return Boolean(
    state.workspace.activeVdtId &&
    state.project.graph.nodes.length > 0
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
  state: Pick<VdtStudioState, "project" | "brief" | "workspace">
): NonNullable<VdtAgentStartRequest["workspace"]> {
  const rootNode = state.project.graph.nodes.find((node) => node.id === state.project.rootNodeId);
  const projectName = state.project.name.trim() || rootNode?.name?.trim() || state.brief.rootKpi.trim() || "VDT Studio workspace";
  const industry = state.project.industry?.trim() || state.brief.industry?.trim();
  const description = state.project.description?.trim() || state.brief.goal?.trim();
  const graphProjectId = safeWorkspaceProjectId(state.project.id || state.project.rootNodeId || projectName);
  const activeProjectId = state.workspace.activeProjectId?.trim();
  const chosenProjectId = activeProjectId || graphProjectId;
  const vdtId = activeProjectId ? state.workspace.activeVdtId : undefined;
  return {
    projectId: chosenProjectId,
    projectName,
    ...(vdtId ? { vdtId } : {}),
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
    ...changeSet.edgeChanges.map((entry) => entry.id),
    ...(changeSet.dataSourceChanges ?? []).map((entry) => entry.id),
    ...(changeSet.dataMappingChanges ?? []).map((entry) => entry.id),
    ...(changeSet.taxonomyChanges ?? []).map((entry) => entry.id)
  ]);
}

function computeHighlightedNodeIds(project: VdtProject, changeSet: VdtChangeSet): string[] {
  const diff = diffChangeSet(project, changeSet);
  return [...diff.addedNodeIds, ...diff.updatedNodeIds, ...diff.removedNodeIds];
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
    pendingFileImport: undefined,
    changeSetSelection: new Set<string>(),
    highlightedNodeIds: [] as string[],
    aiActionError: undefined
  };
}

function clearPendingFileImportState(state: Pick<VdtStudioState, "pendingFileImport" | "pendingChangeSet">) {
  return state.pendingFileImport?.changeSetId === state.pendingChangeSet?.id && state.pendingFileImport
    ? clearPendingAiActionState()
    : { pendingFileImport: undefined };
}

let activeAgentEventUnsubscribe: (() => void) | undefined;
const incomingKpiRestarts = new Set<string>();
function incomingRestartScope(state: VdtStudioState) {
  return { workspaceId: state.workspace.activeProjectId ?? state.project.id, vdtId: state.workspace.activeVdtId ?? null };
}
function pendingIncomingRestartHere(state: VdtStudioState): boolean {
  const scope = incomingRestartScope(state), pending = state.pendingIncomingKpiRestart;
  return Boolean(pending && pending.workspaceId === scope.workspaceId && pending.vdtId === scope.vdtId);
}
function incomingRestartStamp(state: VdtStudioState): string {
  const scope = incomingRestartScope(state), owner = state.workspace.projectSummaries.find(row => row.project.id === scope.workspaceId);
  const entry = owner?.vdts.find(row => row.vdt.id === scope.vdtId);
  if (scope.vdtId && (!owner || !entry)) throw new Error("Reload this VDT before starting its incoming layer.");
  return kpiCanonicalJson({ ...scope, project: state.project,
    configuration: persistedExecutionSettings(state.executionSettings), head: entry ? revisionCasFromHead(entry.head) : null,
    runtime: owner ? runtimeCasFromState(owner.runtimeState) : null });
}
function incomingStopPersisted(marker: NonNullable<VdtStudioState["pendingIncomingKpiRestart"]>): boolean {
  try { return kpiCanonicalJson(JSON.parse(globalThis.localStorage.getItem("vdt-studio-state") ?? "null")?.state?.pendingIncomingKpiRestart) === kpiCanonicalJson(marker); }
  catch { return false; }
}

let cliScanInFlight: { agentId: CliAgentId | undefined; promise: Promise<void> } | undefined;
const cliVerificationRevisionByAgent: Partial<Record<CliAgentId, number>> = {};

function invalidateCliVerification(agentId: CliAgentId) {
  const revision = (cliVerificationRevisionByAgent[agentId] ?? 0) + 1;
  cliVerificationRevisionByAgent[agentId] = revision;
  return revision;
}

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

  if (resolveExecutionCategory(executionSettings) === "cli_subscriptions" && executionSettings.selectedCliAgentId) {
    return {
      backendId,
      backendLabel: getCliCatalogEntry(executionSettings.selectedCliAgentId).displayName
    };
  }
  if (resolveExecutionCategory(executionSettings) === "local_models") {
    return { backendId, backendLabel: formatExecutionModeSummary(executionSettings).primary };
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
    return backendId?.endsWith("_subscription") ? Math.max(timeoutMs, AGENT_DECISION_TIMEOUT_FLOOR_MS) : timeoutMs;
  }

  const timeoutSec = providerConfig?.timeoutSec;
  if (typeof timeoutSec === "number" && Number.isSafeInteger(timeoutSec) && timeoutSec > 0) {
    const value = timeoutSec * 1000;
    return backendId?.endsWith("_subscription") ? Math.max(value, AGENT_DECISION_TIMEOUT_FLOOR_MS) : value;
  }

  return backendId?.endsWith("_subscription") ? AGENT_DECISION_TIMEOUT_FLOOR_MS : undefined;
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
    status: snapshot.status === "queued" || snapshot.status === "waiting_approval"
      ? "running"
      : snapshot.status,
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
    case "node_decomposition_requested":
    case "plan_proposed":
    case "tool_call_started":
    case "tool_call_completed":
    case "manual_change_observed":
    case "repair_started":
    case "run_completed":
      return type === "plan_proposed" || type === "node_decomposition_requested"
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
    (event.type === "mutation_proposed" && event.metadata?.approvalRequired === true) ||
    event.type === "mutation_applied" ||
    event.type === "mutation_rejected" ||
    event.type === "final_report" ||
    event.type === "error" ||
    event.type === "run_completed";
}

function mapRuntimeStatus(snapshot: RuntimeAgentRunSnapshot): GenerateActivityStatus {
  if (snapshot.status === "needs_user_input") return "needs_user_input";
  if (snapshot.status === "recovery_required") return "recovery_required";
  if (snapshot.status === "succeeded") return "ready";
  if (snapshot.status === "failed") return "error";
  if (snapshot.status === "cancelled") return "cancelled";
  return "running";
}

function isCancellableActivityStatus(status: GenerateActivityStatus | undefined): boolean {
  return status === "running" || status === "needs_user_input" || status === "recovery_required";
}

function isActiveActivity(activity: GenerateActivityState | undefined): boolean {
  return isCancellableActivityStatus(activity?.status);
}

function isActiveRuntimeRun(snapshot: RuntimeAgentRunSnapshot | undefined): boolean {
  return snapshot?.status === "queued" || snapshot?.status === "running" ||
    snapshot?.status === "needs_user_input" || snapshot?.status === "waiting_approval" ||
    snapshot?.status === "recovery_required";
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

export function vdtIdForAgentActivity(
  activity: GenerateActivityState | undefined,
  activeVdtId?: string | undefined
): string | undefined {
  if (!activity) return undefined;
  const agentRunRequest = activity.agentRun?.request as { workspace?: { vdtId?: string } } | undefined;
  return activity.runtimeAgentRun?.request.workspace?.vdtId
    ?? agentRunRequest?.workspace?.vdtId
    ?? activeVdtId;
}

export function filterAgentChatHistoryForVdt(
  history: AgentChatHistoryEntry[],
  activeVdtId: string | undefined
): AgentChatHistoryEntry[] {
  if (!activeVdtId) return [];
  return history.filter((entry) => entry.vdtId === activeVdtId);
}

export function purgeAgentChatHistoryForVdt(
  history: AgentChatHistoryEntry[],
  vdtId: string
): AgentChatHistoryEntry[] {
  return history.filter((entry) => entry.vdtId !== vdtId);
}

function historyEntryFromActivity(
  activity: GenerateActivityState,
  activeVdtId?: string | undefined
): AgentChatHistoryEntry {
  const messageCount = activity.agentChatMessages?.length ??
    activity.runtimeAgentRun?.chatMessages?.length ??
    activity.agentRun?.events.length ??
    0;
  return {
    runId: activity.runId,
    vdtId: vdtIdForAgentActivity(activity, activeVdtId),
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
  activity: GenerateActivityState | undefined,
  activeVdtId?: string | undefined
): AgentChatHistoryEntry[] {
  if (!activity) return history;
  const next = historyEntryFromActivity(activity, activeVdtId);
  const withoutDuplicate = history.filter((entry) => entry.runId !== next.runId);
  const sameScope = [next, ...withoutDuplicate.filter((entry) => entry.vdtId === next.vdtId)]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, MAX_AGENT_CHAT_HISTORY);
  const otherScopes = withoutDuplicate.filter((entry) => entry.vdtId !== next.vdtId);
  return [...sameScope, ...otherScopes]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

function agentStateBelongsToVdt(state: VdtStudioState, vdtId: string): boolean {
  const activityVdtId = vdtIdForAgentActivity(state.generateActivity, state.workspace.activeVdtId);
  if (activityVdtId === vdtId) return true;
  const runId = state.activeAgentRunId ?? state.agentRun?.runId ?? state.generateActivity?.runId;
  if (!runId) return false;
  const entry = state.agentChatHistory.find((candidate) => candidate.runId === runId);
  return entry?.vdtId === vdtId;
}

function clearAgentStateForDeletedVdt(state: VdtStudioState, vdtId: string): Partial<VdtStudioState> {
  if (!agentStateBelongsToVdt(state, vdtId)) return {};
  const runId = state.activeAgentRunId ?? state.agentRun?.runId ?? state.generateActivity?.runId;
  return {
    ...(runId ? clearPersistedAgentRunState(state, runId) : {}),
    generateActivity: undefined,
    activeAgentRunId: undefined,
    agentRun: undefined,
    agentEvents: [],
    agentPendingQuestions: undefined,
    isGenerating: false,
    agentConnectionStatus: "disconnected",
    agentError: undefined,
    aiError: undefined
  };
}

function resumableAgentRunId(state: Pick<VdtStudioState, "activeAgentRunId" | "agentRun" | "generateActivity">): string | undefined {
  return state.activeAgentRunId ?? state.agentRun?.runId ?? state.generateActivity?.runId;
}

function isAgentRunNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("not found") || message.includes("could not be loaded") || message.includes("could not be reattached");
}

function clearPersistedAgentRunState(
  state: VdtStudioState,
  runId: string
): Partial<VdtStudioState> {
  const touchesRun =
    state.activeAgentRunId === runId ||
    state.agentRun?.runId === runId ||
    state.generateActivity?.runId === runId;
  if (!touchesRun) return {};
  return {
    activeAgentRunId: undefined,
    agentRun: state.agentRun?.runId === runId ? undefined : state.agentRun,
    generateActivity: state.generateActivity?.runId === runId ? undefined : state.generateActivity,
    agentEvents: state.agentRun?.runId === runId ? [] : state.agentEvents,
    agentPendingQuestions: state.agentRun?.runId === runId ? undefined : state.agentPendingQuestions,
    isGenerating: false,
    agentConnectionStatus: "disconnected",
    agentError: undefined,
    aiError: undefined
  };
}

function applyAgentSnapshot(
  set: (partial: Partial<VdtStudioState> | ((state: VdtStudioState) => Partial<VdtStudioState>)) => void,
  snapshot: RuntimeAgentRunSnapshot,
  preserveCurrentProject = false,
  allowIncomingStopSnapshot = false
) {
  set((state) => {
    if (state.smartKpiOperation || state.smartKpiFencedRunIds.includes(snapshot.runId)) return {};
    if (!allowIncomingStopSnapshot && state.pendingIncomingKpiRestart?.runId === snapshot.runId) return {};
    if (state.activeAgentRunId && state.activeAgentRunId !== snapshot.runId) {
      return {};
    }
    const rawProject = preserveCurrentProject ? undefined : snapshot.project ?? snapshot.draftProject;
    const shouldPreserveProjectId = Boolean(
      state.project?.id &&
      state.workspace.activeVdtId &&
      (
        snapshot.request.mode === "continue_project" ||
        snapshot.request.mode === "deepen_node" ||
        snapshot.request.mode === "review_project" ||
        snapshot.request.workspace?.vdtId === state.workspace.activeVdtId
      )
    );
    const project = rawProject
      ? ensureScenario(
          shouldPreserveProjectId
            ? { ...rawProject, id: state.project.id }
            : rawProject
        )
      : undefined;
    const preservedSelectedNodeId = project && state.selectedNodeId
      && project.graph.nodes.some((node) => node.id === state.selectedNodeId)
      ? state.selectedNodeId
      : undefined;
    const status = mapRuntimeStatus(snapshot);
    const terminal = status === "ready" || status === "error" || status === "cancelled";
    const pendingQuestions = terminal ? undefined : snapshot.pendingQuestions;
    const now = nowIso();
    const requestProviderId = (
      snapshot.executionSummary?.backendId
      ?? snapshot.request.providerId
      ?? state.providerId
    ) as ProviderId;
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
    const errorMessage = snapshot.error?.message;
    let publicStatus = snapshot.publicStatus;
    if (status === "error") {
      const resolvedErrorMessage = errorMessage ?? "Agent run failed.";
      const hasUsefulErrorStatus = publicStatus?.phase === "retryable_error" && Boolean(publicStatus.message?.trim());
      if (!hasUsefulErrorStatus) {
        publicStatus = {
          phase: "retryable_error",
          message: resolvedErrorMessage,
          updatedAt: snapshot.updatedAt ?? now
        };
      }
    }
    const nextActivity: GenerateActivityState = {
      ...activity,
      status,
      phase: status === "ready" ? "ready" : activity.phase,
      canCancel: !activity.cancelRequested && isCancellableActivityStatus(status),
      cancelRequested: terminal ? false : activity.cancelRequested,
      agentRun: legacyRun,
      runtimeAgentRun: snapshot,
      selectedSkills: legacyRun.selectedSkills,
      agentEvents: legacyRun.events,
      agentChatMessages: snapshot.chatMessages,
      publicStatus,
      retryableError: snapshot.retryableError,
      agentQuestions: pendingQuestions,
      questionsForUser: pendingQuestions?.map((question) => question.question),
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
      agentPendingQuestions: pendingQuestions,
      agentError: snapshot.error?.message,
      isGenerating: status === "running" || status === "needs_user_input",
      generateActivity: nextActivity,
      agentChatHistory: upsertAgentChatHistory(state.agentChatHistory, nextActivity, state.workspace.activeVdtId)
    };
  });
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
    // executionSettings owns the current key, including an explicit removal.
    // A legacy provider config must never resurrect a cleared credential.
    providerConfig: { ...synced.providerConfig, apiKey: executionSettings.apiKey } as ProviderConfigState,
    providerTestStatus: undefined
  };
}

let workspaceRefreshGeneration = 0;
let workspaceRefreshController: AbortController | undefined;

export const useVdtStudioStore = create<VdtStudioState>()(
  persist(
    (set, get) => guardSmartKpiActions({
      project: buildInitialProject(),
      personalisation: normalizeInstructionPreferences(undefined),
      savePersonalisation: (preferences) => {
        if (!validInstructionPreferences(preferences)) return false;
        try {
          const next = normalizeInstructionPreferences(preferences);
          set({ personalisation: next });
          const saved = studioStateStorage.getItem("vdt-studio-state");
          if (typeof saved !== "string") return false;
          const retained = JSON.parse(saved)?.state?.personalisation;
          return kpiCanonicalJson(retained ?? null) === kpiCanonicalJson(next);
        }
        catch { return false; }
      },
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
      removedCliAgentIds: [],
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
      smartKpiMutation: { status: "idle", canUndo: false },
      smartKpiFencedRunIds: [],
      ...createSmartKpiActions(set, get, layoutProjectGraph),
      changeSetSelection: new Set<string>(),
      highlightedNodeIds: [],
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
        const generation = ++workspaceRefreshGeneration;
        const initialProjectId = get().workspace.activeProjectId;
        workspaceRefreshController?.abort();
        const controller = new AbortController();
        workspaceRefreshController = controller;
        const isCurrent = () => generation === workspaceRefreshGeneration && (
          get().workspace.activeProjectId === initialProjectId || get().workspace.activeProjectId === scopedProjectId
        );
        set((state) => ({
          workspace: {
            ...state.workspace,
            isLoading: true,
            error: undefined
          }
        }));
        try {
          const summary = await fetchStoredProjectExplorerSummary(controller.signal, scopedProjectId);
          if (!isCurrent()) return;
          set((state) => {
            const projectSummaries = scopedProjectId
              ? summary.projects.reduce(upsertProjectSummary, state.workspace.projectSummaries)
              : summary.projects;
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
          if (!isCurrent()) return;
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
          ...clearPendingFileImportState(state),
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
          ...clearPendingFileImportState(state),
          workspace: {
            ...state.workspace,
            activeVdtId: undefined,
            activePanel: "project",
            error: undefined
          }
        })),
      setWorkspacePanel: (panel) =>
        set((state) => ({
          ...(panel === "project" ? clearPendingFileImportState(state) : {}),
          workspace: {
            ...state.workspace,
            activePanel: panel === "vdt" && !hasActiveWorkspaceVdt(state.workspace) ? "project" : panel,
            error: panel === "vdt" && !hasActiveWorkspaceVdt(state.workspace)
              ? "Create or open a saved VDT before switching to VDT management."
              : state.workspace.error
          }
        })),
      createWorkspaceProject: async (name, details) => {
        const projectName = name?.trim() || "New project";
        if (hasActiveWorkspaceVdt(get().workspace) && !(await get().saveActiveWorkspaceVdt())) {
          return false;
        }
        const state = get();
        set((current) => ({
          workspace: {
            ...current.workspace,
            isMutating: true,
            error: undefined
          }
        }));
        try {
          const metadata: Record<string, string> = {};
          for (const key of ["clientName", "siteName", "year"] as const) {
            const value = details?.[key]?.trim();
            if (value) metadata[key] = value;
          }
          const summary = await createStoredProject({
            name: projectName,
            industry: state.project.industry ?? state.brief.industry,
            ...(details ? { metadata } : {})
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
        const workspaceBeforeSave = get().workspace;
        const pendingBeforeSave =
          workspaceBeforeSave.pendingVdtCreate?.projectId === workspaceBeforeSave.activeProjectId
            ? workspaceBeforeSave.pendingVdtCreate
            : undefined;
        if (
          !pendingBeforeSave &&
          hasActiveWorkspaceVdt(workspaceBeforeSave) &&
          !(await get().saveActiveWorkspaceVdt())
        ) {
          return false;
        }
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
        const pendingCreate = state.workspace.pendingVdtCreate?.projectId === activeProjectId
          ? state.workspace.pendingVdtCreate
          : undefined;
        const activeSummary = summaryForProject(state.workspace.projectSummaries, activeProjectId);
        if (!pendingCreate && !activeSummary?.runtimeState) {
          set((current) => ({
            workspace: {
              ...current.workspace,
              error: "Project runtime state is unavailable. Refresh the workspace before creating a VDT."
            }
          }));
          return false;
        }
        const hasExplicitBrief = Boolean(params.rootKpi?.trim());
        const snapshot = pendingCreate?.input.project ?? (
          hasActiveWorkspaceVdt(state.workspace) && !hasExplicitBrief
            ? projectSnapshotForVdt(state.project, vdtName)
            : buildDraftVdtProject({
                name: vdtName,
                rootKpi: rootKpi || vdtName,
                ...(params.unit ? { unit: params.unit } : {}),
                ...(params.timePeriod ? { timePeriod: params.timePeriod } : {}),
                ...(activeSummary?.project.industry ? { industry: activeSummary.project.industry } : {})
              })
        );
        const rootNode = rootNodeForProject(snapshot);
        const createOperation: PendingWorkspaceVdtCreate = pendingCreate ?? {
          projectId: activeProjectId,
          projectRevision: state.projectRevision,
          localProjectAtStart: cloneProject(state.project),
          input: {
            idempotencyKey: `create-vdt:${activeProjectId}:${generateRunId()}`,
            expectedRuntime: runtimeCasFromState(activeSummary!.runtimeState),
            name: vdtName,
            rootKpi: rootNode?.name ?? vdtName,
            unit: rootNode?.unit,
            timePeriod: rootNode?.assumptions
              ?.find((assumption) => assumption.startsWith("Time period: "))
              ?.replace("Time period: ", ""),
            project: snapshot
          }
        };
        set((current) => ({
          workspace: {
            ...current.workspace,
            isMutating: true,
            error: undefined,
            pendingVdtCreate: createOperation
          }
        }));
        try {
          const created = await createStoredVdt(activeProjectId, createOperation.input);
          let localProjectChanged = false;
          set((current) => {
            localProjectChanged =
              current.projectRevision !== createOperation.projectRevision ||
              JSON.stringify(current.project) !== JSON.stringify(createOperation.localProjectAtStart);
            if (localProjectChanged) {
              return {
                workspace: {
                  ...current.workspace,
                  projectSummaries: upsertProjectSummary(current.workspace.projectSummaries, created.summary),
                  isMutating: false,
                  error: "The VDT was created from the submitted snapshot, but newer local edits remain open and unsaved.",
                  pendingVdtCreate: undefined
                }
              };
            }
            const visibleProject = createOperation.input.project;
            return {
              project: visibleProject,
              selectedNodeId: visibleProject.rootNodeId,
              activeScenarioId: resolveMainScenarioId(visibleProject),
              brief: briefFromProject(visibleProject),
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
                lastSavedAt: nowIso(),
                pendingVdtCreate: undefined
              },
              ...clearPendingAiActionState()
            };
          });
          return !localProjectChanged;
        } catch (error) {
          const retainPending = shouldRetainPendingStorageOperation(error);
          set((current) => ({
            workspace: {
              ...current.workspace,
              isMutating: false,
              error: workspaceStorageError(error, "VDT could not be created."),
              pendingVdtCreate: retainPending ? createOperation : undefined
            }
          }));
          return false;
        }
      },
      selectWorkspaceProject: async (projectId) => {
        if (hasActiveWorkspaceVdt(get().workspace) && !(await get().saveActiveWorkspaceVdt())) {
          return false;
        }
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
          ...clearPendingFileImportState(state),
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
      selectWorkspaceVdt: async (vdtId, options) => {
        const rebaseRequired = hasSmartKpiRebase(get());
        if (get().workspace.activeVdtId === vdtId && !rebaseRequired) {
          if (options?.expectedProjectId && get().workspace.activeProjectId !== options.expectedProjectId) {
            set((state) => ({
              workspace: {
                ...state.workspace,
                error: "Selected VDT does not belong to this project."
              }
            }));
            return false;
          }
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
          if (!rebaseRequired && hasActiveWorkspaceVdt(get().workspace) && !(await get().saveActiveWorkspaceVdt())) {
            set((state) => ({
              workspace: {
                ...state.workspace,
                isLoading: false
              }
            }));
            return false;
          }
          const loaded = await loadStoredVdt(vdtId);
          if (!loaded.activeProject) {
            throw new Error("Selected VDT does not have a saved revision yet.");
          }
          if (options?.expectedProjectId && loaded.summary.project.id !== options.expectedProjectId) {
            throw new Error("Selected VDT does not belong to this project.");
          }
          const project = ensureScenario(loaded.activeProject);
          set((state) => ({
            project,
            ...(state.smartKpiRebaseRequired?.workspaceId === loaded.summary.project.id && state.smartKpiRebaseRequired.vdtId === loaded.vdt.id
              ? { smartKpiRebaseRequired: undefined, smartKpiOperation: undefined, smartKpiMutation: { status: "idle" as const, canUndo: false } } : {}),
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
            agentChatHistory: purgeAgentChatHistoryForVdt(state.agentChatHistory, vdtId),
            ...clearAgentStateForDeletedVdt(state, vdtId),
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
        if (hasSmartKpiRebase(state)) {
          set(current => ({ workspace: { ...current.workspace, error: "The draft predates a storage conflict. Reload the stored VDT before saving; automatic overwrite is blocked." } }));
          return false;
        }
        const activeVdtId = state.workspace.activeVdtId;
        if (!activeVdtId) return false;
        const owningSummary = summaryContainingVdt(state.workspace.projectSummaries, activeVdtId);
        const activeEntry = owningSummary?.vdts.find((entry) => entry.vdt.id === activeVdtId);
        if (!owningSummary?.runtimeState || !activeEntry?.head) {
          set((current) => ({
            workspace: {
              ...current.workspace,
              error: "VDT revision state is unavailable. Refresh the workspace before saving."
            }
          }));
          return false;
        }
        const existingOperation = state.workspace.pendingRevisionCommit?.vdtId === activeVdtId
          ? state.workspace.pendingRevisionCommit
          : undefined;
        const operation: PendingWorkspaceRevisionCommit = existingOperation ?? {
          vdtId: activeVdtId,
          projectRevision: state.projectRevision,
          input: {
            idempotencyKey: `manual-save:${activeVdtId}:${generateRunId()}`,
            expectedHead: revisionCasFromHead(activeEntry.head),
            expectedRuntime: runtimeCasFromState(owningSummary.runtimeState),
            project: cloneProject(state.project),
            summary: "Manual workspace save"
          }
        };
        set((current) => ({
          workspace: {
            ...current.workspace,
            isMutating: true,
            error: undefined,
            pendingRevisionCommit: operation
          }
        }));
        try {
          const saved = await saveStoredVdtRevision(activeVdtId, operation.input);
          let localProjectChanged = false;
          set((current) => {
            localProjectChanged =
              current.projectRevision !== operation.projectRevision ||
              JSON.stringify(current.project) !== JSON.stringify(operation.input.project);
            return {
              workspace: {
                ...current.workspace,
                projectSummaries: upsertProjectSummary(current.workspace.projectSummaries, saved.summary),
                isMutating: false,
                error: localProjectChanged
                  ? "The submitted snapshot was saved, but newer local edits are still unsaved."
                  : undefined,
                lastSavedAt: localProjectChanged ? current.workspace.lastSavedAt : nowIso(),
                pendingRevisionCommit: undefined
              }
            };
          });
          return !localProjectChanged;
        } catch (error) {
          let refreshedState:
            | Awaited<ReturnType<typeof fetchStoredVdtRevisionState>>
            | undefined;
          if (isRevisionStateConflict(error)) {
            refreshedState = await fetchStoredVdtRevisionState(activeVdtId).catch(() => undefined);
          }
          const retainPending = shouldRetainPendingStorageOperation(error);
          set((current) => ({
            workspace: {
              ...current.workspace,
              projectSummaries: refreshedState
                ? replaceVdtCommitState(current.workspace.projectSummaries, refreshedState)
                : current.workspace.projectSummaries,
              isMutating: false,
              error: workspaceStorageError(error, "VDT could not be saved."),
              pendingRevisionCommit: retainPending ? operation : undefined
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
      setExecutionCategory: (category) => set((state) => ({
        ...withSyncedLegacyProvider(
          selectExecutionCategory(state.executionSettings, category, state.cliDetectionAgents, state.removedCliAgentIds),
          state.providerConfig
        ),
        byokFieldErrors: undefined
      })),
      setExecutionSettingsField: (field, value) =>
        set((state) => ({
          ...withSyncedLegacyProvider(
            {
              ...state.executionSettings,
              [field]: value,
              ...(field === "localModel" && resolveExecutionCategory(state.executionSettings) === "local_models"
                ? { savedLocalModelSelection: { ...resolveSavedLocalModelSelection(state.executionSettings), model: value as string | undefined } }
                : {})
            },
            state.providerConfig
          ),
          byokFieldErrors: clearByokFieldError(state.byokFieldErrors, field)
        })),
      restoreApiKeyFromVault: (scope, value) => set(state => {
        // The mounted vault manager owns generation/deletion races. This narrow
        // hydration hook cannot change provider/destination or grant admission.
        if (apiKeyScope(state.executionSettings) !== scope) return {};
        return { ...withSyncedLegacyProvider({ ...state.executionSettings, apiKey: value }, state.providerConfig),
          byokFieldErrors: clearByokFieldError(state.byokFieldErrors, "apiKey") };
      }),
      setSelectedCliAgentId: (agentId) =>
        set((state) => {
          if (state.removedCliAgentIds.includes(agentId)) return {};
          const command = resolveCliCommandForAgent(agentId, state.cliDetectionAgents);
          const cliModelSelection =
            state.cliModelByAgent[agentId] ??
            (state.executionSettings.selectedCliAgentId === agentId ? state.executionSettings.cliModelSelection : undefined) ??
            { source: "agent_default" };

          return withSyncedLegacyProvider(
            {
              ...state.executionSettings,
              selectedCliAgentId: agentId,
              executionMode: "local_cli",
              localRunnerPresetId: "custom_cli_json",
              runnerProviderId: "cli_stub",
              command,
              cliModelSelection,
              savedLocalModelSelection: resolveSavedLocalModelSelection(state.executionSettings)
            },
            state.providerConfig
          );
        }),
      removeCliAgent: (agentId) =>
        set((state) => {
          if (state.removedCliAgentIds.includes(agentId)) return {};
          invalidateCliVerification(agentId);
          const removedCliAgentIds = [...state.removedCliAgentIds, agentId];
          const executionSettings = reconcileRemovedCliSelections(
            state.executionSettings, removedCliAgentIds, state.cliDetectionAgents, state.cliModelByAgent
          );
          return {
            ...withSyncedLegacyProvider(executionSettings, state.providerConfig),
            removedCliAgentIds,
            cliTestStatusByAgent: { ...state.cliTestStatusByAgent, [agentId]: undefined }
          };
        }),
      restoreCliAgent: (agentId) =>
        set((state) => {
          invalidateCliVerification(agentId);
          return {
            removedCliAgentIds: state.removedCliAgentIds.filter((id) => id !== agentId),
            cliDetectionAgents: state.cliDetectionAgents?.map((agent) => agent.id === agentId && agent.installed
              ? { ...agent, status: "installed" as const, authSummary: "Use Test to verify provider access." }
              : agent),
            cliTestStatusByAgent: { ...state.cliTestStatusByAgent, [agentId]: undefined }
          };
        }),
      setLocalRunnerPreset: (presetId) =>
        set((state) =>
          withSyncedLegacyProvider(
            presetId === "custom_cli_json"
              ? selectExecutionCategory(state.executionSettings, "cli_subscriptions", state.cliDetectionAgents, state.removedCliAgentIds)
              : selectLocalModelPreset(state.executionSettings, presetId),
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
            memoryModelMode: cliAgentId && state.removedCliAgentIds.includes(cliAgentId) ? "same_as_chat" : mode,
            memoryCliAgentId: mode === "selected_cli" && cliAgentId && !state.removedCliAgentIds.includes(cliAgentId) ? cliAgentId : undefined
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
            executionSettings,
            cliTestStatusByAgent: { ...state.cliTestStatusByAgent, [agentId]: undefined }
          };
        }),
      clearCliTestStatus: (agentId) => set((state) => ({
        cliTestStatusByAgent: { ...state.cliTestStatusByAgent, [agentId]: undefined }
      })),
      rescanClis: async (agentId, options = {}) => {
        const pendingScan = cliScanInFlight;
        if (pendingScan) {
          await pendingScan.promise;
          if (!options.fresh && pendingScan.agentId === agentId) return;
          return get().rescanClis(agentId, { ...options, fresh: false });
        }
        let finishScan!: () => void;
        const scan = { agentId, promise: new Promise<void>((resolve) => { finishScan = resolve; }) };
        cliScanInFlight = scan;
        const revisionsAtStart = { ...cliVerificationRevisionByAgent };
        set({
          isRescanningClis: true,
          rescanningCliId: agentId,
          cliDetectionError: undefined
        });

        try {
          const payload = await createAiExecutionClient().detectSubscriptionClis(agentId);

          set((state) => {
            const freshAgents = payload.agents.filter((agent) =>
              (revisionsAtStart[agent.id] ?? 0) === (cliVerificationRevisionByAgent[agent.id] ?? 0)
            ).map((agent) => {
              const verifiesCurrentTest = agent.id === agentId && options.testRevision !== undefined &&
                options.testRevision === cliVerificationRevisionByAgent[agent.id];
              return state.isTestingCliByAgent[agent.id] && !verifiesCurrentTest && agent.status === "ready"
                ? { ...agent, status: "installed" as const, authSummary: "Provider access is being verified." }
                : agent;
            });
            let cliDetectionAgents: CliAgentDetectionSnapshot[];

            if (!agentId) {
              const changedDuringScan = state.cliDetectionAgents?.filter((agent) =>
                (revisionsAtStart[agent.id] ?? 0) !== (cliVerificationRevisionByAgent[agent.id] ?? 0)
              ) ?? [];
              cliDetectionAgents = [...freshAgents, ...changedDuringScan];
            } else {
              const nextAgent = freshAgents.find((agent) => agent.id === agentId);
              if (!nextAgent) {
                const changedDuringScan = (revisionsAtStart[agentId] ?? 0) !== (cliVerificationRevisionByAgent[agentId] ?? 0);
                return {
                  ...(changedDuringScan ? {} : {
                    cliDetectionAgents: state.cliDetectionAgents?.map((agent) => agent.id === agentId
                      ? { ...agent, status: "unavailable" as const, authSummary: "The runtime did not return a verification result. Use Test to retry." }
                      : agent),
                    cliDetectionError: "The runtime did not return a verification result."
                  }),
                  isRescanningClis: false,
                  rescanningCliId: undefined
                };
              }

              cliDetectionAgents = mergeCliDetectionAgents(state.cliDetectionAgents, nextAgent, agentId);
            }

            const patchedExecutionSettings = resolveExecutionCategory(state.executionSettings) === "cli_subscriptions" ? patchSelectedCliCommandAfterRescan(
              state.executionSettings,
              cliDetectionAgents.filter((agent) => !state.removedCliAgentIds.includes(agent.id) &&
                (state.executionSettings.selectedCliAgentId || state.removedCliAgentIds.length === 0 ||
                  (agent.installed && agent.status === "ready"))),
              agentId
            ) : state.executionSettings;

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
          const message = error instanceof Error ? error.message : "CLI detection failed.";
          set((state) => ({
            cliDetectionAgents: agentId
              ? state.cliDetectionAgents?.map((agent) => agent.id === agentId &&
                  (revisionsAtStart[agentId] ?? 0) === (cliVerificationRevisionByAgent[agentId] ?? 0)
                ? { ...agent, status: "unavailable" as const, authSummary: "Provider access could not be verified. Use Test to retry.", error: message }
                : agent)
              : [],
            cliDetectionError: message,
            isRescanningClis: false,
            rescanningCliId: undefined
          }));
        } finally {
          if (cliScanInFlight === scan) cliScanInFlight = undefined;
          finishScan();
        }
      },
      testCli: async (agentId) => {
        const state = get();
        if (state.isTestingCliByAgent[agentId] || state.removedCliAgentIds.includes(agentId)) return;
        let testRevision = invalidateCliVerification(agentId);
        const catalog = getCliCatalogEntry(agentId);
        const timeoutSec = state.executionSettings.timeoutSec ?? 60;
        const modelSelection = state.cliModelByAgent[agentId] ??
          (state.executionSettings.selectedCliAgentId === agentId ? state.executionSettings.cliModelSelection : undefined);
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
          cliDetectionAgents: current.cliDetectionAgents?.map((agent) => agent.id === agentId && agent.installed
            ? { ...agent, status: "installed" as const, authSummary: "Provider access is being verified.", error: undefined }
            : agent),
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
          const result = await createAiExecutionClient().testBackend(String(resolved.providerConfig?.backendId ?? agentId), {
            providerId: resolved.providerId,
            providerConfig: {
              ...resolved.providerConfig,
              ...(needsPairing ? { pairingToken: state.runnerPairingToken } : {})
            }
          });
          if (cliVerificationRevisionByAgent[agentId] !== testRevision || get().removedCliAgentIds.includes(agentId)) return;
          if (!result.ok) throw new Error(`${catalog.displayName} did not confirm CLI access. Try again.`);
          await get().rescanClis(agentId, { fresh: true, testRevision });
          if (cliVerificationRevisionByAgent[agentId] !== testRevision || get().removedCliAgentIds.includes(agentId)) return;
          const verification = get();
          const detection = verification.cliDetectionAgents?.find((agent) => agent.id === agentId);
          nextStatus = verification.cliDetectionError
            ? { kind: "error", message: `CLI access could not be verified. ${verification.cliDetectionError} Retry Test.` }
            : !verification.isRescanningClis && detection?.installed && detection.status === "ready"
              ? { kind: "success", message: `${catalog.displayName}: CLI access verified. The provider reports an active session.` }
              : { kind: "info", message: "CLI access is not confirmed. Use Sign in if needed, then retry Test." };
        } catch (error) {
          const message = error instanceof Error ? error.message : "CLI test failed.";
          if (cliVerificationRevisionByAgent[agentId] === testRevision && !get().removedCliAgentIds.includes(agentId)) {
            testRevision = invalidateCliVerification(agentId);
            set((current) => ({
              cliDetectionAgents: current.cliDetectionAgents?.map((agent) => agent.id === agentId && agent.installed
                ? { ...agent, status: "error" as const, authSummary: "Provider access could not be verified. Reconnect with Sign in or retry Test.", error: message }
                : agent)
            }));
          }
          nextStatus = {
            kind: "error",
            message
          };
        } finally {
          const currentState = get();
          const currentModelSelection = currentState.cliModelByAgent[agentId] ??
            (currentState.executionSettings.selectedCliAgentId === agentId ? currentState.executionSettings.cliModelSelection : undefined);
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
              currentFingerprint === testFingerprint && cliVerificationRevisionByAgent[agentId] === testRevision &&
              !currentState.removedCliAgentIds.includes(agentId)
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
        if (get().smartKpiFencedRunIds.includes(runId)) return;
        activeAgentEventUnsubscribe?.();
        set({ agentConnectionStatus: "connecting" });
        activeAgentEventUnsubscribe = createAgentClient().subscribe(runId, {
          onOpen: () => set({ agentConnectionStatus: "connected" }),
          onEvent: (event) => {
            set((state) => {
              if (state.smartKpiOperation || state.smartKpiFencedRunIds.includes(runId)) return {};
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
                  if (isAgentRunNotFoundError(error)) {
                    set((current) => clearPersistedAgentRunState(current, runId));
                    return;
                  }
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
        if (state.smartKpiFencedRunIds.includes(runId)) return;
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
          if (isAgentRunNotFoundError(error)) {
            set((current) => clearPersistedAgentRunState(current, runId));
            return;
          }
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
          agentChatHistory: upsertAgentChatHistory(state.agentChatHistory, state.generateActivity, state.workspace.activeVdtId),
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
        if (entry.vdtId && entry.vdtId !== state.workspace.activeVdtId) {
          return false;
        }
        const snapshot = entry.activity.runtimeAgentRun;
        const detached = state.smartKpiFencedRunIds.includes(runId);
        const active = !detached && isActiveRuntimeRun(snapshot);
        activeAgentEventUnsubscribe?.();
        activeAgentEventUnsubscribe = undefined;
        set((current) => ({
          agentChatHistory: upsertAgentChatHistory(current.agentChatHistory, current.generateActivity, current.workspace.activeVdtId),
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
        if (pendingIncomingRestartHere(get())) { set({ aiError: "Confirm the previous agent cleanup before starting another run." }); return false; }
        const state = get();
        const requestedExecutionBindingId = options?.executionBindingId?.trim();
        const { executionSettings, cliDetectionAgents, cliDetectionError, isRescanningClis } = state;
        const { providerId, providerConfig } = resolveExecutionSettings(state.executionSettings);
        if (!requestedExecutionBindingId) {
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
          const executionError = validateExecutionForGenerate(executionSettings, cliDetectionAgents, {
            isScanning: isRescanningClis,
            detectionError: cliDetectionError
          });
          if (executionError) {
            set({ aiError: executionError, generateActivity: undefined });
            return false;
          }
          if (providerId === "mock") {
            set({ aiError: "Configure a real provider before starting the agent.", generateActivity: undefined });
            return false;
          }
        }
        if (state.workspace.activeVdtId && !state.workspace.activeProjectId?.trim()) {
          const message = "This VDT is not linked to a workspace project. Open it from the project page and try again.";
          set({
            aiError: message,
            agentError: message,
            isGenerating: false,
            agentConnectionStatus: "error"
          });
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
          const shouldContinue = options?.includeCurrentProject ?? shouldContinueOpenVdt(state);
          const input: VdtAgentStartRequest["input"] = {
            ...state.brief,
            personalisation: workspacePersonalisation(state),
            ...(prompt ? { prompt } : {}),
            ...(options?.selectedNodeId ? { selectedNodeId: options.selectedNodeId } : {}),
            ...(shouldContinue ? { project: state.project } : {})
          };
          const workspace = buildAgentWorkspaceContext(state);
          const commonRequest = {
            mode: options?.mode ?? (shouldContinue ? "continue_project" : "generate_vdt"),
            input,
            workspace,
            options: {
              autoApplyPatches: true,
              continueWithAssumptions: false,
              maxSteps: 40,
              researchMode: options?.researchMode ?? "auto"
            }
          };
          const explicitBindingId = requestedExecutionBindingId ?? await prepareOpenAiAgentBinding(state.executionSettings, providerId, {...providerConfig,enableResearch:options?.researchMode==="on"});
          const bindings = await createAgentClient().getExecutionBindings();
          const startRequest = buildAgentPublicStartRequest(
            commonRequest,
            state.executionSettings,
            bindings,
            {
              explicitBindingId,
              providerId,
              providerConfig
            }
          );
          const response = await createAgentClient().startRun(startRequest);
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
      continueAgentRun: async () => {
        const runId = get().agentRun?.runId ?? get().activeAgentRunId ?? get().generateActivity?.runId;
        if (runId && get().smartKpiFencedRunIds.includes(runId)) {
          await get().startAgentRun(undefined, { mode: "continue_project", includeCurrentProject: true });
          return;
        }
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
          generateActivity: state.generateActivity?.runId === runId
            ? {
                ...state.generateActivity,
                status: "running",
                canCancel: true,
                cancelRequested: false,
                publicStatus: {
                  phase: "planning_model",
                  message: "Continuing from the saved VDT draft...",
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
          const snapshot = await createAgentClient().sendMessage(runId, { type: "continue_run" });
          applyAgentSnapshot(set, snapshot);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Agent run could not be continued.";
          set((state) => ({
            agentError: message,
            aiError: message,
            agentConnectionStatus: "error",
            generateActivity: state.generateActivity?.runId === runId
              ? {
                  ...state.generateActivity,
                  status: "needs_user_input",
                  canCancel: true,
                  message,
                  updatedAt: nowIso()
                }
              : state.generateActivity
          }));
        }
      },
      sendAgentApproval: async (approved, selectedChangeIds, proposalId) => {
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
            ...(proposalId ? { proposalId } : {}),
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
      sendAgentInstruction: async (text, selectedNodeId, researchMode) => {
        const trimmed = text.trim();
        if (!trimmed) return false;
        const previousRun = get().agentRun?.runId ?? get().generateActivity?.runId;
        if (previousRun && get().smartKpiFencedRunIds.includes(previousRun)) return get().startAgentRun(trimmed, {
          mode: "continue_project", includeCurrentProject: true, ...(selectedNodeId ? { selectedNodeId } : {}), ...(researchMode ? { researchMode } : {})
        });
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
            personalisation: workspacePersonalisation(get()),
            ...(selectedNodeId ? { selectedNodeId } : {}),
            ...(researchMode ? { researchMode } : {})
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
        const previousRun = state.agentRun?.runId ?? state.generateActivity?.runId;
        if (!pendingIncomingRestartHere(state) && previousRun && state.smartKpiFencedRunIds.includes(previousRun)) return get().startAgentRun(undefined, { mode: "deepen_node", selectedNodeId: nodeId, includeCurrentProject: true });
        const node = state.project.graph.nodes.find((candidate) => candidate.id === nodeId);
        if (!node) {
          const message = "Select an existing KPI before asking the agent to add incoming KPIs.";
          set({ aiError: message, agentError: message });
          return false;
        }

        set({ selectedNodeId: nodeId, aiError: undefined, agentError: undefined });
        const canContinueCurrentRun = isActiveRuntimeRun(state.agentRun) || isActiveActivity(state.generateActivity);
        if (pendingIncomingRestartHere(state) || canContinueCurrentRun && state.agentRun?.executionSummary?.executionProfile === "model_agent") {
          const scope = incomingRestartScope(state), previous = pendingIncomingRestartHere(state) ? state.pendingIncomingKpiRestart : undefined;
          const runId = previous?.runId ?? state.agentRun?.runId;
          if (!runId || incomingKpiRestarts.has(runId)) return false;
          const foreignStop = !previous ? state.pendingIncomingKpiRestart : undefined;
          if (foreignStop && !foreignStop.terminalCleanupConfirmed) {
            set({ aiError: "Finish stopping the previous agent in its original VDT, then retry.", agentError: "Finish stopping the previous agent in its original VDT, then retry." });
            return false;
          }
          if (state.activeAgentRunId && state.activeAgentRunId !== runId) return false;
          const ownsRestart = () => {
            const current = get(), currentScope = incomingRestartScope(current), marker = current.pendingIncomingKpiRestart;
            return currentScope.workspaceId === scope.workspaceId && currentScope.vdtId === scope.vdtId
              && marker?.runId === runId && marker.workspaceId === scope.workspaceId && marker.vdtId === scope.vdtId
              && (!current.activeAgentRunId || current.activeAgentRunId === runId);
          };
          incomingKpiRestarts.add(runId);
          try {
            const stamp = incomingRestartStamp(state), credential = state.executionSettings.apiKey;
            let marker = previous ?? { runId, ...scope };
            set(current => ({ pendingIncomingKpiRestart: marker, isGenerating: true,
              ...(foreignStop ? { smartKpiFencedRunIds: [...new Set([...current.smartKpiFencedRunIds, foreignStop.runId])].slice(-64) } : {}) }));
            if (!incomingStopPersisted(marker)) throw new Error("Browser storage could not retain the agent stop request. Nothing new was started.");
            const client = createAgentClient();
            if (!marker.terminalCleanupConfirmed) {
              await client.cancel(runId, { awaitTerminal: true });
              if (!ownsRestart()) return false;
              marker = { ...marker, terminalCleanupConfirmed: true };
              set({ pendingIncomingKpiRestart: marker });
              if (!incomingStopPersisted(marker)) throw new Error("Browser storage could not retain confirmed agent cleanup. Retry before starting another run.");
            }
            const snapshot = await client.getRun(runId);
            if (!ownsRestart()) return false;
            if (!["succeeded", "failed", "cancelled"].includes(snapshot.status)) throw new Error("Agent cleanup is not terminal. Finish the current run and retry.");
            if (snapshot.request.workspace && (snapshot.request.workspace.projectId !== scope.workspaceId || (snapshot.request.workspace.vdtId ?? null) !== scope.vdtId)) throw new Error("The stopped run belongs to another VDT. Reload this VDT before retrying.");
            if (incomingRestartStamp(get()) !== stamp || get().executionSettings.apiKey !== credential) throw new Error("The open graph or execution changed while stopping the agent. Retry from the current graph.");
            if (scope.vdtId) {
              const authority = await fetchStoredVdtRevisionState(scope.vdtId);
              if (!ownsRestart()) return false;
              const owner = get().workspace.projectSummaries.find(row => row.project.id === scope.workspaceId)!;
              const entry = owner.vdts.find(row => row.vdt.id === scope.vdtId)!;
              if (authority.vdt.projectId !== scope.workspaceId || kpiCanonicalJson(revisionCasFromHead(authority.head)) !== kpiCanonicalJson(revisionCasFromHead(entry.head))
                || kpiCanonicalJson(runtimeCasFromState(authority.runtimeState)) !== kpiCanonicalJson(runtimeCasFromState(owner.runtimeState))) throw new Error("The stored VDT changed. Reload it before starting the incoming layer.");
            }
            if (incomingRestartStamp(get()) !== stamp || get().executionSettings.apiKey !== credential) throw new Error("The open graph changed. Retry from the current graph.");
            const nextProject = previous?.terminalCleanupConfirmed ? get().project : snapshot.project ?? snapshot.draftProject ?? get().project;
            if (!nextProject.graph.nodes.some(candidate => candidate.id === nodeId)) throw new Error("The selected KPI changed. Select an existing KPI and retry.");
            // A confirmed stop can be retried after an intervening user edit;
            // its old snapshot is history, never a replacement for that edit.
            applyAgentSnapshot(set, snapshot, previous?.terminalCleanupConfirmed === true, true);
            activeAgentEventUnsubscribe?.(); activeAgentEventUnsubscribe = undefined;
            set(current => ({ pendingIncomingKpiRestart: undefined, isGenerating: false, agentPendingQuestions: undefined, activeAgentRunId: undefined,
              smartKpiFencedRunIds: [...new Set([...current.smartKpiFencedRunIds, runId])].slice(-64) }));
            return await get().startAgentRun(undefined, { mode: "deepen_node", selectedNodeId: nodeId, includeCurrentProject: true });
          } catch (error) {
            if (!ownsRestart()) return false;
            const message = error instanceof Error ? error.message : "Finish the current agent and retry.";
            set({ isGenerating: false, aiError: message, agentError: message }); return false;
          } finally { incomingKpiRestarts.delete(runId); }
        }
        if (canContinueCurrentRun) {
          const runId = state.agentRun?.runId ?? state.activeAgentRunId ?? state.generateActivity?.runId;
          if (!runId) return false;
          const requestedAt = nowIso();
          set((current) => ({
            aiError: undefined,
            agentError: undefined,
            activeAgentRunId: current.activeAgentRunId ?? runId,
            generateActivity: current.generateActivity?.runId === runId
              ? {
                  ...current.generateActivity,
                  status: "running",
                  canCancel: true,
                  retryableError: undefined,
                  publicStatus: {
                    phase: "planning_model",
                    message: "Adding the next KPI level...",
                    updatedAt: requestedAt
                  },
                  message: undefined,
                  completedAt: undefined,
                  updatedAt: requestedAt
                }
              : current.generateActivity
          }));
          try {
            const snapshot = await createAgentClient().sendMessage(runId, {
              type: "deepen_node",
              selectedNodeId: nodeId
            });
            applyAgentSnapshot(set, snapshot);
            return true;
          } catch (error) {
            const message = error instanceof Error ? error.message : "The next KPI level could not be created.";
            set({ aiError: message, agentError: message });
            return false;
          }
        }

        return get().startAgentRun(undefined, {
          mode: "deepen_node",
          selectedNodeId: nodeId,
          includeCurrentProject: true
        });
      },
      applyAgentGraphPatch: (snapshot) => applyAgentSnapshot(set, snapshot),
      cancelAgentRun: async () => {
        const state = get(), scope = incomingRestartScope(state);
        const runId = resumableAgentRunId(state);
        if (!runId || incomingKpiRestarts.has(runId)) return;
        const unsubscribe = activeAgentEventUnsubscribe;
        const previous = pendingIncomingRestartHere(state) ? state.pendingIncomingKpiRestart : undefined;
        const executionSummary = state.agentRun?.executionSummary ?? state.generateActivity?.runtimeAgentRun?.executionSummary;
        // The binding registry requires compatibility adapters to contain
        // "compat"; those runs do not have a Supervisor terminal receipt.
        const structured = Boolean(executionSummary && !/compat/i.test(executionSummary.engineAdapterId));
        const awaitTerminal = structured || previous?.runId === runId;
        const ownsCancellation = () => {
          const current = get(), currentScope = incomingRestartScope(current);
          return currentScope.workspaceId === scope.workspaceId && currentScope.vdtId === scope.vdtId
            && resumableAgentRunId(current) === runId;
        };
        incomingKpiRestarts.add(runId);
        try {
          let marker = previous;
          if (awaitTerminal) {
            if (state.pendingIncomingKpiRestart && state.pendingIncomingKpiRestart.runId !== runId) {
              throw new Error("Finish stopping the previous agent in its original VDT, then retry.");
            }
            marker ??= { runId, ...scope };
            set({ pendingIncomingKpiRestart: marker });
            if (!incomingStopPersisted(marker)) throw new Error("Browser storage could not retain the agent stop request. Retry Cancel.");
          }
          const client = createAgentClient();
          if (!marker?.terminalCleanupConfirmed) {
            await client.cancel(runId, awaitTerminal ? { awaitTerminal: true } : undefined);
            if (!ownsCancellation()) return;
            if (marker) {
              marker = { ...marker, terminalCleanupConfirmed: true };
              set({ pendingIncomingKpiRestart: marker });
              if (!incomingStopPersisted(marker)) throw new Error("Browser storage could not retain confirmed agent cleanup. Retry Cancel.");
            }
          }
          const snapshot = await client.getRun(runId);
          if (!ownsCancellation()) return;
          if (snapshot.runId !== runId || !["succeeded", "failed", "cancelled"].includes(snapshot.status)) {
            throw new Error("Agent cancellation is not terminal. Retry Cancel.");
          }
          // Cancellation reports lifecycle only. The builder can predate edits
          // already made in the open graph, so it must never replace that graph.
          // Publish terminal activity and remove its stop marker in one saved
          // state, so a reload cannot strand a terminal chat behind the marker.
          applyAgentSnapshot(update => set(current => ({
            ...(typeof update === "function" ? update(current) : update),
            agentError: undefined, aiError: undefined,
            ...(marker ? { pendingIncomingKpiRestart: undefined } : {}),
            smartKpiFencedRunIds: [...new Set([...current.smartKpiFencedRunIds, runId])].slice(-64)
          })), snapshot, true, true);
          if (activeAgentEventUnsubscribe === unsubscribe) {
            unsubscribe?.();
            activeAgentEventUnsubscribe = undefined;
            set({ agentConnectionStatus: "disconnected" });
          }
        } catch (error) {
          if (!ownsCancellation()) return;
          const message = error instanceof Error ? error.message : "Agent run could not be cancelled.";
          set(current => ({ agentError: message, aiError: message,
            generateActivity: current.generateActivity?.runId === runId ? {
              ...current.generateActivity,
              cancelRequested: false,
              canCancel: isCancellableActivityStatus(current.generateActivity.status),
              message,
              updatedAt: nowIso()
            } : current.generateActivity
          }));
        } finally {
          incomingKpiRestarts.delete(runId);
        }
      },
      cancelGenerate: () => {
        const activity = get().generateActivity;
        if (!activity || !isCancellableActivityStatus(activity.status)) return;
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
        const { brief, executionSettings, cliDetectionAgents, cliDetectionError, isRescanningClis } = state;

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

        const executionError = validateExecutionForGenerate(executionSettings, cliDetectionAgents, {
          isScanning: isRescanningClis,
          detectionError: cliDetectionError
        });
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
        const resolvedProviderConfig =
          providerId === "mock"
            ? undefined
            : needsPairing
              ? { ...providerConfig, pairingToken: runnerPairingToken }
              : providerConfig;

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
          const explicitBindingId = await prepareOpenAiAgentBinding(executionSettings, providerId, resolvedProviderConfig);
          const bindings = await createAgentClient().getExecutionBindings();
          const startRequest = buildAgentPublicStartRequest(
            {
              mode: "generate_vdt",
              input: brief,
              workspace: buildAgentWorkspaceContext(state),
              options: {
                autoApplyPatches: true,
                continueWithAssumptions: false,
                maxSteps: 40
              }
            },
            executionSettings,
            bindings,
            {
              explicitBindingId,
              providerId,
              providerConfig: resolvedProviderConfig
            }
          );
          const response = await createAgentClient().startRun(startRequest);
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
            comments: source.comments?.map((comment) => ({ ...comment })),
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
      updateScenarioComment: (scenarioId, nodeId, text) =>
        set((state) => {
          const scenario = state.project.scenarios.find((candidate) => candidate.id === scenarioId);
          if (!scenario || !state.project.graph.nodes.some((node) => node.id === nodeId)) {
            return state;
          }

          const previous = scenario.comments?.find((comment) => comment.nodeId === nodeId)?.text ?? "";
          if (previous === text || (!previous && !text.trim())) {
            return state;
          }

          const comments = (scenario.comments ?? []).filter((comment) => comment.nodeId !== nodeId);
          if (text.trim()) {
            comments.push({ nodeId, text });
          }
          const updatedAt = nowIso();
          return {
            project: {
              ...state.project,
              updatedAt,
              scenarios: state.project.scenarios.map((candidate) => candidate.id === scenarioId
                ? { ...candidate, comments: comments.length ? comments : undefined, updatedAt }
                : candidate)
            }
          };
        }),
      stageDataDiscoveryChangeSet: (changeSet, context) => {
        const current = get();
        const contextError = context ? fileImportContextError(context, current.project, current.workspace) : undefined;
        if (contextError) {
          set({ aiActionError: contextError });
          return false;
        }
        set((state) => ({
          pendingChangeSet: changeSet,
          pendingFileImport: context ? { changeSetId: changeSet.id, context } : undefined,
          changeSetSelection: collectChangeEntryIds(changeSet),
          highlightedNodeIds: computeHighlightedNodeIds(state.project, changeSet),
          aiActionError: undefined
        }));
        return true;
      },
      toggleChangeSelection: (changeId) =>
        set((state) => {
          // File hierarchies include parent formulas, sources and mappings as one dependent group.
          if (state.pendingChangeSet?.additions.some((node) => node.tags?.includes("incoming_kpi_breakdown"))) {
            return { changeSetSelection: state.changeSetSelection.has(changeId) ? new Set<string>() : collectChangeEntryIds(state.pendingChangeSet) };
          }
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
          if (state.pendingFileImport?.changeSetId === state.pendingChangeSet.id) {
            const contextError = fileImportContextError(state.pendingFileImport.context, state.project, state.workspace);
            if (contextError) return { aiActionError: contextError };
          }

          const taskType = state.pendingChangeSet.taskType;
          if (taskType === "deepen_node") {
            const request = state.agentRun?.request ?? state.generateActivity?.runtimeAgentRun?.request;
            try { validateIncomingKpiChangeSet(state.project, state.pendingChangeSet, state.changeSetSelection,
              request?.mode === "deepen_node" ? request.input.selectedNodeId : undefined); }
            catch (error) { return { aiActionError: error instanceof Error ? error.message : "Regenerate this incoming layer with its parent formula." }; }
          }
          const snapshotted = createVersionSnapshot(state.project, {
            name: changeSnapshotName(taskType),
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
      saveVersionSnapshot: (name) => {
        const trimmed = name.trim().slice(0, 160);
        if (!trimmed) return undefined;
        let versionId: string | undefined;
        set((state) => {
          const project = createVersionSnapshot(state.project, { name: trimmed });
          versionId = project.versions[project.versions.length - 1]!.id;
          return { project, projectRevision: state.projectRevision + 1 };
        });
        return versionId;
      },
      renameVersionSnapshot: (versionId, name) => {
        const trimmed = name.trim().slice(0, 160);
        if (!trimmed) return;
        set((state) => ({
          project: { ...state.project, updatedAt: nowIso(), versions: state.project.versions.map((version) =>
            version.id === versionId ? { ...version, name: trimmed } : version) },
          projectRevision: state.projectRevision + 1
        }));
      },
      restoreVersionSnapshot: (versionId) => {
        let success = false;
        set((state) => {
          try {
            const version = state.project.versions.find((entry) => entry.id === versionId);
            if (!version) throw new Error("This version is no longer available. Select another version.");
            const restoredVersionName = versionDisplayName(version);
            const result = restoreVersionWithCheckpoint(state.project, versionId, `Before restoring “${restoredVersionName}”`);
            const laidOut = ensureScenario(result.project);
            calculateGraph(laidOut);
            success = true;
            return {
              project: laidOut,
              projectRevision: state.projectRevision + 1,
              selectedNodeId: laidOut.rootNodeId,
              selectedEdgeId: undefined,
              activeScenarioId: resolveMainScenarioId(laidOut),
              versionRestoreUndo: {
                checkpointVersionId: result.checkpointVersionId,
                restoredVersionName,
                restoredProject: laidOut,
                activeVdtId: state.workspace.activeVdtId,
                previousScenarioId: state.activeScenarioId,
                previousNodeId: state.selectedNodeId
              },
              brief: briefFromProject(laidOut),
              ...clearPendingAiActionState()
            };
          } catch (error) {
            return {
              aiActionError:
                error instanceof Error ? error.message : "Version snapshot could not be restored."
            };
          }
        });
        if (success) void get().sendManualProjectChange({ kind: "project_replaced", summary: "User restored a saved model version; the previous state was checkpointed." });
        return success;
      },
      undoVersionRestore: () => {
        const state = get();
        if (!canUndoVersionRestore(state) || !state.versionRestoreUndo) return false;
        const undo = state.versionRestoreUndo;
        const restored = restoreProjectVersionSnapshot(state.project, undo.checkpointVersionId);
        set({
          project: restored,
          projectRevision: state.projectRevision + 1,
          selectedNodeId: restored.graph.nodes.some((node) => node.id === undo.previousNodeId) ? undo.previousNodeId : restored.rootNodeId,
          selectedEdgeId: undefined,
          activeScenarioId: restored.scenarios.some((scenario) => scenario.id === undo.previousScenarioId) ? undo.previousScenarioId : resolveMainScenarioId(restored),
          brief: briefFromProject(restored),
          versionRestoreUndo: undefined,
          ...clearPendingAiActionState()
        });
        void get().sendManualProjectChange({ kind: "project_replaced", summary: "User undid model version restoration." });
        return true;
      }
    }, get),
    {
      name: "vdt-studio-state",
      version: 2,
      storage: createJSONStorage(() => studioStateStorage),
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
        personalisation: state.personalisation,
        project: state.project,
        projectRevision: state.projectRevision,
        smartKpiOperation: state.smartKpiOperation,
        smartKpiUndo: state.smartKpiUndo,
        smartKpiRebaseRequired: state.smartKpiRebaseRequired,
        smartKpiConflictOperation: state.smartKpiConflictOperation,
        smartKpiFencedRunIds: state.smartKpiFencedRunIds,
        pendingIncomingKpiRestart: state.pendingIncomingKpiRestart,
        workspace: {
          activePanel: state.workspace.activePanel,
          projectSummaries: state.workspace.projectSummaries,
          activeProjectId: state.workspace.activeProjectId,
          activeVdtId: state.workspace.activeVdtId,
          isLoading: false,
          isMutating: false,
          lastSavedAt: state.workspace.lastSavedAt,
          pendingRevisionCommit: state.workspace.pendingRevisionCommit,
          pendingVdtCreate: state.workspace.pendingVdtCreate
        },
        selectedNodeId: state.selectedNodeId,
        activeScenarioId: state.activeScenarioId,
        brief: state.brief,
        providerId: state.providerId,
        providerConfig: persistedProviderConfig(state.providerConfig),
        executionSettings: persistedExecutionSettings(state.executionSettings),
        removedCliAgentIds: state.removedCliAgentIds,
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
        const removedCliAgentIds = normalizeRemovedCliAgentIds(persisted?.removedCliAgentIds);
        const executionSettings = reconcileRemovedCliSelections(reconcilePersistedExecutionSettings(
          persisted?.providerId,
          providerConfig,
          persisted?.executionSettings
        ), removedCliAgentIds);
        const synced = syncLegacyProviderFromExecutionSettings(executionSettings, providerConfig);
        // An ambiguous immutable Smart request must reconcile against exactly
        // the submitted local base; normalization here would fabricate an edit.
        const project = persisted?.smartKpiOperation?.phase === "committing"
          ? persisted.project ?? currentState.project
          : ensureScenario(persisted?.project ?? currentState.project);
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
          activeVdtId: persistedActiveVdtExists || persisted?.smartKpiOperation?.vdtId === mergedWorkspace.activeVdtId ? mergedWorkspace.activeVdtId : undefined,
          activePanel: activeWorkspacePanel
        };
        const savedActivity = persisted?.generateActivity;
        const generateActivity = savedActivity ? {
          ...savedActivity,
          cancelRequested: false,
          canCancel: isCancellableActivityStatus(savedActivity.status)
        } : undefined;
        const agentRun = persisted?.agentRun;
        const hasActiveAgentRun = isActiveActivity(generateActivity) || isActiveRuntimeRun(agentRun);
        const activeAgentRunId = hasActiveAgentRun
          ? persisted?.activeAgentRunId ?? agentRun?.runId ?? generateActivity?.runId
          : undefined;

        return {
          ...currentState,
          ...persisted,
          personalisation: normalizeInstructionPreferences(persisted?.personalisation),
          project,
          workspace,
          smartKpiOperation: persisted?.smartKpiOperation?.phase === "committing" ? persisted.smartKpiOperation : undefined,
          smartKpiUndo: persisted?.smartKpiUndo,
          smartKpiFencedRunIds: persisted?.smartKpiFencedRunIds ?? [],
          smartKpiMutation: persisted?.smartKpiOperation?.phase === "committing"
            ? { status: "reconciling", targetNodeId: persisted.smartKpiOperation.context?.targetNodeId, canUndo: false,
              message: "Reconcile the pending immutable Smart save before editing." }
            : { status: "idle", canUndo: false },
          activeScenarioId: resolveMainScenarioId(project),
          providerId: synced.providerId,
          providerConfig: persistedProviderConfig(synced.providerConfig as ProviderConfigState),
          executionSettings,
          removedCliAgentIds,
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

useVdtStudioStore.subscribe((state, previous) => {
  if (state === previous) return;
  const blockedReason = smartKpiBlockedReason(state), canUndo = canUndoSmartKpi(state);
  const undoBlockedReason = state.smartKpiUndo && !canUndo ? "Undo is unavailable after an edit, another revision, or a change of VDT. The checkpoint remains in Versions." : undefined;
  if (state.smartKpiBlockedReason !== blockedReason || state.smartKpiMutation.canUndo !== canUndo || state.smartKpiMutation.undoBlockedReason !== undoBlockedReason) {
    useVdtStudioStore.setState({ smartKpiBlockedReason: blockedReason,
      smartKpiMutation: { ...state.smartKpiMutation, canUndo, ...(undoBlockedReason ? { undoBlockedReason } : { undoBlockedReason: undefined }) } });
  }
});

export function useCurrentCalculation() {
  return useVdtStudioStore((state) => calculateGraph(state.project));
}
