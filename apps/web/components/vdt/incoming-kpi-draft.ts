import {
  INCOMING_KPI_APPLY_SCHEMA, INCOMING_KPI_DRAFT_SCHEMA, extractFormulaReferences,
  incomingKpiProposalFormula, incomingKpiProposedAlias, newIncomingKpiExistingKey,
  parseFormula, type FormulaExpression, type IncomingKpiBatchDraft,
  type IncomingKpiBatchInput, type KpiSuggestionContext, type KpiSuggestionSet, type VdtProject
} from "@vdt-studio/vdt-core";

export interface IncomingKpiDraftReference {
  alias: string;
  name: string;
  unit: string;
  selected: boolean;
}

function printDraftFormula(node: FormulaExpression, aliases: ReadonlyMap<string, string>): string {
  if (node.type === "reference") return aliases.get(node.name) ?? node.name;
  if (node.type === "number") return node.raw;
  if (node.type === "unary") return `(-${printDraftFormula(node.expression, aliases)})`;
  if (node.type === "call") return `${node.name}(${node.args.map(arg => printDraftFormula(arg, aliases)).join(", ")})`;
  return `(${printDraftFormula(node.left, aliases)} ${node.operator} ${printDraftFormula(node.right, aliases)})`;
}

/** Presentation draft only. Existing references are translated by AST, while
 * accepted operation ID allocation and all graph writes remain host-owned. */
export function createIncomingKpiDraft(
  context: KpiSuggestionContext,
  project: VdtProject,
  proposal?: KpiSuggestionSet,
  groupId = proposal?.groups[0]?.id
): IncomingKpiBatchInput {
  const group = proposal?.groups.find(candidate => candidate.id === groupId);
  const reused = new Set(group?.children.flatMap(child => child.existingNodeId ? [child.existingNodeId] : []));
  const target = project.graph.nodes.find(node => node.id === context.targetNodeId);
  if (!target || project.id !== context.projectId) throw new Error("Refresh the KPI context.");
  // Context is deliberately excerpted for provider input. Local editing uses
  // the actual formula so a context text limit cannot omit existing factors.
  const sourceFormula = target.formula ?? "";
  let references: string[] = [];
  try { references = sourceFormula ? extractFormulaReferences(sourceFormula) : []; } catch { /* Retain invalid source text for explicit repair. */ }
  const existingFactors = references.filter(id => !reused.has(id)).map(nodeId => ({ key: newIncomingKpiExistingKey(), nodeId, selected: true }));
  let formula = sourceFormula;
  if (proposal && group) formula = incomingKpiProposalFormula(proposal, group.id) ?? "";
  else if (formula) {
    try { formula = printDraftFormula(parseFormula(formula), new Map(existingFactors.map(row => [row.nodeId, row.key]))); } catch { /* No implicit repair of the existing formula. */ }
  }
  const draft: IncomingKpiBatchDraft = {
    schemaVersion: INCOMING_KPI_DRAFT_SCHEMA,
    targetNodeId: context.targetNodeId,
    contextHash: context.contextHash,
    revision: 0,
    source: proposal && group ? { kind: "proposal", proposalId: proposal.proposalId, groupId: group.id } : { kind: "manual" },
    childKeys: group?.children.map(child => child.key) ?? [],
    manualChildren: [], existingFactors, formula,
    formulaAuthorship: proposal ? existingFactors.length || !group?.formula ? "user_edited" : group.recipeBinding ? "recipe" : "model" : "user",
    ...(proposal ? { estimateMissingValues: true } : {})
  };
  return { schemaVersion: INCOMING_KPI_APPLY_SCHEMA, context, ...(proposal ? { proposal } : {}), draft };
}

export function editIncomingKpiDraft(input: IncomingKpiBatchInput, patch: Partial<IncomingKpiBatchDraft>): IncomingKpiBatchInput {
  const valuesOnly = Object.keys(patch).every(key => ["inputValues", "referenceValue", "estimateMissingValues", "estimatedAliases", "referenceValueEstimated"].includes(key));
  return { ...input, draft: { ...input.draft, ...patch, revision: input.draft.revision + 1,
    formulaAuthorship: valuesOnly ? input.draft.formulaAuthorship : input.draft.source.kind === "manual" ? "user" : "user_edited" } };
}

export function incomingKpiDraftReferences(input: IncomingKpiBatchInput, project: VdtProject): IncomingKpiDraftReference[] {
  const source = input.draft.source;
  const group = source.kind === "proposal" ? input.proposal?.groups.find(candidate => candidate.id === source.groupId) : undefined;
  return [
    ...(group?.children.map((child, index) => ({ alias: incomingKpiProposedAlias(index), name: child.name, unit: child.unit,
      selected: input.draft.childKeys.includes(child.key) })) ?? []),
    ...input.draft.manualChildren.map(row => ({ alias: row.key, name: row.name || "Own KPI", unit: row.unit, selected: row.selected })),
    ...input.draft.existingFactors.map(row => {
      const node = project.graph.nodes.find(node => node.id === row.nodeId);
      return { alias: row.key, name: node?.name ?? "Missing KPI", unit: node?.unit ?? "", selected: row.selected };
    })
  ];
}

export interface RetainedIncomingKpiDraft {
  key: string;
  ownerKey: string;
  input: IncomingKpiBatchInput;
  dirty: boolean;
}

/** Bounded transient UI drafts. A later proposal never mutates an old source,
 * expression or selection; explicit source switches keep both retrievable. */
export class IncomingKpiDraftBook {
  private entries = new Map<string, RetainedIncomingKpiDraft>();
  private active = new Map<string, string>();

  get(ownerKey: string, targetNodeId: string): RetainedIncomingKpiDraft | undefined {
    return this.entries.get(this.active.get(`${ownerKey}/${targetNodeId}`) ?? "");
  }

  list(ownerKey: string, targetNodeId: string): RetainedIncomingKpiDraft[] {
    return [...this.entries.values()].filter(entry => entry.ownerKey === ownerKey && entry.input.draft.targetNodeId === targetNodeId);
  }

  open(ownerKey: string, input: IncomingKpiBatchInput, copyManualFrom?: IncomingKpiBatchInput): RetainedIncomingKpiDraft {
    const source = input.draft.source;
    const key = `${ownerKey}/${input.draft.targetNodeId}/${source.kind === "manual" ? "manual" : `${source.proposalId}/${source.groupId}`}`;
    const previous = this.entries.get(key);
    const copied = !previous && copyManualFrom?.draft.manualChildren.length
      ? editIncomingKpiDraft(input, { manualChildren: copyManualFrom.draft.manualChildren.map(row => ({ ...row })),
        estimatedAliases: copyManualFrom.draft.estimatedAliases?.filter(alias => copyManualFrom.draft.manualChildren.some(row => row.key === alias)) ?? [],
        inputValues: Object.fromEntries(copyManualFrom.draft.manualChildren.flatMap(row => copyManualFrom.draft.inputValues?.[row.key] === undefined ? [] : [[row.key, copyManualFrom.draft.inputValues[row.key]!]])) }) : input;
    const entry = previous ?? { key, ownerKey, input: copied, dirty: copied !== input };
    this.entries.delete(key); this.entries.set(key, entry);
    this.active.set(`${ownerKey}/${input.draft.targetNodeId}`, key);
    this.trim();
    return entry;
  }

  save(entry: RetainedIncomingKpiDraft, input: IncomingKpiBatchInput): RetainedIncomingKpiDraft {
    const next = { ...entry, input, dirty: true };
    this.entries.set(entry.key, next);
    return next;
  }

  select(key: string): RetainedIncomingKpiDraft | undefined {
    const entry = this.entries.get(key);
    if (entry) this.active.set(`${entry.ownerKey}/${entry.input.draft.targetNodeId}`, key);
    return entry;
  }

  private trim() {
    while (this.entries.size > 48) {
      const key = this.entries.keys().next().value!;
      this.entries.delete(key);
      for (const [owner, activeKey] of this.active) if (activeKey === key) this.active.delete(owner);
    }
  }
}
