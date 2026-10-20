import type { VdtProject } from "../types";
import type { VdtChangeSet } from "../changeset/types";
import { previewChangeSet } from "../changeset/preview";
import { extractFormulaReferences } from "../formula/evaluator";
import { inspectDecompositionHierarchy } from "../graph/decomposition";
import { assertSmartKpiGraph } from "./compile";
import { parseIncomingKpiFormula, remapIncomingKpiFormula } from "./incoming-contract";
import { validateIncomingKpiEffectiveReferences, validateIncomingKpiModelConstants, validateIncomingKpiUnits } from "./incoming-formal";
import type { IncomingKpiAlias } from "./incoming-types";
import type { KpiSuggestionPeriod } from "./types";
import { smartAssert } from "./validation";
import { kpiCanonicalJson } from "./identity";

/** Host-owned incoming-path normalization. It does not invent a formula or
 * replace a whole-tree plan: the accepted delta owns its target and new IDs. */
export function reconcileIncomingKpiPlan(project: VdtProject, raw: VdtChangeSet, targetNodeId: string): VdtChangeSet {
  const result = structuredClone(raw), candidate = previewChangeSet(project, result);
  const target = candidate.graph.nodes.find(node => node.id === targetNodeId);
  smartAssert(target, "INVALID_TARGET", "Choose an existing incoming KPI.");
  const newIds = new Set(candidate.graph.nodes.filter(node => !project.graph.nodes.some(old => old.id === node.id)).map(node => node.id));
  smartAssert(result.additions.every(row => row.nodeId && newIds.has(row.nodeId)), "INVALID_NEW_IDS", "Incoming additions require stable node IDs.");
  for (const row of result.additions) if (row.formula?.trim()) row.type = row.nodeId === project.rootNodeId ? "root_kpi" : "calculated";
  if (target.formula?.trim() && target.type !== (target.id === project.rootNodeId ? "root_kpi" : "calculated")) result.updates.push({ id: `${result.id}_incoming_type`, nodeId: target.id,
    patch: { type: target.id === project.rootNodeId ? "root_kpi" : "calculated" } });
  const plan = project.graph.nodes.find(node => node.id === project.rootNodeId)?.decompositionPlan;
  if (!plan) return result;
  const next = structuredClone(plan), nodes = new Map(candidate.graph.nodes.map(node => [node.id, node]));
  const refs = new Map(candidate.graph.nodes.map(node => [node.id, node.formula?.trim() ? extractFormulaReferences(node.formula) : []]));
  const closure = (start: string[]) => { const found = new Set<string>(), queue = [...start]; while (queue.length) { const id = queue.pop()!; if (found.has(id)) continue; found.add(id); queue.push(...(refs.get(id) ?? [])); } return found; };
  const active = closure([project.rootNodeId]), affected = closure([targetNodeId]);
  for (const id of newIds) affected.add(id);
  for (const row of result.additions) {
    const entry = next.nodes.find(entry => entry.nodeId === row.nodeId);
    smartAssert(!entry || entry.parentNodeId === row.parentNodeId, "PLAN_PARENT_MISMATCH", "Keep the planned primary parent.");
    if (!entry) next.nodes.push({ nodeId: row.nodeId!, parentNodeId: row.parentNodeId, kind: "context", rationale: "Incoming calculation draft." });
  }
  for (const entry of next.nodes) {
    if (!affected.has(entry.nodeId)) continue;
    const node = nodes.get(entry.nodeId); smartAssert(node, "MISSING_PLAN_NODE", "The incoming plan references a missing KPI.");
    if (active.has(entry.nodeId)) {
      entry.kind = node.formula?.trim() ? "calculated" : "input";
      if (entry.kind === "calculated" && !newIds.has(entry.nodeId) && node.type !== "calculated") result.updates.push({ id: `${result.id}_incoming_type_${node.id}`, nodeId: node.id, patch: { type: "calculated" } });
    } else if (newIds.has(entry.nodeId)) { entry.kind = "context"; entry.rationale = "Incoming reference calculation."; }
    const addition = result.additions.find(row => row.nodeId === entry.nodeId);
    if (addition) addition.relation = entry.kind === "context" ? "contextual_influence" : "formula_dependency";
    else {
      const edge = candidate.graph.edges.find(edge => edge.targetNodeId === entry.nodeId && edge.sourceNodeId === entry.parentNodeId);
      if (edge && (edge.relation === "contextual_influence") !== (entry.kind === "context")) result.edgeChanges.push({ id: `${result.id}_incoming_edge_${node.id}`, action: "update", edgeId: edge.id,
        patch: { relation: entry.kind === "context" ? "contextual_influence" : "formula_dependency" } });
    }
    const users = [...affected].filter(id => id !== entry.parentNodeId && (refs.get(id) ?? []).includes(entry.nodeId));
    if (users.length) entry.sharedWith = [...new Set([...(entry.sharedWith ?? []), ...users])];
  }
  result.updates.push({ id: `${result.id}_incoming_plan`, nodeId: project.rootNodeId, patch: { decompositionPlan: next } });
  const checked = previewChangeSet(project, result), hierarchy = inspectDecompositionHierarchy(checked, "incremental_user_apply");
  smartAssert(hierarchy.valid, "INVALID_INCOMING_HIERARCHY", hierarchy.errors[0] ?? "Check the incoming plan.");
  return result;
}

/** Single-layer completion is mathematical, independent of input knownness.
 * Whole-tree finish policy is unchanged. All newly accepted children must be
 * effective factors; old explanatory children can remain outside the formula. */
export function validateIncomingKpiLayer(project: VdtProject, targetNodeId: string, newNodeIds: readonly string[], retainedNodeIds?: readonly string[]): void {
  const target = project.graph.nodes.find(node => node.id === targetNodeId);
  smartAssert(target && target.formula?.trim() && target.type === (targetNodeId === project.rootNodeId ? "root_kpi" : "calculated"), "TARGET_FORMULA_REQUIRED", "Set the selected KPI formula and calculated type before finishing.");
  const formula = target.formula!;
  const refs = [...new Set(extractFormulaReferences(formula))];
  smartAssert(newNodeIds.length > 0 && new Set(newNodeIds).size === newNodeIds.length && newNodeIds.every(id => refs.includes(id)
    && project.graph.edges.some(edge => edge.sourceNodeId === targetNodeId && edge.targetNodeId === id)), "UNUSED_INCOMING_FACTOR", "Include every new incoming KPI in the parent formula.");
  const retained = refs.filter(id => !newNodeIds.includes(id));
  if (retainedNodeIds) smartAssert(new Set(retainedNodeIds).size === retainedNodeIds.length && retained.length === retainedNodeIds.length && retained.every(id => retainedNodeIds.includes(id)), "RETAINED_REFERENCE_MISMATCH", "Declare every retained formula reference exactly once.");
  smartAssert(project.graph.edges.filter(edge => edge.sourceNodeId === targetNodeId && edge.relation !== "contextual_influence").every(edge => refs.includes(edge.targetNodeId)), "UNUSED_INCOMING_FACTOR", "Include every existing mathematical child in the formula.");
  const map = new Map(refs.map((id, index) => [id, `m_${index.toString(16).padStart(32, "0")}` as IncomingKpiAlias]));
  const analysis = parseIncomingKpiFormula(remapIncomingKpiFormula(formula, map), "model");
  validateIncomingKpiEffectiveReferences(analysis); validateIncomingKpiModelConstants(analysis);
  // The unit definition may explicitly state a calendar denominator. This is
  // a matching measurement basis, never an invented calendar window/value.
  const grain = /\/(shift|day|week|month|quarter|year)s?$/.exec(target.unit ?? "")?.[1] as KpiSuggestionPeriod["grain"] | undefined;
  const period: KpiSuggestionPeriod = { key: grain ? `unit_basis:${grain}` : "unspecified", grain: grain ?? "custom" };
  smartAssert(target.unit, "UNSUPPORTED_UNIT", "The selected KPI needs a unit.");
  validateIncomingKpiUnits(analysis, refs.map(id => { const node = project.graph.nodes.find(node => node.id === id); smartAssert(node?.unit && node.status !== "rejected", "INVALID_REFERENCE", "Use an existing KPI with a unit."); return { alias: map.get(id)!, origin: "existing", name: node.name, unit: node.unit }; }), target.unit, period);
  assertSmartKpiGraph(project);
  if (project.graph.nodes.find(node => node.id === project.rootNodeId)?.decompositionPlan) {
    const hierarchy = inspectDecompositionHierarchy(project, "incremental_user_apply");
    smartAssert(hierarchy.valid, "INVALID_INCOMING_HIERARCHY", hierarchy.errors[0] ?? "Check the incoming plan.");
  }
}

/** A historical/pre-mapped task result is readable data, not a new mutation
 * grant. Re-derive the sole host plan delta and check the selected candidate. */
export function validateIncomingKpiChangeSet(project: VdtProject, changeSet: VdtChangeSet, selected: ReadonlySet<string>, trustedTargetNodeId?: string): void {
  const parents = [...new Set(changeSet.additions.map(row => row.parentNodeId))];
  smartAssert(parents.length === 1 && (!trustedTargetNodeId || parents[0] === trustedTargetNodeId), "AMBIGUOUS_INCOMING_TARGET", "Regenerate incoming KPIs for the intended target.");
  const targetNodeId = trustedTargetNodeId ?? parents[0]!;
  const targetUpdates = changeSet.updates.filter(update => update.nodeId === targetNodeId && update.patch.decompositionPlan === undefined);
  smartAssert(targetUpdates.some(update => selected.has(update.id) && update.patch.formula?.trim()), "TARGET_FORMULA_REQUIRED", "Regenerate this incoming layer with its parent formula.");
  smartAssert(!changeSet.deletions.length && !(changeSet.dataSourceChanges?.length || changeSet.dataMappingChanges?.length || changeSet.taxonomyChanges?.length)
    && targetUpdates.every(update => Object.keys(update.patch).every(key => key === "formula" || key === "type"))
    && changeSet.additions.every(row => !row.formula?.trim() && row.type !== "calculated" && row.baselineValue === undefined && row.value === undefined),
    "INVALID_INCOMING_DELTA", "Use a formula and unknown immediate inputs for this incoming step.");
  const expected = reconcileIncomingKpiPlan(project, { ...changeSet, updates: targetUpdates, edgeChanges: [] }, targetNodeId);
  const expectedProject = previewChangeSet(project, expected), candidate = previewChangeSet(project, changeSet, new Set(selected));
  const graph = (value: VdtProject) => ({ nodes: value.graph.nodes.map(({ createdAt: _createdAt, updatedAt: _updatedAt, ...node }) => node), edges: value.graph.edges });
  smartAssert(kpiCanonicalJson(graph(candidate)) === kpiCanonicalJson(graph(expectedProject)), "INVALID_INCOMING_DELTA", "Apply the complete incoming formula and its host-owned plan together.");
  validateIncomingKpiLayer(candidate, targetNodeId, changeSet.additions.filter(row => selected.has(row.id)).map(row => row.nodeId));
}
