import { describe, expect, it, vi } from "vitest";
import { buildChatStarterInput, productionVolumeProject } from "@vdt-studio/vdt-core";
import { executeCompletion } from "./executor";
import { BUILTIN_BACKEND_MANIFESTS } from "./manifests";

describe("local model chat starters", () => {
  const manifest = BUILTIN_BACKEND_MANIFESTS.find(({ id }) => id === "ollama")!;
  const request = {
    requestId: "test",
    taskType: "suggest_chat_starters",
    schemaId: "suggest-chat-starters-v1",
    backendId: "ollama",
    model: "chosen-model",
    input: buildChatStarterInput(productionVolumeProject, "ru"),
    modelReasoning: "high"
  } as const;
  const prompts = ["Как проверить потери?", "Каких данных не хватает?", "Что сильнее всего влияет на выпуск?"];

  it("makes one structured call using the selected model and disables Ollama thinking", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      done: true, done_reason: "stop", message: { content: JSON.stringify({ prompts }) }
    }));
    const result = await executeCompletion(manifest, request, new AbortController().signal, { fetch: fetcher });
    expect(result.output).toEqual({ prompts });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(sent).toMatchObject({ model: "chosen-model", stream: false, think: false });
    expect(JSON.parse(sent.messages[1].content).locale).toBe("ru");
  });

  it("rejects provider tool activity before displaying prompts", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      done: true, done_reason: "stop", message: { content: JSON.stringify({ prompts }), tool_calls: [{ name: "read" }] }
    }));
    await expect(executeCompletion(manifest, request, new AbortController().signal, { fetch: fetcher })).rejects
      .toMatchObject({ code: "TOOL_ACTIVITY_REJECTED" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
