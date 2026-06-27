import { randomUUID } from "node:crypto";
import {
  createVdtAgentRuntime,
  type AgentPlanningProvider,
  type VdtAgentStartRequest
} from "@vdt-studio/vdt-agent-runtime";
import { createAiProvider } from "@/lib/ai-route-provider";
import { resolveVdtAppModeForRequest } from "@/lib/app-mode";

type RuntimeModule = typeof import("../../../../../../packages/local-runner/src/server/runtime");
type RuntimeContext = ReturnType<RuntimeModule["createLocalRuntimeContext"]>;

const runtimeGlobal = globalThis as typeof globalThis & {
  __vdtAgentRuntime?: ReturnType<typeof createVdtAgentRuntime>;
  __vdtStudioDevelopmentRuntime?: RuntimeContext;
};

export const agentRuntime =
  runtimeGlobal.__vdtAgentRuntime ?? createVdtAgentRuntime();

if (process.env.NODE_ENV !== "production") {
  runtimeGlobal.__vdtAgentRuntime = agentRuntime;
}

export function createAgentPlanningProvider(request: VdtAgentStartRequest, requestUrl: string): AgentPlanningProvider {
  const providerConfig = request.providerConfig ?? {};
  const needsManagedLocalRuntime =
    request.providerId === "local_runner" &&
    typeof providerConfig.pairingToken !== "string";

  if (!needsManagedLocalRuntime) {
    return createAiProvider(request, requestUrl) as AgentPlanningProvider;
  }

  const appMode = resolveVdtAppModeForRequest(new Request(requestUrl));
  if (appMode !== "development_web" && appMode !== "desktop") {
    throw new Error("Local CLI agent planning requires the managed local runtime in development/desktop or a paired local runner.");
  }

  const backendId = typeof providerConfig.backendId === "string" ? providerConfig.backendId.trim() : "";
  if (!backendId) throw new Error("Local CLI agent planning requires providerConfig.backendId.");
  const model = typeof providerConfig.model === "string" && providerConfig.model.trim()
    ? providerConfig.model.trim().slice(0, 160)
    : undefined;
  const timeoutMs = typeof providerConfig.timeoutMs === "number" && Number.isSafeInteger(providerConfig.timeoutMs)
    ? Math.min(Math.max(providerConfig.timeoutMs, 1_000), 120_000)
    : undefined;

  return {
    id: "local_runner",
    async completeStructured(params) {
      const runtime = await import("../../../../../../packages/local-runner/src/server/runtime");
      runtimeGlobal.__vdtStudioDevelopmentRuntime ??= runtime.createLocalRuntimeContext();
      const selectedModel = params.model ?? model;
      const requestId = randomUUID();
      const context = runtimeGlobal.__vdtStudioDevelopmentRuntime;
      if (params.signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      const abort = () => {
        try {
          runtime.cancelRuntimeRequest(requestId, context);
        } catch {
          // The runtime run may not be registered yet, or may already be terminal.
        }
      };
      params.signal?.addEventListener("abort", abort, { once: true });
      try {
        const result = await runtime.completeRuntime({
          requestId,
          backendId,
          taskType: "agent_plan",
          schemaId: "agent-plan-v1",
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
          throw new Error(payload?.error?.message ?? "Managed local runtime agent planning failed.");
        }
        return payload.output as never;
      } finally {
        params.signal?.removeEventListener("abort", abort);
      }
    }
  };
}

export function jsonError(message: string, status = 400, code = "AGENT_REQUEST_ERROR") {
  return Response.json({ ok: false, error: { code, message } }, { status });
}
