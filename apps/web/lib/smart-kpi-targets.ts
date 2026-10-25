import type { VdtProject } from "@vdt-studio/vdt-core";

/** Suggested incoming layers belong only to undecomposed Input KPIs.
 * Edges point from the KPI being explained to its incoming drivers. Context
 * children also count; a formula is already a decomposition even without edges.
 */
export function smartKpiTargetIds(project: Pick<VdtProject, "graph">): Set<string> {
  const parents = new Set(project.graph.edges.map(edge => edge.sourceNodeId));
  return new Set(project.graph.nodes.filter(node => node.type === "input" && node.status !== "rejected"
    && !node.formula?.trim() && !parents.has(node.id)).map(node => node.id));
}
