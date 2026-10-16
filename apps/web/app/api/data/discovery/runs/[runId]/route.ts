import { jsonError } from "../../../../vdt/storage-response";
import { dataApiErrorResponse, ownerQuery, readDataOwner } from "../../../request-context";
import { readDiscoveryRun, requireDataId } from "../../../store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await params;
    requireDataId(runId, "runId");
    const owner = readDataOwner(ownerQuery(request), false);
    const snapshot = await readDiscoveryRun(runId, owner);
    if (!snapshot) return jsonError("Discovery run was not found.", 404, "DATA_DISCOVERY_RUN_NOT_FOUND");
    return Response.json({ ok: true, snapshot });
  } catch (error) { return dataApiErrorResponse(error); }
}
