import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OpenAiCompatibleProvider } from "./openai-compatible-provider";

const params = {
  taskType: "generate_tree" as const,
  input: {},
  schema: z.object({ answer: z.string() }),
  systemPrompt: "System prompt",
  userPrompt: "User prompt"
};

function createProvider(apiKey = "request-secret") {
  return new OpenAiCompatibleProvider({
    baseUrl: "https://provider.example/v1",
    apiKey,
    model: "test-model"
  });
}

describe("OpenAI-compatible provider response limits", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses strict JSON Schema when the caller supplies a registered schema", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ message: { content: "{\"answer\":\"strict\"}" } }]
    })));
    vi.stubGlobal("fetch", fetchMock);
    const schema = {
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
      additionalProperties: false
    };

    await expect(createProvider().completeStructured({ ...params, schema })).resolves.toEqual({ answer: "strict" });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      response_format: {
        type: "json_schema",
        json_schema: { strict: true, schema }
      }
    });
  });

  it.each(["gpt-6-luna", "gpt-6.1-sol", "gpt-5.4", "o3-mini"])("uses reasoning-model completion limits for %s without unsupported sampling fields", async (model) => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ message: { content: '{"answer":"ok"}' } }]
    })));
    vi.stubGlobal("fetch", fetchMock);
    await createProvider().completeStructured({ ...params, model, maxTokens: 4096, temperature: 0 });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.model).toBe(model);
    expect(body.max_completion_tokens).toBe(4096);
    expect(body).not.toHaveProperty("max_tokens");
    expect(body).not.toHaveProperty("temperature");
  });

  it("preserves legacy sampling and token fields for other compatible models", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ message: { content: '{"answer":"ok"}' } }]
    })));
    vi.stubGlobal("fetch", fetchMock);
    await createProvider().completeStructured({ ...params, model: "gpt-4.1", maxTokens: 512, temperature: 0.3 });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ max_tokens: 512, temperature: 0.3 });
  });

  it("supplies the runtime schema in JSON-mode fallback and remembers unsupported strict formatting", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.response_format.type === "json_schema") return new Response(JSON.stringify({ error: {
        code: "invalid_json_schema", param: "response_format", message: "Provider rejected the open argument record"
      } }), { status: 400 });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"answer":"ok"}' } }] }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = createProvider();
    const outputJsonSchema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false };
    await expect(provider.completeStructured({ ...params, outputJsonSchema })).resolves.toEqual({ answer: "ok" });
    await expect(provider.completeStructured({ ...params, outputJsonSchema })).resolves.toEqual({ answer: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const fallback = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(fallback.messages[0].content).toContain(JSON.stringify(outputJsonSchema));
    expect(fallback.messages[0].content).not.toContain("request-secret");
  });

  it("keeps the original brief and three recent confirmed exchanges without unbounded history", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ message: { content: '{"answer":"ok"}' } }]
    })));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createProvider();
    for (const userPrompt of ["Original mine facts and tool catalog", "First delta", "Second delta", "Third delta", "Fourth delta", "Fifth delta"])
      await provider.completeStructured({ ...params, taskType: "agent_decision", userPrompt });
    const body = JSON.parse(String(fetchMock.mock.calls[5]?.[1]?.body));
    expect(body.messages.map((message: { content: string }) => message.content)).toEqual([
      "System prompt", "Original mine facts and tool catalog", '{"answer":"ok"}',
      "Second delta", '{"answer":"ok"}', "Third delta", '{"answer":"ok"}', "Fourth delta", '{"answer":"ok"}', "Fifth delta"
    ]);
  });

  it("includes validation feedback in the single repair of an agent response", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ message: { content: fetchMock.mock.calls.length === 1 ? '{"answer":42}' : '{"answer":"fixed"}' } }]
    })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createProvider().completeStructured({ ...params, taskType: "agent_decision" })).resolves.toEqual({ answer: "fixed" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(second.messages.at(-1).content).toContain("previous response was invalid");
    expect(second.messages.at(-1).content).toContain('"answer"');
  });

  it("rejects a response whose declared content length exceeds the limit", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("upstream-secret-response", {
        headers: { "content-length": "1000001" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const error = await createProvider().completeStructured(params).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "OpenAI-compatible provider response exceeded the maximum allowed size."
    );
    expect((error as Error).message).not.toContain("upstream-secret-response");
    expect((error as Error).message).not.toContain("request-secret");
  });

  it("cancels and rejects a streamed response that exceeds the byte limit", async () => {
    const cancel = vi.fn();
    const chunks = [new Uint8Array(600_000), new Uint8Array(400_001)];
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks.shift();
        if (chunk) controller.enqueue(chunk);
      },
      cancel
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));

    await expect(createProvider().completeStructured(params)).rejects.toThrow(
      "OpenAI-compatible provider response exceeded the maximum allowed size."
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("does not expose response or request secrets in HTTP errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream-secret-response", { status: 401 }))
    );

    const error = await createProvider().completeStructured(params).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "OpenAI-compatible provider request failed with status 401."
    );
    expect((error as Error).message).not.toContain("upstream-secret-response");
    expect((error as Error).message).not.toContain("request-secret");
  });

  it("reports safe parameter identifiers without echoing an upstream secret or retrying an unrelated schema", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: {
      code: "unsupported_parameter", param: "max_tokens", message: "Rejected request-secret and upstream-secret-response"
    } }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createProvider().completeStructured(params)).rejects.toThrow(
      "OpenAI-compatible provider request failed with status 400. (code=unsupported_parameter, param=max_tokens)"
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("aborts the request after the configured timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        })
      )
    );
    const provider = new OpenAiCompatibleProvider({
      baseUrl: "https://provider.example/v1",
      apiKey: "request-secret",
      model: "test-model",
      timeoutMs: 5
    });

    await expect(provider.completeStructured(params)).rejects.toThrow(
      "OpenAI-compatible provider request timed out after 5ms."
    );
  });

  it("propagates a caller abort signal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const rejectAbort = () => reject(new DOMException("Aborted", "AbortError"));
          if (init?.signal?.aborted) rejectAbort();
          else init?.signal?.addEventListener("abort", rejectAbort, { once: true });
        })
      )
    );
    const controller = new AbortController();
    controller.abort();

    await expect(
      createProvider().completeStructured({ ...params, signal: controller.signal })
    ).rejects.toThrow("OpenAI-compatible provider request was aborted.");
  });
});
