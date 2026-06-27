import { describe, expect, it } from "vitest";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { productionVolumeProject } from "@vdt-studio/vdt-core";
import type { AuditEvent } from "../cli/types";
import {
  createLocalRuntimeContext,
  completeRuntime,
  cancelRuntimeRequest,
  detectRuntimeSubscriptionClis,
  getRuntimeRun,
  listRuntimeBackends,
  listRuntimeModels,
  openRuntimeProviderAuth,
  parseCompletionPayload
} from "./runtime";

const fakeCodex = fileURLToPath(new URL("./fixtures/fake-codex.cjs", import.meta.url));
const fakeCursor = fileURLToPath(new URL("./fixtures/fake-cursor.cjs", import.meta.url));

describe("local runtime contract", () => {
  it("lists public manifests without executable details", () => {
    const context = createLocalRuntimeContext({ auditSink: () => undefined });
    const result = listRuntimeBackends(context);
    expect(result.statusCode).toBe(200);
    expect(result.payload).toMatchObject({ ok: true });
    expect(JSON.stringify(result.payload)).toContain("\"id\":\"mock\"");
    expect(result.payload).toMatchObject({
      backends: expect.arrayContaining([
        expect.objectContaining({ id: "mock", backendId: "mock", mode: "local_http", status: "available" }),
        expect.objectContaining({ id: "codex_subscription", backendId: "codex_subscription", mode: "subscription_cli" })
      ])
    });
    expect(JSON.stringify(result.payload)).not.toContain("executableAliases");
  });

  it("returns provider-owned authentication instructions for subscription backends", () => {
    const context = createLocalRuntimeContext({ auditSink: () => undefined });
    const result = openRuntimeProviderAuth("codex_subscription", context);

    expect(result.statusCode).toBe(200);
    expect(result.payload).toMatchObject({
      ok: true,
      backendId: "codex_subscription",
      action: "instructions",
      label: "Codex CLI authentication",
      docsUrl: "https://developers.openai.com/codex/cli"
    });
    expect(JSON.stringify(result.payload)).not.toContain("command");
  });

  it("detects installed subscription CLIs and provider-owned models", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "vdt-detect-clis-"));
    try {
      await symlink(fakeCodex, path.join(tempDir, "codex"));
      await symlink(fakeCursor, path.join(tempDir, "agent"));
      const context = createLocalRuntimeContext({
        auditSink: () => undefined,
        detection: { path: tempDir, probeTimeoutMs: 5_000 }
      });

      await expect(detectRuntimeSubscriptionClis(context)).resolves.toMatchObject({
        statusCode: 200,
        payload: {
          ok: true,
          agents: expect.arrayContaining([
            expect.objectContaining({
              id: "codex",
              installed: true,
              alias: "codex",
              version: "codex-cli 0.128.0",
              status: "ready",
              authSummary: "ChatGPT subscription is authenticated and ready."
            }),
            expect.objectContaining({
              id: "cursor-agent",
              installed: true,
              alias: "agent",
              version: "2026.06.19-test",
              status: "ready",
              authSummary: "Cursor account is authenticated and ready."
            })
          ]),
          modelsByAgent: {
            codex: ["gpt-5.5", "gpt-5.2"],
            "cursor-agent": ["auto", "gpt-5.5-high"]
          }
        }
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("lists subscription CLI models through provider adapters", async () => {
    const context = createLocalRuntimeContext({
      auditSink: () => undefined,
      executor: {
        resolveExecutable: async (manifest) => manifest.id === "cursor_subscription" ? fakeCursor : fakeCodex
      }
    });

    await expect(listRuntimeModels("codex_subscription", context)).resolves.toMatchObject({
      statusCode: 200,
      payload: { ok: true, backendId: "codex_subscription", models: ["gpt-5.5", "gpt-5.2"] }
    });
    await expect(listRuntimeModels("cursor_subscription", context)).resolves.toMatchObject({
      statusCode: 200,
      payload: { ok: true, backendId: "cursor_subscription", models: ["auto", "gpt-5.5-high"] }
    });
  });

  it("lists OpenAI-compatible local HTTP models", async () => {
    const context = createLocalRuntimeContext({
      auditSink: () => undefined,
      executor: {
        fetch: async (url) => {
          expect(String(url)).toBe("http://127.0.0.1:1234/v1/models");
          return new Response(JSON.stringify({
            data: [
              { id: "qwen2.5-coder:7b" },
              { id: "llama3.2:latest" }
            ]
          }), { status: 200, headers: { "content-type": "application/json" } });
        }
      }
    });

    await expect(listRuntimeModels("lm_studio", context)).resolves.toMatchObject({
      statusCode: 200,
      payload: { ok: true, backendId: "lm_studio", models: ["qwen2.5-coder:7b", "llama3.2:latest"] }
    });
  });

  it("falls back to the native Ollama tags endpoint when /v1/models is unavailable", async () => {
    const requestedUrls: string[] = [];
    const context = createLocalRuntimeContext({
      auditSink: () => undefined,
      executor: {
        fetch: async (url) => {
          requestedUrls.push(String(url));
          if (String(url).endsWith("/v1/models")) {
            return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
          }
          return new Response(JSON.stringify({
            models: [
              { name: "qwen3:latest" },
              { model: "deepseek-r1:8b" }
            ]
          }), { status: 200, headers: { "content-type": "application/json" } });
        }
      }
    });

    await expect(listRuntimeModels("ollama", context)).resolves.toMatchObject({
      statusCode: 200,
      payload: { ok: true, backendId: "ollama", models: ["qwen3:latest", "deepseek-r1:8b"] }
    });
    expect(requestedUrls).toEqual([
      "http://127.0.0.1:11434/v1/models",
      "http://127.0.0.1:11434/api/tags"
    ]);
  });

  it("canonicalizes symlinked provider executables before adapter execution", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "vdt-symlink-provider-"));
    try {
      const codexLink = path.join(tempDir, "codex");
      await symlink(fakeCodex, codexLink);
      const context = createLocalRuntimeContext({
        auditSink: () => undefined,
        executor: { resolveExecutable: async () => codexLink }
      });

      await expect(listRuntimeModels("codex_subscription", context)).resolves.toMatchObject({
        statusCode: 200,
        payload: { ok: true, backendId: "codex_subscription", models: ["gpt-5.5", "gpt-5.2"] }
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects provider authentication actions for local model backends", () => {
    const context = createLocalRuntimeContext({ auditSink: () => undefined });

    expect(() => openRuntimeProviderAuth("ollama", context)).toThrow("Provider authentication is only available");
  });

  it("runs mock completion outside the HTTP transport and records the run", async () => {
    const context = createLocalRuntimeContext({ auditSink: () => undefined });
    const request = parseCompletionPayload({
      requestId: crypto.randomUUID(),
      backendId: "mock",
      taskType: "generate_tree",
      schemaId: "generate-tree-v1",
      input: {
        projectTitle: "Tree",
        rootNodeId: "root",
        nodes: [{ id: "root", name: "Root", type: "root_kpi" }],
        edges: [],
        assumptions: [],
        questionsForUser: [],
        warnings: []
      }
    });

    const result = await completeRuntime(request, context);
    expect(result.statusCode).toBe(200);
    expect(result.payload).toMatchObject({
      ok: true,
      run: {
        requestId: request.requestId,
        status: "succeeded",
        progress: { phase: "complete", label: "Complete" }
      }
    });

    const stored = getRuntimeRun(request.requestId, context);
    expect(stored.payload).toMatchObject({
      ok: true,
      run: {
        requestId: request.requestId,
        status: "succeeded",
        progress: { phase: "complete", label: "Complete" }
      }
    });
  });

  it("runs agent_decision through the mock backend contract", async () => {
    const context = createLocalRuntimeContext({ auditSink: () => undefined });
    const request = parseCompletionPayload({
      requestId: crypto.randomUUID(),
      backendId: "mock",
      taskType: "agent_decision",
      schemaId: "agent-decision-v1",
      input: {
        data: {
          run: { status: "running", phase: "planning" },
          brief: { rootKpi: "Ore haulage", unit: "tonnes/year", timePeriod: "year" },
          tools: []
        },
        systemPrompt: "Return one agent decision.",
        userPrompt: "Build a VDT for ore haulage."
      }
    });

    const result = await completeRuntime(request, context);

    expect(result.statusCode).toBe(200);
    expect(result.payload).toMatchObject({
      ok: true,
      output: {
        type: "call_tool",
        toolName: "skill.search"
      },
      run: {
        taskType: "agent_decision",
        schemaId: "agent-decision-v1",
        status: "succeeded"
      }
    });
  });

  it("reports the exact missing task/schema when a stale manifest rejects agent_decision", async () => {
    const context = createLocalRuntimeContext({ auditSink: () => undefined });
    const mockManifest = context.manifests.get("mock");
    if (!mockManifest) throw new Error("Expected mock manifest.");
    (context.manifests as Map<string, typeof mockManifest>).set("mock", Object.freeze({
      ...mockManifest,
      taskTypes: mockManifest.taskTypes.filter((taskType) => taskType !== "agent_decision"),
      schemaIds: mockManifest.schemaIds.filter((schemaId) => schemaId !== "agent-decision-v1")
    }));
    const request = parseCompletionPayload({
      requestId: crypto.randomUUID(),
      backendId: "mock",
      taskType: "agent_decision",
      schemaId: "agent-decision-v1",
      input: {}
    });

    await expect(completeRuntime(request, context)).rejects.toThrow(
      "Backend mock does not advertise agent_decision/agent-decision-v1"
    );
  });

  it("attaches agent events to generate_tree run snapshots", async () => {
    const context = createLocalRuntimeContext({ auditSink: () => undefined });
    const request = parseCompletionPayload({
      requestId: crypto.randomUUID(),
      backendId: "mock",
      taskType: "generate_tree",
      schemaId: "generate-tree-v1",
      input: {
        rootKpi: "Production Volume",
        industry: "Mining / Processing Plant",
        businessContext: "Ore throughput and plant production volume",
        unit: "tonnes/month"
      }
    });

    const result = await completeRuntime(request, context);

    expect(result.statusCode).toBe(200);
    expect(result.payload).toMatchObject({
      ok: true,
      run: {
        status: "succeeded",
        agentRun: {
          status: "succeeded",
          selectedSkills: expect.arrayContaining([expect.objectContaining({ id: "mining.production_volume" })]),
          events: expect.arrayContaining([
            expect.objectContaining({ type: "classification" }),
            expect.objectContaining({ type: "skill_selected" }),
            expect.objectContaining({ type: "model_call_started" }),
            expect.objectContaining({ type: "graph_validation" }),
            expect.objectContaining({ type: "final_report" })
          ])
        }
      }
    });

    const stored = getRuntimeRun(request.requestId, context);
    expect(stored.payload).toMatchObject({
      ok: true,
      run: {
        agentRun: {
          finalReport: expect.stringContaining("Validation result: Graph validation passed")
        }
      }
    });
  });

  it("records real graph validation failures for schema-valid generate_tree output", async () => {
    const invalidGraphOutput = {
      projectTitle: "Invalid graph",
      rootNodeId: "root",
      nodes: [{
        id: "root",
        name: "Root KPI",
        description: "Schema-valid root.",
        type: "root_kpi",
        unit: "units",
        formula: "missing_child",
        aiConfidence: 0.9,
        aiRationale: "Fixture root.",
        controllability: "medium",
        materiality: "high"
      }],
      edges: [],
      assumptions: [],
      questionsForUser: [],
      warnings: []
    };
    const context = createLocalRuntimeContext({
      auditSink: () => undefined,
      executor: {
        fetch: async () =>
          new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(invalidGraphOutput) } }] }), {
            status: 200,
            headers: { "content-type": "application/json" }
          })
      }
    });
    const request = parseCompletionPayload({
      requestId: crypto.randomUUID(),
      backendId: "ollama",
      taskType: "generate_tree",
      schemaId: "generate-tree-v1",
      input: {
        rootKpi: "Production Volume",
        industry: "Mining",
        businessContext: "Production volume throughput"
      }
    });

    const result = await completeRuntime(request, context);

    expect(result.statusCode).toBe(200);
    expect(result.payload).toMatchObject({
      ok: true,
      run: {
        status: "succeeded",
        agentRun: {
          status: "succeeded",
          events: expect.arrayContaining([
            expect.objectContaining({
              type: "graph_validation",
              message: expect.stringContaining("Graph validation failed")
            })
          ]),
          finalReport: expect.stringContaining("Validation result: Graph validation failed")
        }
      }
    });
  });

  it("attaches classification and skill events to deepen_node run snapshots without changing output", async () => {
    const context = createLocalRuntimeContext({ auditSink: () => undefined });
    const request = parseCompletionPayload({
      requestId: crypto.randomUUID(),
      backendId: "mock",
      taskType: "deepen_node",
      schemaId: "deepen-node-v1",
      input: {
        projectTitle: "Production Volume Driver Model",
        industry: "Mining",
        businessContext: "Open pit truck haulage production volume",
        targetNodeId: "ore_hauled",
        excerpt: {
          rootNodeId: "production_volume",
          targetNodeId: "ore_hauled",
          nodes: [{ id: "ore_hauled", name: "Ore Hauled", type: "calculated", unit: "tonnes/month" }],
          edges: []
        }
      }
    });

    const result = await completeRuntime(request, context);

    expect(result.statusCode).toBe(200);
    expect(result.payload).toMatchObject({
      ok: true,
      output: { targetNodeId: "node-1" },
      run: {
        agentRun: {
          status: "succeeded",
          events: expect.arrayContaining([
            expect.objectContaining({ type: "classification" }),
            expect.objectContaining({ type: "skill_selected" }),
            expect.objectContaining({ type: "model_call_started" }),
            expect.objectContaining({ type: "graph_patch" }),
            expect.objectContaining({ type: "model_call_completed" })
          ])
        }
      }
    });
    const events = (result.payload as { run?: { agentRun?: { events?: Array<{ type?: string }> } } }).run?.agentRun?.events ?? [];
    expect(events.map((event) => event.type)).not.toContain("graph_validation");
  });

  it("attaches agent events to deepen_node runs from the UI project/nodeId input shape", async () => {
    const context = createLocalRuntimeContext({ auditSink: () => undefined });
    const request = parseCompletionPayload({
      requestId: crypto.randomUUID(),
      backendId: "mock",
      taskType: "deepen_node",
      schemaId: "deepen-node-v1",
      input: {
        project: productionVolumeProject,
        nodeId: "unplanned_downtime"
      }
    });

    const result = await completeRuntime(request, context);

    expect(result.statusCode).toBe(200);
    expect(result.payload).toMatchObject({
      ok: true,
      output: { targetNodeId: "node-1" },
      run: {
        agentRun: {
          status: "succeeded",
          request: {
            rootKpi: "Unplanned Downtime",
            industry: "Mining / Processing Plant"
          },
          selectedSkills: expect.arrayContaining([expect.objectContaining({ id: expect.any(String) })]),
          events: expect.arrayContaining([
            expect.objectContaining({ type: "classification" }),
            expect.objectContaining({ type: "skill_selected" }),
            expect.objectContaining({ type: "model_call_started" }),
            expect.objectContaining({ type: "graph_patch" }),
            expect.objectContaining({ type: "final_report" })
          ]),
          finalReport: expect.stringContaining("Generated a candidate deepen patch")
        }
      }
    });
  });

  it("marks nested agent runs as cancelled when runtime completion is cancelled", async () => {
    let abortHandler: (() => void) | undefined;
    let fetchStarted: (() => void) | undefined;
    const fetchStartedPromise = new Promise<void>((resolve) => {
      fetchStarted = resolve;
    });
    const context = createLocalRuntimeContext({
      auditSink: () => undefined,
      executor: {
        fetch: async (_url, init) => {
          fetchStarted?.();
          await new Promise((_resolve, reject) => {
            abortHandler = () => reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
            init?.signal?.addEventListener("abort", abortHandler, { once: true });
          });
          throw new Error("Expected abort before local HTTP response.");
        }
      }
    });
    const request = parseCompletionPayload({
      requestId: crypto.randomUUID(),
      backendId: "ollama",
      taskType: "generate_tree",
      schemaId: "generate-tree-v1",
      input: {
        rootKpi: "Production Volume",
        industry: "Mining",
        businessContext: "Production volume throughput"
      },
      timeoutMs: 10_000
    });

    const response = completeRuntime(request, context);
    await fetchStartedPromise;
    expect(cancelRuntimeRequest(request.requestId, context)).toMatchObject({
      statusCode: 202,
      payload: { ok: true, requestId: request.requestId, status: "cancelling" }
    });
    expect(abortHandler).toBeDefined();

    await expect(response).resolves.toMatchObject({
      statusCode: 409,
      payload: {
        ok: false,
        run: {
          status: "cancelled",
          agentRun: {
            status: "cancelled",
            events: expect.arrayContaining([
              expect.objectContaining({ type: "error", title: "Provider execution cancelled" })
            ])
          }
        },
        error: { code: "CANCELLED" }
      }
    });
  });

  it("records failed repair attempts in audit metadata and run snapshots", async () => {
    const audit: AuditEvent[] = [];
    let calls = 0;
    const context = createLocalRuntimeContext({
      auditSink: (event) => audit.push(event),
      executor: {
        fetch: async () => {
          calls += 1;
          return new Response(
            JSON.stringify({ choices: [{ message: { content: JSON.stringify({ invalid: true }) } }] }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
      }
    });
    const request = parseCompletionPayload({
      requestId: crypto.randomUUID(),
      backendId: "ollama",
      taskType: "generate_tree",
      schemaId: "generate-tree-v1",
      input: { prompt: "Build a tree" }
    });

    const result = await completeRuntime(request, context);

    expect(calls).toBe(2);
    expect(result.statusCode).toBe(502);
    expect(result.payload).toMatchObject({
      ok: false,
      run: { status: "failed", repairAttempted: true, repairSucceeded: false },
      error: { code: "SCHEMA_INVALID" }
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      errorCode: "SCHEMA_INVALID",
      repairAttempted: true,
      repairSucceeded: false,
      schemaValid: false
    });
  });

  it("rejects browser-selected executable fields before execution", () => {
    expect(() => parseCompletionPayload({
      requestId: crypto.randomUUID(),
      backendId: "mock",
      taskType: "generate_tree",
      schemaId: "generate-tree-v1",
      input: {},
      args: ["--unsafe"]
    })).toThrow("Completion body must not include args.");
  });
});
