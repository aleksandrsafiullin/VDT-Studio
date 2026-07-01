import { importProjectJson } from "@vdt-studio/vdt-core";
import { generatedSafeId, jsonError, nonEmptyString, parseSafeId, readJsonObject } from "../../../storage-response";
import { openVdtStorageDatabase } from "../../../storage-database";

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
    return Response.json({
      ok: true,
      vdt,
      revisions: database.listVdtRevisions(vdt.id)
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "VDT revisions could not be listed.", 500, "VDT_REVISIONS_LIST_FAILED");
  } finally {
    database.close();
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ vdtId: string }> }) {
  const { vdtId } = await params;
  const parsedVdtId = parseSafeId(vdtId, "vdtId");
  if (!parsedVdtId.ok) return jsonError(parsedVdtId.message);

  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(request);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "VDT revision request could not be parsed.");
  }

  let project;
  try {
    project = importProjectJson(JSON.stringify(body.project));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "VDT revision project is invalid.");
  }

  const source = parseRevisionSource(body.source);
  if (!source) return jsonError("VDT revision source is invalid.");

  const database = openVdtStorageDatabase(process.cwd());
  try {
    const vdt = database.getVdt(parsedVdtId.value);
    if (!vdt) return jsonError("VDT not found.", 404, "VDT_NOT_FOUND");
    const revisions = database.listVdtRevisions(vdt.id);
    const nextRevisionNo = revisions.reduce((max, revision) => Math.max(max, revision.revisionNo), 0) + 1;
    const revision = database.saveVdtRevision({
      id: generatedSafeId("revision", `${vdt.id}_${nextRevisionNo}`),
      projectId: vdt.projectId,
      vdtId: vdt.id,
      revisionNo: nextRevisionNo,
      parentRevisionId: vdt.activeRevisionId,
      source,
      summary: nonEmptyString(body.summary),
      project,
      validation: body.validation,
      calculation: body.calculation
    });
    return Response.json({
      ok: true,
      vdt: database.getVdt(vdt.id) ?? vdt,
      revision
    }, { status: 201 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "VDT revision could not be saved.", 500, "VDT_REVISION_SAVE_FAILED");
  } finally {
    database.close();
  }
}

function parseRevisionSource(value: unknown) {
  if (value === undefined || value === null || value === "") return "user";
  if (value === "user" || value === "agent" || value === "import" || value === "scenario" || value === "repair") return value;
  return undefined;
}
