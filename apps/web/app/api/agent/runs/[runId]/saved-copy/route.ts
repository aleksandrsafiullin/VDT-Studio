import { createHash } from "node:crypto";
import { validateStrictVdtProjectCommit } from "@vdt-studio/storage";
import { openVdtStorageDatabase } from "../../../../vdt/storage-database";
import { jsonError, parseSafeId } from "../../../../vdt/storage-response";
import { createStorageWriteActor, storageWriteErrorResponse } from "../../../../vdt/storage-write-adapter";

import { requireLocalFileRequest } from "../../../../data/request-context";
import { DataApiError, stageSavedCopyDatasetLinks } from "../../../../data/store";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const run = parseSafeId((await params).runId, "runId");
  if (!run.ok) return jsonError(run.message);
  let db: ReturnType<typeof openVdtStorageDatabase> | undefined;
  try {
    requireLocalFileRequest(request);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body.projectId !== "string" || typeof body.vdtId !== "string" || typeof body.revisionId !== "string") {
      return jsonError("A saved VDT revision is required.", 400, "SAVED_COPY_REVISION_REQUIRED");
    }
    const actor = createStorageWriteActor(body.projectId);
    db = openVdtStorageDatabase(process.cwd());
    const database = db;
    const record = db.getAgentRun(run.value);
    const source = db.getVdt(body.vdtId);
    const revision = db.getVdtRevision(body.revisionId);
    const projectRuntime = db.getProjectRuntimeState(body.projectId);
    if (!record || record.projectId !== body.projectId || record.vdtId !== body.vdtId
      || source?.projectId !== body.projectId || revision?.vdtId !== source.id || !projectRuntime) {
      return jsonError("The run has no matching saved revision to copy.", 404, "SAVED_COPY_SOURCE_NOT_FOUND");
    }
    const project = db.readVdtRevision(revision);
    const sourceContent = validateStrictVdtProjectCommit(project).contentIdentity.hash;
    const root = project.graph.nodes.find(node => node.id === project.rootNodeId);
    const key = createHash("sha256").update(JSON.stringify([run.value, source.projectId, source.id, revision.id])).digest("hex");
    const copyId = `vdt_saved_copy_${key}`;
    const idempotencyKey = `saved-copy:${key}`;
    const readExisting = () => {
      const existing = database.getVdt(copyId);
      if (!existing) return undefined;
      const receipt = database.getCommittedVdtCreation(source.projectId, actor.principalId, idempotencyKey);
      const initial = receipt && database.getVdtRevision(receipt.revision.id);
      if (existing.projectId !== source.projectId || receipt?.vdt.id !== existing.id
        || receipt.vdt.projectId !== source.projectId || initial?.vdtId !== existing.id
        || initial.revisionNo !== 1 || initial.graphHash !== receipt.revision.graphHash
        || validateStrictVdtProjectCommit(database.readVdtRevision(initial)).contentIdentity.hash !== sourceContent) {
        return jsonError("The saved copy identity could not be verified.", 409, "SAVED_COPY_IDENTITY_CONFLICT");
      }
      return Response.json({ ok: true, vdtId: existing.id });
    };
    const existing = readExisting();
    if (existing) return existing;
    try {
      await stageSavedCopyDatasetLinks({ dataDir: db.dataDir, projectId: source.projectId, vdtId: source.id }, copyId, project);
    } catch (error) {
      const concurrent = readExisting();
      if (concurrent) return concurrent;
      throw error;
    }
    const concurrent = readExisting();
    if (concurrent) return concurrent;
    const copy = db.createVdtWithInitialSnapshot({
      actor,
      command: {
        schemaVersion: "create_vdt_with_initial_snapshot.v1",
        projectId: source.projectId,
        expectedRuntimeGeneration: projectRuntime.runtimeGeneration,
        expectedGenerationVersion: projectRuntime.generationVersion,
        idempotencyKey,
        vdt: {
          requestedVdtId: copyId,
          name: `${project.name.slice(0, 220)} (saved copy)`,
          rootKpi: root?.name ?? project.name,
          unit: root?.unit ?? null,
          timePeriod: null, status: "draft",
          metadata: { source: "interrupted_run_saved_copy", sourceVdtId: source.id, sourceRevisionId: revision.id, sourceRunId: run.value }
        },
        revisionIntent: { source: "user", summary: "Copy of saved VDT revision", validation: null, calculation: null }
      },
      project
    });
    return Response.json({ ok: true, vdtId: copy.vdt.id });
  } catch (error) {
    if (error instanceof DataApiError) return jsonError(error.message, error.status, error.code);
    return storageWriteErrorResponse(error, "The saved VDT could not be copied.");
  } finally {
    db?.close();
  }
}
