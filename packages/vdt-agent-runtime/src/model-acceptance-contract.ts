import { extractFormulaReferences, tokenizeFormula, type VdtProject } from "@vdt-studio/vdt-core";
import type { VdtAgentStartRequest } from "./types";
import { collectLiteralUserQuantities } from "./value-provenance-contract";

/** The same requirement is shown before inference and by finish verification. */
export const DERIVED_ROOT_REQUIREMENT =
  "A new tree must contain real driver nodes and a root formula referencing them. A standalone number or constant formula is not a completed VDT. Build the requested dependencies before requesting finish.";
export const DERIVED_ROOT_PROMPT_RULE =
  `${DERIVED_ROOT_REQUIREMENT} Put the user's source measurements in separate input leaves with their provenance; do not inline those measured numbers into a constant root formula. Grounding quotes apply to source inputs. Calculate derived outputs from references; do not ask the user to supply or quote the derived root result when its source inputs are already provided. A selected skill is guidance within the user's process boundary, not authority to add another unrequested operation.`;

export function requiresDerivedRootForRun(request: VdtAgentStartRequest): boolean {
  if (request.mode === "review_project" || request.mode === "deepen_node") return false;
  if (request.mode === "generate_vdt") return true;
  const project = request.input.project;
  const root = project?.graph.nodes.find((node) => node.id === project.rootNodeId);
  return !project || (project.graph.nodes.length <= 1 && !root?.formula?.trim()
    && !Number.isFinite(root?.baselineValue ?? root?.value));
}

/** Structural prerequisite; normal formula and graph validation still apply. */
export function hasDerivedRoot(project: VdtProject): boolean {
  if (project.graph.nodes.length < 2) return false;
  const formula = project.graph.nodes.find((node) => node.id === project.rootNodeId)?.formula;
  try {
    return Boolean(formula?.trim() && extractFormulaReferences(formula).length > 0);
  } catch {
    return false;
  }
}

/** Require provenance when a quoted monetary amount is used as a formula
 * literal without a corresponding user input in the active dependency tree. */
export function unboundQuotedMoneyFacts(project: VdtProject, request: VdtAgentStartRequest) {
  const { prompt, businessContext } = request.input;
  const { quantities } = collectLiteralUserQuantities([prompt, businessContext]);
  const facts = quantities.filter(({ quote }) => /(?:[$€£]\s*\d|\d\s*(?:[$€£]|(?:USD|EUR|GBP|KZT|RUB|CAD|AUD|JPY|CNY|CHF|(?:US )?dollars?|доллар(?:а|ов)?|евро|тенге|рубл(?:ь|я|ей))(?![\p{L}\p{N}])))/iu.test(quote)
    && !/(?:\b(?:for example|for instance|e\.g\.|assume)\b|например|предположим)/iu.test(quote));
  if (!facts.length) return [];
  const nodes = new Map(project.graph.nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  const sourcedQuotes = new Set<string>();
  const numbers = new Set<number>();
  const pending = [project.rootNodeId];
  while (pending.length) {
    const id = pending.pop()!;
    const node = nodes.get(id);
    if (!node || visited.has(id)) continue;
    visited.add(id);
    if (node.formula?.trim()) {
      try {
        pending.push(...extractFormulaReferences(node.formula));
        for (const token of tokenizeFormula(node.formula)) if (token.type === "number") numbers.add(token.value);
      } catch { /* Formula validation reports malformed expressions. */ }
    } else if (node.valueStatus === "user_provided_value" && node.valueSource?.note) {
      sourcedQuotes.add(node.valueSource.note);
    }
  }
  return facts.filter((fact) => numbers.has(Math.abs(fact.value)) && !sourcedQuotes.has(fact.quote));
}
