import { afterEach, describe, expect, it, vi } from "vitest";
import { buildChatStarterInput, productionVolumeProject } from "@vdt-studio/vdt-core";
import * as pinnedProvider from "@/lib/pinned-provider-fetch";
import * as providerSecurity from "@/lib/provider-target-security";
import { POST } from "./route";

function jsonRequest(body: unknown) {
  return new Request("http://localhost:3000/api/ai/run-task", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

async function readJson(response: Response) {
  return (await response.json()) as {
    ok: boolean;
    error?: string;
    result?: {
      kind: string;
      changeSet?: { taskType?: string; additions?: Array<{ nodeId?: string }> };
      result?: { findings?: unknown[]; questionsForUser?: unknown[] };
      agentRun?: { status?: string; events?: Array<{ type?: string }> };
    };
  };
}

describe("run-task API route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses the selected API model for one bounded chat starter completion", async () => {
    vi.stubEnv("OPENAI_COMPATIBLE_BASE_URL", "https://api.openai.com/v1");
    const prompts = ["What drives production volume?", "Where is downtime counted?", "Which assumptions need data?"];
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ prompts }) } }]
    }));
    vi.stubGlobal("fetch", fetcher);
    const response = await POST(jsonRequest({
      taskType: "suggest_chat_starters",
      providerId: "openai_compatible",
      providerConfig: { apiKey: "test-key", model: "gpt-5-mini", reasoningEffort: "high" },
      input: buildChatStarterInput(productionVolumeProject, "en")
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, result: { kind: "chat_starters", prompts } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(sent).toMatchObject({ model: "gpt-5-mini", max_completion_tokens: 1024 });
    expect(sent).not.toHaveProperty("reasoning_effort");
  });

  it("checks the asserted API identity before pinning and invoking the selected model", async () => {
    const prompts = ["What drives production volume?", "Where is downtime counted?", "Which assumptions need data?"];
    const target = { url: new URL("https://api.openai.com/v1/chat/completions"), address: "203.0.113.1", family: 4 };
    const resolve = vi.spyOn(providerSecurity, "resolvePublicProviderTarget").mockResolvedValue(target);
    const complete = vi.spyOn(pinnedProvider, "fetchPinnedProvider").mockResolvedValue(Response.json({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ prompts }) } }]
    }));
    const ordinaryFetch = vi.fn();
    vi.stubGlobal("fetch", ordinaryFetch);
    const body = {
      taskType: "suggest_chat_starters", providerId: "openai_compatible",
      providerConfig: { baseUrl: "https://api.openai.com/v1", apiKey: "test-key", model: "gpt-5-mini", reasoningEffort: "high" },
      input: buildChatStarterInput(productionVolumeProject, "en")
    };
    const expectedExecution = {
      profileVersion: 1, providerId: "openai_compatible", modelId: "gpt-5-mini", modelRevision: null
    };
    for (const invalid of [
      { ...expectedExecution, mode: "local" },
      { ...expectedExecution, mode: "cli_subscription" },
      { ...expectedExecution, mode: "api_keys", modelId: "different-model" },
      { ...expectedExecution, mode: "api_keys", modelRevision: "different-revision" }
    ]) {
      expect((await POST(jsonRequest({ ...body, expectedExecution: invalid }))).status).toBe(400);
    }
    const mixed = await POST(jsonRequest({ ...body, executionBindingId: "opaque-agent-binding",
      expectedExecution: { ...expectedExecution, mode: "api_keys" } }));
    expect(mixed.status).toBe(400);
    expect(resolve).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(ordinaryFetch).not.toHaveBeenCalled();

    const valid = await POST(jsonRequest({ ...body, expectedExecution: { ...expectedExecution, mode: "api_keys" } }));
    expect(valid.status).toBe(200);
    expect(await valid.json()).toMatchObject({ result: { kind: "chat_starters", prompts } });
    expect(resolve).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledOnce();
    const envelope = JSON.parse(complete.mock.calls[0]![1].body);
    expect(envelope.model).toBe("gpt-5-mini");
    expect(envelope).not.toHaveProperty("reasoning_effort");
    expect(ordinaryFetch).not.toHaveBeenCalled();
  });

  it("rejects generate_tree with 400 before provider execution", async () => {
    const response = await POST(
      jsonRequest({
        taskType: "generate_tree",
        providerId: "mock",
        input: { project: productionVolumeProject }
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("generate_tree must use /api/agent/runs.");
  });

  it("rejects legacy generate_vdt alias with 400", async () => {
    const response = await POST(
      jsonRequest({
        taskType: "generate_vdt",
        providerId: "mock",
        input: { project: productionVolumeProject }
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("generate_tree must use /api/agent/runs.");
  });

  it("rejects unknown taskType with 400 before provider execution", async () => {
    const response = await POST(
      jsonRequest({
        taskType: "unknown_task",
        providerId: "mock",
        input: { project: productionVolumeProject }
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("Unsupported taskType: unknown_task");
  });

  it("rejects missing providerId with 400 before provider execution", async () => {
    const response = await POST(
      jsonRequest({
        taskType: "review_model",
        input: { project: productionVolumeProject }
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("Select a configured Local CLI or BYOK provider before running an AI task.");
  });

  it("runs deepen_node through MockProvider", async () => {
    const response = await POST(
      jsonRequest({
        taskType: "deepen_node",
        providerId: "mock",
        input: {
          project: productionVolumeProject,
          nodeId: "unplanned_downtime"
        }
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.result?.kind).toBe("change_set");
    expect(body.result?.changeSet?.taskType).toBe("deepen_node");
    expect(body.result?.changeSet?.additions?.map((entry) => entry.nodeId)).toEqual([
      "equipment_failure_downtime",
      "process_interruption_downtime"
    ]);
    expect(body.result?.agentRun).toMatchObject({
      status: "succeeded",
      events: expect.arrayContaining([
        expect.objectContaining({ type: "classification" }),
        expect.objectContaining({ type: "skill_selected" }),
        expect.objectContaining({ type: "graph_validation" }),
        expect.objectContaining({ type: "final_report" })
      ])
    });
  });

  it("runs review_model through MockProvider", async () => {
    const response = await POST(
      jsonRequest({
        taskType: "review_model",
        providerId: "mock",
        input: {
          project: productionVolumeProject
        }
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.result?.kind).toBe("advisory");
    expect(body.result?.result?.findings?.length).toBeGreaterThan(0);
    expect(body.result?.result?.questionsForUser?.length).toBeGreaterThan(0);
  });

  it("rejects invalid request bodies before provider execution", async () => {
    const malformedResponse = await POST(jsonRequest("{"));
    const missingProjectResponse = await POST(
      jsonRequest({
        taskType: "review_model",
        providerId: "mock",
        input: {}
      })
    );

    expect(malformedResponse.status).toBe(400);
    expect((await readJson(malformedResponse)).error).toBe("Request body must be valid JSON.");
    expect(missingProjectResponse.status).toBe(400);
    expect((await readJson(missingProjectResponse)).error).toBe("input.project is required.");
  });

  it("returns provider failure without falling back to mock", async () => {
    const fetchMock = vi.fn(async () => new Response("upstream failed", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      jsonRequest({
        taskType: "review_model",
        providerId: "openai_compatible",
        providerConfig: {
          apiKey: "test-key",
          model: "gpt-5.5"
        },
        input: {
          project: productionVolumeProject
        }
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.error).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requires an API key for request-supplied OpenAI-compatible base URLs", async () => {
    const response = await POST(
      jsonRequest({
        taskType: "review_model",
        providerId: "openai_compatible",
        providerConfig: {
          baseUrl: "https://example.com/v1",
          model: "test-model"
        },
        input: {
          project: productionVolumeProject
        }
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("A request-supplied OpenAI-compatible base URL must also provide its own API key.");
  });
});
