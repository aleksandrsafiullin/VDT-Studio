import { randomUUID } from "node:crypto";
import { isModelReasoningValue, type AiProvider } from "@vdt-studio/ai-harness";
import * as managedRuntime from "@vdt-studio/local-runner/server-runtime";
import { AGENT_DECISION_BATCH_CONTRACT_PROMPT_RULE } from "@vdt-studio/vdt-agent-runtime";
import {
  getRegisteredJsonSchema,
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
import { buildOpenAiAgentDecision } from "./openai-agent-decision";

type RuntimeContext = ReturnType<typeof managedRuntime.createLocalRuntimeContext>;

const managedRuntimeGlobal = globalThis as typeof globalThis & {
  __vdtStudioDevelopmentRuntime?: RuntimeContext;
};

export function createManagedAwareAiProvider(
  request: AiRouteProviderRequest,
  requestUrl: string,
  options: { retainInitialContext?: boolean | undefined } = {}
): AiProvider {
  const providerConfig = request.providerConfig ?? {};
  const needsManagedLocalRuntime =
    request.providerId === "local_runner" &&
    typeof providerConfig.pairingToken !== "string";

  if (!needsManagedLocalRuntime) {
    const provider = createAiProvider(request, requestUrl, options);
    return withRegisteredAgentDecisionSchema(provider,
      provider.type === "openai_compatible" && options.retainInitialContext === false);
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
          ...(isModelReasoningValue(providerConfig.modelReasoning) ? { modelReasoning: providerConfig.modelReasoning } : {}),
          ...(timeoutMs ? { timeoutMs } : {})
        }, context, params.signal);
        const payload = result.payload as { ok?: boolean; output?: unknown; error?: { code?: string; message?: string } } | undefined;
        if (params.taskType === "suggest_incoming_kpis" && payload?.error?.code === "CLEANUP_UNCONFIRMED") throw Object.assign(new Error("Smart cleanup could not be confirmed."), { code: "CLEANUP_UNCONFIRMED" });
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
  if (taskType === "suggest_incoming_kpis" || taskType === "agent_decision" || taskType === "orchestrator_first_response") {
    return "Use input.data as the canonical VDT context and return only the requested structured response.";
  }
  return userPrompt;
}

function withRegisteredAgentDecisionSchema(
  provider: AiProvider, nativeCallArray: boolean
): AiProvider & { requireHierarchyOnFinish?: true } {
  return {
    id: provider.id,
    name: provider.name,
    type: provider.type,
    ...(nativeCallArray ? { requireHierarchyOnFinish: true as const } : {}),
    async completeStructured(params) {
      if (params.taskType !== "agent_decision") {
        return provider.completeStructured(params) as Promise<never>;
      }
      const schemaId = schemaIdForTask(params.taskType);
      const schema = getStrictResponseJsonSchema(schemaId);
      const useNativeCalls = nativeCallArray && schemaId === "agent-decision-v2";
      const nativeDecision = useNativeCalls ? buildOpenAiAgentDecision(params.input) : undefined;
      const wireInstruction = useNativeCalls
        ? "Use the native calls array for multiple calls; each item has toolName and argsJson. Use [] when not batching. Encode each argsJson as exactly one JSON object string."
        : "Encode multiple calls in callsJson and each single call's arguments in argsJson as valid JSON.";
      const questionInstruction = useNativeCalls
        ? `questionsJson must encode this exact array schema: ${registeredDecisionQuestionsSchema}. Put a single numeric question's unit in its question text, or use fields[].unit for grouped fields; do not add a top-level unit.`
        : "Encode questions in questionsJson.";
      const raw = await provider.completeStructured({
        ...params,
        systemPrompt: nativeDecision
          ? `${nativeDecision.instruction}\n${params.systemPrompt.replace(AGENT_DECISION_BATCH_CONTRACT_PROMPT_RULE, "")}`
          : `${params.systemPrompt}\nThe supplied response schema is the wire format for this AgentDecision. ${wireInstruction} ${questionInstruction} Use type call_tool for one call. Do not put multiple JSON objects or explanatory text inside an encoded field.`,
        userPrompt: nativeDecision?.userPrompt ?? params.userPrompt,
        schema: nativeDecision?.schema ?? (useNativeCalls ? withNativeCallArray(schema) : schema)
      });
      if (useNativeCalls && !nativeDecision) assertNativeDecisionPayload(raw);
      const normalized = normalizeRegisteredSchemaOutput(schemaId, nativeDecision ? nativeDecision.decode(raw) : raw);
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

const registeredDecisionQuestionsSchema = JSON.stringify(
  (getRegisteredJsonSchema("agent-decision-v2").anyOf as Array<{ properties: Record<string, unknown> }>)
    .find((branch) => "questions" in branch.properties)?.properties.questions
);

function withNativeCallArray(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = { ...schema.properties as Record<string, unknown> };
  delete properties.callsJson;
  properties.calls = {
    type: "array", maxItems: 6, description: "Sequential tool calls; [] except for call_tools.",
    items: {
      type: "object", additionalProperties: false, required: ["toolName", "argsJson"],
      properties: {
        toolName: properties.toolName,
        argsJson: { ...properties.argsJson as Record<string, unknown>, description: "One JSON object string containing this call's arguments." }
      }
    }
  };
  return { ...schema, properties, required: (schema.required as string[]).map((name) => name === "callsJson" ? "calls" : name) };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertNativeDecisionPayload(raw: unknown): void {
  if (!isObject(raw)) return;
  if (raw.type === "ask_user") {
    const questions = raw.questionsJson === undefined ? raw.questions : parseEncodedJson(raw.questionsJson);
    if (!Array.isArray(questions) || !questions.length || !questions.every(isObject)) {
      throw Object.assign(new Error("AI response failed schema validation: questionsJson must contain an array of question objects."), { code: "SCHEMA_INVALID" });
    }
    return;
  }
  if (raw.type !== "call_tool" && raw.type !== "call_tools") return;
  const calls = raw.type === "call_tool" ? [raw] : raw.calls;
  const valid = Array.isArray(calls) && calls.every((call: unknown) => {
    if (!isObject(call)) return false;
    if (call.argsJson === undefined) return isObject(call.args);
    return isObject(parseEncodedJson(call.argsJson));
  });
  if (!valid) {
    throw Object.assign(new Error("AI response failed schema validation: each tool call must contain one valid JSON argument object."), { code: "SCHEMA_INVALID" });
  }
}

function parseEncodedJson(value: unknown): unknown {
  if (typeof value !== "string") return undefined;
  try { return JSON.parse(value); } catch { return undefined; }
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
