import { NextResponse } from "next/server";
import {
  generateVdtProject,
  MockProvider,
  OpenAiCompatibleProvider,
  type GenerateVdtInput,
  type OpenAiCompatibleProviderConfig
} from "@vdt-studio/ai-harness";

interface GenerateVdtRequest extends GenerateVdtInput {
  providerId?: "mock" | "openai_compatible";
  providerConfig?: Partial<OpenAiCompatibleProviderConfig>;
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

function readProviderConfig(value: unknown): Partial<OpenAiCompatibleProviderConfig> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const config = value as Record<string, unknown>;
  const providerConfig: Partial<OpenAiCompatibleProviderConfig> = {};
  if (typeof config.baseUrl === "string" && config.baseUrl.trim()) {
    providerConfig.baseUrl = config.baseUrl.trim();
  }
  if (typeof config.apiKey === "string" && config.apiKey) {
    providerConfig.apiKey = config.apiKey;
  }
  if (typeof config.model === "string" && config.model.trim()) {
    providerConfig.model = config.model.trim().slice(0, 120);
  }

  return providerConfig;
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
    } else {
      provider = new MockProvider();
    }

    const project = await generateVdtProject(provider, input);
    return NextResponse.json({ ok: true, project });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("base URL") ||
        error.message.includes("provider URLs") ||
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
