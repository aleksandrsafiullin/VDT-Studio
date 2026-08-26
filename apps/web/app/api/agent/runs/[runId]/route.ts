import { agentRuntime, jsonError } from "../runtime";
import { compactPublicAgentSnapshot } from "../public-snapshot";
import {
  compactSupervisorAwareSnapshot,
  isPersistedSupervisorRun
} from "../supervisor-runtime";

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await params;
    if (!agentRuntime.store.has(runId)) {
      return jsonError("Agent run was not found.", 404, "RUN_NOT_FOUND");
    }
    const stored = agentRuntime.store.getSnapshot(runId);
    const snapshot = await isPersistedSupervisorRun(runId)
      ? await compactSupervisorAwareSnapshot(stored)
      : compactPublicAgentSnapshot(stored);
    return Response.json({ ok: true, snapshot });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Agent run could not be loaded.",
      500,
      "AGENT_RUN_LOAD_FAILED"
    );
  }
}
