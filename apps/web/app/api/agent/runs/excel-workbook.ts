import { createHash } from "node:crypto";
import { ExcelWorkbookScenarioError, resolveExcelWorkbookScenario } from "@vdt-studio/vdt-core";
import type { VdtDatabase } from "@vdt-studio/storage";
import { getExcelDownloadFilename } from "@/lib/download";

export class ExcelWorkbookError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
    this.name = "ExcelWorkbookError";
  }
}

interface ExcelWorkbookScope {
  runId: string;
  projectId: string | null | undefined;
  vdtId: string | null | undefined;
  revisionId: string | null | undefined;
  scenarioId?: string | null | undefined;
}

export function resolveSavedExcelWorkbook(database: VdtDatabase, scope: ExcelWorkbookScope,
  selectScenario?: (project: ReturnType<VdtDatabase["readVdtRevision"]>) => string | undefined
) {
  if (!scope.projectId || !scope.vdtId || !scope.revisionId) {
    throw new ExcelWorkbookError("EXCEL_SAVED_REVISION_REQUIRED", 409, "Save the VDT before exporting its workbook from chat.");
  }

  const run = database.getAgentRun(scope.runId);
  const vdt = database.getVdt(scope.vdtId);
  const revision = database.getVdtRevision(scope.revisionId);
  if (run?.projectId !== scope.projectId || run.vdtId !== scope.vdtId ||
      vdt?.projectId !== scope.projectId || revision?.vdtId !== scope.vdtId) {
    throw new ExcelWorkbookError("EXCEL_REVISION_UNAVAILABLE", 404, "The saved Excel revision is unavailable in this run's VDT.");
  }

  let project: ReturnType<VdtDatabase["readVdtRevision"]>;
  try {
    project = database.readVdtRevision(revision);
  } catch {
    throw new ExcelWorkbookError("EXCEL_REVISION_UNAVAILABLE", 404, "The saved Excel revision could not be read.");
  }

  const selected = selectScenario ? selectScenario(project) : scope.scenarioId;
  let scenarioId: string | null;
  try {
    scenarioId = resolveExcelWorkbookScenario(project, selected);
  } catch (error) {
    if (!(error instanceof ExcelWorkbookScenarioError)) throw error;
    throw new ExcelWorkbookError("EXCEL_SCENARIO_UNAVAILABLE", 404, error.message);
  }

  const key = JSON.stringify([scope.runId, scope.projectId, scope.vdtId, revision.id, scenarioId]);
  const id = `excel_${createHash("sha256").update(key).digest("hex")}`;
  const query = new URLSearchParams({ id, revisionId: revision.id });
  if (scenarioId !== null) query.set("scenarioId", scenarioId);
  const descriptor = {
    kind: "excel_workbook" as const,
    id,
    revisionId: revision.id,
    scenarioId,
    filename: getExcelDownloadFilename(Array.from(project.name).slice(0, 200).join("")),
    downloadUrl: `/api/agent/runs/${encodeURIComponent(scope.runId)}/excel-workbook?${query}`
  };
  return { descriptor, project };
}

/** The provider receives only the bounded descriptor. The host retains the snapshot and workbook bytes. */
export function describeExcelWorkbook(database: VdtDatabase, scope: ExcelWorkbookScope) {
  return resolveSavedExcelWorkbook(database, scope).descriptor;
}

export type ExcelWorkbookDescriptor = ReturnType<typeof describeExcelWorkbook>;

export function hasPersistedExcelDescriptor(snapshot: Record<string, unknown> | undefined, runId: string, descriptor: ExcelWorkbookDescriptor) {
  return Array.isArray(snapshot?.artifacts) && snapshot.artifacts.some(entry => {
    if (entry?.type !== "excel_workbook" || entry.runId !== runId || entry.id !== descriptor.id || !entry.payload
      || typeof entry.payload !== "object" || Object.keys(entry.payload).length !== Object.keys(descriptor).length) return false;
    return Object.entries(descriptor).every(([key, value]) => entry.payload[key] === value);
  });
}
