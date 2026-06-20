import { afterEach, describe, expect, it, vi } from "vitest";

const { dnsLookupMock } = vi.hoisted(() => ({
  dnsLookupMock: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }])
}));

vi.mock("node:dns/promises", () => ({ lookup: dnsLookupMock }));

import { proxyRuntime } from "../../../../../lib/proxy-runtime";
import { POST } from "./route";

type Provider = "anthropic" | "openai" | "azure" | "google" | "ollama" | "senseaudio";

function request(provider: Provider, overrides: Record<string, unknown> = {}, signal?: AbortSignal) {
  const baseUrl = provider === "ollama" ? "http://127.0.0.1:11434" : "https://provider.example/v1";
  const init: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      baseUrl,
      apiKey: provider === "ollama" ? "" : "top-secret-key",
      model: "test-model",
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Hello" }
      ],
      ...overrides
    })
  };
  if (signal) {
    init.signal = signal;
  }
  return new Request(`http://localhost/api/proxy/${provider}/stream`, init);
}

function context(provider: string) {
  return { params: Promise.resolve({ provider }) };
}

function upstreamBody(provider: Provider) {
  if (provider === "anthropic") {
    return 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n';
  }
  if (provider === "google") {
    return 'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n';
  }
  if (provider === "ollama") {
    return '{"message":{"role":"assistant","content":"Hello"},"done":false}\n{"done":true}\n';
  }
  return 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n';
}

describe("provider stream proxy route", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    dnsLookupMock.mockClear();
    dnsLookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  });

  it.each<Provider>(["anthropic", "openai", "azure", "google", "ollama", "senseaudio"])(
    "builds the %s request and normalizes its stream",
    async (provider) => {
      const fetchMock = vi.fn(async (...args: Parameters<typeof proxyRuntime.request>) => {
        void args;
        return new Response(upstreamBody(provider), {
          status: 200,
          headers: { "content-type": provider === "ollama" ? "application/x-ndjson" : "text/event-stream" }
        });
      });
      vi.spyOn(proxyRuntime, "request").mockImplementation(fetchMock);

      const response = await POST(request(provider), context(provider));
      const output = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      expect(output).toContain('event: delta\ndata: {"text":"Hello"}');
      expect(output).toContain("event: done\ndata: {}");

      const [resolved, options] = fetchMock.mock.calls[0]!;
      const target = resolved.url;
      const headers = new Headers(options.headers);
      const payload = JSON.parse(options.body as string) as Record<string, unknown>;
      expect(options).toMatchObject({ method: "POST" });
      expect(options.signal).toBeInstanceOf(AbortSignal);

      if (provider === "anthropic") {
        expect(target.pathname).toBe("/v1/messages");
        expect(headers.get("x-api-key")).toBe("top-secret-key");
        expect(payload.system).toBe("Be concise.");
      } else if (provider === "azure") {
        expect(target.pathname).toBe("/v1/openai/deployments/test-model/chat/completions");
        expect(target.searchParams.get("api-version")).toBe("2024-10-21");
        expect(headers.get("api-key")).toBe("top-secret-key");
        expect(payload.model).toBeUndefined();
      } else if (provider === "google") {
        expect(target.pathname).toBe("/v1/v1beta/models/test-model:streamGenerateContent");
        expect(target.searchParams.get("alt")).toBe("sse");
        expect(headers.get("x-goog-api-key")).toBe("top-secret-key");
        expect(payload.systemInstruction).toEqual({ parts: [{ text: "Be concise." }] });
      } else if (provider === "ollama") {
        expect(target.pathname).toBe("/api/chat");
        expect(headers.get("authorization")).toBeNull();
      } else {
        expect(target.pathname).toBe("/v1/chat/completions");
        expect(headers.get("authorization")).toBe("Bearer top-secret-key");
      }
    }
  );

  it("validates provider and bounded request fields before fetch", async () => {
    const fetchMock = vi.fn();
    vi.spyOn(proxyRuntime, "request").mockImplementation(fetchMock);

    const unsupported = await POST(request("openai"), context("unknown"));
    const malformed = await POST(
      new Request("http://localhost/api/proxy/openai/stream", { method: "POST", body: "{" }),
      context("openai")
    );
    const tooManyMessages = await POST(
      request("openai", { messages: Array.from({ length: 101 }, () => ({ role: "user", content: "x" })) }),
      context("openai")
    );
    const tooLarge = await POST(
      new Request("http://localhost/api/proxy/openai/stream", {
        method: "POST",
        headers: { "content-length": String(256 * 1024 + 1) },
        body: "{}"
      }),
      context("openai")
    );

    expect(unsupported.status).toBe(404);
    expect(malformed.status).toBe(400);
    expect(tooManyMessages.status).toBe(400);
    expect(tooLarge.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks private DNS answers before fetch", async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: "10.0.0.7", family: 4 }]);
    const fetchMock = vi.fn();
    vi.spyOn(proxyRuntime, "request").mockImplementation(fetchMock);

    const response = await POST(request("openai"), context("openai"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "Provider target resolves to a blocked network address." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([302, 401, 500])("sanitizes upstream status %s without exposing credentials or response text", async (status) => {
    vi.spyOn(proxyRuntime, "request").mockImplementation(async () => new Response(`upstream leaked top-secret-key ${"x".repeat(12_000)}`, { status }));

    const response = await POST(request("openai"), context("openai"));
    const output = await response.text();

    expect(response.status).toBe(502);
    expect(output).not.toContain("top-secret-key");
    expect(output).not.toContain("upstream leaked");
    expect(output).toContain(status === 302 ? "redirects are not allowed" : `status ${status}`);
  });

  it("propagates request aborts to the upstream fetch signal", async () => {
    const controller = new AbortController();
    let upstreamSignal: AbortSignal | undefined;
    vi.spyOn(proxyRuntime, "request").mockImplementation(
      async (_target, init) => {
        upstreamSignal = init.signal as AbortSignal;
        return await new Promise<Response>((_resolve, reject) => {
          upstreamSignal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
      }
    );

    const responsePromise = POST(request("openai", {}, controller.signal), context("openai"));
    await vi.waitFor(() => expect(upstreamSignal).toBeDefined());
    controller.abort();
    const response = await responsePromise;

    expect(upstreamSignal?.aborted).toBe(true);
    expect(response.status).toBe(499);
    expect(await response.json()).toEqual({ ok: false, error: "Provider request was aborted." });
  });

  it("bounds concurrent upstream work without using the supplied API key", async () => {
    const releaseUpstreams: Array<(response: Response) => void> = [];
    vi.spyOn(proxyRuntime, "request").mockImplementation(
      async () => await new Promise<Response>((resolve) => {
        releaseUpstreams.push(resolve);
      })
    );

    const activeResponses = Array.from({ length: 8 }, () => POST(request("openai"), context("openai")));
    await vi.waitFor(() => expect(releaseUpstreams).toHaveLength(8));
    const limited = await POST(request("openai", { apiKey: "a-different-secret" }), context("openai"));

    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("1");
    releaseUpstreams.forEach((release) => release(new Response(upstreamBody("openai"), { status: 200 })));
    await Promise.all(activeResponses.map(async (response) => await (await response).text()));
  });

  it("normalizes in-stream provider errors without leaking their payload", async () => {
    vi.spyOn(proxyRuntime, "request").mockImplementation(
      async () =>
        new Response('data: {"error":{"message":"top-secret-key was rejected"}}\n\n', {
          headers: { "content-type": "text/event-stream" }
        })
      
    );

    const response = await POST(request("openai"), context("openai"));
    const output = await response.text();

    expect(output).toContain('event: error\ndata: {"error":"Upstream stream failed."}');
    expect(output).not.toContain("top-secret-key");
  });

  it("terminates an upstream stream whose total payload exceeds the byte limit", async () => {
    const oversized = new Uint8Array(4 * 1024 * 1024 + 1);
    oversized.fill(32);
    vi.spyOn(proxyRuntime, "request").mockResolvedValue(new Response(oversized, {
      headers: { "content-type": "text/event-stream" }
    }));

    const response = await POST(request("openai"), context("openai"));
    const output = await response.text();

    expect(response.status).toBe(200);
    expect(output).toContain('event: error\ndata: {"error":"Upstream stream failed."}');
    expect(output).not.toContain("event: done");
  });

  it("terminates an oversized unterminated upstream frame", async () => {
    const oversizedFrame = `data: ${"x".repeat(256 * 1024 + 1)}`;
    vi.spyOn(proxyRuntime, "request").mockResolvedValue(new Response(oversizedFrame, {
      headers: { "content-type": "text/event-stream" }
    }));

    const response = await POST(request("openai"), context("openai"));
    const output = await response.text();

    expect(output).toContain('event: error\ndata: {"error":"Upstream stream failed."}');
    expect(output).not.toContain("event: done");
  });

  it("applies the upstream deadline while DNS resolution is pending", async () => {
    vi.useFakeTimers();
    dnsLookupMock.mockImplementationOnce(async () => await new Promise(() => {}));
    const fetchMock = vi.fn();
    vi.spyOn(proxyRuntime, "request").mockImplementation(fetchMock);

    const responsePromise = POST(request("openai"), context("openai"));
    await vi.waitFor(() => expect(dnsLookupMock).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(120_000);
    const response = await responsePromise;

    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ ok: false, error: "Upstream provider request timed out." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rate limits upstream starts within a bounded in-process window", async () => {
    vi.spyOn(proxyRuntime, "request").mockImplementation(
      async () => new Response(upstreamBody("openai"), { status: 200 })
    );

    let limited: Response | undefined;
    let successfulRequests = 0;
    for (let index = 0; index < 61; index += 1) {
      const response = await POST(request("openai"), context("openai"));
      if (response.status === 429) {
        limited = response;
        break;
      }
      successfulRequests += 1;
      await response.text();
    }

    expect(successfulRequests).toBeGreaterThan(0);
    expect(successfulRequests).toBeLessThanOrEqual(60);
    expect(limited?.status).toBe(429);
    expect(Number(limited?.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await limited?.json()).toEqual({
      ok: false,
      error: "Provider proxy capacity is temporarily exhausted."
    });
  });
});
