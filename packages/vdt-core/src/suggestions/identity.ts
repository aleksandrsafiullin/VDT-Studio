import type { VdtProject, VdtNode } from "../types";
import type { KpiSuggestionContext, KpiSuggestionExecutionIdentity, KpiSuggestionPeriod, KpiContextNode } from "./types";
import { KPI_SUGGESTION_LIMITS, KPI_SUGGESTION_PREPARATION_VERSION, KPI_SUGGESTION_SCHEMA, KPI_SUGGESTION_VALIDATOR } from "./types";
import { validateKpiSuggestionContext } from "./validation";

/** Canonical feature-local JSON, not a replacement for storage's frozen serializer. */
export function kpiCanonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(kpiCanonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b, "en")).map(([k, v]) => `${JSON.stringify(k)}:${kpiCanonicalJson(v)}`).join(",")}}`;
  if (value === undefined || (typeof value === "number" && !Number.isFinite(value))) throw new Error("Invalid Smart identity JSON.");
  return JSON.stringify(value);
}

export async function kpiContentHash(value: unknown): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(kpiCanonicalJson(value)));
  return `sha256:${[...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Numeric changes alone do not spend another model request. Knownness/source
 * changes do; exact numeric/scenario/layout state is guarded separately at apply. */
export async function fingerprintKpiProject(project: VdtProject): Promise<string> {
  return kpiContentHash({
    id: project.id, name: project.name, description: project.description, industry: project.industry,
    businessContext: project.businessContext, rootNodeId: project.rootNodeId,
    nodes: project.graph.nodes.map(({ position: _p, createdAt: _c, updatedAt: _u, baselineValue, value,
      scenarioValue: _sv, aiConfidence: _ac, ...node }) => ({ ...node, valueKnown: baselineValue !== undefined || value !== undefined }))
      .sort((a, b) => a.id.localeCompare(b.id, "en")),
    edges: project.graph.edges.map(({ aiConfidence: _a, ...edge }) => edge).sort((a, b) => a.id.localeCompare(b.id, "en")),
    sources: project.dataSources.map(s => ({ id: s.id, type: s.type, file: s.file, schema: s.schema })).sort((a, b) => a.id.localeCompare(b.id, "en"))
  });
}

export interface BuildKpiContextOptions {
  workspaceId: string;
  vdtId: string | null;
  targetNodeId: string;
  period: KpiSuggestionPeriod;
  goal?: string;
  /** Host-computed once per semantic project snapshot. Never model supplied. */
  graphFingerprint?: string;
}

export async function buildKpiSuggestionContext(project: VdtProject, options: BuildKpiContextOptions): Promise<KpiSuggestionContext> {
  const nodes = new Map(project.graph.nodes.map(n => [n.id, n]));
  if (nodes.size !== project.graph.nodes.length) throw new Error("Duplicate graph IDs cannot form a Smart context.");
  const target = nodes.get(options.targetNodeId), root = nodes.get(project.rootNodeId);
  if (!target || !root) throw new Error("Smart context target/root is missing.");
  const outgoing = new Map<string, Set<string>>(), incoming = new Map<string, Set<string>>();
  for (const edge of project.graph.edges) {
    const out = outgoing.get(edge.sourceNodeId) ?? new Set<string>(); out.add(edge.targetNodeId); outgoing.set(edge.sourceNodeId, out);
    const ins = incoming.get(edge.targetNodeId) ?? new Set<string>(); ins.add(edge.sourceNodeId); incoming.set(edge.targetNodeId, ins);
  }
  const children = [...(outgoing.get(target.id) ?? [])].sort();
  const ancestorIds = new Set<string>(), frontier = [...(incoming.get(target.id) ?? [])];
  while (frontier.length) {
    const id = frontier.pop()!;
    if (ancestorIds.has(id)) continue;
    ancestorIds.add(id); frontier.push(...(incoming.get(id) ?? []));
  }
  const siblings = [...new Set([...(incoming.get(target.id) ?? [])].flatMap(id => [...(outgoing.get(id) ?? [])]))]
    .filter(id => id !== target.id && !children.includes(id)).sort();
  let omittedText = false;
  const text = (s: string | undefined, max: number) => {
    if (s === undefined) return undefined;
    if (s.length > max) omittedText = true;
    return s.slice(0, max);
  };
  const summarize = async (n: VdtNode): Promise<KpiContextNode> => ({
    id: n.id, name: text(n.name, 160)!, type: n.type, status: n.status,
    ...(n.description ? { description: text(n.description, 240)! } : {}),
    ...(n.unit ? { unit: text(n.unit, 80)! } : {}), ...(n.formula ? { formula: text(n.formula, 500)! } : {}),
    valueKnown: n.baselineValue !== undefined || n.value !== undefined, valueStatus: n.valueStatus ?? null,
    provenance: n.dataMapping ? "mapped" : n.valueSource ? "sourced" : "unsourced",
    ...(n.dataMapping ? { mappingIdentity: await kpiContentHash(n.dataMapping) } : {})
  });
  const pick = async (ids: string[], max: number) => Promise.all(ids.slice(0, max).filter(id => nodes.has(id)).map(id => summarize(nodes.get(id)!)));
  const [rootSummary, targetSummary, childSummaries, ancestorSummaries, siblingSummaries] = await Promise.all([
    summarize(root), summarize(target), pick(children, 12), pick([...ancestorIds].sort(), 10), pick(siblings, 8)
  ]);
  const relevantPlan = root.decompositionPlan?.nodes.filter(n => n.nodeId === target.id || n.parentNodeId === target.id);
  const summaryIds = new Set([root.id, target.id, ...childSummaries.map(n => n.id), ...ancestorSummaries.map(n => n.id), ...siblingSummaries.map(n => n.id)]);
  const parentIds = incoming.get(target.id) ?? new Set<string>();
  const relevantEdges = project.graph.edges.filter(e => ancestorIds.has(e.targetNodeId) || e.targetNodeId === target.id
    || e.sourceNodeId === target.id || parentIds.has(e.sourceNodeId) && siblings.includes(e.targetNodeId));
  const relationshipCandidates = relevantEdges.filter(e => summaryIds.has(e.sourceNodeId) && summaryIds.has(e.targetNodeId))
    .sort((a, b) => `${a.sourceNodeId}|${a.targetNodeId}|${a.relation}`.localeCompare(`${b.sourceNodeId}|${b.targetNodeId}|${b.relation}`, "en"));
  const relationships = relationshipCandidates.slice(0, 96).map(e => ({ parentNodeId: e.sourceNodeId, childNodeId: e.targetNodeId, relation: e.relation }));
  const context: KpiSuggestionContext = {
    schemaVersion: "kpi_suggestion_context.v1", workspaceId: options.workspaceId, projectId: project.id, vdtId: options.vdtId,
    targetNodeId: target.id, graphFingerprint: options.graphFingerprint ?? await fingerprintKpiProject(project), contextHash: "",
    period: options.period,
    business: { name: text(project.name, 160)!, ...(project.description ? { description: text(project.description, 300)! } : {}),
      ...(project.industry ? { industry: text(project.industry, 160)! } : {}), ...(project.businessContext ? { context: text(project.businessContext, 1500)! } : {}),
      ...(options.goal ? { goal: text(options.goal, 500)! } : {}) },
    root: rootSummary, target: targetSummary, children: childSummaries, ancestors: ancestorSummaries, siblings: siblingSummaries,
    // Full plan is fingerprinted above. Excerpt only preserves entries relevant to this target.
    ...(root.decompositionPlan ? { decompositionPlan: { ...root.decompositionPlan,
      goal: text(root.decompositionPlan.goal, 500)!, nodes: relevantPlan!.slice(0, 12) },
      planScope: { selection: "target_and_direct_children", totalNodes: root.decompositionPlan.nodes.length,
        excludedUnrelatedNodes: root.decompositionPlan.nodes.length - relevantPlan!.length } } : {}),
    parentRelationships: relationships,
    omissions: { directChildren: children.length - childSummaries.length, ancestors: ancestorIds.size - ancestorSummaries.length,
      siblings: siblings.length - siblingSummaries.length,
      planNodes: Math.max(0, (relevantPlan?.length ?? 0) - 12), relationships: relevantEdges.length - relationships.length,
      text: omittedText, cyclic: ancestorIds.has(target.id) }
  };
  // Bind full untruncated business/goal plus all graph semantics, not just excerpt text.
  context.contextHash = await kpiContentHash({ schema: context.schemaVersion, workspaceId: options.workspaceId, projectId: project.id,
    vdtId: options.vdtId, targetNodeId: target.id, graphFingerprint: context.graphFingerprint, period: options.period, goal: options.goal });
  // Optional distant context gives way to a bounded target/direct-child excerpt.
  while (new TextEncoder().encode(JSON.stringify(context)).byteLength > KPI_SUGGESTION_LIMITS.inputBytes - 4096) {
    if (context.siblings.pop()) context.omissions.siblings++;
    else if (context.ancestors.pop()) context.omissions.ancestors++;
    else if (context.children.pop()) context.omissions.directChildren++;
    else throw new Error("Smart target/context exceeds the bounded input limit.");
    const remaining = new Set([context.root.id, context.target.id, ...context.children.map(n => n.id), ...context.ancestors.map(n => n.id), ...context.siblings.map(n => n.id)]);
    const kept = context.parentRelationships.filter(e => remaining.has(e.parentNodeId) && remaining.has(e.childNodeId));
    context.omissions.relationships += context.parentRelationships.length - kept.length; context.parentRelationships = kept;
  }
  return validateKpiSuggestionContext(context);
}

export function kpiSuggestionCacheKey(context: KpiSuggestionContext, catalogVersion: string, execution?: KpiSuggestionExecutionIdentity): string {
  return kpiCanonicalJson({ schema: KPI_SUGGESTION_SCHEMA, validator: KPI_SUGGESTION_VALIDATOR,
    preparationVersion: KPI_SUGGESTION_PREPARATION_VERSION, catalogVersion,
    workspaceId: context.workspaceId, projectId: context.projectId, vdtId: context.vdtId, targetNodeId: context.targetNodeId,
    contextHash: context.contextHash, execution: execution ? { mode: execution.mode, backendId: execution.backendId,
      modelId: execution.modelId, bindingVersion: execution.bindingVersion, credentialEpoch: execution.credentialEpoch } : null });
}

export function smartMutationBlockReason(state: { pendingRevisionCommit: boolean; pendingSmartCommit: boolean; mutatingAgent: boolean }): string | undefined {
  if (state.pendingRevisionCommit || state.pendingSmartCommit) return "reconcile_pending_commit";
  if (state.mutatingAgent) return "mutating_agent_active";
  return undefined;
}
