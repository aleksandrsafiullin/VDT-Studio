import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { listHarnessDefinitions, harnessDefinitionVersion, harnessOpaqueIdentity, detectSubscriptionCli, probeHarnessModels, HarnessCheckpointTransport, createHarnessCheckpointEngine, harnessEngineAdapterId } from "@vdt-studio/model-bridge/node";
import type { AgentExecutionEngine, AgentEngineCheckpoint, AgentSessionBinding } from "@vdt-studio/vdt-agent-runtime";
import { matchesCliSessionBinding, cliSessionModelBindingId } from "./cli-session-model-binding";

const admitted = new Map<string, { engineAdapterId: string; harnessId: string; version: string; engine: AgentExecutionEngine; modelIds: Set<string> }>();
const currentBindings = new Map<string, string>();
const refreshTimes = new Map<string, number>();
let pending: Promise<void> | undefined;
export function isAdmittedHarnessSession(input: { bindingId: string; engineAdapterId: string; modelId?: string | undefined; reasoningEffort?: unknown }): boolean {
  return input.reasoningEffort === undefined && [...admitted].some(([id, entry]) => entry.engineAdapterId === input.engineAdapterId && matchesCliSessionBinding(input.bindingId, id, input.modelId));
}
export function isCurrentHarnessSession(bindingId: string): boolean {
  const match = [...admitted].find(([id]) => bindingId === id || bindingId.startsWith(`${id}_model_`));
  if (!match) return !bindingId.startsWith("harness_session_");
  const [id, entry] = match;
  const h = listHarnessDefinitions().find(h => h.id === entry.harnessId);
  return Boolean(h && harnessDefinitionVersion(h) === entry.version && currentBindings.get(h.id) === id);
}
export async function registerHarnessSessionBindings(options: {
  toolCatalogHash: string; allowedToolNames: readonly string[]; forbiddenRoots: readonly string[];
  register: (input: { bindingId: string; engine: AgentExecutionEngine; modelId: string }) => void;
  resolveBinding: (checkpoint: AgentEngineCheckpoint) => Promise<AgentSessionBinding>;
}): Promise<void> {
  if (pending) return pending;
  pending = (async () => {
    const defs = listHarnessDefinitions().filter(h => h.transport !== "native");
    await Promise.allSettled(defs.map(async h => {
      const version = harnessDefinitionVersion(h), key = `${h.id}:${version}`;
      if (Date.now() - (refreshTimes.get(key) ?? 0) < 60_000) return;
      refreshTimes.set(key, Date.now());
      const detection = await detectSubscriptionCli(h.id);
      if (!detection.installed || !detection.executable || !detection.version) return;
      const models = await probeHarnessModels(h, AbortSignal.timeout(5000));
      const identity = harnessOpaqueIdentity(h, detection.executable, detection.version, process.env, { purpose: "chat" });
      const instanceVersion = createHash("sha256").update(JSON.stringify([version, identity])).digest("hex");
      const bindingId = `harness_session_${instanceVersion.slice(0, 32)}`;
      const previous = admitted.get(bindingId);
      if (previous) {
        currentBindings.set(h.id, bindingId);
        for (const model of models.slice(0, 100)) if (!previous.modelIds.has(model.id)) {
          options.register({ bindingId: cliSessionModelBindingId(bindingId, model.id), engine: previous.engine, modelId: model.id }); previous.modelIds.add(model.id);
        }
        return;
      }
      const transport = new HarnessCheckpointTransport(h, detection.executable, detection.version);
      const environments = new Map<string, { root: string; environmentId: string; privateWorkspacePath: string; privateStatePath: string; forbiddenRoots: readonly string[]; close: () => Promise<void> }>();
      const engine = createHarnessCheckpointEngine({ definition: h, executable: detection.executable, cliVersion: detection.version, transport, toolCatalogHash: options.toolCatalogHash, allowedToolNames: options.allowedToolNames, enableUnverifiedCanary: true, resolveBinding: options.resolveBinding,
        sessionEnvironmentFactory: async ({ binding, recovery }) => {
          const existing = environments.get(binding.runId); if (existing) return existing;
          if (recovery) throw Object.assign(new Error("The original harness session environment is unavailable; start a new run."), { code: "RECOVERY_REQUIRED" });
          const root = await mkdtemp(path.join(tmpdir(), "vdt-harness-session-"));
          const env = { root, environmentId: `${h.id}-${path.basename(root)}`, privateWorkspacePath: root, privateStatePath: root, forbiddenRoots: options.forbiddenRoots,
            close: async () => { await transport.closeEnvironment(env.environmentId); environments.delete(binding.runId); await rm(root, { recursive: true, force: true }); } };
          environments.set(binding.runId, env); return env;
        }
      });
      const entry = { engineAdapterId: harnessEngineAdapterId(h), harnessId: h.id, version, engine, modelIds: new Set<string>() };
      admitted.set(bindingId, entry);
      currentBindings.set(h.id, bindingId);
      options.register({ bindingId, engine, modelId: h.defaultModel ?? "auto" });
      for (const model of models.slice(0, 100)) { options.register({ bindingId: cliSessionModelBindingId(bindingId, model.id), engine, modelId: model.id }); entry.modelIds.add(model.id); }
    }));
  })();
  try { await pending; } finally { pending = undefined; }
}
