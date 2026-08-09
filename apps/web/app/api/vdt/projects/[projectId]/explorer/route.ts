import { buildStoredProjectSummary, jsonError, parseSafeId } from "../../../storage-response";
import { openVdtStorageDatabase } from "../../../storage-database";
import { storageWriteErrorResponse } from "../../../storage-write-adapter";

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
    const comparisons = database.listComparisons(project.id);
    const recentRuns = database.listAgentRuns(project.id).slice(0, 5);
    const pendingProposals = database.listProjectMutationProposals(project.id).filter((proposal) =>
      proposal.status === "proposed" || proposal.status === "approved"
    );
    return Response.json({
      ok: true,
      summary,
      comparisons,
      recentRuns,
      pendingProposals
    });
  } catch (error) {
    return storageWriteErrorResponse(error, "Project explorer could not be loaded.");
  } finally {
    database?.close();
  }
}
