import { describe, expect, it, vi } from "vitest";
import {
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
});
