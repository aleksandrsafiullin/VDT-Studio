import { randomUUID } from "node:crypto";
import { isModelReasoningValue, type AiProvider, type AiTaskType } from "@vdt-studio/ai-harness";
import * as managedRuntime from "@vdt-studio/local-runner/server-runtime";
import { AGENT_DECISION_BATCH_CONTRACT_PROMPT_RULE, executionExpectationSchema } from "@vdt-studio/vdt-agent-runtime";
import {
  getModelBackendDefinition,
  getRegisteredJsonSchema,
  getStrictResponseJsonSchema,
  normalizeRegisteredSchemaOutput,
  schemaIdForTask,
  validateRegisteredSchemaDetailed
} from "@vdt-studio/model-bridge";
import {
  AiRouteProviderError,
  createAiProvider,
  readProviderConfig,
  type AiRouteProviderRequest
} from "@/lib/ai-route-provider";
import { fetchPinnedProvider } from "@/lib/pinned-provider-fetch";
import { resolvePublicProviderTarget } from "@/lib/provider-target-security";
import { resolveTrustedStorageWriteMode } from "../../vdt/storage-write-adapter";
import { assertAnalyticalAdmission, type AnalyticalTask, type HostExecutionAdmission } from "./execution-binding-admission";
import { buildOpenAiAgentDecision } from "./openai-agent-decision";

type RuntimeContext = ReturnType<typeof managedRuntime.createLocalRuntimeContext>;

const managedRuntimeGlobal = globalThis as typeof globalThis & {
  __vdtStudioDevelopmentRuntime?: RuntimeContext;
};

export interface TaskProviderRequest extends AiRouteProviderRequest {
  readonly expectedExecution?: unknown;
}

export interface TaskProviderPolicy {
  readonly task: AnalyticalTask;
  readonly completions: readonly AiTaskType[];
}

class TaskProviderAdmissionError extends AiRouteProviderError {
  readonly code = "BINDING_CAPABILITY_DENIED";
}

export function assertTaskProviderAdmission(request: TaskProviderRequest, policy: TaskProviderPolicy): HostExecutionAdmission {
  // The public configuration selects an existing compatibility adapter. It cannot
  // register a provider, override a runner manifest or set host policy.
  const raw = request as TaskProviderRequest & Record<string, unknown>;
  const config = request.providerConfig ?? {};
  if (typeof config !== "object" || Array.isArray(config)) throw new TaskProviderAdmissionError("Provider configuration must be an object.");
  if (raw.executionBindingId !== undefined || raw.executionMode !== undefined || raw.localHttpSelection !== undefined
    || ["expectedExecution", "executionMode", "executionBindingId", "localHttpSelection", "requireVerifiedLocalHttp"].some(key => key in config)) {
    throw new TaskProviderAdmissionError("An analytical task requires one selected provider configuration.");
  }

  const expected = request.expectedExecution === undefined ? undefined : executionExpectationSchema.safeParse(request.expectedExecution);
  if (expected && !expected.success) throw new TaskProviderAdmissionError("The execution identity assertion is invalid.");
  if (expected?.data?.mode === "local") {
    throw new TaskProviderAdmissionError("Verified on-device execution is unavailable for this analytical route.");
  }

  const api = request.providerId === "openai_compatible" || request.providerId === "anthropic"
    || request.providerId === "azure_openai" || request.providerId === "gemini";
  const settings = readProviderConfig(config);
  let providerId = request.providerId ?? "";
  const modelId = (providerId === "azure_openai" ? settings.deployment : undefined) ?? settings.model ?? "";
  let mode: HostExecutionAdmission["mode"] = "legacy";

  if (providerId === "local_runner") {
    if (["baseUrl", "endpoint", "deployment", "apiKey", "command", "args", "argsText", "providerConfig", "runnerProviderId"].some(key => key in config)) {
      throw new TaskProviderAdmissionError("Runner destinations and credentials are manifest-owned.");
    }
    providerId = typeof config.backendId === "string" ? config.backendId.trim() : "";
    const context = managedLocalRuntimeContext(providerId, policy.completions);
    const manifest = context.manifests.get(providerId);
    if (!manifest || !runtimeSupportsTasks(context, providerId, policy.completions)) {
      throw new TaskProviderAdmissionError("The selected runtime does not support this analytical task.");
    }
    if (manifest.kind === "subscription_cli") {
      mode = "cli_subscription";
      if (expected && (typeof config.pairingToken === "string" || !resolveTrustedStorageWriteMode())) {
        throw new TaskProviderAdmissionError("The selected CLI identity requires a trusted managed runtime.");
      }
    }
  } else if (api) {
    if (["backendId", "runnerUrl", "pairingToken"].some(key => key in config)) {
      throw new TaskProviderAdmissionError("An API connection cannot include runner credentials or destination.");
    }
    const registryId = providerId === "gemini" ? "gemini_api" : providerId;
    if (!getModelBackendDefinition(registryId).capabilities.structuredOutput) {
      throw new TaskProviderAdmissionError("The selected API does not support structured completion.");
    }
    if (settings.apiKey?.trim()) {
      mode = "api_keys";
      if (expected) {
        const target = providerId === "azure_openai" ? settings.endpoint ?? settings.baseUrl : settings.baseUrl;
        if (!target || !URL.canParse(target) || new URL(target).protocol !== "https:") {
          throw new TaskProviderAdmissionError("An explicit HTTPS destination is required for the asserted API connection.");
        }
      }
    }
  } else if (providerId !== "mock") {
    throw new TaskProviderAdmissionError(providerId
      ? "The selected provider does not support this analytical task."
      : "Select a configured Local CLI or BYOK provider before running an AI task.");
  }

  const admission: HostExecutionAdmission = {
    profileVersion: 1, mode, providerId, modelId, modelRevision: null, runtimeProfileVersion: null,
    reasoning: isModelReasoningValue(config.modelReasoning) ? config.modelReasoning : null,
    boundary: mode === "legacy" ? "unverified" : "provider_service",
    analyticalTasks: [policy.task],
    speech: { stt: null, tts: null, realtime: null },
    credential: mode === "api_keys" ? { kind: "session_key", reference: providerId } : mode === "cli_subscription"
      ? { kind: "subscription", reference: providerId } : { kind: "none" },
    consent: mode === "legacy" ? "legacy" : "explicit_connection",
    scope: "bound_run", research: false, delegation: false
  };
  try {
    assertAnalyticalAdmission(admission, policy.task, undefined, expected?.data);
  } catch (error) {
    throw new TaskProviderAdmissionError(error instanceof Error ? error.message : "The selected execution identity is incompatible.");
  }
  return admission;
}

export function createTaskAiProvider(request: TaskProviderRequest, requestUrl: string, policy: TaskProviderPolicy): AiProvider {
  const admission = assertTaskProviderAdmission(request, policy);
  if (admission.mode === "legacy" && request.providerId !== "local_runner" && request.providerId !== "mock"
    && (request.expectedExecution !== undefined || !resolveTrustedStorageWriteMode())) {
    const settings = readProviderConfig(request.providerConfig);
    if (request.providerId === "openai_compatible" && settings.baseUrl
      && settings.baseUrl !== (process.env.OPENAI_COMPATIBLE_BASE_URL ?? "https://api.openai.com/v1")) {
      throw new AiRouteProviderError("A request-supplied OpenAI-compatible base URL must also provide its own API key.");
    }
    throw new AiRouteProviderError("An explicit API key is required for this analytical task.");
  }

  const provider = createManagedAwareAiProvider(request, requestUrl, { fetch: request.expectedExecution !== undefined && admission.mode === "api_keys"
    ? pinnedTaskFetch : undefined });
  return restrictTaskProvider(provider, policy, request.expectedExecution === undefined ? undefined : admission.modelId);
}

export function restrictTaskProvider(provider: AiProvider, policy: TaskProviderPolicy, modelId?: string): AiProvider {
  return {
    id: provider.id, name: provider.name, type: provider.type,
    async completeStructured(params) {
      if (!policy.completions.includes(params.taskType)
        || (modelId !== undefined && params.model !== undefined && params.model !== modelId)) {
        throw new TaskProviderAdmissionError("The completion does not match the admitted analytical task or model.");
      }
      return provider.completeStructured(params) as Promise<never>;
    }
  };
}

const pinnedTaskFetch: typeof fetch = async (raw, init) => {
  const signal = init?.signal ?? new AbortController().signal;
  signal.throwIfAborted();
  const target = await resolvePublicProviderTarget(String(raw));
  try {
    return await fetchPinnedProvider(target, {
      method: init?.method ?? "GET", headers: new Headers(init?.headers), body: String(init?.body ?? ""), signal
    });
  } catch (error) {
    signal.throwIfAborted();
    throw new TypeError("fetch failed", { cause: error });
  }
};

export function createManagedAwareAiProvider(
  request: AiRouteProviderRequest,
  requestUrl: string,
  options: { retainInitialContext?: boolean | undefined; fetch?: typeof fetch | undefined } = {}
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
      const context = managedLocalRuntimeContext(backendId, [params.taskType]);
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

function managedLocalRuntimeContext(backendId: string, tasks: readonly AiTaskType[]): RuntimeContext {
  const existing = managedRuntimeGlobal.__vdtStudioDevelopmentRuntime;
  if (existing && runtimeSupportsTasks(existing, backendId, tasks)) {
    return existing;
  }

  const refreshed = managedRuntime.createLocalRuntimeContext(existing?.config);
  if (existing) {
    // Keep active requests, cancellation ownership and Smart lanes on the
    // existing runtime even when an incoming request needs a registry refresh.
    existing.manifests = refreshed.manifests;
    return existing;
  }
  managedRuntimeGlobal.__vdtStudioDevelopmentRuntime = refreshed;
  return refreshed;
}

function runtimeSupportsTasks(context: RuntimeContext, backendId: string, tasks: readonly AiTaskType[]): boolean {
  const manifest = context.manifests.get(backendId);
  return Boolean(manifest && manifest.supportLevel !== "beta-blocked" && manifest.supportLevel !== "experimental-disabled"
    && tasks.every(task => manifest.taskTypes.includes(task) && manifest.schemaIds.includes(schemaIdForTask(task))));
}
