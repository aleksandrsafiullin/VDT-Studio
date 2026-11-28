import { AppleTransportError } from "@vdt-studio/local-runner/apple-foundation-models";
import type { AiCompletionParams, AiProvider } from "@vdt-studio/ai-harness";
import { validateChatStarterInput, validateChatStarterOutput } from "@vdt-studio/vdt-core";
import { resolveAppleNativeTaskExecution } from "./apple-native-binding";
import { APPLE_NATIVE_PROVIDER_ID, completeAppleNativeBoundedTask } from "./apple-native-host";
import { agentExecutionBindingRegistry } from "./runtime";

export function createAppleNativeChatStarterProvider(request: { providerConfig?: Record<string, unknown>; expectedExecution?: unknown }): AiProvider {
  const { port, pinned } = resolveAppleNativeTaskExecution(agentExecutionBindingRegistry, request, "bounded_task");
  return {
    id: APPLE_NATIVE_PROVIDER_ID, name: "Apple Foundation Models", type: "local_runner",
    async completeStructured<TInput, TOutput>(params: AiCompletionParams<TInput>): Promise<TOutput> {
      if (params.taskType !== "suggest_chat_starters") throw new AppleTransportError("invalid_request");
      const input = validateChatStarterInput(params.input);
      if (input.locale !== pinned.locale) throw new AppleTransportError("stale_identity");
      const result = await completeAppleNativeBoundedTask({
        port, pinned, input, signal: params.signal,
        task: {
          schema: { kind: "object", fields: [{ name: "prompts", shape: { kind: "array", element: { kind: "string" }, maxItems: 3 } }] },
          maxOutputTokens: 320, timeoutMs: 15_000,
          buildPrompt: context => `${params.systemPrompt}\n${JSON.stringify(context)}`,
          validateCanonical: validateChatStarterOutput
        }
      });
      return result.value as TOutput;
    }
  };
}
