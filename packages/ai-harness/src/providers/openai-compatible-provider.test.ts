import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OpenAiCompatibleProvider } from "./openai-compatible-provider";

const params = {
  taskType: "generate_vdt" as const,
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
