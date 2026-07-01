import {
  buildStoredProjectSummary,
  jsonError,
  nonEmptyString,
  optionalRecord,
  parseSafeId,
  readJsonObject
} from "../../storage-response";
import { openVdtStorageDatabase } from "../../storage-database";

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
    return jsonError(error instanceof Error ? error.message : "Stored project could not be loaded.", 500, "PROJECT_LOOKUP_FAILED");
  } finally {
    database.close();
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

  const database = openVdtStorageDatabase(process.cwd());
  try {
    const current = database.getProject(parsedProjectId.value);
    if (!current) return jsonError("Project not found.", 404, "PROJECT_NOT_FOUND");
    const project = database.updateProject(parsedProjectId.value, {
      name: nonEmptyString(body.name) ?? current.name,
      description: body.description === null ? undefined : nonEmptyString(body.description) ?? current.description,
      industry: body.industry === null ? undefined : nonEmptyString(body.industry) ?? current.industry,
      metadata: body.metadata === null ? undefined : optionalRecord(body.metadata) ?? current.metadata
    });
    return Response.json({ ok: true, project, summary: buildStoredProjectSummary(database, project) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Project could not be updated.", 500, "PROJECT_UPDATE_FAILED");
  } finally {
    database.close();
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const parsedProjectId = parseSafeId(projectId, "projectId");
  if (!parsedProjectId.ok) return jsonError(parsedProjectId.message);

  const database = openVdtStorageDatabase(process.cwd());
  try {
    const deleted = database.deleteProject(parsedProjectId.value);
    if (!deleted) return jsonError("Project not found.", 404, "PROJECT_NOT_FOUND");
    return Response.json({ ok: true, deletedProjectId: parsedProjectId.value });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Project could not be deleted.", 500, "PROJECT_DELETE_FAILED");
  } finally {
    database.close();
  }
}
