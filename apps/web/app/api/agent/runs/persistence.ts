import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  assertSafeId,
  openVdtDatabase,
  validateStrictVdtProjectCommit,
  vdtPreviewDir,
  VdtStorageError,
  type ActorContextV1,
  type CreateVdtWithInitialSnapshotCommandV1,
  type JsonValue,
  type ProjectRuntimeStateV1,
  type RevisionCommitCommandV2,
  type RevisionCommitIntentV1,
  type RevisionCommitResultV2,
  type RevisionContentIdentityV1,
  type VdtDatabase,
  type VdtRecord,
  type VdtRevisionHeadV2,
  type VdtRevisionRecord
} from "@vdt-studio/storage";
import {
  hydrateAgentRunState,
  serializeAgentRunState,
  snapshotFromState,
  type AgentRunPersistence,
  type AgentChatMessage,
  type MutationProposal,
  type PersistedAgentRunState,
  type VdtAgentEvent,
  type VdtAgentRunState,
  type VdtAgentWorkspaceContext
} from "@vdt-studio/vdt-agent-runtime";
import type { VdtProject } from "@vdt-studio/vdt-core";
import { createStorageWriteActor } from "@/app/api/vdt/storage-write-adapter";

const DEFAULT_AGENT_PROJECT_ID = "project_agent_workspace";
const DEFAULT_AGENT_PROJECT_NAME = "VDT Studio workspace";
const STORAGE_REPLAY_STATE_KEY = "__vdtStorageReplayStateV1";

export function openAgentRunPersistenceDatabase(projectRoot: string): VdtDatabase {
  const dataDir = process.env.VDT_DATA_DIR ?? defaultDataDir(projectRoot);
  return openVdtDatabase(projectRoot, { dataDir });
}

interface SqliteAgentRunPersistenceOptions {
  actorFactory?: ((projectId: string) => ActorContextV1) | undefined;
}

interface LazySqliteAgentRunPersistenceOptions
  extends SqliteAgentRunPersistenceOptions {
  databaseFactory?: (() => VdtDatabase) | undefined;
}

interface AgentInitialCombinedReplayV1 {
  kind: "combined_create";
  projectId: string;
  vdtId: string;
  command: CreateVdtWithInitialSnapshotCommandV1;
  project: VdtProject;
}

interface AgentInitialRevisionReplayV1 {
  kind: "initial_revision";
  projectId: string;
  vdtId: string;
  command: RevisionCommitCommandV2;
  project: VdtProject;
}

interface AgentLegacyInitialBasisV1 {
  kind: "legacy_verified";
  projectId: string;
  vdtId: string;
  revisionId: string;
  contentIdentity: {
    scheme: "legacy_graph_sha256";
    hash: `sha256:${string}`;
  };
}

interface AgentExistingHeadReplayV1 {
  kind: "existing_head_verified";
  projectId: string;
  vdtId: string;
  revisionId: string;
  contentIdentity: RevisionContentIdentityV1;
}

type AgentInitialReplayV1 =
  | AgentInitialCombinedReplayV1
  | AgentInitialRevisionReplayV1
  | AgentLegacyInitialBasisV1
  | AgentExistingHeadReplayV1;

interface AgentProposalCommitReplayV1 {
  proposalStorageId: string;
  projectId: string;
  vdtId: string;
  command: RevisionCommitCommandV2;
  project: VdtProject;
  proposal: MutationProposal;
}

interface AgentStorageReplayStateV1 {
  schemaVersion: "agent_storage_replay_state.v1";
  initial: AgentInitialReplayV1;
  proposals: AgentProposalCommitReplayV1[];
}

interface ExecutedProposalReplayV1 {
  replay: AgentProposalCommitReplayV1;
  committed: RevisionCommitResultV2;
}

interface ExecutedStorageReplayStateV1 {
  initialRevisionId: string;
  tipRevisionId: string;
  tipContentIdentity: RevisionContentIdentityV1;
  proposals: ExecutedProposalReplayV1[];
}

interface PersistMutationProposalResultV1 {
  replayState: AgentStorageReplayStateV1;
  tipRevisionId: string;
  tipContentIdentity: RevisionContentIdentityV1;
}

export function createLazySqliteAgentRunPersistence(
  projectRoot: string,
  options: LazySqliteAgentRunPersistenceOptions = {}
): AgentRunPersistence {
  let delegate: AgentRunPersistence | undefined;
  const persistence = (): AgentRunPersistence => {
    if (delegate) return delegate;
    const database =
      options.databaseFactory?.() ??
      openAgentRunPersistenceDatabase(projectRoot);
    delegate = createSqliteAgentRunPersistence(database, {
      actorFactory: options.actorFactory
    });
    return delegate;
  };
  return {
    createRun(state) {
      persistence().createRun(state);
    },
    updateRun(state) {
      persistence().updateRun(state);
    },
    appendEvent(event, state) {
      persistence().appendEvent(event, state);
    },
    getState(runId) {
      return persistence().getState(runId);
    },
    getSnapshot(runId) {
      return persistence().getSnapshot(runId);
    }
  };
}

export function createSqliteAgentRunPersistence(
  database: VdtDatabase,
  options: SqliteAgentRunPersistenceOptions = {}
): AgentRunPersistence {
  const actorFactory = options.actorFactory ?? createStorageWriteActor;
  return {
    createRun(state) {
      const projectContext = storageProjectContextFromState(state);
      const actor = actorFactory(projectContext.projectId);
      ensureStorageProject(database, state, projectContext);
      const conversationId = ensureConversation(database, projectContext.projectId, state);
      const payload = persistedRunPayload(state);
      database.createAgentRun({
        id: state.runId,
        projectId: projectContext.projectId,
        vdtId: vdtIdFromState(state),
        conversationId,
        status: state.status,
        phase: state.phase,
        request: payload.request,
        publicSnapshot: payload.publicSnapshot,
        internalState: payload.internalState,
        completedAt: state.completedAt
      });
      persistConversationMessages(database, state, conversationId);
      const replayState = persistRunArtifacts(
        database,
        state,
        projectContext,
        actor
      );
      if (replayState) {
        updatePersistedAgentRun(
          database,
          state,
          conversationId,
          replayState
        );
      }
    },
    updateRun(state) {
      const projectContext = storageProjectContextFromState(state);
      const actor = actorFactory(projectContext.projectId);
      ensureStorageProject(database, state, projectContext);
      const replayState = persistRunArtifacts(
        database,
        state,
        projectContext,
        actor
      );
      const conversationId = ensureConversation(database, projectContext.projectId, state);
      persistConversationMessages(database, state, conversationId);
      updatePersistedAgentRun(
        database,
        state,
        conversationId,
        replayState
      );
    },
    appendEvent(event, state) {
      const projectContext = storageProjectContextFromState(state);
      const actor = actorFactory(projectContext.projectId);
      ensureStorageProject(database, state, projectContext);
      appendEventIfNew(database, event);
      const replayState = persistRunArtifacts(
        database,
        state,
        projectContext,
        actor
      );
      const conversationId = ensureConversation(database, projectContext.projectId, state);
      persistConversationMessages(database, state, conversationId);
      updatePersistedAgentRun(
        database,
        state,
        conversationId,
        replayState
      );
    },
    getState(runId) {
      const record = database.getAgentRun(runId);
      const persisted = record?.internalState as PersistedAgentRunState | undefined;
      if (!persisted) return null;
      return reconcilePersistedReplayState(
        database,
        hydrateAgentRunState(persisted),
        replayStateFromInternalState(record?.internalState),
        actorFactory
      );
    },
    getSnapshot(runId) {
      const state = this.getState(runId);
      return state ? snapshotFromState(state) : null;
    }
  };
}

function persistedRunPayload(
  state: VdtAgentRunState,
  replayState?: AgentStorageReplayStateV1 | undefined
): {
  request: Record<string, unknown>;
  publicSnapshot: Record<string, unknown>;
  internalState: Record<string, unknown>;
} {
  const internalState = serializeAgentRunState(state);
  return {
    request: internalState.snapshot.request as unknown as Record<string, unknown>,
    publicSnapshot: internalState.snapshot as unknown as Record<string, unknown>,
    internalState: {
      ...internalState,
      ...(replayState ? { [STORAGE_REPLAY_STATE_KEY]: replayState } : {})
    } as unknown as Record<string, unknown>
  };
}

function persistRunArtifacts(
  database: VdtDatabase,
  state: VdtAgentRunState,
  projectContext: StorageProjectContext,
  actor: ActorContextV1
): AgentStorageReplayStateV1 | undefined {
  const project = state.draftProject ?? state.project;
  const existingReplayState = replayStateForRun(database, state.runId);
  if (!project) return existingReplayState;

  const initial = ensureInitialAgentVdt(
    database,
    projectContext.projectId,
    state,
    project,
    actor,
    existingReplayState
  );
  let replayState: AgentStorageReplayStateV1 = {
    schemaVersion: "agent_storage_replay_state.v1",
    initial: initial.replay,
    proposals: existingReplayState?.proposals ?? []
  };

  const executed = existingReplayState
    ? executeStorageReplayState(
        database,
        existingReplayState,
        () => actor,
        existingReplayState.initial.kind === "existing_head_verified" ||
          existingReplayState.proposals.length > 0
      )
    : initial.executed;
  if (!executed) {
    throw new VdtStorageError(
      "AMBIGUOUS_REVISION_RECOVERY",
      `Run ${state.runId} has no verified storage replay tip.`
    );
  }
  let tipRevisionId = executed.tipRevisionId;
  let tipContentIdentity = executed.tipContentIdentity;

  for (const proposal of state.mutationProposals ?? []) {
    const persisted = persistMutationProposal(
      database,
      projectContext.projectId,
      state,
      initial.vdtId,
      proposal,
      actor,
      replayState,
      tipRevisionId,
      tipContentIdentity
    );
    replayState = persisted.replayState;
    tipRevisionId = persisted.tipRevisionId;
    tipContentIdentity = persisted.tipContentIdentity;
  }
  return replayState;
}

function ensureInitialAgentVdt(
  database: VdtDatabase,
  projectId: string,
  state: VdtAgentRunState,
  project: VdtProject,
  actor: ActorContextV1,
  persistedReplayState?: AgentStorageReplayStateV1 | undefined
): {
  vdtId: string;
  replay: AgentInitialReplayV1;
  executed?: ExecutedStorageReplayStateV1 | undefined;
} {
  const context = storageProjectContextFromState(state);
  const vdtId = storageVdtId(state, project, context);
  if (context.vdtId) {
    validateBoundStorageVdt(database, vdtId, projectId);
  }
  const idempotencyKey = initialAgentIdempotencyKey(state, vdtId);
  if (persistedReplayState) {
    const persistedReplay = persistedReplayState.initial;
    if (
      persistedReplay.projectId !== projectId ||
      persistedReplay.vdtId !== vdtId
    ) {
      throw new VdtStorageError(
        "IDEMPOTENCY_KEY_REUSE",
        `Persisted initial replay basis does not match run ${state.runId}.`
      );
    }
    return { vdtId, replay: persistedReplay };
  }

  const rootNode = project.graph.nodes.find((node) => node.id === project.rootNodeId);
  const runtime = requireProjectRuntimeState(database, projectId);
  const intent: RevisionCommitIntentV1 = {
    source: "agent",
    summary: "Initial VDT draft",
    validation: jsonOrNull(state.validationState),
    calculation: jsonOrNull(state.calculationState)
  };
  validateStrictVdtProjectCommit(project);
  const existing = database.getVdt(vdtId);
  if (!existing) {
    const replay: AgentInitialCombinedReplayV1 = {
      kind: "combined_create",
      projectId,
      vdtId,
      command: {
        schemaVersion: "create_vdt_with_initial_snapshot.v1",
        projectId,
        expectedRuntimeGeneration: runtime.runtimeGeneration,
        expectedGenerationVersion: runtime.generationVersion,
        idempotencyKey,
        vdt: {
          requestedVdtId: vdtId,
          name:
            project.name ||
            `${rootNode?.name ?? state.request.input.rootKpi ?? "Value driver tree"} VDT`,
          rootKpi:
            rootNode?.name ??
            state.request.input.rootKpi ??
            "Value driver tree",
          unit: rootNode?.unit ?? state.request.input.unit ?? null,
          timePeriod: state.request.input.timePeriod ?? null,
          status: "draft",
          metadata: {
            sourceRunId: state.runId,
            sourceProjectId: project.id
          }
        },
        revisionIntent: intent
      },
      project
    };
    persistReplayCheckpoint(database, state, {
      schemaVersion: "agent_storage_replay_state.v1",
      initial: replay,
      proposals: []
    });
    const executedInitial = executeInitialReplay(database, actor, replay, true);
    return {
      vdtId,
      replay,
      executed: executedStorageReplayWithoutProposals(executedInitial)
    };
  }

  const head = database.getVdtRevisionHead(vdtId);
  if (!head || head.projectId !== projectId || existing.projectId !== projectId) {
    throw new VdtStorageError(
      "VDT_NOT_READY",
      `Existing agent VDT ${vdtId} is not a ready project-owned record.`
    );
  }
  if (head.activeRevisionId !== null) {
    const replay = reconstructExistingInitialReplay(
      database,
      state,
      existing,
      head,
      runtime
    );
    persistReplayCheckpoint(database, state, {
      schemaVersion: "agent_storage_replay_state.v1",
      initial: replay,
      proposals: []
    });
    const executedInitial = executeInitialReplay(database, actor, replay, true);
    return {
      vdtId,
      replay,
      executed: executedStorageReplayWithoutProposals(executedInitial)
    };
  }
  if (
    head.activeContentIdentity !== null ||
    head.pendingRevisionId !== null ||
    head.commitGeneration !== 0 ||
    database.listVdtRevisions(vdtId).length !== 0
  ) {
    throw new VdtStorageError(
      "REVISION_CONFLICT",
      `Existing agent VDT ${vdtId} is not an empty atomic-commit target.`
    );
  }
  const replay: AgentInitialRevisionReplayV1 = {
    kind: "initial_revision",
    projectId,
    vdtId,
    command: {
      schemaVersion: "revision_commit.v2",
      expectedActiveRevisionId: null,
      expectedActiveContentIdentity: null,
      expectedCommitGeneration: 0,
      expectedRuntimeGeneration: runtime.runtimeGeneration,
      expectedGenerationVersion: runtime.generationVersion,
      idempotencyKey,
      intent
    },
    project
  };
  persistReplayCheckpoint(database, state, {
    schemaVersion: "agent_storage_replay_state.v1",
    initial: replay,
    proposals: []
  });
  const executedInitial = executeInitialReplay(database, actor, replay, true);
  return {
    vdtId,
    replay,
    executed: executedStorageReplayWithoutProposals(executedInitial)
  };
}

function persistMutationProposal(
  database: VdtDatabase,
  projectId: string,
  state: VdtAgentRunState,
  vdtId: string,
  proposal: MutationProposal,
  actor: ActorContextV1,
  replayState: AgentStorageReplayStateV1,
  verifiedTipRevisionId: string,
  verifiedTipContentIdentity: RevisionContentIdentityV1
): PersistMutationProposalResultV1 {
  const proposalId = storageProposalId(proposal);
  let replay = replayState.proposals.find(
    (item) => item.proposalStorageId === proposalId
  );
  const wasAlreadyRecorded = replay !== undefined;
  validateStrictVdtProjectCommit(proposal.previewProject);
  const previewFilePath = writePreviewProject(database, projectId, vdtId, proposal);
  const baseRevision = resolveProposalBaseRevision(
    database,
    vdtId,
    proposal,
    replayState,
    state,
    replay,
    verifiedTipRevisionId
  );
  if (!baseRevision) {
    throw new VdtStorageError(
      "REVISION_CONFLICT",
      usesPersistedHeadAsProposalBase(replayState, state)
        ? `Proposal ${proposal.id} cannot resolve the persisted VDT head.`
        : `Proposal ${proposal.id} base revision ${proposal.baseRevision} is not persisted.`
    );
  }
  const existing = database.getMutationProposal(proposalId);
  const stagedStatus =
    existing?.status === "applied"
      ? "applied"
      : proposal.status === "applied"
        ? "approved"
        : proposal.status;
  if (existing) {
    database.updateMutationProposal(proposalId, {
      status: stagedStatus,
      appliedAt:
        stagedStatus === "applied" ? existing.appliedAt : undefined,
      previewFilePath,
      validation: proposal.validation,
      calculation: proposal.calculation
    });
  } else {
    database.createMutationProposal({
      id: proposalId,
      runId: state.runId,
      projectId,
      vdtId,
      baseRevisionId: baseRevision.id,
      status: stagedStatus,
      title: proposal.title,
      summary: proposal.summary,
      changeSet: proposal.changeSet,
      previewFilePath,
      validation: proposal.validation,
      calculation: proposal.calculation,
      createdAt: proposal.createdAt,
      appliedAt: stagedStatus === "applied" ? proposal.appliedAt : undefined
    });
  }

  if (proposal.status === "applied") {
    if (!proposal.appliedAt) {
      throw new TypeError(`Applied proposal ${proposal.id} has no appliedAt timestamp.`);
    }
    if (!replay) {
      const runtime = requireProjectRuntimeState(database, projectId);
      const head = database.getVdtRevisionHead(vdtId);
      if (!head || !head.activeRevisionId || !head.activeContentIdentity) {
        throw new VdtStorageError(
          "REVISION_CONFLICT",
          `Proposal ${proposal.id} cannot resolve a committed VDT head.`
        );
      }
      if (
        head.activeRevisionId !== baseRevision.id ||
        !contentIdentityEqual(
          head.activeContentIdentity,
          verifiedTipContentIdentity
        )
      ) {
        if (existing?.status === "applied") {
          return {
            replayState,
            tipRevisionId: verifiedTipRevisionId,
            tipContentIdentity: verifiedTipContentIdentity
          };
        }
        throw new VdtStorageError(
          "REVISION_CONFLICT",
          `Proposal ${proposal.id} base revision is not the current VDT head.`
        );
      }
      replay = {
        proposalStorageId: proposalId,
        projectId,
        vdtId,
        command: {
          schemaVersion: "revision_commit.v2",
          expectedActiveRevisionId: baseRevision.id,
          expectedActiveContentIdentity: head.activeContentIdentity,
          expectedCommitGeneration: head.commitGeneration,
          expectedRuntimeGeneration: runtime.runtimeGeneration,
          expectedGenerationVersion: runtime.generationVersion,
          idempotencyKey: `agent-proposal:${proposal.id}:apply-v1`,
          intent: {
            source: proposalRevisionSource(proposal),
            summary: proposal.summary,
            validation: jsonOrNull(proposal.validation),
            calculation: jsonOrNull(proposal.calculation)
          }
        },
        project: proposal.previewProject,
        proposal
      };
      replayState = {
        ...replayState,
        proposals: [...replayState.proposals, replay]
      };
      persistReplayCheckpoint(database, state, replayState);
    }
    if (wasAlreadyRecorded) {
      database.updateMutationProposal(proposalId, {
        status: "applied",
        appliedAt: proposal.appliedAt,
        previewFilePath,
        validation: proposal.validation,
        calculation: proposal.calculation
      });
      return {
        replayState,
        tipRevisionId: verifiedTipRevisionId,
        tipContentIdentity: verifiedTipContentIdentity
      };
    }
    const committed = executeProposalReplay(database, actor, replay);
    if (committed.revision.parentRevisionId !== baseRevision.id) {
      throw new VdtStorageError(
        "REVISION_CONFLICT",
        `Proposal ${proposal.id} replay is not bound to its persisted base revision.`
      );
    }
    database.updateMutationProposal(proposalId, {
      status: "applied",
      appliedAt: proposal.appliedAt,
      previewFilePath,
      validation: proposal.validation,
      calculation: proposal.calculation
    });
    if (!committed.head.activeContentIdentity) {
      throw new VdtStorageError(
        "AMBIGUOUS_REVISION_RECOVERY",
        `Proposal ${proposal.id} commit has no exact content identity.`
      );
    }
    return {
      replayState,
      tipRevisionId: committed.revision.id,
      tipContentIdentity: committed.head.activeContentIdentity
    };
  }
  return {
    replayState,
    tipRevisionId: verifiedTipRevisionId,
    tipContentIdentity: verifiedTipContentIdentity
  };
}

function usesPersistedHeadAsProposalBase(
  replayState: AgentStorageReplayStateV1,
  state: VdtAgentRunState
): boolean {
  return (
    replayState.initial.kind === "existing_head_verified" ||
    Boolean(trimOptional(state.request.workspace?.vdtId))
  );
}

function resolveProposalBaseRevision(
  database: VdtDatabase,
  vdtId: string,
  proposal: MutationProposal,
  replayState: AgentStorageReplayStateV1,
  state: VdtAgentRunState,
  replay: AgentProposalCommitReplayV1 | undefined,
  verifiedTipRevisionId: string
): VdtRevisionRecord | undefined {
  if (replay?.command.expectedActiveRevisionId) {
    return database.getVdtRevision(replay.command.expectedActiveRevisionId) ?? undefined;
  }
  if (usesPersistedHeadAsProposalBase(replayState, state)) {
    return database.getVdtRevision(verifiedTipRevisionId) ?? undefined;
  }
  return database
    .listVdtRevisions(vdtId)
    .find((revision) => revision.revisionNo === proposal.baseRevision);
}

function executeInitialReplay(
  database: VdtDatabase,
  actor: ActorContextV1,
  replay: AgentInitialReplayV1,
  requireActiveHead: boolean
): { revisionId: string; contentIdentity: RevisionContentIdentityV1 } {
  if (replay.kind === "combined_create") {
    const committed = database.createVdtWithInitialSnapshot({
      actor,
      command: replay.command,
      project: replay.project
    });
    return replayRevisionFromCommit(
      committed.revision,
      committed.head.activeContentIdentity
    );
  }
  if (replay.kind === "initial_revision") {
    const committed = database.commitVdtRevision({
      projectId: replay.projectId,
      vdtId: replay.vdtId,
      actor,
      command: replay.command,
      project: replay.project
    });
    return replayRevisionFromCommit(
      committed.revision,
      committed.head.activeContentIdentity
    );
  }
  if (replay.kind === "existing_head_verified") {
    const vdt = database.getVdt(replay.vdtId);
    const head = database.getVdtRevisionHead(replay.vdtId);
    const revision = database.getVdtRevision(replay.revisionId);
    if (
      !vdt ||
      vdt.projectId !== replay.projectId ||
      !revision ||
      revision.vdtId !== replay.vdtId
    ) {
      throw new VdtStorageError(
        "AMBIGUOUS_REVISION_RECOVERY",
        `Bound VDT head ${replay.vdtId} is no longer exact for continue replay.`
      );
    }
    verifyRevisionContentIdentity(database, revision, replay.contentIdentity);
    if (
      requireActiveHead &&
      (!head ||
        head.activeRevisionId !== replay.revisionId ||
        !contentIdentityEqual(head.activeContentIdentity, replay.contentIdentity))
    ) {
      throw new VdtStorageError(
        "AMBIGUOUS_REVISION_RECOVERY",
        `Bound VDT head ${replay.vdtId} is no longer exact for continue replay.`
      );
    }
    return {
      revisionId: replay.revisionId,
      contentIdentity: replay.contentIdentity
    };
  }

  const vdt = database.getVdt(replay.vdtId);
  const revision = database.getVdtRevision(replay.revisionId);
  if (
    !vdt ||
    vdt.projectId !== replay.projectId ||
    !revision ||
    revision.vdtId !== replay.vdtId ||
    replay.contentIdentity.hash !== `sha256:${revision.graphHash}`
  ) {
    throw new VdtStorageError(
      "AMBIGUOUS_REVISION_RECOVERY",
      `Legacy initial revision basis is no longer exact for ${replay.vdtId}.`
    );
  }
  verifyRevisionContentIdentity(database, revision, replay.contentIdentity);
  const head = database.getVdtRevisionHead(replay.vdtId);
  if (
    requireActiveHead &&
    (!head ||
      head.activeRevisionId !== replay.revisionId ||
      !contentIdentityEqual(head.activeContentIdentity, replay.contentIdentity))
  ) {
    throw new VdtStorageError(
      "AMBIGUOUS_REVISION_RECOVERY",
      `Legacy initial revision basis is no longer active for ${replay.vdtId}.`
    );
  }
  return {
    revisionId: replay.revisionId,
    contentIdentity: replay.contentIdentity
  };
}

function executeProposalReplay(
  database: VdtDatabase,
  actor: ActorContextV1,
  replay: AgentProposalCommitReplayV1
): RevisionCommitResultV2 {
  return database.commitVdtRevision({
    projectId: replay.projectId,
    vdtId: replay.vdtId,
    actor,
    command: replay.command,
    project: replay.project
  });
}

function executeStorageReplayState(
  database: VdtDatabase,
  replayState: AgentStorageReplayStateV1,
  actorFactory: (projectId: string) => ActorContextV1,
  requireExactTip = true
): ExecutedStorageReplayStateV1 {
  const initial = executeInitialReplay(
    database,
    actorFactory(replayState.initial.projectId),
    replayState.initial,
    requireExactTip && replayState.proposals.length === 0
  );
  let expectedRevisionId = initial.revisionId;
  let expectedContentIdentity = initial.contentIdentity;
  const proposals: ExecutedProposalReplayV1[] = [];

  for (const replay of replayState.proposals) {
    if (
      replay.projectId !== replayState.initial.projectId ||
      replay.vdtId !== replayState.initial.vdtId ||
      replay.command.expectedActiveRevisionId !== expectedRevisionId ||
      !contentIdentityEqual(
        replay.command.expectedActiveContentIdentity,
        expectedContentIdentity
      )
    ) {
      throw new VdtStorageError(
        "AMBIGUOUS_REVISION_RECOVERY",
        `Proposal ${replay.proposal.id} is not chained to the recorded continue replay basis.`
      );
    }

    const committed = executeProposalReplay(
      database,
      actorFactory(replay.projectId),
      replay
    );
    if (
      committed.revision.vdtId !== replay.vdtId ||
      committed.revision.parentRevisionId !== expectedRevisionId ||
      committed.head.activeRevisionId !== committed.revision.id ||
      !committed.head.activeContentIdentity
    ) {
      throw new VdtStorageError(
        "AMBIGUOUS_REVISION_RECOVERY",
        `Proposal ${replay.proposal.id} replay changed its persisted base.`
      );
    }
    expectedRevisionId = committed.revision.id;
    expectedContentIdentity = committed.head.activeContentIdentity;
    proposals.push({ replay, committed });
  }

  if (requireExactTip) {
    const liveHead = database.getVdtRevisionHead(replayState.initial.vdtId);
    if (
      !liveHead ||
      liveHead.projectId !== replayState.initial.projectId ||
      liveHead.activeRevisionId !== expectedRevisionId ||
      !contentIdentityEqual(
        liveHead.activeContentIdentity,
        expectedContentIdentity
      )
    ) {
      throw new VdtStorageError(
        "AMBIGUOUS_REVISION_RECOVERY",
        `VDT head ${replayState.initial.vdtId} is not the exact recorded replay tip.`
      );
    }
  }

  return {
    initialRevisionId: initial.revisionId,
    tipRevisionId: expectedRevisionId,
    tipContentIdentity: expectedContentIdentity,
    proposals
  };
}

function executedStorageReplayWithoutProposals(initial: {
  revisionId: string;
  contentIdentity: RevisionContentIdentityV1;
}): ExecutedStorageReplayStateV1 {
  return {
    initialRevisionId: initial.revisionId,
    tipRevisionId: initial.revisionId,
    tipContentIdentity: initial.contentIdentity,
    proposals: []
  };
}

function replayRevisionFromCommit(
  revision: VdtRevisionRecord,
  contentIdentity: RevisionContentIdentityV1 | null
): { revisionId: string; contentIdentity: RevisionContentIdentityV1 } {
  if (!contentIdentity) {
    throw new VdtStorageError(
      "AMBIGUOUS_REVISION_RECOVERY",
      `Committed revision ${revision.id} has no exact content identity.`
    );
  }
  return { revisionId: revision.id, contentIdentity };
}

function verifyRevisionContentIdentity(
  database: VdtDatabase,
  revision: VdtRevisionRecord,
  expected: RevisionContentIdentityV1
): void {
  const project = database.readVdtRevision(revision);
  const actual: RevisionContentIdentityV1 = expected.scheme === "legacy_graph_sha256"
    ? {
        scheme: "legacy_graph_sha256",
        hash: `sha256:${revision.graphHash}`
      }
    : validateStrictVdtProjectCommit(project).contentIdentity;
  if (!contentIdentityEqual(actual, expected)) {
    throw new VdtStorageError(
      "AMBIGUOUS_REVISION_RECOVERY",
      `Revision ${revision.id} no longer matches its recorded content identity.`
    );
  }
}

function contentIdentityEqual(
  left: RevisionContentIdentityV1 | null,
  right: RevisionContentIdentityV1 | null
): boolean {
  return Boolean(
    left &&
      right &&
      left.scheme === right.scheme &&
      left.hash === right.hash
  );
}

function reconstructExistingInitialReplay(
  database: VdtDatabase,
  state: VdtAgentRunState,
  vdt: VdtRecord,
  head: VdtRevisionHeadV2,
  runtime: ProjectRuntimeStateV1
): AgentInitialReplayV1 {
  const initialRevision = database
    .listVdtRevisions(vdt.id)
    .find((revision) => revision.revisionNo === 1);
  if (!initialRevision || !head.activeRevisionId || !head.activeContentIdentity) {
    throw new VdtStorageError(
      "VDT_NOT_READY",
      `Existing agent VDT ${vdt.id} has no exact initial revision basis.`
    );
  }
  const metadata = vdt.metadata ?? {};
  const boundWorkspaceVdtId = trimOptional(state.request.workspace?.vdtId);
  if (
    boundWorkspaceVdtId &&
    safeVdtId(boundWorkspaceVdtId) === vdt.id &&
    head.activeRevisionId &&
    head.activeContentIdentity
  ) {
    return {
      kind: "existing_head_verified",
      projectId: vdt.projectId,
      vdtId: vdt.id,
      revisionId: head.activeRevisionId,
      contentIdentity: head.activeContentIdentity
    };
  }
  if (
    head.activeContentIdentity.scheme === "legacy_graph_sha256" &&
    metadata.sourceRunId === state.runId &&
    initialRevision.id === head.activeRevisionId
  ) {
    return {
      kind: "legacy_verified",
      projectId: vdt.projectId,
      vdtId: vdt.id,
      revisionId: initialRevision.id,
      contentIdentity: {
        scheme: "legacy_graph_sha256",
        hash: head.activeContentIdentity.hash
      }
    };
  }

  const initialProject = database.readVdtRevision(initialRevision);
  validateStrictVdtProjectCommit(initialProject);
  if (initialRevision.source !== "agent") {
    throw new VdtStorageError(
      "VDT_NOT_READY",
      `Existing VDT ${vdt.id} was not created from an agent-owned initial revision.`
    );
  }

  const sourceRunMatches = metadata.sourceRunId === state.runId;
  if (sourceRunMatches) {
    return {
      kind: "combined_create",
      projectId: vdt.projectId,
      vdtId: vdt.id,
      command: {
        schemaVersion: "create_vdt_with_initial_snapshot.v1",
        projectId: vdt.projectId,
        expectedRuntimeGeneration: runtime.runtimeGeneration,
        expectedGenerationVersion: runtime.generationVersion,
        idempotencyKey: initialAgentIdempotencyKey(state, vdt.id),
        vdt: {
          requestedVdtId: vdt.id,
          name: vdt.name,
          rootKpi: vdt.rootKpi,
          unit: vdt.unit ?? null,
          timePeriod: vdt.timePeriod ?? null,
          status: vdt.status,
          metadata: vdt.metadata
            ? (vdt.metadata as JsonValue)
            : null
        },
        revisionIntent: {
          source: initialRevision.source,
          summary: initialRevision.summary ?? null,
          validation: jsonOrNull(initialRevision.validation),
          calculation: jsonOrNull(initialRevision.calculation)
        }
      },
      project: initialProject
    };
  }

  return {
    kind: "initial_revision",
    projectId: vdt.projectId,
    vdtId: vdt.id,
    command: {
      schemaVersion: "revision_commit.v2",
      expectedActiveRevisionId: null,
      expectedActiveContentIdentity: null,
      expectedCommitGeneration: 0,
      expectedRuntimeGeneration: runtime.runtimeGeneration,
      expectedGenerationVersion: runtime.generationVersion,
      idempotencyKey: initialAgentIdempotencyKey(state, vdt.id),
      intent: {
        source: initialRevision.source,
        summary: initialRevision.summary ?? null,
        validation: jsonOrNull(initialRevision.validation),
        calculation: jsonOrNull(initialRevision.calculation)
      }
    },
    project: initialProject
  };
}

function reconcilePersistedReplayState(
  database: VdtDatabase,
  state: VdtAgentRunState,
  replayState: AgentStorageReplayStateV1 | undefined,
  actorFactory: (projectId: string) => ActorContextV1
): VdtAgentRunState {
  if (!replayState) return state;

  let reconciled = state;
  const executed = executeStorageReplayState(
    database,
    replayState,
    actorFactory,
    replayState.initial.kind === "existing_head_verified" ||
      replayState.proposals.length > 0
  );

  for (const { replay, committed } of executed.proposals) {
    database.updateMutationProposal(replay.proposalStorageId, {
      status: "applied",
      appliedAt:
        replay.proposal.appliedAt ?? committed.revision.createdAt,
      validation: replay.proposal.validation,
      calculation: replay.proposal.calculation
    });
    reconciled = markProposalAppliedInState(
      reconciled,
      replay.proposal,
      replay.proposal.appliedAt ?? committed.revision.createdAt
    );
  }

  const record = database.getAgentRun(state.runId);
  if (record) {
    updatePersistedAgentRun(
      database,
      reconciled,
      record.conversationId,
      replayState
    );
  }
  return reconciled;
}

function markProposalAppliedInState(
  state: VdtAgentRunState,
  proposal: MutationProposal,
  appliedAt: string
): VdtAgentRunState {
  const applied = {
    ...proposal,
    status: "applied" as const,
    appliedAt
  };
  const existing = state.mutationProposals ?? [];
  const mutationProposals = existing.some((item) => item.id === proposal.id)
    ? existing.map((item) => item.id === proposal.id ? applied : item)
    : [...existing, applied];
  return {
    ...state,
    mutationProposals,
    ...(state.pendingMutationProposal?.id === proposal.id
      ? { pendingMutationProposal: applied }
      : {})
  };
}

function persistReplayCheckpoint(
  database: VdtDatabase,
  state: VdtAgentRunState,
  replayState: AgentStorageReplayStateV1
): void {
  const record = database.getAgentRun(state.runId);
  if (!record) return;
  const checkpointState = stateWithDurableProposalStatuses(database, state);
  updatePersistedAgentRun(
    database,
    checkpointState,
    record.conversationId,
    replayState
  );
}

function stateWithDurableProposalStatuses(
  database: VdtDatabase,
  state: VdtAgentRunState
): VdtAgentRunState {
  const staged = (state.mutationProposals ?? []).map((proposal) => {
    if (proposal.status !== "applied") return proposal;
    const durable = database.getMutationProposal(storageProposalId(proposal));
    if (durable?.status === "applied") return proposal;
    return {
      ...proposal,
      status: (durable?.status ?? "approved") as MutationProposal["status"],
      appliedAt: undefined
    };
  });
  const pending = state.pendingMutationProposal;
  const stagedPending = pending
    ? staged.find((proposal) => proposal.id === pending.id) ?? pending
    : undefined;
  return {
    ...state,
    mutationProposals: staged,
    ...(stagedPending ? { pendingMutationProposal: stagedPending } : {})
  };
}

function replayStateForRun(
  database: VdtDatabase,
  runId: string
): AgentStorageReplayStateV1 | undefined {
  return replayStateFromInternalState(
    database.getAgentRun(runId)?.internalState
  );
}

function replayStateFromInternalState(
  internalState: Record<string, unknown> | undefined
): AgentStorageReplayStateV1 | undefined {
  const value = internalState?.[STORAGE_REPLAY_STATE_KEY];
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value as { schemaVersion?: unknown }).schemaVersion !==
      "agent_storage_replay_state.v1"
  ) {
    return undefined;
  }
  return value as AgentStorageReplayStateV1;
}

function updatePersistedAgentRun(
  database: VdtDatabase,
  state: VdtAgentRunState,
  conversationId: string | undefined,
  replayState?: AgentStorageReplayStateV1 | undefined
): void {
  const payload = persistedRunPayload(state, replayState);
  const requestedVdtId = vdtIdFromState(state);
  const persistedVdtId =
    requestedVdtId && database.getVdt(requestedVdtId)
      ? requestedVdtId
      : database.getAgentRun(state.runId)?.vdtId;
  database.updateAgentRun(state.runId, {
    vdtId: persistedVdtId,
    conversationId,
    status: state.status,
    phase: state.phase,
    request: payload.request,
    publicSnapshot: payload.publicSnapshot,
    internalState: payload.internalState,
    completedAt: state.completedAt
  });
}

function requireProjectRuntimeState(database: VdtDatabase, projectId: string) {
  const runtime = database.getProjectRuntimeState(projectId);
  if (!runtime) {
    throw new VdtStorageError(
      "PROJECT_RUNTIME_STATE_MISSING",
      `Project runtime state is missing for ${projectId}.`
    );
  }
  return runtime;
}

function proposalRevisionSource(
  proposal: MutationProposal
): RevisionCommitIntentV1["source"] {
  if (proposal.source === "repair" || proposal.source === "import") {
    return proposal.source;
  }
  return "agent";
}

function jsonOrNull(value: unknown): JsonValue | null {
  return value === undefined ? null : (value as JsonValue);
}

function writePreviewProject(database: VdtDatabase, projectId: string, vdtId: string, proposal: MutationProposal): string {
  const previewDir = vdtPreviewDir(database.dataDir, projectId, vdtId);
  const file = path.join(previewDir, `${storageProposalId(proposal)}.vdt.json`);
  fs.writeFileSync(file, `${JSON.stringify(proposal.previewProject, null, 2)}\n`, "utf8");
  return path.relative(database.dataDir, file);
}

function vdtIdFromState(
  state: VdtAgentRunState,
  context = storageProjectContextFromState(state)
): string | undefined {
  const project = state.draftProject ?? state.project;
  return project ? storageVdtId(state, project, context) : undefined;
}

function storageVdtId(
  state: VdtAgentRunState,
  project: VdtProject,
  context = storageProjectContextFromState(state)
): string {
  const boundVdtId = context.vdtId ?? trimOptional(state.request.workspace?.vdtId);
  if (boundVdtId) {
    return safeVdtId(boundVdtId);
  }
  return safeStorageId("vdt", `${project.rootNodeId || project.id}_${state.runId}`);
}

function initialAgentIdempotencyKey(state: VdtAgentRunState, vdtId: string): string {
  if (state.request.workspace?.vdtId) {
    return `agent-run:${vdtId}:initial-v1`;
  }
  return `agent-run:${state.runId}:initial-v1`;
}

function validateBoundStorageVdt(
  database: VdtDatabase,
  vdtId: string,
  projectId: string
): VdtRecord {
  const vdt = database.getVdt(vdtId);
  if (!vdt) {
    throw new VdtStorageError(
      "VDT_NOT_FOUND",
      `Workspace VDT ${vdtId} was not found.`
    );
  }
  if (vdt.projectId !== projectId) {
    throw new VdtStorageError(
      "VDT_NOT_FOUND",
      `Workspace VDT ${vdtId} does not belong to project ${projectId}.`
    );
  }
  return vdt;
}

function storageProposalId(proposal: MutationProposal): string {
  return safeStorageId("proposal", proposal.id);
}

function storageConversationId(state: VdtAgentRunState): string {
  return safeStorageId("conversation", state.runId);
}

function storageMessageId(message: AgentChatMessage): string {
  return safeStorageId("message", message.id);
}

interface StorageProjectContext extends VdtAgentWorkspaceContext {
  projectId: string;
}

function ensureStorageProject(
  database: VdtDatabase,
  state: VdtAgentRunState,
  context = storageProjectContextFromState(state)
): StorageProjectContext {
  if (database.getProject(context.projectId)) return context;
  database.createProject({
    id: context.projectId,
    name: context.projectName ?? DEFAULT_AGENT_PROJECT_NAME,
    description: context.description ?? (
      context.projectId === DEFAULT_AGENT_PROJECT_ID
        ? "Default project for persisted agent runs before explicit project management is configured."
        : undefined
    ),
    industry: context.industry,
    metadata: {
      source: "agent_run_workspace",
      requestedProjectId: state.request.workspace?.projectId,
      sourceProjectId: state.request.input.project?.id ?? state.project?.id ?? state.draftProject?.id
    }
  });
  return context;
}

function storageProjectContextFromState(state: VdtAgentRunState): StorageProjectContext {
  const requested = state.request.workspace;
  const project = requested
    ? state.request.input.project ?? state.project ?? state.draftProject
    : state.request.input.project;
  const rootNode = project?.graph.nodes.find((node) => node.id === project.rootNodeId);
  if (requested?.projectId) {
    return {
      projectId: safeProjectId(requested.projectId),
      projectName: trimOptional(requested.projectName) ?? project?.name ?? rootNode?.name ?? DEFAULT_AGENT_PROJECT_NAME,
      industry: trimOptional(requested.industry) ?? trimOptional(project?.industry),
      description: trimOptional(requested.description) ?? trimOptional(project?.description),
      ...(requested.vdtId ? { vdtId: safeVdtId(requested.vdtId) } : {})
    };
  }
  if (project) {
    return {
      projectId: safeStorageId("project", project.id || project.rootNodeId || project.name),
      projectName: trimOptional(project.name) ?? rootNode?.name ?? DEFAULT_AGENT_PROJECT_NAME,
      industry: trimOptional(project.industry),
      description: trimOptional(project.description)
    };
  }
  return {
    projectId: DEFAULT_AGENT_PROJECT_ID,
    projectName: DEFAULT_AGENT_PROJECT_NAME
  };
}

/** Exact project key used by the legacy `agent_runs.project_id` authority.
 * Sequence 4 bindings must reuse it so their FK cannot create or imply a
 * second project identity. */
export function authoritativeAgentRunProjectId(state: VdtAgentRunState): string {
  return storageProjectContextFromState(state).projectId;
}

function safeProjectId(value: string): string {
  const trimmed = value.trim();
  try {
    return assertSafeId(trimmed, "projectId");
  } catch {
    return safeStorageId("project", trimmed);
  }
}

function safeVdtId(value: string): string {
  const trimmed = value.trim();
  try {
    return assertSafeId(trimmed, "vdtId");
  } catch {
    return safeStorageId("vdt", trimmed);
  }
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function ensureConversation(database: VdtDatabase, projectId: string, state: VdtAgentRunState): string {
  const conversationId = storageConversationId(state);
  const vdtId = vdtIdFromState(state);
  const existing = database.getConversation(conversationId);
  if (existing) {
    if (vdtId && existing.vdtId !== vdtId) {
      database.updateConversation(conversationId, { vdtId });
    }
    return conversationId;
  }
  database.createConversation({
    id: conversationId,
    projectId,
    ...(vdtId ? { vdtId } : {}),
    title: conversationTitle(state),
    mode: state.request.mode
  });
  return conversationId;
}

function conversationTitle(state: VdtAgentRunState): string {
  const rootKpi = state.visibleContext.brief.rootKpi || state.request.input.rootKpi || "Value driver tree";
  return `${rootKpi} agent thread`;
}

function persistConversationMessages(database: VdtDatabase, state: VdtAgentRunState, conversationId: string): void {
  const existingIds = new Set(database.listMessages(conversationId).map((message) => message.id));
  state.chatMessages.forEach((message, index) => {
    const messageId = storageMessageId(message);
    if (existingIds.has(messageId)) return;
    database.appendMessage({
      id: messageId,
      conversationId,
      role: message.role,
      content: chatMessageContent(message),
      agentRunId: state.runId,
      runContext: chatMessageRunContext(message),
      position: index + 1,
      startedAt: message.createdAt,
      endedAt: message.createdAt
    });
  });
}

function chatMessageContent(message: AgentChatMessage): string {
  const text = message.text?.trim();
  if (text) return text;
  if (message.questions?.length) {
    return message.questions.map((question) => question.question).join("\n");
  }
  if (message.answers?.length) {
    return message.answers
      .map((answer) => {
        const value = answer.freeText ?? answer.selectedOptionIds?.join(", ") ?? JSON.stringify(answer.fields ?? {});
        return `${answer.questionId}: ${value}`;
      })
      .join("\n");
  }
  return message.status?.message ?? message.kind.replaceAll("_", " ");
}

function chatMessageRunContext(message: AgentChatMessage): Record<string, unknown> {
  return {
    kind: message.kind,
    sourceMessageId: message.id,
    ...(message.questions ? { questions: message.questions } : {}),
    ...(message.answers ? { answers: message.answers } : {}),
    ...(message.status ? { status: message.status } : {})
  };
}

function appendEventIfNew(database: VdtDatabase, event: VdtAgentEvent): void {
  const existing = database.listAgentEvents(event.runId).some((record) => record.seq === event.seq);
  if (existing) return;
  database.appendAgentEvent({
    id: storageEventId(event),
    runId: event.runId,
    seq: event.seq,
    type: event.type,
    phase: event.phase,
    title: event.title,
    message: event.message,
    metadata: {
      ...(event.metadata ?? {}),
      sourceEventId: event.id
    }
  });
}

function storageEventId(event: VdtAgentEvent): string {
  return assertSafeId(`${event.runId}_${String(event.seq).padStart(6, "0")}`, "agentEventId");
}

function safeStorageId(prefix: string, value: string): string {
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 12);
  const safeBody = value
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^[^A-Za-z0-9]+/, "")
    .slice(0, 90) || "item";
  return assertSafeId(`${prefix}_${safeBody}_${hash}`, prefix);
}

function defaultDataDir(projectRoot: string): string {
  if (process.env.NODE_ENV === "test") {
    return path.join(os.tmpdir(), "vdt-studio-agent-runs-test", safePathSegment(projectRoot), String(process.pid));
  }
  return path.join(projectRoot, ".vdt");
}

function safePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "_").slice(-80) || "workspace";
}
