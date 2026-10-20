import type { VdtDecompositionPlan, VdtGraph, VdtProject } from "../types";
import { extractFormulaReferences } from "../formula/evaluator";
import type { FormulaExpression } from "../formula/ast";
import { parseFormula } from "../formula/parser";

/** Only fold literal constants, never current input values: a real factor may
 * legitimately have a zero baseline or be inactive at a min/max bottleneck. */
function effectiveReferences(expression: FormulaExpression): { constant?: number; refs: string[] } {
  if (expression.type === "number") return { constant: expression.value, refs: [] };
  if (expression.type === "reference") return { refs: [expression.name] };
  if (expression.type === "unary") {
    const child = effectiveReferences(expression.expression);
    return child.constant === undefined ? child : { constant: -child.constant, refs: [] };
  }
  if (expression.type === "call") {
    const args = expression.args.map(effectiveReferences);
    if (args.every(a => a.constant !== undefined)) return {
      constant: (expression.name === "min" ? Math.min : Math.max)(...args.map(a => a.constant!)), refs: []
    };
    return { refs: [...new Set(args.flatMap(a => a.refs))] };
  }
  const left = effectiveReferences(expression.left), right = effectiveReferences(expression.right);
  if (expression.operator === "*" && (left.constant === 0 || right.constant === 0)) return { constant: 0, refs: [] };
  if (left.constant !== undefined && right.constant !== undefined) {
    const a = left.constant, b = right.constant;
    const constant = expression.operator === "+" ? a + b : expression.operator === "-" ? a - b : expression.operator === "*" ? a * b : a / b;
    if (Number.isFinite(constant)) return { constant, refs: [] };
  }
  return { refs: [...new Set([...left.refs, ...right.refs])] };
}

const idPattern = /^[A-Za-z_][A-Za-z0-9_]{0,159}$/;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export function decompositionPlanErrors(value: unknown, rootId: string): string[] {
  if (!record(value) || value.version !== 1 || typeof value.goal !== "string" || !value.goal.trim() || value.goal.length > 500
    || !Array.isArray(value.nodes) || !value.nodes.length || value.nodes.length > 160) return ["PLAN_INVALID: version 1, a goal and 1-160 planned nodes are required."];
  const errors: string[] = [], parents = new Map<string, string>();
  for (const n of value.nodes) {
    if (!record(n) || typeof n.nodeId !== "string" || !idPattern.test(n.nodeId) || typeof n.parentNodeId !== "string" || !idPattern.test(n.parentNodeId)
      || !["calculated", "input", "context"].includes(String(n.kind))) { errors.push("PLAN_INVALID_NODE: use valid nodeId, parentNodeId and kind."); continue; }
    if (n.nodeId === rootId || parents.has(n.nodeId)) errors.push(`PLAN_DUPLICATE_NODE: ${n.nodeId}`);
    if (n.kind === "context" && (typeof n.rationale !== "string" || !n.rationale.trim())) errors.push(`CONTEXT_RATIONALE_REQUIRED: ${n.nodeId}`);
    if (n.rationale !== undefined && (typeof n.rationale !== "string" || n.rationale.length > 300)) errors.push(`PLAN_INVALID_RATIONALE: ${n.nodeId}`);
    if (n.sharedWith !== undefined && (!Array.isArray(n.sharedWith) || n.sharedWith.length > 20 || n.sharedWith.some(v => typeof v !== "string" || !idPattern.test(v)))) errors.push(`PLAN_INVALID_SHARED_USERS: ${n.nodeId}`);
    parents.set(n.nodeId, n.parentNodeId);
  }
  for (const [id, parent] of parents) {
    if (parent !== rootId && !parents.has(parent)) errors.push(`PLAN_PARENT_MISSING: ${id} -> ${parent}`);
    const entry = value.nodes.find(n => record(n) && n.nodeId === id);
    const parentEntry = value.nodes.find(n => record(n) && n.nodeId === parent);
    // An input remains a mathematical leaf. Explicit explanatory context can
    // be displayed beneath it without becoming a factor or changing its value.
    if (record(parentEntry) && parentEntry.kind === "input" && record(entry) && entry.kind !== "context") errors.push(`PLAN_INPUT_HAS_CHILDREN: ${parent}`);
    if (record(entry) && entry.kind !== "context" && parent !== rootId && record(parentEntry) && parentEntry.kind !== "calculated") errors.push(`PLAN_FACTOR_PARENT_NOT_CALCULATED: ${id} -> ${parent}`);
    const seen = new Set([id]); let cursor = parent;
    while (cursor !== rootId && parents.has(cursor)) {
      if (seen.has(cursor)) { errors.push(`PLAN_CYCLE: ${id}`); break; }
      seen.add(cursor); cursor = parents.get(cursor)!;
    }
  }
  for (const n of value.nodes) if (record(n) && Array.isArray(n.sharedWith)) for (const user of n.sharedWith) {
    if (user !== rootId && !parents.has(String(user))) errors.push(`PLAN_SHARED_USER_MISSING: ${n.nodeId} -> ${user}`);
    if (user === n.nodeId) errors.push(`PLAN_SHARED_SELF_REFERENCE: ${n.nodeId}`);
  }
  return errors;
}

/** Construction policy, deliberately separate from import shape validation so
 * historical plans stay readable and can be repaired by the actor. */
export function decompositionPlanGroupingErrors(plan: VdtDecompositionPlan, rootId: string): string[] {
  const parents = new Set(plan.nodes.map(n => n.parentNodeId));
  const leaves = plan.nodes.filter(n => n.kind === "context" && n.parentNodeId === rootId && !parents.has(n.nodeId));
  return leaves.length > 1 ? [`ROOT_CONTEXT_LEAVES_REQUIRE_GROUP: ${leaves.length} reference inputs are direct root children (${leaves.slice(0, 8).map(n => n.nodeId).join(", ")}). Keep related reference inputs under context groups; groups need no numeric value or formula.`] : [];
}

/** A declared, unvalued reference container is informational, not an unknown
 * numerical input. Its numerical leaves still participate in normal checks. */
export function getDecompositionContextGroupIds(graph: VdtGraph, rootId: string): Set<string> {
  const plan = graph.nodes.find(n => n.id === rootId)?.decompositionPlan;
  if (!plan || decompositionPlanErrors(plan, rootId).length) return new Set();
  const parents = new Set(plan.nodes.filter(n => n.kind === "context").map(n => n.parentNodeId));
  const contexts = new Set(plan.nodes.filter(n => n.kind === "context").map(n => n.nodeId));
  return new Set(graph.nodes.filter(n => contexts.has(n.id) && parents.has(n.id)
    && !n.formula?.trim() && n.baselineValue === undefined && n.value === undefined).map(n => n.id));
}

/** Structural acceptance is separate from arithmetic and business certification.
 * A tree has one primary visual parent; declared sharedWith keeps cross-branch
 * formula reuse explicit without duplicate source nodes or shortcut edges. */
export function inspectDecompositionHierarchy(project: VdtProject, purpose: "agent_construction" | "incremental_user_apply" = "agent_construction") {
  const root = project.graph.nodes.find(n => n.id === project.rootNodeId);
  const plan = root?.decompositionPlan;
  const errors = plan ? decompositionPlanErrors(plan, project.rootNodeId) : ["DECOMPOSITION_PLAN_REQUIRED: call vdt.set_decomposition_plan before construction."];
  const constructionWarnings: string[] = [];
  if (errors.length || !plan) return { valid: false, errors, constructionWarnings, plannedNodes: 0, maxDepth: 0 };
  const grouping = decompositionPlanGroupingErrors(plan, project.rootNodeId);
  // Only an explicit user-add caller can request incremental inspection. Agent
  // tools/finish retain the default and cannot select this mode in tool input.
  if (purpose === "incremental_user_apply") constructionWarnings.push(...grouping);
  else errors.push(...grouping);
  const entries = new Map(plan.nodes.map(n => [n.nodeId, n]));
  const nodes = new Map(project.graph.nodes.map(n => [n.id, n]));
  const references = new Map<string, string[]>();
  for (const n of project.graph.nodes) {
    try {
      const refs = n.formula?.trim() ? effectiveReferences(parseFormula(n.formula)).refs : [];
      references.set(n.id, refs);
      for (const ref of n.formula?.trim() ? extractFormulaReferences(n.formula) : []) if (!refs.includes(ref)) {
        errors.push(`INEFFECTIVE_FORMULA_DEPENDENCY: ${n.id} -> ${ref} is eliminated by a literal zero multiplier. Use a real factor dependency or keep an independent reference branch as context; remove dummy terms.`);
      }
    }
    catch { errors.push(`HIERARCHY_INVALID_FORMULA: ${n.id}`); references.set(n.id, []); }
  }
  const active = new Set<string>(), queue = [project.rootNodeId];
  while (queue.length) { const id = queue.pop()!; if (active.has(id)) continue; active.add(id); queue.push(...(references.get(id) ?? [])); }
  for (const n of project.graph.nodes) if (n.id !== project.rootNodeId && !entries.has(n.id)) errors.push(`UNPLANNED_NODE: ${n.id}`);
  let maxDepth = 0;
  for (const e of plan.nodes) {
    const node = nodes.get(e.nodeId);
    if (!node) { errors.push(`PLANNED_NODE_MISSING: ${e.nodeId}`); continue; }
    let depth = 1, cursor = e.parentNodeId;
    while (cursor !== project.rootNodeId) { depth++; cursor = entries.get(cursor)!.parentNodeId; }
    maxDepth = Math.max(maxDepth, depth);
    const incoming = project.graph.edges.filter(edge => edge.targetNodeId === e.nodeId);
    if (incoming.length !== 1 || incoming[0]?.sourceNodeId !== e.parentNodeId) errors.push(`WRONG_VISUAL_PARENT: ${e.nodeId} must have only parent ${e.parentNodeId}; use vdt.reparent_branch, or vdt.add_edge for an orphan.`);
    if (incoming.some(edge => (edge.relation === "contextual_influence") !== (e.kind === "context"))) errors.push(`WRONG_EDGE_KIND: ${e.nodeId}; context uses contextual_influence, drivers use factor relations.`);
    if (e.kind === "context") {
      if (active.has(e.nodeId)) errors.push(`ACTIVE_FACTOR_MARKED_CONTEXT: ${e.nodeId}`);
    } else {
      if (!active.has(e.nodeId)) errors.push(`UNUSED_PLANNED_FACTOR: ${e.nodeId}; connect it through formulas or explicitly classify as context.`);
      if (!(references.get(e.parentNodeId) ?? []).includes(e.nodeId)) errors.push(`PARENT_FORMULA_MISMATCH: ${e.parentNodeId} must directly reference its child ${e.nodeId}.`);
      if (e.kind === "calculated" && (!node.formula?.trim() || node.type !== "calculated")) errors.push(`PLANNED_CALCULATION_MISSING: ${e.nodeId}`);
      if (e.kind === "input" && (node.formula?.trim() || ["root_kpi", "calculated"].includes(node.type))) errors.push(`PLANNED_INPUT_MISMATCH: ${e.nodeId}`);
    }
    for (const user of e.sharedWith ?? []) if (!(references.get(user) ?? []).includes(e.nodeId)) errors.push(`UNUSED_SHARED_DECLARATION: ${user} does not reference ${e.nodeId}.`);
  }
  for (const id of active) for (const ref of references.get(id) ?? []) {
    const e = entries.get(ref);
    if (!e || (e.parentNodeId !== id && !e.sharedWith?.includes(id))) errors.push(`UNDECLARED_FORMULA_DEPENDENCY: ${id} -> ${ref}; give the input its actual parent or declare sharedWith.`);
  }
  if (project.graph.edges.some(e => e.targetNodeId === project.rootNodeId)) errors.push("ROOT_HAS_PARENT: the root KPI cannot be a child.");
  return { valid: errors.length === 0, errors, constructionWarnings, plannedNodes: plan.nodes.length, maxDepth };
}

/** Layer-by-layer construction: all planned factors at shallower depths must
 * exist first. Context observations do not block the analytical frontier. */
export function plannedAdditionErrors(project: VdtProject, additions: Array<{ nodeId?: string; parentNodeId: string }>): string[] {
  const plan = project.graph.nodes.find(n => n.id === project.rootNodeId)?.decompositionPlan;
  if (!plan) return ["DECOMPOSITION_PLAN_REQUIRED: call vdt.set_decomposition_plan first."];
  const invalid = decompositionPlanErrors(plan, project.rootNodeId); if (invalid.length) return invalid;
  const entries = new Map(plan.nodes.map(n => [n.nodeId, n]));
  const existing = new Set(project.graph.nodes.map(n => n.id));
  const depth = (id: string): number => { let n = 0; while (id !== project.rootNodeId) { n++; id = entries.get(id)!.parentNodeId; } return n; };
  const errors: string[] = [];
  for (const a of additions) {
    const e = a.nodeId ? entries.get(a.nodeId) : undefined;
    if (!e || e.parentNodeId !== a.parentNodeId) { errors.push(`ADDITION_NOT_IN_PLAN: ${a.nodeId ?? "<missing nodeId>"} under ${a.parentNodeId}.`); continue; }
    if (e.kind !== "context") {
      const missing = plan.nodes.filter(p => p.kind !== "context" && depth(p.nodeId) < depth(e.nodeId) && !existing.has(p.nodeId));
      if (missing.length) errors.push(`EARLIER_LAYER_INCOMPLETE: create ${missing.slice(0,8).map(n=>n.nodeId).join(", ")} first.`);
    }
  }
  return errors;
}
