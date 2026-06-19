"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  calculateGraph,
  cloneProject,
  productionVolumeProject,
  type VdtEdge,
  type VdtNode,
  type VdtProject,
  type VdtScenario
} from "@vdt-studio/vdt-core";
import type { GenerateVdtInput, OpenAiCompatibleProviderConfig } from "@vdt-studio/ai-harness";
import { makeId, slugifyId } from "@/lib/id";

type ProviderId = "mock" | "openai_compatible";

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
  providerConfig: Partial<OpenAiCompatibleProviderConfig>;
  isGenerating: boolean;
  aiError?: string | undefined;
  deepenPreview?: {
    parentNodeId: string;
    suggestions: DeepenSuggestion[];
  } | undefined;
  setBriefField: <K extends keyof BriefState>(field: K, value: BriefState[K]) => void;
  setProviderId: (providerId: ProviderId) => void;
  setProviderConfigField: <K extends keyof OpenAiCompatibleProviderConfig>(
    field: K,
    value: OpenAiCompatibleProviderConfig[K]
  ) => void;
  generateWithAi: () => Promise<void>;
  loadExample: () => void;
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
}

function buildInitialProject() {
  return cloneProject(productionVolumeProject);
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
        model: "gpt-4.1-mini"
      },
      isGenerating: false,
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
          const response = await fetch("/api/ai/generate-vdt", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              ...brief,
              providerId,
              providerConfig: providerId === "openai_compatible" ? providerConfig : undefined
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
      loadExample: () => {
        const project = buildInitialProject();
        set({
          project,
          selectedNodeId: project.rootNodeId,
          activeScenarioId: project.scenarios[0]?.id ?? "",
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
        providerConfig: state.providerConfig
      })
    }
  )
);

export function useCurrentCalculation() {
  return useVdtStudioStore((state) => calculateGraph(state.project));
}
