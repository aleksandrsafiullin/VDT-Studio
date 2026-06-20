import { NextResponse } from "next/server";
import {
  AnthropicProvider,
  AzureOpenAiProvider,
  generateVdtProject,
  GeminiProvider,
  LocalRunnerProvider,
  MockProvider,
  OpenAiCompatibleProvider,
  type GenerateVdtInput,
  type LocalRunnerProviderConfig
} from "@vdt-studio/ai-harness";

interface GenerateVdtRequest extends GenerateVdtInput {
  providerId?: "mock" | "openai_compatible" | "anthropic" | "azure_openai" | "gemini" | "local_runner";
  providerConfig?: Record<string, unknown>;
}

const MAX_FIELD_LENGTHS: Partial<Record<keyof GenerateVdtInput, number>> = {
  rootKpi: 140,
  industry: 160,
  businessContext: 2_000,
  unit: 80,
  timePeriod: 80,
  goal: 1_000,
  levelOfDetail: 40
};

function readLimitedString(
  body: Record<string, unknown>,
  key: keyof GenerateVdtInput,
  required = false
): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) {
    if (required) {
      throw new Error(`${key} is required.`);
    }
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`${key} must be a string.`);
  }

  const trimmed = value.trim();
  if (required && trimmed.length === 0) {
    throw new Error(`${key} is required.`);
  }

  const maxLength = MAX_FIELD_LENGTHS[key] ?? 500;
  if (trimmed.length > maxLength) {
    throw new Error(`${key} must be ${maxLength} characters or fewer.`);
  }

  return trimmed || undefined;
}

function readProviderConfig(value: unknown) {
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

function readLocalRunnerProviderConfig(value: unknown): LocalRunnerProviderConfig {
  const envRunnerUrl = process.env.VDT_LOCAL_RUNNER_URL ?? "http://127.0.0.1:8765";
  const config = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const requestRunnerUrl = typeof config.runnerUrl === "string" && config.runnerUrl.trim() ? config.runnerUrl.trim() : undefined;
  const runnerUrl = requestRunnerUrl ?? envRunnerUrl;
  assertLocalRunnerUrlAllowed(runnerUrl, envRunnerUrl);

  const runnerProviderId =
    typeof config.runnerProviderId === "string" && config.runnerProviderId.trim()
      ? config.runnerProviderId.trim()
      : "local_http_stub";
  const timeoutSec =
    typeof config.timeoutSec === "number" && Number.isFinite(config.timeoutSec) && config.timeoutSec > 0
      ? Math.min(config.timeoutSec, 120)
      : 60;

  if (runnerProviderId === "cli_stub") {
    const command = typeof config.command === "string" ? config.command.trim() : "";
    return {
      runnerUrl,
      runnerProviderId,
      providerConfig: {
        name: typeof config.name === "string" && config.name.trim() ? config.name.trim() : "Local CLI Model",
        command,
        args: readArgs(config.args, config.argsText),
        inputMode: "stdin",
        outputMode: "stdout_json",
        timeoutSec
      },
      timeoutSec
    };
  }

  const baseUrl = typeof config.baseUrl === "string" && config.baseUrl.trim() ? config.baseUrl.trim() : "http://127.0.0.1:11434/v1";
  const model = typeof config.model === "string" && config.model.trim() ? config.model.trim().slice(0, 120) : "qwen3";
  return {
    runnerUrl,
    runnerProviderId,
    providerConfig: {
      baseUrl,
      model,
      ...(typeof config.apiKey === "string" && config.apiKey ? { apiKey: config.apiKey } : {})
    },
    timeoutSec
  };
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

function assertRequestBaseUrlAllowed(baseUrl: string, envBaseUrl: string) {
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

function assertLocalRunnerUrlAllowed(runnerUrl: string, envRunnerUrl: string) {
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

function readArgs(args: unknown, argsText: unknown): string[] | undefined {
  if (Array.isArray(args) && args.every((item) => typeof item === "string")) {
    return args;
  }
  if (typeof argsText === "string" && argsText.trim()) {
    return argsText.split(/\s+/).filter(Boolean);
  }
  return undefined;
}

export async function POST(request: Request) {
  try {
    let body: GenerateVdtRequest & Record<string, unknown>;
    try {
      body = (await request.json()) as GenerateVdtRequest & Record<string, unknown>;
    } catch {
      return NextResponse.json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ ok: false, error: "Request body must be an object." }, { status: 400 });
    }

    const input: GenerateVdtInput = {
      rootKpi: readLimitedString(body, "rootKpi", true)!,
      levelOfDetail: readLimitedString(body, "levelOfDetail") ?? "medium"
    };
    const optionalInputFields: (keyof GenerateVdtInput)[] = ["industry", "businessContext", "unit", "timePeriod", "goal"];
    for (const field of optionalInputFields) {
      const value = readLimitedString(body, field);
      if (value !== undefined) {
        input[field] = value;
      }
    }

    let provider;
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
        return NextResponse.json(
          {
            ok: false,
            error: "A request-supplied OpenAI-compatible base URL must also provide its own API key."
          },
          { status: 400 }
        );
      }

      provider = new OpenAiCompatibleProvider({
        baseUrl: requestBaseUrl ?? envBaseUrl,
        apiKey,
        model: providerConfig.model ?? process.env.OPENAI_COMPATIBLE_MODEL ?? "gpt-4.1-mini"
      });
    } else if (body.providerId === "anthropic") {
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
      provider = new AnthropicProvider({
        baseUrl,
        apiKey,
        model: providerConfig.model ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
        anthropicVersion: providerConfig.anthropicVersion ?? "2023-06-01"
      });
    } else if (body.providerId === "azure_openai") {
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
      provider = new AzureOpenAiProvider({
        endpoint,
        apiKey,
        deployment,
        apiVersion: providerConfig.apiVersion ?? process.env.AZURE_OPENAI_API_VERSION ?? "2024-10-21"
      });
    } else if (body.providerId === "gemini") {
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
      provider = new GeminiProvider({
        baseUrl,
        apiKey,
        model: providerConfig.model ?? process.env.GEMINI_MODEL ?? "gemini-2.5-pro"
      });
    } else if (body.providerId === "local_runner") {
      provider = new LocalRunnerProvider(readLocalRunnerProviderConfig(body.providerConfig));
    } else {
      provider = new MockProvider();
    }

    const project = await generateVdtProject(provider, input);
    return NextResponse.json({ ok: true, project });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("base URL") ||
        error.message.includes("Local runner URL") ||
        error.message.includes("local runner URLs") ||
        error.message.includes("provider URLs") ||
        error.message.includes("must also provide") ||
        error.message.includes("endpoint") ||
        error.message.includes("must be") ||
        error.message.includes("is required"))
    ) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    if (error instanceof Error && (error.name === "ZodError" || error.message.startsWith("AI output"))) {
      return NextResponse.json(
        {
          ok: false,
          error: error.name === "ZodError" ? "AI response failed schema validation." : error.message
        },
        { status: 422 }
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message.replace(/OpenAI-compatible provider failed with \d+:.*/s, "OpenAI-compatible provider failed.") : "AI response could not be parsed."
      },
      { status: 502 }
    );
  }
}
