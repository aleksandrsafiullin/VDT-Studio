import type { KpiSuggestionContext } from "./types";
import { KPI_SUGGESTION_LIMITS } from "./types";
import { INCOMING_KPI_LIMITS, INCOMING_KPI_UNIT_POLICY } from "./incoming-types";
import { INCOMING_KPI_UNIT_GRAMMAR, parseIncomingKpiUnit } from "./incoming-unit-contract";
import { KPI_SUGGESTION_RECIPES } from "./recipes";
import { findAncestorRecipeOperand } from "./recipe-scope";
import { resolveKpiRecipeUnits } from "./units";

/** Model-owned acceptance rules. Identity, credentials, TTL and revision CAS
 * remain host-owned checks; the model must never fabricate those fields. */
export function buildKpiSuggestionResponseContract(context: KpiSuggestionContext) {
  let targetUnit;
  try { targetUnit = context.target.unit ? parseIncomingKpiUnit(context.target.unit, context.period) : null; }
  catch { targetUnit = null; }
  const compatibleRecipes = KPI_SUGGESTION_RECIPES.recipes.flatMap(recipe => {
    try {
      const units = resolveKpiRecipeUnits(recipe, context);
      return [{ recipe, units, ancestorOperand: findAncestorRecipeOperand(context, recipe, units) }];
    } catch {
      return [];
    }
  });
  return {
    version: "smart-kpi-response-contract.v1",
    definition: {
      ready: "A defensible formula may have all factor measurements unknown. Return the definitions and units. The editor collects the values.",
      custom: "When no eligible recipe fits, use recipeId:null for a defensible target-specific formula. A scoped total may use the count of matching records times the mean amount per matching record.",
      empty: "Use empty with a specific reason when the target definition, unit or a defensible breakdown cannot be established, or the complete layer exceeds the output bounds."
    },
    limits: { outputBytes: KPI_SUGGESTION_LIMITS.outputBytes, outputTokens: KPI_SUGGESTION_LIMITS.outputTokens,
      alternatives: KPI_SUGGESTION_LIMITS.groups, minFactors: 2, maxFactors: KPI_SUGGESTION_LIMITS.children,
      formulaCharacters: 500, astNodes: INCOMING_KPI_LIMITS.astNodes, astDepth: INCOMING_KPI_LIMITS.astDepth,
      functionArguments: INCOMING_KPI_LIMITS.functionArguments },
    structure: [
      "Match the supplied JSON schema exactly, including required null fields and string/array bounds.",
      "ready needs at least one group; empty needs no groups and a specific reason.",
      "Group IDs and child keys/conceptKeys use ^[a-z][a-z0-9_]{0,47}$. IDs are unique; keys, conceptKeys and normalized factor names are unique within each group.",
      "Every group has at least two distinct substantive lower-level components, never renamed copies of the target or contextual metrics.",
      "all requires every child key exactly once in requiredKeys. independent requires empty requiredKeys, null formula and null recipeId.",
      "Include the complete applicable immediate layer. If it cannot fit the output budget, return empty with that limitation; never silently omit factors."
    ],
    formula: {
      operators: ["+", "-", "*", "/"], functions: ["min", "max"],
      rules: [
        "Use only child keys as references. Reference every child exactly once; no unknown references, repeated, cancelled or zero-weight factors.",
        "Use no numeric coefficients, defaults, thresholds or conversion multipliers. The only literal is raw 1 as the left side of a subtraction, normally (1 - decimal_fraction).",
        "Addition, subtraction and min/max require identical dimensions and scales. Multiplication/division must cancel to exactly the target dimensions and scales.",
        "Do not reverse a parent equation, reuse an ancestor/sibling, cross process boundaries, or assume exclusions, overlap or values.",
        "Preserve all applicable named factors and qualifiers in the project/selected skill. Missing measurements do not prevent proposing measurable factors."
      ]
    },
    units: { policy: INCOMING_KPI_UNIT_POLICY, grammar: INCOMING_KPI_UNIT_GRAMMAR,
      target: { text: context.target.unit ?? null, parsed: targetUnit, period: context.period },
      rules: [
        "Use machine expressions without spaces: USD/unit, never USD per unit. At most one /, at most four * terms per side, integer powers from -6 through 6 excluding 0.",
        "Aliases in grammar are exact spelling aliases; other atoms are case-sensitive. Listed currency codes are case-insensitive aliases of their uppercase codes.",
        "No implicit conversions between h/min/s, km/m, t/kg, percent/fraction or currencies. Use the exact target scale and repeat each opaque population atom exactly.",
        "A period scopes a total without adding /month or another divisor. Include a period atom only when it is present in the target expression and matches its explicit grain.",
        "For null target.parsed, a formula cannot be verified: return empty and identify the missing/unsupported target unit."
      ] },
    references: {
      reusableDirectChildren: context.children.filter(node => node.status !== "rejected").map(node => ({ id: node.id, name: node.name, unit: node.unit ?? null })),
      rules: [
        "existingNodeId must be null for new factors, or an active direct child ID listed here with its exact unit. Never use any other graph ID.",
        "Do not duplicate an existing KPI name, node ID/conceptKey or smart-concept tag anywhere in the project. Reuse is limited to the listed direct children; explain an unsupported shared reference instead of duplicating it.",
        "Do not name a new factor as a normalized copy of the root, target, ancestor or sibling. Name equality normalizes NFKC, case, punctuation, spaces and underscores."
      ]
    },
    recipes: compatibleRecipes.flatMap(({ recipe, units, ancestorOperand }) => ancestorOperand ? [] : [{
      id: recipe.id, title: recipe.title, targetRole: recipe.targetRole, formula: recipe.formula, limitations: recipe.limitations,
      children: recipe.children.map(child => ({ key: child.key, conceptKey: child.conceptKey, unit: units[child.key]! }))
    }]),
    excludedAncestorRecipes: compatibleRecipes.flatMap(({ recipe, ancestorOperand }) => ancestorOperand ? [{
      recipeId: recipe.id, targetNodeId: context.targetNodeId, repeatedTargetLabel: ancestorOperand.name, unit: context.target.unit
    }] : []),
    recipeRule: "Use only a recipe in recipes whose business definition applies to context.target and matches ALL listed keys, concepts, formula and units. Use excludedAncestorRecipes only to avoid ancestor recipes and repeated target aliases with the same unit. Choose factors independently from the target's own definition."
  };
}

export type KpiSuggestionResponseContract = ReturnType<typeof buildKpiSuggestionResponseContract>;
