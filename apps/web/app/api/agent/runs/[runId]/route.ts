import { agentRuntime, jsonError } from "../runtime";

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await params;
    if (!agentRuntime.store.has(runId)) {
      return jsonError("Agent run was not found.", 404, "RUN_NOT_FOUND");
    }
    const snapshot = agentRuntime.store.getSnapshot(runId);
    return Response.json({ ok: true, snapshot });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Agent run could not be loaded.",
      500,
      "AGENT_RUN_LOAD_FAILED"
    );
  }
}
