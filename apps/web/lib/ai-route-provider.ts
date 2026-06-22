import {
  AnthropicProvider,
  AzureOpenAiProvider,
  GeminiProvider,
  LocalRunnerProvider,
  MockProvider,
  OpenAiCompatibleProvider,
  type AiProvider,
  type LocalRunnerProviderConfig
} from "@vdt-studio/ai-harness";
import {
  DEFAULT_ANTHROPIC_FALLBACK_MODEL,
  DEFAULT_OPENAI_COMPATIBLE_FALLBACK_MODEL
} from "@/lib/execution-mode-catalog";

export type AiRouteProviderId =
  | "mock"
  | "local_cli"
  | "openai_compatible"
  | "anthropic"
  | "azure_openai"
  | "gemini"
  | "local_runner";

export interface AiRouteProviderRequest {
  providerId?: AiRouteProviderId | string;
  providerConfig?: Record<string, unknown>;
}

export function isMockProviderAllowed() {
  return process.env.NODE_ENV === "test" || process.env.VDT_ALLOW_MOCK_PROVIDER === "true";
}

export function readProviderConfig(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const config = value as Record<string, unknown>;
  const providerConfig: Record<string, string> = {};
  if (typeof config.baseUrl === "string" && config.baseUrl.trim()) {
    providerConfig.baseUrl = config.baseUrl.trim();
  }
  if (typeof config.apiKey === "string" && config.apiKey) {
    providerConfig.apiKey = config.apiKey;
  }
  if (typeof config.model === "string" && config.model.trim()) {
    providerConfig.model = config.model.trim().slice(0, 120);
  }
  for (const key of ["endpoint", "deployment", "apiVersion", "anthropicVersion"] as const) {
    if (typeof config[key] === "string" && config[key].trim()) {
      providerConfig[key] = config[key].trim().slice(0, key === "endpoint" ? 2_048 : 160);
    }
  }

  return providerConfig;
}

export function readMaxTokens(value: unknown): number | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const maxTokens = (value as Record<string, unknown>).maxTokens;
  if (typeof maxTokens !== "number" || !Number.isFinite(maxTokens) || maxTokens <= 0) {
    return undefined;
  }

  return Math.min(Math.floor(maxTokens), 1_000_000);
}

function isPrivateOrLocalHost(hostname: string) {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized === "::1" || normalized === "[::1]" || normalized.endsWith(".local")) {
    return true;
  }

  if (/^127\./.test(normalized) || /^10\./.test(normalized) || /^169\.254\./.test(normalized)) {
    return true;
  }

  if (/^192\.168\./.test(normalized)) {
    return true;
  }

  const match172 = normalized.match(/^172\.(\d+)\./);
  if (match172) {
    const secondOctet = Number(match172[1]);
    return secondOctet >= 16 && secondOctet <= 31;
  }

  return false;
}

export function assertRequestBaseUrlAllowed(baseUrl: string, envBaseUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("OpenAI-compatible base URL must be a valid URL.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("OpenAI-compatible base URL must use http or https.");
  }

  if (baseUrl === envBaseUrl) {
    return;
  }

  const requestUrlsAllowed = process.env.VDT_ALLOW_REQUEST_PROVIDER_URLS === "true" || process.env.NODE_ENV !== "production";
  if (!requestUrlsAllowed) {
    throw new Error("Request-supplied OpenAI-compatible base URLs are disabled in production.");
  }

  const privateUrlsAllowed = process.env.VDT_ALLOW_PRIVATE_PROVIDER_URLS === "true" || process.env.NODE_ENV !== "production";
  if (!privateUrlsAllowed && isPrivateOrLocalHost(parsed.hostname)) {
    throw new Error("Private or localhost provider URLs are disabled in production.");
  }
}

export function assertLocalRunnerUrlAllowed(runnerUrl: string, envRunnerUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(runnerUrl);
  } catch {
    throw new Error("Local runner URL must be a valid URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Local runner URL must use http or https.");
  }

  const usesRequestRunnerUrl = runnerUrl !== envRunnerUrl;
  const requestUrlsAllowed = process.env.VDT_ALLOW_REQUEST_LOCAL_RUNNER_URLS === "true" || process.env.NODE_ENV !== "production";
  if (usesRequestRunnerUrl && !requestUrlsAllowed) {
    throw new Error("Request-supplied local runner URLs are disabled in production.");
  }

  const remoteUrlsAllowed = process.env.VDT_ALLOW_REMOTE_LOCAL_RUNNER_URLS === "true";
  if (!remoteUrlsAllowed && !isPrivateOrLocalHost(parsed.hostname)) {
    throw new Error("Local runner URL must point to localhost or a private network host.");
  }
}

export function readLocalRunnerProviderConfig(value: unknown, origin: string): LocalRunnerProviderConfig {
  const envRunnerUrl = process.env.VDT_LOCAL_RUNNER_URL ?? "http://127.0.0.1:8765";
  const config = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const requestRunnerUrl = typeof config.runnerUrl === "string" && config.runnerUrl.trim() ? config.runnerUrl.trim() : undefined;
  const runnerUrl = requestRunnerUrl ?? envRunnerUrl;
  assertLocalRunnerUrlAllowed(runnerUrl, envRunnerUrl);

  for (const forbidden of ["command", "args", "argsText", "providerConfig", "baseUrl", "runnerProviderId"]) {
    if (forbidden in config) throw new Error(`Local runner provider config must not include ${forbidden}.`);
  }
  const backendId = typeof config.backendId === "string" ? config.backendId.trim() : "";
  const pairingToken = typeof config.pairingToken === "string" ? config.pairingToken : "";
  if (!backendId) throw new Error("Local runner backendId is required.");
  if (!pairingToken) throw new Error("Pair the local runner before using a local backend.");
  const timeoutMs = typeof config.timeoutMs === "number" && Number.isSafeInteger(config.timeoutMs)
    ? Math.min(Math.max(config.timeoutMs, 1_000), 120_000)
    : 60_000;
  return {
    runnerUrl,
    backendId,
    pairingToken,
    origin,
    ...(typeof config.model === "string" && config.model.trim() ? { model: config.model.trim().slice(0, 160) } : {}),
    timeoutMs
  };
}

export class AiRouteProviderError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "AiRouteProviderError";
  }
}

export function createAiProvider(request: AiRouteProviderRequest, requestUrl: string): AiProvider {
  const body = request;

  if (body.providerId === "local_cli") {
    throw new AiRouteProviderError("Subscription CLI execution must be routed through the local runner.");
  }

  if (body.providerId === "openai_compatible") {
    const envBaseUrl = process.env.OPENAI_COMPATIBLE_BASE_URL ?? "https://api.openai.com/v1";
    const providerConfig = readProviderConfig(body.providerConfig);
    const requestBaseUrl = providerConfig.baseUrl;
    const usesRequestBaseUrl = Boolean(requestBaseUrl && requestBaseUrl !== envBaseUrl);
    const apiKey = usesRequestBaseUrl
      ? providerConfig.apiKey
      : providerConfig.apiKey ?? process.env.OPENAI_COMPATIBLE_API_KEY;

    if (requestBaseUrl) {
      assertRequestBaseUrlAllowed(requestBaseUrl, envBaseUrl);
    }

    if (usesRequestBaseUrl && !providerConfig.apiKey) {
      throw new AiRouteProviderError(
        "A request-supplied OpenAI-compatible base URL must also provide its own API key."
      );
    }

    return new OpenAiCompatibleProvider({
      baseUrl: requestBaseUrl ?? envBaseUrl,
      apiKey,
      model: providerConfig.model ?? process.env.OPENAI_COMPATIBLE_MODEL ?? DEFAULT_OPENAI_COMPATIBLE_FALLBACK_MODEL
    });
  }

  if (body.providerId === "anthropic") {
    const providerConfig = readProviderConfig(body.providerConfig);
    const envBaseUrl = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";
    const baseUrl = providerConfig.baseUrl ?? envBaseUrl;
    assertRequestBaseUrlAllowed(baseUrl, envBaseUrl);
    if (providerConfig.baseUrl && providerConfig.baseUrl !== envBaseUrl && !providerConfig.apiKey) {
      throw new Error("A request-supplied Anthropic base URL must also provide its own API key.");
    }
    const apiKey = providerConfig.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("Anthropic API key is required.");
    }
    return new AnthropicProvider({
      baseUrl,
      apiKey,
      model: providerConfig.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_FALLBACK_MODEL,
      anthropicVersion: providerConfig.anthropicVersion ?? "2023-06-01"
    });
  }

  if (body.providerId === "azure_openai") {
    const providerConfig = readProviderConfig(body.providerConfig);
    const envEndpoint = process.env.AZURE_OPENAI_ENDPOINT ?? "";
    const requestEndpoint = providerConfig.endpoint ?? providerConfig.baseUrl;
    const endpoint = requestEndpoint ?? envEndpoint;
    if (!endpoint) {
      throw new Error("Azure OpenAI endpoint is required.");
    }
    assertRequestBaseUrlAllowed(endpoint, envEndpoint);
    const usesRequestEndpoint = Boolean(requestEndpoint && requestEndpoint !== envEndpoint);
    if (usesRequestEndpoint && !providerConfig.apiKey) {
      throw new Error("A request-supplied Azure OpenAI endpoint must also provide its own API key.");
    }
    const apiKey = usesRequestEndpoint
      ? providerConfig.apiKey
      : providerConfig.apiKey ?? process.env.AZURE_OPENAI_API_KEY;
    const deployment = providerConfig.deployment ?? providerConfig.model ?? process.env.AZURE_OPENAI_DEPLOYMENT;
    if (!apiKey) {
      throw new Error("Azure OpenAI API key is required.");
    }
    if (!deployment) {
      throw new Error("Azure OpenAI deployment is required.");
    }
    return new AzureOpenAiProvider({
      endpoint,
      apiKey,
      deployment,
      apiVersion: providerConfig.apiVersion ?? process.env.AZURE_OPENAI_API_VERSION ?? "2024-10-21"
    });
  }

  if (body.providerId === "gemini") {
    const providerConfig = readProviderConfig(body.providerConfig);
    const envBaseUrl = process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com";
    const baseUrl = providerConfig.baseUrl ?? envBaseUrl;
    assertRequestBaseUrlAllowed(baseUrl, envBaseUrl);
    if (providerConfig.baseUrl && providerConfig.baseUrl !== envBaseUrl && !providerConfig.apiKey) {
      throw new Error("A request-supplied Google Gemini base URL must also provide its own API key.");
    }
    const apiKey = providerConfig.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error("Google Gemini API key is required.");
    }
    return new GeminiProvider({
      baseUrl,
      apiKey,
      model: providerConfig.model ?? process.env.GEMINI_MODEL ?? "gemini-2.5-pro"
    });
  }

  if (body.providerId === "local_runner") {
    return new LocalRunnerProvider(readLocalRunnerProviderConfig(body.providerConfig, new URL(requestUrl).origin));
  }

  if (body.providerId === "mock") {
    if (!isMockProviderAllowed()) {
      throw new AiRouteProviderError("Mock provider is only available in automated tests.");
    }
    return new MockProvider();
  }

  if (!body.providerId) {
    throw new AiRouteProviderError("Select a configured Local CLI or BYOK provider before running an AI task.");
  }

  throw new AiRouteProviderError(`Unsupported providerId: ${body.providerId}`);
}
