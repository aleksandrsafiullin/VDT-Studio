import { VdtStorageError } from "@vdt-studio/storage";
import {
  buildStoredProjectSummary,
  jsonError,
  parseSafeId
} from "../../../storage-response";
import { openVdtStorageDatabase } from "../../../storage-database";
import {
  createStorageWriteActor,
  parseCreateVdtWithInitialHttpRequest,
  storageWriteErrorResponse
} from "../../../storage-write-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const parsedProjectId = parseSafeId(projectId, "projectId");
  if (!parsedProjectId.ok) return jsonError(parsedProjectId.message);

  let database: ReturnType<typeof openVdtStorageDatabase> | undefined;
  try {
    database = openVdtStorageDatabase(process.cwd());
    const project = database.getProject(parsedProjectId.value);
    if (!project) return jsonError("Project not found.", 404, "PROJECT_NOT_FOUND");
    const summary = buildStoredProjectSummary(database, project);
    const currentDatabase = database;
    const vdts = currentDatabase.listVdts(project.id).map((vdt) => ({
      vdt,
      head: currentDatabase.getVdtRevisionHead(vdt.id),
      revisions: currentDatabase.listVdtRevisions(vdt.id)
    }));
    if (vdts.some((item) => item.head === null)) {
      throw new VdtStorageError(
        "VDT_REVISION_HEAD_MISSING",
        "A persisted VDT revision head is missing."
      );
    }
    return Response.json({
      ok: true,
      project,
      runtimeState: summary.runtimeState,
      summary,
      vdts
    });
  } catch (error) {
    return storageWriteErrorResponse(error, "VDTs could not be listed.");
  } finally {
    database?.close();
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const parsedProjectId = parseSafeId(projectId, "projectId");
  if (!parsedProjectId.ok) return jsonError(parsedProjectId.message);

  let actor;
  let body;
  try {
    actor = createStorageWriteActor(parsedProjectId.value);
    body = parseCreateVdtWithInitialHttpRequest(await request.json());
  } catch (error) {
    return storageWriteErrorResponse(error, "VDT request could not be parsed.");
  }

  let database: ReturnType<typeof openVdtStorageDatabase> | undefined;
  try {
    database = openVdtStorageDatabase(process.cwd());
    const result = database.createVdtWithInitialSnapshot({
      actor,
      command: {
        schemaVersion: "create_vdt_with_initial_snapshot.v1",
        projectId: parsedProjectId.value,
        expectedRuntimeGeneration: body.expectedRuntime.runtimeGeneration,
        expectedGenerationVersion: body.expectedRuntime.generationVersion,
        idempotencyKey: body.idempotencyKey,
        vdt: body.vdt,
        revisionIntent: {
          source: "user",
          summary: "Initial VDT snapshot",
          validation: null,
          calculation: null
        }
      },
      project: body.project
    });
    const project = database.getProject(parsedProjectId.value);
    if (!project) {
      throw new VdtStorageError("PROJECT_NOT_FOUND", "Project not found after initial VDT commit.");
    }
    const summary = buildStoredProjectSummary(database, project);
    return Response.json({
      schemaVersion: "create_vdt_with_initial_http_response.v1",
      ok: true,
      project,
      vdt: result.vdt,
      revision: result.revision,
      head: result.head,
      runtimeState: summary.runtimeState,
      summary
    }, { status: 201 });
  } catch (error) {
    return storageWriteErrorResponse(error, "VDT could not be created.");
  } finally {
    database?.close();
  }
}
