import { jsonError } from "../../../vdt/storage-response";
import { dataApiErrorResponse, ownerQuery, readDataOwner } from "../../request-context";
import { readDatasetFile, requireDataId } from "../../store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ datasetId: string }> }) {
  try {
    const { datasetId } = await params;
    requireDataId(datasetId, "datasetId");
    const owner = readDataOwner(ownerQuery(request))!;
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
