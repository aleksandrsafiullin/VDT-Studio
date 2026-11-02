import { describe, expect, it, vi } from "vitest";
import { smartReasoningConfig, selectedProvider } from "./smart-kpi-service";
import { z } from "zod";
import { parseCompletionPayload } from "@vdt-studio/local-runner/server-runtime";
import { parseSidecarFrame, SIDECAR_PROTOCOL_VERSION } from "../../../packages/local-runner/src/sidecar/protocol";
const pinned = vi.hoisted(() => vi.fn());
vi.mock("./pinned-provider-fetch", () => ({ fetchPinnedProvider: pinned }));
vi.mock("./provider-target-security", () => ({ resolveProviderTarget: vi.fn(async (url: string) => ({ url: new URL(url), address: "203.0.113.1", family: 4 })) }));

const api = { providerId: "openai_compatible", input: {}, providerConfig: { baseUrl: "https://api.openai.com/v1", model: "gpt-6-luna", apiKey: "synthetic" } };
describe("Suggested KPI independent reasoning authority", () => {
  it("uses authenticated metadata GET, credential-free documentation GET, and one inference POST through the actual selected-provider wrapper", async () => {
    pinned.mockReset();
    pinned.mockImplementation(async (target: { url: URL }) => target.url.hostname === "developers.openai.com"
      ? new Response('- Model ID: gpt-6-luna\n`reasoning.effort` supports `none`, `low`.')
      : target.url.pathname.includes("/models/") ? Response.json({ id: "gpt-6-luna" })
      : Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"answer":"ok"}' } }] }));
    const provider = await selectedProvider({ ...api, providerConfig: { ...api.providerConfig, modelReasoning: false } }, new AbortController().signal, "http://localhost:3000");
    await expect(provider.completeStructured({ taskType: "suggest_incoming_kpis", input: {}, schema: z.object({ answer: z.string() }), systemPrompt: "System", userPrompt: "Question" })).resolves.toEqual({ answer: "ok" });
    expect(pinned).toHaveBeenCalledTimes(3);
    expect(pinned.mock.calls.map(([, init]) => init.method)).toEqual(["GET", "GET", "POST"]);
    expect(pinned.mock.calls[0]?.[1].headers.get("authorization")).toBe("Bearer synthetic");
    expect(pinned.mock.calls[1]?.[1].headers.get("authorization")).toBeNull();
    expect(JSON.parse(pinned.mock.calls[2]?.[1].body)).toMatchObject({ model: "gpt-6-luna", reasoning_effort: "none" });
  });
  it("maps Off only to a provider-advertised disabled value and preserves named effort", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ supported_reasoning_efforts: ["none", "low", "high"] }));
    await expect(smartReasoningConfig(api, false, fetcher)).resolves.toEqual({ reasoningEffort: "none" });
    await expect(smartReasoningConfig(api, "high", fetcher)).resolves.toEqual({ reasoningEffort: "high" });
    await expect(smartReasoningConfig(api, "max", fetcher)).rejects.toMatchObject({ code: "REASONING_UNSUPPORTED" });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.every(([url]) => String(url) === "https://api.openai.com/v1/models/gpt-6-luna")).toBe(true);
  });
  it("does not use low as a hidden substitute when the model cannot disable reasoning", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ supported_reasoning_efforts: ["low", "high"] }));
    await expect(smartReasoningConfig(api, false, fetcher)).rejects.toMatchObject({ code: "REASONING_UNSUPPORTED" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(smartReasoningConfig(api, undefined, fetcher)).resolves.toEqual({});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("explicitly disables Anthropic thinking and leaves ordinary non-reasoning text models usable", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: "claude-sonnet-4-6", capabilities: { effort: { supported: true, low: { supported: true } } } }));
    await expect(smartReasoningConfig({ ...api, providerId: "anthropic", providerConfig: { model: "claude-sonnet-4-6", baseUrl: "https://api.anthropic.com", apiKey: "synthetic" } }, false, fetcher)).resolves.toEqual({ disableThinking: true });
    await expect(smartReasoningConfig({ ...api, providerConfig: { ...api.providerConfig, model: "gpt-4.1" } }, false, fetcher)).resolves.toEqual({});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5"])("never advertises or attempts Anthropic Off for always-thinking %s", async model => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: model, capabilities: { effort: { supported: true, low: { supported: true }, high: { supported: true } } } }));
    await expect(smartReasoningConfig({ ...api, providerId: "anthropic", providerConfig: { model, baseUrl: "https://api.anthropic.com", apiKey: "synthetic" } }, false, fetcher)).rejects.toMatchObject({ code: "REASONING_UNSUPPORTED" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([false, true, "low", 0, 4096])("preserves exact %s through completion and private-pipe parsers", modelReasoning => {
    const input = { requestId: crypto.randomUUID(), backendId: "ollama", taskType: "suggest_incoming_kpis", schemaId: "suggest-incoming-kpis-v1", input: {}, model: "selected", modelReasoning };
    expect(parseCompletionPayload(input).modelReasoning).toBe(modelReasoning);
    const { requestId, ...payload } = input;
    const frame = parseSidecarFrame(JSON.stringify({ protocolVersion: SIDECAR_PROTOCOL_VERSION, type: "request", requestId, method: "complete", payload }));
    expect(frame).toMatchObject({ payload: { modelReasoning } });
  });
  it.each([null, [], {}, "HIGH", "low;run-command", -1, 1.5, 32769])("rejects invalid reasoning %j before runtime execution", modelReasoning => {
    const input = { requestId: crypto.randomUUID(), backendId: "ollama", taskType: "suggest_incoming_kpis", schemaId: "suggest-incoming-kpis-v1", input: {}, modelReasoning };
    expect(() => parseCompletionPayload(input)).toThrow();
    const { requestId, ...payload } = input;
    expect(() => parseSidecarFrame(JSON.stringify({ protocolVersion: SIDECAR_PROTOCOL_VERSION, type: "request", requestId, method: "complete", payload }))).toThrow();
  });
});
