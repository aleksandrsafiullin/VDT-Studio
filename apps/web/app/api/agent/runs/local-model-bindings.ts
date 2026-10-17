import { createHash } from "node:crypto";
import {
  createLocalRuntimeContext,
  listRuntimeModels,
  type LocalRuntimeContext
} from "@vdt-studio/local-runner/server-runtime";
import { resolveTrustedStorageWriteMode, type StorageWriteEnvironment } from "../../vdt/storage-write-adapter";
import {
  AgentExecutionBindingRegistry,
  createDefaultModelAgentExecutionBinding,
  type StructuredModelAgentExecutionBindingDefinition
} from "./execution-bindings";

export const LOCAL_MODEL_AGENT_BACKENDS = ["ollama", "lm_studio", "vllm"] as const;
export type LocalModelAgentBackend = typeof LOCAL_MODEL_AGENT_BACKENDS[number];

export function isLocalModelAgentBackend(value: string): value is LocalModelAgentBackend {
  return LOCAL_MODEL_AGENT_BACKENDS.some((backend) => backend === value);
}

interface LocalModelAgentEnvironment extends StorageWriteEnvironment {
  readonly NODE_ENV?: string | undefined;
  readonly NEXT_PHASE?: string | undefined;
  readonly VDT_LOCAL_MODEL_AGENT_ENABLED?: string | undefined;
}

export function localModelAgentBindingsEnabled(env: LocalModelAgentEnvironment = process.env): boolean {
  return resolveTrustedStorageWriteMode(env) !== null
    && env.NEXT_PHASE !== "phase-production-build"
    && env.VDT_LOCAL_MODEL_AGENT_ENABLED !== "false"
    && (env.NODE_ENV !== "test" || env.VDT_LOCAL_MODEL_AGENT_ENABLED === "true");
}

export function createLocalModelAgentBinding(
  backendId: LocalModelAgentBackend,
  modelId: string,
  toolCatalogHash: string
): StructuredModelAgentExecutionBindingDefinition {
  const definition = createDefaultModelAgentExecutionBinding({
    env: { VDT_MODEL_AGENT_ENABLED: "true", VDT_MODEL_AGENT_PROVIDER: backendId, VDT_MODEL_AGENT_MODEL: modelId },
    toolCatalogHash
  });
  return {
    ...definition,
    bindingId: `local_model_${backendId}_${createHash("sha256").update(modelId).digest("hex")}`,
    capability: { ...definition.capability, engineAdapterId: "local-http-structured-turn-v1" }
  };
}

/** Host discovery admits immutable bindings; the browser never provisions a
 * provider or supplies an endpoint. Empty/failed catalogs remain retryable so
 * installing a model does not require restarting the application. */
export class LocalModelAgentBindingRegistrar {
  private refreshTask: Promise<void> | undefined;
  private refreshAfter = 0;

  constructor(
    private readonly registry: AgentExecutionBindingRegistry,
    private readonly toolCatalogHash: string,
    private readonly context: LocalRuntimeContext = createLocalRuntimeContext(),
    private readonly now: () => number = Date.now
  ) {}

  async refresh(): Promise<void> {
    if (this.refreshTask) return this.refreshTask;
    if (this.now() < this.refreshAfter) return;
    this.refreshTask = this.discover();
    try {
      await this.refreshTask;
      this.refreshAfter = this.now() + 10_000;
    } finally {
      this.refreshTask = undefined;
    }
  }

  private async discover(): Promise<void> {
    await Promise.allSettled(LOCAL_MODEL_AGENT_BACKENDS.map(async (backendId) => {
      const result = await listRuntimeModels(backendId, this.context);
      const models = (result.payload as { models?: unknown })?.models;
      if (!Array.isArray(models)) return;
      for (const model of models.slice(0, 100)) {
        if (typeof model !== "string" || !model.trim() || model.length > 160 || /[\x00-\x20\x7f]/.test(model)) continue;
        const modelIds = backendId === "ollama" && model.endsWith(":latest") && model.length > ":latest".length
          ? [model, model.slice(0, -":latest".length)]
          : [model];
        for (const modelId of modelIds) {
          const binding = createLocalModelAgentBinding(backendId, modelId, this.toolCatalogHash);
          if (!this.registry.has(binding.bindingId)) this.registry.register(binding);
        }
      }
    }));
  }
}
