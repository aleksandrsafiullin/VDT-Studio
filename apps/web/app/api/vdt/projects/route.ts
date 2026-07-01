import {
  buildStoredProjectSummary,
  generatedSafeId,
  jsonError,
  nonEmptyString,
  optionalRecord,
  parseSafeId,
  readJsonObject
} from "../storage-response";
import { openVdtStorageDatabase } from "../storage-database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const database = openVdtStorageDatabase(process.cwd());
  try {
    const projects = database.listProjects().map((project) => buildStoredProjectSummary(database, project));
    return Response.json({ ok: true, projects });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Stored projects could not be listed.", 500, "PROJECTS_LIST_FAILED");
  } finally {
    database.close();
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(request);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Project request could not be parsed.");
  }

  const name = nonEmptyString(body.name);
  if (!name) return jsonError("Project name is required.");

  const rawId = nonEmptyString(body.id);
  const projectId = rawId ? parseSafeId(rawId, "projectId") : { ok: true as const, value: generatedSafeId("project", name) };
  if (!projectId.ok) return jsonError(projectId.message);

  const database = openVdtStorageDatabase(process.cwd());
  try {
    if (database.getProject(projectId.value)) {
      return jsonError("Project already exists.", 409, "PROJECT_ALREADY_EXISTS");
    }
    const project = database.createProject({
      id: projectId.value,
      name,
      description: nonEmptyString(body.description),
      industry: nonEmptyString(body.industry),
      metadata: optionalRecord(body.metadata)
    });
    return Response.json({ ok: true, project, summary: buildStoredProjectSummary(database, project) }, { status: 201 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Project could not be created.", 500, "PROJECT_CREATE_FAILED");
  } finally {
    database.close();
  }
}
