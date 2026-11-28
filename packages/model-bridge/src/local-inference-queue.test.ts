import { describe, expect, it, vi } from "vitest";
import { resolveLocalHttpFetch, type OwnedLocalHttpRoute } from "./local-execution-http";
import { LocalInferenceQueue } from "./local-inference-queue";

function deferredBody(cancel?: (reason: unknown) => Promise<void>) {
  let output!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start: controller => { output = controller; }, ...(cancel ? { cancel } : {}) });
  return { response: new Response(stream), finish: () => output.close() };
}

describe("owned local inference arbitration", () => {
  it("holds a one-active lease until the stream ends and cancels a waiting job without dispatch", async () => {
    const queue = new LocalInferenceQueue(2);
    const first = deferredBody();
    const controller = new AbortController();
    const active = await queue.fetch(async () => first.response);
    const skipped = vi.fn(async () => new Response("unexpected"));
    const waiting = queue.fetch(skipped, controller.signal);
    const third = vi.fn(async () => new Response("third"));
    const queued = queue.fetch(third);
    await expect(queue.fetch(async () => new Response("overflow"))).rejects.toMatchObject({ statusCode: 429, code: "LOCAL_INFERENCE_QUEUE_FULL" });
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    expect(skipped).not.toHaveBeenCalled();
    expect(third).not.toHaveBeenCalled();
    first.finish();
    await active.text();
    expect(await (await queued).text()).toBe("third");
    expect(third).toHaveBeenCalledWith({ waitMs: expect.any(Number), pendingAhead: 2 });
  });

  it("waits for active upstream cancellation before it starts the next request", async () => {
    let confirmCancel!: () => void;
    const cancel = vi.fn(() => new Promise<void>(resolve => { confirmCancel = resolve; }));
    const first = deferredBody(cancel);
    const queue = new LocalInferenceQueue();
    const controller = new AbortController();
    const active = await queue.fetch(async () => first.response, controller.signal);
    const next = vi.fn(async () => new Response("next"));
    const queued = queue.fetch(next);
    controller.abort();
    expect(cancel).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
    await expect(active.text()).rejects.toMatchObject({ name: "AbortError" });
    confirmCancel();
    expect(await (await queued).text()).toBe("next");
  });

  it("injects only host-approved native residency and refuses a stale profile while queued", async () => {
    const pin = { profileVersion: "1", modelRevision: `sha256:${"1".repeat(64)}` };
    const target = { backendId: "ollama", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3.5:4b", task: "agent_decision" };
    const first = deferredBody();
    const admission = vi.fn();
    const actual = vi.fn<typeof fetch>().mockResolvedValueOnce(first.response).mockResolvedValue(new Response("fresh"));
    let residency: OwnedLocalHttpRoute["ollamaKeepAliveMinutes"] = 15;
    const resolve = () => ({ ...target, ...pin, ...(residency === undefined ? {} : { ollamaKeepAliveMinutes: residency }), fetch: actual, onInferenceAdmission: admission });
    const send = resolveLocalHttpFetch(target, pin, resolve);
    const url = "http://127.0.0.1:11434/api/chat";
    const request = { method: "POST", body: JSON.stringify({ model: target.model }) };
    await expect(send(url, { ...request, body: JSON.stringify({ model: target.model, keep_alive: "900m" }) })).rejects.toMatchObject({ code: "LOCAL_TARGET_REJECTED" });
    const active = await send(url, request);
    const stale = send(url, request);
    const staleRejected = expect(stale).rejects.toMatchObject({ code: "LOCAL_ROUTE_UNVERIFIED" });
    residency = 30;
    first.finish();
    await active.text();
    await staleRejected;
    expect(actual).toHaveBeenCalledOnce();
    expect(JSON.parse(String(actual.mock.calls[0]?.[1]?.body)).keep_alive).toBe("15m");
    const fresh = resolveLocalHttpFetch(target, pin, resolve);
    await expect((await fresh(url, request)).text()).resolves.toBe("fresh");
    expect(JSON.parse(String(actual.mock.calls[1]?.[1]?.body)).keep_alive).toBe("30m");
    expect(admission).toHaveBeenCalledTimes(2);
  });
});
