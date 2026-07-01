import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  assertSafeId,
  openVdtDatabase,
  vdtPreviewDir,
  type VdtDatabase
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
  type VdtAgentRunSnapshot,
  type VdtAgentRunState,
  type VdtAgentWorkspaceContext
} from "@vdt-studio/vdt-agent-runtime";
import type { VdtProject } from "@vdt-studio/vdt-core";

const DEFAULT_AGENT_PROJECT_ID = "project_agent_workspace";
const DEFAULT_AGENT_PROJECT_NAME = "VDT Studio workspace";

export function openAgentRunPersistenceDatabase(projectRoot: string): VdtDatabase {
  const dataDir = process.env.VDT_DATA_DIR ?? defaultDataDir(projectRoot);
  return openVdtDatabase(projectRoot, { dataDir });
}

export function createSqliteAgentRunPersistence(database: VdtDatabase): AgentRunPersistence {
  return {
    createRun(state) {
      const projectContext = ensureStorageProject(database, state);
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
      persistRunArtifacts(database, state);
    },
    updateRun(state) {
      persistRunArtifacts(database, state);
      const projectContext = ensureStorageProject(database, state);
      const conversationId = ensureConversation(database, projectContext.projectId, state);
      persistConversationMessages(database, state, conversationId);
      const payload = persistedRunPayload(state);
      database.updateAgentRun(state.runId, {
        vdtId: vdtIdFromState(state),
        conversationId,
        status: state.status,
        phase: state.phase,
        request: payload.request,
        publicSnapshot: payload.publicSnapshot,
        internalState: payload.internalState,
        completedAt: state.completedAt
      });
    },
    appendEvent(event, state) {
      appendEventIfNew(database, event);
      persistRunArtifacts(database, state);
      const projectContext = ensureStorageProject(database, state);
      const conversationId = ensureConversation(database, projectContext.projectId, state);
      persistConversationMessages(database, state, conversationId);
      const payload = persistedRunPayload(state);
      database.updateAgentRun(state.runId, {
        vdtId: vdtIdFromState(state),
        conversationId,
        status: state.status,
        phase: state.phase,
        request: payload.request,
        publicSnapshot: payload.publicSnapshot,
        internalState: payload.internalState,
        completedAt: state.completedAt
      });
    },
    getState(runId) {
      const record = database.getAgentRun(runId);
      const persisted = record?.internalState as PersistedAgentRunState | undefined;
      return persisted ? hydrateAgentRunState(persisted) : null;
    },
    getSnapshot(runId) {
      const record = database.getAgentRun(runId);
      return record?.publicSnapshot as VdtAgentRunSnapshot | undefined ?? null;
    }
  };
}

function persistedRunPayload(state: VdtAgentRunState): {
  request: Record<string, unknown>;
  publicSnapshot: Record<string, unknown>;
  internalState: Record<string, unknown>;
} {
  const internalState = serializeAgentRunState(state);
  return {
    request: internalState.snapshot.request as unknown as Record<string, unknown>,
    publicSnapshot: internalState.snapshot as unknown as Record<string, unknown>,
    internalState: internalState as unknown as Record<string, unknown>
  };
}

function persistRunArtifacts(database: VdtDatabase, state: VdtAgentRunState): void {
  const project = state.draftProject ?? state.project;
  if (!project) return;
  const projectContext = ensureStorageProject(database, state);

  const vdtId = ensureVdtRecord(database, projectContext.projectId, state, project);
  persistRevisionIfMissing(database, {
    projectId: projectContext.projectId,
    project: state.draftProject ?? project,
    vdtId,
    revisionNo: 1,
    source: "agent",
    summary: "Initial VDT draft",
    validation: state.validationState,
    calculation: state.calculationState
  });

  for (const proposal of state.mutationProposals ?? []) {
    persistMutationProposal(database, projectContext.projectId, state, vdtId, proposal);
  }
}

function ensureVdtRecord(database: VdtDatabase, projectId: string, state: VdtAgentRunState, project: VdtProject): string {
  const vdtId = storageVdtId(state, project);
  if (database.getVdt(vdtId)) return vdtId;
  const rootNode = project.graph.nodes.find((node) => node.id === project.rootNodeId);
  database.createVdt({
    id: vdtId,
    projectId,
    name: project.name || `${rootNode?.name ?? state.request.input.rootKpi ?? "Value driver tree"} VDT`,
    rootKpi: rootNode?.name ?? state.request.input.rootKpi ?? "Value driver tree",
    unit: rootNode?.unit ?? state.request.input.unit,
    timePeriod: state.request.input.timePeriod,
    metadata: {
      sourceRunId: state.runId,
      sourceProjectId: project.id
    }
  });
  return vdtId;
}

function persistMutationProposal(
  database: VdtDatabase,
  projectId: string,
  state: VdtAgentRunState,
  vdtId: string,
  proposal: MutationProposal
): void {
  const proposalId = storageProposalId(proposal);
  const previewFilePath = writePreviewProject(database, projectId, vdtId, proposal);
  const baseRevisionId = storageRevisionId(vdtId, proposal.baseRevision);
  const existing = database.getMutationProposal(proposalId);
  if (existing) {
    database.updateMutationProposal(proposalId, {
      status: proposal.status,
      appliedAt: proposal.appliedAt,
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
      baseRevisionId,
      status: proposal.status,
      title: proposal.title,
      summary: proposal.summary,
      changeSet: proposal.changeSet,
      previewFilePath,
      validation: proposal.validation,
      calculation: proposal.calculation,
      createdAt: proposal.createdAt,
      appliedAt: proposal.appliedAt
    });
  }

  if (proposal.status === "applied") {
    persistRevisionIfMissing(database, {
      projectId,
      project: proposal.previewProject,
      vdtId,
      revisionNo: proposal.baseRevision + 1,
      source: proposal.source === "repair" ? "repair" : proposal.source === "import" ? "import" : "agent",
      summary: proposal.summary,
      validation: proposal.validation,
      calculation: proposal.calculation
    });
  }
}

function persistRevisionIfMissing(database: VdtDatabase, input: {
  projectId: string;
  project: VdtProject;
  vdtId: string;
  revisionNo: number;
  source: "agent" | "user" | "import" | "scenario" | "repair";
  summary?: string | undefined;
  validation?: unknown;
  calculation?: unknown;
}): void {
  const revisionId = storageRevisionId(input.vdtId, input.revisionNo);
  if (database.getVdtRevision(revisionId)) return;
  database.saveVdtRevision({
    id: revisionId,
    projectId: input.projectId,
    vdtId: input.vdtId,
    revisionNo: input.revisionNo,
    source: input.source,
    summary: input.summary,
    project: input.project,
    validation: input.validation,
    calculation: input.calculation
  });
}

function writePreviewProject(database: VdtDatabase, projectId: string, vdtId: string, proposal: MutationProposal): string {
  const previewDir = vdtPreviewDir(database.dataDir, projectId, vdtId);
  const file = path.join(previewDir, `${storageProposalId(proposal)}.vdt.json`);
  fs.writeFileSync(file, `${JSON.stringify(proposal.previewProject, null, 2)}\n`, "utf8");
  return path.relative(database.dataDir, file);
}

function vdtIdFromState(state: VdtAgentRunState): string | undefined {
  const project = state.draftProject ?? state.project;
  return project ? storageVdtId(state, project) : undefined;
}

function storageVdtId(state: VdtAgentRunState, project: VdtProject): string {
  return safeStorageId("vdt", `${project.rootNodeId || project.id}_${state.runId}`);
}

function storageProposalId(proposal: MutationProposal): string {
  return safeStorageId("proposal", proposal.id);
}

function storageRevisionId(vdtId: string, revisionNo: number): string {
  return safeStorageId("revision", `${vdtId}_${String(revisionNo).padStart(6, "0")}`);
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

function ensureStorageProject(database: VdtDatabase, state: VdtAgentRunState): StorageProjectContext {
  const context = storageProjectContextFromState(state);
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
      description: trimOptional(requested.description) ?? trimOptional(project?.description)
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

function safeProjectId(value: string): string {
  const trimmed = value.trim();
  try {
    return assertSafeId(trimmed, "projectId");
  } catch {
    return safeStorageId("project", trimmed);
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
