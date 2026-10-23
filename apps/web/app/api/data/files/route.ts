import { createHash, randomUUID } from "node:crypto";
import { jsonError } from "../../vdt/storage-response";
import { dataApiErrorResponse, ownerQuery, readDatasetFileOwner, requireLocalFileRequest } from "../request-context";
import { listLibraryDatasetFiles, saveDatasetFile, sourceDownloadUrl } from "../store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    requireLocalFileRequest(request);
    let formData: FormData;
    try { formData = await request.formData(); }
    catch { return jsonError("Request must be multipart/form-data."); }
    const owner = readDatasetFileOwner({ projectId: formData.get("projectId"), ...(formData.has("vdtId") ? { vdtId: formData.get("vdtId") } : {}) });
    const uploaded = formData.get("file");
    if (!(uploaded instanceof File)) return jsonError("A file field is required.");
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
