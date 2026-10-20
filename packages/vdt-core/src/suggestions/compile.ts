import type { VdtProject, VdtWarning, GraphCalculationResult } from "../types";
import type { VdtChangeSet } from "../changeset/types";
import { previewChangeSet } from "../changeset/preview";
import { calculateGraph } from "../formula/calculate";
import { calculateScenarioGraph } from "../scenario/scenario";
import { parseFormula } from "../formula/parser";
import { extractFormulaReferences } from "../formula/evaluator";
import type { FormulaExpression } from "../formula/ast";
import { validateGraph } from "../graph/validation";
import { inspectDecompositionHierarchy } from "../graph/decomposition";
import type { KpiSuggestionContext, KpiSuggestionSelection, KpiSuggestionSet, KpiSuggestionRecipeCatalog } from "./types";
import { fingerprintKpiProject } from "./identity";
import { KPI_SUGGESTION_RECIPES, validateKpiSuggestionForContext } from "./recipes";
import { resolveKpiSuggestionSelection, smartAssert, validateKpiSuggestionContext } from "./validation";
import { verifyKpiRecipeGroup, smartUnitDimension } from "./units";
import { kpiCanonicalJson } from "./identity";

export interface CompiledKpiSuggestion {
  changeSet: VdtChangeSet;
  selectedChangeIds: Set<string>;
  preview: VdtProject;
  newNodeIds: string[];
  provenance: { proposalId: string; groupId: string; contextHash: string; mode: KpiSuggestionSelection["mode"]; recipeId?: string };
  calculation: { before: GraphCalculationResult; after: GraphCalculationResult; expectedMissingNodeIds: string[] };
  /** Actual parent and root values for baseline and every saved scenario. */
  outputPreview: Array<{ scenarioId: string | null; parentBefore: number | undefined; parentAfter: number | undefined;
    rootBefore: number | undefined; rootAfter: number | undefined }>;
  constructionWarnings: string[];
}

const normalizeConcept = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase("en").replace(/[\p{P}\p{Z}\s_]+/gu, " ");

/** Iterative full-project checks also catch visual-only cycles and long DAGs.
 * They never infer completeness from a bounded model excerpt. */
function assertAcyclic(ids: readonly string[], dependencies: ReadonlyMap<string, Set<string>>) {
  const degree = new Map(ids.map(id => [id, 0]));
  for (const set of dependencies.values()) for (const id of set) {
    smartAssert(degree.has(id), "INVALID_REFERENCE", "Graph dependency is missing."); degree.set(id, degree.get(id)! + 1);
  }
  const queue = ids.filter(id => degree.get(id) === 0); let visited = 0;
  for (let i = 0; i < queue.length; i++) {
    visited++; for (const child of dependencies.get(queue[i]!) ?? []) {
      degree.set(child, degree.get(child)! - 1); if (degree.get(child) === 0) queue.push(child);
    }
  }
  smartAssert(visited === ids.length, "CYCLE", "Smart application cannot use a graph containing a visual/formula cycle.");
}
export function assertSmartKpiGraph(project: VdtProject) {
  const ids = project.graph.nodes.map(n => n.id), visual = new Map<string, Set<string>>(), formula = new Map<string, Set<string>>();
  smartAssert(new Set(ids).size === ids.length, "DUPLICATE_ID", "Existing graph has duplicate node IDs.");
  smartAssert(new Set(project.graph.edges.map(e => e.id)).size === project.graph.edges.length, "DUPLICATE_ID", "Existing graph has duplicate edge IDs.");
  smartAssert(new Set(project.graph.edges.map(e => `${e.sourceNodeId}\u0000${e.targetNodeId}`)).size === project.graph.edges.length,
    "DUPLICATE_EDGE", "One visual parent-child pair must have one explicit relation.");
  for (const edge of project.graph.edges) {
    smartAssert(ids.includes(edge.sourceNodeId), "INVALID_REFERENCE", "Visual parent is missing.");
    const out = visual.get(edge.sourceNodeId) ?? new Set<string>(); out.add(edge.targetNodeId); visual.set(edge.sourceNodeId, out);
  }
  for (const node of project.graph.nodes) formula.set(node.id, new Set(node.formula?.trim() ? extractFormulaReferences(node.formula) : []));
  assertAcyclic(ids, visual); assertAcyclic(ids, formula);
}
function renderFormula(ast: FormulaExpression, resolved: ReadonlyMap<string, string>): string {
  if (ast.type === "reference") return resolved.get(ast.name)!;
  if (ast.type === "number") return ast.raw;
  if (ast.type === "unary") return `(-${renderFormula(ast.expression, resolved)})`;
  if (ast.type === "call") return `${ast.name}(${ast.args.map(a => renderFormula(a, resolved)).join(", ")})`;
  return `(${renderFormula(ast.left, resolved)} ${ast.operator} ${renderFormula(ast.right, resolved)})`;
}
const issueKey = (w: VdtWarning) => `${w.nodeId ?? ""}|${w.edgeId ?? ""}|${w.type}|${w.message}`;

/** No IO/provider/storage mutation. IDs and clock are host-owned and supplied
 * once; the returned candidate is ready for later immutable revision-CAS apply. */
export async function compileKpiSuggestion(project: VdtProject, context: KpiSuggestionContext, proposal: KpiSuggestionSet,
  selection: KpiSuggestionSelection, host: { operationId: string; now: string; catalog?: KpiSuggestionRecipeCatalog }): Promise<CompiledKpiSuggestion> {
  const catalog = host.catalog ?? KPI_SUGGESTION_RECIPES;
  validateKpiSuggestionContext(context);
  validateKpiSuggestionForContext(proposal, context, catalog, Date.parse(host.now));
  smartAssert(/^[a-z][a-z0-9_]{8,64}$/.test(host.operationId) && Number.isFinite(Date.parse(host.now)), "INVALID_OPERATION", "Use one host-owned operation ID and timestamp.");
  smartAssert(context.projectId === project.id && proposal.contextHash === context.contextHash && proposal.targetNodeId === context.targetNodeId
    && proposal.catalogVersion === catalog.version && await fingerprintKpiProject(project) === context.graphFingerprint,
    "STALE_PROPOSAL", "The KPI, business context or recipe catalog changed. Refresh suggestions.");
  const target = project.graph.nodes.find(n => n.id === context.targetNodeId);
  smartAssert(target && target.status !== "rejected", "INVALID_TARGET", "The target is missing or rejected.");
  smartAssert(context.target.unit === target.unit, "STALE_PROPOSAL", "Smart target unit differs from the current project.");
  assertSmartKpiGraph(project);
  const root = project.graph.nodes.find(n => n.id === project.rootNodeId)!;
  const currentPlan = root.decompositionPlan;
  if (currentPlan) {
    const hierarchy = inspectDecompositionHierarchy(project, "incremental_user_apply");
    smartAssert(hierarchy.valid, "INVALID_EXISTING_HIERARCHY", hierarchy.errors[0] ?? "The current decomposition plan requires repair.");
  }
  const group = resolveKpiSuggestionSelection(proposal, selection), selected = new Set(selection.childKeys);
  const children = group.children.filter(c => selected.has(c.key));
  const existing = new Map(project.graph.nodes.map(n => [n.id, n]));
  const directEdges = project.graph.edges.filter(e => e.sourceNodeId === target.id), directIds = new Set(directEdges.map(e => e.targetNodeId));
  smartAssert(context.omissions.directChildren === directIds.size - context.children.length && context.children.every(n => directIds.has(n.id)),
    "STALE_PROPOSAL", "Direct-child excerpt no longer matches the complete project.");
  const recipe = catalog.recipes.find(r => r.id === group.recipeBinding?.recipeId);
  if (selection.mode === "formula") {
    smartAssert(recipe, "CONTEXT_ONLY", "Only a bound audited recipe may install a formula.");
    verifyKpiRecipeGroup(recipe, { ...context, target: { ...context.target, ...(target.unit ? { unit: target.unit } : {}) } }, group);
    smartAssert(!currentPlan || target.id === root.id || currentPlan.nodes.find(n => n.nodeId === target.id)?.kind !== "context",
      "CONTEXT_ONLY", "This branch is deliberately outside the root calculation. Revise its model plan before promoting factors.");
  }
  const resolved = new Map<string, string>(), reused = new Set<string>(), newIds = new Set<string>();
  const selectedNames = new Set<string>();
  for (const child of children) {
    const conceptName = normalizeConcept(child.name);
    smartAssert(!selectedNames.has(conceptName), "DUPLICATE_CONCEPT", "Selected Smart children duplicate a normalized concept name.");
    selectedNames.add(conceptName);
    if (child.existingNodeId !== undefined) {
      const node = existing.get(child.existingNodeId);
      smartAssert(node && directIds.has(node.id) && !reused.has(node.id) && node.status !== "rejected", "UNSAFE_REUSE", "Reuse requires one explicit, active existing direct child; shared nodes cannot be reparented.");
      smartAssert(node.unit && kpiCanonicalJson(smartUnitDimension(node.unit, context)) === kpiCanonicalJson(smartUnitDimension(child.unit, context)), "UNIT_MISMATCH", "Existing child unit/period differs from the selected factor.");
      resolved.set(child.key, node.id); reused.add(node.id); continue;
    }
    const duplicate = project.graph.nodes.find(n => normalizeConcept(n.id) === normalizeConcept(child.conceptKey)
      || n.tags?.includes(`smart-concept:${child.conceptKey}`)
      || normalizeConcept(n.name) === conceptName);
    smartAssert(!duplicate, "DUPLICATE_CONCEPT", "A matching concept already exists in the project. Select its explicit direct-child reference or review the shared driver.");
    const id = `${host.operationId}_${child.key}`;
    smartAssert(!project.graph.nodes.some(n => normalizeConcept(n.id) === normalizeConcept(id)) && !newIds.has(id), "DUPLICATE_ID", "Smart node IDs must be fresh; replay the owning operation instead of adding twice.");
    newIds.add(id); resolved.set(child.key, id);
  }
  smartAssert(newIds.size > 0 || selection.mode === "formula", "NO_CHANGES", "All selected contextual children already exist.");
  if (selection.mode === "formula") {
    smartAssert(directEdges.filter(e => e.relation !== "contextual_influence").every(e => reused.has(e.targetNodeId)),
      "UNACCOUNTED_CHILDREN", "Formula replacement must explicitly account for every existing factor child.");
  }
  const changeSet: VdtChangeSet = {
    id: host.operationId,
    taskType: "suggest_incoming_kpis", backendId: proposal.origin.kind === "model" ? proposal.origin.execution.backendId : "smart_library",
    createdAt: host.now, additions: children.filter(c => !c.existingNodeId).map(child => ({
      id: `${host.operationId}_add_${child.key}`, nodeId: resolved.get(child.key)!, parentNodeId: target.id,
      name: child.name, ...(child.description ? { description: child.description } : {}), unit: child.unit, type: "input", valueStatus: "unknown",
      relation: selection.mode === "contextual" ? "contextual_influence" : recipe!.children.find(c => c.key === child.key)!.relation,
      aiRationale: `Smart proposal ${proposal.proposalId}: ${group.title}. ${proposal.rationale}`,
      tags: [`smart-concept:${child.conceptKey}`, `smart-proposal:${proposal.proposalId}`]
    })), updates: [], deletions: [], edgeChanges: [], assumptions: [], questions: [], warnings: []
  };
  if (selection.mode === "formula") {
    changeSet.updates.push({ id: `${host.operationId}_formula`, nodeId: target.id, patch: {
      formula: renderFormula(parseFormula(group.formula!), resolved), type: target.type === "root_kpi" ? "root_kpi" : "calculated", valueStatus: "calculated"
    } });
    for (const edge of directEdges.filter(e => reused.has(e.targetNodeId))) {
      const key = children.find(c => c.existingNodeId === edge.targetNodeId)!.key;
      const relation = recipe!.children.find(c => c.key === key)!.relation;
      if (edge.relation !== relation) changeSet.edgeChanges.push({ id: `${host.operationId}_edge_${key}`, action: "update", edgeId: edge.id, patch: { relation } });
    }
  }
  if (currentPlan) {
    // A user-approved one-layer mutation updates its existing declared plan in
    // the same ChangeSet. Never discard the plan or invent unrelated hierarchy.
    const plan = { ...currentPlan, nodes: currentPlan.nodes.map(entry => {
      if (selection.mode === "formula" && entry.nodeId === target.id) return { ...entry, kind: "calculated" as const };
      if (selection.mode === "formula" && reused.has(entry.nodeId)) {
        const node = existing.get(entry.nodeId)!;
        return { ...entry, kind: node.formula?.trim() ? "calculated" as const : "input" as const };
      }
      return { ...entry, ...(entry.sharedWith ? { sharedWith: [...entry.sharedWith] } : {}) };
    }) };
    for (const child of children.filter(c => !c.existingNodeId)) plan.nodes.push({
      nodeId: resolved.get(child.key)!, parentNodeId: target.id, kind: selection.mode === "contextual" ? "context" : "input",
      ...(selection.mode === "contextual" ? { rationale: `User-selected Smart context: ${child.name}. ${proposal.rationale}`.slice(0, 300) } : {})
    });
    changeSet.updates.push({ id: `${host.operationId}_plan`, nodeId: root.id, patch: { decompositionPlan: plan } });
  }
  for (const addition of changeSet.additions) smartAssert(!project.graph.edges.some(e => e.id === `edge_${target.id}_${addition.nodeId}`), "DUPLICATE_ID", "Smart edge ID collides with an existing edge.");
  const preview = previewChangeSet(project, changeSet);
  // Normalize the generic mutator's clock so this compiler is deterministic.
  const updatedIds = new Set(changeSet.updates.map(u => u.nodeId));
  preview.updatedAt = host.now;
  for (const node of preview.graph.nodes) {
    if (newIds.has(node.id)) { node.createdAt = host.now; node.updatedAt = host.now; }
    else if (updatedIds.has(node.id)) node.updatedAt = host.now;
  }
  assertSmartKpiGraph(preview);
  let constructionWarnings: string[] = [];
  if (currentPlan) {
    const hierarchy = inspectDecompositionHierarchy(preview, "incremental_user_apply");
    smartAssert(hierarchy.valid, "INVALID_HIERARCHY", hierarchy.errors[0] ?? "Smart changes would invalidate the decomposition plan.");
    constructionWarnings = hierarchy.constructionWarnings;
  }
  const validation = validateGraph(preview);
  smartAssert(validation.valid, "INVALID_GRAPH", validation.errors[0]?.message ?? "Smart changes would invalidate the graph.");
  const baselineWarnings = new Set(validateGraph(project).warnings.map(issueKey));
  smartAssert(validation.warnings.filter(w => w.type === "unit_mismatch" && !baselineWarnings.has(issueKey(w))).length === 0,
    "UNIT_MISMATCH", "Smart changes introduce a unit-validation warning.");
  const affected = new Set([target.id]);
  if (selection.mode === "formula") {
    let changed = true;
    while (changed) { changed = false; for (const node of preview.graph.nodes) {
      if (!affected.has(node.id) && node.formula && extractFormulaReferences(node.formula).some(id => affected.has(id))) { affected.add(node.id); changed = true; }
    } }
  }
  const before = calculateGraph(project), after = calculateGraph(preview), outputPreview: CompiledKpiSuggestion["outputPreview"] = [];
  const compare = (oldResult: GraphCalculationResult, next: GraphCalculationResult, scenarioId: string | null) => {
    const prior = new Set(oldResult.errors.map(issueKey));
    smartAssert(next.errors.every(w => prior.has(issueKey(w)) || w.type === "missing_value" && (newIds.has(w.nodeId ?? "") || selection.mode === "formula" && affected.has(w.nodeId ?? ""))),
      "CALCULATION_DAMAGE", "Smart changes introduce an unrelated calculation error.");
    for (const node of project.graph.nodes) if (selection.mode === "contextual" || !affected.has(node.id)) {
      smartAssert(Object.is(oldResult.values[node.id], next.values[node.id]), "CALCULATION_DAMAGE", "Smart contextual changes must preserve existing calculated/scenario outputs.");
    }
    outputPreview.push({ scenarioId, parentBefore: oldResult.values[target.id], parentAfter: next.values[target.id], rootBefore: oldResult.rootValue, rootAfter: next.rootValue });
  };
  compare(before, after, null);
  for (const scenario of project.scenarios) compare(calculateScenarioGraph(project, scenario), calculateScenarioGraph(preview, scenario), scenario.id);
  return { changeSet, selectedChangeIds: new Set([...changeSet.additions, ...changeSet.updates, ...changeSet.edgeChanges].map(e => e.id)),
    preview, newNodeIds: [...newIds], provenance: { proposalId: proposal.proposalId, groupId: group.id, contextHash: context.contextHash,
      mode: selection.mode, ...(recipe ? { recipeId: recipe.id } : {}) }, calculation: { before, after,
      expectedMissingNodeIds: after.errors.filter(e => e.type === "missing_value" && !before.errors.some(old => issueKey(old) === issueKey(e))).map(e => e.nodeId!).filter(Boolean) }, outputPreview, constructionWarnings };
}
