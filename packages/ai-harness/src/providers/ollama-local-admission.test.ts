import { expect, it, vi } from "vitest";
import { z } from "zod";
import { OllamaProvider } from "./ollama-provider";

const baseUrl = "http://127.0.0.1:11434/v1";
const model = "qwen3:8b";
const params = {
  taskType: "agent_decision" as const, input: {}, schema: z.object({ answer: z.string() }),
  systemPrompt: "System", userPrompt: "Brief"
};
const selection = { profileVersion: "ollama-offline.1", modelRevision: `sha256:${"a".repeat(64)}` };

it("never dispatches to a remote host, a cloud alias or a resolver with stale evidence", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const resolve = () => ({ backendId: "ollama", baseUrl, model, task: params.taskType, ...selection, profileVersion: "ollama-offline.0", fetch });
  const localRoute = { selection, resolve };
  for (const config of [{ baseUrl: "https://example.com/v1", model }, { baseUrl, model: "model:cloud" }, { baseUrl, model }]) {
    const provider = new OllamaProvider({ ...config, fetch, localRoute });
    await expect(provider.completeStructured(params)).rejects.toMatchObject({ code: /^LOCAL_/ });
  }
  expect(fetch).not.toHaveBeenCalled();
});

it("revalidates before dispatch and rejects redirects without falling back", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 307, headers: { location: "https://external.example" } }));
  const legacy = vi.fn<typeof globalThis.fetch>();
  const proof = { backendId: "ollama", baseUrl, model, task: params.taskType, ...selection, fetch };
  const resolve = vi.fn().mockReturnValueOnce(proof).mockReturnValueOnce(undefined).mockReturnValue(proof);
  const provider = new OllamaProvider({ baseUrl, model, fetch: legacy, localRoute: { selection, resolve } });
  await expect(provider.completeStructured(params)).rejects.toMatchObject({ code: "LOCAL_ROUTE_UNVERIFIED" });
  expect(fetch).not.toHaveBeenCalled();
  await expect(provider.completeStructured(params)).rejects.toMatchObject({ code: "LOCAL_TARGET_REJECTED" });
  expect(fetch).toHaveBeenCalledExactlyOnceWith("http://127.0.0.1:11434/api/chat", expect.objectContaining({ redirect: "error" }));
  expect(legacy).not.toHaveBeenCalled();
});
