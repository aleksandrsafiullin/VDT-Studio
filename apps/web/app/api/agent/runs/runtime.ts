import {
  AgentRunStore,
  createDefaultToolRegistry,
  createVdtAgentRuntime,
  researchProviderStatus,
  resolveResearchProviderFromEnv,
  type AgentDecisionProvider,
  type ResearchProviderStatus,
  type ResearchProviderEnv,
  type ResearchProviderResolverOptions,
  type ToolRegistry,
  type VdtAgentStartRequest
} from "@vdt-studio/vdt-agent-runtime";
import {
  createStorageWriteActor,
  resolveTrustedStorageWriteMode,
  type StorageWriteEnvironment
} from "../../vdt/storage-write-adapter";
import {
  createLazySqliteAgentRunPersistence
} from "./persistence";
import { createManagedAwareAiProvider } from "./managed-ai-provider";

const runtimeGlobal = globalThis as typeof globalThis & {
  __vdtAgentRuntime?: ReturnType<typeof createVdtAgentRuntime>;
};

export const agentRuntime =
  runtimeGlobal.__vdtAgentRuntime ?? createVdtAgentRuntime({
    store: createAgentRunStore(),
    tools: createAgentToolRegistryFromEnv()
  });

if (process.env.NODE_ENV !== "production") {
  runtimeGlobal.__vdtAgentRuntime = agentRuntime;
}

export function createAgentDecisionProvider(request: VdtAgentStartRequest, requestUrl: string): AgentDecisionProvider {
  return createManagedAwareAiProvider(request, requestUrl) as AgentDecisionProvider;
}

export const createAgentPlanningProvider = createAgentDecisionProvider;

export function createAgentToolRegistryFromEnv(
  env: ResearchProviderEnv = process.env,
  options: ResearchProviderResolverOptions = {}
): ToolRegistry {
  const researchProvider = resolveResearchProviderFromEnv(env, options);
  return createDefaultToolRegistry({ researchProvider });
}

export function resolveAgentResearchStatusFromEnv(
  env: ResearchProviderEnv = process.env,
  options: ResearchProviderResolverOptions = {}
): ResearchProviderStatus {
  return researchProviderStatus(resolveResearchProviderFromEnv(env, options));
}

export function createAgentRunStore(env?: StorageWriteEnvironment): AgentRunStore {
  if (isNextProductionBuild() || !resolveTrustedStorageWriteMode(env)) {
    return new AgentRunStore();
  }

  return new AgentRunStore({
    persistence: createLazySqliteAgentRunPersistence(process.cwd(), {
      ...(env
        ? {
            actorFactory: (projectId) =>
              createStorageWriteActor(projectId, { env })
          }
        : {})
    })
  });
}

function isNextProductionBuild(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

export function jsonError(message: string, status = 400, code = "AGENT_REQUEST_ERROR") {
  return Response.json({ ok: false, error: { code, message } }, { status });
}
