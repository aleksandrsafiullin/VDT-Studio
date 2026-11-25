import { calculateGraph } from "../formula/calculate";
import type { VdtProject } from "../types";

export function readableFormula(project: VdtProject, nodeId: string): string {
  const formula = project.graph.nodes.find((node) => node.id === nodeId)?.formula?.trim();
  if (!formula) return "Input value";
  const names = new Map(project.graph.nodes.map((node) => [node.id, node.name]));
  return formula.replace(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, (id) => names.has(id) ? `“${names.get(id)}”` : id);
}

export interface VersionNodeChange {
  nodeId: string;
  name: string;
  path: string;
  kind: "added" | "removed" | "changed";
  beforeValue?: number | undefined;
  afterValue?: number | undefined;
  beforeUnit?: string | undefined;
  afterUnit?: string | undefined;
  beforeFormula: string;
  afterFormula: string;
  formulaChanged: boolean;
  details: string[];
}

function nodePath(project: VdtProject, nodeId: string): string {
  const names = new Map(project.graph.nodes.map((node) => [node.id, node.name]));
  const parents = new Map(project.graph.edges.map((edge) => [edge.targetNodeId, edge.sourceNodeId]));
  const seen = new Set([nodeId]);
  const path: string[] = [];
  let parentId = parents.get(nodeId);
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    path.unshift(names.get(parentId) ?? "KPI");
    parentId = parents.get(parentId);
  }
  return path.join(" / ");
}

/** Include edits even when the calculated number happens to be unchanged. */
export function versionNodeChanges(before: VdtProject, current: VdtProject): VersionNodeChange[] {
  return compareVersionProjects(before, current).changes;
}

export function compareVersionProjects(before: VdtProject, current: VdtProject) {
  const beforeNodes = new Map(before.graph.nodes.map((node) => [node.id, node]));
  const afterNodes = new Map(current.graph.nodes.map((node) => [node.id, node]));
  const beforeCalculation = calculateGraph(before);
  const afterCalculation = calculateGraph(current);
  const beforeValues = beforeCalculation.values;
  const afterValues = afterCalculation.values;
  const changes: VersionNodeChange[] = [];
  for (const id of new Set([...beforeNodes.keys(), ...afterNodes.keys()])) {
    const left = beforeNodes.get(id);
    const right = afterNodes.get(id);
    const beforeValue = beforeValues[id];
    const afterValue = afterValues[id];
    const formulaChanged = (left?.formula?.trim() ?? "") !== (right?.formula?.trim() ?? "");
    const details: string[] = [];
    if (left && right) {
      if (left.name !== right.name) details.push(`Name: “${left.name}” → “${right.name}”`);
      if (left.unit !== right.unit) details.push("Units changed");
      if (left.type !== right.type) details.push("KPI type changed");
      if (left.description !== right.description) details.push("Description changed");
      if (left.status !== right.status) details.push("Status changed");
      if (left.fixedInScenario !== right.fixedInScenario) details.push("Scenario lock changed");
      if (left.goalSeek?.targetNodeId !== right.goalSeek?.targetNodeId || left.goalSeek?.targetValue !== right.goalSeek?.targetValue) details.push("Back-calculation settings changed");
      const relations = (project: VdtProject) => project.graph.edges.filter((edge) => edge.targetNodeId === id)
        .map((edge) => `${edge.sourceNodeId}:${edge.relation}`).sort().join("|");
      if (relations(before) !== relations(current)) details.push("Connections changed");
    }
    const valuesChanged = beforeValue !== afterValue &&
      (beforeValue === undefined || afterValue === undefined || Math.abs(beforeValue - afterValue) > 1e-9);
    if (left && right && !valuesChanged && !formulaChanged && details.length === 0) continue;
    changes.push({
      nodeId: id, name: right?.name ?? left?.name ?? "KPI", path: nodePath(right ? current : before, id),
      kind: !left ? "added" : !right ? "removed" : "changed",
      beforeValue, afterValue, beforeUnit: left?.unit, afterUnit: right?.unit,
      beforeFormula: readableFormula(before, id), afterFormula: readableFormula(current, id),
      formulaChanged: Boolean(left && right && formulaChanged), details
    });
  }
  const beforeRoot = beforeNodes.get(before.rootNodeId);
  const afterRoot = afterNodes.get(current.rootNodeId);
  const beforeValue = beforeCalculation.rootValue;
  const afterValue = afterCalculation.rootValue;
  const comparable = beforeRoot?.id === afterRoot?.id && beforeRoot?.name === afterRoot?.name &&
    beforeRoot?.unit === afterRoot?.unit && beforeRoot?.formula === afterRoot?.formula;
  const delta = comparable && beforeValue !== undefined && afterValue !== undefined ? afterValue - beforeValue : undefined;
  return {
    root: {
      before: { name: beforeRoot?.name, unit: beforeRoot?.unit, value: beforeValue },
      after: { name: afterRoot?.name, unit: afterRoot?.unit, value: afterValue },
      comparable,
      delta
    },
    changes: changes.sort((a, b) => `${a.path}/${a.name}`.localeCompare(`${b.path}/${b.name}`, "en")),
    scenariosChanged: JSON.stringify(before.scenarios) !== JSON.stringify(current.scenarios),
    dataSourcesChanged: JSON.stringify(before.dataSources) !== JSON.stringify(current.dataSources)
  };
}
