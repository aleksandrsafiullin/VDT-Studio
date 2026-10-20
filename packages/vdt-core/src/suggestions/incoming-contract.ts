import { parseFormula } from "../formula/parser";
import type { FormulaExpression } from "../formula/ast";
import type { VdtProject } from "../types";
import { kpiCanonicalJson } from "./identity";
import { smartAssert, smartList, smartRecord, smartString, validateKpiSuggestionContext, validateKpiSuggestionSet } from "./validation";
import { INCOMING_KPI_APPLY_SCHEMA, INCOMING_KPI_DRAFT_SCHEMA, INCOMING_KPI_LIMITS as limits,
  type IncomingKpiAlias, type IncomingKpiBatchDraft, type IncomingKpiBatchInput,
  type IncomingKpiDraftBinding, type IncomingKpiDraftInspection, type IncomingKpiExistingKey,
  type IncomingKpiFormulaAnalysis, type IncomingKpiFormulaAuthorship, type IncomingKpiLineage,
  type IncomingKpiManualKey, type IncomingKpiProposedAlias, type IncomingKpiResolvedAlias } from "./incoming-types";

const aliasPattern = /^(?:p_[1-6]|[me]_[0-9a-f]{32})$/;
const nodeIdPattern = /^[A-Za-z_][A-Za-z0-9_]{0,159}$/;
const hashPattern = /^sha256:[a-f0-9]{64}$/;
const rawText = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max
  && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
export function incomingKpiProposedAlias(index: number): IncomingKpiProposedAlias {
  smartAssert(Number.isSafeInteger(index) && index >= 0 && index < limits.modelRows, "INVALID_ALIAS", "Unknown proposed row.");
  return `p_${index + 1}`;
}
export const newIncomingKpiManualKey = (): IncomingKpiManualKey => `m_${crypto.randomUUID().replaceAll("-", "")}`;
export const newIncomingKpiExistingKey = (): IncomingKpiExistingKey => `e_${crypto.randomUUID().replaceAll("-", "")}`;

/** Shape validation deliberately accepts raw incomplete formula text and
 * unselected blank rows. It never mutates, normalizes or publishes the draft. */
export function validateIncomingKpiBatchDraft(value: unknown): IncomingKpiBatchDraft {
  smartRecord(value, ["schemaVersion", "targetNodeId", "contextHash", "revision", "source", "childKeys", "manualChildren", "existingFactors", "formula", "formulaAuthorship"]);
  smartAssert(value.schemaVersion === INCOMING_KPI_DRAFT_SCHEMA, "INVALID_DRAFT", "Unsupported incoming draft.");
  smartString(value.targetNodeId, 160);
  smartAssert(typeof value.contextHash === "string" && hashPattern.test(value.contextHash), "INVALID_DRAFT", "Refresh the KPI context.");
  smartAssert(Number.isSafeInteger(value.revision) && Number(value.revision) >= 0 && Number(value.revision) <= 0x7fffffff, "INVALID_DRAFT", "Invalid draft revision.");
  smartAssert(["recipe", "model", "user_edited", "user"].includes(String(value.formulaAuthorship)), "INVALID_AUTHORSHIP", "Choose a formula source.");
  smartAssert(rawText(value.formula, limits.localFormula), "FORMULA_LIMIT", "Formula limit: 1,024 characters.");
  smartRecord(value.source, ["kind", "proposalId", "groupId"], ["kind"]);
  if (value.source.kind === "manual") smartRecord(value.source, ["kind"]);
  else {
    smartRecord(value.source, ["kind", "proposalId", "groupId"]);
    smartAssert(value.source.kind === "proposal", "INVALID_DRAFT", "Unknown draft source.");
    smartString(value.source.proposalId, 120); smartString(value.source.groupId, 48);
  }
  smartList(value.childKeys, limits.modelRows);
  value.childKeys.forEach(key => smartAssert(typeof key === "string" && /^[a-z][a-z0-9_]{0,47}$/.test(key), "INVALID_DRAFT", "Unknown proposed row."));
  smartAssert(new Set(value.childKeys).size === value.childKeys.length, "DUPLICATE_ALIAS", "Select each proposed row once.");
  smartList(value.manualChildren, limits.newRows); smartList(value.existingFactors, limits.existingReferences);
  const aliases = new Set<string>();
  for (const row of value.manualChildren) {
    smartRecord(row, ["key", "selected", "name", "unit", "description"], ["key", "selected", "name", "unit"]);
    smartAssert(typeof row.key === "string" && /^m_[0-9a-f]{32}$/.test(row.key) && !aliases.has(row.key), "INVALID_ALIAS", "Invalid own-row key.");
    aliases.add(row.key);
    smartAssert(typeof row.selected === "boolean" && rawText(row.name, limits.name) && rawText(row.unit, limits.unit)
      && (row.description === undefined || rawText(row.description, limits.description)), "INVALID_ROW", "Check the KPI name and unit.");
    if (row.selected) { smartString(row.name, limits.name); smartString(row.unit, limits.unit); }
  }
  const nodeIds = new Set<string>();
  for (const row of value.existingFactors) {
    smartRecord(row, ["key", "nodeId", "selected"]);
    smartAssert(typeof row.key === "string" && /^e_[0-9a-f]{32}$/.test(row.key) && !aliases.has(row.key), "INVALID_ALIAS", "Invalid existing-row key.");
    aliases.add(row.key); smartString(row.nodeId, 160);
    smartAssert(typeof row.selected === "boolean" && !nodeIds.has(row.nodeId), "DUPLICATE_REFERENCE", "Choose each existing KPI once."); nodeIds.add(row.nodeId);
  }
  return value as unknown as IncomingKpiBatchDraft;
}

/** FM-01 syntax/literal/size contract. Full effective-reference, dimensional,
 * graph and plan validation is the separate FM-02 compiler gate. */
export function parseIncomingKpiFormula(raw: string, authorship: IncomingKpiFormulaAuthorship): IncomingKpiFormulaAnalysis {
  smartAssert(["recipe", "model", "user_edited", "user"].includes(authorship), "INVALID_AUTHORSHIP", "Choose a formula source.");
  smartAssert(rawText(raw, limits.localFormula) && raw.trim(), "INVALID_FORMULA", "Enter a valid formula.");
  let ast: FormulaExpression;
  try { ast = parseFormula(raw); } catch { throw Object.assign(new Error("Check the formula syntax."), { code: "INVALID_FORMULA" }); }
  let nodes = 0, depth = 0;
  const references = new Set<IncomingKpiAlias>();
  const model = authorship === "model" || authorship === "recipe";
  const occurrences = new Map<string, number>();
  const visit = (node: FormulaExpression, level: number): number | undefined => {
    nodes++; depth = Math.max(depth, level);
    smartAssert(nodes <= limits.astNodes && level <= limits.astDepth, "FORMULA_COMPLEXITY", "Simplify the formula.");
    if (node.type === "reference") {
      smartAssert(aliasPattern.test(node.name), "UNKNOWN_REFERENCE", "Use a KPI reference chip.");
      references.add(node.name as IncomingKpiAlias); occurrences.set(node.name, (occurrences.get(node.name) ?? 0) + 1); return;
    }
    if (node.type === "number") {
      smartAssert(!model || node.raw === "1", "MODEL_COEFFICIENT", "Enter weights as measured KPI inputs."); return node.value;
    }
    let constant: number | undefined;
    if (node.type === "unary") { const value = visit(node.expression, level + 1); constant = value === undefined ? undefined : -value; }
    else if (node.type === "call") {
      smartAssert(node.args.length <= limits.functionArguments, "FORMULA_COMPLEXITY", "Use at most 16 function arguments.");
      const values = node.args.map(child => visit(child, level + 1));
      if (values.every(v => v !== undefined)) constant = (node.name === "min" ? Math.min : Math.max)(...(values as number[]));
    } else {
      const left = visit(node.left, level + 1), right = visit(node.right, level + 1);
      if (left !== undefined && right !== undefined) constant = node.operator === "+" ? left + right : node.operator === "-" ? left - right : node.operator === "*" ? left * right : left / right;
    }
    smartAssert(!model || constant === undefined || constant === 1, "MODEL_COEFFICIENT", "Enter weights as measured KPI inputs.");
    return constant;
  };
  visit(ast, 1);
  smartAssert(references.size > 0, "CONSTANT_FORMULA", "Include at least one KPI.");
  smartAssert(!model || [...occurrences.values()].every(count => count === 1), "MODEL_COEFFICIENT", "Use each model factor once.");
  return { ast, references: [...references], nodes, depth };
}

function mapAst(node: FormulaExpression, map: (name: string) => string): FormulaExpression {
  if (node.type === "reference") return { ...node, name: map(node.name) };
  if (node.type === "number") return { ...node };
  if (node.type === "unary") return { ...node, expression: mapAst(node.expression, map) };
  if (node.type === "call") return { ...node, args: node.args.map(child => mapAst(child, map)) };
  return { ...node, left: mapAst(node.left, map), right: mapAst(node.right, map) };
}
function printAst(node: FormulaExpression): string {
  if (node.type === "reference") return node.name;
  if (node.type === "number") return node.raw;
  if (node.type === "unary") return `(-${printAst(node.expression)})`;
  if (node.type === "call") return `${node.name}(${node.args.map(printAst).join(", ")})`;
  return `(${printAst(node.left)} ${node.operator} ${printAst(node.right)})`;
}
/** Exact identifier substitution shared by bounded incoming paths. */
export function remapIncomingKpiFormula(formula: string, references: ReadonlyMap<string, string>): string {
  return printAst(mapAst(parseFormula(formula), name => { const mapped = references.get(name); smartAssert(mapped, "UNKNOWN_REFERENCE", "Choose a known KPI reference."); return mapped; }));
}
/** Local-only initial expression. Source keys are mapped by AST, never renamed
 * from labels; a historical context-only proposal supplies no invented formula. */
export function incomingKpiProposalFormula(proposal: import("./types").KpiSuggestionSet, groupId: string): string | undefined {
  const group = validateKpiSuggestionSet(proposal).groups.find(group => group.id === groupId);
  smartAssert(group, "INVALID_SELECTION", "Choose one proposal alternative.");
  if (!group.formula) return undefined;
  return printAst(mapAst(parseFormula(group.formula), key => {
    const index = group.children.findIndex(child => child.key === key);
    smartAssert(index >= 0, "UNKNOWN_REFERENCE", "Unknown source factor."); return incomingKpiProposedAlias(index);
  }));
}
/** At accepted Add, the host supplies its one immutable ID allocation. The
 * function walks the AST; p_1 never accidentally replaces part of p_10/labels. */
export function expandIncomingKpiFormula(raw: string, aliases: readonly IncomingKpiResolvedAlias[]): string {
  const analysis = parseIncomingKpiFormula(raw, "user"), map = new Map<string, string>(), nodeIds = new Set<string>();
  smartAssert(aliases.length <= limits.newRows + limits.existingReferences, "REFERENCE_LIMIT", "Too many formula references.");
  for (const row of aliases) {
    smartRecord(row, ["alias", "nodeId", "kind", "origin"]);
    smartAssert(["new", "existing"].includes(row.kind) && ["proposed", "manual", "existing"].includes(row.origin)
      && !(row.kind === "new" && row.origin === "existing") && !(row.kind === "existing" && row.origin === "manual"), "INVALID_ALIAS_MAP", "Refresh the KPI reference map.");
    smartAssert(aliasPattern.test(row.alias) && !map.has(row.alias) && nodeIdPattern.test(row.nodeId) && !nodeIds.has(row.nodeId), "INVALID_ALIAS_MAP", "Refresh the KPI reference map.");
    map.set(row.alias, row.nodeId); nodeIds.add(row.nodeId);
  }
  smartAssert(analysis.references.length === map.size && analysis.references.every(alias => map.has(alias)), "REFERENCE_MISMATCH", "Check the selected formula references.");
  const result = printAst(mapAst(analysis.ast, alias => map.get(alias)!));
  smartAssert(result.length <= limits.expandedFormula, "EXPANDED_FORMULA_LIMIT", "Expanded formula limit: 4,096 characters.");
  return result;
}

export function inspectIncomingKpiDraft(input: IncomingKpiBatchInput, project?: VdtProject): IncomingKpiDraftInspection {
  try {
    smartRecord(input, ["schemaVersion", "context", "proposal", "draft"], ["schemaVersion", "context", "draft"]);
    smartAssert(input.schemaVersion === INCOMING_KPI_APPLY_SCHEMA, "INVALID_DRAFT", "Unsupported incoming request.");
    const context = validateKpiSuggestionContext(input.context), draft = validateIncomingKpiBatchDraft(input.draft);
    smartAssert(draft.contextHash === context.contextHash && draft.targetNodeId === context.targetNodeId && (!project || project.id === context.projectId), "STALE_DRAFT", "Refresh the KPI context.");
    const bindings: IncomingKpiDraftBinding[] = [];
    let lineage: IncomingKpiLineage;
    if (draft.source.kind === "manual") {
      smartAssert(!input.proposal && !draft.childKeys.length && draft.formulaAuthorship === "user", "INVALID_AUTHORSHIP", "Keep the original proposal source.");
      lineage = { kind: "manual", formulaAuthorship: "user", requiresExecution: false };
    } else {
      const proposal = validateKpiSuggestionSet(input.proposal);
      smartAssert(proposal.proposalId === draft.source.proposalId && proposal.contextHash === context.contextHash && proposal.targetNodeId === context.targetNodeId,
        "STALE_DRAFT", "Refresh the proposal source.");
      const groupId = draft.source.groupId;
      const group = proposal.groups.find(g => g.id === groupId);
      smartAssert(group, "INVALID_SELECTION", "Choose one proposal alternative.");
      smartAssert(draft.formulaAuthorship !== "user" && (draft.formulaAuthorship !== "recipe" || group.recipeBinding), "INVALID_AUTHORSHIP", "Keep the original formula source.");
      if (proposal.origin.kind === "recipe") {
        smartAssert(draft.formulaAuthorship === "recipe" || draft.formulaAuthorship === "user_edited", "INVALID_AUTHORSHIP", "Keep the recipe source.");
        lineage = { kind: "recipe", proposalId: proposal.proposalId, groupId: group.id, sourceRef: proposal.origin.sourceRef,
          formulaAuthorship: draft.formulaAuthorship, requiresExecution: false };
      } else lineage = { kind: "model", proposalId: proposal.proposalId, groupId: group.id, requestId: proposal.origin.requestId,
        execution: { ...proposal.origin.execution }, formulaAuthorship: draft.formulaAuthorship, requiresExecution: true };
      for (const key of draft.childKeys) {
        const index = group.children.findIndex(child => child.key === key), child = group.children[index];
        smartAssert(child, "INVALID_SELECTION", "Choose a known proposal row.");
        if (child.existingNodeId) smartAssert([context.root, context.target, ...context.children, ...context.ancestors, ...context.siblings].some(n => n.id === child.existingNodeId), "UNOBSERVED_REFERENCE", "Choose an observed existing KPI.");
        bindings.push({ alias: incomingKpiProposedAlias(index), origin: "proposed", name: child.name, unit: child.unit,
          proposalChildKey: child.key, conceptKey: child.conceptKey, ...(child.description ? { description: child.description } : {}), ...(child.existingNodeId ? { existingNodeId: child.existingNodeId } : {}) });
      }
      if (draft.formulaAuthorship !== "user_edited") {
        smartAssert(group.formula && draft.childKeys.length === group.children.length && !draft.manualChildren.some(r => r.selected) && !draft.existingFactors.some(r => r.selected),
          "FORMULA_EDIT_REQUIRED", "Edit the formula for this selection.");
        const canonical = mapAst(parseFormula(group.formula), key => { const index = group.children.findIndex(child => child.key === key); smartAssert(index >= 0, "UNKNOWN_REFERENCE", "Unknown source factor."); return incomingKpiProposedAlias(index); });
        smartAssert(kpiCanonicalJson(parseFormula(draft.formula)) === kpiCanonicalJson(canonical), "FORMULA_EDIT_REQUIRED", "Mark the formula as edited.");
      }
    }
    for (const row of draft.manualChildren.filter(row => row.selected)) bindings.push({ alias: row.key, origin: "manual", name: row.name.trim(), unit: row.unit.trim(), ...(row.description?.trim() ? { description: row.description.trim() } : {}) });
    const observed = new Map((project?.graph.nodes ?? [context.root, context.target, ...context.children, ...context.ancestors, ...context.siblings]).map(n => [n.id, n]));
    for (const row of draft.existingFactors.filter(row => row.selected)) {
      const node = observed.get(row.nodeId);
      smartAssert(node && node.status !== "rejected" && node.unit, "INVALID_REFERENCE", "Choose an existing KPI with a unit.");
      bindings.push({ alias: row.key, origin: "existing", name: node.name, unit: node.unit, existingNodeId: node.id });
    }
    const newNodeCount = bindings.filter(row => !row.existingNodeId).length, existingReferenceCount = bindings.length - newNodeCount;
    smartAssert(newNodeCount <= limits.newRows && existingReferenceCount <= limits.existingReferences, "ROW_LIMIT", "Limit: 6 new KPIs and 16 existing references.");
    const existingIds = bindings.filter(row => row.existingNodeId).map(row => row.existingNodeId);
    smartAssert(new Set(existingIds).size === existingIds.length, "DUPLICATE_REFERENCE", "Use each existing KPI once.");
    const analysis = parseIncomingKpiFormula(draft.formula, draft.formulaAuthorship), selected = new Set(bindings.map(row => row.alias));
    for (const alias of analysis.references) smartAssert(selected.has(alias), "UNSELECTED_REFERENCE", "Select the referenced KPI or remove its reference.");
    for (const row of bindings) smartAssert(analysis.references.includes(row.alias), "UNUSED_FACTOR", `Include ${row.name} in the formula.`.slice(0, 200));
    return { readyForCompile: true, issues: [], analysis, bindings, lineage, newNodeCount, existingReferenceCount };
  } catch (error) {
    return { readyForCompile: false, issues: [{ code: error && typeof error === "object" && "code" in error ? String(error.code) : "INVALID_DRAFT",
      message: error instanceof Error ? error.message : "Check the incoming KPI draft." }] };
  }
}
