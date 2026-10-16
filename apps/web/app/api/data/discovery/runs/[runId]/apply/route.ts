import { reanalyzeDiscoveryWithUserEdits, validateDiscoveryApply } from "@vdt-studio/data-harness";
import { jsonError } from "../../../../../vdt/storage-response";
import { dataApiErrorResponse, readDataOwner, readOptionalJsonObject, reviewProject } from "../../../../request-context";
import { DataApiError, readDatasetFile, readDiscoveryRun, requireDataId, saveDiscoveryRun } from "../../../../store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Validate and stage a normal change preview; this endpoint never commits a graph revision. */
export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await params;
    requireDataId(runId, "runId");
    const body = await readOptionalJsonObject(request);
    const owner = readDataOwner(body, false);
    let snapshot = await readDiscoveryRun(runId, owner);
    if (!snapshot) return jsonError("Discovery run was not found.", 404, "DATA_DISCOVERY_RUN_NOT_FOUND");
    const file = await readDatasetFile(snapshot.datasetId, owner);
    if (!file || file.metadata.contentHash !== snapshot.file.contentHash) throw new DataApiError("The retained source does not match this discovery run.", 409, "DATA_SOURCE_INTEGRITY_FAILED");
    if (snapshot.incomingKpi) {
      const project = await reviewProject(snapshot, owner, body.project, Boolean(owner));
      snapshot = await reanalyzeDiscoveryWithUserEdits({ datasetId: snapshot.datasetId, file: file.metadata, bytes: file.bytes, project, entryContext: snapshot.entryContext }, snapshot, {});
    }
    const validationResults = validateDiscoveryApply(snapshot);
    const blocking = validationResults.filter((result) => result.status === "error");
    const updatedAt = new Date().toISOString();
    const next = {
      ...snapshot,
      ...(owner ? { workspaceProjectId: owner.projectId, vdtId: owner.vdtId } : {}),
      validationResults,
      status: blocking.length ? (snapshot.incomingKpi ? "needs_user_input" as const : "failed" as const) : "succeeded" as const,
      phase: blocking.length ? "change_set_validation" as const : "completed" as const,
      updatedAt,
      events: [...snapshot.events, {
        id: `event_${snapshot.events.length + 1}`,
        phase: blocking.length ? "change_set_validation" as const : "completed" as const,
        message: blocking.length ? "Staging was blocked because deterministic validation or required decisions failed." : "Discovery change-set passed server validation and is ready for the normal VDT change preview.",
        createdAt: updatedAt
      }]
    };
    await saveDiscoveryRun(next, owner);
    if (blocking.length) return Response.json({
      ok: false,
      error: { code: "DATA_DISCOVERY_VALIDATION_FAILED", message: blocking[0]?.message ?? "Discovery validation failed." },
      validationResults, snapshot: next
    }, { status: 422 });
    return Response.json({ ok: true, snapshot: next, changeSet: next.changeSetPreview, validationResults });
  } catch (error) { return dataApiErrorResponse(error); }
}
