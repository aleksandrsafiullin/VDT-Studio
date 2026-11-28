import { z } from "zod";
import type { PublicAgentExecutionBindingSummary } from "./agent-client";
import { readAppleLaunchBinding, type AppleLaunchAvailability } from "./apple-first-launch";

export async function readAppleLaunchAvailability(signal?: AbortSignal): Promise<AppleLaunchAvailability> {
  const response = await fetch("/api/agent/bindings/apple", {
    cache: "no-store",
    ...(signal ? { signal } : {})
  });
  if (!response.ok) throw new Error("Apple model availability could not be checked. Try again or choose another model.");
  const result = await response.json() as Partial<AppleLaunchAvailability>;
  return { enabled: result.enabled === true, firstLaunchDefaultEnabled: result.enabled === true && result.firstLaunchDefaultEnabled === true };
}

export async function prepareAppleNativeAgentBinding(locale: string, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<PublicAgentExecutionBindingSummary> {
  const response = await fetcher("/api/agent/bindings/apple", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ locale }),
    ...(signal ? { signal } : {})
  });
  const result = await response.json() as { ok?: boolean; binding?: PublicAgentExecutionBindingSummary; error?: string };
  const binding = result.binding;
  if (!response.ok || !result.ok || !binding) {
    throw new Error(result.error ?? "Apple on-device model preview could not be verified.");
  }
  return readAppleLaunchBinding(binding, locale);
}

const appleDiagnosticReceiptSchema = z.object({
  ok: z.literal(true),
  providerId: z.literal("apple_foundation_models"),
  bindingId: z.string(),
  locale: z.string(),
  identity: z.object({
    model: z.literal("SystemLanguageModel.default"),
    osBuild: z.string().min(1),
    profile: z.literal("vdt-native-guided-v1"),
    modelRevision: z.null()
  }).strict(),
  result: z.object({ value: z.literal(2_000), unit: z.literal("USD") }).strict(),
  context: z.object({
    inputTokens: z.number().int().positive().max(8_064),
    contextSize: z.literal(8_192),
    reservedOutputTokens: z.literal(128)
  }).strict()
}).strict();

export type AppleDiagnosticReceipt = z.infer<typeof appleDiagnosticReceiptSchema>;

export async function runAppleInferenceDiagnostic(
  binding: PublicAgentExecutionBindingSummary,
  locale: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch
): Promise<AppleDiagnosticReceipt> {
  const { admission } = readAppleLaunchBinding(binding, locale);
  if (!admission) throw new Error("The desktop could not verify the Apple binding. Reopen VDT Studio and retry.");
  const { mode, profileVersion, providerId, modelId, modelRevision } = admission;
  const expectedExecution = { mode, profileVersion, providerId, modelId, modelRevision };
  const response = await fetcher("/api/agent/bindings/apple/diagnostic", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bindingId: binding.bindingId, locale, expectedExecution }),
    cache: "no-store",
    signal
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const failure = z.object({ ok: z.literal(false), code: z.string() }).safeParse(result);
    switch (failure.data?.code) {
      case "unsupported_locale":
        throw new Error("The Apple model does not support this language. Use a supported system language or choose another model.");
      case "apple_intelligence_disabled":
      case "model_not_ready":
        throw new Error("Check Apple Intelligence in System Settings and wait for the model to be ready, then retry.");
      case "stale_identity":
        throw new Error("The Apple model identity changed. Reopen VDT Studio to check availability again.");
      case "unsupported_os":
      case "unsupported_sdk":
      case "device_not_eligible":
      case "helper_identity":
        throw new Error("Apple inference is unavailable in this app or on this Mac. Check the installed preview build or choose another model.");
      case "timeout":
        throw new Error("The Apple inference test timed out. Try again.");
      case "busy":
      case "rate_limited":
        throw new Error("The Apple model is busy. Wait for the current work to finish, then retry.");
      case "cancelled":
        throw new Error("The Apple inference test was cancelled.");
      case "invalid_output":
        throw new Error("The Apple model did not return the expected result. Retry the test or choose another model.");
      default:
        throw new Error("The Apple inference test could not be completed. Retry the test or choose another model.");
    }
  }
  const receipt = appleDiagnosticReceiptSchema.safeParse(result);
  if (!receipt.success || receipt.data.bindingId !== binding.bindingId || receipt.data.locale !== locale
    || receipt.data.identity.model !== binding.modelId || receipt.data.identity.osBuild !== binding.appleIdentity?.osBuild
    || receipt.data.identity.modelRevision !== binding.admission?.modelRevision) {
    throw new Error("The desktop could not verify the Apple inference result. Reopen VDT Studio and retry.");
  }
  return receipt.data;
}
