import { z } from "zod";
import { resolveTrustedStorageWriteMode } from "@/app/api/vdt/storage-write-adapter";
import { hasSameLocalOrigin } from "@/lib/local-request-origin";
import { readBoundedText } from "@vdt-studio/ai-harness";
import { createLocalRuntimeContext, listRuntimeModels } from "@vdt-studio/local-runner/server-runtime";
import { agentExecutionBindingRegistry, agentRuntime } from "../../runs/runtime";
import { modelAgentToolCatalogHash } from "../../runs/model-agent-tool-catalog";
import { openAiSessionBindings } from "../../runs/byok-bindings";
import { createLocalModelAgentBinding } from "../../runs/local-model-bindings";
import { executionBindingSummary } from "../../runs/execution-bindings";
import { providerConnectionSchema, providerModelCapabilities, validatedReasoningConfig, resolveApiConnection, ProviderConnectionError } from "../../runs/provider-model-capabilities";
import { admitSessionWebResearch } from "../../runs/session-research";

const envelope = z.object({ operation: z.enum(["capabilities", "admit"]), providerId: z.string(), providerConfig: z.unknown(), enableResearch: z.boolean().optional() }).strict();

export async function POST(request: Request) {
  const headers = { "cache-control": "no-store" };
  const fail = (message: string, status: number) => Response.json({ ok: false, error: message }, { status, headers });
  if (!resolveTrustedStorageWriteMode() || process.env.NEXT_PHASE === "phase-production-build" || (process.env.NODE_ENV === "production" && process.env.VDT_MODEL_AGENT_ENABLED !== "true")) return fail("Provider chat requires an enabled trusted local application.", 403);
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
  try {
    // Validate endpoint authority even for Default/no-capability admissions.
    if (connection.providerId !== "local_runner") resolveApiConnection(connection);
    const directOpenAi = connection.providerId === "openai_compatible" && resolveApiConnection(connection).providerConfig.baseUrl === "https://api.openai.com/v1";
    const capabilities = input.operation === "capabilities" || connection.providerConfig.modelReasoning !== undefined || directOpenAi
      ? await providerModelCapabilities(connection) : undefined;
    if (input.operation === "capabilities") return Response.json({ ok: true, modelId: connection.providerConfig.model, capabilities: capabilities ?? null }, { headers });
    const hash = modelAgentToolCatalogHash(agentRuntime.tools);
    if (connection.providerId === "local_runner") {
      const { backendId, model, modelReasoning } = connection.providerConfig;
      const result = await listRuntimeModels(backendId, createLocalRuntimeContext());
      const models = (result.payload as { models?: string[] }).models ?? [];
      if (!models.some((id) => id === model || (backendId === "ollama" && id === `${model}:latest`))) throw new ProviderConnectionError("The selected local model is not installed or loaded. Refresh the model list.");
      validatedReasoningConfig(capabilities, modelReasoning);
      const definition = createLocalModelAgentBinding(backendId, model, hash, modelReasoning);
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
