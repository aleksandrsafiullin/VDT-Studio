import type { VdtAiTaskType, VdtVersion } from "../types";

const TASK_NAMES: Partial<Record<VdtAiTaskType, string>> = {
  analyze_raw_dataset: "data import",
  review_dataset_proposal: "data mapping changes",
  generate_tree: "tree creation",
  deepen_node: "adding drivers",
  simplify_branch: "branch simplification",
  suggest_alternative: "structure changes",
  suggest_formula: "formula changes",
  review_model: "model review",
  check_units: "unit checks",
  identify_missing_drivers: "adding missing drivers",
  identify_duplicate_drivers: "duplicate checks"
};

// Compatibility with automatic names saved by the first Versions panel.
const LEGACY_TASK_NAMES: Partial<Record<VdtAiTaskType, string>> = {
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
  return `Before ${TASK_NAMES[taskType] ?? "model changes"}`;
}

function legacyGeneratedName(name: string): string {
  const task = Object.entries(LEGACY_TASK_NAMES).find(([, label]) => name === `Перед ${label}`)?.[0];
  if (task) return changeSnapshotName(task as VdtAiTaskType);
  if (name === "Перед изменением модели") return "Before model changes";
  const backup = /^Перед восстановлением «(.*)»$/.exec(name);
  return backup ? `Before restoring “${legacyGeneratedName(backup[1]!)}”` : name;
}

/** Present old snapshots without rewriting user-authored names. */
export function versionDisplayName(version: VdtVersion): string {
  const legacy = /^Before ([a-z_]+) apply$/.exec(version.name);
  if (legacy) return changeSnapshotName((version.taskType ?? legacy[1]) as VdtAiTaskType);
  if (version.taskType && version.name === `Перед ${LEGACY_TASK_NAMES[version.taskType] ?? "изменением модели"}`) {
    return changeSnapshotName(version.taskType);
  }
  if (version.description === "Состояние до восстановления. Выберите эту версию, чтобы вернуться к нему.") {
    return legacyGeneratedName(version.name);
  }
  return version.name;
}
