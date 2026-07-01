import { fileURLToPath } from "node:url";
import { createLocalRuntimeContext } from "@vdt-studio/local-runner/server-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as startRun } from "./route";
import { GET as getRun } from "./[runId]/route";
import { GET as getEvents } from "./[runId]/events/route";
import { POST as postMessage } from "./[runId]/messages/route";
import { POST as cancelRun } from "./[runId]/cancel/route";
import { agentRuntime } from "./runtime";

const fakeCodex = fileURLToPath(new URL("../../../../../../packages/local-runner/src/server/fixtures/fake-codex.cjs", import.meta.url));
const runtimeGlobal = globalThis as typeof globalThis & {
  __vdtStudioDevelopmentRuntime?: ReturnType<typeof createLocalRuntimeContext>;
};

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
      visibleContext?: { brief?: { businessContext?: string } };
      pendingQuestions?: Array<{ id: string }>;
      selectedSkills: Array<{ id: string }>;
      draftProject?: { rootNodeId: string; graph: { nodes: Array<{ id: string; baselineValue?: number }> } };
      events: Array<{ type: string; seq: number }>;
    };
    error?: { message?: string };
  };
}

function agentRunIds(): string[] {
  return [...((agentRuntime.store as unknown as { runs: Map<string, unknown> }).runs.keys())];
}

async function waitForNewAgentRun(previousIds: string[]): Promise<string> {
  const previous = new Set(previousIds);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const runId = agentRunIds().find((id) => !previous.has(id));
    if (runId) return runId;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for agent run.");
}

async function waitForRunSnapshot(
  runId: string,
  predicate: (snapshot: NonNullable<Awaited<ReturnType<typeof readJson>>["snapshot"]>) => boolean
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await getRun(new Request(`http://localhost:3000/api/agent/runs/${runId}`), {
      params: Promise.resolve({ runId })
    });
    const body = await readJson(response);
    if (body.snapshot && predicate(body.snapshot)) {
      return body.snapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for agent run "${runId}".`);
}

async function waitForManagedRuntimeRun() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((runtimeGlobal.__vdtStudioDevelopmentRuntime?.runs.size ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for managed runtime request.");
}

async function waitForManagedRuntimeCancelled() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ([...(runtimeGlobal.__vdtStudioDevelopmentRuntime?.runs.values() ?? [])].some((run) => run.status === "cancelled")) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for managed runtime cancellation.");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  delete runtimeGlobal.__vdtStudioDevelopmentRuntime;
});

describe("agent runs API", () => {
  it("accepts blank optional brief fields from the agent composer", async () => {
    const response = await startRun(jsonRequest("http://localhost:3000/api/agent/runs", {
      mode: "generate_vdt",
      input: {
        prompt: "I have 5 Komatsu PC1250 and 2 Komatsu PC2000",
        rootKpi: "Ore Excavation",
        industry: "",
        businessContext: "",
        unit: "ton",
        timePeriod: "Year",
        goal: "",
        levelOfDetail: "",
        selectedNodeId: ""
      },
      workspace: {
        projectId: "project_ore_excavation",
        projectName: "",
        industry: "",
        description: ""
      },
      providerId: "mock",
      options: { continueWithAssumptions: false }
    }));
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body.snapshot?.status).toBe("running");
    expect(body.snapshot?.visibleContext?.brief?.businessContext).toBe("I have 5 Komatsu PC1250 and 2 Komatsu PC2000");
    const snapshot = await waitForRunSnapshot(body.runId!, (run) => run.selectedSkills.length > 0);
    expect(snapshot.selectedSkills.length).toBeGreaterThan(0);
  });

  it("returns a JSON error when an agent run snapshot cannot be loaded", async () => {
    vi.spyOn(agentRuntime.store, "has").mockImplementation(() => {
      throw new Error("sqlite lookup failed");
    });

    const response = await getRun(new Request("http://localhost:3000/api/agent/runs/broken"), {
      params: Promise.resolve({ runId: "broken" })
    });
    const body = await readJson(response);

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body.ok).toBe(false);
    expect(body.error?.message).toContain("sqlite lookup failed");
  });

  it("starts a run, asks required questions, replays SSE events, resumes, and cancels", async () => {
    const startResponse = await startRun(jsonRequest("http://localhost:3000/api/agent/runs", {
      mode: "generate_vdt",
      input: {
        prompt: "I have 5 trucks\nAverage distance 2.7 km\nAverage load speed - 7 km/h\nAverage empty speed - 11 km/h",
        rootKpi: "Ore haulage",
        unit: "tonnes/year",
        timePeriod: "year"
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
        prompt: "I have 5 trucks\nAverage distance 2.7 km\nAverage load speed - 7 km/h\nAverage empty speed - 11 km/h",
        rootKpi: "Ore haulage",
        unit: "tonnes/year",
        timePeriod: "year"
      },
      providerId: "mock",
      options: { autoApplyPatches: true, maxAutoDepth: 4 }
    }));
    const startBody = await readJson(validStartResponse);

    expect(validStartResponse.status).toBe(200);
    expect(startBody.snapshot?.status).toBe("running");
    expect(startBody.snapshot?.events.find((event) => event.type === "user_instruction")).toBeDefined();
    expect(startBody.snapshot?.draftProject).toBeUndefined();

    const runId = startBody.runId!;
    const needsInput = await waitForRunSnapshot(runId, (snapshot) => snapshot.status === "needs_user_input");
    expect(needsInput.selectedSkills.map((skill) => skill.id)).toEqual(["mining.haulage_truck_cycle"]);
    expect(needsInput.pendingQuestions?.map((question) => question.id)).toEqual(
      expect.arrayContaining(["payload_per_trip_t", "operating_hours"])
    );
    expect(needsInput.draftProject).toBeUndefined();

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
        payload_per_trip_t: "40 tonnes",
        operating_hours: "4000 hours/year"
      }
    }), {
      params: Promise.resolve({ runId })
    });
    expect(resumedResponse.status).toBe(200);
    const acceptedAnswer = await readJson(resumedResponse);
    expect(acceptedAnswer.snapshot?.status).toBe("running");

    const resumed = await waitForRunSnapshot(runId, (snapshot) => snapshot.status === "succeeded");
    expect(resumed.draftProject?.graph.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(["ore_haulage", "number_of_trucks", "haul_distance_km", "loaded_speed_kmh", "empty_speed_kmh"])
    );
    expect(resumed.draftProject?.graph.nodes.find((node) => node.id === "number_of_trucks")?.baselineValue).toBe(5);

    const cancelResponse = await cancelRun(new Request(`http://localhost:3000/api/agent/runs/${runId}/cancel`, { method: "POST" }), {
      params: Promise.resolve({ runId })
    });
    expect((await readJson(cancelResponse)).status).toBe("cancelled");
  }, 20_000);

  it("uses the managed local runtime for local_runner agent planning without standalone pairing", async () => {
    const response = await startRun(jsonRequest("http://localhost:3000/api/agent/runs", {
      mode: "generate_vdt",
      input: {
        prompt: "I have 5 trucks\nAverage distance 2.7 km\nAverage load speed - 7 km/h\nAverage empty speed - 11 km/h",
        rootKpi: "Ore haulage",
        unit: "tonnes/year",
        timePeriod: "year"
      },
      providerId: "local_runner",
      providerConfig: {
        backendId: "mock"
      },
      options: { continueWithAssumptions: false }
    }));
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body.snapshot?.status).toBe("running");
    const snapshot = await waitForRunSnapshot(body.runId!, (run) => run.status === "needs_user_input");
    expect(snapshot.selectedSkills.map((skill) => skill.id)).toEqual(["mining.haulage_truck_cycle"]);
    expect(snapshot.events.find((event) => event.type === "tool_call_started")).toBeDefined();
  });

  it("uses the managed local runtime for desktop local_runner agent planning without standalone pairing", async () => {
    vi.stubEnv("VDT_APP_MODE", "desktop");

    const response = await startRun(jsonRequest("http://localhost:3000/api/agent/runs", {
      mode: "generate_vdt",
      input: {
        prompt: "I have 5 trucks\nAverage distance 2.7 km\nAverage load speed - 7 km/h\nAverage empty speed - 11 km/h",
        rootKpi: "Ore haulage",
        unit: "tonnes/year",
        timePeriod: "year"
      },
      providerId: "local_runner",
      providerConfig: {
        backendId: "mock"
      },
      options: { continueWithAssumptions: false }
    }));
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body.snapshot?.status).toBe("running");
    const snapshot = await waitForRunSnapshot(body.runId!, (run) => run.status === "needs_user_input");
    expect(snapshot.selectedSkills.map((skill) => skill.id)).toEqual(["mining.haulage_truck_cycle"]);
  });

  it("refreshes stale managed local runtime manifests before agent decisions", async () => {
    const staleContext = createLocalRuntimeContext({ auditSink: () => undefined });
    const staleManifest = staleContext.manifests.get("mock");
    if (!staleManifest) throw new Error("Expected mock manifest.");
    (staleContext.manifests as Map<string, typeof staleManifest>).set("mock", Object.freeze({
      ...staleManifest,
      taskTypes: staleManifest.taskTypes.filter((taskType) => taskType !== "agent_decision"),
      schemaIds: staleManifest.schemaIds.filter((schemaId) => schemaId !== "agent-decision-v1")
    }));
    runtimeGlobal.__vdtStudioDevelopmentRuntime = staleContext;

    const response = await startRun(jsonRequest("http://localhost:3000/api/agent/runs", {
      mode: "generate_vdt",
      input: {
        prompt: "I have 5 trucks\nAverage distance 2.7 km\nAverage load speed - 7 km/h\nAverage empty speed - 11 km/h",
        rootKpi: "Ore haulage",
        unit: "tonnes/year",
        timePeriod: "year"
      },
      providerId: "local_runner",
      providerConfig: {
        backendId: "mock"
      },
      options: { continueWithAssumptions: false }
    }));
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body.snapshot?.status).toBe("running");
    await waitForManagedRuntimeRun();
    expect(runtimeGlobal.__vdtStudioDevelopmentRuntime).not.toBe(staleContext);
    expect(runtimeGlobal.__vdtStudioDevelopmentRuntime?.manifests.get("mock")?.taskTypes).toContain("agent_decision");
    expect(runtimeGlobal.__vdtStudioDevelopmentRuntime?.manifests.get("mock")?.schemaIds).toContain("agent-decision-v1");
  });

  it("cancels the managed local runtime request when an agent run is cancelled", async () => {
    runtimeGlobal.__vdtStudioDevelopmentRuntime = createLocalRuntimeContext({
      executor: {
        env: { ...process.env, VDT_FAKE_CODEX_MODE: "slow" },
        resolveExecutable: async () => fakeCodex
      }
    });
    const previousIds = agentRunIds();
    const startPromise = startRun(jsonRequest("http://localhost:3000/api/agent/runs", {
      mode: "generate_vdt",
      input: {
        prompt: "I have 5 trucks\nAverage distance 2.7 km\nAverage load speed - 7 km/h\nAverage empty speed - 11 km/h",
        rootKpi: "Ore haulage",
        unit: "tonnes/year",
        timePeriod: "year"
      },
      providerId: "local_runner",
      providerConfig: {
        backendId: "codex_subscription",
        timeoutMs: 30_000
      },
      options: { continueWithAssumptions: false }
    }));

    const runId = await waitForNewAgentRun(previousIds);
    await waitForManagedRuntimeRun();

    const cancelResponse = await cancelRun(new Request(`http://localhost:3000/api/agent/runs/${runId}/cancel`, { method: "POST" }), {
      params: Promise.resolve({ runId })
    });
    expect((await readJson(cancelResponse)).status).toBe("cancelled");

    const startResponse = await startPromise;
    expect(startResponse.status).toBe(200);
    const cancelled = await waitForRunSnapshot(runId, (snapshot) => snapshot.status === "cancelled");
    expect(cancelled.status).toBe("cancelled");
    await waitForManagedRuntimeCancelled();
  });
});
