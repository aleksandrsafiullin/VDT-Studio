import { jsonError } from "../../../vdt/storage-response";
import { dataApiErrorResponse, ownerQuery, readDataOwner, readDatasetFileOwner, readOptionalJsonObject, requireLocalFileRequest } from "../../request-context";
import { DataApiError, readDatasetFile, requireDataId, updateLibraryDatasetFile } from "../../store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ datasetId: string }> }) {
  try {
    requireLocalFileRequest(request);
    const { datasetId } = await params;
    requireDataId(datasetId, "datasetId");
    const owner = readDatasetFileOwner(ownerQuery(request));
    const file = await readDatasetFile(datasetId, owner);
    if (!file) return jsonError("Dataset file was not found.", 404, "DATASET_NOT_FOUND");
    // Original names are encoded header values and never interpreted as paths.
    const encodedName = encodeURIComponent(file.metadata.fileName).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(file.bytes.byteLength),
        "content-disposition": `attachment; filename="source"; filename*=UTF-8''${encodedName}`,
        "x-content-type-options": "nosniff",
        "cache-control": "no-store",
        etag: `"${file.metadata.contentHash}"`
      }
    });
  } catch (error) { return dataApiErrorResponse(error); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ datasetId: string }> }) {
  try {
    requireLocalFileRequest(request);
    const { datasetId } = await params;
    requireDataId(datasetId, "datasetId");
    const owner = readDatasetFileOwner(ownerQuery(request));
    const body = await readOptionalJsonObject(request);
    if (body.action === "rename") {
      if (typeof body.displayName !== "string") throw new DataApiError("A display name is required.");
      await updateLibraryDatasetFile(datasetId, owner, { action: "rename", displayName: body.displayName });
    } else if (body.action === "archive" || body.action === "restore") {
      await updateLibraryDatasetFile(datasetId, owner, { action: body.action });
    } else if (body.action === "attach" || body.action === "detach") {
      const target = readDataOwner({ projectId: owner.projectId, vdtId: body.vdtId })!;
      await updateLibraryDatasetFile(datasetId, owner, { action: body.action, vdtId: target.vdtId });
    } else throw new DataApiError("Unknown file library action.");
    return Response.json({ ok: true });
  } catch (error) { return dataApiErrorResponse(error); }
}
