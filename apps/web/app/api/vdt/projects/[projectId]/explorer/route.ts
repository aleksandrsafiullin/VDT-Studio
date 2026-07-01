import { buildStoredProjectSummary, jsonError, parseSafeId } from "../../../storage-response";
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
    return jsonError(error instanceof Error ? error.message : "Project explorer could not be loaded.", 500, "PROJECT_EXPLORER_FAILED");
  } finally {
    database.close();
  }
}
