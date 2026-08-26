import { createHash } from "node:crypto";
import type { AiProvider } from "@vdt-studio/ai-harness";
import { VdtBuilderSession, type VdtNodePatch } from "@vdt-studio/vdt-core";
import {
  AgentRunEventOutbox,
  AgentToolError,
  StructuredInProductModelAgentEngine,
  VdtRunSupervisor,
  agentQuestionSchema,
  applyPendingMutationProposal,
  rejectPendingMutationProposal,
  summarizeAgentSupervisorPersistenceState,
  verifyDeterministicRunFinish,
  type AgentHumanInput,
  type AgentRunEventV2,
  type AgentSessionBinding,
  type AgentSupervisorPersistence,
  type AgentToolContext,
  type AgentUserMessage,
  type ModelAgentTurnDelta,
  type ModelAgentTurnRequest,
  type ModelAgentTurnResponse,
  type ModelAgentTurnTransport,
  type VdtAgentRunSnapshot,
  type VdtAgentStartRequest
} from "@vdt-studio/vdt-agent-runtime";
import { createAiProvider } from "@/lib/ai-route-provider";
import { compactPublicAgentSnapshot } from "./public-snapshot";
import type { PublicAgentRunSnapshot } from "./public-snapshot";
import type { StructuredModelAgentExecutionBindingDefinition } from "./execution-bindings";
import {
  TARGET_MODEL_AGENT_TOOLS,
  modelAgentToolCatalog,
  modelAgentToolCatalogHash
} from "./model-agent-tool-catalog";
import { authoritativeAgentRunProjectId } from "./persistence";
import {
  agentRuntime,
  createAgentSupervisorPersistence,
  createAgentSupervisorReadPersistence
} from "./runtime";

const MODEL_AGENT_SYSTEM_PROMPT = `You are the in-product VDT Model Agent. You own one logical structured-turn session for the whole run.

Use only tools from the supplied immutable VDT tool catalog. Never request shell, filesystem, Git, web, foreign MCP, plugins, apps, or subagents. Do not claim factual runtime progress in prose. Runtime status comes only from the Supervisor.

Return exactly one object matching the response schema. The first turn must include an assistantMessage or a question. Use action_batch for 1-6 ordered calls. The runtime executes calls sequentially and stops after the first failure, pause, or approval. Questions, approvals, and run.request_finish must be alone in a batch.

Every response must include sessionState: a concise server-private semantic checkpoint (maximum 16 KiB) containing the current goal, confirmed progress, working node IDs, unresolved corrections, and next intended work. Never copy the raw project, full tool catalog, secrets, prompts, or long history into sessionState. The next stateless HTTP turn receives this state with the confirmed cursor/hashes and the new checkpoint delta.

Before final, call run.request_finish. Only after its successful tool result may you return final, and finishReceiptId must exactly match that result. After the first turn, sessionContinuation contains the bounded semantic checkpoint and confirmed cursor/hash proof; delta contains only the new checkpoint information. Continue from those fields and do not ask for the full initial context again.`;

type SupervisorEventSubscriber = (event: AgentRunEventV2) => void;

interface ActiveSupervisorRun {
  supervisor: VdtRunSupervisor;
  readonly persistence: AgentSupervisorPersistence;
  readonly subscribers: Set<SupervisorEventSubscriber>;
  questionSetId: string | null;
  lifecycleTask?: Promise<void> | undefined;
}

const supervisorGlobal = globalThis as typeof globalThis & {
  __vdtActiveSupervisorRuns?: Map<string, ActiveSupervisorRun>;
};

const activeRuns = supervisorGlobal.__vdtActiveSupervisorRuns ?? new Map<string, ActiveSupervisorRun>();
if (process.env.NODE_ENV !== "production") {
  supervisorGlobal.__vdtActiveSupervisorRuns = activeRuns;
}

export class PublicSupervisorRunError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) {
    super(message);
    this.name = "PublicSupervisorRunError";
  }
}

export function currentModelAgentToolCatalog() {
  return modelAgentToolCatalog(agentRuntime.tools);
}

export function currentModelAgentToolCatalogHash(): string {
  return modelAgentToolCatalogHash(agentRuntime.tools);
}

export async function startStructuredModelAgentRun(input: {
  request: VdtAgentStartRequest;
  bindingDefinition: StructuredModelAgentExecutionBindingDefinition;
  requestUrl: string;
}): Promise<PublicAgentRunSnapshot> {
  const { request, bindingDefinition, requestUrl } = input;
  const actualToolCatalogHash = currentModelAgentToolCatalogHash();
  if (actualToolCatalogHash !== bindingDefinition.capability.toolCatalogHash) {
    throw new PublicSupervisorRunError(
      "MODEL_TOOL_CATALOG_MISMATCH",
      "The execution binding tool catalog no longer matches this host.",
      409
    );
  }

  const state = agentRuntime.store.createRun(request);
  const runId = state.runId;
  if (activeRuns.has(runId)) {
    throw new PublicSupervisorRunError("SUPERVISOR_ALREADY_ACTIVE", "The run already has an active execution engine.");
  }

  const builder = new VdtBuilderSession({
    project: request.input.project,
    providerId: bindingDefinition.capability.backendId
  });
  const initialProject = builder.getProject();
  const initialContext = createInitialContext(request, bindingDefinition, builder);
  const initialContextDelta = {
    type: "initial_context" as const,
    context: initialContext,
    contextHash: hashJson(initialContext)
  };
  const provider = createStructuredModelProvider(bindingDefinition, requestUrl);
  const engine = new StructuredInProductModelAgentEngine({
    capability: bindingDefinition.capability,
    transport: new AiProviderStructuredTurnTransport(
      provider,
      bindingDefinition,
      initialContextDelta
    )
  });
  agentRuntime.store.updateRun(runId, {
    status: "running",
    phase: "classifying_request",
    builder,
    ...(initialProject.graph.nodes.length > 0 ? { draftProject: initialProject } : {})
  });
  agentRuntime.store.updatePublicStatus(runId, {
    phase: "reading_request",
    message: "Opening the bound Model Agent session..."
  });
  agentRuntime.store.appendEvent(runId, {
    type: "run_started",
    phase: "classifying_request",
    title: "Agent run started",
    message: "Started the bound VDT Model Agent run."
  });
  if (request.input.prompt?.trim()) {
    agentRuntime.store.appendChatMessage(runId, {
      role: "user",
      kind: "instruction",
      text: request.input.prompt.trim()
    });
  }

  const binding = createSessionBinding(
    runId,
    request,
    bindingDefinition,
    authoritativeAgentRunProjectId(agentRuntime.store.getState(runId))
  );
  const persistence = createAgentSupervisorPersistence(agentRuntime.store);
  const subscribers = new Set<SupervisorEventSubscriber>();
  const active: ActiveSupervisorRun = {
    supervisor: undefined as unknown as VdtRunSupervisor,
    persistence,
    subscribers,
    questionSetId: null
  };
  const outbox = new AgentRunEventOutbox(runId, {
    sink: {
      append: async (event) => {
        if (activeRuns.get(runId) !== active) {
          throw new PublicSupervisorRunError(
            "STALE_SUPERVISOR_CALLBACK",
            "A fenced Supervisor instance attempted to append after losing run ownership."
          );
        }
        await persistence.appendEvent(event);
        syncDurableEventToLegacyState(event, active, builder);
        for (const subscriber of [...subscribers]) subscriber(structuredClone(event));
      }
    }
  });
  let supervisor!: VdtRunSupervisor;
  supervisor = new VdtRunSupervisor({
    engine,
    binding,
    persistence,
    outbox,
    gateway: {
      tools: agentRuntime.tools,
      allowedTools: new Set(TARGET_MODEL_AGENT_TOOLS),
      toolContext: () => createToolContext(runId),
      allowTool: (toolName, context) => allowTargetTool(request, toolName, context),
      revisionReconciliation: ({ expectedRevision, currentRevision, context }) => {
        const state = context.store.getState(context.runId);
        return {
          expectedRevision,
          currentRevision,
          manualChanges: state.manualChanges.slice(-20).map((entry) => ({
            observedAt: entry.observedAt,
            projectRevision: entry.projectRevision,
            kind: entry.change.kind,
            nodeId: entry.change.nodeId,
            edgeId: entry.change.edgeId,
            summary: entry.change.summary
          })),
          projectHead: {
            revision: context.builder?.getRevision() ?? null,
            projectHash: context.builder ? hashJson(context.builder.getProject()) : null
          }
        };
      }
    },
    verifyFinish: async ({ externalCallId, expectedProjectRevision }) => {
      const current = agentRuntime.store.getState(runId);
      const supervisorState = await persistence.load(runId);
      const revisionBeforeSnapshot = builder.getRevision();
      const project = builder.getProject();
      const revisionAfterSnapshot = builder.getRevision();
      return verifyDeterministicRunFinish({
        binding: supervisor.binding,
        project,
        currentRevision: revisionAfterSnapshot,
        expectedHeadRevision: expectedProjectRevision ?? revisionBeforeSnapshot,
        mode: request.mode,
        pendingQuestion: current.status === "needs_user_input" || Boolean(current.pendingQuestions?.length),
        pendingApproval: current.status === "waiting_approval",
        pendingProposal: Boolean(current.pendingMutationProposal),
        ambiguousOperation: false,
        currentFinishCallId: externalCallId,
        supervisorState,
        existingFinishReceipt: supervisorState?.finishReceipt ?? null,
        ...(request.mode === "deepen_node"
          ? { modeCompletion: { immediateChildCreated: hasNewImmediateChild(request, builder) } }
          : {})
      });
    },
    onFinal: async ({ text, receiptId }) => {
      const completedAt = new Date().toISOString();
      const project = builder.getProject();
      const before = agentRuntime.store.getState(runId);
      if (!before.chatMessages.some((message) => message.kind === "final_report" && message.text === text)) {
        agentRuntime.store.appendChatMessage(runId, {
          role: "assistant",
          kind: "final_report",
          text
        });
      }
      agentRuntime.store.updateRun(runId, {
        status: "succeeded",
        phase: "reporting",
        project,
        draftProject: project,
        finalReport: text,
        pendingQuestions: undefined,
        pendingPlan: undefined,
        pendingChangeSet: undefined,
        firstResponseCompleted: true,
        completedAt
      });
      agentRuntime.store.updatePublicStatus(runId, {
        phase: "ready",
        message: "VDT build completed.",
        updatedAt: completedAt
      });
      const projected = agentRuntime.store.getState(runId);
      if (!projected.events.some((event) =>
        event.type === "run_completed" && event.metadata?.finishReceiptId === receiptId
      )) {
        agentRuntime.store.appendEvent(runId, {
          type: "run_completed",
          phase: "reporting",
          title: "Run completed",
          message: "Model Agent completed with a verified VDT.",
          metadata: { finishReceiptId: receiptId }
        });
      }
    }
  });
  active.supervisor = supervisor;
  activeRuns.set(runId, active);

  try {
    await supervisor.start({
      initialContext,
      initialContextHash: initialContextDelta.contextHash
    });
    watchActiveSupervisorLifecycle(runId, active);
  } catch (error) {
    try {
      await releaseActiveSupervisorRun(runId, active);
    } catch {
      // The original start failure remains the public error. Run ownership was
      // already fenced before cleanup attempted to close process-local handles.
    }
    const message = safeErrorMessage(error, "The bound Model Agent session could not be opened.");
    agentRuntime.store.updateRun(runId, {
      status: "failed",
      phase: "reporting",
      error: { code: errorCode(error, "MODEL_AGENT_START_FAILED"), message },
      completedAt: new Date().toISOString()
    });
    throw error;
  }

  return compactPublicAgentSnapshot(agentRuntime.store.getSnapshot(runId));
}

export async function isPersistedSupervisorRun(runId: string): Promise<boolean> {
  if (!agentRuntime.store.has(runId)) return false;
  return (await loadSupervisorAuthority(runId)) !== null;
}

/** Public availability projection. Durable checkpoint data may be resumable by
 * the engine contract, but this route intentionally does not auto-resume after
 * process loss until a fenced epoch-bump/recovery coordinator is implemented. */
export async function compactSupervisorAwareSnapshot(
  snapshot: VdtAgentRunSnapshot
): Promise<PublicAgentRunSnapshot> {
  const compact = compactPublicAgentSnapshot(snapshot);
  const durable = await loadSupervisorAuthority(snapshot.runId);
  if (!durable) return compact;
  compact.executionSummary = summarizeAgentSupervisorPersistenceState(durable);
  if (
    !activeRuns.has(snapshot.runId)
    && snapshot.status !== "succeeded"
    && snapshot.status !== "failed"
    && snapshot.status !== "cancelled"
    && compact.executionSummary
  ) {
    compact.executionSummary = {
      ...compact.executionSummary,
      sessionStatus: "recovery_required",
      recoveryStatus: "recovery_required"
    };
  }
  return compact;
}

export async function getPersistedSupervisorEvents(runId: string): Promise<AgentRunEventV2[]> {
  const durable = await loadSupervisorAuthority(runId);
  return structuredClone(durable?.eventOutbox ?? []);
}

async function loadSupervisorAuthority(runId: string) {
  const persistence = activeRuns.get(runId)?.persistence
    ?? createAgentSupervisorReadPersistence(agentRuntime.store);
  return persistence.load(runId);
}

export function subscribeToSupervisorEvents(
  runId: string,
  subscriber: SupervisorEventSubscriber
): () => void {
  const active = activeRuns.get(runId);
  if (!active) return () => undefined;
  active.subscribers.add(subscriber);
  return () => active.subscribers.delete(subscriber);
}

export function isStructuredModelAgentRunActive(runId: string): boolean {
  return activeRuns.has(runId);
}

export async function handleStructuredModelAgentMessage(
  runId: string,
  message: AgentUserMessage
): Promise<PublicAgentRunSnapshot> {
  const active = activeRuns.get(runId);
  if (!active) {
    throw new PublicSupervisorRunError(
      "MODEL_AGENT_RECOVERY_REQUIRED",
      "The persisted Model Agent run has no active session controller on this host.",
      409
    );
  }

  if (message.type === "manual_project_change") {
    if (active.supervisor.status === "finishing" || active.supervisor.status === "succeeded") {
      throw new PublicSupervisorRunError(
        "MODEL_AGENT_FINISH_SEALED",
        "The verified finish receipt sealed this project head; manual changes require a new run.",
        409
      );
    }
    applyManualProjectChange(runId, message);
    return await compactSupervisorAwareSnapshot(agentRuntime.store.getSnapshot(runId));
  }

  let input: AgentHumanInput;
  let inputCheckpointAlreadyDurable = false;
  if (message.type === "user_answer") {
    if (!active.questionSetId) {
      throw new PublicSupervisorRunError("MODEL_AGENT_QUESTION_MISSING", "The run has no pending question set.");
    }
    input = {
      type: "user_answer",
      questionSetId: active.questionSetId,
      answers: {
        ...(message.answers ?? {}),
        ...(message.structuredAnswers ? { structuredAnswers: message.structuredAnswers } : {})
      }
    };
    agentRuntime.store.appendChatMessage(runId, {
      role: "user",
      kind: "answer",
      text: "User answered the pending Model Agent questions.",
      answers: message.structuredAnswers ?? []
    });
    agentRuntime.store.updateRun(runId, { pendingQuestions: undefined });
  } else if (message.type === "user_instruction") {
    const state = agentRuntime.store.getState(runId);
    if (active.questionSetId || state.status === "waiting_approval") {
      throw new PublicSupervisorRunError(
        "MODEL_AGENT_INTERACTION_RESPONSE_REQUIRED",
        "Answer or resolve the active Model Agent checkpoint before sending another instruction."
      );
    }
    input = { type: "user_instruction", text: message.text };
    agentRuntime.store.appendChatMessage(runId, {
      role: "user",
      kind: "instruction",
      text: message.text
    });
  } else if (message.type === "approval") {
    const state = agentRuntime.store.getState(runId);
    let approvalInstruction: string;
    const pendingProposal = state.pendingMutationProposal;
    if (
      pendingProposal
      && message.proposalId
      && message.proposalId !== pendingProposal.id
    ) {
      throw new PublicSupervisorRunError(
        "MODEL_AGENT_APPROVAL_PROPOSAL_STALE",
        "The approval refers to a proposal that is no longer pending."
      );
    }
    const proposalId = message.proposalId ?? pendingProposal?.id;
    const proposal = proposalId
      ? pendingProposal?.id === proposalId
        ? pendingProposal
        : state.mutationProposals?.find((candidate) => candidate.id === proposalId)
      : undefined;
    if (message.approved && proposalId) {
      if (!proposal) {
        throw new PublicSupervisorRunError(
          "MODEL_AGENT_APPROVAL_PROPOSAL_MISSING",
          "The approved proposal is not present in durable run state."
        );
      }
      const selectedChangeIds = normalizeApprovalSelection(
        message.selectedChangeIds && message.selectedChangeIds.length > 0
          ? message.selectedChangeIds
          : proposal.selectedChangeIds
      );
      if (
        (proposal.status === "applied" || proposal.status === "failed")
        && hashJson(normalizeApprovalSelection(proposal.selectedChangeIds)) !== hashJson(selectedChangeIds)
      ) {
        throw new PublicSupervisorRunError(
          "MODEL_AGENT_APPROVAL_SELECTION_CONFLICT",
          "The proposal already has a terminal approval selection with different change IDs."
        );
      }
      const context = createToolContext(runId);
      const controlCall = {
        externalCallId: stableApprovalOperationCallId(proposalId, selectedChangeIds),
        toolName: "control.apply_approved_proposal",
        args: { proposalId, selectedChangeIds }
      } as const;
      const execution = await active.supervisor.gateway.executeTrustedControlOperation(
        controlCall,
        () => {
          const current = agentRuntime.store.getState(runId).pendingMutationProposal;
          if (!current || current.id !== proposalId) {
            return {
              status: "failed" as const,
              resultCode: "APPROVAL_PROPOSAL_NOT_PENDING",
              payload: {
                proposalId,
                message: "The proposal is no longer pending and has no matching terminal approval receipt."
              },
              projectChanged: false
            };
          }
          try {
            const applied = applyPendingMutationProposal(context, selectedChangeIds);
            return {
              status: "succeeded" as const,
              resultCode: "APPROVED_PROPOSAL_APPLIED",
              payload: {
                proposalId,
                selectedChangeIds,
                committedRevision: context.builder?.getRevision() ?? null,
                proposalStatus: applied.proposal.status
              },
              projectChanged: true
            };
          } catch (error) {
            if (!(error instanceof AgentToolError)) throw error;
            return {
              status: "failed" as const,
              resultCode: error.code,
              payload: { proposalId, message: error.message },
              projectChanged: false
            };
          }
        }
      );
      if (
        execution.result.resultCode === "AMBIGUOUS_TOOL_CALL"
        || execution.result.resultCode === "APPROVAL_PROPOSAL_NOT_PENDING"
      ) {
        throw new PublicSupervisorRunError(
          execution.result.resultCode,
          "The proposal approval could not be reconciled safely; automatic apply remains stopped."
        );
      }
      if (execution.result.status === "succeeded") {
        approvalInstruction = "The user approved the pending operation, and the trusted control plane applied it. Continue from the current project checkpoint.";
      } else if (execution.result.resultCode === "STALE_REVISION") {
        approvalInstruction = "The approved proposal was not applied because the project head changed. Reconcile the current project and create a new proposal.";
      } else {
        approvalInstruction = `The approved proposal was not applied (${execution.result.resultCode}). Reconcile the current project before continuing.`;
      }
      inputCheckpointAlreadyDurable = execution.replayed
        && active.supervisor.status !== "waiting_approval";
    } else if (pendingProposal) {
      const context = createToolContext(runId);
      if (message.approved) {
        // A current pending mutation always supplies proposalId above. This is
        // retained as a fail-closed assertion for malformed compatibility input.
        throw new PublicSupervisorRunError(
          "MODEL_AGENT_APPROVAL_PROPOSAL_MISSING",
          "The pending mutation proposal has no stable approval identity."
        );
      } else {
        rejectPendingMutationProposal(context, "User rejected the pending Model Agent mutation proposal.");
        approvalInstruction = "The user rejected the pending operation. Revise the proposal before continuing.";
      }
    } else {
      if (message.proposalId) {
        throw new PublicSupervisorRunError(
          "MODEL_AGENT_APPROVAL_PROPOSAL_MISSING",
          "The referenced proposal has no pending or terminal control-plane operation."
        );
      }
      if (active.supervisor.status !== "waiting_approval") {
        throw new PublicSupervisorRunError(
          "MODEL_AGENT_APPROVAL_CHECKPOINT_MISSING",
          "The run has no active approval checkpoint. A mutation approval replay must include its stable proposal ID."
        );
      }
      approvalInstruction = message.approved
        ? "The user approved the pending control request. Continue from the current checkpoint."
        : "The user rejected the pending control request. Revise the operation before continuing.";
    }
    agentRuntime.store.updateRun(runId, {
      pendingPlan: undefined,
      pendingChangeSet: undefined
    });
    input = {
      type: "user_instruction",
      text: approvalInstruction
    };
  } else {
    throw new PublicSupervisorRunError(
      "MODEL_AGENT_MESSAGE_UNSUPPORTED",
      `Message type ${message.type} is not accepted at a structured-turn checkpoint.`
    );
  }

  if (inputCheckpointAlreadyDurable) {
    return await compactSupervisorAwareSnapshot(agentRuntime.store.getSnapshot(runId));
  }

  try {
    await active.supervisor.submit(input);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "RUN_NOT_WAITING") {
      throw new PublicSupervisorRunError(
        "MODEL_AGENT_CHECKPOINT_REQUIRED",
        "Question answers require their durable checkpoint, and instructions can be queued only while the bound session is active."
      );
    }
    throw error;
  }
  watchActiveSupervisorLifecycle(runId, active);
  active.questionSetId = null;
  agentRuntime.store.updateRun(runId, { status: "running", phase: "planning_decomposition" });
  return await compactSupervisorAwareSnapshot(agentRuntime.store.getSnapshot(runId));
}

export async function cancelStructuredModelAgentRun(runId: string): Promise<PublicAgentRunSnapshot> {
  const active = activeRuns.get(runId);
  if (!active) {
    throw new PublicSupervisorRunError(
      "MODEL_AGENT_RECOVERY_REQUIRED",
      "The persisted Model Agent run has no active fenced controller to authorize cancellation.",
      409
    );
  }
  await active.supervisor.cancel("User cancelled the run.");
  watchActiveSupervisorLifecycle(runId, active);
  return await compactSupervisorAwareSnapshot(agentRuntime.store.getSnapshot(runId));
}

export function resetActiveSupervisorRunsForTests(): void {
  if (process.env.NODE_ENV !== "test") return;
  for (const [runId, active] of activeRuns) {
    activeRuns.delete(runId);
    void active.supervisor.close()
      .then(() => active.persistence.close?.())
      .catch(() => undefined);
  }
}

function watchActiveSupervisorLifecycle(runId: string, active: ActiveSupervisorRun): void {
  const previousTask = active.lifecycleTask;
  const lifecycleTask = (previousTask
    ? previousTask.catch(() => undefined)
    : Promise.resolve()
  ).then(() => active.supervisor.wait()).then(async () => {
    if (!shouldReleaseSupervisor(active.supervisor.status)) return;
    await releaseActiveSupervisorRun(runId, active);
  });
  const trackedTask = lifecycleTask.finally(() => {
    if (active.lifecycleTask === trackedTask) active.lifecycleTask = undefined;
  });
  active.lifecycleTask = trackedTask;
  void trackedTask.catch(() => undefined);
}

function shouldReleaseSupervisor(status: VdtRunSupervisor["status"]): boolean {
  return status === "succeeded"
    || status === "failed"
    || status === "cancelled"
    || status === "closed"
    || status === "recovery_required";
}

async function releaseActiveSupervisorRun(runId: string, active: ActiveSupervisorRun): Promise<void> {
  if (activeRuns.get(runId) !== active) return;
  try {
    await active.supervisor.close();
  } finally {
    if (activeRuns.get(runId) === active) activeRuns.delete(runId);
    await active.persistence.close?.();
  }
}

class AiProviderStructuredTurnTransport implements ModelAgentTurnTransport {
  private initialContextHash: string | null = null;
  private confirmedTurnCount = 0;
  private lastConfirmedTurn: ModelProviderTurnConfirmation | null = null;
  private semanticSessionState: string | null = null;

  constructor(
    private readonly provider: AiProvider,
    private readonly definition: StructuredModelAgentExecutionBindingDefinition,
    initialContext?: Extract<ModelAgentTurnDelta, { type: "initial_context" }> | undefined
  ) {
    this.initialContextHash = initialContext?.contextHash ?? null;
  }

  async completeTurn(request: ModelAgentTurnRequest): Promise<ModelAgentTurnResponse> {
    if (request.delta.type === "initial_context") {
      if (
        this.initialContextHash
        && this.initialContextHash !== request.delta.contextHash
      ) {
        throw new PublicSupervisorRunError(
          "MODEL_SESSION_CONTEXT_REBOUND",
          "A structured Model Agent transport cannot be rebound to a different initial context."
        );
      }
      if (hashJson(request.delta.context) !== request.delta.contextHash) {
        throw new PublicSupervisorRunError(
          "MODEL_SESSION_CONTEXT_HASH_MISMATCH",
          "The structured Model Agent initial context does not match its pinned hash."
        );
      }
      if (this.confirmedTurnCount > 0 || request.previousCursor !== null) {
        throw new PublicSupervisorRunError(
          "MODEL_SESSION_INITIAL_CONTEXT_REPLAY",
          "The initial Model Agent context may be sent only in the first confirmed turn."
        );
      }
      this.initialContextHash ??= request.delta.contextHash;
    } else if (!this.initialContextHash) {
      throw new PublicSupervisorRunError(
        "MODEL_SESSION_CONTEXT_MISSING",
        "The structured Model Agent transport has no initial context for this logical session."
      );
    } else if (!this.lastConfirmedTurn) {
      throw new PublicSupervisorRunError(
        "MODEL_SESSION_CONTINUATION_MISSING",
        "The structured Model Agent transport cannot continue without a confirmed prior turn."
      );
    } else if (!this.semanticSessionState) {
      throw new PublicSupervisorRunError(
        "MODEL_SESSION_SEMANTIC_STATE_MISSING",
        "The stateless Model Agent transport has no bounded semantic checkpoint for continuation."
      );
    } else if (request.previousCursor !== this.lastConfirmedTurn.cursor) {
      throw new PublicSupervisorRunError(
        "MODEL_SESSION_CURSOR_MISMATCH",
        "The structured Model Agent turn does not continue from the last confirmed cursor."
      );
    }

    const continuation = request.delta.type === "initial_context"
      ? undefined
      : {
          schemaVersion: 1 as const,
          contextHash: this.initialContextHash!,
          confirmedTurnCount: this.confirmedTurnCount,
          lastConfirmed: structuredClone(this.lastConfirmedTurn!),
          semanticState: this.semanticSessionState!
        };
    const payload = buildModelProviderTurnPayload(request, continuation);
    if (new TextEncoder().encode(payload.userPrompt).byteLength > MAX_MODEL_TURN_PROMPT_BYTES) {
      throw new PublicSupervisorRunError(
        "MODEL_SESSION_TURN_TOO_LARGE",
        "The bounded structured-turn checkpoint delta exceeded the configured prompt limit."
      );
    }
    const output = await this.provider.completeStructured<typeof payload.input, unknown>({
      taskType: "agent_decision",
      input: payload.input,
      schema: request.responseSchema,
      systemPrompt: MODEL_AGENT_SYSTEM_PROMPT,
      userPrompt: payload.userPrompt,
      model: this.definition.modelId,
      temperature: this.definition.modelEngineAdapter.temperature ?? 0.2,
      maxTokens: this.definition.modelEngineAdapter.maxTokens ?? 8_000,
      signal: request.signal
    });
    const parsed = request.responseSchema.parse(output);
    const cursor = `turn:${parsed.turnId}:${hashJson(parsed).slice("sha256:".length, "sha256:".length + 32)}`;
    this.semanticSessionState = parsed.sessionState;
    this.confirmedTurnCount += 1;
    this.lastConfirmedTurn = {
      exchangeId: request.exchangeId,
      stableCallKey: request.stableCallKey,
      cursor,
      inputHash: hashJson(request.delta),
      outputHash: hashJson(parsed)
    };
    return {
      cursor,
      output: parsed
    };
  }
}

const MAX_MODEL_TURN_PROMPT_BYTES = 512 * 1024;

interface ModelProviderTurnConfirmation {
  exchangeId: string;
  stableCallKey: string;
  cursor: string;
  inputHash: string;
  outputHash: string;
}

interface ModelProviderSessionContinuation {
  schemaVersion: 1;
  contextHash: string;
  confirmedTurnCount: number;
  lastConfirmed: ModelProviderTurnConfirmation;
  semanticState: string;
}

/** The potentially large delta has exactly one serialization. Provider
 * implementations receive only compact exchange metadata in `input`; the
 * canonical delta lives in the prompt consumed by direct structured APIs.
 * After the initial turn, the original project/brief/catalog is replaced by a
 * bounded continuation proof plus the current checkpoint delta. */
export function buildModelProviderTurnPayload(
  request: Pick<
    ModelAgentTurnRequest,
    "exchangeId" | "stableCallKey" | "previousCursor" | "delta"
  >,
  sessionContinuation?: ModelProviderSessionContinuation | undefined
): {
  input: {
    exchangeId: string;
    stableCallKey: string;
    previousCursor: string | null;
    deltaType: ModelAgentTurnRequest["delta"]["type"];
  };
  userPrompt: string;
} {
  return {
    input: {
      exchangeId: request.exchangeId,
      stableCallKey: request.stableCallKey,
      previousCursor: request.previousCursor,
      deltaType: request.delta.type
    },
    userPrompt: JSON.stringify({
      exchangeId: request.exchangeId,
      previousCursor: request.previousCursor,
      ...(sessionContinuation ? { sessionContinuation } : {}),
      delta: request.delta
    })
  };
}

function createStructuredModelProvider(
  definition: StructuredModelAgentExecutionBindingDefinition,
  requestUrl: string
): AiProvider {
  const providerConfig = {
    ...(definition.modelEngineAdapter.providerConfig ?? {}),
    model: definition.modelId,
    ...(definition.modelEngineAdapter.providerId === "azure_openai"
      ? { deployment: definition.modelId }
      : {})
  };
  return createAiProvider({
    providerId: definition.modelEngineAdapter.providerId,
    providerConfig
  }, requestUrl);
}

function createSessionBinding(
  runId: string,
  request: VdtAgentStartRequest,
  definition: StructuredModelAgentExecutionBindingDefinition,
  projectId: string
): AgentSessionBinding {
  const capability = definition.capability;
  return {
    schemaVersion: 2,
    bindingId: deriveModelAgentSessionBindingId(definition.bindingId, runId),
    runId,
    projectId,
    executionProfile: "model_agent",
    engineId: capability.engineId,
    engineAdapterId: capability.engineAdapterId,
    backendId: capability.backendId,
    modelId: definition.modelId,
    protocolVersion: capability.protocolVersion,
    cliVersion: null,
    toolIsolation: capability.toolIsolation,
    qualificationStatus: capability.qualification.status,
    capabilityEvidenceHash: capability.qualification.evidenceHash,
    settingsHash: hashJson({
      adapter: definition.modelEngineAdapter,
      modelId: definition.modelId
    }),
    capabilityProfileHash: hashJson(capability),
    toolCatalogHash: capability.toolCatalogHash,
    externalSessionId: null,
    sessionEpoch: 1,
    boundAt: new Date().toISOString()
  };
}

export function deriveModelAgentSessionBindingId(
  executionBindingId: string,
  runId: string
): string {
  return `session-binding:${createHash("sha256")
    .update(`${executionBindingId}\0${runId}`)
    .digest("hex")
    .slice(0, 40)}`;
}

function createInitialContext(
  request: VdtAgentStartRequest,
  definition: StructuredModelAgentExecutionBindingDefinition,
  builder: VdtBuilderSession
): Readonly<Record<string, unknown>> {
  const project = builder.getProject();
  const root = project.graph.nodes.find((node) => node.id === project.rootNodeId);
  return {
    brief: {
      mode: request.mode,
      rootKpi: request.input.rootKpi,
      industry: request.input.industry,
      businessContext: request.input.businessContext ?? request.input.prompt,
      unit: request.input.unit,
      timePeriod: request.input.timePeriod,
      goal: request.input.goal,
      levelOfDetail: request.input.levelOfDetail,
      selectedNodeId: request.input.selectedNodeId,
      options: request.options
    },
    projectSummary: {
      id: project.id,
      name: project.name,
      rootNodeId: project.rootNodeId,
      rootNodeName: root?.name ?? null,
      nodeCount: project.graph.nodes.length,
      edgeCount: project.graph.edges.length,
      revision: builder.getRevision()
    },
    toolCatalogHash: definition.capability.toolCatalogHash,
    tools: currentModelAgentToolCatalog()
  };
}

function createToolContext(runId: string): AgentToolContext {
  const state = agentRuntime.store.getState(runId);
  return {
    runId,
    store: agentRuntime.store,
    emit: (event) => agentRuntime.store.appendEvent(runId, event),
    getRun: () => agentRuntime.store.getSnapshot(runId),
    updateRun: (patch) => {
      agentRuntime.store.updateRun(runId, patch);
    },
    builder: state.builder,
    signal: state.abortController.signal
  };
}

function allowTargetTool(
  request: VdtAgentStartRequest,
  toolName: string,
  context: AgentToolContext
): boolean {
  const state = context.store.getState(context.runId);
  if (state.status !== "running") return false;
  const canonical = toolName === "approval.request" ? "user.request_approval" : toolName;
  const spec = canonical === "run.request_finish" ? undefined : agentRuntime.tools.getSpec(canonical);
  if (request.mode === "review_project" && spec?.mutatesProject) return false;
  if (request.mode !== "generate_vdt" && canonical === "vdt.create_draft") return false;
  return true;
}

function syncDurableEventToLegacyState(
  event: AgentRunEventV2,
  active: ActiveSupervisorRun,
  builder: VdtBuilderSession
): void {
  const runId = event.runId;
  if (event.type === "assistant_message") {
    agentRuntime.store.appendChatMessage(runId, {
      role: "assistant",
      kind: "assistant_message",
      text: event.payload.text
    });
    agentRuntime.store.updateRun(runId, { firstResponseCompleted: true });
    agentRuntime.store.appendEvent(runId, {
      type: "assistant_message",
      phase: agentRuntime.store.getState(runId).phase,
      title: "Agent message",
      message: event.payload.text,
      metadata: { eventV2Id: event.id }
    });
    return;
  }
  if (event.type === "question") {
    active.questionSetId = event.payload.questionSetId;
    const questions = event.payload.questions.map((question) => agentQuestionSchema.parse(question));
    agentRuntime.store.updateRun(runId, {
      status: "needs_user_input",
      phase: "asking_clarifying_questions",
      pendingQuestions: questions
    });
    const currentMessages = agentRuntime.store.getState(runId).chatMessages;
    const last = currentMessages.at(-1);
    if (
      last?.kind !== "question"
      || JSON.stringify(last.questions?.map((question) => question.id)) !== JSON.stringify(questions.map((question) => question.id))
    ) {
      agentRuntime.store.appendChatMessage(runId, {
        role: "assistant",
        kind: "question",
        questions
      });
    }
    agentRuntime.store.updatePublicStatus(runId, {
      phase: "waiting_user",
      message: "Waiting for your answer."
    });
    agentRuntime.store.appendEvent(runId, {
      type: "clarifying_questions",
      phase: "asking_clarifying_questions",
      title: "Clarifying questions",
      message: `Model Agent needs ${questions.length} answer${questions.length === 1 ? "" : "s"}.`,
      questions,
      metadata: { eventV2Id: event.id, questionSetId: event.payload.questionSetId }
    });
    return;
  }
  if (event.type === "runtime_status") {
    const state = event.payload.state;
    if (state === "running" || state === "opening") {
      agentRuntime.store.updateRun(runId, { status: "running" });
    } else if (state === "cancelled") {
      const run = agentRuntime.store.getState(runId);
      run.abortController.abort("User cancelled the run.");
      agentRuntime.store.updateRun(runId, {
        status: "cancelled",
        phase: "reporting",
        completedAt: event.timestamp
      });
    } else if (state === "succeeded") {
      agentRuntime.store.updateRun(runId, { status: "succeeded", phase: "reporting" });
    }
    agentRuntime.store.updatePublicStatus(runId, {
      phase: state === "succeeded" ? "ready" : "building_draft",
      message: event.payload.message,
      updatedAt: event.timestamp
    });
    return;
  }
  if (event.type === "tool_call") {
    agentRuntime.store.updateRun(runId, { phase: "building_graph" });
    agentRuntime.store.appendEvent(runId, {
      type: "tool_call_started",
      phase: "building_graph",
      title: "VDT tool started",
      message: `Running ${event.payload.toolName}.`,
      metadata: { eventV2Id: event.id, externalCallId: event.payload.externalCallId }
    });
    return;
  }
  if (event.type === "tool_result") {
    const project = builder.getProject();
    agentRuntime.store.updateRun(runId, {
      phase: event.payload.status === "waiting_approval" ? "planning_decomposition" : "building_graph",
      ...(project.graph.nodes.length > 0 ? { draftProject: project } : {})
    });
    agentRuntime.store.appendEvent(runId, {
      type: "tool_call_completed",
      phase: agentRuntime.store.getState(runId).phase,
      title: "VDT tool completed",
      message: `${event.payload.toolName}: ${event.payload.resultCode}.`,
      metadata: {
        eventV2Id: event.id,
        externalCallId: event.payload.externalCallId,
        status: event.payload.status,
        resultCode: event.payload.resultCode
      }
    });
    return;
  }
  if (event.type === "approval_required") {
    agentRuntime.store.updateRun(runId, { status: "waiting_approval" });
    agentRuntime.store.updatePublicStatus(runId, {
      phase: "waiting_user",
      message: event.payload.summary
    });
    return;
  }
  if (event.type === "warning" || event.type === "error") {
    const retryable = event.payload.retryable;
    if (event.source === "tool_gateway") {
      // A bounded domain-tool rejection is feedback for the same cognitive
      // session, not a terminal runtime failure. Security breaches are
      // converted by the Supervisor into a separate fail-closed runtime error.
      agentRuntime.store.updateRun(runId, { phase: "planning_decomposition" });
      agentRuntime.store.appendEvent(runId, {
        type: "error",
        phase: "planning_decomposition",
        title: retryable ? "VDT tool needs reconciliation" : "VDT tool rejected",
        message: event.payload.message,
        metadata: { eventV2Id: event.id, code: event.payload.code, retryable }
      });
      return;
    }
    agentRuntime.store.updateRun(runId, {
      status: retryable ? "needs_user_input" : "failed",
      phase: "reporting",
      ...(retryable
        ? {
            retryableError: {
              code: "PROVIDER_UNAVAILABLE",
              message: event.payload.message,
              retryCount: 0,
              createdAt: event.timestamp
            }
          }
        : { error: { code: event.payload.code, message: event.payload.message }, completedAt: event.timestamp })
    });
    agentRuntime.store.appendEvent(runId, {
      type: "error",
      phase: "reporting",
      title: retryable ? "Model Agent paused" : "Model Agent failed",
      message: event.payload.message,
      metadata: { eventV2Id: event.id, code: event.payload.code, retryable }
    });
    return;
  }
  if (event.type === "final") {
    agentRuntime.store.appendEvent(runId, {
      type: "final_report",
      phase: "reporting",
      title: "Final report",
      message: event.payload.text,
      metadata: { eventV2Id: event.id, finishReceiptId: event.payload.finishReceiptId }
    });
  }
}

function applyManualProjectChange(
  runId: string,
  message: Extract<AgentUserMessage, { type: "manual_project_change" }>
): void {
  agentRuntime.store.observeManualChange(runId, {
    projectRevision: message.projectRevision,
    change: message.change
  });
  const state = agentRuntime.store.getState(runId);
  if (
    state.builder
    && message.change.kind === "node_updated"
    && message.change.nodeId
    && message.change.patch
  ) {
    state.builder.updateNode({
      nodeId: message.change.nodeId,
      patch: message.change.patch as VdtNodePatch
    });
    agentRuntime.store.updateRun(runId, { draftProject: state.builder.getProject() });
  }
}

function hasNewImmediateChild(request: VdtAgentStartRequest, builder: VdtBuilderSession): boolean {
  const selectedNodeId = request.input.selectedNodeId;
  if (!selectedNodeId) return false;
  const originalChildIds = new Set(
    request.input.project?.graph.edges
      .filter((edge) => edge.sourceNodeId === selectedNodeId)
      .map((edge) => edge.targetNodeId) ?? []
  );
  return builder.getProject().graph.edges.some(
    (edge) => edge.sourceNodeId === selectedNodeId && !originalChildIds.has(edge.targetNodeId)
  );
}

function normalizeApprovalSelection(selectedChangeIds: readonly string[]): string[] {
  return [...new Set(selectedChangeIds.map((value) => value.trim()).filter(Boolean))].sort();
}

function stableApprovalOperationCallId(
  proposalId: string,
  selectedChangeIds: readonly string[]
): string {
  return `approval-apply-${hashJson({ proposalId, selectedChangeIds }).slice("sha256:".length, 47)}`;
}

function hashJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(sortJson(value))).digest("hex")}`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJson(entry)])
  );
}

function errorCode(error: unknown, fallback: string): string {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code.slice(0, 160)
    : fallback;
}

function safeErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message.trim()) return fallback;
  if (/api.?key|authorization|password|secret|token/i.test(error.message)) return fallback;
  return error.message.slice(0, 1_000);
}
