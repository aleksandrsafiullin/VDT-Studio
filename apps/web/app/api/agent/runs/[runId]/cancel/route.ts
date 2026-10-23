import { agentRuntime, jsonError } from "../../runtime";
import { compactPublicAgentSnapshot } from "../../public-snapshot";
import { AgentSupervisorPersistenceError } from "@vdt-studio/vdt-agent-runtime";
import {
  PublicSupervisorRunError,
  cancelStructuredModelAgentRun,
  isPersistedSupervisorRun
} from "../../supervisor-runtime";

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!agentRuntime.store.has(runId)) {
    return jsonError("Agent run was not found.", 404, "RUN_NOT_FOUND");
  }
  if (await isPersistedSupervisorRun(runId)) {
    try {
      const options = await request.json().catch(() => ({})) as { awaitTerminal?: unknown };
      const awaitTerminal = options?.awaitTerminal === true;
      const snapshot = await cancelStructuredModelAgentRun(runId, awaitTerminal);
      return Response.json({ ok: true, status: snapshot.status, snapshot, ...(awaitTerminal ? { terminalCleanupConfirmed: true } : {}) });
    } catch (error) {
      if (error instanceof PublicSupervisorRunError) {
        return jsonError(error.message, error.status, error.code);
      }
      if (error instanceof AgentSupervisorPersistenceError) {
        return jsonError(error.message, 409, error.code);
      }
      return jsonError("Agent cancellation could not be confirmed. Retry Cancel.", 500, "AGENT_CANCEL_FAILED");
    }
  }
  const snapshot = compactPublicAgentSnapshot(agentRuntime.cancelRun(runId));
  return Response.json({ ok: true, status: snapshot.status, snapshot });
}
