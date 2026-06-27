import type { VdtBuilderSession, VdtChangeSet, VdtProject } from "@vdt-studio/vdt-core";
import type { VdtAgentQuestion, VdtSkillRecipe } from "@vdt-studio/vdt-agent";

export type VdtAgentRunStatus =
  | "queued"
  | "running"
  | "needs_user_input"
  | "waiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled";

export type VdtAgentRunPhase =
  | "classifying_request"
  | "retrieving_skills"
  | "reading_skills"
  | "asking_clarifying_questions"
  | "planning_decomposition"
  | "building_graph"
  | "validating_graph"
  | "repairing_graph"
  | "applying_graph"
  | "reporting";

export type VdtAgentEventType =
  | "run_started"
  | "classification"
  | "skill_search"
  | "skill_selected"
  | "skill_read"
  | "clarifying_questions"
  | "user_answer_received"
  | "user_instruction"
  | "plan_proposed"
  | "tool_call_started"
  | "tool_call_completed"
  | "graph_patch"
  | "graph_validation"
  | "manual_change_observed"
  | "repair_started"
  | "final_report"
  | "run_completed"
  | "error";

export interface VdtAgentEvent {
  id: string;
  runId: string;
  seq: number;
  timestamp: string;
  phase: VdtAgentRunPhase;
  type: VdtAgentEventType;
  title: string;
  message: string;
  metadata?: Record<string, unknown> | undefined;
  patch?: VdtChangeSet | undefined;
  questions?: VdtAgentQuestion[] | undefined;
}

export interface VdtAgentSelectedSkill {
  id: string;
  path: string;
  title: string;
  score: number;
  reason: string;
  matchedTerms: string[];
}

export type VdtAgentMode = "generate_vdt" | "continue_project" | "deepen_node" | "review_project";

export interface VdtAgentStartInput {
  prompt?: string | undefined;
  rootKpi?: string | undefined;
  industry?: string | undefined;
  businessContext?: string | undefined;
  unit?: string | undefined;
  timePeriod?: string | undefined;
  goal?: string | undefined;
  levelOfDetail?: "low" | "medium" | "high" | string | undefined;
  project?: VdtProject | undefined;
  selectedNodeId?: string | undefined;
}

export interface VdtAgentStartRequest {
  mode: VdtAgentMode;
  input: VdtAgentStartInput;
  providerId: string;
  providerConfig?: Record<string, unknown> | undefined;
  options?: {
    autoApplyPatches?: boolean | undefined;
    askBeforeFirstPatch?: boolean | undefined;
    maxSteps?: number | undefined;
    continueWithAssumptions?: boolean | undefined;
  } | undefined;
}

export interface VdtBuildPlan {
  title: string;
  steps: string[];
  selectedSkillIds: string[];
  firstLevelDriverIds: string[];
}

export interface ManualProjectChange {
  kind:
    | "node_updated"
    | "node_deleted"
    | "node_position_updated"
    | "edge_updated"
    | "project_replaced"
    | "change_set_applied";
  nodeId?: string | undefined;
  edgeId?: string | undefined;
  patch?: Record<string, unknown> | undefined;
  summary?: string | undefined;
}

export type AgentUserMessage =
  | {
      type: "user_answer";
      answers: Record<string, string | number | string[]>;
    }
  | {
      type: "manual_project_change";
      projectRevision?: number | undefined;
      change: ManualProjectChange;
    }
  | {
      type: "user_instruction";
      text: string;
      selectedNodeId?: string | undefined;
    }
  | {
      type: "approval";
      approved: boolean;
      selectedChangeIds?: string[] | undefined;
    };

export interface VdtAgentRunSnapshot {
  runId: string;
  status: VdtAgentRunStatus;
  phase: VdtAgentRunPhase;
  request: VdtAgentStartRequest;
  project?: VdtProject | undefined;
  draftProject?: VdtProject | undefined;
  selectedSkills: VdtAgentSelectedSkill[];
  events: VdtAgentEvent[];
  pendingQuestions?: VdtAgentQuestion[] | undefined;
  pendingPlan?: VdtBuildPlan | undefined;
  pendingChangeSet?: VdtChangeSet | undefined;
  finalReport?: string | undefined;
  error?: { code: string; message: string } | undefined;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | undefined;
}

export interface AgentEventInput {
  phase?: VdtAgentRunPhase | undefined;
  type: VdtAgentEventType;
  title: string;
  message: string;
  metadata?: Record<string, unknown> | undefined;
  patch?: VdtChangeSet | undefined;
  questions?: VdtAgentQuestion[] | undefined;
}

export interface VdtAgentRunState extends VdtAgentRunSnapshot {
  seq: number;
  abortController: AbortController;
  builder?: VdtBuilderSession | undefined;
  answers: Record<string, string | number | string[]>;
  manualChanges: Array<{ projectRevision?: number | undefined; change: ManualProjectChange; observedAt: string }>;
  recipes: VdtSkillRecipe[];
}
