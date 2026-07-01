import type { VdtChangeSet, VdtProject } from "@vdt-studio/vdt-core";

export interface ProjectRecord {
  id: string;
  name: string;
  description?: string | undefined;
  industry?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface VdtRecord {
  id: string;
  projectId: string;
  name: string;
  rootKpi: string;
  unit?: string | undefined;
  timePeriod?: string | undefined;
  status: "draft" | "reviewed" | "approved" | "archived";
  activeRevisionId?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface VdtRevisionRecord {
  id: string;
  vdtId: string;
  revisionNo: number;
  parentRevisionId?: string | undefined;
  source: "user" | "agent" | "import" | "scenario" | "repair";
  summary?: string | undefined;
  filePath: string;
  graphHash: string;
  validation?: unknown;
  calculation?: unknown;
  createdAt: string;
}

export interface ConversationRecord {
  id: string;
  projectId: string;
  vdtId?: string | undefined;
  title?: string | undefined;
  mode: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  agentRunId?: string | undefined;
  events?: unknown[] | undefined;
  attachments?: unknown[] | undefined;
  producedFiles?: unknown[] | undefined;
  runContext?: Record<string, unknown> | undefined;
  position: number;
  createdAt: string;
  startedAt?: string | undefined;
  endedAt?: string | undefined;
}

export interface AgentRunRecord {
  id: string;
  projectId: string;
  vdtId?: string | undefined;
  conversationId?: string | undefined;
  status: string;
  phase: string;
  request: Record<string, unknown>;
  publicSnapshot?: Record<string, unknown> | undefined;
  internalState?: Record<string, unknown> | undefined;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | undefined;
}

export interface AgentEventRecord {
  id: string;
  runId: string;
  seq: number;
  type: string;
  phase: string;
  title: string;
  message: string;
  metadata?: Record<string, unknown> | undefined;
  createdAt: string;
}

export interface MutationProposalRecord {
  id: string;
  runId: string;
  projectId: string;
  vdtId: string;
  baseRevisionId: string;
  status: "proposed" | "approved" | "rejected" | "applied" | "failed";
  title: string;
  summary?: string | undefined;
  changeSet: VdtChangeSet;
  previewFilePath?: string | undefined;
  validation?: unknown;
  calculation?: unknown;
  createdAt: string;
  appliedAt?: string | undefined;
}

export interface VdtComparisonRecord {
  id: string;
  projectId: string;
  leftVdtId: string;
  rightVdtId: string;
  leftRevisionId: string;
  rightRevisionId: string;
  result: unknown;
  summary?: string | undefined;
  createdAt: string;
}

export interface ProjectManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  industry?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface OpenVdtDatabaseOptions {
  dataDir?: string | undefined;
  now?: (() => string) | undefined;
}

export interface CreateProjectInput {
  id: string;
  name: string;
  description?: string | undefined;
  industry?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface CreateVdtInput {
  id: string;
  projectId: string;
  name: string;
  rootKpi: string;
  unit?: string | undefined;
  timePeriod?: string | undefined;
  status?: VdtRecord["status"] | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export type UpdateProjectInput = Pick<
  Partial<ProjectRecord>,
  "name" | "description" | "industry" | "metadata"
>;

export type UpdateVdtInput = Pick<
  Partial<VdtRecord>,
  "name" | "rootKpi" | "unit" | "timePeriod" | "status" | "metadata"
>;

export interface CreateVdtRevisionInput {
  id: string;
  vdtId: string;
  projectId: string;
  revisionNo: number;
  project: VdtProject;
  parentRevisionId?: string | undefined;
  source: VdtRevisionRecord["source"];
  summary?: string | undefined;
  validation?: unknown;
  calculation?: unknown;
}

export interface VdtDatabase {
  readonly dataDir: string;
  readonly databasePath: string;
  close(): void;
  createProject(input: CreateProjectInput): ProjectRecord;
  getProject(projectId: string): ProjectRecord | null;
  updateProject(projectId: string, patch: UpdateProjectInput): ProjectRecord;
  deleteProject(projectId: string): boolean;
  listProjects(): ProjectRecord[];
  createVdt(input: CreateVdtInput): VdtRecord;
  getVdt(vdtId: string): VdtRecord | null;
  updateVdt(vdtId: string, patch: UpdateVdtInput): VdtRecord;
  deleteVdt(vdtId: string): boolean;
  listVdts(projectId: string): VdtRecord[];
  saveVdtRevision(input: CreateVdtRevisionInput): VdtRevisionRecord;
  readVdtRevision(record: VdtRevisionRecord): VdtProject;
  getVdtRevision(revisionId: string): VdtRevisionRecord | null;
  listVdtRevisions(vdtId: string): VdtRevisionRecord[];
  createConversation(input: {
    id: string;
    projectId: string;
    vdtId?: string | undefined;
    title?: string | undefined;
    mode?: string | undefined;
  }): ConversationRecord;
  updateConversation(
    conversationId: string,
    patch: Pick<Partial<ConversationRecord>, "vdtId" | "title" | "mode">
  ): ConversationRecord;
  appendMessage(input: Omit<MessageRecord, "createdAt" | "position"> & { position?: number | undefined }): MessageRecord;
  getConversation(conversationId: string): ConversationRecord | null;
  listConversations(projectId: string): ConversationRecord[];
  listMessages(conversationId: string): MessageRecord[];
  createAgentRun(input: Omit<AgentRunRecord, "createdAt" | "updatedAt">): AgentRunRecord;
  updateAgentRun(runId: string, patch: Partial<Omit<AgentRunRecord, "id" | "projectId" | "createdAt">>): AgentRunRecord;
  getAgentRun(runId: string): AgentRunRecord | null;
  listAgentRuns(projectId: string): AgentRunRecord[];
  appendAgentEvent(input: Omit<AgentEventRecord, "id" | "createdAt"> & { id?: string | undefined }): AgentEventRecord;
  listAgentEvents(runId: string): AgentEventRecord[];
  createMutationProposal(input: Omit<MutationProposalRecord, "createdAt"> & { createdAt?: string | undefined }): MutationProposalRecord;
  updateMutationProposal(proposalId: string, patch: Pick<Partial<MutationProposalRecord>, "status" | "appliedAt" | "validation" | "calculation" | "previewFilePath">): MutationProposalRecord;
  getMutationProposal(proposalId: string): MutationProposalRecord | null;
  listMutationProposals(runId: string): MutationProposalRecord[];
  listProjectMutationProposals(projectId: string): MutationProposalRecord[];
  createComparison(input: Omit<VdtComparisonRecord, "createdAt">): VdtComparisonRecord;
  getComparison(comparisonId: string): VdtComparisonRecord | null;
  listComparisons(projectId: string): VdtComparisonRecord[];
}
