import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AgentExecutionBindingRegistry, createDefaultModelAgentExecutionBinding, executionBindingSummary } from "./execution-bindings";

export const openAiBindingInputSchema = z.object({
  apiKey: z.string().trim().min(1).max(1024),
  model: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/),
  maxTokens: z.number().int().min(1).max(32768).optional()
}).strict();

const PREFIX = "openai_byok_session_";
const TTL_MS = 60_000;

/** One-use server admission. Credentials stay in the immutable in-memory
 * definition, never in a public run request, discovery summary or SQLite. */
export class OpenAiSessionBindingRegistrar {
  private readonly pending = new Map<string, { dispose: () => void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private readonly registry: AgentExecutionBindingRegistry) {}

  admit(input: z.infer<typeof openAiBindingInputSchema>, toolCatalogHash: string) {
    const parsed = openAiBindingInputSchema.parse(input);
    if (this.pending.size >= 16) throw new Error("Too many pending OpenAI sessions. Wait a minute and try again.");
    const bindingId = `${PREFIX}${randomUUID().replaceAll("-", "")}`;
    const base = createDefaultModelAgentExecutionBinding({ env: {
      NODE_ENV: "production", VDT_MODEL_AGENT_ENABLED: "true", VDT_MODEL_AGENT_PROVIDER: "openai_compatible",
      VDT_MODEL_AGENT_MODEL: parsed.model, VDT_MODEL_AGENT_MAX_TOKENS: String(parsed.maxTokens ?? 8000)
    }, toolCatalogHash });
    const definition = {
      ...base, bindingId,
      capability: { ...base.capability, engineAdapterId: "openai-byok-structured-turn-v1" },
      modelEngineAdapter: { ...base.modelEngineAdapter, providerConfig: {
        baseUrl: "https://api.openai.com/v1", model: parsed.model, apiKey: parsed.apiKey
      } }
    };
    const dispose = this.registry.register(definition);
    const timer = setTimeout(() => this.consume(bindingId), TTL_MS);
    timer.unref?.();
    this.pending.set(bindingId, { dispose, timer });
    return executionBindingSummary(definition);
  }

  consume(bindingId: string) {
    const pending = this.pending.get(bindingId);
    if (!pending) return;
    clearTimeout(pending.timer); pending.dispose(); this.pending.delete(bindingId);
  }
}

const processState = globalThis as typeof globalThis & {
  __vdtOpenAiSessionBindingRegistrars?: WeakMap<AgentExecutionBindingRegistry, OpenAiSessionBindingRegistrar>;
};
export function openAiSessionBindings(registry: AgentExecutionBindingRegistry) {
  const registrars = processState.__vdtOpenAiSessionBindingRegistrars ??= new WeakMap();
  let registrar = registrars.get(registry);
  if (!registrar) { registrar = new OpenAiSessionBindingRegistrar(registry); registrars.set(registry, registrar); }
  return registrar;
}
export function isOpenAiSessionBinding(bindingId: string) { return bindingId.startsWith(PREFIX); }
