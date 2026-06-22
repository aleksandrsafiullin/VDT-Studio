import { afterEach, describe, expect, it, vi } from "vitest";
import { productionVolumeProject } from "@vdt-studio/vdt-core";
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
    };
  };
}

describe("run-task API route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
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
    expect(body.error).toBe("generate_tree must use /api/ai/generate-vdt.");
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
    expect(body.error).toBe("generate_tree must use /api/ai/generate-vdt.");
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
