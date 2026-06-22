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
  applyUiPreference,
  DEFAULT_UI,
  mergeUiPreferences,
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
  BASE_SCENARIO_DRAWER_HEIGHT,
  BASE_WORKSPACE_SECTION_MIN_HEIGHT,
  COLLAPSED_PANEL_WIDTH,
  DEFAULT_UI,
  SCENARIO_DRAWER_COLLAPSED_HEIGHT,
  scaledPanelWidth,
  scaledScenarioDrawerCollapsedHeight,
  type UiPreferences
} from "./ui-preferences";

export type ProviderId = "mock" | "local_cli" | "openai_compatible" | "anthropic" | "azure_openai" | "gemini" | "local_runner";
export type ExampleProjectId = "production_volume" | "oee" | "inventory_level" | "maintenance_cost";

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

export interface CliAgentDetectionSnapshot {
  id: CliAgentId;
  installed: boolean;
  executable: string | null;
  alias: string | null;
  version: string | null;
  error?: string | undefined;
  status?:
    | "not_installed"
    | "installed"
    | "authentication_required"
    | "ready"
    | "rate_limited"
    | "unsupported_version"
    | "unsafe_configuration"
    | "unavailable"
    | "error"
    | undefined;
  authSummary?: string | undefined;
  diagnostics?: string[] | undefined;
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

export type RunAiActionTaskType = Exclude<VdtAiTaskType, "generate_tree">;

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
  isGenerating: boolean;
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
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  toggleScenarioDrawer: () => void;
  resetUiPreferences: () => void;
  autoDistributeLayout: () => void;
  updateNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  generateWithAi: () => Promise<void>;
  loadExample: (exampleId?: ExampleProjectId) => void;
  selectNode: (nodeId: string) => void;
  updateNode: (nodeId: string, patch: Partial<VdtNode>) => void;
  updateNodeBaselineValue: (nodeId: string, value?: number) => void;
  acceptNode: (nodeId: string) => void;
  rejectNode: (nodeId: string) => void;
  deleteNode: (nodeId: string) => void;
  createScenario: () => void;
  setActiveScenarioId: (scenarioId: string) => void;
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

function layoutProjectGraph(project: VdtProject): VdtProject {
  const existingPositions = collectExistingPositions(project.graph.nodes);
  const layout = layoutGraph(project.graph, project.rootNodeId, {
    ...DEFAULT_CANVAS_LAYOUT,
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

async function runAiTask<T extends RunAiActionTaskType>(
  taskType: T,
  input: RunAiActionInput<T>,
  state: Pick<VdtStudioState, "executionSettings" | "cliDetectionAgents" | "project" | "runnerPairingToken">
): Promise<RunAiTaskResult> {
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
  if (providerId === "local_runner" && !state.runnerPairingToken) {
    throw new Error("Pair the local runner before running this AI action.");
  }

  const response = await fetch("/api/ai/run-task", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      taskType,
      input: {
        project: state.project,
        ...input
      },
      providerId,
      providerConfig:
        providerId === "mock"
          ? undefined
          : providerId === "local_runner"
            ? { ...providerConfig, pairingToken: state.runnerPairingToken }
            : providerConfig
    })
  });

  const payload = (await response.json()) as { ok: boolean; result?: RunAiTaskResult; error?: string };
  if (!response.ok || !payload.ok || !payload.result) {
    throw new Error(payload.error ?? "AI task response could not be parsed.");
  }

  return payload.result;
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

function ensureScenario(project: VdtProject) {
  if (project.scenarios.length > 0) {
    return project;
  }

  return {
    ...project,
    scenarios: [defaultScenario()]
  };
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
      providerId: "mock",
      providerConfig: {
        openAiBaseUrl: "https://api.openai.com/v1",
        openAiModel: "gpt-5.4-mini",
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
      isGenerating: false,
      changeSetSelection: new Set<string>(),
      highlightedNodeIds: [],
      isRunningAiAction: false,
      setUiPreference: (field, value) =>
        set((state) => ({
          ui: applyUiPreference(state.ui, field, value)
        })),
      toggleLeftPanel: () =>
        set((state) => ({
          ui: { ...state.ui, leftPanelCollapsed: !state.ui.leftPanelCollapsed }
        })),
      toggleRightPanel: () =>
        set((state) => ({
          ui: { ...state.ui, rightPanelCollapsed: !state.ui.rightPanelCollapsed }
        })),
      toggleScenarioDrawer: () =>
        set((state) => ({
          ui: { ...state.ui, scenarioDrawerCollapsed: !state.ui.scenarioDrawerCollapsed }
        })),
      resetUiPreferences: () => set({ ui: { ...DEFAULT_UI } }),
      autoDistributeLayout: () =>
        set((state) => {
          const existingPositions = collectExistingPositions(state.project.graph.nodes);
          const layout = layoutGraph(state.project.graph, state.project.rootNodeId, {
            ...DEFAULT_CANVAS_LAYOUT,
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
      updateNodePosition: (nodeId, position) =>
        set((state) => ({
          project: updateProjectNode(state.project, nodeId, (node) => ({
            ...node,
            position,
            updatedAt: nowIso()
          }))
        })),
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
          const url = agentId ? `/api/ai/detect-clis?id=${encodeURIComponent(agentId)}` : "/api/ai/detect-clis";
          const response = await fetch(url);
          const payload = (await response.json()) as {
            agents?: CliAgentDetectionSnapshot[];
            modelsByAgent?: Partial<Record<CliAgentId, string[]>>;
            error?: string;
          };

          if (!response.ok || !payload.agents) {
            throw new Error(payload.error ?? `CLI detection failed with ${response.status}.`);
          }

          set((state) => {
            let cliDetectionAgents: CliAgentDetectionSnapshot[];

            if (!agentId) {
              cliDetectionAgents = payload.agents!;
            } else {
              const nextAgent = payload.agents![0];
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
          if (!state.runnerPairingToken) {
            throw new Error("Pair the local runner before testing a subscription backend.");
          }
          const response = await fetch("/api/ai/generate-vdt", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              operation: "connection_test",
              providerId: resolved.providerId,
              providerConfig: { ...resolved.providerConfig, pairingToken: state.runnerPairingToken }
            })
          });

          const payload = (await response.json()) as {
            ok?: boolean;
            error?: string;
          };

          if (!response.ok || !payload.ok) {
            throw new Error(payload.error ?? `CLI test failed with ${response.status}.`);
          }

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
          const response = await fetch(`${runnerUrl.replace(/\/$/, "")}/v1/pair`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ code })
          });
          const payload = (await response.json()) as {
            ok?: boolean;
            session?: { token?: string };
            error?: { message?: string };
          };
          const token = payload.session?.token;
          if (!response.ok || !payload.ok || !token) {
            throw new Error(payload.error?.message ?? "Runner pairing failed.");
          }
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
          await fetch(`${runnerUrl.replace(/\/$/, "")}/v1/unpair`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: "{}"
          });
        } finally {
          set({ runnerPairingToken: undefined, runnerPairingStatus: undefined });
        }
      },
      setProviderTestState: (isTestingProvider, providerTestStatus) =>
        set({ isTestingProvider, providerTestStatus }),
      setByokFieldErrors: (byokFieldErrors) => set({ byokFieldErrors }),
      generateWithAi: async () => {
        const { brief, executionSettings, cliDetectionAgents } = get();

        if (executionSettings.executionMode === "byok") {
          const validationErrors = validateByokSettings(executionSettings);
          if (hasByokFieldErrors(validationErrors)) {
            set({
              byokFieldErrors: validationErrors,
              aiError: "Fix BYOK settings before generating."
            });
            return;
          }
        }

        const executionError = validateExecutionForGenerate(executionSettings, cliDetectionAgents);
        if (executionError) {
          set({ aiError: executionError });
          return;
        }

        const { providerId, providerConfig } = resolveExecutionSettings(executionSettings);
        const runnerPairingToken = get().runnerPairingToken;
        if (providerId === "local_runner" && !runnerPairingToken) {
          set({ aiError: "Pair the local runner before generating." });
          return;
        }
        set({ isGenerating: true, aiError: undefined, ...clearPendingAiActionState(), byokFieldErrors: undefined });

        try {
          const response = await fetch("/api/ai/generate-vdt", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              ...brief,
              providerId,
              providerConfig:
                providerId === "mock"
                  ? undefined
                  : providerId === "local_runner"
                    ? { ...providerConfig, pairingToken: runnerPairingToken }
                    : providerConfig
            })
          });

          const payload = (await response.json()) as { ok: boolean; project?: VdtProject; error?: string };
          if (!response.ok || !payload.ok || !payload.project) {
            throw new Error(payload.error ?? "AI response could not be parsed.");
          }

          const project = ensureScenario(payload.project);
          set({
            project,
            selectedNodeId: project.rootNodeId,
            activeScenarioId: project.scenarios[0]?.id ?? "",
            isGenerating: false
          });
        } catch (error) {
          set({
            aiError: error instanceof Error ? error.message : "AI response could not be parsed.",
            isGenerating: false
          });
        }
      },
      loadExample: (exampleId = "production_volume") => {
        const project = buildExampleProject(exampleId);
        set({
          project,
          brief: briefFromProject(project),
          selectedNodeId: project.rootNodeId,
          activeScenarioId: project.scenarios[0]?.id ?? "",
          aiError: undefined,
          ...clearPendingAiActionState()
        });
      },
      replaceProject: (project) => {
        const nextProject = ensureScenario(project);
        set({
          project: nextProject,
          selectedNodeId: nextProject.rootNodeId,
          activeScenarioId: nextProject.scenarios[0]?.id ?? "",
          aiError: undefined,
          ...clearPendingAiActionState()
        });
      },
      selectNode: (nodeId) => set({ selectedNodeId: nodeId }),
      updateNode: (nodeId, patch) =>
        set((state) => ({
          project: updateProjectNode(state.project, nodeId, (node) => ({
            ...node,
            ...patch,
            status: patch.status ?? (node.aiGenerated ? "edited" : node.status),
            updatedAt: nowIso()
          }))
        })),
      updateNodeBaselineValue: (nodeId, value) =>
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
          })
        })),
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
      deleteNode: (nodeId) =>
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

          return {
            project,
            selectedNodeId: project.rootNodeId
          };
        }),
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
      updateScenarioOverride: (scenarioId, nodeId, value) =>
        set((state) => ({
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
        })),
      runAiAction: async (taskType, input) => {
        set({
          isRunningAiAction: true,
          aiActionError: undefined,
          pendingAdvisoryResult: undefined,
          pendingAdvisoryTaskType: undefined,
          pendingExplanation: undefined,
          pendingExplanationTaskType: undefined
        });

        try {
          const result = await runAiTask(taskType, input, get());
          const project = get().project;

          switch (result.kind) {
            case "change_set":
              set({
                pendingChangeSet: result.changeSet,
                changeSetSelection: collectChangeEntryIds(result.changeSet),
                highlightedNodeIds: computeHighlightedNodeIds(project, result.changeSet),
                pendingAdvisoryResult: undefined,
                pendingAdvisoryTaskType: undefined,
                pendingExplanation: undefined,
                pendingExplanationTaskType: undefined,
                selectedPanelTab: "ai",
                isRunningAiAction: false
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
          set({
            aiActionError: error instanceof Error ? error.message : "AI task failed.",
            isRunningAiAction: false
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
      applyPendingChangeSet: () =>
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

          const laidOut = layoutProjectGraph(applied.project);
          calculateGraph(laidOut);

          return {
            project: laidOut,
            ...clearPendingAiActionState()
          };
        }),
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
            const laidOut = layoutProjectGraph(restored);
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
