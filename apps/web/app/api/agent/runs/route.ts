import { agentStartRequestSchema, type VdtAgentStartRequest } from "@vdt-studio/vdt-agent-runtime";
import { agentRuntime, jsonError } from "./runtime";

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.");
  }

  const parsed = agentStartRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid agent start request.");
  }

  try {
    const snapshot = await agentRuntime.startRun(parsed.data as VdtAgentStartRequest);
    return Response.json({ ok: true, runId: snapshot.runId, snapshot });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Agent run could not be started.", 500, "AGENT_START_FAILED");
  }
}
