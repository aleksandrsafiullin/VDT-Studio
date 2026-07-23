import { jsonError } from "../../../../vdt/storage-response";
import { readDiscoveryRun } from "../../../store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const snapshot = await readDiscoveryRun(runId);
  if (!snapshot) {
    return jsonError("Discovery run was not found.", 404, "DATA_DISCOVERY_RUN_NOT_FOUND");
  }
  return Response.json({ ok: true, snapshot });
}
