import { parseValidationUnit, type VdtNode, type VdtProject } from "@vdt-studio/vdt-core";
import { requiresDerivedRootForRun } from "./model-acceptance-contract";
import type { VdtAgentRunState } from "./types";
import { collectLiteralUserQuantities, normalizeQuotedCountUnit, type LiteralUserQuantity } from "./value-provenance-contract";

type SourceBinding = LiteralUserQuantity & { nodeId: string };

export type ConstructionSourceIssue = {
  code: "DUPLICATE_SOURCE_FACT" | "SOURCE_UNIT_MISMATCH" | "AMBIGUOUS_SOURCE_QUOTE";
  nodeId: string;
  quote: string;
  value: number;
  detail: string;
  usedBy?: string;
  sourceUnit?: string;
  nodeUnit?: string;
};

function isRunCreatedInput(state: VdtAgentRunState, project: VdtProject, node: VdtNode): boolean {
  return requiresDerivedRootForRun(state.request)
    && node.id !== project.rootNodeId && node.type !== "root_kpi" && node.type !== "calculated"
    && node.aiGenerated && !node.formula?.trim() && !node.goalSeek
    && !state.request.input.project?.graph.nodes.some(({ id }) => id === node.id)
    && Boolean(state.mutationProposals?.some((proposal) =>
      proposal.runId === state.runId && proposal.source === "agent" && proposal.status === "applied"
      && proposal.changeSet.additions.some((addition) => addition.nodeId === node.id
        && proposal.selectedChangeIds.includes(addition.id))));
}

export function isRunCreatedInputLeaf(state: VdtAgentRunState, project: VdtProject, node: VdtNode): boolean {
  return !project.graph.edges.some((edge) => edge.sourceNodeId === node.id) && isRunCreatedInput(state, project, node);
}

function sameFact(first: LiteralUserQuantity, second: LiteralUserQuantity): boolean {
  return first.value === second.value && first.quote === second.quote;
}

export function matchesQuotedSourceUnit(actual: string | undefined, source: string): boolean {
  const parsed = actual && parseValidationUnit(normalizeQuotedCountUnit(actual), true);
  return !!parsed && JSON.stringify(parsed) === JSON.stringify(parseValidationUnit(source, true));
}

/** One verbatim measurement can be reused by several formulas through its
 * input ID. Match a shortened quote only when it selects one source span. */
function resolveFact(facts: readonly LiteralUserQuantity[], value: number, note: string) {
  const quote = note.trim();
  const excerpts = [quote, ...[...quote.matchAll(/["«“]([^"»”\n]+)["»”]/g)].map((match) => match[1]!)];
  const exact = facts.filter((fact) => fact.value === value && excerpts.includes(fact.quote));
  const candidates = exact.length ? exact : facts.filter((fact) => fact.value === value
    && excerpts.some((excerpt) => excerpt.length >= 4 && (fact.quote.includes(excerpt) || excerpt.includes(fact.quote))));
  return { fact: candidates[0] ?? { value, quote }, ambiguous: candidates.length > 1 };
}

export function sourceBindingIssue(
  bindings: readonly SourceBinding[], binding: SourceBinding, nodeUnit: string | undefined, ambiguous: boolean
): ConstructionSourceIssue | undefined {
  const { nodeId, quote, value, unit: sourceUnit } = binding;
  if (ambiguous) return { code: "AMBIGUOUS_SOURCE_QUOTE", nodeId, quote, value,
    detail: `Input ${nodeId} needs the full verbatim excerpt that identifies which measurement to use.` };
  const existing = bindings.find((entry) => entry.nodeId !== nodeId && sameFact(entry, binding));
  if (existing) return { code: "DUPLICATE_SOURCE_FACT", nodeId, quote, value, usedBy: existing.nodeId,
    detail: `The quoted measurement for ${nodeId} already belongs to ${existing.nodeId}. Reuse that input ID via sharedWith or choose a distinct source quote.` };
  if (sourceUnit && !matchesQuotedSourceUnit(nodeUnit, sourceUnit)) return { code: "SOURCE_UNIT_MISMATCH", nodeId, quote, value,
    sourceUnit, ...(nodeUnit ? { nodeUnit } : {}),
    detail: `The quote for ${nodeId} uses ${sourceUnit}. Set that explicit input unit or choose the quote that matches the intended measurement.` };
}

export function constructionSourceFacts(project: VdtProject, state: VdtAgentRunState) {
  const { prompt, businessContext, unit } = state.request.input;
  const { quantities } = collectLiteralUserQuantities([prompt, businessContext,
    ...state.chatMessages.filter(({ role }) => role === "user").map(({ text }) => text)], unit);
  const inputIds = new Set<string>();
  const bindings: SourceBinding[] = [];
  const issues: ConstructionSourceIssue[] = [];
  for (const node of project.graph.nodes) {
    if (!isRunCreatedInput(state, project, node)) continue;
    const children = project.graph.edges.filter(({ sourceNodeId }) => sourceNodeId === node.id);
    // Explanatory context leaves the source assigned to this input. The
    // existing mutation rules still restrict writes to structural leaves.
    if (children.some(({ relation }) => relation !== "contextual_influence")) continue;
    if (!children.length) inputIds.add(node.id);
    const value = node.baselineValue ?? node.value;
    const note = node.valueSource?.note;
    if (node.valueStatus !== "user_provided_value" || !note || value === undefined || !Number.isFinite(value)) continue;
    const { fact, ambiguous } = resolveFact(quantities, value, note);
    const binding = { ...fact, nodeId: node.id };
    const issue = sourceBindingIssue(bindings, binding, node.unit, ambiguous);
    if (issue) issues.push(issue);
    bindings.push(binding);
  }
  return { bindings, issues, inputIds, resolve: (value: number, note: string) => resolveFact(quantities, value, note) };
}

export function unusedConstructionSourceFacts(facts: readonly LiteralUserQuantity[], bindings: readonly SourceBinding[]): LiteralUserQuantity[] {
  return facts.filter((fact) => !bindings.some((binding) => sameFact(fact, binding)));
}
