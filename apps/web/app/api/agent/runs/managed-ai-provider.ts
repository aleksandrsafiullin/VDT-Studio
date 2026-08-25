import { randomUUID } from "node:crypto";
import type { AiProvider } from "@vdt-studio/ai-harness";
import * as managedRuntime from "@vdt-studio/local-runner/server-runtime";
import { schemaIdForTask } from "@vdt-studio/model-bridge";
import {
  createAiProvider,
  type AiRouteProviderRequest
} from "@/lib/ai-route-provider";
import { resolveTrustedStorageWriteMode } from "../../vdt/storage-write-adapter";

type RuntimeContext = ReturnType<typeof managedRuntime.createLocalRuntimeContext>;

const managedRuntimeGlobal = globalThis as typeof globalThis & {
  __vdtStudioDevelopmentRuntime?: RuntimeContext;
};

export function createManagedAwareAiProvider(request: AiRouteProviderRequest, requestUrl: string): AiProvider {
  const providerConfig = request.providerConfig ?? {};
  const needsManagedLocalRuntime =
    request.providerId === "local_runner" &&
    typeof providerConfig.pairingToken !== "string";

  if (!needsManagedLocalRuntime) {
    return createAiProvider(request, requestUrl);
  }

  if (!resolveTrustedStorageWriteMode()) {
    throw new Error("Local CLI AI requests require the managed local runtime in development/desktop or a paired local runner.");
  }

  const backendId = typeof providerConfig.backendId === "string" ? providerConfig.backendId.trim() : "";
  if (!backendId) throw new Error("Local CLI AI requests require providerConfig.backendId.");
  const model = typeof providerConfig.model === "string" && providerConfig.model.trim()
    ? providerConfig.model.trim().slice(0, 160)
    : undefined;
  const timeoutMs = typeof providerConfig.timeoutMs === "number" && Number.isSafeInteger(providerConfig.timeoutMs)
    ? Math.min(Math.max(providerConfig.timeoutMs, 1_000), managedRuntime.AGENT_DECISION_TIMEOUT_MAX_MS)
    : undefined;

  return {
    id: "local_runner",
    name: "Managed Local Runtime",
    type: "local_runner",
    async completeStructured(params) {
      const context = managedLocalRuntimeContext(backendId, params.taskType);
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
          taskType: params.taskType,
          schemaId: schemaIdForTask(params.taskType),
          input: {
            data: params.input,
            systemPrompt: params.systemPrompt,
            userPrompt: params.userPrompt
          },
          ...(selectedModel ? { model: selectedModel } : {}),
          ...(timeoutMs ? { timeoutMs } : {})
        }, context);
        const payload = result.payload as { ok?: boolean; output?: unknown; error?: { code?: string; message?: string } } | undefined;
        if (params.signal?.aborted) {
          throw new DOMException("The operation was aborted.", "AbortError");
        }
        if (result.statusCode < 200 || result.statusCode >= 300 || !payload?.ok) {
          const error = new Error(payload?.error?.message ?? "Managed local runtime AI request failed.");
          if (payload?.error?.code) {
            (error as { code?: string }).code = payload.error.code;
          }
          throw error;
        }
        return payload.output as never;
      } finally {
        params.signal?.removeEventListener("abort", abort);
      }
    }
  };
}

function managedLocalRuntimeContext(backendId: string, taskType: Parameters<AiProvider["completeStructured"]>[0]["taskType"]): RuntimeContext {
  const existing = managedRuntimeGlobal.__vdtStudioDevelopmentRuntime;
  if (existing && runtimeSupportsTask(existing, backendId, taskType)) {
    return existing;
  }

  const refreshed = managedRuntime.createLocalRuntimeContext(existing?.config);
  managedRuntimeGlobal.__vdtStudioDevelopmentRuntime = refreshed;
  return refreshed;
}

function runtimeSupportsTask(
  context: RuntimeContext,
  backendId: string,
  taskType: Parameters<AiProvider["completeStructured"]>[0]["taskType"]
): boolean {
  const manifest = context.manifests.get(backendId);
  return Boolean(
    manifest?.taskTypes.includes(taskType) &&
    manifest.schemaIds.includes(schemaIdForTask(taskType))
  );
}
