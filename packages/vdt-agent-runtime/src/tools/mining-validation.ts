import { warning, type VdtProject, type VdtWarning } from "@vdt-studio/vdt-core";
import type { VdtAgentRunState } from "../types";

export function validateMiningProject(
  state: VdtAgentRunState,
  project: VdtProject
): { valid: boolean; errors: VdtWarning[]; warnings: VdtWarning[] } {
  const errors: VdtWarning[] = [];
  const warnings: VdtWarning[] = [];
  const selectedSkillIds = new Set(state.selectedSkills.map((skill) => skill.id));
  if (![...selectedSkillIds].some((skillId) => skillId.startsWith("mining."))) {
    return { valid: true, errors, warnings };
  }

  const nodesById = new Map(project.graph.nodes.map((node) => [node.id, node]));
  const root = nodesById.get(project.rootNodeId);
  const rootKey = normalize(`${root?.id ?? ""} ${root?.name ?? ""}`);

  if (selectedSkillIds.has("mining.mine_production_system")) {
    const additiveStageIssue = project.graph.nodes.find((node) =>
      hasAdditiveSequentialStageFormula(node.formula) &&
      !hasBufferOrStockpileSignal(project)
    );
    if (additiveStageIssue) {
      errors.push(miningWarning(
        "sequential_stage_addition",
        "Sequential mining stage capacities must not be added together unless explicit stockpile or buffer logic exists.",
        additiveStageIssue.id
      ));
    }
  }

  const oreWasteIssue = project.graph.nodes.find((node) =>
    hasOreWasteSum(node.formula) &&
    !/totalmaterial|materialmoved|wastemoved|stripratio/.test(rootKey)
  );
  if (oreWasteIssue) {
    errors.push(miningWarning(
      "ore_waste_product_scope",
      "Ore tonnes and waste tonnes must not be summed into a product KPI unless the root KPI is total material moved.",
      oreWasteIssue.id
    ));
  }

  if (selectedSkillIds.has("mining.excavation")) {
    validateExcavationBoundary(project, errors);
  }

  if (selectedSkillIds.has("mining.underground_production_cycle") && hasOpenPitOnlyChain(project) && !hasUndergroundSignal(project)) {
    errors.push(miningWarning(
      "underground_forced_open_pit",
      "Underground operation must not be forced into an open-pit-only stage chain.",
      project.rootNodeId
    ));
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateExcavationBoundary(project: VdtProject, errors: VdtWarning[]): void {
  const childrenByParent = childrenByParentId(project);
  const downtimeChildren = new Set(childrenByParent.get("downtime_per_excavator_h") ?? []);
  for (const node of project.graph.nodes) {
    const key = normalize(`${node.id} ${node.name}`);
    if (/(material|face|access|safety|geotechnical).*readiness|restrictedaccess|facenotready/.test(key) && !downtimeChildren.has(node.id)) {
      errors.push(miningWarning(
        `excavation_readiness_downtime_${node.id}`,
        "Excavation readiness/access restrictions must stay under downtime.",
        node.id
      ));
    }
  }

  const productivityDescendants = descendantsOf(project, "excavator_productivity");
  for (const nodeId of productivityDescendants) {
    const node = project.graph.nodes.find((candidate) => candidate.id === nodeId);
    const key = normalize(`${node?.id ?? ""} ${node?.name ?? ""}`);
    if (/haulroute|dispatch|queue|dump|crusher|processing|loadedtravel|emptyreturn/.test(key)) {
      errors.push(miningWarning(
        `excavation_haulage_boundary_${nodeId}`,
        "Excavation productivity must not contain haul route cycle, dispatch, queueing, dumping or processing nodes.",
        nodeId
      ));
    }
  }
}

function hasAdditiveSequentialStageFormula(formula: string | undefined): boolean {
  const normalized = normalizeFormula(formula);
  if (!normalized.includes("+")) return false;
  const stageHits = [
    "blockpreparation",
    "drillandblast",
    "excavation",
    "loading",
    "haulage",
    "dump",
    "crusher",
    "hoisting"
  ].filter((term) => normalized.includes(term));
  return stageHits.length >= 2;
}

function hasOreWasteSum(formula: string | undefined): boolean {
  const normalized = normalizeFormula(formula);
  return normalized.includes("+") && /ore.*waste|waste.*ore/.test(normalized);
}

function hasBufferOrStockpileSignal(project: VdtProject): boolean {
  return project.graph.nodes.some((node) => /stockpile|buffer|inventory/.test(normalize(`${node.id} ${node.name}`)));
}

function hasOpenPitOnlyChain(project: VdtProject): boolean {
  return project.graph.nodes.some((node) => /openpit|bench|blockpreparation|dozer|truckhaulage/.test(normalize(`${node.id} ${node.name}`)));
}

function hasUndergroundSignal(project: VdtProject): boolean {
  return project.graph.nodes.some((node) => /underground|stope|development|ventilation|hoist|groundsupport|backfill|lhd/.test(normalize(`${node.id} ${node.name}`)));
}

function childrenByParentId(project: VdtProject): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const edge of project.graph.edges) {
    children.set(edge.sourceNodeId, [...(children.get(edge.sourceNodeId) ?? []), edge.targetNodeId]);
  }
  return children;
}

function descendantsOf(project: VdtProject, nodeId: string): Set<string> {
  const children = childrenByParentId(project);
  const descendants = new Set<string>();
  const queue = [...(children.get(nodeId) ?? [])];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (descendants.has(current)) continue;
    descendants.add(current);
    queue.push(...(children.get(current) ?? []));
  }
  return descendants;
}

function miningWarning(id: string, message: string, nodeId: string): VdtWarning {
  return warning({
    id: `mining_${id}`,
    severity: "error",
    type: "invalid_graph",
    message,
    nodeId
  });
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeFormula(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/_/g, "")
    .replace(/\s+/g, "");
}
