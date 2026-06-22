import { afterEach, describe, expect, it, vi } from "vitest";
import * as aiHarness from "@vdt-studio/ai-harness";
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

  it("rejects unknown providerId with 400 before provider execution", async () => {
    const response = await POST(
      jsonRequest({
        rootKpi: "Production Volume",
        providerId: "unknown_provider"
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Unsupported providerId: unknown_provider");
  });

  it("rejects missing providerId with 400 before provider execution", async () => {
    const response = await POST(jsonRequest({ rootKpi: "Production Volume" }));
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Select a configured Local CLI or BYOK provider before generating.");
  });

  it("returns provider failure without falling back to mock", async () => {
    const fetchMock = vi.fn(async () => new Response("upstream failed", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      jsonRequest({
        rootKpi: "Production Volume",
        providerId: "openai_compatible",
        providerConfig: {
          apiKey: "test-key",
          model: "gpt-5.5"
        }
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.error).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes maxTokens from providerConfig to generateVdtProject", async () => {
    const generateSpy = vi.spyOn(aiHarness, "generateVdtProject");

    try {
      const response = await POST(
        jsonRequest({
          rootKpi: "Production Volume",
          providerId: "mock",
          providerConfig: { maxTokens: 8_192 }
        })
      );

      expect(response.status).toBe(200);
      expect(generateSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ rootKpi: "Production Volume" }),
        expect.objectContaining({ maxTokens: 8_192 })
      );
    } finally {
      generateSpy.mockRestore();
    }
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

  it("performs a real BYOK connection request instead of configuration-only validation", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"ok":true}' } }]
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(jsonRequest({
      operation: "connection_test",
      providerId: "openai_compatible",
      providerConfig: {
        apiKey: "test-key",
        model: "gpt-5.5"
      }
    }));

    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("performs a dashscope connection test through openai_compatible", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"ok":true}' } }]
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(jsonRequest({
      operation: "connection_test",
      providerId: "openai_compatible",
      providerConfig: {
        apiKey: "sk-sp-test-key",
        baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
        model: "qwen3-coder-plus"
      }
    }));

    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://coding.dashscope.aliyuncs.com/v1/chat/completions",
      expect.objectContaining({ method: "POST" })
    );
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

  it.each([
    ["anthropic", { baseUrl: "https://custom.example", model: "claude-test" }, "ANTHROPIC_API_KEY"],
    ["azure_openai", { endpoint: "https://custom.example", deployment: "deployment" }, "AZURE_OPENAI_API_KEY"],
    ["gemini", { baseUrl: "https://custom.example", model: "gemini-test" }, "GEMINI_API_KEY"]
  ])("does not forward an environment key to a request-supplied %s endpoint", async (providerId, providerConfig, envKey) => {
    vi.stubEnv(envKey, "server-secret");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(jsonRequest({ rootKpi: "Production Volume", providerId, providerConfig }));
    expect(response.status).toBe(400);
    expect((await readJson(response)).error).toContain("must also provide its own API key");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires a request API key when Azure custom endpoint is supplied through baseUrl", async () => {
    vi.stubEnv("AZURE_OPENAI_API_KEY", "server-secret");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(jsonRequest({
      rootKpi: "Production Volume",
      providerId: "azure_openai",
      providerConfig: {
        baseUrl: "https://azure-alias.example",
        deployment: "deployment"
      }
    }));

    expect(response.status).toBe(400);
    expect((await readJson(response)).error).toBe(
      "A request-supplied Azure OpenAI endpoint must also provide its own API key."
    );
    expect(fetchMock).not.toHaveBeenCalled();
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
          backendId: "ollama",
          pairingToken: "session-token",
          model: "qwen3"
        }
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.project?.rootNodeId).toBe("production_volume");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8765/v1/completions",
      expect.objectContaining({
        method: "POST"
      })
    );
  });

  it.each([
    {
      providerId: "anthropic",
      config: { apiKey: "anthropic-key", model: "claude-test" },
      response: { content: [{ type: "tool_use", name: "return_structured_output", input: productionVolumeAiOutput }] },
      url: "https://api.anthropic.com/v1/messages"
    },
    {
      providerId: "azure_openai",
      config: {
        endpoint: "https://example.openai.azure.com",
        apiKey: "azure-key",
        deployment: "vdt-deployment",
        apiVersion: "2024-10-21"
      },
      response: { choices: [{ message: { content: JSON.stringify(productionVolumeAiOutput) } }] },
      url: "https://example.openai.azure.com/openai/deployments/vdt-deployment/chat/completions?api-version=2024-10-21"
    },
    {
      providerId: "gemini",
      config: { apiKey: "gemini-key", model: "gemini-test" },
      response: { candidates: [{ content: { parts: [{ text: JSON.stringify(productionVolumeAiOutput) }] } }] },
      url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent"
    }
  ])("generates through the $providerId provider", async ({ providerId, config, response: providerResponse, url }) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(providerResponse), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(jsonRequest({
      rootKpi: "Production Volume",
      providerId,
      providerConfig: config
    }));
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body.project?.rootNodeId).toBe("production_volume");
    expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({ method: "POST" }));
  });

  it("returns a friendly error when local runner fetch fails", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      jsonRequest({
        rootKpi: "Production Volume",
        providerId: "local_runner",
        providerConfig: {
          runnerUrl: "http://127.0.0.1:8765",
          backendId: "ollama",
          pairingToken: "session-token",
          model: "qwen3"
        }
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Local runner is offline");
    expect(body.error).toContain("vdt runner start");
    expect(body.error).not.toContain("fetch failed");
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
          backendId: "ollama",
          pairingToken: "session-token",
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
