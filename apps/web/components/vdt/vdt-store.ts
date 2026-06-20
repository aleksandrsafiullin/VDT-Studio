"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  calculateGraph,
  cloneProject,
  DEFAULT_CANVAS_LAYOUT,
  importProjectJson,
  layoutGraph,
  productionVolumeProject,
  type VdtEdge,
  type VdtNode,
  type VdtProject,
  type VdtScenario
} from "@vdt-studio/vdt-core";
import type { GenerateVdtInput, OpenAiCompatibleProviderConfig } from "@vdt-studio/ai-harness";
import { makeId, slugifyId } from "@/lib/id";
import {
  applyUiPreference,
  DEFAULT_UI,
  mergeUiPreferences,
  type UiPreferences
} from "./ui-preferences";
import { collectExistingPositions } from "./layout-positions";
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

export type ProviderId = "mock" | "openai_compatible" | "local_runner";
export type ExampleProjectId = "production_volume" | "oee" | "inventory_level" | "maintenance_cost";
export type LocalRunnerPresetId = "ollama_openai" | "lm_studio_openai" | "vllm_openai" | "custom_cli_json";

export interface LocalRunnerPreset {
  id: LocalRunnerPresetId;
  label: string;
  runnerProviderId: "local_http_stub" | "cli_stub";
  baseUrl?: string | undefined;
  model?: string | undefined;
  command?: string | undefined;
  argsText?: string | undefined;
}

interface ProviderConfigState extends Partial<OpenAiCompatibleProviderConfig> {
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

export const LOCAL_RUNNER_PRESETS: LocalRunnerPreset[] = [
  {
    id: "ollama_openai",
    label: "Ollama",
    runnerProviderId: "local_http_stub",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "qwen3"
  },
  {
    id: "lm_studio_openai",
    label: "LM Studio",
    runnerProviderId: "local_http_stub",
    baseUrl: "http://127.0.0.1:1234/v1",
    model: "local-model"
  },
  {
    id: "vllm_openai",
    label: "vLLM",
    runnerProviderId: "local_http_stub",
    baseUrl: "http://127.0.0.1:8000/v1",
    model: "local-model"
  },
  {
    id: "custom_cli_json",
    label: "CLI JSON stdout",
    runnerProviderId: "cli_stub",
    command: "vdt-model-adapter",
    argsText: ""
  }
];

const exampleProjectJsonById: Record<Exclude<ExampleProjectId, "production_volume">, unknown> = {
  oee: oeeExample,
  inventory_level: inventoryLevelExample,
  maintenance_cost: maintenanceCostExample
};

interface BriefState extends GenerateVdtInput {
  rootKpi: string;
}

interface DeepenSuggestion {
  id: string;
  name: string;
  unit?: string | undefined;
  relation: VdtEdge["relation"];
}

interface VdtStudioState {
  project: VdtProject;
  selectedNodeId: string;
  selectedEdgeId?: string | undefined;
  selectedPanelTab: "properties" | "ai" | "warnings";
  activeScenarioId: string;
  brief: BriefState;
  providerId: ProviderId;
  providerConfig: ProviderConfigState;
  ui: UiPreferences;
  isGenerating: boolean;
  aiError?: string | undefined;
  deepenPreview?: {
    parentNodeId: string;
    suggestions: DeepenSuggestion[];
  } | undefined;
  setBriefField: <K extends keyof BriefState>(field: K, value: BriefState[K]) => void;
  setProviderId: (providerId: ProviderId) => void;
  setProviderConfigField: <K extends keyof ProviderConfigState>(
    field: K,
    value: ProviderConfigState[K]
  ) => void;
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
  prepareDeepenPreview: (nodeId: string) => void;
  clearDeepenPreview: () => void;
  applyDeepenPreview: () => void;
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
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4.1-mini",
        localRunnerPresetId: "ollama_openai",
        runnerUrl: "http://127.0.0.1:8765",
        runnerProviderId: "local_http_stub",
        localBaseUrl: "http://127.0.0.1:11434/v1",
        localModel: "qwen3",
        timeoutSec: 60
      },
      ui: { ...DEFAULT_UI },
      isGenerating: false,
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
      setProviderId: (providerId) => set({ providerId }),
      setProviderConfigField: (field, value) =>
        set((state) => ({
          providerConfig: {
            ...state.providerConfig,
            [field]: value
          }
        })),
      generateWithAi: async () => {
        const { brief, providerId, providerConfig } = get();
        set({ isGenerating: true, aiError: undefined, deepenPreview: undefined });

        try {
          const requestProviderConfig =
            providerId === "local_runner"
              ? {
                  ...providerConfig,
                  baseUrl: providerConfig.localBaseUrl,
                  model: providerConfig.localModel,
                  apiKey: providerConfig.localApiKey
                }
              : providerConfig;
          const response = await fetch("/api/ai/generate-vdt", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              ...brief,
              providerId,
              providerConfig: providerId === "mock" ? undefined : requestProviderConfig
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
          deepenPreview: undefined
        });
      },
      replaceProject: (project) => {
        const nextProject = ensureScenario(project);
        set({
          project: nextProject,
          selectedNodeId: nextProject.rootNodeId,
          activeScenarioId: nextProject.scenarios[0]?.id ?? "",
          aiError: undefined,
          deepenPreview: undefined
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
      prepareDeepenPreview: (nodeId) => {
        const node = get().project.graph.nodes.find((candidate) => candidate.id === nodeId);
        if (!node) {
          return;
        }

        const base = slugifyId(node.name);
        const suggestions: DeepenSuggestion[] = [
          {
            id: `${base}_process_loss`,
            name: "Process Loss",
            unit: node.unit,
            relation: "negative_driver"
          },
          {
            id: `${base}_equipment_loss`,
            name: "Equipment Loss",
            unit: node.unit,
            relation: "negative_driver"
          },
          {
            id: `${base}_operating_practice`,
            name: "Operating Practice",
            relation: "contextual_influence"
          }
        ];

        set({
          deepenPreview: {
            parentNodeId: nodeId,
            suggestions
          },
          selectedPanelTab: "ai"
        });
      },
      clearDeepenPreview: () => set({ deepenPreview: undefined }),
      applyDeepenPreview: () =>
        set((state) => {
          if (!state.deepenPreview) {
            return {};
          }

          const existingIds = new Set(state.project.graph.nodes.map((node) => node.id));
          const parent = state.project.graph.nodes.find((node) => node.id === state.deepenPreview?.parentNodeId);
          if (!parent) {
            return { deepenPreview: undefined };
          }

          const createdAt = nowIso();
          const newNodes: VdtNode[] = state.deepenPreview.suggestions
            .filter((suggestion) => !existingIds.has(suggestion.id))
            .map((suggestion) => ({
              id: suggestion.id,
              name: suggestion.name,
              description: `AI-proposed driver to review under ${parent.name}.`,
              type: suggestion.relation === "contextual_influence" ? "external_factor" : "input",
              status: "ai_suggested",
              unit: suggestion.unit,
              aiGenerated: true,
              aiConfidence: 0.68,
              aiRationale: "Suggested as a plausible deeper driver. Review before accepting.",
              createdAt,
              updatedAt: createdAt
            }));

          const newEdges: VdtEdge[] = newNodes.map((node) => ({
            id: `edge_${parent.id}_${node.id}`,
            sourceNodeId: parent.id,
            targetNodeId: node.id,
            relation:
              state.deepenPreview?.suggestions.find((suggestion) => suggestion.id === node.id)?.relation ??
              "contextual_influence",
            label: "AI preview",
            aiGenerated: true,
            aiConfidence: 0.68
          }));

          return {
            deepenPreview: undefined,
            project: {
              ...state.project,
              updatedAt: nowIso(),
              graph: {
                nodes: [...state.project.graph.nodes, ...newNodes],
                edges: [...state.project.graph.edges, ...newEdges]
              }
            }
          };
        })
    }),
    {
      name: "vdt-studio-state",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        project: state.project,
        selectedNodeId: state.selectedNodeId,
        activeScenarioId: state.activeScenarioId,
        brief: state.brief,
        providerId: state.providerId,
        providerConfig: persistedProviderConfig(state.providerConfig),
        ui: state.ui
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<VdtStudioState> | undefined;
        const providerConfig = persistedProviderConfig(persisted?.providerConfig ?? currentState.providerConfig);
        const ui = mergeUiPreferences(persisted?.ui);

        return {
          ...currentState,
          ...persisted,
          providerConfig,
          ui
        };
      }
    }
  )
);

export function useCurrentCalculation() {
  return useVdtStudioStore((state) => calculateGraph(state.project));
}
