import {
  buildStoredProjectSummary,
  jsonError,
  nonEmptyString,
  optionalRecord,
  parseSafeId,
  parseVdtStatus,
  readJsonObject
} from "../../storage-response";
import { openVdtStorageDatabase } from "../../storage-database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ vdtId: string }> }) {
  const { vdtId } = await params;
  const parsedVdtId = parseSafeId(vdtId, "vdtId");
  if (!parsedVdtId.ok) return jsonError(parsedVdtId.message);

  const database = openVdtStorageDatabase(process.cwd());
  try {
    const vdt = database.getVdt(parsedVdtId.value);
    if (!vdt) return jsonError("VDT not found.", 404, "VDT_NOT_FOUND");
    const project = database.getProject(vdt.projectId);
    if (!project) return jsonError("Project not found.", 404, "PROJECT_NOT_FOUND");
    const revisions = database.listVdtRevisions(vdt.id);
    const activeRevision = revisions.find((revision) => revision.id === vdt.activeRevisionId) ?? revisions.at(-1);
    const activeProject = activeRevision ? database.readVdtRevision(activeRevision) : undefined;
    return Response.json({
      ok: true,
      project,
      summary: buildStoredProjectSummary(database, project),
      vdt,
      revisions,
      activeRevision,
      activeProject
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "VDT could not be loaded.", 500, "VDT_LOOKUP_FAILED");
  } finally {
    database.close();
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ vdtId: string }> }) {
  const { vdtId } = await params;
  const parsedVdtId = parseSafeId(vdtId, "vdtId");
  if (!parsedVdtId.ok) return jsonError(parsedVdtId.message);

  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(request);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "VDT request could not be parsed.");
  }

  let status;
  try {
    status = parseVdtStatus(body.status);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "VDT status is invalid.");
  }

  const database = openVdtStorageDatabase(process.cwd());
  try {
    const current = database.getVdt(parsedVdtId.value);
    if (!current) return jsonError("VDT not found.", 404, "VDT_NOT_FOUND");
    const vdt = database.updateVdt(parsedVdtId.value, {
      name: nonEmptyString(body.name) ?? current.name,
      rootKpi: nonEmptyString(body.rootKpi) ?? current.rootKpi,
      unit: body.unit === null ? undefined : nonEmptyString(body.unit) ?? current.unit,
      timePeriod: body.timePeriod === null ? undefined : nonEmptyString(body.timePeriod) ?? current.timePeriod,
      status: status ?? current.status,
      metadata: body.metadata === null ? undefined : optionalRecord(body.metadata) ?? current.metadata
    });
    const project = database.getProject(vdt.projectId);
    return Response.json({
      ok: true,
      vdt,
      summary: project ? buildStoredProjectSummary(database, project) : undefined
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "VDT could not be updated.", 500, "VDT_UPDATE_FAILED");
  } finally {
    database.close();
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ vdtId: string }> }) {
  const { vdtId } = await params;
  const parsedVdtId = parseSafeId(vdtId, "vdtId");
  if (!parsedVdtId.ok) return jsonError(parsedVdtId.message);

  const database = openVdtStorageDatabase(process.cwd());
  try {
    const deleted = database.deleteVdt(parsedVdtId.value);
    if (!deleted) return jsonError("VDT not found.", 404, "VDT_NOT_FOUND");
    return Response.json({ ok: true, deletedVdtId: parsedVdtId.value });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "VDT could not be deleted.", 500, "VDT_DELETE_FAILED");
  } finally {
    database.close();
  }
}
