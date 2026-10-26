import { parseFormula } from "../formula/parser";
import { validAiPersonalisation } from "../personalisation";
import { extractReferencesFromAst } from "../formula/evaluator";
import type { FormulaExpression } from "../formula/ast";
import { KPI_SUGGESTION_LIMITS, KPI_SUGGESTION_SCHEMA, KPI_SUGGESTION_VALIDATOR } from "./types";
import type { KpiSuggestionContext, KpiSuggestionGroup, KpiSuggestionSelection, KpiSuggestionSet } from "./types";

export class KpiSuggestionError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "KpiSuggestionError"; }
}
export function smartAssert(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new KpiSuggestionError(code, message);
}
export function smartRecord(v: unknown, keys: readonly string[], required = keys): asserts v is Record<string, unknown> {
  smartAssert(v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype,
    "INVALID_PROPOSAL", "Smart data must contain plain objects.");
  smartAssert(Object.keys(v).every(k => keys.includes(k)) && required.every(k => Object.hasOwn(v, k)),
    "INVALID_PROPOSAL", "Unknown or missing Smart fields.");
}
export function smartString(v: unknown, max = 300): asserts v is string {
  smartAssert(typeof v === "string" && v.trim().length > 0 && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v),
    "INVALID_PROPOSAL", "A bounded nonempty Smart string is required.");
}
export function smartList(v: unknown, max: number): asserts v is unknown[] {
  smartAssert(Array.isArray(v) && v.length <= max && Object.keys(v).length === v.length, "INVALID_PROPOSAL", "Invalid Smart array.");
}
function stringList(v: unknown, max: number, itemMax = 300): asserts v is string[] {
  smartList(v, max); v.forEach(s => smartString(s, itemMax));
}
function hash(v: unknown): asserts v is string { smartAssert(typeof v === "string" && /^sha256:[a-f0-9]{64}$/.test(v), "INVALID_PROPOSAL", "Invalid Smart content identity."); }
function key(v: unknown): asserts v is string { smartAssert(typeof v === "string" && /^[a-z][a-z0-9_]{0,47}$/.test(v), "INVALID_PROPOSAL", "Invalid Smart local key."); }
function date(v: unknown): number {
  smartString(v, 30); const n = Date.parse(v);
  smartAssert(Number.isFinite(n) && new Date(n).toISOString() === v, "INVALID_PROPOSAL", "A canonical timestamp is required.");
  return n;
}

export function validateKpiSuggestionContext(value: unknown): KpiSuggestionContext {
  smartRecord(value, ["personalisation", "schemaVersion", "workspaceId", "projectId", "vdtId", "targetNodeId", "graphFingerprint", "contextHash", "period", "business", "root", "target", "children", "ancestors", "siblings", "decompositionPlan", "planScope", "parentRelationships", "omissions"],
    ["schemaVersion", "workspaceId", "projectId", "vdtId", "targetNodeId", "graphFingerprint", "contextHash", "period", "business", "root", "target", "children", "ancestors", "siblings", "parentRelationships", "omissions"]);
  smartAssert(value.schemaVersion === "kpi_suggestion_context.v1", "INVALID_CONTEXT", "Unknown Smart context schema.");
  if (value.personalisation !== undefined) smartAssert(validAiPersonalisation(value.personalisation), "INVALID_CONTEXT", "Invalid personalisation instructions.");
  for (const field of ["workspaceId", "projectId", "targetNodeId"]) smartString(value[field], 160);
  if (value.vdtId !== null) smartString(value.vdtId, 160);
  hash(value.graphFingerprint); hash(value.contextHash);
  smartRecord(value.period, ["key", "grain"]); smartString(value.period.key, 120);
  smartAssert(["shift", "day", "week", "month", "quarter", "year", "custom"].includes(String(value.period.grain)), "INVALID_CONTEXT", "Unknown Smart period.");
  smartRecord(value.business, ["name", "description", "industry", "context", "goal"], ["name"]); smartString(value.business.name, 160);
  for (const field of ["description", "industry", "context", "goal"]) if (value.business[field] !== undefined) smartString(value.business[field], field === "context" ? KPI_SUGGESTION_LIMITS.businessContextChars : field === "goal" ? 500 : field === "description" ? 300 : 160);
  const node = (n: unknown) => {
    smartRecord(n, ["id", "name", "description", "assumptions", "type", "status", "unit", "formula", "valueKnown", "valueStatus", "provenance", "mappingIdentity"],
      ["id", "name", "type", "status", "valueKnown", "valueStatus", "provenance"]);
    smartString(n.id, 160); smartString(n.name, 160);
    if (n.unit !== undefined) smartString(n.unit, 80);
    if (n.formula !== undefined) smartString(n.formula, 500);
    if (n.description !== undefined) smartString(n.description, 240);
    if (n.assumptions !== undefined) stringList(n.assumptions, 3, 160);
    smartAssert(["root_kpi", "calculated", "input", "assumption", "external_factor", "data_mapped"].includes(String(n.type))
      && ["ai_suggested", "accepted", "edited", "rejected", "needs_data", "formula_issue", "unit_issue", "assumption", "external_factor"].includes(String(n.status))
      && [null, "unknown", "user_provided_value", "default_assumption", "calculated", "partially_calculable"].includes(n.valueStatus as string | null)
      && typeof n.valueKnown === "boolean" && ["mapped", "sourced", "unsourced"].includes(String(n.provenance)), "INVALID_CONTEXT", "Invalid Smart node summary.");
    if (n.mappingIdentity !== undefined) hash(n.mappingIdentity);
    return n;
  };
  const root = node(value.root), target = node(value.target);
  smartAssert(target.id === value.targetNodeId, "INVALID_CONTEXT", "Smart target identity differs from its summary.");
  let count = 2;
  for (const field of ["children", "ancestors", "siblings"]) {
    const list = value[field]; smartList(list, 12); count += list.length;
    const ids = list.map(n => node(n).id); smartAssert(new Set(ids).size === ids.length, "INVALID_CONTEXT", "Duplicate context node summary.");
  }
  smartAssert(count <= KPI_SUGGESTION_LIMITS.contextNodes, "INVALID_CONTEXT", "Smart context node bound exceeded.");
  smartRecord(value.omissions, ["directChildren", "ancestors", "siblings", "planNodes", "relationships", "text", "cyclic"]);
  for (const field of ["directChildren", "ancestors", "siblings", "planNodes", "relationships"]) smartAssert(Number.isSafeInteger(value.omissions[field]) && Number(value.omissions[field]) >= 0, "INVALID_CONTEXT", "Context omission counts must be explicit.");
  smartAssert(typeof value.omissions.text === "boolean" && typeof value.omissions.cyclic === "boolean", "INVALID_CONTEXT", "Context omission flags must be explicit.");
  smartList(value.parentRelationships, 96);
  for (const edge of value.parentRelationships) {
    smartRecord(edge, ["parentNodeId", "childNodeId", "relation"]); smartString(edge.parentNodeId, 160); smartString(edge.childNodeId, 160);
    smartAssert(["positive_driver", "negative_driver", "multiplicative_driver", "divisive_driver", "additive_component", "subtractive_component", "contextual_influence", "formula_dependency"].includes(String(edge.relation)), "INVALID_CONTEXT", "Invalid context relationship.");
  }
  if (value.planScope !== undefined) {
    smartRecord(value.planScope, ["selection", "totalNodes", "excludedUnrelatedNodes"]);
    smartAssert(value.planScope.selection === "target_and_direct_children" && Number.isSafeInteger(value.planScope.totalNodes)
      && Number(value.planScope.totalNodes) >= 0 && Number.isSafeInteger(value.planScope.excludedUnrelatedNodes)
      && Number(value.planScope.excludedUnrelatedNodes) >= 0 && Number(value.planScope.excludedUnrelatedNodes) <= Number(value.planScope.totalNodes),
      "INVALID_CONTEXT", "Invalid bounded plan scope.");
  }
  if (value.decompositionPlan !== undefined) {
    smartRecord(value.decompositionPlan, ["version", "goal", "nodes"]);
    smartAssert(value.decompositionPlan.version === 1, "INVALID_CONTEXT", "Unknown plan version."); smartString(value.decompositionPlan.goal, 500);
    smartList(value.decompositionPlan.nodes, 12);
    for (const entry of value.decompositionPlan.nodes) {
      smartRecord(entry, ["nodeId", "parentNodeId", "kind", "rationale", "sharedWith"], ["nodeId", "parentNodeId", "kind"]);
      smartString(entry.nodeId, 160); smartString(entry.parentNodeId, 160);
      smartAssert(["calculated", "input", "context"].includes(String(entry.kind)), "INVALID_CONTEXT", "Invalid plan kind.");
      if (entry.rationale !== undefined) smartString(entry.rationale, 300);
      if (entry.sharedWith !== undefined) stringList(entry.sharedWith, 20, 160);
    }
  }
  smartAssert(new TextEncoder().encode(JSON.stringify(value)).byteLength <= KPI_SUGGESTION_LIMITS.inputBytes, "OVERSIZE_CONTEXT", "Smart context exceeds its input bound.");
  void root;
  return value as unknown as KpiSuggestionContext;
}

/** Preview formulas may contain references/operators and the dimensionless 1
 * used in (1-discount). No model-authored constants can invent input values. */
function checkExpression(ast: FormulaExpression): void {
  if (ast.type === "number") smartAssert(ast.value === 1 && ast.raw === "1", "UNSAFE_FORMULA", "Smart formulas cannot introduce numeric assumptions.");
  else if (ast.type === "binary") {
    checkExpression(ast.left); checkExpression(ast.right);
    const left = constantExpression(ast.left), right = constantExpression(ast.right);
    smartAssert(!(ast.operator === "*" && (left === 0 || right === 0)) && !(ast.operator === "/" && right === 0),
      "UNSAFE_FORMULA", "Smart formulas cannot mask factors with a constant zero or divide by zero.");
  }
  else if (ast.type === "unary") checkExpression(ast.expression);
  else if (ast.type === "call") ast.args.forEach(checkExpression);
}
function constantExpression(ast: FormulaExpression): number | undefined {
  if (ast.type === "number") return ast.value;
  if (ast.type === "reference") return undefined;
  if (ast.type === "unary") { const value = constantExpression(ast.expression); return value === undefined ? undefined : -value; }
  if (ast.type === "call") {
    const values = ast.args.map(constantExpression);
    return values.every(v => v !== undefined) ? (ast.name === "min" ? Math.min : Math.max)(...(values as number[])) : undefined;
  }
  const a = constantExpression(ast.left), b = constantExpression(ast.right);
  return a === undefined || b === undefined ? undefined : ast.operator === "+" ? a + b : ast.operator === "-" ? a - b : ast.operator === "*" ? a * b : a / b;
}

export function validateKpiSuggestionSet(value: unknown, now?: number): KpiSuggestionSet {
  smartRecord(value, ["schemaVersion", "validatorVersion", "catalogVersion", "proposalId", "targetNodeId", "contextHash", "createdAt", "expiresAt", "origin", "rationale", "limitations", "groups"]);
  smartAssert(value.schemaVersion === KPI_SUGGESTION_SCHEMA && value.validatorVersion === KPI_SUGGESTION_VALIDATOR, "INVALID_PROPOSAL", "Unsupported Smart schema/validator.");
  smartString(value.catalogVersion, 100); smartString(value.proposalId, 120); smartString(value.targetNodeId, 160); hash(value.contextHash);
  const created = date(value.createdAt), expires = date(value.expiresAt);
  smartAssert(expires > created && expires - created <= KPI_SUGGESTION_LIMITS.ttlMs, "INVALID_PROPOSAL", "Invalid Smart proposal lifetime.");
  if (now !== undefined) smartAssert(created <= now + 60_000 && expires > now, "EXPIRED_PROPOSAL", "Smart suggestions have expired.");
  smartString(value.rationale); stringList(value.limitations, 6);
  const origin = value.origin;
  smartAssert(origin !== null && typeof origin === "object" && !Array.isArray(origin), "INVALID_PROPOSAL", "Missing Smart provenance.");
  if ((origin as Record<string, unknown>).kind === "recipe") {
    smartRecord(origin, ["kind", "sourceRef"]); smartString(origin.sourceRef, 120);
  } else {
    smartRecord(origin, ["kind", "requestId", "execution"]);
    smartAssert(origin.kind === "model", "INVALID_PROPOSAL", "Unsupported Smart origin."); smartString(origin.requestId, 120);
    smartRecord(origin.execution, ["mode", "backendId", "modelId", "bindingVersion", "credentialEpoch"]);
    smartAssert(["api", "cli", "local_model"].includes(String(origin.execution.mode)), "INVALID_PROPOSAL", "Invalid Smart execution mode.");
    for (const field of ["backendId", "modelId", "bindingVersion", "credentialEpoch"]) smartString(origin.execution[field], 160);
  }
  smartList(value.groups, KPI_SUGGESTION_LIMITS.groups);
  smartAssert(value.groups.length > 0, "INVALID_PROPOSAL", "A ready Smart proposal needs at least one group.");
  const groupIds = new Set<string>();
  for (const group of value.groups) {
    smartRecord(group, ["id", "title", "selectionMode", "children", "requiredKeys", "formula", "recipeBinding", "limitations"], ["id", "title", "selectionMode", "children", "requiredKeys", "limitations"]);
    key(group.id); smartString(group.title, 160); stringList(group.limitations, 6);
    smartAssert(!groupIds.has(group.id), "INVALID_PROPOSAL", "Duplicate Smart alternative."); groupIds.add(group.id);
    smartAssert(group.selectionMode === "all" || group.selectionMode === "independent", "INVALID_PROPOSAL", "Invalid Smart selection mode.");
    smartList(group.children, KPI_SUGGESTION_LIMITS.children);
    smartAssert(group.children.length > 0, "INVALID_PROPOSAL", "A Smart group needs children.");
    const keys = new Set<string>(), concepts = new Set<string>();
    for (const child of group.children) {
      smartRecord(child, ["key", "conceptKey", "name", "unit", "description", "existingNodeId"], ["key", "conceptKey", "name", "unit"]);
      key(child.key); key(child.conceptKey); smartString(child.name, 160); smartString(child.unit, 80);
      if (child.description !== undefined) smartString(child.description, 240);
      if (child.existingNodeId !== undefined) smartString(child.existingNodeId, 160);
      smartAssert(!keys.has(child.key) && !concepts.has(child.conceptKey), "DUPLICATE_CONCEPT", "Duplicate Smart keys/concepts.");
      keys.add(child.key); concepts.add(child.conceptKey);
    }
    stringList(group.requiredKeys, KPI_SUGGESTION_LIMITS.children, 48);
    const required = new Set(group.requiredKeys as string[]);
    smartAssert(required.size === group.requiredKeys.length && [...required].every(k => keys.has(k)), "INVALID_PROPOSAL", "Invalid required Smart factors.");
    smartAssert(group.selectionMode === "all" ? required.size === keys.size : required.size === 0 && group.formula === undefined && group.recipeBinding === undefined,
      "INCOHERENT_GROUP", "Required factors stay together; independent choices are contextual only.");
    if (group.formula !== undefined) {
      smartString(group.formula, 500);
      let ast: FormulaExpression;
      try { ast = parseFormula(group.formula); } catch { throw new KpiSuggestionError("UNSAFE_FORMULA", "Invalid Smart formula."); }
      checkExpression(ast);
      const refs = new Set(extractReferencesFromAst(ast));
      smartAssert(refs.size === keys.size && [...refs].every(k => keys.has(k)), "INCOHERENT_GROUP", "Formula must use exactly the complete one-layer factor group.");
    }
    if (group.recipeBinding !== undefined) {
      smartRecord(group.recipeBinding, ["id", "recipeId", "recipeHash", "skillHash", "targetRole", "contextHash", "basis", "sourceRef", "rationale"]);
      const binding = group.recipeBinding;
      for (const field of ["id", "recipeId", "targetRole", "sourceRef"]) smartString(binding[field], 120);
      hash(binding.recipeHash); hash(binding.skillHash); hash(binding.contextHash); smartString(binding.rationale);
      smartAssert(["selected_skill", "accepted_smart", "model_selection"].includes(String(binding.basis)), "INVALID_PROPOSAL", "Smart applicability must have an explicit semantic decision.");
      smartAssert(binding.contextHash === value.contextHash, "STALE_PROPOSAL", "Recipe decision belongs to a different context.");
      smartAssert(group.formula !== undefined && group.selectionMode === "all", "INCOHERENT_GROUP", "Executable recipes require complete factors.");
    }
  }
  smartAssert(new TextEncoder().encode(JSON.stringify(value)).byteLength <= KPI_SUGGESTION_LIMITS.outputBytes, "OVERSIZE_PROPOSAL", "Smart proposal exceeds its output bound.");
  return value as unknown as KpiSuggestionSet;
}

export function resolveKpiSuggestionSelection(proposal: KpiSuggestionSet, selection: KpiSuggestionSelection): KpiSuggestionGroup {
  smartRecord(selection, ["groupId", "childKeys", "mode"]); smartString(selection.groupId, 48); stringList(selection.childKeys, 6, 48);
  smartAssert(selection.mode === "contextual" || selection.mode === "formula", "INVALID_SELECTION", "Invalid Smart application mode.");
  const group = proposal.groups.find(g => g.id === selection.groupId);
  smartAssert(group, "INVALID_SELECTION", "Select one Smart alternative.");
  const selected = new Set(selection.childKeys);
  smartAssert(selected.size > 0 && selected.size === selection.childKeys.length && [...selected].every(k => group.children.some(c => c.key === k)), "INVALID_SELECTION", "Select known children from only one alternative.");
  smartAssert(group.selectionMode !== "all" || (group.requiredKeys.every(k => selected.has(k)) && selected.size === group.children.length),
    "INCOMPLETE_FACTORS", "Add the complete factor group together.");
  smartAssert(selection.mode !== "formula" || group.selectionMode === "all" && group.formula && group.recipeBinding,
    "CONTEXT_ONLY", "This proposal is contextual; its formula is not independently verified.");
  return group;
}

/** Current preparation policy, separate from historical proposal/journal shape.
 * Rebuildable suggestions must split the target; old committing receipts keep
 * their original validation and exact replay semantics. */
export function validateKpiSuggestionDecomposition(proposal: KpiSuggestionSet, context?: KpiSuggestionContext): KpiSuggestionSet {
  for (const group of proposal.groups) smartAssert(group.children.length >= 2, "NOT_A_DECOMPOSITION",
    "A decomposition needs at least two distinct component KPIs. A renamed copy is not a decomposition.");
  if (context) {
    const direct = new Set(context.children.filter(node => node.status !== "rejected").map(node => node.id));
    const normalize = (name: string) => name.normalize("NFKC").trim().toLocaleLowerCase("en").replace(/[\p{P}\p{Z}\s_]+/gu, " ");
    const contextOnly = [context.root, context.target, ...context.ancestors, ...context.siblings].filter(node => !direct.has(node.id));
    for (const group of proposal.groups) for (const child of group.children) {
      smartAssert(!child.existingNodeId || direct.has(child.existingNodeId), "UNSAFE_DECOMPOSITION",
        "Suggested components cannot reuse a sibling, ancestor or unrelated KPI. Decompose the target into its own lower-level inputs; refresh suggestions.");
      smartAssert(child.existingNodeId || !contextOnly.some(node => normalize(node.name) === normalize(child.name)), "UNSAFE_DECOMPOSITION",
        "A copy of the target, a sibling or an ancestor is not a lower-level component. Refresh suggestions.");
    }
  }
  return proposal;
}
