import { agentUserMessageSchema } from "@vdt-studio/vdt-agent-runtime";
import { agentRuntime, jsonError } from "../../runtime";

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
    const snapshot = await agentRuntime.handleMessage(runId, parsed.data);
    return Response.json({ ok: true, snapshot });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Agent message could not be processed.", 500, "AGENT_MESSAGE_FAILED");
  }
}
