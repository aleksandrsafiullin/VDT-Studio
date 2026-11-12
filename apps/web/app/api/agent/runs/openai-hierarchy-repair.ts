import {
  calculateGraph, calculationsWithoutPlannedInputs, decompositionPlanErrors, extractFormulaReferences, inspectDecompositionHierarchy,
  parseFormula, parseValidationUnit, validateGraph, type VdtDecompositionPlan, type VdtNode, type VdtProject
} from "@vdt-studio/vdt-core";
import { requiresDerivedRootForRun, type VdtAgentRunState, type VdtAgentStartRequest } from "@vdt-studio/vdt-agent-runtime";

export type HierarchyRepairCall = {
  toolName: "vdt.delete_node" | "vdt.reparent_branch" | "vdt.set_decomposition_plan" | "vdt.set_formula";
  args: Record<string, unknown>;
};

type RepairOwnership = Pick<VdtAgentRunState, "runId" | "manualChanges" | "mutationProposals">;

function fromEmptyRoot(request: VdtAgentStartRequest): boolean {
  const initialGraph = request.input.project?.graph;
  return requiresDerivedRootForRun(request) && !(initialGraph && (
    initialGraph.nodes.length > 1 || initialGraph.edges.length > 0
    || initialGraph.nodes.some((node) => node.decompositionPlan)
  ));
}

function untouchedAddition(ownership: RepairOwnership, nodeId: string): boolean {
  return !ownership.manualChanges.some(({ change }) => change.nodeId === nodeId
    || change.kind === "project_replaced" || change.kind === "change_set_applied")
    && Boolean(ownership.mutationProposals?.some((proposal) =>
      proposal.runId === ownership.runId && proposal.source === "agent" && proposal.status === "applied"
      && proposal.changeSet.additions.some((addition) => addition.nodeId === nodeId
        && proposal.selectedChangeIds.includes(addition.id))));
}

function manualChangesTouch(
  ownership: RepairOwnership, project: VdtProject, nodeIds: ReadonlySet<string>, edgeIds: ReadonlySet<string>
): boolean {
  return ownership.manualChanges.some(({ change }) => {
    if (change.kind === "project_replaced" || change.kind === "change_set_applied") return true;
    if (change.nodeId && nodeIds.has(change.nodeId)) return true;
    if (change.edgeId) {
      return edgeIds.has(change.edgeId) || !project.graph.edges.some(({ id }) => id === change.edgeId);
    }
    return !change.nodeId;
  });
}

function hasIndependentValue(project: VdtProject, node: VdtNode): boolean {
  return Boolean(node.dataMapping || node.valueSource || node.goalSeek || node.owner || node.assumptions?.length
    || node.value !== undefined || node.baselineValue !== undefined || node.scenarioValue !== undefined
    || project.scenarios.some(({ overrides }) => overrides.some(({ nodeId }) => nodeId === node.id))
    || project.graph.nodes.some(({ goalSeek }) => goalSeek?.targetNodeId === node.id));
}

function sameDeclaredUnit(first: string | undefined, second: string | undefined): boolean {
  if (!first?.trim() || !second?.trim()) return false;
  if (first.trim() === second.trim()) return true;
  const a = parseValidationUnit(first, true), b = parseValidationUnit(second, true);
  return Boolean(a && b && JSON.stringify(a) === JSON.stringify(b));
}

/** A wrapper is the single same-unit child that calculates the root's whole
 * result. Established, edited and independently owned calculations are outside
 * this construction repair. */
export function rootIdentityWrapper(project: VdtProject, request: VdtAgentStartRequest, ownership: RepairOwnership): VdtNode | undefined {
  if (!fromEmptyRoot(request)) return undefined;
  const root = project.graph.nodes.find(({ id }) => id === project.rootNodeId);
  const rootEdges = project.graph.edges.filter(({ sourceNodeId }) => sourceNodeId === project.rootNodeId);
  if (!root?.formula?.trim() || !root.unit?.trim() || rootEdges.length !== 1) return undefined;
  const id = rootEdges[0]!.targetNodeId;
  const child = project.graph.nodes.find((node) => node.id === id);
  const planned = root.decompositionPlan?.nodes.find(({ nodeId }) => nodeId === id);
  if (planned?.kind !== "calculated" || planned.parentNodeId !== root.id || planned.sharedWith?.length
    || child?.type !== "calculated" || !child.aiGenerated || !child.formula?.trim()
    || (child.status !== "ai_suggested" && child.status !== "accepted")
    || !sameDeclaredUnit(child.unit, root.unit) || hasIndependentValue(project, child)
    || !untouchedAddition(ownership, id)
    || project.graph.edges.filter(({ targetNodeId }) => targetNodeId === id).length !== 1) return undefined;
  const affectedEdges = [...rootEdges, ...project.graph.edges.filter(({ sourceNodeId }) => sourceNodeId === id)];
  const affectedNodes = new Set([root.id, ...affectedEdges.map(({ targetNodeId }) => targetNodeId)]);
  const affectedEdgeIds = new Set(affectedEdges.map(({ id: edgeId }) => edgeId));
  if (manualChangesTouch(ownership, project, affectedNodes, affectedEdgeIds)) return undefined;
  try {
    const expression = parseFormula(root.formula);
    if (expression.type !== "reference" || expression.name !== id) return undefined;
    if (project.graph.nodes.some((node) => node.id !== root.id && node.formula?.trim()
      && extractFormulaReferences(node.formula).includes(id))) return undefined;
  } catch { return undefined; }
  return child;
}

/** Promote the already verified expression and its factors first. The usual
 * checked hierarchy repair can then remove the unused duplicate and replan. */
export function suggestIdentityPromotion(
  project: VdtProject, request: VdtAgentStartRequest, ownership: RepairOwnership, wrapper: VdtNode
): HierarchyRepairCall[] | undefined {
  const { rootNodeId, graph } = project;
  const children = graph.edges.filter(({ sourceNodeId }) => sourceNodeId === wrapper.id);
  if (!wrapper.formula || !children.length || children.length > 5) return undefined;
  const preview = { ...project, graph: {
    nodes: graph.nodes.map((node) => node.id === rootNodeId ? { ...node, formula: wrapper.formula } : node),
    edges: graph.edges.map((edge) => edge.sourceNodeId === wrapper.id ? { ...edge, sourceNodeId: rootNodeId } : edge)
  } };
  const previous = calculateGraph(project), promoted = calculateGraph(preview);
  if (!Number.isFinite(previous.rootValue) || previous.rootValue !== promoted.rootValue || promoted.errors.length) return undefined;
  const cleanup = suggestHierarchyRepair(preview, request, ownership);
  if (!cleanup?.some(({ toolName, args }) => toolName === "vdt.delete_node" && args.nodeId === wrapper.id)) return undefined;
  return [
    { toolName: "vdt.set_formula", args: { nodeId: rootNodeId, formula: wrapper.formula } },
    ...children.map(({ targetNodeId }): HierarchyRepairCall => ({
      toolName: "vdt.reparent_branch", args: { nodeId: targetNodeId, parentNodeId: rootNodeId, fromParentNodeId: wrapper.id }
    }))
  ];
}

/** An already calculable new draft can have the right formulas and the wrong
 * visual parents. Offer a checked sequence for the model to select. */
export function suggestHierarchyRepair(
  project: VdtProject, request: VdtAgentStartRequest, ownership?: RepairOwnership
): HierarchyRepairCall[] | undefined {
  if (!fromEmptyRoot(request)) return undefined;
  const { rootNodeId, graph } = project;
  const root = graph.nodes.find((node) => node.id === rootNodeId);
  const plan = root?.decompositionPlan;
  if (!root?.formula || !plan || decompositionPlanErrors(plan, rootNodeId).length) return;
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const entries = new Map(plan.nodes.map((entry) => [entry.nodeId, entry]));
  const references = new Map<string, string[]>();
  try {
    for (const { id, formula } of graph.nodes) {
      if (formula?.trim()) references.set(id, extractFormulaReferences(formula));
    }
  } catch { return; }
  const users = new Map<string, string[]>();
  const active = new Set([rootNodeId]);
  const queue = [rootNodeId];
  for (const id of queue) {
    for (const ref of references.get(id) ?? []) {
      if (!byId.has(ref)) return;
      const parents = users.get(ref) ?? [];
      parents.push(id);
      users.set(ref, parents);
      if (!active.has(ref)) {
        active.add(ref);
        queue.push(ref);
      }
    }
  }
  if (active.size < 2 || users.has(rootNodeId)) return;

  const emptyIntermediates = new Set(calculationsWithoutPlannedInputs(plan));
  if (plan.nodes.some(({ nodeId }) => !byId.has(nodeId) && !emptyIntermediates.has(nodeId))) return;
  const duplicateIds = new Set<string>();
  const rootExpression = JSON.stringify(parseFormula(root.formula));
  for (const node of graph.nodes) {
    const entry = entries.get(node.id);
    if (active.has(node.id) || entry?.kind === "context") continue;
    // An inactive duplicate may still own factors used directly by the root.
    // Move those active factors before deleting the empty duplicate.
    const children = graph.edges.filter(({ sourceNodeId }) => sourceNodeId === node.id);
    if (entry?.kind !== "calculated" || node.type !== "calculated" || !node.aiGenerated
      || (node.status !== "ai_suggested" && (!ownership || node.status !== "accepted"))
      || (ownership && !untouchedAddition(ownership, node.id))
      || !sameDeclaredUnit(node.unit, root.unit) || !node.formula?.trim()
      || JSON.stringify(parseFormula(node.formula)) !== rootExpression
      || hasIndependentValue(project, node)
      || children.some((edge) => edge.relation === "contextual_influence"
        || !references.get(rootNodeId)?.includes(edge.targetNodeId))
      || [...references.values()].some((refs) => refs.includes(node.id))) return;
    duplicateIds.add(node.id);
  }

  const duplicateDeletion = (nodeId: string): HierarchyRepairCall =>
    ({ toolName: "vdt.delete_node", args: { nodeId, cascadeEdges: true } });
  const duplicateParents = new Set(graph.edges.filter(({ sourceNodeId }) => duplicateIds.has(sourceNodeId)).map(({ sourceNodeId }) => sourceNodeId));
  const calls = [...duplicateIds].filter((id) => !duplicateParents.has(id)).map(duplicateDeletion);
  const affectedNodes = new Set(duplicateIds);
  const affectedEdges = new Set<string>();
  for (const edge of graph.edges) {
    if (!duplicateIds.has(edge.targetNodeId) && !duplicateIds.has(edge.sourceNodeId)) continue;
    affectedNodes.add(edge.sourceNodeId);
    affectedNodes.add(edge.targetNodeId);
    affectedEdges.add(edge.id);
  }
  const parentsByNode = new Map<string, VdtDecompositionPlan["nodes"][number]>();
  const moves = new Map<string, string>();
  for (const [nodeId, formulaUsers] of users) {
    const entry = entries.get(nodeId);
    const incoming = graph.edges.filter((edge) => edge.targetNodeId === nodeId);
    const current = incoming[0];
    if (!entry || entry.kind === "context" || incoming.length !== 1 || !current) return;
    const parentNodeId = formulaUsers.includes(current.sourceNodeId) ? current.sourceNodeId
      : formulaUsers.includes(entry.parentNodeId) ? entry.parentNodeId
      : formulaUsers.length === 1 ? formulaUsers[0] : undefined;
    if (!parentNodeId) return;
    const sharedWith = formulaUsers.filter((id) => id !== parentNodeId);
    parentsByNode.set(nodeId, { ...entry, parentNodeId, sharedWith: sharedWith.length ? sharedWith : undefined });
    if (parentNodeId !== current.sourceNodeId) {
      moves.set(nodeId, parentNodeId);
      for (const id of [nodeId, parentNodeId, current.sourceNodeId]) affectedNodes.add(id);
      affectedEdges.add(current.id);
    }
  }
  // Follow the target hierarchy from the root. A new parent must already have
  // its final path to the root before we attach a child.
  const ordered = [rootNodeId];
  for (const parent of ordered) {
    for (const entry of parentsByNode.values()) if (entry.parentNodeId === parent) ordered.push(entry.nodeId);
  }
  if (ordered.length !== active.size) return;
  for (const nodeId of ordered) {
    const parentNodeId = moves.get(nodeId);
    if (!parentNodeId) continue;
    const fromParentNodeId = graph.edges.find((edge) => edge.targetNodeId === nodeId)!.sourceNodeId;
    calls.push({ toolName: "vdt.reparent_branch", args: { nodeId, parentNodeId, fromParentNodeId } });
  }
  calls.push(...[...duplicateParents].map(duplicateDeletion));
  const revised = { ...plan, nodes: plan.nodes.filter(({ nodeId }) => byId.has(nodeId) && !duplicateIds.has(nodeId))
    .map((entry) => parentsByNode.get(entry.nodeId) ?? entry) };
  if (JSON.stringify(revised) !== JSON.stringify(plan)) {
    const revisedEntries = new Map(revised.nodes.map((entry) => [entry.nodeId, entry]));
    affectedNodes.add(rootNodeId);
    for (const entry of plan.nodes) {
      const replacement = revisedEntries.get(entry.nodeId);
      if (JSON.stringify(entry) === JSON.stringify(replacement)) continue;
      for (const id of [entry.nodeId, entry.parentNodeId, ...(entry.sharedWith ?? [])]) affectedNodes.add(id);
      if (replacement) {
        for (const id of [replacement.parentNodeId, ...(replacement.sharedWith ?? [])]) affectedNodes.add(id);
      }
      for (const edge of graph.edges) {
        if (edge.targetNodeId === entry.nodeId) affectedEdges.add(edge.id);
      }
    }
    calls.push({ toolName: "vdt.set_decomposition_plan", args: { plan: revised } });
  }
  if (!calls.length || calls.length > 6) return;
  if (ownership && manualChangesTouch(ownership, project, affectedNodes, affectedEdges)) return;

  const preview: VdtProject = { ...project, graph: {
    nodes: graph.nodes.filter(({ id }) => !duplicateIds.has(id))
      .map((node) => node.id === rootNodeId ? { ...node, decompositionPlan: revised } : node),
    edges: graph.edges.filter(({ targetNodeId }) => !duplicateIds.has(targetNodeId))
      .map((edge) => ({ ...edge, sourceNodeId: moves.get(edge.targetNodeId) ?? edge.sourceNodeId }))
  } };
  if (!inspectDecompositionHierarchy(preview).valid || !validateGraph(preview, undefined, { enforcePercentageScale: true }).valid) return;
  return calls;
}
