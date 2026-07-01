import type {
  CalculationTraceItem,
  VdtBuilderSession,
  VdtChangeSet,
  VdtEdgeRelation,
  VdtNodeStatus,
  VdtNodeType,
  VdtProject,
  VdtWarning
} from "@vdt-studio/vdt-core";
import type { VdtAgentQuestion, VdtSkillRecipe } from "@vdt-studio/vdt-agent";
import type { AgentDomainPolicySummary } from "./domain-policies";
import type { AgentStructuredFeedback } from "./feedback";

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
  | "previewing_mutation"
  | "validating_graph"
  | "repairing_graph"
  | "applying_graph"
  | "reporting";

export type ResearchMode = "auto" | "on" | "off";

export interface ResearchProviderStatus {
  providerConfigured: boolean;
  providerId: string;
}

export type VdtAgentEventType =
  | "run_started"
  | "classification"
  | "skill_search"
  | "skill_selected"
  | "skill_read"
  | "clarifying_questions"
  | "user_answer_received"
  | "user_instruction"
  | "assistant_message"
  | "plan_proposed"
  | "tool_call_started"
  | "tool_call_completed"
  | "mutation_proposed"
  | "mutation_applied"
  | "mutation_rejected"
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

export type PublicAgentStatusPhase =
  | "reading_request"
  | "asking_questions"
  | "planning_model"
  | "running_subagents"
  | "building_draft"
  | "checking_model"
  | "waiting_user"
  | "ready"
  | "retryable_error";

export interface PublicAgentStatus {
  phase: PublicAgentStatusPhase;
  message: string;
  updatedAt: string;
  progress?: {
    completed: number;
    total: number;
  } | undefined;
}

export interface AgentAnswerPayload {
  questionId: string;
  selectedOptionIds?: string[] | undefined;
  freeText?: string | undefined;
  fields?: Record<string, string | number> | undefined;
}

export type AgentChatMessageKind =
  | "instruction"
  | "answer"
  | "assistant_message"
  | "question"
  | "status"
  | "draft_ready"
  | "retryable_error"
  | "final_report";

export interface AgentChatMessage {
  id: string;
  runId: string;
  role: "user" | "assistant" | "system";
  kind: AgentChatMessageKind;
  text?: string | undefined;
  questions?: VdtAgentQuestion[] | undefined;
  answers?: AgentAnswerPayload[] | undefined;
  status?: PublicAgentStatus | undefined;
  createdAt: string;
}

export interface AgentThreadContext {
  threadId: string;
  visibleTitle: string;
  brief: {
    rootKpi: string;
    unit?: string | undefined;
    period?: string | undefined;
    industry?: string | undefined;
    businessContext?: string | undefined;
  };
  project?: {
    id: string;
    name: string;
    rootNodeName: string;
    rootNodeUnit?: string | undefined;
  } | undefined;
  visibleMessages: AgentChatMessage[];
}

export interface RetryableAgentError {
  code: "TIMEOUT" | "PROVIDER_UNAVAILABLE" | "SCHEMA_REPAIR_FAILED" | "STRUCTURED_OUTPUT_FAILED" | "SUBAGENT_FAILED";
  message: string;
  failedStepId?: string | undefined;
  failedSubagentTaskId?: string | undefined;
  retryCount: number;
  createdAt: string;
}

export interface AgentArtifact {
  id: string;
  runId: string;
  type:
    | "brief_summary"
    | "decomposition_plan"
    | "formula_plan"
    | "unit_report"
    | "critic_report"
    | "draft_project"
    | "patch"
    | "memory_patch";
  summary: string;
  payload: unknown;
  createdAt: string;
}

export interface SubagentTask {
  id: string;
  runId: string;
  type:
    | "brief_alignment"
    | "level_decomposition"
    | "formula_builder"
    | "critic"
    | "memory_curator";
  status: "queued" | "running" | "succeeded" | "failed_retryable" | "failed";
  inputArtifactId: string;
  publicStatus?: string | undefined;
  startedAt?: string | undefined;
  heartbeatAt?: string | undefined;
  completedAt?: string | undefined;
  timeoutMs: number;
  retryCount: number;
}

export interface SubagentReport {
  taskId: string;
  status: "succeeded" | "needs_user_input" | "failed_retryable" | "failed";
  summaryForOrchestrator: string;
  userFacingSummary?: string | undefined;
  proposedQuestions?: VdtAgentQuestion[] | undefined;
  proposedMutationArtifactId?: string | undefined;
  proposedPatchArtifactId?: string | undefined;
  proposedProjectArtifactId?: string | undefined;
  assumptions?: string[] | undefined;
  risks?: string[] | undefined;
  confidence?: number | undefined;
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

export interface VdtAgentWorkspaceContext {
  projectId: string;
  projectName?: string | undefined;
  industry?: string | undefined;
  description?: string | undefined;
}

export interface VdtAgentStartRequest {
  mode: VdtAgentMode;
  input: VdtAgentStartInput;
  workspace?: VdtAgentWorkspaceContext | undefined;
  providerId: string;
  providerConfig?: Record<string, unknown> | undefined;
  options?: {
    autoApplyPatches?: boolean | undefined;
    askBeforeFirstPatch?: boolean | undefined;
    maxSteps?: number | undefined;
    maxAutoDepth?: number | undefined;
    continueWithAssumptions?: boolean | undefined;
    researchMode?: ResearchMode | undefined;
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

export interface NodeSummary {
  id: string;
  name: string;
  type: VdtNodeType;
  unit?: string | undefined;
  formula?: string | undefined;
  baselineValue?: number | undefined;
  value?: number | undefined;
  status: VdtNodeStatus;
  childIds: string[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  rootNodeId: string;
  nodeCount: number;
  edgeCount: number;
  nodes: NodeSummary[];
  edges: Array<{
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    relation: VdtEdgeRelation;
  }>;
  truncated: boolean;
}

export interface ValidationIssueSummary {
  type: VdtWarning["type"];
  severity: VdtWarning["severity"];
  message: string;
  nodeId?: string | undefined;
  edgeId?: string | undefined;
  repairHints?: string[] | undefined;
}

export interface ValidationStateSummary {
  valid: boolean;
  errors: ValidationIssueSummary[];
  warnings: ValidationIssueSummary[];
}

export interface CalculationStateSummary {
  rootNodeId: string;
  rootValue?: number | undefined;
  valueCount: number;
  errors: ValidationIssueSummary[];
  warnings: ValidationIssueSummary[];
  tracePreview: CalculationTraceItem[];
}

export type MutationProposalSource = "agent" | "user" | "repair" | "import";

export type MutationProposalStatus = "proposed" | "approved" | "rejected" | "applied" | "failed";

export interface MutationPolicy {
  autoApply: boolean;
  askBeforeFirstPatch: boolean;
  requireApprovalForGraphStructure: boolean;
  requireApprovalForFormulaChanges: boolean;
  requireApprovalForDelete: boolean;
}

export interface ProgressiveMutationScope {
  targetNodeId: string;
  maxDepthDelta: 1;
  maxNodesPerLayer: number;
  allowGrandchildrenInSingleMutation: false;
}

export interface ProgressiveBuildState {
  rootNodeId: string;
  currentDepth: number;
  maxAutoDepth: number;
  completedLayerNodeIds: string[];
  frontierNodeIds: string[];
  blockedNodeIds: Array<{
    nodeId: string;
    reason: "missing_data" | "ambiguous_logic" | "needs_user_choice" | "low_confidence" | "validation_blocked";
    questionIds: string[];
  }>;
}

export type ProgressiveBuildSummary = Omit<ProgressiveBuildState, "maxAutoDepth">;

export type AgentContinuationDecision =
  | {
      type: "continue_auto";
      targetNodeId: string;
      reason: string;
    }
  | {
      type: "ask_user";
      questions: VdtAgentQuestion[];
    }
  | {
      type: "finish_current_depth";
      summary: string;
      nextSuggestedTargets: string[];
    };

export interface MutationProposal {
  id: string;
  runId: string;
  projectId: string;
  vdtId: string;
  baseRevisionId: string;
  baseRevision: number;
  source: MutationProposalSource;
  title: string;
  summary: string;
  changeSet: VdtChangeSet;
  selectedChangeIds: string[];
  previewProject: VdtProject;
  validation: ValidationStateSummary;
  calculation?: CalculationStateSummary | undefined;
  status: MutationProposalStatus;
  policy: MutationPolicy;
  progressiveScope?: ProgressiveMutationScope | undefined;
  createdAt: string;
  appliedAt?: string | undefined;
  rejectedAt?: string | undefined;
  failureReason?: string | undefined;
}

export interface ManualChangeSummary {
  observedAt: string;
  projectRevision?: number | undefined;
  kind: ManualProjectChange["kind"];
  nodeId?: string | undefined;
  edgeId?: string | undefined;
  summary?: string | undefined;
}

export interface AgentEventSummary {
  id: string;
  seq: number;
  type: VdtAgentEventType;
  phase: VdtAgentRunPhase;
  title: string;
  message: string;
  metadata?: Record<string, unknown> | undefined;
}

export interface AgentToolSpec {
  name: string;
  description: string;
  inputJsonSchema: unknown;
  mutatesProject: boolean;
  requiresDraftProject: boolean;
  phase: VdtAgentRunPhase;
}

export interface AgentToolResultEnvelope {
  toolName: string;
  ok: boolean;
  output?: unknown | undefined;
  error?: {
    code: string;
    message: string;
    details?: unknown | undefined;
  } | undefined;
  projectChanged: boolean;
  validation?: ValidationStateSummary | undefined;
  mutationProposal?: Pick<MutationProposal, "id" | "status" | "title" | "summary" | "selectedChangeIds"> | undefined;
  emittedEventIds: string[];
}

export interface AgentDecisionContext {
  runId: string;
  mode: VdtAgentMode;
  step: number;
  userRequest: VdtAgentStartInput;
  researchPolicy: {
    mode: ResearchMode;
    providerConfigured?: boolean | undefined;
    guidance: string;
  };
  briefReadiness: {
    rootKpiIsPlaceholder: boolean;
    directionStatus: "ready" | "needs_agent_judgment";
    guidance: string;
  };
  continuationPolicy: {
    continueWithAssumptions: boolean;
    maxNodesPerLayer: number;
    askOnlyWhen: Array<
      | "missing_data"
      | "business_choice"
      | "scope_conflict"
      | "ambiguous_logic"
      | "low_confidence"
      | "formula_ambiguity"
    >;
  };
  currentProject?: ProjectSummary | undefined;
  visibleContext: AgentThreadContext;
  selectedNode?: NodeSummary | undefined;
  selectedSkills: VdtAgentSelectedSkill[];
  domainPolicies: AgentDomainPolicySummary[];
  availableTools: AgentToolSpec[];
  recentEvents: AgentEventSummary[];
  userAnswers: Record<string, string | number | string[]>;
  manualChanges: ManualChangeSummary[];
  subagentReports: Array<Pick<SubagentReport, "taskId" | "status" | "summaryForOrchestrator" | "confidence">>;
  lastToolResult?: AgentToolResultEnvelope | undefined;
  lastFeedback?: AgentStructuredFeedback | undefined;
  recentFeedback?: AgentStructuredFeedback[] | undefined;
  pendingMutationProposal?: MutationProposal | undefined;
  progressiveBuild?: ProgressiveBuildSummary | undefined;
  validationState?: ValidationStateSummary | undefined;
  calculationState?: CalculationStateSummary | undefined;
  constraints: {
    maxOneToolCallPerDecision: true;
    mustUseToolsForGraphChanges: true;
    cannotReturnFullGraph: true;
    cannotExposeHiddenReasoning: true;
    mustUseFeedbackBeforeRetry: true;
  };
}

export type AgentUserMessage =
  | {
      type: "user_answer";
      answers?: Record<string, string | number | string[]> | undefined;
      structuredAnswers?: AgentAnswerPayload[] | undefined;
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
      researchMode?: ResearchMode | undefined;
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
  chatMessages: AgentChatMessage[];
  publicStatus: PublicAgentStatus;
  visibleContext: AgentThreadContext;
  pendingQuestions?: VdtAgentQuestion[] | undefined;
  pendingPlan?: VdtBuildPlan | undefined;
  pendingChangeSet?: VdtChangeSet | undefined;
  pendingMutationProposal?: MutationProposal | undefined;
  finalReport?: string | undefined;
  error?: { code: string; message: string } | undefined;
  retryableError?: RetryableAgentError | undefined;
  feedbackHistory?: AgentStructuredFeedback[] | undefined;
  lastFeedback?: AgentStructuredFeedback | undefined;
  repairAttemptCount?: number | undefined;
  artifacts?: AgentArtifact[] | undefined;
  mutationProposals?: MutationProposal[] | undefined;
  progressiveBuild?: ProgressiveBuildState | undefined;
  subagentTasks?: SubagentTask[] | undefined;
  subagentReports?: SubagentReport[] | undefined;
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
  chatSeq: number;
  firstResponseCompleted: boolean;
  abortController: AbortController;
  builder?: VdtBuilderSession | undefined;
  answers: Record<string, string | number | string[]>;
  manualChanges: Array<{ projectRevision?: number | undefined; change: ManualProjectChange; observedAt: string }>;
  recipes: VdtSkillRecipe[];
  lastToolResult?: AgentToolResultEnvelope | undefined;
  feedbackHistory?: AgentStructuredFeedback[] | undefined;
  lastFeedback?: AgentStructuredFeedback | undefined;
  repairAttemptCount?: number | undefined;
  mutationProposals?: MutationProposal[] | undefined;
  pendingMutationProposal?: MutationProposal | undefined;
  progressiveBuild?: ProgressiveBuildState | undefined;
  validationState?: ValidationStateSummary | undefined;
  calculationState?: CalculationStateSummary | undefined;
  memoryNotes: Array<{ note: string; tags: string[]; createdAt: string }>;
}
