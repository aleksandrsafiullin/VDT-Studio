import { buildKpiSuggestionContext, buildRecipeKpiSuggestions, KPI_SUGGESTION_RECIPES, validateKpiSuggestionForContext,
  type IncomingKpiResolvedAlias, type KpiRecipeBinding, type KpiRecipeDecision, type KpiSuggestionContext, type KpiSuggestionSelection, type KpiSuggestionSet, type VdtProject } from "@vdt-studio/vdt-core";
import type { SmartKpiScope } from "./smart-kpi-scope";

const KEY = "vdt-smart-kpi-decisions.v1", MAX_ENTRIES = 128, MAX_BYTES = 256 * 1024, TTL = 7 * 86400_000;
interface Decision { id: string; scope: string; contextHash: string; targetNodeId: string; catalogVersion: string; createdAt: number; decisions: KpiRecipeDecision[] }
let memory: Decision[] = [], hydrated = false;
const scope = (c: KpiSuggestionContext) => JSON.stringify([c.workspaceId, c.projectId, c.vdtId]);
function hydrate() {
  if (hydrated) return; hydrated = true;
  try {
    const raw = globalThis.localStorage?.getItem(KEY); if (!raw || new TextEncoder().encode(raw).byteLength > MAX_BYTES) return;
    const parsed: unknown = JSON.parse(raw); if (!Array.isArray(parsed) || parsed.length > MAX_ENTRIES) return;
    memory = parsed.filter((entry): entry is Decision => !!entry && typeof entry === "object" && typeof entry.id === "string" && entry.id.length <= 160 && typeof entry.scope === "string" && entry.scope.length <= 600
      && typeof entry.contextHash === "string" && typeof entry.targetNodeId === "string" && typeof entry.catalogVersion === "string"
      && typeof entry.createdAt === "number" && Array.isArray(entry.decisions) && entry.decisions.length <= 3);
  } catch { /* Rebuildable provenance cache; no effect on graph or credentials. */ }
}
function write(entry: Decision) {
  hydrate(); const now = Date.now();
  memory = [entry, ...memory.filter(e => e.createdAt > now - TTL && !(e.scope === entry.scope && e.targetNodeId === entry.targetNodeId && e.contextHash === entry.contextHash))].slice(0, MAX_ENTRIES);
  while (new TextEncoder().encode(JSON.stringify(memory)).byteLength > MAX_BYTES) memory.pop();
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(memory)); } catch { /* Bounded memory fallback. */ }
}

/** A validated model's explicit recipe selection is evidence; display names,
 * concept tags, and mere catalog membership never establish applicability. */
export function recordSmartKpiDecision(context: KpiSuggestionContext, proposal: KpiSuggestionSet): void {
  const validated = validateKpiSuggestionForContext(proposal, context);
  const decisions = validated.groups.flatMap(group => group.recipeBinding ? [{ binding: { ...group.recipeBinding },
    existingChildren: Object.fromEntries(group.children.filter(c => c.existingNodeId).map(c => [c.key, c.existingNodeId!])) }] : []);
  if (decisions.length) write({ id: validated.proposalId, scope: scope(context), contextHash: context.contextHash, targetNodeId: context.targetNodeId,
    catalogVersion: validated.catalogVersion, createdAt: Date.now(), decisions });
}

export function getSmartKpiLibraryProposal(context: KpiSuggestionContext): KpiSuggestionSet | undefined {
  hydrate(); const now = Date.now();
  const entry = memory.find(e => e.scope === scope(context) && e.targetNodeId === context.targetNodeId && e.contextHash === context.contextHash
    && e.catalogVersion === KPI_SUGGESTION_RECIPES.version && e.createdAt > now - TTL && e.createdAt <= now);
  if (!entry) return undefined;
  try {
    const result = buildRecipeKpiSuggestions(context, entry.decisions, { proposalId: `library_${entry.id}`.slice(0, 160), now: new Date(entry.createdAt).toISOString() });
    return result ? validateKpiSuggestionForContext(result, context) : undefined;
  } catch { return undefined; }
}

/** Only an accepted canonical recipe supplies these direct child's roles. The
 * mapping is recipe child conceptKey -> canonical targetRole, never name routing.
 * This prepares one immediate next layer; it does not recurse or create nodes. */
export async function recordAcceptedSmartKpiChildren(input: { project: VdtProject; context: KpiSuggestionContext; proposal: KpiSuggestionSet;
  selection: KpiSuggestionSelection; aliases?: IncomingKpiResolvedAlias[]; operationId: string; scope: SmartKpiScope }): Promise<void> {
  const validated = validateKpiSuggestionForContext(input.proposal, input.context);
  const group = validated.groups.find(g => g.id === input.selection.groupId);
  const parentRecipe = KPI_SUGGESTION_RECIPES.recipes.find(r => r.id === group?.recipeBinding?.recipeId);
  if (!parentRecipe || !group) return;
  for (const child of parentRecipe.children.filter(c => input.selection.childKeys.includes(c.key))) {
    const selected = group.children.find(c => c.key === child.key);
    const targetNodeId = input.aliases?.find(row => row.alias === `p_${group.children.findIndex(row => row.key === child.key) + 1}`)?.nodeId
      ?? selected?.existingNodeId ?? `${input.operationId}_${child.key}`;
    if (!input.project.graph.nodes.some(n => n.id === targetNodeId)) continue;
    const next = KPI_SUGGESTION_RECIPES.recipes.filter(r => r.targetRole === child.conceptKey && r.skillId === parentRecipe.skillId && r.skillHash === parentRecipe.skillHash);
    if (!next.length) continue;
    const context = await buildKpiSuggestionContext(input.project, { ...input.scope, targetNodeId });
    const decisions = next.map(recipe => ({ binding: { id: `accepted_${input.operationId}_${child.key}`, recipeId: recipe.id, recipeHash: recipe.recipeHash,
      skillHash: recipe.skillHash, targetRole: recipe.targetRole, contextHash: context.contextHash, basis: "accepted_smart", sourceRef: `smart:${validated.proposalId}:${group.id}:${child.key}`,
      rationale: `User accepted the ${child.conceptKey} role in canonical recipe ${parentRecipe.id}. Confirm the next decomposition before adding it.` } satisfies KpiRecipeBinding }));
    const proposal = buildRecipeKpiSuggestions(context, decisions, { proposalId: `smart_library_${crypto.randomUUID()}`, now: new Date().toISOString() });
    if (proposal) recordSmartKpiDecision(context, proposal);
  }
}
