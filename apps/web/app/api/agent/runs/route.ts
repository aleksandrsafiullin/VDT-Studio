import { agentStartRequestSchema, type VdtAgentStartRequest } from "@vdt-studio/vdt-agent-runtime";
import { readMaxTokens } from "@/lib/ai-route-provider";
import { agentRuntime, createAgentDecisionProvider, jsonError } from "./runtime";

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
    const provider = createAgentDecisionProvider(parsed.data as VdtAgentStartRequest, request.url);
    const snapshot = agentRuntime.startRunInBackground(parsed.data as VdtAgentStartRequest, {
      provider,
      maxTokens: readMaxTokens(parsed.data.providerConfig)
    });
    return Response.json({ ok: true, runId: snapshot.runId, snapshot });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Agent run could not be started.", 500, "AGENT_START_FAILED");
  }
}
