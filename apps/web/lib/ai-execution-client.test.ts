import { describe, expect, it, vi } from "vitest";
import { productionVolumeProject } from "@vdt-studio/vdt-core";
import {
  type AiExecutionProgressEvent,
  createAiExecutionClient,
  DESKTOP_LOCAL_AI_PLACEHOLDER_MESSAGE,
  DesktopAiExecutionClient,
  DevelopmentRunnerClient,
  HOSTED_WEB_LOCAL_AI_MESSAGE
} from "./ai-execution-client";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) }
  });
}

function agentRunFixture(overrides: Record<string, unknown> = {}) {
  return {
    runId: "agent-run-1",
    status: "succeeded",
    phase: "reporting",
    request: {
      rootKpi: "Production Volume",
      industry: "Mining"
    },
    selectedSkills: [
      {
        id: "mining.production_volume",
        path: "packages/vdt-agent/skills/mining/production-volume.md",
        reason: "Matched mining production throughput context."
      }
    ],
    events: [
      {
        id: "evt-classification",
        timestamp: "2026-06-24T00:00:00.000Z",
        type: "classification",
        title: "Classified request",
        message: "Classified request as mining / production throughput."
      },
      {
        id: "evt-final-report",
        timestamp: "2026-06-24T00:00:01.000Z",
        type: "final_report",
        title: "Final report",
        message: "Generated final VDT report."
      }
    ],
    finalReport: "Validation result: Graph validation passed.",
    ...overrides
  };
}

function deepenNodeOutputFixture() {
  return {
    targetNodeId: "unplanned_downtime",
    nodes: [
      {
        id: "equipment_failure_downtime_test",
        name: "Equipment Failure Downtime",
        description: "Hours lost to equipment failures.",
        type: "input",
        unit: "hours/month",
        aiConfidence: 0.82,
        aiRationale: "Equipment failures directly increase unplanned downtime.",
        controllability: "medium",
        materiality: "high"
      }
    ],
    edges: [
      {
        id: "edge_unplanned_downtime_equipment_failure_downtime_test",
        sourceNodeId: "unplanned_downtime",
        targetNodeId: "equipment_failure_downtime_test",
        relation: "positive_driver",
        aiConfidence: 0.82
      }
    ],
    assumptions: ["Failure hours are tracked monthly."],
    questionsForUser: [],
    warnings: []
  };
}

describe("AiExecutionClient", () => {
  it("routes factory clients by app mode", async () => {
    await expect(createAiExecutionClient("hosted_web").getEnvironment()).resolves.toBe("hosted_web");
    await expect(createAiExecutionClient("desktop").getEnvironment()).resolves.toBe("desktop");
    await expect(createAiExecutionClient("development_web").getEnvironment()).resolves.toBe("development_web");
  });

  it("does not call local CLI detection from hosted web mode", async () => {
    const fetcher = vi.fn();
    const result = await createAiExecutionClient("hosted_web", fetcher as unknown as typeof fetch).detectSubscriptionClis();

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.agents).toHaveLength(5);
    expect(result.agents.every((agent) => agent.installed === false && agent.status === "unavailable")).toBe(true);
    expect(result.agents[0]?.authSummary).toBe(HOSTED_WEB_LOCAL_AI_MESSAGE);
  });

  it("uses the development detection route only for the development runner client", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        agents: [
          {
            id: "codex",
            installed: true,
            executable: null,
            alias: "codex",
            version: "1.0.0",
            status: "ready"
          }
        ],
        modelsByAgent: { codex: ["gpt-5"] }
      })
    );
    const result = await new DevelopmentRunnerClient(fetcher as unknown as typeof fetch).detectSubscriptionClis("codex");

    expect(fetcher).toHaveBeenCalledWith("/api/ai/detect-clis?id=codex");
    expect(result.agents[0]).toMatchObject({ id: "codex", installed: true, status: "ready" });
    expect(result.modelsByAgent.codex).toEqual(["gpt-5"]);
  });

  it("binds the default browser fetch before calling web detection routes", async () => {
    const originalFetch = globalThis.fetch;
    const boundSensitiveFetch = vi.fn(function (this: unknown, input: Parameters<typeof fetch>[0]) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      expect(input).toBe("/api/ai/detect-clis");
      return Promise.resolve(jsonResponse({ agents: [], modelsByAgent: {} }));
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", boundSensitiveFetch);
    try {
      await expect(new DevelopmentRunnerClient().detectSubscriptionClis()).resolves.toEqual({
        agents: [],
        modelsByAgent: {}
      });
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("tests development local AI backends through the managed dev runtime route", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("/api/ai/dev-runtime");
      expect(JSON.parse(String(init?.body))).toEqual({ operation: "test", backendId: "codex_subscription" });
      return jsonResponse({ ok: true });
    });

    await expect(
      new DevelopmentRunnerClient(fetcher as unknown as typeof fetch).testBackend("codex_subscription", {
        providerId: "local_runner"
      })
    ).resolves.toEqual({ ok: true });
  });

  it("lists development local HTTP models through the managed dev runtime route", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("/api/ai/dev-runtime");
      expect(JSON.parse(String(init?.body))).toEqual({ operation: "list_models", backendId: "ollama" });
      return jsonResponse({ ok: true, backendId: "ollama", models: ["qwen3:latest", "llama3.2"] });
    });

    await expect(new DevelopmentRunnerClient(fetcher as unknown as typeof fetch).listModels("ollama"))
      .resolves.toEqual([
        { id: "qwen3:latest", label: "qwen3:latest" },
        { id: "llama3.2", label: "llama3.2" }
      ]);
  });

  it("runs development local AI completions through the managed dev runtime route without pairing", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("/api/ai/dev-runtime");
      const body = JSON.parse(String(init?.body)) as {
        operation?: string;
        request?: Record<string, unknown>;
      };
      expect(body.operation).toBe("complete");
      expect(body.request).toMatchObject({
        backendId: "codex_subscription",
        taskType: "review_model",
        schemaId: "review-model-v1",
        model: "gpt-test",
        timeoutMs: 30000
      });
      expect(JSON.stringify(body)).not.toContain("pairingToken");
      return jsonResponse({
        ok: true,
        output: { kind: "advisory", result: { findings: [], assumptions: [], questionsForUser: [], warnings: [] } }
      });
    });

    const result = await new DevelopmentRunnerClient(fetcher as unknown as typeof fetch).complete({
      providerId: "local_runner",
      providerConfig: { backendId: "codex_subscription", model: "gpt-test", timeoutMs: 30000 },
      taskType: "review_model",
      input: { project: { id: "project-1" } }
    });

    expect(result).toMatchObject({ kind: "advisory" });
  });

  it("reports non-JSON development runtime failures without leaking parser errors", async () => {
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toBe("/api/ai/dev-runtime");
      return new Response("<!DOCTYPE html><html><body>Internal Server Error</body></html>", {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    });

    const error = await new DevelopmentRunnerClient(fetcher as unknown as typeof fetch)
      .generateTree({
        providerId: "local_runner",
        providerConfig: { backendId: "ollama", model: "qwen3", timeoutMs: 30000 },
        rootKpi: "Production Volume",
        industry: "Mining",
        businessContext: "Test",
        unit: "tonnes",
        timePeriod: "monthly",
        goal: "Test",
        levelOfDetail: "medium"
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Development runtime completion failed. HTTP 500. The server returned HTML instead of JSON."
    );
    expect((error as Error).message).not.toContain("Unexpected token");
  });

  it("gives subscription CLI tree generation the full runtime timeout budget", async () => {
    const project = { id: "project-1", rootNodeId: "root", graph: { nodes: [], edges: [] } };
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("/api/ai/dev-runtime");
      const body = JSON.parse(String(init?.body)) as {
        operation?: string;
        request?: Record<string, unknown>;
      };
      expect(body.operation).toBe("complete");
      expect(body.request).toMatchObject({
        backendId: "codex_subscription",
        taskType: "generate_tree",
        schemaId: "generate-tree-v1",
        timeoutMs: 120000
      });
      return jsonResponse({ ok: true, output: project });
    });

    await expect(
      new DevelopmentRunnerClient(fetcher as unknown as typeof fetch).generateTree({
        providerId: "local_runner",
        providerConfig: { backendId: "codex_subscription", timeoutMs: 60000 },
        rootKpi: "Production Volume",
        industry: "Mining",
        businessContext: "Test",
        unit: "tonnes",
        timePeriod: "monthly",
        goal: "Test",
        levelOfDetail: "medium"
      })
    ).resolves.toEqual(project);
  });

  it("emits deterministic progress and polls development runtime runs while generation is pending", async () => {
    const project = { id: "project-1", rootNodeId: "root", graph: { nodes: [], edges: [] } };
    const events: AiExecutionProgressEvent[] = [];
    let completionRequestId = "";
    let resolveCompletion: ((response: Response) => void) | undefined;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("/api/ai/dev-runtime");
      const body = JSON.parse(String(init?.body)) as {
        operation?: string;
        requestId?: string;
        request?: Record<string, unknown>;
      };
      if (body.operation === "complete") {
        completionRequestId = String(body.request?.requestId);
        return await new Promise<Response>((resolve) => {
          resolveCompletion = resolve;
        });
      }
      if (body.operation === "run") {
        expect(body.requestId).toBe(completionRequestId);
        return jsonResponse({
          ok: true,
          run: {
            requestId: body.requestId,
            backendId: "codex_subscription",
            taskType: "generate_tree",
            schemaId: "generate-tree-v1",
            status: "running",
            progress: {
              phase: "waiting_for_provider",
              label: "Waiting for CLI/provider",
              updatedAt: "2026-06-24T00:00:00.000Z"
            },
            agentRun: agentRunFixture({
              status: "running",
              phase: "generating_graph",
              finalReport: undefined
            })
          }
        });
      }
      throw new Error(`Unexpected operation ${body.operation}`);
    });

    const promise = new DevelopmentRunnerClient(fetcher as unknown as typeof fetch).generateTree(
      {
        providerId: "local_runner",
        providerConfig: { backendId: "codex_subscription" },
        rootKpi: "Production Volume",
        industry: "Mining",
        businessContext: "Test",
        unit: "tonnes",
        timePeriod: "monthly",
        goal: "Test",
        levelOfDetail: "medium"
      },
      {
        pollIntervalMs: 50,
        onProgress: (event) => events.push(event)
      }
    );

    await vi.waitFor(() => expect(completionRequestId).toMatch(/^[0-9a-f-]+$/));
    await vi.waitFor(() => expect(fetcher.mock.calls.some(([, init]) => String(init?.body).includes('"operation":"run"'))).toBe(true));

    resolveCompletion?.(jsonResponse({
      ok: true,
      output: project,
      run: {
        requestId: completionRequestId,
        backendId: "codex_subscription",
        taskType: "generate_tree",
        schemaId: "generate-tree-v1",
        status: "succeeded",
        schemaValid: true,
          progress: {
            phase: "complete",
            label: "Complete",
            updatedAt: "2026-06-24T00:00:01.000Z"
          },
          agentRun: agentRunFixture()
        }
      }));

    await expect(promise).resolves.toEqual(project);
    expect(events.map((event) => event.phase)).toEqual(expect.arrayContaining([
      "preparing_request",
      "starting_backend",
      "waiting_for_provider",
      "validating_schema",
      "building_project",
      "complete"
    ]));
    const waitingEvent = events.find((event) => event.phase === "waiting_for_provider" && event.agentRun);
    expect(waitingEvent?.agentRun).toMatchObject({
      runId: "agent-run-1",
      status: "running",
      selectedSkills: expect.arrayContaining([expect.objectContaining({ id: "mining.production_volume" })]),
      events: expect.arrayContaining([expect.objectContaining({ type: "classification" })])
    });
    expect(waitingEvent?.details).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "request-prepared",
        label: "Request prepared for generate_tree.",
        status: "complete"
      }),
      expect.objectContaining({
        id: "backend-started",
        label: "Codex CLI backend selected.",
        status: "complete"
      }),
      expect.objectContaining({
        id: "provider-request",
        label: "Provider request running for generate-tree-v1.",
        status: "running"
      }),
      expect.objectContaining({ id: "schema-validation", status: "pending" }),
      expect.objectContaining({ id: "canvas-build", status: "pending" })
    ]));
    expect(JSON.stringify(events)).not.toMatch(/I.m treating/);
    expect(JSON.stringify(events)).not.toMatch(/Next I.m separating/);
    expect(events.every((event) => event.requestId === completionRequestId)).toBe(true);
  });

  it("propagates agentRun from the generate-vdt API response", async () => {
    const project = { id: "project-1", rootNodeId: "root", graph: { nodes: [], edges: [] } };
    const events: AiExecutionProgressEvent[] = [];
    const fetcher = vi.fn(async () =>
      jsonResponse({
        ok: true,
        project,
        agentRun: agentRunFixture()
      })
    );

    await expect(
      createAiExecutionClient("hosted_web", fetcher as unknown as typeof fetch).generateTree(
        {
          providerId: "mock",
          rootKpi: "Production Volume",
          industry: "Mining",
          businessContext: "Test",
          unit: "tonnes",
          timePeriod: "monthly",
          goal: "Test",
          levelOfDetail: "medium"
        },
        { onProgress: (event) => events.push(event) }
      )
    ).resolves.toEqual(project);

    expect(events.find((event) => event.phase === "complete")?.agentRun).toMatchObject({
      runId: "agent-run-1",
      finalReport: "Validation result: Graph validation passed.",
      selectedSkills: expect.arrayContaining([expect.objectContaining({ id: "mining.production_volume" })])
    });
  });

  it("fails closed for desktop local AI until IPC is implemented", async () => {
    const fetcher = vi.fn();
    const client = createAiExecutionClient("desktop", fetcher as unknown as typeof fetch);

    await expect(
      client.generateTree({
        providerId: "local_runner",
        rootKpi: "Production Volume",
        industry: "Mining",
        businessContext: "Test",
        unit: "tonnes",
        timePeriod: "monthly",
        goal: "Test",
        levelOfDetail: "medium"
      })
    ).rejects.toThrow(DESKTOP_LOCAL_AI_PLACEHOLDER_MESSAGE);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("lists desktop backends through the Tauri command bridge", async () => {
    const fetcher = vi.fn();
    const invoke = vi.fn(async (command: string) => {
      expect(command).toBe("ai_list_backends");
      return [
        { backendId: "mock", label: "Safe Mock", mode: "local_http", status: "available" },
        { backendId: "cursor_subscription", label: "Cursor Agent", mode: "subscription_cli", status: "unavailable", message: "Sign in required." }
      ];
    });

    const backends = await new DesktopAiExecutionClient(fetcher as unknown as typeof fetch, invoke).listBackends();

    expect(fetcher).not.toHaveBeenCalled();
    expect(backends).toEqual(expect.arrayContaining([
      expect.objectContaining({ backendId: "openai_compatible", mode: "api" }),
      expect.objectContaining({ backendId: "mock", status: "available" }),
      expect.objectContaining({ backendId: "cursor_subscription", message: "Sign in required." })
    ]));
  });

  it("routes desktop local backend commands through Tauri invoke", async () => {
    const fetcher = vi.fn();
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "ai_test_backend") {
        expect(args).toEqual({ backendId: "ollama" });
        return { ok: true };
      }
      if (command === "ai_list_models") {
        expect(args).toEqual({ backendId: "ollama" });
        return ["qwen3"];
      }
      if (command === "ai_cancel") {
        expect(args).toEqual({ requestId: "run-1" });
        return undefined;
      }
      throw new Error(`Unexpected command ${command}`);
    });
    const client = new DesktopAiExecutionClient(fetcher as unknown as typeof fetch, invoke);

    await expect(client.testBackend("ollama", { providerId: "local_runner" })).resolves.toEqual({ ok: true });
    await expect(client.listModels("ollama")).resolves.toEqual([{ id: "qwen3", label: "qwen3" }]);
    await expect(client.cancel("run-1")).resolves.toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("routes desktop provider authentication through the reviewed Tauri command", async () => {
    const fetcher = vi.fn();
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      expect(command).toBe("open_provider_auth");
      expect(args).toEqual({ backendId: "codex_subscription" });
      return {
        ok: true,
        backendId: "codex_subscription",
        action: "instructions",
        docsUrl: "https://developers.openai.com/codex/cli"
      };
    });

    await expect(new DesktopAiExecutionClient(fetcher as unknown as typeof fetch, invoke).openProviderAuth("codex_subscription"))
      .resolves.toMatchObject({ action: "instructions", docsUrl: "https://developers.openai.com/codex/cli" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("detects desktop subscription CLIs through the Tauri command bridge", async () => {
    const fetcher = vi.fn();
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      expect(command).toBe("ai_detect_subscription_clis");
      expect(args).toEqual({ agentId: "codex" });
      return {
        ok: true,
        agents: [
          {
            id: "codex",
            installed: true,
            executable: "/opt/homebrew/bin/codex",
            alias: "codex",
            version: "codex-cli 0.128.0",
            status: "ready",
            authSummary: "ChatGPT subscription is authenticated and ready."
          }
        ],
        modelsByAgent: { codex: ["gpt-5.5"] }
      };
    });

    await expect(new DesktopAiExecutionClient(fetcher as unknown as typeof fetch, invoke).detectSubscriptionClis("codex"))
      .resolves.toMatchObject({
        agents: [expect.objectContaining({ id: "codex", installed: true, status: "ready" })],
        modelsByAgent: { codex: ["gpt-5.5"] }
      });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends desktop local AI completion through ai_complete without using web routes", async () => {
    const fetcher = vi.fn();
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      expect(command).toBe("ai_complete");
      expect(args?.request).toMatchObject({
        providerId: "local_runner",
        backendId: "ollama",
        taskType: "review_model",
        schemaId: "review-model-v1",
        model: "qwen3",
        timeoutMs: 30000
      });
      return { kind: "advisory", result: { findings: [], assumptions: [], questionsForUser: [], warnings: [] } };
    });

    const result = await new DesktopAiExecutionClient(fetcher as unknown as typeof fetch, invoke).complete({
      providerId: "local_runner",
      providerConfig: { backendId: "ollama", model: "qwen3", timeoutMs: 30000 },
      taskType: "review_model",
      input: { project: { id: "project-1" } }
    });

    expect(result).toMatchObject({ kind: "advisory" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("propagates desktop generateTree agentRun through progress events", async () => {
    const fetcher = vi.fn();
    const project = { id: "desktop-project-1", rootNodeId: "root", graph: { nodes: [], edges: [] } };
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      expect(command).toBe("ai_complete");
      expect(args?.request).toMatchObject({
        providerId: "local_runner",
        backendId: "codex_subscription",
        taskType: "generate_tree",
        schemaId: "generate-tree-v1",
        timeoutMs: 120000
      });
      return {
        project,
        agentRun: agentRunFixture({
          selectedSkills: [
            {
              id: "mining.production_volume",
              path: "packages/vdt-agent/skills/mining/production-volume.md",
              reason: "Matched mining throughput."
            }
          ],
          finalReport: "Validation result: Graph validation passed."
        })
      };
    });
    const events: AiExecutionProgressEvent[] = [];

    await expect(new DesktopAiExecutionClient(fetcher as unknown as typeof fetch, invoke).generateTree(
      {
        providerId: "local_runner",
        providerConfig: { backendId: "codex_subscription" },
        rootKpi: "Production Volume",
        industry: "Mining",
        businessContext: "Test",
        unit: "tonnes",
        timePeriod: "monthly",
        goal: "Test",
        levelOfDetail: "medium"
      },
      { onProgress: (event) => events.push(event) }
    )).resolves.toEqual(project);

    const completeEvent = events.find((event) => event.phase === "complete");
    expect(completeEvent?.agentRun).toMatchObject({
      runId: "agent-run-1",
      finalReport: "Validation result: Graph validation passed.",
      selectedSkills: expect.arrayContaining([expect.objectContaining({ id: "mining.production_volume" })])
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps desktop BYOK generation on the hosted API route", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ ok: true, project: { id: "project-1" } }));
    const invoke = vi.fn();

    const project = await new DesktopAiExecutionClient(fetcher as unknown as typeof fetch, invoke).generateTree({
      providerId: "openai_compatible",
      providerConfig: { model: "gpt-test" },
      rootKpi: "Production Volume",
      industry: "Mining",
      businessContext: "Test",
      unit: "tonnes",
      timePeriod: "monthly",
      goal: "Test",
      levelOfDetail: "medium"
    });

    expect(project).toEqual({ id: "project-1" });
    expect(invoke).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledWith(
      "/api/ai/generate-vdt",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("keeps BYOK generation on the hosted API route", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ ok: true, project: { id: "project-1" } }));
    const project = await createAiExecutionClient("hosted_web", fetcher as unknown as typeof fetch).generateTree({
      providerId: "openai_compatible",
      providerConfig: { model: "gpt-test" },
      rootKpi: "Production Volume",
      industry: "Mining",
      businessContext: "Test",
      unit: "tonnes",
      timePeriod: "monthly",
      goal: "Test",
      levelOfDetail: "medium"
    });

    expect(project).toEqual({ id: "project-1" });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/ai/generate-vdt",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"providerId":"openai_compatible"')
      })
    );
  });

  it("emits non-streaming fallback progress for hosted BYOK generation", async () => {
    const events: AiExecutionProgressEvent[] = [];
    const fetcher = vi.fn(async () => jsonResponse({ ok: true, project: { id: "project-1", rootNodeId: "root", graph: { nodes: [], edges: [] } } }));

    await expect(createAiExecutionClient("hosted_web", fetcher as unknown as typeof fetch).generateTree(
      {
        providerId: "openai_compatible",
        rootKpi: "Production Volume",
        industry: "Mining",
        businessContext: "Test",
        unit: "tonnes",
        timePeriod: "monthly",
        goal: "Test",
        levelOfDetail: "medium"
      },
      { onProgress: (event) => events.push(event) }
    )).resolves.toMatchObject({ id: "project-1" });

    expect(events.map((event) => event.phase)).toEqual([
      "preparing_request",
      "waiting_for_provider",
      "building_project",
      "complete"
    ]);
    expect(new Set(events.map((event) => event.requestId)).size).toBe(1);
  });

  it("propagates hosted run-task agentRun through complete progress", async () => {
    const events: AiExecutionProgressEvent[] = [];
    const fetcher = vi.fn(async () =>
      jsonResponse({
        ok: true,
        result: {
          kind: "change_set",
          changeSet: {
            id: "changeset_deepen_unplanned_downtime",
            taskType: "deepen_node",
            backendId: "openai_compatible",
            createdAt: "2026-06-24T00:00:00.000Z",
            additions: [],
            updates: [],
            deletions: [],
            edgeChanges: [],
            assumptions: [],
            questions: [],
            warnings: []
          },
          agentRun: agentRunFixture()
        }
      })
    );

    const result = await createAiExecutionClient("hosted_web", fetcher as unknown as typeof fetch).complete(
      {
        providerId: "openai_compatible",
        taskType: "deepen_node",
        input: { project: productionVolumeProject, nodeId: "unplanned_downtime" }
      },
      { onProgress: (event) => events.push(event) }
    );

    expect(result).toMatchObject({ kind: "change_set" });
    expect(events.find((event) => event.phase === "complete")?.agentRun).toMatchObject({
      runId: "agent-run-1",
      selectedSkills: expect.arrayContaining([expect.objectContaining({ id: "mining.production_volume" })])
    });
  });

  it("maps development runtime raw deepen output to a change set and keeps agentRun progress", async () => {
    const events: AiExecutionProgressEvent[] = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("/api/ai/dev-runtime");
      const body = JSON.parse(String(init?.body)) as {
        operation?: string;
        request?: { requestId?: string; backendId?: string; taskType?: string; schemaId?: string };
      };
      expect(body.operation).toBe("complete");
      expect(body.request).toMatchObject({
        backendId: "codex_subscription",
        taskType: "deepen_node",
        schemaId: "deepen-node-v1"
      });
      return jsonResponse({
        ok: true,
        output: deepenNodeOutputFixture(),
        run: {
          requestId: body.request?.requestId,
          backendId: "codex_subscription",
          taskType: "deepen_node",
          schemaId: "deepen-node-v1",
          status: "succeeded",
          schemaValid: true,
          progress: {
            phase: "complete",
            label: "Complete",
            updatedAt: "2026-06-24T00:00:01.000Z"
          },
          agentRun: agentRunFixture()
        }
      });
    });

    const result = await new DevelopmentRunnerClient(fetcher as unknown as typeof fetch).complete(
      {
        providerId: "local_runner",
        providerConfig: { backendId: "codex_subscription" },
        taskType: "deepen_node",
        input: { project: productionVolumeProject, nodeId: "unplanned_downtime" }
      },
      { onProgress: (event) => events.push(event) }
    );

    expect(result).toMatchObject({
      kind: "change_set",
      changeSet: {
        taskType: "deepen_node",
        additions: [expect.objectContaining({ nodeId: "equipment_failure_downtime_test" })]
      }
    });
    expect(events.find((event) => event.phase === "complete" && event.agentRun)?.agentRun).toMatchObject({
      runId: "agent-run-1"
    });
  });

  it("does not emit complete for invalid development runtime raw deepen output", async () => {
    const events: AiExecutionProgressEvent[] = [];
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { request?: { requestId?: string } };
      return jsonResponse({
        ok: true,
        output: { targetNodeId: "unplanned_downtime", nodes: [], edges: [], assumptions: [], questionsForUser: [], warnings: [] },
        run: {
          requestId: body.request?.requestId,
          backendId: "codex_subscription",
          taskType: "deepen_node",
          schemaId: "deepen-node-v1",
          status: "succeeded",
          schemaValid: true,
          progress: {
            phase: "complete",
            label: "Complete",
            updatedAt: "2026-06-24T00:00:01.000Z"
          },
          agentRun: agentRunFixture()
        }
      });
    });

    await expect(new DevelopmentRunnerClient(fetcher as unknown as typeof fetch).complete(
      {
        providerId: "local_runner",
        providerConfig: { backendId: "codex_subscription" },
        taskType: "deepen_node",
        input: { project: productionVolumeProject, nodeId: "unplanned_downtime" }
      },
      { onProgress: (event) => events.push(event) }
    )).rejects.toThrow();

    expect(events.map((event) => event.phase)).not.toContain("complete");
  });

  it("maps desktop raw deepen output to a change set and keeps agentRun progress", async () => {
    const events: AiExecutionProgressEvent[] = [];
    const fetcher = vi.fn();
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      expect(command).toBe("ai_complete");
      expect(args?.request).toMatchObject({
        backendId: "codex_subscription",
        taskType: "deepen_node",
        schemaId: "deepen-node-v1"
      });
      return {
        ok: true,
        output: deepenNodeOutputFixture(),
        run: {
          agentRun: agentRunFixture()
        }
      };
    });

    const result = await new DesktopAiExecutionClient(fetcher as unknown as typeof fetch, invoke).complete(
      {
        providerId: "local_runner",
        providerConfig: { backendId: "codex_subscription" },
        taskType: "deepen_node",
        input: { project: productionVolumeProject, nodeId: "unplanned_downtime" }
      },
      { onProgress: (event) => events.push(event) }
    );

    expect(result).toMatchObject({
      kind: "change_set",
      changeSet: {
        taskType: "deepen_node",
        additions: [expect.objectContaining({ nodeId: "equipment_failure_downtime_test" })]
      }
    });
    expect(events.find((event) => event.phase === "complete")?.agentRun).toMatchObject({
      runId: "agent-run-1"
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
