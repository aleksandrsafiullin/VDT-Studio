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

export async function POST(request: Request) {
  try {
    let body: GenerateVdtRequest;
    try {
      body = (await request.json()) as GenerateVdtRequest;
    } catch {
      return NextResponse.json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
    }

    if (!body || typeof body !== "object" || !body.rootKpi?.trim()) {
      return NextResponse.json({ ok: false, error: "Root KPI is required." }, { status: 400 });
    }

    let provider;
    if (body.providerId === "openai_compatible") {
      const envBaseUrl = process.env.OPENAI_COMPATIBLE_BASE_URL ?? "https://api.openai.com/v1";
      const requestBaseUrl = body.providerConfig?.baseUrl;
      const usesRequestBaseUrl = Boolean(requestBaseUrl && requestBaseUrl !== envBaseUrl);
      const apiKey = usesRequestBaseUrl
        ? body.providerConfig?.apiKey
        : body.providerConfig?.apiKey ?? process.env.OPENAI_COMPATIBLE_API_KEY;

      if (usesRequestBaseUrl && !body.providerConfig?.apiKey) {
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
        model: body.providerConfig?.model ?? process.env.OPENAI_COMPATIBLE_MODEL ?? "gpt-4.1-mini"
      });
    } else {
      provider = new MockProvider();
    }

    const project = await generateVdtProject(provider, body);
    return NextResponse.json({ ok: true, project });
  } catch (error) {
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
