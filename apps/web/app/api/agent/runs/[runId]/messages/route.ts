import { agentUserMessageSchema } from "@vdt-studio/vdt-agent-runtime";
import { readMaxTokens } from "@/lib/ai-route-provider";
import { agentRuntime, createAgentDecisionProvider, jsonError } from "../../runtime";

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!agentRuntime.store.has(runId)) {
    return jsonError("Agent run was not found.", 404, "RUN_NOT_FOUND");
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.");
  }

  const parsed = agentUserMessageSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid agent message.");
  }

  try {
    const state = agentRuntime.store.getState(runId);
    const needsPlanner = parsed.data.type === "user_answer" || parsed.data.type === "user_instruction";
    const execution = needsPlanner
      ? {
          provider: createAgentDecisionProvider(state.request, request.url),
          maxTokens: readMaxTokens(state.request.providerConfig)
        }
      : {};
    const snapshot = agentRuntime.handleMessageInBackground(runId, parsed.data, execution);
    return Response.json({ ok: true, snapshot });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Agent message could not be processed.", 500, "AGENT_MESSAGE_FAILED");
  }
}
