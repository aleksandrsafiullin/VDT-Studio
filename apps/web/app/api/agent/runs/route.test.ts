import { describe, expect, it } from "vitest";
import { POST as startRun } from "./route";
import { GET as getRun } from "./[runId]/route";
import { GET as getEvents } from "./[runId]/events/route";
import { POST as postMessage } from "./[runId]/messages/route";
import { POST as cancelRun } from "./[runId]/cancel/route";

function jsonRequest(url: string, body: unknown, init?: RequestInit) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...init
  });
}

async function readJson(response: Response) {
  return await response.json() as {
    ok: boolean;
    runId?: string;
    status?: string;
    snapshot?: {
      runId: string;
      status: string;
      pendingQuestions?: Array<{ id: string }>;
      draftProject?: { rootNodeId: string; graph: { nodes: Array<{ id: string }> } };
      events: Array<{ type: string; seq: number }>;
    };
    error?: { message?: string };
  };
}

describe("agent runs API", () => {
  it("starts a run, asks required questions, replays SSE events, resumes, and cancels", async () => {
    const startResponse = await startRun(jsonRequest("http://localhost:3000/api/agent/runs", {
      mode: "generate_vdt",
      input: {
        rootKpi: "Monthly production volume",
        industry: "Mining",
        businessContext: "Open-pit mine production"
      },
      providerId: "mock",
      providerConfig: {
        command: "forbidden"
      }
    }));
    expect(startResponse.status).toBe(400);
    expect((await readJson(startResponse)).error?.message).toContain("command");

    const validStartResponse = await startRun(jsonRequest("http://localhost:3000/api/agent/runs", {
      mode: "generate_vdt",
      input: {
        rootKpi: "Monthly production volume",
        industry: "Mining",
        businessContext: "Open-pit mine production"
      },
      providerId: "mock"
    }));
    const startBody = await readJson(validStartResponse);

    expect(validStartResponse.status).toBe(200);
    expect(startBody.snapshot?.status).toBe("needs_user_input");
    expect(startBody.snapshot?.pendingQuestions?.map((question) => question.id)).toEqual(
      expect.arrayContaining(["unit", "timePeriod"])
    );
    expect(startBody.snapshot?.draftProject).toBeUndefined();

    const runId = startBody.runId!;
    const snapshotResponse = await getRun(new Request(`http://localhost:3000/api/agent/runs/${runId}`), {
      params: Promise.resolve({ runId })
    });
    expect((await readJson(snapshotResponse)).snapshot?.runId).toBe(runId);

    const eventsResponse = await getEvents(new Request(`http://localhost:3000/api/agent/runs/${runId}/events`), {
      params: Promise.resolve({ runId })
    });
    const reader = eventsResponse.body!.getReader();
    const firstChunk = await reader.read();
    reader.releaseLock();
    await eventsResponse.body?.cancel();
    expect(new TextDecoder().decode(firstChunk.value)).toContain("event: agent_event");
    expect(new TextDecoder().decode(firstChunk.value)).toContain("run_started");

    const resumedResponse = await postMessage(jsonRequest(`http://localhost:3000/api/agent/runs/${runId}/messages`, {
      type: "user_answer",
      answers: {
        unit: "tonnes",
        timePeriod: "monthly",
        bottleneck: "haulage"
      }
    }), {
      params: Promise.resolve({ runId })
    });
    const resumed = await readJson(resumedResponse);

    expect(resumed.snapshot?.status).toBe("succeeded");
    expect(resumed.snapshot?.draftProject?.graph.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(["monthly_production_volume", "effective_working_time", "average_productivity"])
    );

    const cancelResponse = await cancelRun(new Request(`http://localhost:3000/api/agent/runs/${runId}/cancel`, { method: "POST" }), {
      params: Promise.resolve({ runId })
    });
    expect((await readJson(cancelResponse)).status).toBe("cancelled");
  });
});
