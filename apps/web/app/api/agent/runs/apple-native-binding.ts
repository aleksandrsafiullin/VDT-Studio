import { createHash } from "node:crypto";
import { AppleTransportError, type AppleModelCapability } from "@vdt-studio/local-runner/apple-foundation-models";
import {
  AgentExecutionBindingError,
  AgentExecutionBindingRegistry,
  createDefaultModelAgentExecutionBinding,
  executionBindingSummary,
  isStructuredModelExecutionBinding,
  type StructuredModelAgentExecutionBindingDefinition
} from "./execution-bindings";
import { APPLE_NATIVE_PROVIDER_ID, discoverAppleNativeCapability, packagedAppleNativePort, type AppleNativePort } from "./apple-native-host";
import { executionExpectationSchema } from "@vdt-studio/vdt-agent-runtime";
import { assertAnalyticalAdmission, hostExecutionAdmission, type AnalyticalTask } from "./execution-binding-admission";

export function createAppleNativeBinding(capability: AppleModelCapability, catalogHash: string): StructuredModelAgentExecutionBindingDefinition {
  const base = createDefaultModelAgentExecutionBinding({
    env: { VDT_MODEL_AGENT_ENABLED: "true", VDT_MODEL_AGENT_MODEL: capability.identity.model },
    toolCatalogHash: catalogHash
  });
  const suffix = createHash("sha256").update(JSON.stringify([
    capability.identity.model, capability.identity.osBuild, capability.identity.profile, capability.identity.modelRevision,
    capability.locale, capability.contextSize, catalogHash
  ])).digest("hex");
  return {
    ...base,
    bindingId: `apple_native_${suffix}`,
    capability: { ...base.capability, backendId: APPLE_NATIVE_PROVIDER_ID, engineAdapterId: "apple-native-guided-v1" },
    modelEngineAdapter: { providerId: APPLE_NATIVE_PROVIDER_ID, appleCapability: capability }
  };
}

export async function admitAppleNativeBinding(port: AppleNativePort, registry: AgentExecutionBindingRegistry, locale: string, catalogHash: string, signal?: AbortSignal) {
  const capability = await discoverAppleNativeCapability(port, locale, signal);
  const binding = createAppleNativeBinding(capability, catalogHash);
  if (!registry.has(binding.bindingId)) registry.register(binding);
  return executionBindingSummary(registry.resolve(binding.bindingId));
}

export function resolveAppleNativeTaskExecution(
  registry: AgentExecutionBindingRegistry,
  request: { providerConfig?: Record<string, unknown> | undefined; expectedExecution?: unknown },
  task: AnalyticalTask
) {
  const port = packagedAppleNativePort();
  if (!port) throw new AppleTransportError("unsupported_os");
  const config = request.providerConfig;
  const expected = executionExpectationSchema.safeParse(request.expectedExecution);
  if (!config || Object.keys(config).length !== 1 || typeof config.bindingId !== "string"
    || !expected.success || expected.data.mode !== "local" || expected.data.providerId !== APPLE_NATIVE_PROVIDER_ID) {
    throw new AppleTransportError("invalid_request");
  }
  try {
    const binding = registry.resolve(config.bindingId);
    const pinned = isStructuredModelExecutionBinding(binding) ? binding.modelEngineAdapter.appleCapability : undefined;
    if (!pinned) throw new AppleTransportError("stale_identity");
    assertAnalyticalAdmission(hostExecutionAdmission(binding), task, "off", expected.data);
    return { port, pinned };
  } catch (error) {
    if (error instanceof AgentExecutionBindingError) throw new AppleTransportError("stale_identity");
    throw error;
  }
}
