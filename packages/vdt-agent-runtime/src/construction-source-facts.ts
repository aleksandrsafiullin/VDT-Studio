import { extractFormulaReferences, parseValidationUnit, type VdtNode, type VdtProject } from "@vdt-studio/vdt-core";
import { requiresDerivedRootForRun } from "./model-acceptance-contract";
import type { VdtAgentRunState, VdtAgentStartRequest } from "./types";
import { collectLiteralUserQuantities, normalizeQuotedInputUnit, type LiteralUserQuantity } from "./value-provenance-contract";

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
  const parsed = actual && parseValidationUnit(normalizeQuotedInputUnit(actual), true);
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
  const { quantities: observed } = collectLiteralUserQuantities([prompt, businessContext,
    ...state.chatMessages.filter(({ role }) => role === "user").map(({ text }) => text)], unit);
  const multiplier = state.selectedSkills[0]?.id === "mining.excavation" && excavationOutputUnit.test(unit?.trim() ?? "")
    ? identicalMachineMultiplier(observed) : undefined;
  const quantities = multiplier ? observed.map((fact) => fact === multiplier ? { ...fact, unit: "1" } : fact) : observed;
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
  return { bindings, issues, inputIds, quantities, resolve: (value: number, note: string) => resolveFact(quantities, value, note) };
}

export function unusedConstructionSourceFacts(facts: readonly LiteralUserQuantity[], bindings: readonly SourceBinding[]): LiteralUserQuantity[] {
  return facts.filter((fact) => !bindings.some((binding) => sameFact(fact, binding)));
}

const durationUnit = /^(?:h|min|s|day)$/;
const excavationOutputUnit = /^(?:t|tonnes?|kg|bcm|m[³3]|т|тонн[аы]?|м[³3])$/iu;
const scheduledTime = /\bscheduled\b|запланир|по графику/iu;
const downtime = /\b(?:downtime|stops?|stoppages?|breakdowns?|repairs?|interruptions?|maintenance)\b|просто[йяиев]|останов|ремонт|перерыв/iu;
const overlappingBasis = /\b(?:net|effective|productive|actual working) (?:time|hours?)\b|\b(?:total|combined) downtime\b|already (?:deducted|excluded|included)|\boverlap|(?:чист|эффективн|фактическ)\p{L}* (?:время|час)|(?:суммарн|общ)\p{L}* (?:время )?просто|уже (?:вычт|исключ|включ)|пересека/iu;
const contextOnly = /\b(?:example|benchmark|previous|last month|reference only)\b|например|эталон|прошл|справоч/iu;
const faceOutput = /\b(?:from|at) (?:the )?(?:(?:working|mine) )?face\b|(?:с|из|на)\s+(?:рабоч\p{L}*\s+)?забо/iu;
const transport = /\b(?:transport|haulage)\b|транспорт|откатк/iu;
const excludedLimit = /\b(?:does not limit|is not (?:a|the) (?:bottleneck|constraint)|outside (?:the )?scope|not limiting)\b|не огранич|вне расч[её]та|не является огранич/iu;
const broadMiningSkills = ["mining.production_volume", "mining.mine_production_system", "mining.load_and_haul",
  "mining.haulage_truck_cycle", "mining.underground_production_cycle"];
const identicalMachineCount = /\bidentical (?:[a-z-]+ ){0,2}(?:machines|loaders|excavators|shovels)\b|одинаков\p{L}*\s+(?:машин|экскаватор|погрузчик)/iu;
const perMachineSchedule = /\b(?:each is scheduled|each (?:machine|loader|excavator)|per (?:machine|loader|excavator))\b|на каждую|на кажд[оы]\p{L}* (?:машин|экскаватор|погрузчик)/iu;

function hasCycleProductionRates(facts: readonly LiteralUserQuantity[]): boolean {
  return ["cycle", "lift"].some((action) =>
    facts.some(({ unit }) => unit === `${action}/h`) && facts.some(({ unit }) => unit === `t/${action}`));
}

function identicalMachineMultiplier(facts: readonly LiteralUserQuantity[]): LiteralUserQuantity | undefined {
  if (!hasCycleProductionRates(facts) || !facts.some(({ quote, unit }) => durationUnit.test(unit ?? "")
    && perMachineSchedule.test(quote) && scheduledTime.test(quote))) return;
  const machines = facts.filter(({ quote, unit, value }) =>
    !unit && Number.isSafeInteger(value) && value > 0 && identicalMachineCount.test(quote) && !contextOnly.test(quote));
  return machines.length === 1 ? machines[0] : undefined;
}

/** Eligibility guard for a stated face-only output with measured cycle rates.
 * A neutral read is still allowed. A manual selection has precedence. */
export function excludedExcavationSkillIds(request: VdtAgentStartRequest, catalogIds: readonly string[]): string[] {
  const { prompt, businessContext, unit, skillSelection } = request.input;
  if (skillSelection?.source === "user" || !requiresDerivedRootForRun(request)
    || !excavationOutputUnit.test(unit?.trim() ?? "") || !catalogIds.includes("mining.excavation")) return [];
  const brief = [prompt, businessContext].filter(Boolean).join("\n");
  if (!faceOutput.test(brief) || !brief.split(/[.!?;\n]/u).some((clause) => transport.test(clause) && excludedLimit.test(clause))) return [];
  if (!hasCycleProductionRates(collectLiteralUserQuantities([prompt, businessContext], unit).quantities)) return [];
  return broadMiningSkills.filter((id) => catalogIds.includes(id));
}

/** An excavation-output plan with a quoted schedule and separate loss
 * durations must use those losses. A stated net/combined/overlapping basis
 * belongs to the model's scope analysis, since adding categories can double count. */
export function excavationDowntimeCoverage(
  project: VdtProject, state: VdtAgentRunState, sourceFacts = constructionSourceFacts(project, state)
) {
  const { unit } = state.request.input;
  if (!requiresDerivedRootForRun(state.request) || state.selectedSkills[0]?.id !== "mining.excavation"
    || !unit || !excavationOutputUnit.test(unit.trim())) return;
  const durations = sourceFacts.quantities.filter((fact) => durationUnit.test(fact.unit ?? "") && !contextOnly.test(fact.quote));
  if (!durations.some((fact) => scheduledTime.test(fact.quote)) || durations.some((fact) => overlappingBasis.test(fact.quote))) return;
  const required = durations.filter((fact) => downtime.test(fact.quote) && !scheduledTime.test(fact.quote));
  if (!required.length) return;

  const nodes = new Map(project.graph.nodes.map((node) => [node.id, node]));
  const active = new Set<string>();
  const pending = [project.rootNodeId];
  while (pending.length) {
    const id = pending.pop()!;
    if (active.has(id)) continue;
    active.add(id);
    const formula = nodes.get(id)?.formula;
    if (formula?.trim()) {
      try { pending.push(...extractFormulaReferences(formula)); }
      catch { /* Formula validation reports the malformed expression. */ }
    }
  }
  return { required, missing: unusedConstructionSourceFacts(required, sourceFacts.bindings.filter(({ nodeId }) => active.has(nodeId))) };
}
