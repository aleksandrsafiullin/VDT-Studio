import { afterEach, describe, expect, it, vi } from "vitest";
import { productionVolumeAiOutput } from "@vdt-studio/ai-harness";
import { POST } from "./route";

function jsonRequest(body: unknown) {
  return new Request("http://localhost:3000/api/ai/generate-vdt", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

async function readJson(response: Response) {
  return (await response.json()) as {
    ok: boolean;
    error?: string;
    project?: {
      name?: string;
      rootNodeId?: string;
      aiReview?: {
        assumptions?: string[];
        questionsForUser?: string[];
      };
    };
  };
}

describe("generate VDT API route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("generates a validated mock-provider project with AI review artifacts", async () => {
    const response = await POST(
      jsonRequest({
        rootKpi: "Production Volume",
        providerId: "mock",
        industry: "Mining / Processing Plant",
        unit: "tonnes/month",
        goal: "Understand production decrease",
        levelOfDetail: "medium"
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.project?.name).toBe("Production Volume Driver Model");
    expect(body.project?.rootNodeId).toBe("production_volume");
    expect(body.project?.aiReview?.assumptions?.length).toBeGreaterThan(0);
    expect(body.project?.aiReview?.questionsForUser?.length).toBeGreaterThan(0);
  });

  it("rejects invalid request bodies before provider execution", async () => {
    const malformedResponse = await POST(jsonRequest("{"));
    const missingRootResponse = await POST(jsonRequest({ providerId: "mock" }));
    const longRootResponse = await POST(jsonRequest({ rootKpi: "x".repeat(141), providerId: "mock" }));

    expect(malformedResponse.status).toBe(400);
    expect((await readJson(malformedResponse)).error).toBe("Request body must be valid JSON.");
    expect(missingRootResponse.status).toBe(400);
    expect((await readJson(missingRootResponse)).error).toBe("rootKpi is required.");
    expect(longRootResponse.status).toBe(400);
    expect((await readJson(longRootResponse)).error).toContain("rootKpi must be 140 characters or fewer.");
  });

  it("requires an API key for request-supplied OpenAI-compatible base URLs", async () => {
    const response = await POST(
      jsonRequest({
        rootKpi: "Production Volume",
        providerId: "openai_compatible",
        providerConfig: {
          baseUrl: "https://example.com/v1",
          model: "test-model"
        }
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("A request-supplied OpenAI-compatible base URL must also provide its own API key.");
  });

  it("disables request-supplied provider URLs in production unless explicitly allowed", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VDT_ALLOW_REQUEST_PROVIDER_URLS", "false");

    const response = await POST(
      jsonRequest({
        rootKpi: "Production Volume",
        providerId: "openai_compatible",
        providerConfig: {
          baseUrl: "https://example.com/v1",
          apiKey: "test-key",
          model: "test-model"
        }
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Request-supplied OpenAI-compatible base URLs are disabled in production.");
  });

  it("generates through a local runner provider response", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true, output: productionVolumeAiOutput }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      jsonRequest({
        rootKpi: "Production Volume",
        providerId: "local_runner",
        providerConfig: {
          runnerUrl: "http://127.0.0.1:8765",
          runnerProviderId: "local_http_stub",
          baseUrl: "http://127.0.0.1:11434/v1",
          model: "qwen3"
        }
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.project?.rootNodeId).toBe("production_volume");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8765/run",
      expect.objectContaining({
        method: "POST"
      })
    );
  });

  it("blocks remote request-supplied local runner URLs in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VDT_ALLOW_REQUEST_LOCAL_RUNNER_URLS", "false");

    const response = await POST(
      jsonRequest({
        rootKpi: "Production Volume",
        providerId: "local_runner",
        providerConfig: {
          runnerUrl: "https://example.com",
          runnerProviderId: "local_http_stub",
          baseUrl: "http://127.0.0.1:11434/v1",
          model: "qwen3"
        }
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Request-supplied local runner URLs are disabled in production.");
  });
});
