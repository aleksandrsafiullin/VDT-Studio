import { exportProjectExcel } from "../export/excel";
import type { VdtProject } from "../types";

export class ExcelWorkbookScenarioError extends Error {
  constructor() {
    super("The selected scenario is unavailable in this VDT snapshot.");
    this.name = "ExcelWorkbookScenarioError";
  }
}

export function resolveExcelWorkbookScenario(project: VdtProject, scenarioId?: string | null): string | null {
  if (!scenarioId) return project.scenarios[0]?.id ?? null;
  if (!project.scenarios.some((scenario) => scenario.id === scenarioId)) {
    throw new ExcelWorkbookScenarioError();
  }
  return scenarioId;
}

/** Use the supplied snapshot for both editable source inputs and the scenario calculation. */
export function createExcelWorkbook(project: VdtProject, scenarioId?: string | null): Uint8Array {
  return exportProjectExcel(project, { scenarioId: resolveExcelWorkbookScenario(project, scenarioId) ?? undefined });
}
