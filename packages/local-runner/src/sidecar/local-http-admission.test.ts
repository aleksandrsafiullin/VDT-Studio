import { describe, expect, it, vi } from "vitest";
import { type OwnedLocalHttpRoute, type ResolveOwnedLocalHttpRoute } from "@vdt-studio/model-bridge";
import { BUILTIN_BACKEND_MANIFESTS } from "../server/manifests";
import { createLocalRuntimeContext } from "../server/runtime";
import { parseSidecarFrame, type JsonObject, type SidecarRequestMessage, type SidecarRequestMethod } from "./protocol";
import { handleSidecarRequest } from "./runtime";

const model = "qwen3:8b";
const pin = { profileVersion: "ollama-offline.1", modelRevision: `sha256:${"a".repeat(64)}` };
const completion = { backendId: "ollama", model, taskType: "generate_tree", schemaId: "connection-test-v1", input: {} };

function request(method: SidecarRequestMethod, payload: JsonObject): SidecarRequestMessage {
  const frame = { protocolVersion: 1, type: "request", requestId: crypto.randomUUID(), method, payload };
  return parseSidecarFrame(JSON.stringify(frame), { direction: "host-to-sidecar" }) as SidecarRequestMessage;
}

function fixture() {
  const legacy = vi.fn<typeof fetch>(async () => new Response(null, { status: 500 }));
  const inference = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: '{"ok":true}' } }] }));
  const route: OwnedLocalHttpRoute = {
    ...pin, backendId: "ollama", model, task: "connection_test", baseUrl: "http://127.0.0.1:11434/v1", fetch: inference
  };
  const resolve: ResolveOwnedLocalHttpRoute = () => route;
  const resolveExecutable = vi.fn(async () => { throw new Error("Fixture forbids CLI execution."); });
  const context = createLocalRuntimeContext({
    auditSink() {},
    detection: { path: "", executableCheck: async () => false },
    executor: { fetch: legacy, requireVerifiedLocalHttp: true, resolveOwnedLocalHttpRoute: resolve, resolveExecutable }
  });
  return { legacy, inference, route, context, resolveExecutable };
}

describe("verified local HTTP through the private protocol", () => {
  it("forwards Fast in a pinned connection Test and sends explicit Off", async () => {
    const { legacy, inference, context } = fixture();
    inference.mockImplementation(async url => String(url).endsWith("/api/show")
      ? Response.json({ thinking: { values: [false, true] } })
      : Response.json({ done: true, done_reason: "stop", message: { content: '{"ok":true}' } }));
    const result = await handleSidecarRequest(request("test_backend", { backendId: "ollama", model, localHttpSelection: pin, modelReasoning: "vdt-fast" }), context);
    expect(result).toMatchObject({ ok: true });
    expect(JSON.parse(String(inference.mock.calls[1]?.[1]?.body))).toMatchObject({ model, think: false });
    expect(legacy).not.toHaveBeenCalled();
  });
  it("dispatches an exact host-owned pin using only its confined transport", async () => {
    const { legacy, inference, context } = fixture();
    const result = await handleSidecarRequest(request("test_backend", { backendId: "ollama", model, localHttpSelection: pin }), context);
    expect(result).toMatchObject({ ok: true });
    const [calledUrl, init] = inference.mock.calls[0]!;
    expect(calledUrl).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(init).toMatchObject({ redirect: "error" });
    expect(JSON.parse(String(init?.body))).toMatchObject({ model });
    expect(legacy).not.toHaveBeenCalled();
  });

  it("rejects stale pins, removed pins, cloud aliases and substituted backends before any transport call", async () => {
    const { legacy, inference, resolveExecutable, context } = fixture();
    const attempts = [
      { ...completion, localHttpSelection: { ...pin, modelRevision: `sha256:${"b".repeat(64)}` } },
      { ...completion, localHttpSelection: { ...pin, profileVersion: "ollama-offline.0" } },
      { ...completion },
      { ...completion, model: "qwen3:8b-cloud", localHttpSelection: pin },
      { ...completion, backendId: "codex_subscription", localHttpSelection: pin },
      { ...completion, backendId: "codex_subscription" },
      { ...completion, backendId: "lm_studio", localHttpSelection: pin }
    ];
    for (const payload of attempts) expect(await handleSidecarRequest(request("complete", payload), context)).toMatchObject({ ok: false });
    expect(legacy).not.toHaveBeenCalled();
    expect(inference).not.toHaveBeenCalled();
    expect(resolveExecutable).not.toHaveBeenCalled();
  });

  it("rejects proof-shaped caller input and does not use a diagnostic pin for Smart metadata", async () => {
    const { legacy, inference, context } = fixture();
    expect(() => request("complete", { ...completion, localHttpSelection: { ...pin, offline: true } })).toThrow();
    expect(await handleSidecarRequest(request("smart_execution", { backendId: "ollama", model, localHttpSelection: pin }), context))
      .toMatchObject({ ok: false, error: { code: "LOCAL_ROUTE_UNVERIFIED" } });
    expect(await handleSidecarRequest(request("test_backend", { backendId: "codex_subscription" }), context))
      .toMatchObject({ ok: false, error: { code: "LOCAL_TARGET_REJECTED" } });
    expect(await handleSidecarRequest(request("list_models", { backendId: "ollama" }), context))
      .toMatchObject({ ok: false, error: { code: "LOCAL_ROUTE_UNVERIFIED" } });
    expect(legacy).not.toHaveBeenCalled();
    expect(inference).not.toHaveBeenCalled();
  });

  it("rejects a remotely configured manifest before invoking even a resolver", async () => {
    const { legacy, inference, route } = fixture();
    const remote = { ...BUILTIN_BACKEND_MANIFESTS.find(item => item.id === "ollama")!, id: "remote-fixture", localHttp: { baseUrl: "https://external.example/v1", defaultModel: model } };
    const resolve = vi.fn(() => route);
    const context = createLocalRuntimeContext({ manifests: [remote], executor: { fetch: legacy, resolveOwnedLocalHttpRoute: resolve } });
    expect(await handleSidecarRequest(request("complete", { ...completion, backendId: remote.id, localHttpSelection: pin }), context))
      .toMatchObject({ ok: false, error: { code: "LOCAL_TARGET_REJECTED" } });
    expect(resolve).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
    expect(inference).not.toHaveBeenCalled();
  });

  it("reports unverified locality for legacy metadata and rejects a local pin with no resolver", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ capabilities: ["completion"] }));
    const context = createLocalRuntimeContext({ executor: { fetch: fetcher } });
    expect(await handleSidecarRequest(request("smart_execution", { backendId: "ollama", model, localHttpSelection: pin }), context))
      .toMatchObject({ ok: false, error: { code: "LOCAL_ROUTE_UNVERIFIED" } });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await handleSidecarRequest(request("smart_execution", { backendId: "ollama", model }), context))
      .toMatchObject({ ok: true, payload: { identity: { processingBoundary: "unverified" } } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
