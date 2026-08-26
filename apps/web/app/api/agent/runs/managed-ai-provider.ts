import { randomUUID } from "node:crypto";
import type { AiProvider } from "@vdt-studio/ai-harness";
import * as managedRuntime from "@vdt-studio/local-runner/server-runtime";
import {
  getStrictResponseJsonSchema,
  normalizeRegisteredSchemaOutput,
  schemaIdForTask,
  validateRegisteredSchemaDetailed
} from "@vdt-studio/model-bridge";
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
    return withRegisteredAgentDecisionSchema(createAiProvider(request, requestUrl));
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
            userPrompt: managedRunnerPrompt(params.taskType, params.userPrompt)
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

/**
 * The managed runner serializes the complete `data` object into its canonical
 * CLI prompt. Repeating the same 70-170 KiB agent context in `userPrompt`
 * doubles provider input and makes every checkpoint progressively slower.
 * Direct HTTP providers still receive the original prompt; this compaction is
 * only for the managed envelope that already carries `data` losslessly.
 */
function managedRunnerPrompt(taskType: string, userPrompt: string): string {
  if (taskType === "agent_decision" || taskType === "orchestrator_first_response") {
    return "Use input.data as the canonical VDT context and return only the requested structured response.";
  }
  return userPrompt;
}

function withRegisteredAgentDecisionSchema(provider: AiProvider): AiProvider {
  return {
    id: provider.id,
    name: provider.name,
    type: provider.type,
    async completeStructured(params) {
      if (params.taskType !== "agent_decision") {
        return provider.completeStructured(params) as Promise<never>;
      }
      const schemaId = schemaIdForTask(params.taskType);
      const raw = await provider.completeStructured({
        ...params,
        schema: getStrictResponseJsonSchema(schemaId)
      });
      const normalized = normalizeRegisteredSchemaOutput(schemaId, raw);
      const validation = validateRegisteredSchemaDetailed(schemaId, normalized);
      if (!validation.valid) {
        const error = new Error(`AI response failed schema validation: ${validation.errors.join(" ")}`);
        (error as { code?: string }).code = "SCHEMA_INVALID";
        throw error;
      }
      return normalized as never;
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
