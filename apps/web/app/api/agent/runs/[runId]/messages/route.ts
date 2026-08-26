import { agentUserMessageSchema, prepareRetryExecution } from "@vdt-studio/vdt-agent-runtime";
import {
  AGENT_DECISION_TIMEOUT_FLOOR_MS,
  AGENT_DECISION_TIMEOUT_MAX_MS
} from "@vdt-studio/local-runner/server-runtime";
import { readMaxTokens } from "@/lib/ai-route-provider";
import {
  agentRuntime,
  createAgentDecisionProvider,
  jsonError,
  readAgentProviderConfig
} from "../../runtime";
import { compactPublicAgentSnapshot } from "../../public-snapshot";
import {
  PublicSupervisorRunError,
  handleStructuredModelAgentMessage,
  isPersistedSupervisorRun
} from "../../supervisor-runtime";

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

  if (await isPersistedSupervisorRun(runId)) {
    try {
      const snapshot = await handleStructuredModelAgentMessage(runId, parsed.data);
      return Response.json({ ok: true, snapshot });
    } catch (error) {
      if (error instanceof PublicSupervisorRunError) {
        return jsonError(error.message, error.status, error.code);
      }
      return jsonError(
        error instanceof Error ? error.message : "Model Agent message could not be processed.",
        500,
        "MODEL_AGENT_MESSAGE_FAILED"
      );
    }
  }

  try {
    const state = agentRuntime.store.getState(runId);
    const preparedRequest = prepareRetryExecution(state, parsed.data, {
      timeoutFloorMs: AGENT_DECISION_TIMEOUT_FLOOR_MS,
      timeoutMaxMs: AGENT_DECISION_TIMEOUT_MAX_MS
    });
    if (preparedRequest.providerConfig?.timeoutMs !== state.request.providerConfig?.timeoutMs) {
      agentRuntime.store.updateRun(runId, { request: preparedRequest });
    }
    const requestForProvider = preparedRequest;
    const needsPlanner = parsed.data.type === "user_answer" ||
      parsed.data.type === "user_instruction" ||
      parsed.data.type === "deepen_node" ||
      parsed.data.type === "continue_run";
    const execution = needsPlanner
      ? {
          provider: createAgentDecisionProvider(requestForProvider, request.url),
          maxTokens: readMaxTokens(readAgentProviderConfig(requestForProvider))
        }
      : {};
    const snapshot = compactPublicAgentSnapshot(
      agentRuntime.handleMessageInBackground(runId, parsed.data, execution)
    );
    return Response.json({ ok: true, snapshot });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Agent message could not be processed.", 500, "AGENT_MESSAGE_FAILED");
  }
}
