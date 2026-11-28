import { z } from "zod";
import { readBoundedText } from "@vdt-studio/ai-harness";
import { AppleTransportError } from "@vdt-studio/local-runner/apple-foundation-models";
import { executionExpectationSchema } from "@vdt-studio/vdt-agent-runtime";
import { hasSameLocalOrigin } from "@/lib/local-request-origin";
import { createAppleNativeBinding, resolveAppleNativeTaskExecution } from "../../../runs/apple-native-binding";
import { APPLE_NATIVE_PROVIDER_ID, completeAppleNativeBoundedTask, type AppleNativeBoundedTask } from "../../../runs/apple-native-host";
import { modelAgentToolCatalogHash } from "../../../runs/model-agent-tool-catalog";
import { agentExecutionBindingRegistry, agentRuntime } from "../../../runs/runtime";

const requestSchema = z.object({
  bindingId: z.string().regex(/^apple_native_[a-f0-9]{64}$/),
  locale: z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/),
  expectedExecution: executionExpectationSchema
}).strict();
const outputSchema = z.object({ value: z.literal(2_000), unit: z.literal("USD") }).strict();
const diagnosticTask: AppleNativeBoundedTask<undefined, z.infer<typeof outputSchema>> = {
  schema: { kind: "object", fields: [
    { name: "value", description: "Revenue as an integer", shape: { kind: "integer" } },
    { name: "unit", description: "ISO currency code", shape: { kind: "choice", choices: ["USD"] } }
  ] },
  maxOutputTokens: 128,
  timeoutMs: 14_000,
  buildPrompt: () => "Calculate revenue for 100 units at 20 USD each. Return the integer amount and ISO currency code.",
  validateCanonical: value => outputSchema.parse(value)
};

const headers = { "cache-control": "no-store" };

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (!hasSameLocalOrigin(request) || contentType !== "application/json") {
    return Response.json({ ok: false, code: "invalid_request", error: "Run the Apple inference test from desktop Settings." }, { status: 403, headers });
  }

  const deadline = AbortSignal.timeout(20_000);
  const signal = AbortSignal.any([request.signal, deadline]);
  try {
    let input: z.infer<typeof requestSchema>;
    try {
      const body = await readBoundedText(new Response(request.body), 512, "Apple inference test",
        AbortSignal.any([signal, AbortSignal.timeout(4_000)]));
      input = requestSchema.parse(JSON.parse(body));
    } catch {
      if (signal.aborted) throw new AppleTransportError("cancelled");
      throw new AppleTransportError("invalid_request");
    }
    if (signal.aborted) throw new AppleTransportError("cancelled");
    const { port, pinned } = resolveAppleNativeTaskExecution(agentExecutionBindingRegistry, {
      providerConfig: { bindingId: input.bindingId },
      expectedExecution: input.expectedExecution
    }, "generation_diagnostics");
    const catalogHash = modelAgentToolCatalogHash(agentRuntime.tools);
    if (pinned.locale !== input.locale || createAppleNativeBinding(pinned, catalogHash).bindingId !== input.bindingId) {
      throw new AppleTransportError("stale_identity");
    }

    const completion = await completeAppleNativeBoundedTask({ port, pinned, task: diagnosticTask, input: undefined, signal });
    if (signal.aborted) throw new AppleTransportError("cancelled");
    return Response.json({
      ok: true,
      providerId: APPLE_NATIVE_PROVIDER_ID,
      bindingId: input.bindingId,
      locale: pinned.locale,
      identity: pinned.identity,
      result: completion.value,
      context: completion.context
    }, { headers });
  } catch (error) {
    const known = request.signal.aborted ? new AppleTransportError("cancelled")
      : deadline.aborted ? new AppleTransportError("timeout")
      : error instanceof AppleTransportError ? error : new AppleTransportError("unavailable");
    const status = known.code === "invalid_request" ? 400 : known.code === "timeout" ? 504 : 409;
    return Response.json({ ok: false, code: known.code, error: known.message }, { status, headers });
  }
}
