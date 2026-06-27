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
  type ManualProjectChange,
  type VdtAgentEvent as RuntimeAgentEvent,
  type VdtAgentQuestion as RuntimeAgentQuestion,
  type VdtAgentRunSnapshot as RuntimeAgentRunSnapshot
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
  selectedSkills?: VdtAgentSelectedSkill[] | undefined;
  agentEvents?: VdtAgentEvent[] | undefined;
  agentQuestions?: RuntimeAgentQuestion[] | undefined;
  questionsForUser?: string[] | undefined;
  finalReport?: string | undefined;
  timeoutMs?: number | undefined;
  details?: GenerateActivityDetail[] | undefined;
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

export type RunAiActionTaskType = Exclude<VdtAiTaskType, "agent_plan" | "generate_tree">;

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
  updateNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  startAgentRun: (initialInstruction?: string) => Promise<boolean>;
  connectAgentEvents: (runId: string) => void;
  sendAgentAnswers: (answers: Record<string, string | number | string[]>) => Promise<void>;
  sendAgentInstruction: (text: string, selectedNodeId?: string) => Promise<boolean>;
  sendManualProjectChange: (change: ManualProjectChange) => Promise<void>;
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

function buildExampleProject(exampleId: ExampleProjectId = "production_volume") {
  if (exampleId === "production_volume") {
    return buildInitialProject();
  }

  return importProjectJson(JSON.stringify(exampleProjectJsonById[exampleId]));
}

function briefFromProject(project: VdtProject): BriefState {
  const rootNode = project.graph.nodes.find((node) => node.id === project.rootNodeId);
  return {
    rootKpi: rootNode?.name ?? project.name,
    industry: project.industry ?? "",
    businessContext: project.businessContext ?? "",
    unit: rootNode?.unit ?? "",
    timePeriod: "monthly",
    goal: project.description ?? "",
    levelOfDetail: "medium"
  };
}

function summarizeGeneratedVdt(project: VdtProject): string {
  const rootNode = project.graph.nodes.find((node) => node.id === project.rootNodeId);
  const rootName = rootNode?.name ?? "the root KPI";
  const nodeById = new Map(project.graph.nodes.map((node) => [node.id, node.name]));
  const topDrivers = project.graph.edges
    .filter((edge) => edge.sourceNodeId === project.rootNodeId)
    .map((edge) => nodeById.get(edge.targetNodeId))
    .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
    .slice(0, 5);
  const driverText = topDrivers.length > 0
    ? ` The first-level drivers are ${topDrivers.join(", ")}.`
    : "";

  return `Built ${rootName} as a visual decomposition with ${project.graph.nodes.length} nodes and ${project.graph.edges.length} edges.${driverText} The canvas now includes the formulas, assumptions, warnings, and scenario inputs returned with the validated graph.`;
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

let activeGenerateAbortController: AbortController | undefined;
let activeGenerateRunId: string | undefined;
let activeAgentEventUnsubscribe: (() => void) | undefined;

function generateRunId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : makeId("generate");
}

function isAbortError(error: unknown) {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (
    error instanceof Error && error.name === "AbortError"
  );
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
  return {
    runId: snapshot.runId,
    status: snapshot.status === "queued" || snapshot.status === "waiting_approval" ? "running" : snapshot.status,
    phase: mapRuntimeAgentPhase(snapshot.phase),
    request,
    selectedSkills: snapshot.selectedSkills.map((skill) => ({
      id: skill.id,
      path: skill.path,
      reason: skill.reason
    })),
    events: snapshot.events.map((event) => ({
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
      return type === "plan_proposed" ? "planning_decomposition" : type === "tool_call_started" ? "model_call_started" : type === "tool_call_completed" ? "model_call_completed" : "graph_patch";
    default:
      return type;
  }
}

function shouldRefreshAgentSnapshot(event: RuntimeAgentEvent): boolean {
  return event.type === "clarifying_questions" ||
    event.type === "plan_proposed" ||
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

function applyAgentSnapshot(
  set: (partial: Partial<VdtStudioState> | ((state: VdtStudioState) => Partial<VdtStudioState>)) => void,
  snapshot: RuntimeAgentRunSnapshot
) {
  set((state) => {
    if (state.activeAgentRunId && state.activeAgentRunId !== snapshot.runId) {
      return {};
    }
    const project = snapshot.project ?? snapshot.draftProject;
    const status = mapRuntimeStatus(snapshot);
    const now = nowIso();
    const activity = state.generateActivity?.runId === snapshot.runId
      ? state.generateActivity
      : buildGenerateActivity(
          snapshot.runId,
          state.executionSettings,
          state.providerId,
          state.providerConfig as Record<string, unknown>
        );
    const legacyRun = legacyAgentRunFromRuntimeSnapshot(snapshot);
    return {
      ...(project
        ? {
            project,
            selectedNodeId: project.rootNodeId,
            activeScenarioId: project.scenarios[0]?.id ?? "",
            projectRevision: state.projectRevision + 1
          }
        : {}),
      activeAgentRunId: status === "ready" || status === "error" || status === "cancelled" ? undefined : snapshot.runId,
      agentRun: snapshot,
      agentEvents: snapshot.events,
      agentPendingQuestions: snapshot.pendingQuestions,
      agentError: snapshot.error?.message,
      isGenerating: status === "running" || status === "needs_user_input",
      generateActivity: {
        ...activity,
        status,
        phase: status === "ready" ? "ready" : activity.phase,
        canCancel: status === "running" || status === "needs_user_input",
        agentRun: legacyRun,
        selectedSkills: legacyRun.selectedSkills,
        agentEvents: legacyRun.events,
        agentQuestions: snapshot.pendingQuestions,
        questionsForUser: snapshot.pendingQuestions?.map((question) => question.question),
        finalReport: snapshot.finalReport,
        summary: snapshot.finalReport ?? activity.summary,
        message: snapshot.error?.message ?? activity.message,
        completedAt: snapshot.completedAt ?? (status === "ready" || status === "error" || status === "cancelled" ? now : activity.completedAt),
        updatedAt: snapshot.updatedAt
      }
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

function patchGenerateActivity(
  set: (partial: Partial<VdtStudioState> | ((state: VdtStudioState) => Partial<VdtStudioState>)) => void,
  runId: string,
  patch: Partial<GenerateActivityState>
) {
  set((state) => {
    if (state.generateActivity?.runId !== runId) {
      return {};
    }

    const updatedAt = nowIso();
    return {
      generateActivity: {
        ...state.generateActivity,
        ...patch,
        phaseStartedAt:
          patch.phase && patch.phase !== state.generateActivity.phase
            ? updatedAt
            : (patch.phaseStartedAt ?? state.generateActivity.phaseStartedAt),
        updatedAt
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

function defaultScenario(): VdtScenario {
  const createdAt = nowIso();
  return {
    id: makeId("scenario"),
    name: "New scenario",
    description: "Adjust input drivers and compare impact against baseline.",
    overrides: [],
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

function ensureScenario(project: VdtProject) {
  if (project.scenarios.length > 0) {
    return project;
  }

  return {
    ...project,
    scenarios: [defaultScenario()]
  };
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
        set((state) => ({
          ui: applyUiPreference(state.ui, field, value)
        })),
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
      resetUiPreferences: () => set({ ui: { ...DEFAULT_UI }, scenarioModalOpen: false }),
      autoDistributeLayout: () =>
        set((state) => {
          const existingPositions = collectExistingPositions(state.project.graph.nodes);
          const layout = layoutGraph(state.project.graph, state.project.rootNodeId, {
            ...canvasLayoutOptions(state.ui),
            existingPositions
          });
          const updatedAt = nowIso();
          return {
            project: {
              ...state.project,
              updatedAt,
              graph: {
                ...state.project.graph,
                nodes: state.project.graph.nodes.map((node) => ({
                  ...node,
                  position: layout.positions.get(node.id) ?? node.position ?? { x: 0, y: 0 },
                  updatedAt
                }))
              }
            }
          };
        }),
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
      startAgentRun: async (initialInstruction) => {
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
          const input = prompt
            ? {
                ...state.brief,
                prompt
              }
            : state.brief;
          const response = await createAgentClient().startRun({
            mode: "generate_vdt",
            input,
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
        const runId = get().agentRun?.runId ?? get().activeAgentRunId;
        if (!runId) return;
        try {
          const snapshot = await createAgentClient().sendMessage(runId, {
            type: "user_answer",
            answers
          });
          applyAgentSnapshot(set, snapshot);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Agent answers could not be sent.";
          set({ agentError: message, aiError: message });
        }
      },
      sendAgentInstruction: async (text, selectedNodeId) => {
        const trimmed = text.trim();
        if (!trimmed) return false;
        const runId = get().agentRun?.runId ?? get().activeAgentRunId;
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
          set({ agentError: message, aiError: message });
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
        if (!activeGenerateRunId || activity.runId !== activeGenerateRunId) {
          if (get().activeAgentRunId) {
            void get().cancelAgentRun();
          }
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
        activeGenerateAbortController?.abort();
      },
      generateWithAi: async () => {
        if (get().isGenerating) return;

        const { brief, executionSettings, cliDetectionAgents } = get();

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

        const runId = generateRunId();
        const abortController = new AbortController();
        activeGenerateRunId = runId;
        activeGenerateAbortController = abortController;
        set({
          isGenerating: true,
          generateActivity: buildGenerateActivity(runId, executionSettings, providerId, providerConfig),
          aiError: undefined,
          ...clearPendingAiActionState(),
          byokFieldErrors: undefined,
          activeAgentRunId: undefined,
          agentRun: undefined,
          agentEvents: [],
          agentPendingQuestions: undefined,
          agentError: undefined,
          agentConnectionStatus: "disconnected"
        });

        try {
          const generatedProject = await createAiExecutionClient().generateTree(
            {
              ...brief,
              providerId,
              providerConfig:
                providerId === "mock"
                  ? undefined
                  : needsPairing
                    ? { ...providerConfig, pairingToken: runnerPairingToken }
                    : providerConfig
            },
            {
              signal: abortController.signal,
              onProgress: (event) => applyGenerateProgressEvent(set, runId, event)
            }
          );
          const activityAfterCompletion = get().generateActivity;
          if (
            abortController.signal.aborted ||
            activeGenerateRunId !== runId ||
            activityAfterCompletion?.runId !== runId ||
            activityAfterCompletion.status === "cancelled" ||
            activityAfterCompletion.cancelRequested
          ) {
            set({ isGenerating: false });
            return;
          }
          patchGenerateActivity(set, runId, { phase: "validating_schema", canCancel: false });
          const projectWithScenario = ensureScenario(generatedProject);
          patchGenerateActivity(set, runId, { phase: "normalizing_graph" });
          const project = projectWithScenario;
          patchGenerateActivity(set, runId, { phase: "building_canvas" });
          const completedAt = nowIso();
          const currentActivity = get().generateActivity!;
          const generatedSummary = summarizeGeneratedVdt(project);
          set({
            project,
            selectedNodeId: project.rootNodeId,
            activeScenarioId: project.scenarios[0]?.id ?? "",
            isGenerating: false,
            generateActivity: {
              ...currentActivity,
              status: "ready",
              phase: "ready",
              phaseStartedAt: completedAt,
              canCancel: false,
              summary: currentActivity.finalReport ?? currentActivity.agentRun?.finalReport ?? generatedSummary,
              finalReport: currentActivity.finalReport ?? currentActivity.agentRun?.finalReport,
              details: mergeActivityDetails(currentActivity.details, undefined, completedAt, "ready"),
              completedAt,
              updatedAt: completedAt
            }
          });
        } catch (error) {
          if (isAbortError(error)) {
            set((state) => ({
              isGenerating: false,
              aiError: undefined,
              generateActivity: (() => {
                if (state.generateActivity?.runId !== runId) return state.generateActivity;
                const completedAt = nowIso();
                return {
                  ...state.generateActivity,
                  status: "cancelled",
                  canCancel: false,
                  cancelRequested: true,
                  message: "Generation cancelled.",
                  details: mergeActivityDetails(state.generateActivity.details, undefined, completedAt, "cancelled"),
                  completedAt,
                  updatedAt: completedAt
                };
              })()
            }));
            return;
          }

          const completedAt = nowIso();
          const currentActivity = get().generateActivity!;
          set({
            aiError: error instanceof Error ? error.message : "AI response could not be parsed.",
            isGenerating: false,
            generateActivity: {
              ...currentActivity,
              status: "error",
              canCancel: false,
              message: error instanceof Error ? error.message : "AI response could not be parsed.",
              details: mergeActivityDetails(currentActivity.details, undefined, completedAt, "error"),
              completedAt,
              updatedAt: completedAt
            }
          });
        } finally {
          if (activeGenerateRunId === runId) {
            activeGenerateAbortController = undefined;
            activeGenerateRunId = undefined;
          }
        }
      },
      loadExample: (exampleId = "production_volume") => {
        const project = buildExampleProject(exampleId);
        set({
          project,
          brief: briefFromProject(project),
          selectedNodeId: project.rootNodeId,
          activeScenarioId: project.scenarios[0]?.id ?? "",
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
          activeScenarioId: nextProject.scenarios[0]?.id ?? "",
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

          const scenarios = state.project.scenarios.filter((candidate) => candidate.id !== scenarioId);
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
            const restored = restoreProjectVersionSnapshot(state.project, versionId);
            const laidOut = layoutProjectGraph(restored, state.ui);
            calculateGraph(laidOut);

            return {
              project: laidOut,
              selectedNodeId: laidOut.rootNodeId,
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
        selectedNodeId: state.selectedNodeId,
        activeScenarioId: state.activeScenarioId,
        brief: state.brief,
        providerId: state.providerId,
        providerConfig: persistedProviderConfig(state.providerConfig),
        executionSettings: persistedExecutionSettings(state.executionSettings),
        ui: state.ui
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

        return {
          ...currentState,
          ...persisted,
          providerId: synced.providerId,
          providerConfig: persistedProviderConfig(synced.providerConfig as ProviderConfigState),
          executionSettings,
          ui
        };
      }
    }
  )
);

export function useCurrentCalculation() {
  return useVdtStudioStore((state) => calculateGraph(state.project));
}
