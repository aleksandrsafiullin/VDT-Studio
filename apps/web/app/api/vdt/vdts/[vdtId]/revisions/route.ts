import { VdtStorageError } from "@vdt-studio/storage";
import { buildStoredProjectSummary, jsonError, parseSafeId } from "../../../storage-response";
import { openVdtStorageDatabase } from "../../../storage-database";
import {
  createStorageWriteActor,
  parseManualVdtRevisionCommitRequest,
  resolveTrustedStorageWriteMode,
  storageWriteErrorResponse
} from "../../../storage-write-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ vdtId: string }> }) {
  const { vdtId } = await params;
  const parsedVdtId = parseSafeId(vdtId, "vdtId");
  if (!parsedVdtId.ok) return jsonError(parsedVdtId.message);

  let database: ReturnType<typeof openVdtStorageDatabase> | undefined;
  try {
    database = openVdtStorageDatabase(process.cwd());
    const vdt = database.getVdt(parsedVdtId.value);
    if (!vdt) return jsonError("VDT not found.", 404, "VDT_NOT_FOUND");
    const project = database.getProject(vdt.projectId);
    if (!project) return jsonError("Project not found.", 404, "PROJECT_NOT_FOUND");
    const head = database.getVdtRevisionHead(vdt.id);
    if (!head) {
      throw new VdtStorageError(
        "VDT_REVISION_HEAD_MISSING",
        `VDT revision head is missing for ${vdt.id}.`
      );
    }
    const runtimeState = database.getProjectRuntimeState(project.id);
    if (!runtimeState) {
      throw new VdtStorageError(
        "PROJECT_RUNTIME_STATE_MISSING",
        `Project runtime state is missing for ${project.id}.`
      );
    }
    return Response.json({
      schemaVersion: "vdt_revisions_response.v1",
      ok: true,
      vdt,
      revisions: database.listVdtRevisions(vdt.id),
      head,
      runtimeState
    });
  } catch (error) {
    return storageWriteErrorResponse(error, "VDT revisions could not be listed.");
  } finally {
    database?.close();
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ vdtId: string }> }) {
  const { vdtId } = await params;
  const parsedVdtId = parseSafeId(vdtId, "vdtId");
  if (!parsedVdtId.ok) return jsonError(parsedVdtId.message);

  if (!resolveTrustedStorageWriteMode()) {
    return storageWriteErrorResponse(new VdtStorageError(
      "HOSTED_REVISION_WRITES_DISABLED",
      "VDT revision writes are disabled outside an explicitly trusted local application mode."
    ));
  }

  let body;
  try {
    body = parseManualVdtRevisionCommitRequest(await request.json());
  } catch (error) {
    return storageWriteErrorResponse(error, "VDT revision request could not be parsed.");
  }

  let database: ReturnType<typeof openVdtStorageDatabase> | undefined;
  try {
    database = openVdtStorageDatabase(process.cwd());
    const vdt = database.getVdt(parsedVdtId.value);
    if (!vdt) return jsonError("VDT not found.", 404, "VDT_NOT_FOUND");
    const actor = createStorageWriteActor(vdt.projectId);
    const result = database.commitVdtRevision({
      projectId: vdt.projectId,
      vdtId: vdt.id,
      actor,
      command: {
        schemaVersion: "revision_commit.v2",
        expectedActiveRevisionId: body.expectedHead.activeRevisionId,
        expectedActiveContentIdentity: body.expectedHead.activeContentIdentity,
        expectedCommitGeneration: body.expectedHead.commitGeneration,
        expectedRuntimeGeneration: body.expectedRuntime.runtimeGeneration,
        expectedGenerationVersion: body.expectedRuntime.generationVersion,
        idempotencyKey: body.idempotencyKey,
        intent: {
          source: "user",
          summary: body.summary,
          validation: null,
          calculation: null
        }
      },
      project: body.project
    });
    const project = database.getProject(vdt.projectId);
    if (!project) {
      throw new VdtStorageError("PROJECT_NOT_FOUND", "Project not found after revision commit.");
    }
    const summary = buildStoredProjectSummary(database, project);
    const committedVdt = database.getVdt(vdt.id);
    if (!committedVdt) {
      throw new VdtStorageError("VDT_NOT_FOUND", "VDT not found after revision commit.");
    }
    return Response.json({
      schemaVersion: "manual_vdt_revision_commit_response.v1",
      ok: true,
      vdt: committedVdt,
      revision: result.revision,
      head: result.head,
      runtimeState: summary.runtimeState,
      summary
    }, { status: 201 });
  } catch (error) {
    return storageWriteErrorResponse(error, "VDT revision could not be saved.");
  } finally {
    database?.close();
  }
}
