import { createHash, randomUUID } from "node:crypto";
import { jsonError } from "../../vdt/storage-response";
import { dataApiErrorResponse, ownerQuery, readDataOwner, requireLocalDataAccess } from "../request-context";
import { listDatasetFiles, saveDatasetFile, sourceDownloadUrl } from "../store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    requireLocalDataAccess();
    let formData: FormData;
    try { formData = await request.formData(); }
    catch { return jsonError("Request must be multipart/form-data."); }
    const owner = readDataOwner({ projectId: formData.get("projectId"), vdtId: formData.get("vdtId") })!;
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
    const owner = readDataOwner(ownerQuery(request))!;
    const files = await listDatasetFiles(owner);
    return Response.json({
      ok: true,
      sources: files.map((file) => ({ datasetId: file.datasetId, file: file.metadata, sourceUrl: sourceDownloadUrl(file.datasetId, owner) }))
    });
  } catch (error) { return dataApiErrorResponse(error); }
}
