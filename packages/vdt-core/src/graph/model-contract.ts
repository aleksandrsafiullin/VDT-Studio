import type { VdtGraph, VdtWarning } from "../types";
import { decompositionPlanErrors } from "./decomposition";

/** Semantic model checks are separate from readable/importable draft shape. */
export function validateModelContract(graph: VdtGraph, rootId: string | undefined, references: ReadonlyMap<string, string[]>, allowIncomplete = false): VdtWarning[] {
  const errors: VdtWarning[] = [];
  const add = (key: string, message: string, nodeId?: string, edgeId?: string, type: VdtWarning["type"] = "invalid_graph") => {
    errors.push({ id: `validation-model-${key}`, severity: "error", type, message, ...(nodeId ? { nodeId } : {}), ...(edgeId ? { edgeId } : {}) });
  };
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const root = rootId ? nodes.get(rootId) : undefined;
  if (root) {
    if (root.type !== "root_kpi") add("root-type", `“${root.name}” is the model root and must have type Root KPI.`, root.id);
    if (!allowIncomplete && !root.formula?.trim() && !Number.isFinite(root.baselineValue ?? root.value)) {
      add("root-value", `“${root.name}” needs a formula or a finite Baseline value.`, root.id, undefined, "missing_value");
    }
  }
  for (const node of graph.nodes) {
    if (node.type === "root_kpi" && node.id !== rootId) add(`extra-root-${node.id}`, `“${node.name}” is marked Root KPI, but “${root?.name ?? rootId ?? "the model root"}” is the actual root.`, node.id);
    if (!allowIncomplete && node.type === "calculated" && !node.formula?.trim() && !node.goalSeek) {
      add(`missing-formula-${node.id}`, `Calculated KPI “${node.name}” needs a formula. Use Input for a measured value.`, node.id, undefined, "missing_formula");
    }
  }

  const children = new Map<string, typeof graph.edges>();
  for (const edge of graph.edges) {
    if (!nodes.has(edge.sourceNodeId) || !nodes.has(edge.targetNodeId)) continue;
    const outgoing = children.get(edge.sourceNodeId) ?? [];
    outgoing.push(edge);
    children.set(edge.sourceNodeId, outgoing);
    if (edge.targetNodeId === rootId) add(`root-parent-${edge.id}`, `The root KPI “${root?.name}” cannot have an incoming visual link.`, rootId, edge.id);
  }
  // Iterative traversal also handles long imported trees without recursive DFS.
  const color = new Map<string, "active" | "done">();
  for (const start of nodes.keys()) {
    if (color.has(start)) continue;
    const stack = [{ id: start, next: 0 }];
    const position = new Map([[start, 0]]);
    color.set(start, "active");
    while (stack.length) {
      const frame = stack[stack.length - 1]!;
      const edge = children.get(frame.id)?.[frame.next++];
      if (!edge) { color.set(frame.id, "done"); position.delete(frame.id); stack.pop(); continue; }
      if (color.get(edge.targetNodeId) === "active") {
        const cycle = stack.slice(position.get(edge.targetNodeId)!).map(item => item.id);
        add(`visual-cycle-${edge.id}`, `Visual links contain a cycle: ${[...cycle, edge.targetNodeId].map(id => nodes.get(id)!.name).join(" → ")}. Remove or reparent a link.`, edge.targetNodeId, edge.id, "circular_dependency");
      } else if (!color.has(edge.targetNodeId)) {
        position.set(edge.targetNodeId, stack.length); color.set(edge.targetNodeId, "active");
        stack.push({ id: edge.targetNodeId, next: 0 });
      }
    }
  }

  // Progressive edits may temporarily leave formulas and links out of sync.
  // The ordinary model validator and finish gate still require reconciliation.
  if (allowIncomplete) return errors;
  const plan = root?.decompositionPlan;
  const entries = plan && !decompositionPlanErrors(plan, rootId!).length ? new Map(plan.nodes.map(entry => [entry.nodeId, entry])) : undefined;
  const active = new Set<string>();
  const pending = rootId ? [rootId] : [];
  while (pending.length) {
    const id = pending.pop()!;
    if (active.has(id)) continue;
    active.add(id); pending.push(...(references.get(id) ?? []));
  }
  const shared = (user: string, ref: string) => {
    const entry = entries?.get(ref);
    return entry && entry.kind !== "context" && entry.sharedWith?.includes(user)
      && children.get(entry.parentNodeId)?.some(edge => edge.targetNodeId === ref && edge.relation !== "contextual_influence");
  };
  for (const node of graph.nodes) {
    const refs = new Set(references.get(node.id) ?? []);
    const edges = children.get(node.id) ?? [];
    for (const ref of refs) {
      if (!nodes.has(ref)) continue; // The shape validator reports unknown references.
      const direct = edges.filter(edge => edge.targetNodeId === ref);
      if (direct.some(edge => edge.relation !== "contextual_influence")) continue;
      // A context branch may have its own explicit reference calculation. Its
      // visual context links never activate that branch in the root equation.
      if (!active.has(node.id) && direct.length) continue;
      if (!direct.length && shared(node.id, ref)) continue;
      const target = nodes.get(ref)!;
      add(`missing-factor-${node.id}-${ref}`, direct.length
        ? `Formula for “${node.name}” uses “${target.name}”, but its link is contextual. Make the link mathematical or remove the formula reference.`
        : `Formula for “${node.name}” uses “${target.name}” without a mathematical link or a declared shared reference. Add the link or declare the reuse.`, node.id, direct[0]?.id);
    }
    for (const edge of edges) {
      if (edge.relation === "contextual_influence" || refs.has(edge.targetNodeId)) continue;
      add(`unused-factor-${edge.id}`, `The mathematical link from “${node.name}” to “${nodes.get(edge.targetNodeId)!.name}” is not used by its formula. Include this KPI in the formula or mark the link as contextual.`, node.id, edge.id);
    }
  }
  return errors;
}
