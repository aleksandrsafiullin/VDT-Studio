import { createHash } from "node:crypto";
import {
  AgentRunStore,
  AgentRunStateSupervisorPersistence,
  createDefaultToolRegistry,
  createVdtAgentRuntime,
  researchProviderStatus,
  resolveResearchProviderFromEnv,
  type AgentDecisionProvider,
  type AgentExecutionSummaryV2,
  type AgentSupervisorPersistence,
  type ResearchProviderStatus,
  type ResearchProviderEnv,
  type ResearchProviderResolverOptions,
  type ToolRegistry,
  type VdtAgentPublicStartRequest,
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
import {
  createLazyProjectedSqliteAgentSupervisorPersistence,
  createLazySqliteAgentSupervisorPersistence
} from "./sqlite-supervisor-persistence";
import { createManagedAwareAiProvider } from "./managed-ai-provider";
import {
  AgentExecutionBindingError,
  AgentExecutionBindingRegistry,
  createDefaultModelAgentExecutionBinding,
  executionBindingSummary,
  isLegacyModelExecutionBinding,
  isStructuredModelExecutionBinding,
  type AgentExecutionBindingDefinition,
  type LegacyModelAgentExecutionBindingDefinition
} from "./execution-bindings";
import { modelAgentToolCatalogHash } from "./model-agent-tool-catalog";

const runtimeGlobal = globalThis as typeof globalThis & {
  __vdtAgentRuntime?: ReturnType<typeof createVdtAgentRuntime>;
  __vdtAgentExecutionBindingRegistry?: AgentExecutionBindingRegistry;
  __vdtSqliteBackedAgentRunStores?: WeakSet<AgentRunStore>;
  __vdtAgentSupervisorReadAuthorities?: WeakMap<AgentRunStore, AgentSupervisorPersistence>;
};

const sqliteBackedAgentRunStores =
  runtimeGlobal.__vdtSqliteBackedAgentRunStores ?? new WeakSet<AgentRunStore>();
const supervisorReadAuthorities =
  runtimeGlobal.__vdtAgentSupervisorReadAuthorities
  ?? new WeakMap<AgentRunStore, AgentSupervisorPersistence>();

export const agentRuntime =
  runtimeGlobal.__vdtAgentRuntime ?? createVdtAgentRuntime({
    store: createAgentRunStore(),
    tools: createAgentToolRegistryFromEnv()
  });

export const agentExecutionBindingRegistry =
  runtimeGlobal.__vdtAgentExecutionBindingRegistry ?? new AgentExecutionBindingRegistry();

ensureDefaultModelAgentBinding(agentExecutionBindingRegistry);

if (process.env.NODE_ENV !== "production") {
  runtimeGlobal.__vdtAgentRuntime = agentRuntime;
  runtimeGlobal.__vdtAgentExecutionBindingRegistry = agentExecutionBindingRegistry;
  runtimeGlobal.__vdtSqliteBackedAgentRunStores = sqliteBackedAgentRunStores;
  runtimeGlobal.__vdtAgentSupervisorReadAuthorities = supervisorReadAuthorities;
}

export function createAgentDecisionProvider(request: VdtAgentStartRequest, requestUrl: string): AgentDecisionProvider {
  return createManagedAwareAiProvider(resolveProviderRequest(request), requestUrl) as AgentDecisionProvider;
}

export const createAgentPlanningProvider = createAgentDecisionProvider;

export interface ResolvedAgentStartRequest {
  readonly request: VdtAgentStartRequest;
  readonly binding?: AgentExecutionBindingDefinition | undefined;
  readonly executionSummary?: AgentExecutionSummaryV2 | undefined;
}

/** Resolves the public binding ID on the server and converts it to the current
 * internal request shape. External bindings are never sent through this
 * compatibility adapter: they require the dedicated session engine wiring. */
export function resolveAgentStartRequest(
  request: VdtAgentPublicStartRequest
): ResolvedAgentStartRequest {
  if (!("executionBindingId" in request)) {
    return { request };
  }

  const binding = agentExecutionBindingRegistry.resolve(request.executionBindingId);
  const { executionBindingId, ...common } = request;
  if (isStructuredModelExecutionBinding(binding)) {
    return {
      request: {
        ...common,
        executionBindingId,
        // Internal persistence still uses the legacy request envelope. This
        // marker never selects a provider; the public route branches to the
        // dedicated Supervisor before provider initialization.
        providerId: "model_agent"
      },
      binding
    };
  }
  if (!isLegacyModelExecutionBinding(binding)) {
    throw new AgentExecutionBindingError(
      "EXTERNAL_ENGINE_NOT_WIRED",
      "The requested external execution engine is not wired into this route."
    );
  }

  const resolved: VdtAgentStartRequest = {
    ...common,
    executionBindingId,
    providerId: binding.legacyCompatibilityAdapter.providerId
  };
  return {
    request: resolved,
    binding,
    executionSummary: compatibilityExecutionSummary(binding)
  };
}

export function readAgentProviderConfig(
  request: VdtAgentStartRequest
): Record<string, unknown> | undefined {
  return resolveProviderRequest(request).providerConfig;
}

export function isLegacyAgentCompatibilityEnabled(
  env: {
    readonly NODE_ENV?: string | undefined;
    readonly VDT_AGENT_LEGACY_COMPATIBILITY_ENABLED?: string | undefined;
  } = process.env
): boolean {
  return env.NODE_ENV === "test" || env.VDT_AGENT_LEGACY_COMPATIBILITY_ENABLED === "true";
}

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

  const store = new AgentRunStore({
    persistence: createLazySqliteAgentRunPersistence(process.cwd(), {
      ...(env
        ? {
            actorFactory: (projectId) =>
              createStorageWriteActor(projectId, { env })
          }
        : {})
    })
  });
  sqliteBackedAgentRunStores.add(store);
  return store;
}

/** Uses normalized Sequence 4 SQLite as the Supervisor authority whenever the
 * legacy run store itself is trusted/persistent. The V1 JSON state remains a
 * projection for existing readers; normalized failures never fall back. */
export function createAgentSupervisorPersistence(
  store: AgentRunStore = agentRuntime.store
): AgentSupervisorPersistence {
  const legacyProjection = new AgentRunStateSupervisorPersistence(store);
  if (!hasSqliteAgentRunPersistence(store)) {
    return legacyProjection;
  }
  return createLazyProjectedSqliteAgentSupervisorPersistence(
    process.cwd(),
    legacyProjection
  );
}

/** Read/recovery authority paired to the actual run-store instance. Persistent
 * stores read normalized Sequence 4 directly and never consult the lossy V1
 * projection after a primary commit. */
export function createAgentSupervisorReadPersistence(
  store: AgentRunStore = agentRuntime.store
): AgentSupervisorPersistence {
  const existing = supervisorReadAuthorities.get(store);
  if (existing) return existing;
  const persistence = hasSqliteAgentRunPersistence(store)
    ? createLazySqliteAgentSupervisorPersistence(process.cwd())
    : new AgentRunStateSupervisorPersistence(store);
  supervisorReadAuthorities.set(store, persistence);
  return persistence;
}

/** Explicit factory-pairing capability; unlike an environment re-check this
 * describes how this exact store instance was constructed and survives dev HMR. */
export function hasSqliteAgentRunPersistence(store: AgentRunStore): boolean {
  return sqliteBackedAgentRunStores.has(store);
}

function ensureDefaultModelAgentBinding(registry: AgentExecutionBindingRegistry): void {
  try {
    registry.register(createDefaultModelAgentExecutionBinding({
      env: process.env,
      toolCatalogHash: modelAgentToolCatalogHash(agentRuntime.tools)
    }));
  } catch (error) {
    if (
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "BINDING_ALREADY_REGISTERED"
    ) return;
    throw error;
  }
}

function isNextProductionBuild(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

function resolveProviderRequest(request: VdtAgentStartRequest): VdtAgentStartRequest {
  if (!request.executionBindingId) return request;
  const binding = agentExecutionBindingRegistry.resolve(request.executionBindingId);
  if (!isLegacyModelExecutionBinding(binding)) {
    throw new AgentExecutionBindingError(
      "EXTERNAL_ENGINE_NOT_WIRED",
      "The requested external execution engine is not wired into this route."
    );
  }
  const timeoutMs = request.providerConfig?.timeoutMs;
  return {
    ...request,
    providerId: binding.legacyCompatibilityAdapter.providerId,
    providerConfig: {
      ...(binding.legacyCompatibilityAdapter.providerConfig ?? {}),
      ...(typeof timeoutMs === "number" ? { timeoutMs } : {})
    }
  };
}

function compatibilityExecutionSummary(
  binding: LegacyModelAgentExecutionBindingDefinition
): AgentExecutionSummaryV2 {
  const summary = executionBindingSummary(binding);
  const timestamp = new Date().toISOString();
  return {
    schemaVersion: 2,
    executionProfile: summary.executionProfile,
    engineId: summary.engineId,
    engineAdapterId: summary.engineAdapterId,
    backendId: summary.backendId,
    modelId: summary.modelId,
    protocolVersion: binding.capability.protocolVersion,
    cliVersion: null,
    toolIsolation: binding.capability.toolIsolation,
    qualificationStatus: binding.capability.qualification.status,
    capabilityEvidenceHash: binding.capability.qualification.evidenceHash,
    capabilityProfileHash: hashJson(binding.capability),
    toolCatalogHash: binding.capability.toolCatalogHash,
    sessionStatus: "bound",
    recoveryStatus: "ready",
    sessionEpoch: 1,
    externalSessionBound: false,
    lastCheckpointId: null,
    pendingOperation: null,
    finishState: null,
    boundAt: timestamp,
    updatedAt: timestamp
  };
}

function hashJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(sortJson(value))).digest("hex")}`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJson(entry)])
  );
}

export function jsonError(message: string, status = 400, code = "AGENT_REQUEST_ERROR") {
  return Response.json({ ok: false, error: { code, message } }, { status });
}
