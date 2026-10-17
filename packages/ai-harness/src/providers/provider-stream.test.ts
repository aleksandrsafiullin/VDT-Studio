import { afterEach, describe, expect, it, vi } from "vitest";
import { requestProviderNdjson } from "./provider-utils";

afterEach(() => vi.useRealTimers());

function streamRequest(options: { firstChunkTimeoutMs?: number; idleTimeoutMs?: number; timeoutMs?: number; maxResponseBytes?: number } = {}) {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const chunks: Record<string, unknown>[] = [];
  const done = requestProviderNdjson({
    providerName: "Ollama", url: "http://127.0.0.1:11434/api/chat", init: {}, ...options,
    fetch: async (_url, init) => new Response(new ReadableStream({ start(controller) {
      stream = controller;
      init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")), { once: true });
    } })),
    onChunk: (chunk) => chunks.push(chunk)
  });
  const push = (chunk: unknown) => stream.enqueue(new TextEncoder().encode(`${JSON.stringify(chunk)}\n`));
  return { done, push, close: () => stream.close(), chunks };
}

describe("bounded provider streams", () => {
  it("allows a progressing generation beyond five minutes without resetting its hard limit", async () => {
    vi.useFakeTimers();
    const request = streamRequest();
    await vi.advanceTimersByTimeAsync(10);
    for (let index = 0; index < 8; index += 1) {
      request.push({ message: { content: "token" }, done: false });
      await vi.advanceTimersByTimeAsync(45_000);
    }
    request.push({ done: true });
    request.close();
    await expect(request.done).resolves.toBeUndefined();
    expect(request.chunks).toHaveLength(9);
  });

  it.each([
    [false, "produced no response", 300_001],
    [true, "stalled", 60_001]
  ] as const)("cancels a stuck stream (%s)", async (started, message, wait) => {
    vi.useFakeTimers();
    const request = streamRequest();
    const rejected = expect(request.done).rejects.toThrow(message);
    await vi.advanceTimersByTimeAsync(10);
    if (started) request.push({ message: { content: "first" }, done: false });
    await vi.advanceTimersByTimeAsync(wait);
    await rejected;
  });

  it("retains an absolute deadline even when frames continue", async () => {
    vi.useFakeTimers();
    const request = streamRequest({ timeoutMs: 180_000 });
    const rejected = expect(request.done).rejects.toThrow("turn limit");
    await vi.advanceTimersByTimeAsync(10);
    for (let index = 0; index < 4; index += 1) {
      request.push({ message: { content: "token" } });
      await vi.advanceTimersByTimeAsync(45_000);
    }
    await rejected;
  });

  it("bounds total response bytes", async () => {
    const request = streamRequest({ maxResponseBytes: 10 });
    const rejected = expect(request.done).rejects.toThrow("maximum allowed size");
    request.push({ message: { content: "too much" } });
    await rejected;
  });
});
