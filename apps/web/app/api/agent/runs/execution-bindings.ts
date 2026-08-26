import {
  assessExternalAgentCapability,
  agentCapabilityProfileSchema,
  type AgentCapabilityProfile,
  type AgentCapabilityQualificationRequirement
} from "@vdt-studio/vdt-agent-runtime";

export const DEFAULT_MODEL_AGENT_EXECUTION_BINDING_ID = "model_agent_default";

type StructuredModelProviderId = StructuredModelAgentEngineAdapterDefinition["providerId"];

export interface DefaultModelAgentBindingEnvironment {
  readonly NODE_ENV?: string | undefined;
  readonly VDT_MODEL_AGENT_ENABLED?: string | undefined;
  readonly VDT_MODEL_AGENT_PROVIDER?: string | undefined;
  readonly VDT_MODEL_AGENT_MODEL?: string | undefined;
  readonly VDT_MODEL_AGENT_MAX_TOKENS?: string | undefined;
  readonly VDT_MODEL_AGENT_TEMPERATURE?: string | undefined;
  readonly OPENAI_COMPATIBLE_MODEL?: string | undefined;
  readonly ANTHROPIC_MODEL?: string | undefined;
  readonly AZURE_OPENAI_DEPLOYMENT?: string | undefined;
  readonly GEMINI_MODEL?: string | undefined;
}

export interface DefaultModelAgentBindingOptions {
  readonly env: DefaultModelAgentBindingEnvironment;
  readonly toolCatalogHash: string;
  readonly platform?: {
    readonly os: string;
    readonly arch: string;
    readonly runtimeVersion: string | null;
  } | undefined;
}

export interface AgentExecutionBindingSummary {
  readonly bindingId: string;
  readonly executionProfile: AgentCapabilityProfile["executionProfile"];
  readonly engineId: string;
  readonly engineAdapterId: string;
  readonly backendId: string;
  readonly modelId: string;
}

interface ModelAgentExecutionBindingDefinitionBase {
  readonly bindingId: string;
  readonly enabled: boolean;
  readonly modelId: string;
  readonly capability: Extract<AgentCapabilityProfile, { executionProfile: "model_agent" }>;
}

/** Server-owned structured-turn transport. Subscription CLIs and the managed
 * CLI runner are deliberately excluded from this adapter: they belong to the
 * external profile or to the explicit legacy compatibility route. */
export interface StructuredModelAgentEngineAdapterDefinition {
    readonly providerId: "openai_compatible" | "anthropic" | "azure_openai" | "gemini" | "mock";
    readonly providerConfig?: Readonly<Record<string, unknown>> | undefined;
    readonly maxTokens?: number | undefined;
    readonly temperature?: number | undefined;
}

export interface LegacyModelAgentCompatibilityAdapterDefinition {
  readonly providerId: string;
  readonly providerConfig?: Readonly<Record<string, unknown>> | undefined;
}

export interface ModelAgentExecutionBindingDefinition
  extends ModelAgentExecutionBindingDefinitionBase {
  readonly modelEngineAdapter?: StructuredModelAgentEngineAdapterDefinition | undefined;
  /** Temporary bridge into the existing micro-CLI/provider runtime. This is
   * server-owned and is never accepted from the start request. */
  readonly legacyCompatibilityAdapter?: LegacyModelAgentCompatibilityAdapterDefinition | undefined;
}

export type StructuredModelAgentExecutionBindingDefinition =
  ModelAgentExecutionBindingDefinition & {
    readonly modelEngineAdapter: StructuredModelAgentEngineAdapterDefinition;
    readonly legacyCompatibilityAdapter?: undefined;
  };

export type LegacyModelAgentExecutionBindingDefinition =
  ModelAgentExecutionBindingDefinition & {
    readonly legacyCompatibilityAdapter: LegacyModelAgentCompatibilityAdapterDefinition;
    readonly modelEngineAdapter?: undefined;
  };

export interface ExternalCliExecutionBindingDefinition {
  readonly bindingId: string;
  readonly enabled: boolean;
  readonly modelId: string;
  readonly capability: Extract<AgentCapabilityProfile, { executionProfile: "external_cli_agent" }>;
  /** The current host probe. It must match the stored qualification evidence
   * exactly; a changed CLI/protocol/catalog/platform fails closed. */
  readonly currentQualification: AgentCapabilityQualificationRequirement;
}

export type AgentExecutionBindingDefinition =
  | ModelAgentExecutionBindingDefinition
  | ExternalCliExecutionBindingDefinition;

export type AgentExecutionBindingErrorCode =
  | "BINDING_ALREADY_REGISTERED"
  | "BINDING_INVALID"
  | "BINDING_NOT_FOUND"
  | "BINDING_DISABLED"
  | "MODEL_BINDING_CLI_COMPATIBILITY_FORBIDDEN"
  | "EXTERNAL_ENGINE_NOT_WIRED"
  | "EXTERNAL_PROFILE_DISABLED"
  | "EXTERNAL_CAPABILITY_UNAVAILABLE";

export class AgentExecutionBindingError extends Error {
  constructor(
    readonly code: AgentExecutionBindingErrorCode,
    message: string
  ) {
    super(message);
    this.name = "AgentExecutionBindingError";
  }
}

export interface AgentExecutionBindingRegistryOptions {
  /** External engines stay unavailable until the trusted host explicitly opts
   * in after qualification. The default is deliberately false. */
  externalProfilesEnabled?: boolean | undefined;
  /** Registration is also gated on concrete host wiring. Qualification alone
   * must never expose an adapter that cannot actually preserve its session. */
  externalEngineWired?: boolean | undefined;
}

/**
 * Process-local registry for server-owned execution bindings. Definitions are
 * immutable snapshots: callers cannot mutate provider settings after a run
 * resolves its binding, and unknown/disabled/stale entries never fall back to
 * a legacy provider or another backend.
 */
export class AgentExecutionBindingRegistry {
  private readonly definitions = new Map<string, AgentExecutionBindingDefinition>();
  private readonly seenBindingIds = new Set<string>();
  private readonly externalProfilesEnabled: boolean;
  private readonly externalEngineWired: boolean;

  constructor(
    definitions: readonly AgentExecutionBindingDefinition[] = [],
    options: AgentExecutionBindingRegistryOptions = {}
  ) {
    this.externalProfilesEnabled = options.externalProfilesEnabled === true;
    this.externalEngineWired = options.externalEngineWired === true;
    for (const definition of definitions) this.register(definition);
  }

  register(definition: AgentExecutionBindingDefinition): () => void {
    const normalized = normalizeDefinition(definition);
    if ("currentQualification" in normalized && !this.externalEngineWired) {
      throw new AgentExecutionBindingError(
        "EXTERNAL_ENGINE_NOT_WIRED",
        "External CLI bindings cannot be registered until the host engine is wired."
      );
    }
    if (this.seenBindingIds.has(normalized.bindingId)) {
      throw new AgentExecutionBindingError(
        "BINDING_ALREADY_REGISTERED",
        `Execution binding "${normalized.bindingId}" is already registered.`
      );
    }
    this.seenBindingIds.add(normalized.bindingId);
    this.definitions.set(normalized.bindingId, normalized);
    return () => {
      if (this.definitions.get(normalized.bindingId) === normalized) {
        this.definitions.delete(normalized.bindingId);
      }
    };
  }

  has(bindingId: string): boolean {
    return this.definitions.has(bindingId);
  }

  resolve(bindingId: string): AgentExecutionBindingDefinition {
    const definition = this.definitions.get(bindingId);
    if (!definition) {
      throw new AgentExecutionBindingError(
        "BINDING_NOT_FOUND",
        "The requested execution binding is unavailable."
      );
    }
    if (!definition.enabled) {
      throw new AgentExecutionBindingError(
        "BINDING_DISABLED",
        "The requested execution binding is unavailable."
      );
    }
    if ("currentQualification" in definition) {
      if (!this.externalProfilesEnabled) {
        throw new AgentExecutionBindingError(
          "EXTERNAL_PROFILE_DISABLED",
          "External CLI execution profiles are disabled on this host."
        );
      }
      const availability = assessExternalAgentCapability(
        definition.capability,
        definition.currentQualification
      );
      if (!availability.available) {
        throw new AgentExecutionBindingError(
          "EXTERNAL_CAPABILITY_UNAVAILABLE",
          `External CLI qualification is not current (${availability.reasons.join(", ")}).`
        );
      }
    }
    return cloneDefinition(definition);
  }

  summaries(): AgentExecutionBindingSummary[] {
    const summaries: AgentExecutionBindingSummary[] = [];
    for (const definition of this.definitions.values()) {
      try {
        summaries.push(toSummary(this.resolve(definition.bindingId)));
      } catch (error) {
        if (!(error instanceof AgentExecutionBindingError)) throw error;
      }
    }
    return summaries;
  }
}

/**
 * Builds the one server-owned Model Agent binding known by the public app.
 * Production remains fail-closed unless the host explicitly opts into the
 * stateless structured-replay canary. Tests receive a deterministic mock
 * binding, never a network or subscription-CLI fallback.
 */
export function createDefaultModelAgentExecutionBinding(
  options: DefaultModelAgentBindingOptions
): StructuredModelAgentExecutionBindingDefinition {
  const { env, toolCatalogHash } = options;
  const testRuntime = env.NODE_ENV === "test";
  const enabled = testRuntime || env.VDT_MODEL_AGENT_ENABLED === "true";
  const providerId = resolveDefaultModelProvider(env, testRuntime);
  const modelId = resolveDefaultModel(providerId, env, testRuntime);
  const maxTokens = optionalInteger(env.VDT_MODEL_AGENT_MAX_TOKENS, "VDT_MODEL_AGENT_MAX_TOKENS", 1, 1_000_000);
  const temperature = optionalNumber(env.VDT_MODEL_AGENT_TEMPERATURE, "VDT_MODEL_AGENT_TEMPERATURE", 0, 2);

  return {
    bindingId: DEFAULT_MODEL_AGENT_EXECUTION_BINDING_ID,
    enabled,
    modelId,
    capability: {
      schemaVersion: 1,
      executionProfile: "model_agent",
      engineId: "in-product-model-agent",
      engineAdapterId: "http-structured-replay-canary-v1",
      backendId: providerId,
      protocolVersion: "structured-turn-v1",
      sessionStrategy: "structured_turn",
      toolCatalogHash,
      toolIsolation: "permission_only",
      qualification: {
        status: "unverified",
        platform: options.platform ?? {
          os: typeof process === "undefined" ? "unknown" : process.platform,
          arch: typeof process === "undefined" ? "unknown" : process.arch,
          runtimeVersion: typeof process === "undefined" ? null : process.version
        },
        testedAt: null,
        evidenceHash: null
      },
      supportsNativeSession: false,
      supportsResume: false,
      supportsStructuredEvents: true,
      supportsToolBridge: true,
      supportsQuestions: true,
      supportsCancellation: true,
      supportsUsageMetrics: false,
      cli: null
    },
    modelEngineAdapter: {
      providerId,
      ...(maxTokens === undefined ? {} : { maxTokens }),
      ...(temperature === undefined ? {} : { temperature })
    }
  };
}

export function executionBindingSummary(
  definition: AgentExecutionBindingDefinition
): AgentExecutionBindingSummary {
  return toSummary(definition);
}

function normalizeDefinition(
  definition: AgentExecutionBindingDefinition
): AgentExecutionBindingDefinition {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(definition.bindingId)) {
    throw new AgentExecutionBindingError(
      "BINDING_INVALID",
      "Execution binding ID must be a safe server identifier."
    );
  }
  if (!definition.modelId.trim() || definition.modelId.length > 160) {
    throw new AgentExecutionBindingError(
      "BINDING_INVALID",
      "Execution binding model ID is invalid."
    );
  }
  const capabilityResult = agentCapabilityProfileSchema.safeParse(definition.capability);
  if (!capabilityResult.success) {
    throw new AgentExecutionBindingError(
      "BINDING_INVALID",
      capabilityResult.error.issues[0]?.message ?? "Execution capability is invalid."
    );
  }
  if ("currentQualification" in definition) {
    return cloneDefinition(definition);
  }
  if (
    "legacyCompatibilityAdapter" in definition
    && definition.legacyCompatibilityAdapter
    && "modelEngineAdapter" in definition
    && definition.modelEngineAdapter
  ) {
    throw new AgentExecutionBindingError(
      "BINDING_INVALID",
      "A model execution binding cannot select two engine adapters."
    );
  }
  if (isLegacyModelExecutionBinding(definition)) {
    const providerId = definition.legacyCompatibilityAdapter.providerId.trim();
    if (!providerId || providerId.length > 120) {
      throw new AgentExecutionBindingError(
        "BINDING_INVALID",
        "Compatibility provider ID is invalid."
      );
    }
    if (wouldLaunchSubscriptionCli(definition.legacyCompatibilityAdapter)) {
      throw new AgentExecutionBindingError(
        "MODEL_BINDING_CLI_COMPATIBILITY_FORBIDDEN",
        "A model_agent binding cannot use a subscription CLI compatibility provider."
      );
    }
    if (!/compat/i.test(definition.capability.engineAdapterId)) {
      throw new AgentExecutionBindingError(
        "BINDING_INVALID",
        "A model binding routed through the legacy runtime must label its engine adapter as compatibility."
      );
    }
  } else if (isStructuredModelExecutionBinding(definition)) {
    if (definition.capability.backendId !== definition.modelEngineAdapter.providerId) {
      throw new AgentExecutionBindingError(
        "BINDING_INVALID",
        "Structured model capability backendId must exactly match the selected provider adapter."
      );
    }
    if (/compat/i.test(definition.capability.engineAdapterId)) {
      throw new AgentExecutionBindingError(
        "BINDING_INVALID",
        "A structured model engine binding cannot identify itself as a compatibility adapter."
      );
    }
    if (
      !definition.capability.supportsStructuredEvents
      || !definition.capability.supportsToolBridge
      || !definition.capability.supportsQuestions
      || !definition.capability.supportsCancellation
    ) {
      throw new AgentExecutionBindingError(
        "BINDING_INVALID",
        "A structured model engine binding must support structured events, the VDT tool bridge, questions, and cancellation."
      );
    }
    if (definition.capability.supportsResume) {
      throw new AgentExecutionBindingError(
        "BINDING_INVALID",
        "Stateless structured HTTP bindings cannot advertise crash resume until their semantic session state is durably checkpointed."
      );
    }
    const { maxTokens, temperature, providerConfig } = definition.modelEngineAdapter;
    if (
      maxTokens !== undefined
      && (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 1_000_000)
    ) {
      throw new AgentExecutionBindingError("BINDING_INVALID", "Structured model maxTokens is invalid.");
    }
    if (
      temperature !== undefined
      && (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)
    ) {
      throw new AgentExecutionBindingError("BINDING_INVALID", "Structured model temperature is invalid.");
    }
    for (const forbidden of [
      "command",
      "executable",
      "args",
      "argsText",
      "cwd",
      "env",
      "pairingToken",
      "backendId"
    ]) {
      if (providerConfig && forbidden in providerConfig) {
        throw new AgentExecutionBindingError(
          "BINDING_INVALID",
          `Structured model provider config must not include ${forbidden}.`
        );
      }
    }
    const configuredModel = providerConfig?.model;
    if (typeof configuredModel === "string" && configuredModel.trim() !== definition.modelId) {
      throw new AgentExecutionBindingError(
        "BINDING_INVALID",
        "Structured model provider config must not override the binding model."
      );
    }
    const configuredDeployment = providerConfig?.deployment;
    if (
      definition.modelEngineAdapter.providerId === "azure_openai"
      && typeof configuredDeployment === "string"
      && configuredDeployment.trim() !== definition.modelId
    ) {
      throw new AgentExecutionBindingError(
        "BINDING_INVALID",
        "Azure deployment must match the immutable binding model ID."
      );
    }
  } else {
    throw new AgentExecutionBindingError(
      "BINDING_INVALID",
      "A model execution binding must select exactly one server-owned engine adapter."
    );
  }
  return cloneDefinition(definition);
}

function resolveDefaultModelProvider(
  env: DefaultModelAgentBindingEnvironment,
  testRuntime: boolean
): StructuredModelProviderId {
  if (testRuntime && !env.VDT_MODEL_AGENT_PROVIDER) return "mock";
  const providerId = env.VDT_MODEL_AGENT_PROVIDER?.trim() || "openai_compatible";
  if (["openai_compatible", "anthropic", "azure_openai", "gemini"].includes(providerId)) {
    return providerId as StructuredModelProviderId;
  }
  if (providerId === "mock" && testRuntime) return providerId;
  throw new AgentExecutionBindingError(
    "BINDING_INVALID",
    `Unsupported server Model Agent provider "${providerId}".`
  );
}

function resolveDefaultModel(
  providerId: StructuredModelProviderId,
  env: DefaultModelAgentBindingEnvironment,
  testRuntime: boolean
): string {
  const explicit = env.VDT_MODEL_AGENT_MODEL?.trim();
  if (explicit) return explicit;
  if (providerId === "mock") {
    if (!testRuntime) {
      throw new AgentExecutionBindingError("BINDING_INVALID", "Mock Model Agent bindings are test-only.");
    }
    return "deterministic-test-model";
  }
  if (providerId === "anthropic") return env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-20250514";
  if (providerId === "azure_openai") {
    const deployment = env.AZURE_OPENAI_DEPLOYMENT?.trim();
    if (!deployment) {
      throw new AgentExecutionBindingError(
        "BINDING_INVALID",
        "VDT_MODEL_AGENT_MODEL or AZURE_OPENAI_DEPLOYMENT is required for the Azure Model Agent binding."
      );
    }
    return deployment;
  }
  if (providerId === "gemini") return env.GEMINI_MODEL?.trim() || "gemini-2.5-pro";
  return env.OPENAI_COMPATIBLE_MODEL?.trim() || "gpt-4.1-mini";
}

function optionalInteger(
  value: string | undefined,
  name: string,
  minimum: number,
  maximum: number
): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new AgentExecutionBindingError("BINDING_INVALID", `${name} is invalid.`);
  }
  return parsed;
}

function optionalNumber(
  value: string | undefined,
  name: string,
  minimum: number,
  maximum: number
): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new AgentExecutionBindingError("BINDING_INVALID", `${name} is invalid.`);
  }
  return parsed;
}

export function isStructuredModelExecutionBinding(
  definition: AgentExecutionBindingDefinition
): definition is StructuredModelAgentExecutionBindingDefinition {
  return "modelEngineAdapter" in definition && definition.modelEngineAdapter !== undefined;
}

export function isLegacyModelExecutionBinding(
  definition: AgentExecutionBindingDefinition
): definition is LegacyModelAgentExecutionBindingDefinition {
  return "legacyCompatibilityAdapter" in definition && definition.legacyCompatibilityAdapter !== undefined;
}

function wouldLaunchSubscriptionCli(
  adapter: LegacyModelAgentCompatibilityAdapterDefinition
): boolean {
  if (/(?:cursor|codex|claude).*subscription|subscription.*(?:cursor|codex|claude)/i.test(adapter.providerId)) {
    return true;
  }
  if (adapter.providerId !== "local_runner") return false;
  const backendId = adapter.providerConfig?.backendId;
  return typeof backendId !== "string" || !["local_http", "mock"].includes(backendId);
}

function cloneDefinition(
  definition: AgentExecutionBindingDefinition
): AgentExecutionBindingDefinition {
  return structuredClone(definition);
}

function toSummary(definition: AgentExecutionBindingDefinition): AgentExecutionBindingSummary {
  return {
    bindingId: definition.bindingId,
    executionProfile: definition.capability.executionProfile,
    engineId: definition.capability.engineId,
    engineAdapterId: definition.capability.engineAdapterId,
    backendId: definition.capability.backendId,
    modelId: definition.modelId
  };
}
