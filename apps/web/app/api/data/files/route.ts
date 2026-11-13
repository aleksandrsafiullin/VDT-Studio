import { createHash, randomUUID } from "node:crypto";
import { jsonError } from "../../vdt/storage-response";
import { dataApiErrorResponse, ownerQuery, readDatasetFileOwner, requireLocalFileRequest } from "../request-context";
import { listLibraryDatasetFiles, saveDatasetFile, sourceDownloadUrl } from "../store";
import { MAX_UPLOAD_BYTES, readBoundedMultipart } from "../bounded-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uploadKey = Symbol.for("vdt.data-upload.active.v1");
const uploadGlobal = globalThis as typeof globalThis & { [uploadKey]?: { active: number } };
const uploads = uploadGlobal[uploadKey] ??= { active: 0 };

export async function POST(request: Request) {
  let admitted = false;
  try {
    requireLocalFileRequest(request);
    if (uploads.active >= 2) {
      void request.body?.cancel().catch(() => {});
      return jsonError("Two uploads are already in progress. Wait for one to finish, then retry.", 429, "DATA_UPLOAD_BUSY");
    }
    uploads.active += 1;
    admitted = true;
    const formData = await readBoundedMultipart(request);
    const owner = readDatasetFileOwner({ projectId: formData.get("projectId"), ...(formData.has("vdtId") ? { vdtId: formData.get("vdtId") } : {}) });
    const uploaded = formData.get("file");
    if (!(uploaded instanceof File)) return jsonError("A file field is required.");
    if (formData.getAll("file").length !== 1) return jsonError("Upload one file per request.");
    if (uploaded.size > MAX_UPLOAD_BYTES) return jsonError(`File exceeds ${MAX_UPLOAD_BYTES} byte limit.`, 413, "DATA_FILE_TOO_LARGE");
    const bytes = new Uint8Array(await uploaded.arrayBuffer());
    const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const datasetId = `dataset_${randomUUID().replaceAll("-", "")}`;
    const sourceUrl = sourceDownloadUrl(datasetId, owner);
    const textPreview = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, Math.min(bytes.byteLength, 4096)));
    const metadata = {
      fileName: uploaded.name,
      mimeType: uploaded.type || "application/octet-stream",
      sizeBytes: uploaded.size,
      contentHash,
      storageRef: datasetId,
      uploadedAt: new Date().toISOString(),
      projectId: owner.projectId,
      vdtId: owner.vdtId,
      sourceUrl
    };
    await saveDatasetFile({ datasetId, metadata, bytes, textPreview }, owner);
    return Response.json({ ok: true, datasetId, sourceUrl, file: metadata });
  } catch (error) { return dataApiErrorResponse(error); }
  finally { if (admitted) uploads.active -= 1; }
}

export async function GET(request: Request) {
  try {
    requireLocalFileRequest(request);
    const owner = readDatasetFileOwner(ownerQuery(request));
    const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "true";
    const files = (await listLibraryDatasetFiles(owner, includeArchived || Boolean(owner.vdtId)))
      .filter((file) => !owner.vdtId || file.vdtIds.includes(owner.vdtId));
    return Response.json({
      ok: true,
      sources: files.map((file) => ({
        datasetId: file.datasetId,
        file: owner.vdtId ? { ...file.metadata, vdtId: owner.vdtId, sourceUrl: sourceDownloadUrl(file.datasetId, owner) } : file.metadata,
        sourceUrl: sourceDownloadUrl(file.datasetId, owner), displayName: file.displayName,
        archived: file.archived, vdtIds: file.vdtIds
      }))
    });
  } catch (error) { return dataApiErrorResponse(error); }
}
