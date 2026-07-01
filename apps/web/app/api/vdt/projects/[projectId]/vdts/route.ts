import { importProjectJson, type VdtProject } from "@vdt-studio/vdt-core";
import {
  buildStoredProjectSummary,
  generatedSafeId,
  jsonError,
  nonEmptyString,
  optionalRecord,
  parseSafeId,
  parseVdtStatus,
  readJsonObject
} from "../../../storage-response";
import { openVdtStorageDatabase } from "../../../storage-database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const parsedProjectId = parseSafeId(projectId, "projectId");
  if (!parsedProjectId.ok) return jsonError(parsedProjectId.message);

  const database = openVdtStorageDatabase(process.cwd());
  try {
    const project = database.getProject(parsedProjectId.value);
    if (!project) return jsonError("Project not found.", 404, "PROJECT_NOT_FOUND");
    const vdts = database.listVdts(project.id).map((vdt) => ({
      vdt,
      revisions: database.listVdtRevisions(vdt.id)
    }));
    return Response.json({ ok: true, project, vdts });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "VDTs could not be listed.", 500, "VDTS_LIST_FAILED");
  } finally {
    database.close();
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const parsedProjectId = parseSafeId(projectId, "projectId");
  if (!parsedProjectId.ok) return jsonError(parsedProjectId.message);

  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(request);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "VDT request could not be parsed.");
  }

  let snapshot: VdtProject | undefined;
  try {
    snapshot = body.project === undefined ? undefined : importProjectJson(JSON.stringify(body.project));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "VDT snapshot is invalid.");
  }

  const rootNode = snapshot?.graph.nodes.find((node) => node.id === snapshot?.rootNodeId);
  const rootKpi = nonEmptyString(body.rootKpi) ?? rootNode?.name ?? snapshot?.name;
  if (!rootKpi) return jsonError("VDT root KPI is required.");

  const name = nonEmptyString(body.name) ?? snapshot?.name ?? `${rootKpi} VDT`;
  const rawId = nonEmptyString(body.id);
  const vdtId = rawId ? parseSafeId(rawId, "vdtId") : { ok: true as const, value: generatedSafeId("vdt", name) };
  if (!vdtId.ok) return jsonError(vdtId.message);

  let status;
  try {
    status = parseVdtStatus(body.status);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "VDT status is invalid.");
  }

  const database = openVdtStorageDatabase(process.cwd());
  try {
    const project = database.getProject(parsedProjectId.value);
    if (!project) return jsonError("Project not found.", 404, "PROJECT_NOT_FOUND");
    if (database.getVdt(vdtId.value)) return jsonError("VDT already exists.", 409, "VDT_ALREADY_EXISTS");

    const vdt = database.createVdt({
      id: vdtId.value,
      projectId: project.id,
      name,
      rootKpi,
      unit: nonEmptyString(body.unit) ?? rootNode?.unit,
      timePeriod: nonEmptyString(body.timePeriod),
      status,
      metadata: optionalRecord(body.metadata)
    });
    const revision = snapshot
      ? database.saveVdtRevision({
          id: generatedSafeId("revision", `${vdt.id}_1`),
          projectId: project.id,
          vdtId: vdt.id,
          revisionNo: 1,
          source: "user",
          summary: "Initial VDT snapshot",
          project: snapshot
        })
      : undefined;
    return Response.json({
      ok: true,
      project,
      vdt: revision ? database.getVdt(vdt.id) ?? vdt : vdt,
      revision,
      summary: buildStoredProjectSummary(database, project)
    }, { status: 201 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "VDT could not be created.", 500, "VDT_CREATE_FAILED");
  } finally {
    database.close();
  }
}
