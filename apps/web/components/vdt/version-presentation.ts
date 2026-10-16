import { calculateGraph, type VdtAiTaskType, type VdtProject, type VdtVersion } from "@vdt-studio/vdt-core";

const TASK_NAMES: Partial<Record<VdtAiTaskType, string>> = {
  analyze_raw_dataset: "импортом данных",
  review_dataset_proposal: "изменением привязки данных",
  generate_tree: "созданием дерева",
  deepen_node: "добавлением показателей",
  simplify_branch: "упрощением ветки",
  suggest_alternative: "изменением структуры",
  suggest_formula: "изменением формулы",
  review_model: "проверкой модели",
  check_units: "проверкой единиц",
  identify_missing_drivers: "добавлением недостающих показателей",
  identify_duplicate_drivers: "проверкой дубликатов"
};

export function changeSnapshotName(taskType: VdtAiTaskType): string {
  return `Перед ${TASK_NAMES[taskType] ?? "изменением модели"}`;
}

/** Present old snapshots without rewriting user-authored names. */
export function versionDisplayName(version: VdtVersion): string {
  const legacy = /^Before ([a-z_]+) apply$/.exec(version.name);
  return legacy ? changeSnapshotName((version.taskType ?? legacy[1]) as VdtAiTaskType) : version.name;
}

export function formatVersionDate(createdAt: string): string {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? createdAt : new Intl.DateTimeFormat("ru", {
    dateStyle: "medium", timeStyle: "short"
  }).format(date);
}

export function readableFormula(project: VdtProject, nodeId: string): string {
  const formula = project.graph.nodes.find((node) => node.id === nodeId)?.formula?.trim();
  if (!formula) return "Введённое значение";
  const names = new Map(project.graph.nodes.map((node) => [node.id, node.name]));
  return formula.replace(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, (id) => names.has(id) ? `«${names.get(id)}»` : id);
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
    path.unshift(names.get(parentId) ?? "Показатель");
    parentId = parents.get(parentId);
  }
  return path.join(" / ");
}

/** Include edits even when the calculated number happens to be unchanged. */
export function versionNodeChanges(before: VdtProject, current: VdtProject): VersionNodeChange[] {
  const beforeNodes = new Map(before.graph.nodes.map((node) => [node.id, node]));
  const afterNodes = new Map(current.graph.nodes.map((node) => [node.id, node]));
  const beforeValues = calculateGraph(before).values;
  const afterValues = calculateGraph(current).values;
  const changes: VersionNodeChange[] = [];
  for (const id of new Set([...beforeNodes.keys(), ...afterNodes.keys()])) {
    const left = beforeNodes.get(id);
    const right = afterNodes.get(id);
    const beforeValue = beforeValues[id];
    const afterValue = afterValues[id];
    const formulaChanged = (left?.formula?.trim() ?? "") !== (right?.formula?.trim() ?? "");
    const details: string[] = [];
    if (left && right) {
      if (left.name !== right.name) details.push(`Название: «${left.name}» → «${right.name}»`);
      if (left.unit !== right.unit) details.push("Изменены единицы");
      if (left.type !== right.type) details.push("Изменён тип показателя");
      if (left.description !== right.description) details.push("Изменено описание");
      if (left.status !== right.status) details.push("Изменён статус");
      if (left.fixedInScenario !== right.fixedInScenario) details.push("Изменена фиксация в сценарии");
      const relations = (project: VdtProject) => project.graph.edges.filter((edge) => edge.targetNodeId === id)
        .map((edge) => `${edge.sourceNodeId}:${edge.relation}`).sort().join("|");
      if (relations(before) !== relations(current)) details.push("Изменены связи");
    }
    const valuesChanged = beforeValue !== afterValue &&
      (beforeValue === undefined || afterValue === undefined || Math.abs(beforeValue - afterValue) > 1e-9);
    if (left && right && !valuesChanged && !formulaChanged && details.length === 0) continue;
    changes.push({
      nodeId: id, name: right?.name ?? left?.name ?? "Показатель", path: nodePath(right ? current : before, id),
      kind: !left ? "added" : !right ? "removed" : "changed",
      beforeValue, afterValue, beforeUnit: left?.unit, afterUnit: right?.unit,
      beforeFormula: readableFormula(before, id), afterFormula: readableFormula(current, id),
      formulaChanged: Boolean(left && right && formulaChanged), details
    });
  }
  return changes.sort((a, b) => `${a.path}/${a.name}`.localeCompare(`${b.path}/${b.name}`, "ru"));
}
