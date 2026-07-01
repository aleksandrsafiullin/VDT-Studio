import { jsonError, parseSafeId } from "../../../storage-response";
import { openVdtStorageDatabase } from "../../../storage-database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const parsedProjectId = parseSafeId(projectId, "projectId");
  if (!parsedProjectId.ok) return jsonError(parsedProjectId.message);

  const database = openVdtStorageDatabase(process.cwd());
  try {
    if (!database.getProject(parsedProjectId.value)) {
      return jsonError("Project not found.", 404, "PROJECT_NOT_FOUND");
    }
    return Response.json({
      ok: true,
      comparisons: database.listComparisons(parsedProjectId.value)
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Project comparisons could not be listed.", 500, "PROJECT_COMPARISONS_FAILED");
  } finally {
    database.close();
  }
}
