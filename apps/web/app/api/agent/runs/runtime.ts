import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import {
  AgentRunStore,
  AgentRunStateSupervisorPersistence,
  createDefaultToolRegistry,
  createVdtAgentRuntime,
  researchProviderStatus,
  resolveResearchProviderFromEnv,
  type AgentDecisionProvider,
  type AgentExecutionEngine,
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
  createLazySqliteAgentRunPersistence,
  resolveCliSessionForbiddenRoots
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
  isExternalCliExecutionBinding,
  isLegacyModelExecutionBinding,
  isStructuredModelExecutionBinding,
  type AgentExecutionBindingDefinition,
  type LegacyModelAgentExecutionBindingDefinition
} from "./execution-bindings";
import { TARGET_MODEL_AGENT_TOOLS, modelAgentToolCatalogHash } from "./model-agent-tool-catalog";

const runtimeGlobal = globalThis as typeof globalThis & {
  __vdtAgentRuntime?: ReturnType<typeof createVdtAgentRuntime>;
  __vdtAgentExecutionBindingRegistry?: AgentExecutionBindingRegistry;
  __vdtSqliteBackedAgentRunStores?: WeakSet<AgentRunStore>;
  __vdtAgentSupervisorReadAuthorities?: WeakMap<AgentRunStore, AgentSupervisorPersistence>;
  __vdtExternalAgentEngines?: Map<string, AgentExecutionEngine>;
  __vdtCursorSessionBindingProbe?: Promise<void>;
  __vdtCliSessionRegistrationOutcomes?: Map<CliSessionRegistrarKey, CliSessionRegistrationOutcome>;
};

const CLI_SESSION_REGISTRAR_KEYS = ["cursor", "codex", "claude"] as const;
type CliSessionRegistrarKey = typeof CLI_SESSION_REGISTRAR_KEYS[number];
type CliSessionRegistrationOutcome = "registered" | "absent" | "failed";
type CliSessionRegistrationResult = Exclude<CliSessionRegistrationOutcome, "failed">;

function cliSessionRegistrationOutcomes(): Map<CliSessionRegistrarKey, CliSessionRegistrationOutcome> {
  if (!runtimeGlobal.__vdtCliSessionRegistrationOutcomes) {
    runtimeGlobal.__vdtCliSessionRegistrationOutcomes = new Map();
  }
  return runtimeGlobal.__vdtCliSessionRegistrationOutcomes;
}

function cliSessionRegistrationProbeNeeded(): boolean {
  return CLI_SESSION_REGISTRAR_KEYS.some((key) => {
    const outcome = cliSessionRegistrationOutcomes().get(key);
    return outcome !== "registered" && outcome !== "absent";
  });
}

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

const cliSessionCanaryEnabled = isCliSessionCanaryEnabled();

export const agentExecutionBindingRegistry =
  runtimeGlobal.__vdtAgentExecutionBindingRegistry ?? new AgentExecutionBindingRegistry([], {
    externalProfilesEnabled: cliSessionCanaryEnabled,
    externalEngineWired: cliSessionCanaryEnabled,
    allowUnverifiedExternalCanary: cliSessionCanaryEnabled
  });

const externalAgentEngines = runtimeGlobal.__vdtExternalAgentEngines ?? new Map<string, AgentExecutionEngine>();

ensureDefaultModelAgentBinding(agentExecutionBindingRegistry);

if (process.env.NODE_ENV !== "production") {
  runtimeGlobal.__vdtAgentRuntime = agentRuntime;
  runtimeGlobal.__vdtAgentExecutionBindingRegistry = agentExecutionBindingRegistry;
  runtimeGlobal.__vdtSqliteBackedAgentRunStores = sqliteBackedAgentRunStores;
  runtimeGlobal.__vdtAgentSupervisorReadAuthorities = supervisorReadAuthorities;
  runtimeGlobal.__vdtExternalAgentEngines = externalAgentEngines;
}

export const CURSOR_SESSION_EXECUTION_BINDING_ID = "cursor_session_canary";
export const CODEX_SESSION_EXECUTION_BINDING_ID = "codex_session_canary";
export const CLAUDE_SESSION_EXECUTION_BINDING_ID = "claude_session_canary";

export async function ensureServerManagedExecutionBindings(): Promise<void> {
  if (!cliSessionCanaryEnabled) return;
  if (!cliSessionRegistrationProbeNeeded()) return;
  const existing = runtimeGlobal.__vdtCursorSessionBindingProbe;
  if (existing) {
    try {
      await existing;
    } catch {
      delete runtimeGlobal.__vdtCursorSessionBindingProbe;
    }
    if (!cliSessionRegistrationProbeNeeded()) return;
  }
  const probe = registerCliSessionCanaries();
  if (process.env.NODE_ENV !== "production") {
    runtimeGlobal.__vdtCursorSessionBindingProbe = probe;
  }
  await probe;
  if (cliSessionRegistrationProbeNeeded()) {
    delete runtimeGlobal.__vdtCursorSessionBindingProbe;
  }
}

export function externalAgentEngineForBinding(bindingId: string): AgentExecutionEngine | undefined {
  return externalAgentEngines.get(bindingId);
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
  if (isExternalCliExecutionBinding(binding)) {
    return {
      request: {
        ...common,
        executionBindingId,
        providerId: "external_cli_agent"
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
  return (
    env.NODE_ENV === "test" ||
    env.VDT_AGENT_LEGACY_COMPATIBILITY_ENABLED === "true"
  );
}

export function isCliSessionCanaryEnabled(
  env: {
    readonly NODE_ENV?: string | undefined;
    readonly NEXT_PHASE?: string | undefined;
    readonly VDT_CURSOR_SESSION_CANARY_ENABLED?: string | undefined;
    readonly VDT_CLI_SESSION_CANARY_ENABLED?: string | undefined;
  } = process.env
): boolean {
  return env.NODE_ENV !== "production"
    && env.NEXT_PHASE !== "phase-production-build"
    && (env.VDT_CLI_SESSION_CANARY_ENABLED === "true" || env.VDT_CURSOR_SESSION_CANARY_ENABLED === "true");
}

export function isCursorSessionCanaryEnabled(
  env: {
    readonly NODE_ENV?: string | undefined;
    readonly NEXT_PHASE?: string | undefined;
    readonly VDT_CURSOR_SESSION_CANARY_ENABLED?: string | undefined;
  } = process.env
): boolean {
  return env.NODE_ENV !== "production"
    && env.NEXT_PHASE !== "phase-production-build"
    && env.VDT_CURSOR_SESSION_CANARY_ENABLED === "true";
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

async function registerCliSessionCanaries(): Promise<void> {
  if (!resolveTrustedStorageWriteMode()) return;
  const outcomes = cliSessionRegistrationOutcomes();
  const pending = CLI_SESSION_REGISTRAR_KEYS.filter((key) => {
    const outcome = outcomes.get(key);
    return outcome !== "registered" && outcome !== "absent";
  });
  if (pending.length === 0) return;

  const bridge = await import("@vdt-studio/model-bridge/node");
  const { evaluateCursorVersion } = await import("@vdt-studio/model-bridge");
  await Promise.allSettled(pending.map(async (key) => {
    try {
      if (key === "cursor") {
        outcomes.set(key, await registerCursorSessionCanary(bridge, evaluateCursorVersion));
        return;
      }
      if (key === "codex") {
        outcomes.set(key, await registerCodexSessionCanary(bridge));
        return;
      }
      outcomes.set(key, await registerClaudeSessionCanary(bridge));
    } catch {
      outcomes.set(key, "failed");
    }
  }));
}

type ModelBridgeNode = typeof import("@vdt-studio/model-bridge/node");

async function registerCursorSessionCanary(
  bridge: ModelBridgeNode,
  evaluateCursorVersion: (version: string | null) => { supported: boolean }
): Promise<CliSessionRegistrationResult> {
  if (agentExecutionBindingRegistry.has(CURSOR_SESSION_EXECUTION_BINDING_ID)) return "registered";
  const {
    CursorResumeCheckpointEngine,
    CursorResumeCheckpointTransport,
    detectSubscriptionCli
  } = bridge;
  const detection = await detectSubscriptionCli("cursor-agent");
  const versionEvaluation = evaluateCursorVersion(detection.version);
  if (!detection.installed || !detection.executable || !detection.version || !versionEvaluation.supported) return "absent";

  const toolCatalogHash = modelAgentToolCatalogHash(agentRuntime.tools);
  const transport = new CursorResumeCheckpointTransport({
    executable: detection.executable,
    validatedCliVersion: detection.version,
    timeoutMs: readPositiveIntegerEnv("VDT_CURSOR_SESSION_SEGMENT_TIMEOUT_MS", 180_000)
  });
  const engine = new CursorResumeCheckpointEngine({
    transport,
    cliVersion: detection.version,
    toolCatalogHash,
    allowedToolNames: TARGET_MODEL_AGENT_TOOLS,
    enableUnverifiedCanary: true,
    sessionEnvironmentFactory: async ({ binding, recovery }) => createCliSessionEnvironment({
      bindingId: binding.bindingId,
      slug: "cursor",
      recovery,
      credentialEnvironment: cursorCredentialEnvironment(),
      preauthorizeEmptyWorkspace: true
    }),
    resolveBinding: resolveDurableSessionBinding
  });
  registerCliSessionBinding({
    bindingId: CURSOR_SESSION_EXECUTION_BINDING_ID,
    engine,
    modelId: process.env.VDT_CURSOR_SESSION_MODEL?.trim() || "cursor-grok-4.6-medium"
  });
  return "registered";
}

async function registerCodexSessionCanary(bridge: ModelBridgeNode): Promise<CliSessionRegistrationResult> {
  if (agentExecutionBindingRegistry.has(CODEX_SESSION_EXECUTION_BINDING_ID)) return "registered";
  const {
    CodexResumeCheckpointEngine,
    CodexResumeCheckpointTransport,
    detectSubscriptionCli
  } = bridge;
  const detection = await detectSubscriptionCli("codex");
  if (!detection.installed || !detection.executable || !detection.version) return "absent";

  const toolCatalogHash = modelAgentToolCatalogHash(agentRuntime.tools);
  const transport = new CodexResumeCheckpointTransport({
    executable: detection.executable,
    validatedCliVersion: detection.version,
    timeoutMs: readPositiveIntegerEnv("VDT_CODEX_SESSION_SEGMENT_TIMEOUT_MS", 180_000)
  });
  const engine = new CodexResumeCheckpointEngine({
    transport,
    cliVersion: detection.version,
    toolCatalogHash,
    allowedToolNames: TARGET_MODEL_AGENT_TOOLS,
    enableUnverifiedCanary: true,
    sessionEnvironmentFactory: async ({ binding, recovery }) => createCliSessionEnvironment({
      bindingId: binding.bindingId,
      slug: "codex",
      recovery,
      credentialEnvironment: codexCredentialEnvironment(),
      preauthorizeEmptyWorkspace: false
    }),
    resolveBinding: resolveDurableSessionBinding
  });
  registerCliSessionBinding({
    bindingId: CODEX_SESSION_EXECUTION_BINDING_ID,
    engine,
    modelId: process.env.VDT_CODEX_SESSION_MODEL?.trim() || "gpt-5.4"
  });
  return "registered";
}

async function registerClaudeSessionCanary(bridge: ModelBridgeNode): Promise<CliSessionRegistrationResult> {
  if (agentExecutionBindingRegistry.has(CLAUDE_SESSION_EXECUTION_BINDING_ID)) return "registered";
  const {
    ClaudeResumeCheckpointEngine,
    ClaudeResumeCheckpointTransport,
    detectSubscriptionCli
  } = bridge;
  const detection = await detectSubscriptionCli("claude");
  if (!detection.installed || !detection.executable || !detection.version) return "absent";

  const toolCatalogHash = modelAgentToolCatalogHash(agentRuntime.tools);
  const transport = new ClaudeResumeCheckpointTransport({
    executable: detection.executable,
    validatedCliVersion: detection.version,
    timeoutMs: readPositiveIntegerEnv("VDT_CLAUDE_SESSION_SEGMENT_TIMEOUT_MS", 180_000)
  });
  const engine = new ClaudeResumeCheckpointEngine({
    transport,
    cliVersion: detection.version,
    toolCatalogHash,
    allowedToolNames: TARGET_MODEL_AGENT_TOOLS,
    enableUnverifiedCanary: true,
    sessionEnvironmentFactory: async ({ binding, recovery }) => createCliSessionEnvironment({
      bindingId: binding.bindingId,
      slug: "claude",
      recovery,
      credentialEnvironment: claudeCredentialEnvironment(),
      preauthorizeEmptyWorkspace: false
    }),
    resolveBinding: resolveDurableSessionBinding
  });
  registerCliSessionBinding({
    bindingId: CLAUDE_SESSION_EXECUTION_BINDING_ID,
    engine,
    modelId: process.env.VDT_CLAUDE_SESSION_MODEL?.trim() || "claude-sonnet-4-6"
  });
  return "registered";
}

function registerCliSessionBinding(input: {
  bindingId: string;
  engine: AgentExecutionEngine;
  modelId: string;
}): void {
  const capability = input.engine.capability;
  if (capability.executionProfile !== "external_cli_agent") return;
  const definition = {
    bindingId: input.bindingId,
    enabled: true,
    modelId: input.modelId,
    capability,
    currentQualification: {
      engineAdapterId: capability.engineAdapterId,
      backendId: capability.backendId,
      cliVersion: capability.cli.version,
      protocolVersion: capability.protocolVersion,
      toolCatalogHash: capability.toolCatalogHash,
      platform: capability.qualification.platform
    }
  } as const;
  agentExecutionBindingRegistry.register(definition);
  externalAgentEngines.set(definition.bindingId, input.engine);
}

async function createCliSessionEnvironment(input: {
  bindingId: string;
  slug: string;
  recovery: boolean;
  credentialEnvironment: Array<{ name: string; value: string }>;
  preauthorizeEmptyWorkspace: boolean;
}) {
  const root = path.join(
    tmpdir(),
    `vdt-studio-${input.slug}-sessions`,
    createHash("sha256").update(input.bindingId).digest("hex")
  );
  const workspace = path.join(root, "workspace");
  const state = path.join(root, "state");
  if (!input.recovery) await rm(root, { recursive: true, force: true });
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  await mkdir(state, { recursive: true, mode: 0o700 });
  // Accepted trusted-local canary tradeoff: subscription CLIs need the real
  // auth home to resume opaque sessions. The process still runs in an empty
  // private workspace; a minimal auth-only home is the long-term fix.
  return {
    environmentId: `${input.slug}-${createHash("sha256").update(input.bindingId).digest("hex").slice(0, 32)}`,
    privateWorkspacePath: workspace,
    privateStatePath: state,
    trustedSubscriptionAuthHomePath: homedir(),
    preauthorizeEmptyWorkspace: input.preauthorizeEmptyWorkspace,
    forbiddenRoots: resolveCliSessionForbiddenRoots(),
    credentialEnvironment: input.credentialEnvironment
  };
}

async function resolveDurableSessionBinding(checkpoint: { runId: string }) {
  const durable = await new AgentRunStateSupervisorPersistence(agentRuntime.store).load(checkpoint.runId);
  if (!durable?.binding) {
    throw Object.assign(new Error("The durable CLI session binding was not found."), {
      code: "CLI_SESSION_BINDING_NOT_FOUND"
    });
  }
  return durable.binding;
}

function credentialEnvironmentFromAllowlist(allowed: readonly string[]): Array<{ name: string; value: string }> {
  return allowed.flatMap((name) => {
    const value = process.env[name];
    return value ? [{ name, value }] : [];
  });
}

function cursorCredentialEnvironment(): Array<{ name: string; value: string }> {
  return credentialEnvironmentFromAllowlist([
    "CURSOR_API_KEY", "HTTP_PROXY", "HTTPS_PROXY", "LANG", "LC_ALL", "NODE_EXTRA_CA_CERTS",
    "NO_PROXY", "SSL_CERT_DIR", "SSL_CERT_FILE", "PATH", "USER", "LOGNAME"
  ]);
}

function codexCredentialEnvironment(): Array<{ name: string; value: string }> {
  return credentialEnvironmentFromAllowlist([
    "OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_HOME", "HTTP_PROXY", "HTTPS_PROXY", "LANG", "LC_ALL",
    "NODE_EXTRA_CA_CERTS", "NO_PROXY", "SSL_CERT_DIR", "SSL_CERT_FILE", "PATH", "USER", "LOGNAME"
  ]);
}

function claudeCredentialEnvironment(): Array<{ name: string; value: string }> {
  return credentialEnvironmentFromAllowlist([
    "ANTHROPIC_API_KEY", "CLAUDE_API_KEY", "HTTP_PROXY", "HTTPS_PROXY", "LANG", "LC_ALL",
    "NODE_EXTRA_CA_CERTS", "NO_PROXY", "SSL_CERT_DIR", "SSL_CERT_FILE", "PATH", "USER", "LOGNAME"
  ]);
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
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
