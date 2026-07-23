import { createHash } from "node:crypto";
import { generatedSafeId, jsonError } from "../../vdt/storage-response";
import { saveDatasetFile } from "../store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError("Request must be multipart/form-data.");
  }

  const uploaded = formData.get("file");
  if (!(uploaded instanceof File)) {
    return jsonError("A file field is required.");
  }

  if (uploaded.size > MAX_UPLOAD_BYTES) {
    return jsonError(`File exceeds ${MAX_UPLOAD_BYTES} byte limit.`, 413, "DATA_FILE_TOO_LARGE");
  }

  const bytes = new Uint8Array(await uploaded.arrayBuffer());
  const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const datasetId = generatedSafeId("dataset", `${uploaded.name}_${contentHash.slice(7, 19)}`);
  const textPreview = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, Math.min(bytes.byteLength, 4096)));
  const metadata = {
    fileName: uploaded.name,
    mimeType: uploaded.type || "application/octet-stream",
    sizeBytes: uploaded.size,
    contentHash,
    storageRef: datasetId,
    uploadedAt: new Date().toISOString()
  };

  await saveDatasetFile({
    datasetId,
    metadata,
    bytes,
    textPreview
  });

  return Response.json({
    ok: true,
    datasetId,
    file: {
      fileName: metadata.fileName,
      mimeType: metadata.mimeType,
      sizeBytes: metadata.sizeBytes,
      contentHash: metadata.contentHash
    }
  });
}
