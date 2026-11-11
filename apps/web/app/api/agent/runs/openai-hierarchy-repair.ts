import {
  decompositionPlanErrors, extractFormulaReferences, inspectDecompositionHierarchy, parseFormula, validateGraph,
  type VdtDecompositionPlan, type VdtProject
} from "@vdt-studio/vdt-core";
import { requiresDerivedRootForRun, type VdtAgentStartRequest } from "@vdt-studio/vdt-agent-runtime";

export type HierarchyRepairCall = {
  toolName: "vdt.delete_node" | "vdt.reparent_branch" | "vdt.set_decomposition_plan";
  args: Record<string, unknown>;
};

/** An already calculable new draft can have the right formulas and the wrong
 * visual parents. Offer a checked sequence for the model to select. The
 * proposal changes no retained formulas, source facts, or node IDs. */
export function suggestHierarchyRepair(project: VdtProject, request: VdtAgentStartRequest): HierarchyRepairCall[] | undefined {
  // An empty root saved by the editor is also a new draft. Keep the repair
  // restricted to construction so it cannot revise an existing user's plan.
  const initialGraph = request.input.project?.graph;
  if (!requiresDerivedRootForRun(request) || (initialGraph && (
    initialGraph.nodes.length > 1 || initialGraph.edges.length > 0
    || initialGraph.nodes.some((node) => node.decompositionPlan)
  ))) return;
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
    // Only an unreferenced, AI-created leaf duplicating the root expression
    // can be proposed for removal. Any retained fact needs the model's care.
    if (entry?.kind !== "calculated" || node.type !== "calculated" || !node.aiGenerated
      || node.status !== "ai_suggested" || node.unit !== root.unit || !node.formula?.trim()
      || JSON.stringify(parseFormula(node.formula)) !== rootExpression
      || node.dataMapping || node.valueSource || node.goalSeek || node.assumptions?.length
      || node.value !== undefined || node.baselineValue !== undefined || node.scenarioValue !== undefined
      || graph.edges.some((edge) => edge.sourceNodeId === node.id)
      || [...references.values()].some((refs) => refs.includes(node.id))) return;
    duplicateIds.add(node.id);
  }

  const calls: HierarchyRepairCall[] = [...duplicateIds].map((nodeId) =>
    ({ toolName: "vdt.delete_node", args: { nodeId, cascadeEdges: true } }));
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
    if (parentNodeId !== current.sourceNodeId) moves.set(nodeId, parentNodeId);
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
  const revised = { ...plan, nodes: plan.nodes.filter(({ nodeId }) => byId.has(nodeId) && !duplicateIds.has(nodeId))
    .map((entry) => parentsByNode.get(entry.nodeId) ?? entry) };
  if (JSON.stringify(revised) !== JSON.stringify(plan)) calls.push({ toolName: "vdt.set_decomposition_plan", args: { plan: revised } });
  if (!calls.length || calls.length > 6) return;

  const preview: VdtProject = { ...project, graph: {
    nodes: graph.nodes.filter(({ id }) => !duplicateIds.has(id))
      .map((node) => node.id === rootNodeId ? { ...node, decompositionPlan: revised } : node),
    edges: graph.edges.filter(({ targetNodeId }) => !duplicateIds.has(targetNodeId))
      .map((edge) => ({ ...edge, sourceNodeId: moves.get(edge.targetNodeId) ?? edge.sourceNodeId }))
  } };
  if (!inspectDecompositionHierarchy(preview).valid || !validateGraph(preview, undefined, { enforcePercentageScale: true }).valid) return;
  return calls;
}

export function calculationsWithoutPlannedInputs(plan: unknown): string[] {
  const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
  if (!isRecord(plan) || !Array.isArray(plan.nodes)) return [];
  const factors = plan.nodes.filter((node): node is Record<string, unknown> => isRecord(node) && node.kind !== "context");
  const users = new Set(factors.flatMap((factor) =>
    [factor.parentNodeId, ...(Array.isArray(factor.sharedWith) ? factor.sharedWith : [])]));
  return factors.flatMap((factor) => factor.kind === "calculated" && typeof factor.nodeId === "string"
    && !users.has(factor.nodeId) ? [factor.nodeId] : []);
}
