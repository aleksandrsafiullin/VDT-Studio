import { incomingKpiOptionsSchema, type DataDiscoveryRunSnapshot, type IncomingKpiOptions } from "@vdt-studio/data-harness";
import { validateStrictVdtProjectCommit } from "@vdt-studio/storage";
import type { VdtProject } from "@vdt-studio/vdt-core";
import { openVdtStorageDatabase } from "../vdt/storage-database";
import { jsonError } from "../vdt/storage-response";
import { resolveTrustedStorageWriteMode } from "../vdt/storage-write-adapter";
import { DataApiError, readDiscoveryProject, requireDataId, type DataOwner } from "./store";

export function requireLocalDataAccess(): void {
  if (!resolveTrustedStorageWriteMode()) {
    throw new DataApiError("File discovery is available only in an explicitly trusted local application mode.", 403, "HOSTED_DATA_INGESTION_DISABLED");
  }
}

/** Workspace ownership, VDT record identity and graph snapshot identity are separate. */
export function readDataOwner(input: Record<string, unknown>, required = true): DataOwner | undefined {
  requireLocalDataAccess();
  if (!required && input.projectId === undefined && input.vdtId === undefined) return undefined;
  const projectId = requireDataId(input.projectId, "projectId");
  const vdtId = requireDataId(input.vdtId, "vdtId");
  const database = openVdtStorageDatabase(process.cwd());
  try {
    if (!database.getProject(projectId)) throw new DataApiError("Project not found.", 404, "PROJECT_NOT_FOUND");
    const vdt = database.getVdt(vdtId);
    if (!vdt || vdt.projectId !== projectId) throw new DataApiError("VDT does not belong to this project.", 404, "DATA_OWNER_MISMATCH");
    let graphProjectId: string | undefined;
    if (vdt.activeRevisionId) {
      const revision = database.getVdtRevision(vdt.activeRevisionId);
      if (!revision || revision.vdtId !== vdt.id) throw new DataApiError("The selected VDT's active revision is unavailable.", 409, "DATA_PROJECT_CONTEXT_MISSING");
      graphProjectId = database.readVdtRevision(revision).id;
    }
    return { projectId, vdtId, dataDir: database.dataDir, ...(graphProjectId === undefined ? {} : { graphProjectId }) };
  } finally {
    database.close();
  }
}

export function ownerQuery(request: Request): Record<string, unknown> {
  const query = new URL(request.url).searchParams;
  return {
    ...(query.has("projectId") ? { projectId: query.get("projectId") } : {}),
    ...(query.has("vdtId") ? { vdtId: query.get("vdtId") } : {})
  };
}

export function readProject(value: unknown, owner?: DataOwner): VdtProject {
  try {
    validateStrictVdtProjectCommit(value);
  } catch {
    throw new DataApiError("A valid current VDT project snapshot is required.");
  }
  const project = value as VdtProject;
  if (owner && !owner.graphProjectId) {
    throw new DataApiError("Save an initial VDT revision before analyzing a source file.", 409, "DATA_PROJECT_CONTEXT_MISSING");
  }
  if (owner && project.id !== owner.graphProjectId) {
    throw new DataApiError("The VDT graph identity does not match the selected VDT's active revision.", 409, "DATA_PROJECT_SNAPSHOT_MISMATCH");
  }
  return project;
}

export function requireTarget(project: VdtProject, targetNodeId: unknown): string {
  const id = requireDataId(targetNodeId, "targetNodeId");
  if (!project.graph.nodes.some((node) => node.id === id)) {
    throw new DataApiError("The selected KPI was not found in the current VDT.", 409, "DATA_TARGET_NOT_FOUND");
  }
  return id;
}

export async function reviewProject(
  snapshot: DataDiscoveryRunSnapshot,
  owner: DataOwner | undefined,
  value: unknown,
  requireCurrent = false
): Promise<VdtProject> {
  const initial = await readDiscoveryProject(snapshot.runId, owner);
  if (!initial) throw new DataApiError("The analysis project context is missing. Analyze the retained source again.", 409, "DATA_PROJECT_CONTEXT_MISSING");
  const current = value === undefined && !requireCurrent ? initial : readProject(value, owner);
  const targetNodeId = snapshot.entryContext?.targetNodeId;
  if (targetNodeId) {
    requireTarget(current, targetNodeId);
    if (targetBasis(initial, targetNodeId) !== targetBasis(current, targetNodeId)) {
      throw new DataApiError("The selected KPI or its incoming structure changed after analysis. Analyze the retained source again.", 409, "DATA_TARGET_CHANGED");
    }
  }
  return initial;
}

function targetBasis(project: VdtProject, targetNodeId: string): string {
  const edges = project.graph.edges.filter((edge) => edge.sourceNodeId === targetNodeId);
  const adjacent = new Set(edges.flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId]));
  adjacent.add(targetNodeId);
  return JSON.stringify({
    nodes: project.graph.nodes.filter((node) => adjacent.has(node.id)).sort((a, b) => a.id.localeCompare(b.id)).map((node) => Object.fromEntries(Object.entries(node).filter(([key]) => key !== "position" && key !== "updatedAt"))),
    edges: [...edges].sort((a, b) => a.id.localeCompare(b.id))
  });
}

export function dataApiErrorResponse(error: unknown): Response {
  if (error instanceof DataApiError) return jsonError(error.message, error.status, error.code);
  if (error instanceof TypeError || error instanceof SyntaxError) return jsonError(error.message, 400, "INVALID_DATA_REQUEST");
  if (error instanceof Error && Object.hasOwn(error, "code") && (error as { code?: unknown }).code === "RATE_LIMITED") {
    return jsonError("The selected AI model or account has reached its usage limit. Choose another available model, or try again when access is available.", 429, "RATE_LIMITED");
  }
  return jsonError("The data operation could not be completed.", 500, "DATA_OPERATION_FAILED");
}

export async function readOptionalJsonObject(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text.trim()) return {};
  const value: unknown = JSON.parse(text);
  if (!record(value)) throw new DataApiError("Request body must be a JSON object.");
  return value;
}

/** Validate decisions before they reach the deterministic incoming-KPI compiler. */
export function readIncomingKpiOptions(value: unknown): IncomingKpiOptions | undefined {
  if (value === undefined) return undefined;
  const parsed = incomingKpiOptionsSchema.safeParse(value);
  if (!parsed.success) throw new DataApiError("The incoming KPI mapping options are invalid.");
  return parsed.data;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
