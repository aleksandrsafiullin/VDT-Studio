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
import { storageWriteErrorResponse } from "../storage-write-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let database: ReturnType<typeof openVdtStorageDatabase> | undefined;
  try {
    database = openVdtStorageDatabase(process.cwd());
    const currentDatabase = database;
    const projects = currentDatabase.listProjects()
      .map((project) => buildStoredProjectSummary(currentDatabase, project));
    return Response.json({
      schemaVersion: "project_explorer_response.v1",
      ok: true,
      projects
    });
  } catch (error) {
    return storageWriteErrorResponse(error, "Stored projects could not be listed.");
  } finally {
    database?.close();
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

  let database: ReturnType<typeof openVdtStorageDatabase> | undefined;
  try {
    database = openVdtStorageDatabase(process.cwd());
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
    return Response.json({
      schemaVersion: "project_summary_response.v1",
      ok: true,
      summary: buildStoredProjectSummary(database, project)
    }, { status: 201 });
  } catch (error) {
    return storageWriteErrorResponse(error, "Project could not be created.");
  } finally {
    database?.close();
  }
}
