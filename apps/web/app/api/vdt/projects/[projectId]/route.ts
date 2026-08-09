import {
  buildStoredProjectSummary,
  jsonError,
  nonEmptyString,
  optionalRecord,
  parseSafeId,
  readJsonObject
} from "../../storage-response";
import { openVdtStorageDatabase } from "../../storage-database";
import { storageWriteErrorResponse } from "../../storage-write-adapter";

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

    const currentDatabase = database;
    const vdts = currentDatabase.listVdts(project.id).map((vdt) => ({
      vdt,
      revisions: currentDatabase.listVdtRevisions(vdt.id)
    }));
    return Response.json({
      ok: true,
      summary: buildStoredProjectSummary(database, project),
      project,
      vdts,
      conversations: database.listConversations(project.id),
      agentRuns: database.listAgentRuns(project.id),
      mutationProposals: database.listProjectMutationProposals(project.id),
      comparisons: database.listComparisons(project.id)
    });
  } catch (error) {
    return storageWriteErrorResponse(error, "Stored project could not be loaded.");
  } finally {
    database?.close();
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const parsedProjectId = parseSafeId(projectId, "projectId");
  if (!parsedProjectId.ok) return jsonError(parsedProjectId.message);

  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(request);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Project request could not be parsed.");
  }

  let database: ReturnType<typeof openVdtStorageDatabase> | undefined;
  try {
    database = openVdtStorageDatabase(process.cwd());
    const current = database.getProject(parsedProjectId.value);
    if (!current) return jsonError("Project not found.", 404, "PROJECT_NOT_FOUND");
    const project = database.updateProject(parsedProjectId.value, {
      name: nonEmptyString(body.name) ?? current.name,
      description: body.description === null ? undefined : nonEmptyString(body.description) ?? current.description,
      industry: body.industry === null ? undefined : nonEmptyString(body.industry) ?? current.industry,
      metadata: body.metadata === null ? undefined : optionalRecord(body.metadata) ?? current.metadata
    });
    return Response.json({
      schemaVersion: "project_summary_response.v1",
      ok: true,
      summary: buildStoredProjectSummary(database, project)
    });
  } catch (error) {
    return storageWriteErrorResponse(error, "Project could not be updated.");
  } finally {
    database?.close();
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const parsedProjectId = parseSafeId(projectId, "projectId");
  if (!parsedProjectId.ok) return jsonError(parsedProjectId.message);

  let database: ReturnType<typeof openVdtStorageDatabase> | undefined;
  try {
    database = openVdtStorageDatabase(process.cwd());
    const deleted = database.deleteProject(parsedProjectId.value);
    if (!deleted) return jsonError("Project not found.", 404, "PROJECT_NOT_FOUND");
    return Response.json({ ok: true, deletedProjectId: parsedProjectId.value });
  } catch (error) {
    return storageWriteErrorResponse(error, "Project could not be deleted.");
  } finally {
    database?.close();
  }
}
