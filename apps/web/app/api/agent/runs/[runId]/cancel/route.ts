import { agentRuntime, jsonError } from "../../runtime";

export async function POST(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!agentRuntime.store.has(runId)) {
    return jsonError("Agent run was not found.", 404, "RUN_NOT_FOUND");
  }
  const snapshot = agentRuntime.cancelRun(runId);
  return Response.json({ ok: true, status: snapshot.status, snapshot });
}
