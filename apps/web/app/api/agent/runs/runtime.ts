import { randomUUID } from "node:crypto";
import * as managedRuntime from "@vdt-studio/local-runner/server-runtime";
import {
  createVdtAgentRuntime,
  type AgentDecisionProvider,
  type VdtAgentStartRequest
} from "@vdt-studio/vdt-agent-runtime";
import { createAiProvider } from "@/lib/ai-route-provider";
import { resolveVdtAppModeForRequest } from "@/lib/app-mode";

type RuntimeContext = ReturnType<typeof managedRuntime.createLocalRuntimeContext>;
const AGENT_DECISION_TASK_TYPE = "agent_decision" as const;
const AGENT_DECISION_SCHEMA_ID = "agent-decision-v1";

const runtimeGlobal = globalThis as typeof globalThis & {
  __vdtAgentRuntime?: ReturnType<typeof createVdtAgentRuntime>;
  __vdtStudioDevelopmentRuntime?: RuntimeContext;
};

export const agentRuntime =
  runtimeGlobal.__vdtAgentRuntime ?? createVdtAgentRuntime();

if (process.env.NODE_ENV !== "production") {
  runtimeGlobal.__vdtAgentRuntime = agentRuntime;
}

export function createAgentDecisionProvider(request: VdtAgentStartRequest, requestUrl: string): AgentDecisionProvider {
  const providerConfig = request.providerConfig ?? {};
  const needsManagedLocalRuntime =
    request.providerId === "local_runner" &&
    typeof providerConfig.pairingToken !== "string";

  if (!needsManagedLocalRuntime) {
    return createAiProvider(request, requestUrl) as AgentDecisionProvider;
  }

  const appMode = resolveVdtAppModeForRequest(new Request(requestUrl));
  if (appMode !== "development_web" && appMode !== "desktop") {
    throw new Error("Local CLI agent decisions require the managed local runtime in development/desktop or a paired local runner.");
  }

  const backendId = typeof providerConfig.backendId === "string" ? providerConfig.backendId.trim() : "";
  if (!backendId) throw new Error("Local CLI agent decisions require providerConfig.backendId.");
  const model = typeof providerConfig.model === "string" && providerConfig.model.trim()
    ? providerConfig.model.trim().slice(0, 160)
    : undefined;
  const timeoutMs = typeof providerConfig.timeoutMs === "number" && Number.isSafeInteger(providerConfig.timeoutMs)
    ? Math.min(Math.max(providerConfig.timeoutMs, 1_000), 120_000)
    : undefined;

  return {
    id: "local_runner",
    async completeStructured(params) {
      const context = managedLocalRuntimeContext(backendId);
      const selectedModel = params.model ?? model;
      const requestId = randomUUID();
      if (params.signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      const abort = () => {
        try {
          managedRuntime.cancelRuntimeRequest(requestId, context);
        } catch {
          // The runtime run may not be registered yet, or may already be terminal.
        }
      };
      params.signal?.addEventListener("abort", abort, { once: true });
      try {
        const result = await managedRuntime.completeRuntime({
          requestId,
          backendId,
          taskType: AGENT_DECISION_TASK_TYPE,
          schemaId: AGENT_DECISION_SCHEMA_ID,
          input: {
            data: params.input,
            systemPrompt: params.systemPrompt,
            userPrompt: params.userPrompt
          },
          ...(selectedModel ? { model: selectedModel } : {}),
          ...(timeoutMs ? { timeoutMs } : {})
        }, context);
        const payload = result.payload as { ok?: boolean; output?: unknown; error?: { message?: string } } | undefined;
        if (params.signal?.aborted) {
          throw new DOMException("The operation was aborted.", "AbortError");
        }
        if (result.statusCode < 200 || result.statusCode >= 300 || !payload?.ok) {
          throw new Error(payload?.error?.message ?? "Managed local runtime agent decision failed.");
        }
        return payload.output as never;
      } finally {
        params.signal?.removeEventListener("abort", abort);
      }
    }
  };
}

export const createAgentPlanningProvider = createAgentDecisionProvider;

function managedLocalRuntimeContext(backendId: string): RuntimeContext {
  const existing = runtimeGlobal.__vdtStudioDevelopmentRuntime;
  if (existing && runtimeSupportsAgentDecision(existing, backendId)) {
    return existing;
  }

  const refreshed = managedRuntime.createLocalRuntimeContext(existing?.config);
  runtimeGlobal.__vdtStudioDevelopmentRuntime = refreshed;
  return refreshed;
}

function runtimeSupportsAgentDecision(context: RuntimeContext, backendId: string): boolean {
  const manifest = context.manifests.get(backendId);
  return Boolean(
    manifest?.taskTypes.includes(AGENT_DECISION_TASK_TYPE) &&
    manifest.schemaIds.includes(AGENT_DECISION_SCHEMA_ID)
  );
}

export function jsonError(message: string, status = 400, code = "AGENT_REQUEST_ERROR") {
  return Response.json({ ok: false, error: { code, message } }, { status });
}
