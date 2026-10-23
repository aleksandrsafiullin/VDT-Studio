import type { VdtProject, GraphCalculationResult, VdtWarning } from "../types";
import type { VdtChangeSet, VdtNodeUpdate } from "../changeset/types";
import { previewChangeSet } from "../changeset/preview";
import { validateGraph } from "../graph/validation";
import { inspectDecompositionHierarchy } from "../graph/decomposition";
import { calculateGraph } from "../formula/calculate";
import { calculateScenarioGraph } from "../scenario/scenario";
import { extractFormulaReferences } from "../formula/evaluator";
import { parseFormula } from "../formula/parser";
import { assertSmartKpiGraph } from "./compile";
import { expandIncomingKpiFormula, inspectIncomingKpiDraft } from "./incoming-contract";
import { validateIncomingKpiEffectiveReferences, validateIncomingKpiModelConstants, validateIncomingKpiUnits } from "./incoming-formal";
import { fingerprintKpiProject, kpiCanonicalJson } from "./identity";
import { validateKpiSuggestionForContext } from "./recipes";
import { smartAssert } from "./validation";
import { incomingKpiInputValuePatch, incomingKpiReferenceValuePatch, resolveIncomingKpiValues, type IncomingKpiValueResolution } from "./incoming-values";
import type { IncomingKpiBatchInput, IncomingKpiBatchPreview, IncomingKpiDraftBinding, IncomingKpiLineage, IncomingKpiOutputPreview, IncomingKpiResolvedAlias } from "./incoming-types";

export interface CompiledIncomingKpiBatch {
  changeSet: VdtChangeSet; selectedChangeIds: Set<string>; preview: VdtProject;
  newNodeIds: string[]; aliases: IncomingKpiResolvedAlias[]; formula: string;
  lineage: IncomingKpiLineage; bindings: IncomingKpiDraftBinding[];
  outputPreview: IncomingKpiOutputPreview[]; constructionWarnings: string[];
  values: IncomingKpiValueResolution;
}
const normalized = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase("en").replace(/[\p{P}\p{Z}\s_]+/gu, " ");
const issueKey = (w: VdtWarning) => `${w.nodeId ?? ""}|${w.edgeId ?? ""}|${w.type}|${w.message}`;

/** A historical contextual addition can leave an input labelled calculated
 * without installing a formula. Its declared input role and exclusively
 * contextual children make restoring the type unambiguous. Never invent a
 * formula, promote context to factors, or relax hierarchy validation. */
function plannedInputTypeRepairs(project: VdtProject, operationId: string): VdtNodeUpdate[] {
  const plan = project.graph.nodes.find(node => node.id === project.rootNodeId)?.decompositionPlan;
  if (!plan) return [];
  return plan.nodes.flatMap(entry => {
    const node = project.graph.nodes.find(candidate => candidate.id === entry.nodeId);
    if (entry.kind !== "input" || !node || node.type !== "calculated" || node.formula?.trim()
      || project.graph.edges.some(edge => edge.sourceNodeId === node.id && edge.relation !== "contextual_influence")
      || plan.nodes.some(child => child.parentNodeId === node.id && child.kind !== "context")) return [];
    return [{ id: `${operationId}_restore_input_${node.id}`, nodeId: node.id, patch: { type: "input" as const } }];
  });
}

export async function compileIncomingKpiBatch(project: VdtProject, input: IncomingKpiBatchInput, host: { operationId: string; now: string }): Promise<CompiledIncomingKpiBatch> {
  const inspected = inspectIncomingKpiDraft(input, project);
  smartAssert(inspected.readyForCompile, inspected.readyForCompile ? "INVALID_DRAFT" : inspected.issues[0]!.code, inspected.readyForCompile ? "Check the formula." : inspected.issues[0]!.message);
  const { analysis, bindings, lineage } = inspected;
  const target = project.graph.nodes.find(node => node.id === input.context.targetNodeId), root = project.graph.nodes.find(node => node.id === project.rootNodeId);
  smartAssert(target && root && target.status !== "rejected" && target.unit, "INVALID_TARGET", "Choose a KPI with a unit.");
  smartAssert(/^[a-z][a-z0-9_]{8,64}$/.test(host.operationId) && Number.isFinite(Date.parse(host.now)), "INVALID_OPERATION", "Use the owning operation ID.");
  smartAssert(await fingerprintKpiProject(project) === input.context.graphFingerprint && target.unit === input.context.target.unit, "STALE_DRAFT", "Refresh the KPI context.");
  if (input.proposal) validateKpiSuggestionForContext(input.proposal, input.context, undefined, Date.parse(host.now));
  assertSmartKpiGraph(project);
  const plan = root.decompositionPlan;
  const inputTypeRepairs = plannedInputTypeRepairs(project, host.operationId);
  if (plan) {
    const repairedIds = new Set(inputTypeRepairs.map(update => update.nodeId));
    const checkedProject: VdtProject = repairedIds.size ? { ...project, graph: { ...project.graph,
      nodes: project.graph.nodes.map(node => repairedIds.has(node.id) ? { ...node, type: "input" } : node) } } : project;
    const before = inspectDecompositionHierarchy(checkedProject, "incremental_user_apply");
    smartAssert(before.valid, "INVALID_EXISTING_HIERARCHY", before.errors[0] ?? "Repair the existing plan.");
  }
  validateIncomingKpiEffectiveReferences(analysis);
  if (input.draft.formulaAuthorship === "model" || input.draft.formulaAuthorship === "recipe") validateIncomingKpiModelConstants(analysis);
  validateIncomingKpiUnits(analysis, bindings, target.unit, input.context.period);
  const targetOffRoot = plan?.nodes.find(entry => entry.nodeId === target.id)?.kind === "context";
  const direct = project.graph.edges.filter(edge => edge.sourceNodeId === target.id);
  const existingIds = new Set(bindings.flatMap(row => row.existingNodeId ? [row.existingNodeId] : []));
  smartAssert(!existingIds.has(target.id), "SELF_REFERENCE", "A KPI cannot reference itself.");
  smartAssert(direct.filter(edge => edge.relation !== "contextual_influence").every(edge => existingIds.has(edge.targetNodeId)), "UNACCOUNTED_CHILDREN", "Include every existing factor in the formula.");
  const selectedNames = new Set<string>();
  const aliases: IncomingKpiResolvedAlias[] = bindings.map(row => {
    const name = normalized(row.name);
    smartAssert(!selectedNames.has(name), "DUPLICATE_CONCEPT", "Use distinct KPI names."); selectedNames.add(name);
    if (row.existingNodeId) {
      const node = project.graph.nodes.find(node => node.id === row.existingNodeId);
      smartAssert(node && node.status !== "rejected" && node.unit === row.unit, "STALE_REFERENCE", "Refresh the existing KPI reference.");
      return { alias: row.alias, nodeId: node.id, kind: "existing", origin: row.origin };
    }
    smartAssert(!project.graph.nodes.some(node => normalized(node.name) === name || row.conceptKey && (normalized(node.id) === normalized(row.conceptKey) || node.tags?.includes(`smart-concept:${row.conceptKey}`))),
      "DUPLICATE_CONCEPT", "Reuse the existing KPI instead of duplicating it.");
    const nodeId = `${host.operationId}_${row.alias}`;
    smartAssert(!project.graph.nodes.some(node => node.id === nodeId), "DUPLICATE_ID", "Replay the owning operation instead of adding twice.");
    return { alias: row.alias, nodeId, kind: "new", origin: row.origin };
  });
  const formula = expandIncomingKpiFormula(input.draft.formula, aliases), newNodeIds = aliases.filter(row => row.kind === "new").map(row => row.nodeId);
  const values = resolveIncomingKpiValues(project, input);
  const valuePatches = new Map(values.inputs.map(row => [row.alias, incomingKpiInputValuePatch(row, input, values.referenceValue!)]));
  const hasChanges = newNodeIds.length > 0 || aliases.some(row => row.kind === "existing" && Object.keys(valuePatches.get(row.alias) ?? {}).length > 0)
    || values.referenceSource === "user" || values.referenceSource === "estimate" || !target.formula?.trim() || target.type !== (target.id === project.rootNodeId ? "root_kpi" : "calculated")
    || kpiCanonicalJson(parseFormula(target.formula)) !== kpiCanonicalJson(parseFormula(formula));
  const changeSet: VdtChangeSet = { id: host.operationId, taskType: "suggest_incoming_kpis", backendId: lineage.kind === "model" ? lineage.execution.backendId : lineage.kind === "manual" ? "manual" : "smart_library",
    createdAt: host.now, additions: [], updates: inputTypeRepairs.filter(update => update.nodeId !== target.id), edgeChanges: [], deletions: [], assumptions: [], questions: [], warnings: [] };
  for (let i = 0; i < bindings.length; i++) {
    const row = bindings[i]!, alias = aliases[i]!;
    if (alias.kind === "new") changeSet.additions.push({ id: `${host.operationId}_add_${row.alias}`, nodeId: alias.nodeId, parentNodeId: target.id,
      name: row.name, unit: row.unit, type: "input", valueStatus: "unknown", ...valuePatches.get(row.alias), relation: targetOffRoot ? "contextual_influence" : "formula_dependency",
      ...(row.description ? { description: row.description } : {}), aiRationale: "Incoming formula input.",
      tags: [...(row.conceptKey ? [`smart-concept:${row.conceptKey}`] : []), ...(input.proposal ? [`smart-proposal:${input.proposal.proposalId}`] : [])] });
    else {
      const valuePatch = valuePatches.get(row.alias);
      if (valuePatch && Object.keys(valuePatch).length) changeSet.updates.push({ id: `${host.operationId}_value_${row.alias}`, nodeId: alias.nodeId, patch: valuePatch });
      const edge = direct.find(edge => edge.targetNodeId === alias.nodeId);
      if (edge && !targetOffRoot && edge.relation === "contextual_influence") changeSet.edgeChanges.push({ id: `${host.operationId}_edge_${row.alias}`, action: "update", edgeId: edge.id, patch: { relation: "formula_dependency" } });
    }
    if (alias.kind === "new" && row.origin === "manual") changeSet.updates.push({ id: `${host.operationId}_accept_${row.alias}`, nodeId: alias.nodeId, patch: { status: "accepted" } });
  }
  changeSet.updates.push({ id: `${host.operationId}_formula`, nodeId: target.id,
    patch: { formula, type: target.id === project.rootNodeId ? "root_kpi" : "calculated", valueStatus: "calculated",
      ...incomingKpiReferenceValuePatch(values, target) } });
  if (plan) {
    const next = structuredClone(plan);
    // Activating an existing reference model activates only its mathematical
    // dependency closure. Context siblings and primary ownership remain intact.
    const activated = new Set<string>();
    if (!targetOffRoot) {
      const queue = [...existingIds];
      while (queue.length) {
        const id = queue.pop()!; if (activated.has(id)) continue; activated.add(id);
        const node = project.graph.nodes.find(node => node.id === id)!;
        if (node.formula?.trim()) queue.push(...extractFormulaReferences(node.formula));
      }
    }
    for (const entry of next.nodes) {
      if (entry.nodeId === target.id && !targetOffRoot) entry.kind = "calculated";
      if (activated.has(entry.nodeId)) {
        const node = project.graph.nodes.find(node => node.id === entry.nodeId)!;
        entry.kind = node.formula?.trim() ? "calculated" : "input";
        if (entry.kind === "calculated" && node.type !== "calculated") changeSet.updates.push({ id: `${host.operationId}_activate_${entry.nodeId}`, nodeId: node.id, patch: { type: "calculated" } });
        const edge = project.graph.edges.find(edge => edge.targetNodeId === entry.nodeId && edge.sourceNodeId === entry.parentNodeId);
        if (edge?.relation === "contextual_influence" && !changeSet.edgeChanges.some(change => change.action !== "add" && change.edgeId === edge.id))
          changeSet.edgeChanges.push({ id: `${host.operationId}_activate_edge_${entry.nodeId}`, action: "update", edgeId: edge.id, patch: { relation: "formula_dependency" } });
      }
      const users = [...activated].filter(id => id !== entry.parentNodeId && project.graph.nodes.find(node => node.id === id)?.formula
        && extractFormulaReferences(project.graph.nodes.find(node => node.id === id)!.formula!).includes(entry.nodeId));
      if (existingIds.has(entry.nodeId) && entry.parentNodeId !== target.id) users.push(target.id);
      if (users.length) entry.sharedWith = [...new Set([...(entry.sharedWith ?? []), ...users])];
    }
    for (const id of newNodeIds) next.nodes.push({ nodeId: id, parentNodeId: target.id, kind: targetOffRoot ? "context" : "input", ...(targetOffRoot ? { rationale: "Reference calculation input." } : {}) });
    changeSet.updates.push({ id: `${host.operationId}_plan`, nodeId: root.id, patch: { decompositionPlan: next } });
  }
  const preview = previewChangeSet(project, changeSet);
  preview.updatedAt = host.now;
  for (const node of preview.graph.nodes) {
    if (newNodeIds.includes(node.id)) { node.createdAt = host.now; node.updatedAt = host.now; node.aiGenerated = bindings[aliases.findIndex(alias => alias.nodeId === node.id)]!.origin === "proposed"; }
    else if (changeSet.updates.some(update => update.nodeId === node.id)) node.updatedAt = host.now;
  }
  assertSmartKpiGraph(preview);
  const validation = validateGraph(preview);
  smartAssert(validation.valid, "INVALID_GRAPH", validation.errors[0]?.message ?? "Check the graph.");
  let constructionWarnings: string[] = [];
  if (plan) {
    const hierarchy = inspectDecompositionHierarchy(preview, "incremental_user_apply");
    smartAssert(hierarchy.valid, "INVALID_HIERARCHY", hierarchy.errors[0] ?? "Check the decomposition plan."); constructionWarnings = hierarchy.constructionWarnings;
  }
  smartAssert(!values.issues.length, values.issues[0]?.code ?? "INVALID_VALUES", values.issues[0]?.message ?? "Check the KPI values.");
  smartAssert(hasChanges, "NO_CHANGES", "The formula and values are unchanged.");
  const affected = new Set([target.id, ...aliases.filter(row => row.kind === "existing" && Object.keys(valuePatches.get(row.alias) ?? {}).length).map(row => row.nodeId)]);
  for (let changed = true; changed;) { changed = false; for (const node of project.graph.nodes) if (!affected.has(node.id) && node.formula && extractFormulaReferences(node.formula).some(id => affected.has(id))) { affected.add(node.id); changed = true; } }
  const outputPreview: IncomingKpiOutputPreview[] = [];
  const compare = (before: GraphCalculationResult, after: GraphCalculationResult, scenarioId: string | null) => {
    const previous = new Set(before.errors.map(issueKey));
    smartAssert(after.errors.every(issue => previous.has(issueKey(issue)) || issue.type === "missing_value" && (affected.has(issue.nodeId ?? "") || newNodeIds.includes(issue.nodeId ?? ""))), "CALCULATION_DAMAGE", "The formula introduces an unrelated calculation error.");
    smartAssert(project.graph.nodes.filter(node => !affected.has(node.id)).every(node => Object.is(before.values[node.id], after.values[node.id])), "CALCULATION_DAMAGE", "Unrelated KPI results changed.");
    outputPreview.push({ scenarioId, parentBefore: before.values[target.id], parentAfter: after.values[target.id], rootBefore: before.rootValue, rootAfter: after.rootValue });
  };
  compare(calculateGraph(project), calculateGraph(preview), null);
  for (const scenario of project.scenarios) compare(calculateScenarioGraph(project, scenario), calculateScenarioGraph(preview, scenario), scenario.id);
  return { changeSet, selectedChangeIds: new Set([...changeSet.additions, ...changeSet.updates, ...changeSet.edgeChanges].map(row => row.id)), preview, newNodeIds, aliases, formula, lineage, bindings, outputPreview, constructionWarnings, values };
}

/** Pure local preview: virtual IDs only; no provider, admission or storage. */
export async function previewIncomingKpiBatch(project: VdtProject, input: IncomingKpiBatchInput): Promise<IncomingKpiBatchPreview> {
  try {
    const compiled = await compileIncomingKpiBatch(project, input, { operationId: "smart_preview_local", now: new Date().toISOString() });
    return { valid: true, draftRevision: input.draft.revision, issues: [], bindings: compiled.bindings, lineage: compiled.lineage,
      parentType: input.context.targetNodeId === project.rootNodeId ? "root_kpi" : "calculated", newNodeCount: compiled.newNodeIds.length,
      existingReferenceCount: compiled.aliases.length - compiled.newNodeIds.length, outputPreview: compiled.outputPreview, businessCertified: false };
  } catch (error) { return { valid: false, draftRevision: input.draft.revision, issues: [{ code: error && typeof error === "object" && "code" in error ? String(error.code) : "INVALID_DRAFT", message: error instanceof Error ? error.message : "Check the formula." }] }; }
}
