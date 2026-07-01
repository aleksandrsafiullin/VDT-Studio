import {
  calculateGraph,
  previewChangeSet,
  validateGraph,
  type VdtChangeSet,
  type VdtProject
} from "@vdt-studio/vdt-core";
import { AgentToolError, type AgentToolContext } from "./tool-registry";
import { summarizeCalculation, summarizeValidation } from "./summaries";
import type {
  CalculationStateSummary,
  MutationPolicy,
  MutationProposal,
  MutationProposalSource,
  ProgressiveBuildState,
  ProgressiveMutationScope,
  ValidationStateSummary
} from "./types";

export const defaultAgentMutationPolicy: MutationPolicy = {
  autoApply: false,
  askBeforeFirstPatch: true,
  requireApprovalForGraphStructure: true,
  requireApprovalForFormulaChanges: true,
  requireApprovalForDelete: true
};

export const defaultProgressiveBuildPolicy = {
  maxAutoDepth: 3,
  maxNodesPerLayer: 8,
  requireUserInputOnAmbiguity: true,
  requireUserInputOnMissingValues: false,
  allowStructureWithoutValues: true,
  allowFormulaWithoutBaselineValues: true,
  stopOnFormulaError: true
} as const;

export interface ProposeMutationInput {
  source?: MutationProposalSource | undefined;
  title: string;
  summary: string;
  changeSet: VdtChangeSet;
  targetNodeId?: string | undefined;
  selectedChangeIds?: string[] | undefined;
  allowSkillDefinedDepth?: boolean | undefined;
}

export interface MutationPipelineResult {
  proposal: MutationProposal;
  applied: boolean;
  revision: number;
  validation: ValidationStateSummary;
  calculation?: CalculationStateSummary | undefined;
}

export function proposeAndMaybeApplyMutation(
  context: AgentToolContext,
  input: ProposeMutationInput
): MutationPipelineResult {
  const builder = context.builder;
  if (!builder) throw new AgentToolError("NO_DRAFT_PROJECT", "VDT builder session is not available for this run.");

  const state = context.store.getState(context.runId);
  const changeSet = normalizeChangeSetForApply(input.changeSet);
  const normalizedInput = { ...input, changeSet };
  const baseProject = builder.getProject();
  const baseRevision = builder.getRevision();
  const selectedChangeIds = normalizedInput.selectedChangeIds ?? collectChangeIds(changeSet);
  const previewProject = previewChangeSet(baseProject, changeSet, new Set(selectedChangeIds));
  const validation = summarizeValidation(validateGraph(previewProject));
  const calculation = validation.valid ? summarizeCalculation(calculateGraph(previewProject)) : undefined;
  const policy = mutationPolicyForRun(context);
  const scope = progressiveScopeForMutation(baseProject, changeSet, normalizedInput.targetNodeId);
  const scopeError = validateProgressiveMutationScope(baseProject, changeSet, scope);
  const proposal = buildMutationProposal({
    runId: context.runId,
    project: baseProject,
    baseRevision,
    input: normalizedInput,
    selectedChangeIds,
    previewProject,
    validation,
    calculation,
    policy,
    scope,
    proposalNumber: (state.mutationProposals?.length ?? 0) + 1
  });

  context.emit({
    type: "mutation_proposed",
    phase: "previewing_mutation",
    title: "Mutation proposal created",
    message: proposal.summary,
    patch: proposal.changeSet,
    metadata: {
      proposalId: proposal.id,
      status: proposal.status,
      selectedChangeIds,
      validationValid: validation.valid,
      targetNodeId: scope?.targetNodeId
    }
  });

  if (scopeError || !validation.valid) {
    const failed = updateProposal(proposal, {
      status: "failed",
      failureReason: scopeError ?? validation.errors.map((error) => error.message).join("; ")
    });
    storeProposal(context, failed);
    context.emit({
      type: "mutation_rejected",
      phase: "previewing_mutation",
      title: scopeError ? "Mutation scope rejected" : "Mutation validation failed",
      message: failed.failureReason ?? "Mutation proposal failed validation.",
      patch: failed.changeSet,
      metadata: { proposalId: failed.id, status: failed.status }
    });
    throw new AgentToolError(
      scopeError ? "MUTATION_SCOPE_VIOLATION" : "MUTATION_VALIDATION_FAILED",
      failed.failureReason ?? "Mutation proposal failed validation.",
      { proposalId: failed.id, validation }
    );
  }

  if (requiresApproval(policy, changeSet, state.mutationProposals ?? [])) {
    storeProposal(context, proposal, { pending: true });
    context.store.updateRun(context.runId, {
      status: "waiting_approval",
      phase: "previewing_mutation",
      pendingChangeSet: proposal.changeSet,
      pendingMutationProposal: proposal,
      validationState: validation,
      ...(calculation ? { calculationState: calculation } : {})
    });
    return {
      proposal,
      applied: false,
      revision: baseRevision,
      validation,
      ...(calculation ? { calculation } : {})
    };
  }

  const applied = applyProposalToBuilder(context, proposal, selectedChangeIds);
  return applied;
}

export function applyPendingMutationProposal(
  context: AgentToolContext,
  selectedChangeIds?: string[] | undefined
): MutationPipelineResult {
  const state = context.store.getState(context.runId);
  const proposal = state.pendingMutationProposal;
  if (!proposal) throw new AgentToolError("NO_PENDING_MUTATION", "No pending mutation proposal is waiting for approval.");
  const selection = selectedChangeIds && selectedChangeIds.length > 0 ? selectedChangeIds : proposal.selectedChangeIds;
  const approved = updateProposal(proposal, {
    status: "approved",
    selectedChangeIds: selection
  });
  storeProposal(context, approved, { pending: true });
  return applyProposalToBuilder(context, approved, selection);
}

export function rejectPendingMutationProposal(context: AgentToolContext, reason: string): MutationProposal {
  const state = context.store.getState(context.runId);
  const proposal = state.pendingMutationProposal;
  if (!proposal) throw new AgentToolError("NO_PENDING_MUTATION", "No pending mutation proposal is waiting for approval.");
  const rejected = updateProposal(proposal, {
    status: "rejected",
    rejectedAt: new Date().toISOString(),
    failureReason: reason
  });
  storeProposal(context, rejected);
  context.store.updateRun(context.runId, {
    status: "needs_user_input",
    phase: "planning_decomposition",
    pendingMutationProposal: undefined,
    pendingChangeSet: undefined,
    lastToolResult: {
      toolName: "approval",
      ok: false,
      error: { code: "MUTATION_REJECTED", message: reason },
      projectChanged: false,
      validation: rejected.validation,
      mutationProposal: proposalSummary(rejected),
      emittedEventIds: []
    }
  });
  context.emit({
    type: "mutation_rejected",
    phase: "previewing_mutation",
    title: "Mutation proposal rejected",
    message: reason,
    patch: rejected.changeSet,
    metadata: { proposalId: rejected.id, status: rejected.status }
  });
  return rejected;
}

export function proposalSummary(
  proposal: MutationProposal
): Pick<MutationProposal, "id" | "status" | "title" | "summary" | "selectedChangeIds"> {
  return {
    id: proposal.id,
    status: proposal.status,
    title: proposal.title,
    summary: proposal.summary,
    selectedChangeIds: proposal.selectedChangeIds
  };
}

function applyProposalToBuilder(
  context: AgentToolContext,
  proposal: MutationProposal,
  selectedChangeIds: string[]
): MutationPipelineResult {
  const builder = context.builder;
  if (!builder) throw new AgentToolError("NO_DRAFT_PROJECT", "VDT builder session is not available for this run.");
  const beforeRevision = builder.getRevision();
  const result = builder.applyChangeSet(proposal.changeSet, new Set(selectedChangeIds));
  const afterRevision = builder.getRevision();

  if (afterRevision === beforeRevision) {
    const failed = updateProposal(proposal, {
      status: "failed",
      failureReason: result.warnings.map((warning) => warning.message).join("; ") || "Mutation could not be applied."
    });
    storeProposal(context, failed);
    context.store.updateRun(context.runId, {
      pendingMutationProposal: undefined,
      pendingChangeSet: undefined,
      validationState: failed.validation
    });
    context.emit({
      type: "mutation_rejected",
      phase: "applying_graph",
      title: "Mutation apply failed",
      message: failed.failureReason ?? "Mutation could not be applied.",
      patch: failed.changeSet,
      metadata: { proposalId: failed.id, status: failed.status }
    });
    throw new AgentToolError("MUTATION_APPLY_FAILED", failed.failureReason ?? "Mutation could not be applied.", {
      proposalId: failed.id
    });
  }

  const project = builder.getProject();
  const validation = summarizeValidation(builder.validate().validation);
  const calculation = validation.valid ? summarizeCalculation(calculateGraph(project)) : undefined;
  const applied = updateProposal(proposal, {
    status: "applied",
    appliedAt: new Date().toISOString(),
    selectedChangeIds,
    previewProject: project,
    validation,
    calculation
  });
  const progressiveBuild = updateProgressiveBuild(
    context.store.getState(context.runId).progressiveBuild,
    project,
    applied,
    context.store.getState(context.runId).request.options?.maxAutoDepth
  );
  storeProposal(context, applied);
  context.store.updateRun(context.runId, {
    status: "running",
    phase: "applying_graph",
    draftProject: project,
    pendingChangeSet: applied.changeSet,
    pendingMutationProposal: undefined,
    validationState: validation,
    progressiveBuild,
    ...(calculation ? { calculationState: calculation } : {})
  });
  context.emit({
    type: "mutation_applied",
    phase: "applying_graph",
    title: "Mutation proposal applied",
    message: applied.summary,
    patch: applied.changeSet,
    metadata: {
      proposalId: applied.id,
      status: applied.status,
      revision: afterRevision,
      selectedChangeIds
    }
  });
  context.emit({
    type: "graph_patch",
    phase: "applying_graph",
    title: applied.title,
    message: applied.summary,
    patch: applied.changeSet,
    metadata: {
      proposalId: applied.id,
      revision: afterRevision,
      nodeIds: applied.changeSet.additions.map((addition) => addition.nodeId),
      edgeIds: applied.changeSet.edgeChanges
        .filter((change) => change.action === "add")
        .map((change) => change.edge.id)
    }
  });
  return {
    proposal: applied,
    applied: true,
    revision: afterRevision,
    validation,
    ...(calculation ? { calculation } : {})
  };
}

function buildMutationProposal(input: {
  runId: string;
  project: VdtProject;
  baseRevision: number;
  input: ProposeMutationInput;
  selectedChangeIds: string[];
  previewProject: VdtProject;
  validation: ValidationStateSummary;
  calculation?: CalculationStateSummary | undefined;
  policy: MutationPolicy;
  scope?: ProgressiveMutationScope | undefined;
  proposalNumber: number;
}): MutationProposal {
  const proposal: MutationProposal = {
    id: `${input.runId}:mutation:${input.proposalNumber}`,
    runId: input.runId,
    projectId: input.project.id,
    vdtId: input.project.rootNodeId || input.project.id,
    baseRevisionId: `builder:${input.baseRevision}`,
    baseRevision: input.baseRevision,
    source: input.input.source ?? "agent",
    title: input.input.title,
    summary: input.input.summary,
    changeSet: input.input.changeSet,
    selectedChangeIds: input.selectedChangeIds,
    previewProject: input.previewProject,
    validation: input.validation,
    status: "proposed",
    policy: input.policy,
    createdAt: new Date().toISOString()
  };
  if (input.calculation) proposal.calculation = input.calculation;
  if (input.scope) proposal.progressiveScope = input.scope;
  return proposal;
}

function updateProposal(
  proposal: MutationProposal,
  patch: Partial<MutationProposal>
): MutationProposal {
  const next: MutationProposal = { ...proposal, ...patch };
  return next;
}

function storeProposal(
  context: AgentToolContext,
  proposal: MutationProposal,
  options: { pending?: boolean | undefined } = {}
): void {
  const state = context.store.getState(context.runId);
  const existing = state.mutationProposals ?? [];
  const proposals = existing.some((candidate) => candidate.id === proposal.id)
    ? existing.map((candidate) => candidate.id === proposal.id ? proposal : candidate)
    : [...existing, proposal];
  context.store.updateRun(context.runId, {
    mutationProposals: proposals,
    ...(options.pending ? { pendingMutationProposal: proposal, pendingChangeSet: proposal.changeSet } : {})
  });
}

function mutationPolicyForRun(context: AgentToolContext): MutationPolicy {
  const options = context.store.getState(context.runId).request.options;
  if (options?.autoApplyPatches === true) {
    return {
      autoApply: true,
      askBeforeFirstPatch: options.askBeforeFirstPatch ?? false,
      requireApprovalForGraphStructure: false,
      requireApprovalForFormulaChanges: false,
      requireApprovalForDelete: false
    };
  }
  return {
    ...defaultAgentMutationPolicy,
    ...(options?.askBeforeFirstPatch !== undefined ? { askBeforeFirstPatch: options.askBeforeFirstPatch } : {})
  };
}

function requiresApproval(
  policy: MutationPolicy,
  changeSet: VdtChangeSet,
  existing: MutationProposal[]
): boolean {
  if (!policy.autoApply) return true;
  if (policy.askBeforeFirstPatch && existing.every((proposal) => proposal.status !== "applied")) return true;
  if (policy.requireApprovalForDelete && changeSet.deletions.length > 0) return true;
  if (policy.requireApprovalForFormulaChanges && changeSet.updates.some((update) => update.patch.formula !== undefined)) return true;
  if (policy.requireApprovalForGraphStructure) {
    return changeSet.additions.length > 0 || changeSet.deletions.length > 0 || changeSet.edgeChanges.length > 0;
  }
  return false;
}

function progressiveScopeForMutation(
  project: VdtProject,
  changeSet: VdtChangeSet,
  targetNodeId?: string | undefined
): ProgressiveMutationScope | undefined {
  if (changeSet.additions.length === 0) return undefined;
  const parentIds = [...new Set(changeSet.additions.map((addition) => addition.parentNodeId))];
  const target = targetNodeId ?? (parentIds.length === 1 ? parentIds[0] : project.rootNodeId);
  if (!target) return undefined;
  return {
    targetNodeId: target,
    maxDepthDelta: 1,
    maxNodesPerLayer: defaultProgressiveBuildPolicy.maxNodesPerLayer,
    allowGrandchildrenInSingleMutation: false
  };
}

function validateProgressiveMutationScope(
  project: VdtProject,
  changeSet: VdtChangeSet,
  scope: ProgressiveMutationScope | undefined
): string | undefined {
  if (!scope) return undefined;
  if (changeSet.additions.length > scope.maxNodesPerLayer) {
    return `Mutation adds ${changeSet.additions.length} nodes, exceeding the one-layer limit of ${scope.maxNodesPerLayer}.`;
  }
  const parentIds = new Set(changeSet.additions.map((addition) => addition.parentNodeId));
  if (parentIds.size > 1) {
    return "One mutation can add children under only one target node.";
  }
  if (![...parentIds].every((parentId) => parentId === scope.targetNodeId)) {
    return `Mutation target must be "${scope.targetNodeId}".`;
  }
  const existingNodeIds = new Set(project.graph.nodes.map((node) => node.id));
  if (!existingNodeIds.has(scope.targetNodeId)) {
    return `Mutation target "${scope.targetNodeId}" does not exist.`;
  }
  const addedNodeIds = new Set(changeSet.additions.map((addition) => addition.nodeId));
  if (changeSet.additions.some((addition) => addedNodeIds.has(addition.parentNodeId))) {
    return "One mutation cannot add grandchildren; decompose the next layer in a separate proposal.";
  }
  if (
    changeSet.edgeChanges.some((change) =>
      change.action === "add" &&
      addedNodeIds.has(change.edge.sourceNodeId) &&
      addedNodeIds.has(change.edge.targetNodeId)
    )
  ) {
    return "One mutation cannot connect newly added nodes as parent and child in the same proposal.";
  }
  return undefined;
}

function updateProgressiveBuild(
  current: ProgressiveBuildState | undefined,
  project: VdtProject,
  proposal: MutationProposal,
  requestedMaxAutoDepth?: number | undefined
): ProgressiveBuildState {
  const childrenByParent = new Map<string, string[]>();
  for (const edge of project.graph.edges) {
    childrenByParent.set(edge.sourceNodeId, [...(childrenByParent.get(edge.sourceNodeId) ?? []), edge.targetNodeId]);
  }
  const depths = collectDepths(project, childrenByParent);
  const maxAutoDepth = current?.maxAutoDepth ?? requestedMaxAutoDepth ?? defaultProgressiveBuildPolicy.maxAutoDepth;
  const frontierNodeIds = project.graph.nodes
    .map((node) => node.id)
    .filter((nodeId) => (childrenByParent.get(nodeId)?.length ?? 0) === 0);
  const completedLayerNodeIds = new Set(current?.completedLayerNodeIds ?? []);
  if (proposal.progressiveScope?.targetNodeId) completedLayerNodeIds.add(proposal.progressiveScope.targetNodeId);
  const currentDepth = Math.max(0, ...depths.values());
  return {
    rootNodeId: project.rootNodeId,
    currentDepth,
    maxAutoDepth,
    completedLayerNodeIds: [...completedLayerNodeIds],
    frontierNodeIds,
    blockedNodeIds: current?.blockedNodeIds ?? []
  };
}

function collectDepths(project: VdtProject, childrenByParent?: Map<string, string[]>): Map<string, number> {
  const children = childrenByParent ?? new Map<string, string[]>();
  if (!childrenByParent) {
    for (const edge of project.graph.edges) {
      children.set(edge.sourceNodeId, [...(children.get(edge.sourceNodeId) ?? []), edge.targetNodeId]);
    }
  }
  const depths = new Map<string, number>();
  const visit = (nodeId: string, depth: number): void => {
    const previous = depths.get(nodeId);
    if (previous !== undefined && previous <= depth) return;
    depths.set(nodeId, depth);
    for (const childId of children.get(nodeId) ?? []) visit(childId, depth + 1);
  };
  if (project.rootNodeId) visit(project.rootNodeId, 0);
  return depths;
}

function collectChangeIds(changeSet: VdtChangeSet): string[] {
  return [
    ...changeSet.additions.map((entry) => entry.id),
    ...changeSet.updates.map((entry) => entry.id),
    ...changeSet.deletions.map((entry) => entry.id),
    ...changeSet.edgeChanges.map((entry) => entry.id)
  ];
}

function normalizeChangeSetForApply(changeSet: VdtChangeSet): VdtChangeSet {
  if (changeSet.additions.length === 0 || changeSet.edgeChanges.length === 0) return changeSet;
  const implicitEdges = new Set(changeSet.additions.map((addition) => `${addition.parentNodeId}->${addition.nodeId}`));
  const edgeChanges = changeSet.edgeChanges.filter((change) => {
    if (change.action !== "add") return true;
    return !implicitEdges.has(`${change.edge.sourceNodeId}->${change.edge.targetNodeId}`);
  });
  if (edgeChanges.length === changeSet.edgeChanges.length) return changeSet;
  return {
    ...changeSet,
    edgeChanges
  };
}
