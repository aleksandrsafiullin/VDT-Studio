import type { VdtChangeSet, VdtProject } from "@vdt-studio/vdt-core";

export type Sha256 = `sha256:${string}`;
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface ActorContextV1 {
  schemaVersion: "actor_context.v1";
  principalId: string;
  tenantId?: string | undefined;
  workspaceId?: string | undefined;
  projectId?: string | undefined;
  roles: string[];
  authSource: "desktop_local" | "hosted_session";
  sessionId: string;
  issuedAt: string;
}

export interface RevisionContentIdentityV1 {
  scheme: "legacy_graph_sha256" | "vdt_revision_payload_hash.v1";
  hash: Sha256;
}

export interface RevisionCommitIntentV1 {
  source: VdtRevisionRecord["source"];
  summary: string | null;
  validation: JsonValue | null;
  calculation: JsonValue | null;
}

export interface RevisionCommitCommandV2 {
  schemaVersion: "revision_commit.v2";
  expectedActiveRevisionId: string | null;
  expectedActiveContentIdentity: RevisionContentIdentityV1 | null;
  expectedCommitGeneration: number;
  expectedRuntimeGeneration: "v1" | "v2";
  expectedGenerationVersion: number;
  idempotencyKey: string;
  intent: RevisionCommitIntentV1;
}

export interface RevisionCommitInputV2 {
  projectId: string;
  vdtId: string;
  actor: ActorContextV1;
  command: RevisionCommitCommandV2;
  project: VdtProject;
}

export interface VdtRevisionHeadV2 {
  schemaVersion: "vdt_revision_head.v2";
  projectId: string;
  vdtId: string;
  activeRevisionId: string | null;
  activeContentIdentity: RevisionContentIdentityV1 | null;
  pendingRevisionId: string | null;
  commitGeneration: number;
}

export interface ProjectRuntimeStateV1 {
  schemaVersion: "project_runtime_state.v1";
  projectId: string;
  runtimeGeneration: "v1" | "v2";
  generationVersion: number;
  migrationState: "not_started" | "shadow_ready" | "migrating" | "v2_active" | "rollback_readonly";
  writeState: "enabled" | "disabled";
  updatedAt: string;
}

export type RevisionQuarantineReason =
  | "staged_payload_missing"
  | "staged_payload_mismatch"
  | "published_hash_mismatch"
  | "project_write_state_changed"
  | "ambiguous_recovery";

export interface RevisionCommitAttemptV1 {
  schemaVersion: "revision_commit_attempt.v1";
  operation: "revision.commit" | "vdt.create_with_initial";
  attemptId: string;
  projectId: string;
  vdtId: string;
  revisionId: string;
  actorPrincipalId: string;
  idempotencyKey: string;
  requestHash: Sha256;
  intent: RevisionCommitIntentV1;
  payloadContentIdentity: RevisionContentIdentityV1;
  payloadByteLength: number;
  payloadCanonicalJson: string;
  stagedPayloadRelativePath: string;
  finalRelativePath: string;
  expectedActiveRevisionId: string | null;
  expectedActiveContentIdentity: RevisionContentIdentityV1 | null;
  expectedCommitGeneration: number;
  expectedRuntimeGeneration: "v1" | "v2";
  expectedGenerationVersion: number;
  ownerToken: string;
  leaseGeneration: number;
  leaseExpiresAt: string;
  state:
    | "reserved"
    | "staged"
    | "head_reserved"
    | "published"
    | "completed"
    | "rejected"
    | "quarantined";
  createdAt: string;
  updatedAt: string;
  terminalCode?: string | undefined;
  quarantineReason?: RevisionQuarantineReason | undefined;
}

export interface RevisionCommitResultV2 {
  schemaVersion: "revision_commit_result.v2";
  status: "committed";
  revision: VdtRevisionRecord;
  head: VdtRevisionHeadV2;
}

export interface CreateVdtMetadataV1 {
  requestedVdtId: string | null;
  name: string;
  rootKpi: string;
  unit: string | null;
  timePeriod: string | null;
  status: VdtRecord["status"];
  metadata: JsonValue | null;
}

export interface CreateVdtWithInitialSnapshotCommandV1 {
  schemaVersion: "create_vdt_with_initial_snapshot.v1";
  projectId: string;
  expectedRuntimeGeneration: "v1" | "v2";
  expectedGenerationVersion: number;
  idempotencyKey: string;
  vdt: CreateVdtMetadataV1;
  revisionIntent: RevisionCommitIntentV1;
}

export interface CreateVdtWithInitialSnapshotInputV1 {
  actor: ActorContextV1;
  command: CreateVdtWithInitialSnapshotCommandV1;
  project: VdtProject;
}

export interface CreateVdtWithInitialSnapshotResultV1 {
  schemaVersion: "create_vdt_with_initial_snapshot_result.v1";
  status: "created";
  vdt: VdtRecord;
  revision: VdtRevisionRecord;
  head: VdtRevisionHeadV2;
}

export type RevisionCommitFaultPoint =
  | "after_attempt_reserved"
  | "after_stage_fsynced"
  | "after_head_reserved"
  | "after_final_published"
  | "before_finalize";

export type StorageMigrationFaultPoint =
  | "after_admission_fence_acquired"
  | "after_backup_fsynced"
  | "after_bootstrap_journal_fsynced"
  | "after_sequence_1_committed"
  | "before_sequence_2_commit"
  | "after_sequence_2_committed"
  | "after_later_backup_owner_fsynced"
  | "after_later_backup_fsynced"
  | "after_later_attempt_reserved"
  | "after_later_applying_persisted"
  | "before_later_migration_commit"
  | "after_foreign_key_pending_created"
  | "after_foreign_key_pending_file_fsynced"
  | "after_foreign_key_pending_fsynced"
  | "after_foreign_key_check_passed"
  | "after_foreign_key_pending_unlinked"
  | "after_foreign_key_violation_rollback"
  | "after_foreign_key_evidence_created"
  | "after_foreign_key_evidence_file_fsynced"
  | "after_foreign_key_evidence_fsynced"
  | "before_foreign_key_block_commit"
  | "after_foreign_key_block_committed"
  | "after_later_migration_committed"
  | "sequence3_before_sql"
  | "sequence3_after_sql"
  | "sequence3_before_transform_invocation"
  | "sequence3_after_transform_invocation"
  | "sequence3_before_adoption_row_insert"
  | "sequence3_after_adoption_row_insert"
  | "sequence3_after_all_adoptions_verified"
  | "sequence3_before_transform_application_insert"
  | "sequence3_after_transform_application_insert"
  | "sequence3_before_applied_migration_insert"
  | "sequence3_after_applied_migration_insert"
  | "sequence3_before_schema_migration_insert"
  | "sequence3_after_schema_migration_insert"
  | "sequence3_before_user_version_set"
  | "sequence3_after_user_version_set"
  | "sequence3_after_postcondition_verified"
  | "sequence3_after_migration_state_advanced"
  | "sequence3_after_attempt_completed"
  | "sequence3_before_foreign_key_pending_create"
  | "sequence3_before_foreign_key_pending_file_fsync"
  | "sequence3_before_foreign_key_pending_directory_fsync"
  | "sequence3_before_foreign_key_check"
  | "sequence3_before_foreign_key_pending_unlink"
  | "sequence3_before_foreign_key_pending_unlink_directory_fsync"
  | "sequence3_after_foreign_key_pending_unlink_directory_fsynced"
  | "sequence3_before_foreign_key_evidence_create"
  | "sequence3_before_foreign_key_evidence_file_fsync"
  | "sequence3_before_foreign_key_evidence_directory_fsync"
  | "sequence3_before_post_commit_cleanup"
  | "sequence3_after_post_commit_cleanup";

export interface StorageMigrationFaultContext {
  attemptId: string;
  sequence: number;
  migrationId: string;
  targetSequence: number;
  targetManifestHash: Sha256;
  leaseGeneration: number;
  adoptionIndex?: number | undefined;
  inputLegacyRunCount?: number | undefined;
  runId?: string | undefined;
}

export interface StorageMigrationManifestEntryV1 {
  sequence: number;
  migrationId: string;
  fromUserVersion: number;
  toUserVersion: number;
  sqlByteLength: number;
  sqlChecksum: Sha256;
  preconditionSchemaHash: Sha256;
  postconditionSchemaHash: Sha256;
  transactional: true;
}

export interface StorageMigrationManifestV1 {
  schemaVersion: "migration_manifest.v1";
  manifestVersion: number;
  manifestHash: Sha256;
  entries: StorageMigrationManifestEntryV1[];
}

export class VdtStorageError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false
  ) {
    super(message);
    this.name = "VdtStorageError";
  }
}

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
  idFactory?: (() => string) | undefined;
  ownerTokenFactory?: (() => string) | undefined;
  revisionLeaseMs?: number | undefined;
  migrationLeaseMs?: number | undefined;
  busyTimeoutMs?: number | undefined;
  faultInjector?: ((point: RevisionCommitFaultPoint, attempt: RevisionCommitAttemptV1) => void) | undefined;
  migrationFaultInjector?:
    | ((
        point: StorageMigrationFaultPoint,
        context?: StorageMigrationFaultContext
      ) => void)
    | undefined;
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
  /**
   * @deprecated Internal compatibility primitive for unmigrated V1 callers.
   * New production writers must use commitVdtRevision().
   */
  saveVdtRevision(input: CreateVdtRevisionInput): VdtRevisionRecord;
  commitVdtRevision(input: RevisionCommitInputV2): RevisionCommitResultV2;
  createVdtWithInitialSnapshot(
    input: CreateVdtWithInitialSnapshotInputV1
  ): CreateVdtWithInitialSnapshotResultV1;
  recoverRevisionCommits(): void;
  getProjectRuntimeState(projectId: string): ProjectRuntimeStateV1 | null;
  getVdtRevisionHead(vdtId: string): VdtRevisionHeadV2 | null;
  getRevisionCommitAttempt(attemptId: string): RevisionCommitAttemptV1 | null;
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
