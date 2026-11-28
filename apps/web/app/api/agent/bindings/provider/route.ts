import { z } from "zod";
import { FAST_LOCAL_REASONING, resolveLocalReasoning } from "@vdt-studio/model-bridge/reasoning";
import { resolveTrustedStorageWriteMode } from "@/app/api/vdt/storage-write-adapter";
import { requireVdt } from "@/app/api/skills/service";
import { hasSameLocalOrigin } from "@/lib/local-request-origin";
import { readBoundedText } from "@vdt-studio/ai-harness";
import { executionModeSchema } from "@vdt-studio/vdt-agent-runtime";
import { createLocalRuntimeContext, listRuntimeModels } from "@vdt-studio/local-runner/server-runtime";
import { agentExecutionBindingRegistry, agentRuntime } from "../../runs/runtime";
import { modelAgentToolCatalogHash } from "../../runs/model-agent-tool-catalog";
import { openAiSessionBindings } from "../../runs/byok-bindings";
import { createLocalModelAgentBinding } from "../../runs/local-model-bindings";
import { adaptiveReasoningPolicy } from "../../runs/adaptive-reasoning";
import { executionBindingSummary } from "../../runs/execution-bindings";
import { providerConnectionSchema, providerModelCapabilities, resolveApiConnection, ProviderConnectionError } from "../../runs/provider-model-capabilities";
import { admitSessionWebResearch } from "../../runs/session-research";

const scopeId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u);
const envelope = z.object({
  operation: z.enum(["capabilities", "smart_capabilities", "admit"]),
  providerId: z.string(),
  providerConfig: z.unknown(),
  executionMode: executionModeSchema.optional(),
  enableResearch: z.boolean().optional(),
  adaptiveReasoning: z.boolean().optional(),
  adaptiveWorkspace: z.object({ projectId: scopeId, vdtId: scopeId }).strict().optional()
}).strict();

export async function POST(request: Request) {
  const headers = { "cache-control": "no-store" };
  const fail = (message: string, status: number) => Response.json({ ok: false, error: message }, { status, headers });
  const mode = resolveTrustedStorageWriteMode();
  if (!mode || process.env.NEXT_PHASE === "phase-production-build"
    || (mode !== "desktop" && process.env.NODE_ENV === "production" && process.env.VDT_MODEL_AGENT_ENABLED !== "true")) {
    return fail("Provider chat requires an enabled trusted local application.", 403);
  }
  if (!hasSameLocalOrigin(request)) return fail("Provider connection requires the application origin.", 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return fail("Provider connection requires JSON.", 415);
  let input: z.infer<typeof envelope>;
  try {
    const text = await readBoundedText(new Response(request.body), 8192, "Provider admission", AbortSignal.timeout(10_000));
    input = envelope.parse(JSON.parse(text));
  } catch { return fail("Invalid or oversized provider connection request.", 400); }
  const parsed = providerConnectionSchema.safeParse({ providerId: input.providerId, providerConfig: input.providerConfig });
  if (!parsed.success) return fail("Supply the selected provider, model and scoped credentials. Command, environment and arbitrary config fields are not accepted.", 400);
  const connection = parsed.data;
  const localCompatibility = connection.providerId === "local_runner";
  if (input.adaptiveReasoning && (input.operation !== "admit" || connection.providerId !== "local_runner"
    || connection.providerConfig.backendId !== "ollama" || connection.providerConfig.modelReasoning !== FAST_LOCAL_REASONING)) {
    return fail("Adaptive reasoning requires Ollama with the Fast reasoning preference.", 400);
  }
  if (Boolean(input.adaptiveReasoning) !== Boolean(input.adaptiveWorkspace)) {
    return fail("Specify the exact project and VDT for the adaptive reasoning offer.", 400);
  }
  if (input.adaptiveWorkspace) {
    try { requireVdt(input.adaptiveWorkspace.projectId, input.adaptiveWorkspace.vdtId); }
    catch { return fail("The requested adaptive reasoning workspace is unavailable.", 404); }
  }
  const admittedMode = localCompatibility ? "legacy" : "api_keys";
  if (input.executionMode !== undefined && input.executionMode !== admittedMode) {
    return fail(input.executionMode === "local"
      ? "The host has no verified offline binding for this selection. Choose a verified local model."
      : "The selected provider does not support this execution mode.", 409);
  }
  if (localCompatibility && input.enableResearch) return fail("This execution connection does not permit web research.", 409);
  try {
    // Validate endpoint authority even for Default/no-capability admissions.
    if (connection.providerId !== "local_runner") resolveApiConnection(connection);
    const directOpenAi = connection.providerId === "openai_compatible" && resolveApiConnection(connection).providerConfig.baseUrl === "https://api.openai.com/v1";
    const capabilities = input.operation === "capabilities" || input.operation === "smart_capabilities" || connection.providerConfig.modelReasoning !== undefined || directOpenAi
      ? await providerModelCapabilities(connection, fetch, input.operation === "smart_capabilities" ? "suggested_kpi" : undefined) : undefined;
    if (input.operation === "capabilities" || input.operation === "smart_capabilities") return Response.json({ ok: true, modelId: connection.providerConfig.model, capabilities: capabilities ?? null }, { headers });
    const hash = modelAgentToolCatalogHash(agentRuntime.tools);
    if (connection.providerId === "local_runner") {
      const { backendId, model, modelReasoning } = connection.providerConfig;
      const result = await listRuntimeModels(backendId, createLocalRuntimeContext());
      const models = (result.payload as { models?: string[] }).models ?? [];
      if (!models.some((id) => id === model || (backendId === "ollama" && id === `${model}:latest`))) throw new ProviderConnectionError("The selected local model is not installed or loaded. Refresh the model list.");
      const effective = resolveLocalReasoning(capabilities, modelReasoning);
      if (!effective.supported) throw new ProviderConnectionError("The selected reasoning level is not supported by this model. Refresh its options or choose Default.");
      const policy = input.adaptiveReasoning ? adaptiveReasoningPolicy(capabilities) : undefined;
      if (input.adaptiveReasoning && !policy) {
        return fail("The selected Ollama model did not advertise two ordered thinking settings.", 400);
      }
      const value = policy?.start ?? (effective.value === false && backendId !== "ollama" ? undefined : effective.value);
      const definition = createLocalModelAgentBinding(backendId, model, hash, value, undefined, policy);
      if (policy && input.adaptiveWorkspace) {
        const binding = agentExecutionBindingRegistry.offerAdaptiveStart(definition, input.adaptiveWorkspace);
        return Response.json({ ok: true, binding }, { headers });
      }
      if (!agentExecutionBindingRegistry.has(definition.bindingId)) agentExecutionBindingRegistry.register(definition);
      return Response.json({ ok: true, binding: executionBindingSummary(agentExecutionBindingRegistry.resolve(definition.bindingId)) }, { headers });
    }
    const binding = openAiSessionBindings(agentExecutionBindingRegistry).admitProvider(connection, hash, capabilities);
    const config = resolveApiConnection(connection).providerConfig;
    if (input.enableResearch && connection.providerId === "openai_compatible" && config.baseUrl === "https://api.openai.com/v1") admitSessionWebResearch(config.apiKey, config.model);
    return Response.json({ ok: true, binding }, { headers });
  } catch (error) {
    if (error instanceof ProviderConnectionError) return fail(error.message, error.status);
    // No provider response text, credentials, private endpoints or stack traces.
    return fail("The selected provider connection is unavailable. Check its settings and retry.", 502);
  }
}
