import { describe, expect, it, vi } from "vitest";
import { createLocalRuntimeContext, resolveSmartRuntimeExecution } from "./runtime";
import { createManifestRegistry } from "./manifests";
import { handleSidecarRequest } from "../sidecar/runtime";
import { parseSidecarFrame, SIDECAR_PROTOCOL_VERSION } from "../sidecar/protocol";

const metadata = { ollama: { thinking: { values: [false, true, "low"] } }, lm_studio: { supported_reasoning_efforts: ["none", "low"] }, vllm: { capabilities: { reasoning: false } } };
describe("Smart model metadata stays on its selected host", () => {
  it.each(["ollama", "lm_studio", "vllm"] as const)("reads %s only through the private host's fixed manifest without inference", async backendId => {
    const original = createManifestRegistry().get(backendId)!;
    const manifest = { ...original, localHttp: { ...original.localHttp!, baseUrl: "http://127.0.0.1:19991/v1" } };
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(metadata[backendId]));
    const base = createLocalRuntimeContext({ executor: { fetch }, auditSink: () => {} });
    const context = { ...base, manifests: new Map(base.manifests).set(backendId, manifest) };
    const frame = parseSidecarFrame(JSON.stringify({ protocolVersion: SIDECAR_PROTOCOL_VERSION, type: "request", requestId: crypto.randomUUID(), method: "smart_execution", payload: { backendId, model: "selected", timeoutMs: 1000 } }));
    if (frame.type !== "request") throw new Error("Expected request");
    const result = await handleSidecarRequest(frame, context);
    expect(result).toMatchObject({ ok: true, payload: { ok: true, identity: { backendId, modelId: "selected", requestModel: "selected", reasoningValues: backendId === "ollama" ? [false, true, "low"] : backendId === "lm_studio" ? ["none", "low"] : [false] } } });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.[0])).toBe(backendId === "ollama" ? "http://127.0.0.1:19991/api/show" : "http://127.0.0.1:19991/v1/models/selected");
    expect(context.runs.size).toBe(0);
  });
  it("rejects unavailable Off using the same local metadata and never starts generation", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ thinking: { values: ["low", "high"] } }));
    const context = createLocalRuntimeContext({ executor: { fetch }, auditSink: () => {} });
    await expect(resolveSmartRuntimeExecution("selected", context, new AbortController().signal, 1000, "ollama", false)).rejects.toMatchObject({ code: "REASONING_UNSUPPORTED" });
    expect(fetch).toHaveBeenCalledTimes(1); expect(context.runs.size).toBe(0);
    await expect(resolveSmartRuntimeExecution(undefined, context, new AbortController().signal, 1000, "ollama")).rejects.toMatchObject({ code: "INVALID_MODEL" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not admit arbitrary metadata URLs or executables through the private protocol", () => {
    for (const payload of [{ backendId: "ollama", model: "selected", endpoint: "http://169.254.169.254" }, { backendId: "ollama", command: "sh" }, { backendId: "http://127.0.0.1:19991", model: "selected" }]) {
      expect(() => parseSidecarFrame(JSON.stringify({ protocolVersion: SIDECAR_PROTOCOL_VERSION, type: "request", requestId: crypto.randomUUID(), method: "smart_execution", payload }))).toThrow();
    }
  });
});
