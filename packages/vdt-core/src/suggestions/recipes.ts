import generatedCatalog from "./recipe-catalog.generated.json" with { type: "json" };
import type { KpiRecipeBinding, KpiSuggestionContext, KpiSuggestionRecipeCatalog, KpiSuggestionSet } from "./types";
import { KPI_SUGGESTION_LIMITS, KPI_SUGGESTION_SCHEMA, KPI_SUGGESTION_VALIDATOR } from "./types";
import { resolveKpiRecipeUnits, verifyKpiRecipeProjection } from "./units";
import { KpiSuggestionError, smartAssert, validateKpiSuggestionSet } from "./validation";
import { incomingKpiProposalFormula, incomingKpiProposedAlias, parseIncomingKpiFormula } from "./incoming-contract";
import { validateIncomingKpiEffectiveReferences, validateIncomingKpiModelConstants, validateIncomingKpiUnits } from "./incoming-formal";

/** Generated from canonical skills. No filesystem/Node dependency enters web. */
export const KPI_SUGGESTION_RECIPES = generatedCatalog as KpiSuggestionRecipeCatalog;

export function validateKpiSuggestionForContext(proposal: unknown, context: KpiSuggestionContext, catalog = KPI_SUGGESTION_RECIPES, now?: number): KpiSuggestionSet {
  const parsed = validateKpiSuggestionSet(proposal, now);
  smartAssert(parsed.contextHash === context.contextHash && parsed.targetNodeId === context.targetNodeId && parsed.catalogVersion === catalog.version,
    "STALE_PROPOSAL", "Smart proposal belongs to a different context/catalog.");
  for (const group of parsed.groups) {
    smartAssert(parsed.origin.kind !== "recipe" || group.recipeBinding, "INVALID_RECIPE_BINDING", "Library provenance requires an explicit canonical binding.");
    if (group.recipeBinding) {
      const recipe = catalog.recipes.find(r => r.id === group.recipeBinding!.recipeId);
      smartAssert(recipe, "INVALID_RECIPE_BINDING", "Canonical recipe no longer exists.");
      verifyKpiRecipeProjection(recipe, context, group);
    } else if (group.formula) {
      smartAssert(context.target.unit, "UNSUPPORTED_UNIT", "The parent needs a unit.");
      const analysis = parseIncomingKpiFormula(incomingKpiProposalFormula(parsed, group.id)!, "model");
      validateIncomingKpiEffectiveReferences(analysis); validateIncomingKpiModelConstants(analysis);
      validateIncomingKpiUnits(analysis, group.children.map((child, index) => ({ alias: incomingKpiProposedAlias(index), origin: "proposed", name: child.name, unit: child.unit })), context.target.unit, context.period);
    }
    for (const child of group.children.filter(child => parsed.origin.kind === "model" && child.existingNodeId)) {
      const observed = [context.root, context.target, ...context.children, ...context.ancestors, ...context.siblings].find(node => node.id === child.existingNodeId);
      smartAssert(observed && observed.id !== context.targetNodeId && observed.unit === child.unit, "UNOBSERVED_REFERENCE", "Choose an observed existing KPI with its exact unit.");
    }
  }
  return parsed;
}

export interface KpiRecipeDecision {
  binding: KpiRecipeBinding;
  /** Model/user-confirmed direct-child references, never name-based auto reuse. */
  existingChildren?: Record<string, string>;
}

export function buildRecipeKpiSuggestions(context: KpiSuggestionContext, decisions: readonly KpiRecipeDecision[], host: {
  proposalId: string; now: string; catalog?: KpiSuggestionRecipeCatalog;
}): KpiSuggestionSet | undefined {
  const catalog = host.catalog ?? KPI_SUGGESTION_RECIPES;
  const groups: KpiSuggestionSet["groups"] = [];
  for (const decision of decisions.slice(0, KPI_SUGGESTION_LIMITS.groups)) {
    const binding = decision.binding;
    const recipe = catalog.recipes.find(r => r.id === binding.recipeId && r.recipeHash === binding.recipeHash
      && r.skillHash === binding.skillHash && r.targetRole === binding.targetRole && binding.contextHash === context.contextHash);
    if (!recipe || !binding.sourceRef.trim() || !binding.rationale.trim()) continue;
    try {
      const units = resolveKpiRecipeUnits(recipe, context);
      groups.push({ id: `alternative_${groups.length + 1}`, title: recipe.title, selectionMode: "all",
        children: recipe.children.map(c => ({ key: c.key, conceptKey: c.conceptKey, name: c.name, unit: units[c.key]!,
          ...(decision.existingChildren?.[c.key] ? { existingNodeId: decision.existingChildren[c.key]! } : {}) })),
        requiredKeys: recipe.children.map(c => c.key), formula: recipe.formula, recipeBinding: { ...binding }, limitations: [...recipe.limitations] });
    } catch (error) { if (!(error instanceof KpiSuggestionError)) throw error; }
  }
  if (!groups.length) return undefined;
  return validateKpiSuggestionSet({ schemaVersion: KPI_SUGGESTION_SCHEMA, validatorVersion: KPI_SUGGESTION_VALIDATOR,
    catalogVersion: catalog.version, proposalId: host.proposalId, targetNodeId: context.targetNodeId, contextHash: context.contextHash,
    createdAt: host.now, expiresAt: new Date(Date.parse(host.now) + KPI_SUGGESTION_LIMITS.ttlMs).toISOString(),
    origin: { kind: "recipe", sourceRef: groups[0]!.recipeBinding!.sourceRef }, rationale: groups[0]!.recipeBinding!.rationale,
    limitations: ["Proposed decomposition; confirm applicability. Supply input values before Add; the calculated result must preserve the current KPI."], groups
  }, Date.parse(host.now));
}
