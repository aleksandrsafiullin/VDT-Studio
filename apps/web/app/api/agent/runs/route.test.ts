import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalRuntimeContext, AGENT_DECISION_TIMEOUT_FLOOR_MS } from "@vdt-studio/local-runner/server-runtime";
import type { AgentCapabilityProfile } from "@vdt-studio/vdt-agent-runtime";
import { VdtBuilderSession } from "@vdt-studio/vdt-core";
import { VdtStorageError } from "@vdt-studio/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getExecutionBindings, POST as startRun } from "./route";
import { GET as getRun } from "./[runId]/route";
import { GET as getEvents } from "./[runId]/events/route";
import { POST as postMessage } from "./[runId]/messages/route";
import { POST as cancelRun } from "./[runId]/cancel/route";
import { agentExecutionBindingRegistry, agentRuntime } from "./runtime";
import { DEFAULT_MODEL_AGENT_EXECUTION_BINDING_ID } from "./execution-bindings";
import {
  buildModelProviderTurnPayload,
  currentModelAgentToolCatalogHash,
  deriveModelAgentSessionBindingId,
  isStructuredModelAgentRunActive,
  resetActiveSupervisorRunsForTests
} from "./supervisor-runtime";

const fakeCodex = fileURLToPath(new URL("../../../../../../packages/local-runner/src/server/fixtures/fake-codex.cjs", import.meta.url));
const runtimeGlobal = globalThis as typeof globalThis & {
  __vdtAgentRuntime?: unknown;
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

function openAiStructuredResponse(output: unknown): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(output) } }]
  }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

async function readJson(response: Response) {
  return await response.json() as {
    schemaVersion?: string;
    ok: boolean;
    runId?: string;
    status?: string;
    snapshot?: {
      runId: string;
      status: string;
      request?: {
        executionBindingId?: string;
        providerConfig?: Record<string, unknown>;
        workspace?: { vdtId?: string };
      };
      executionSummary?: {
        executionProfile: string;
        engineAdapterId: string;
        backendId: string;
        modelId: string;
        protocolVersion: string;
        cliVersion: string | null;
        toolIsolation: string;
        qualificationStatus: string;
        capabilityEvidenceHash: string | null;
        capabilityProfileHash: string;
        toolCatalogHash: string;
        sessionStatus?: string;
        recoveryStatus?: string;
        sessionEpoch?: number;
      };
      visibleContext?: { brief?: { businessContext?: string } };
      pendingQuestions?: Array<{ id: string }>;
      selectedSkills: Array<{ id: string }>;
      draftProject?: { rootNodeId: string; graph: { nodes: Array<{ id: string; baselineValue?: number }> } };
      events: Array<{ type: string; seq: number }>;
    };
    error?: { code?: string; message?: string; retryable?: boolean };
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
  const state = agentRuntime.store.getState(runId);
  throw new Error(`Timed out waiting for agent run "${runId}": ${JSON.stringify({
    status: state.status,
    error: state.error,
    pendingQuestions: state.pendingQuestions?.map((question) => question.id),
    lastToolResult: state.lastToolResult,
    durableTail: state.supervisorPersistenceV2?.eventOutbox?.slice(-4)
  })}`);
}

async function waitForManagedRuntimeRun() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((runtimeGlobal.__vdtStudioDevelopmentRuntime?.runs.size ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for managed runtime request.");
}

async function waitForManagedRuntimeCancelled() {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if ([...(runtimeGlobal.__vdtStudioDevelopmentRuntime?.runs.values() ?? [])].some((run) => run.status === "cancelled")) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for managed runtime cancellation.");
}

async function waitForProviderCalls(providerFetch: { mock: { calls: unknown[][] } }, count: number) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (providerFetch.mock.calls.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${count} provider call${count === 1 ? "" : "s"}.`);
}

async function waitForSupervisorReleased(runId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!isStructuredModelAgentRunActive(runId)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for Supervisor lifecycle cleanup for ${runId}.`);
}

beforeEach(() => {
  vi.stubEnv("VDT_APP_MODE", "development_web");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetActiveSupervisorRunsForTests();
  delete runtimeGlobal.__vdtStudioDevelopmentRuntime;
});

describe("agent runs API", () => {
  it("publishes only read-only binding summaries and selects the server default by opaque ID", async () => {
    const response = getExecutionBindings();
    const body = await response.json() as {
      schemaVersion: number;
      ok: boolean;
      defaultBindingId: string | null;
      bindings: Array<Record<string, unknown>>;
    };

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      schemaVersion: 1,
      ok: true,
      defaultBindingId: DEFAULT_MODEL_AGENT_EXECUTION_BINDING_ID,
      bindings: [expect.objectContaining({
        bindingId: DEFAULT_MODEL_AGENT_EXECUTION_BINDING_ID,
        executionProfile: "model_agent",
        engineAdapterId: "http-structured-replay-canary-v1",
        backendId: "mock",
        modelId: "deterministic-test-model"
      })]
    });
    expect(JSON.stringify(body)).not.toMatch(/apiKey|executable|providerConfig|securityConfig/);
  });

  it("serializes the initial delta once and keeps later continuation prompts bounded", () => {
    const marker = `large-context-${"x".repeat(32_000)}`;
    const contextHash = `sha256:${"a".repeat(64)}`;
    const payload = buildModelProviderTurnPayload({
      exchangeId: "exchange-1",
      stableCallKey: "turn-1",
      previousCursor: null,
      delta: {
        type: "initial_context",
        context: { marker, project: { nodes: [{ id: "root" }] } },
        contextHash
      }
    });

    expect(payload.input).toEqual({
      exchangeId: "exchange-1",
      stableCallKey: "turn-1",
      previousCursor: null,
      deltaType: "initial_context"
    });
    expect(payload.input).not.toHaveProperty("delta");
    expect(payload.userPrompt.split(marker)).toHaveLength(2);

    const secondPayload = buildModelProviderTurnPayload({
      exchangeId: "exchange-2",
      stableCallKey: "turn-2",
      previousCursor: "cursor-1",
      delta: {
        type: "tool_results",
        batchId: "batch-1",
        results: [{ status: "succeeded", resultHash: `sha256:${"b".repeat(64)}` }]
      }
    }, {
      schemaVersion: 1,
      contextHash,
      confirmedTurnCount: 1,
      lastConfirmed: {
        exchangeId: "exchange-1",
        stableCallKey: "turn-1",
        cursor: "cursor-1",
        inputHash: `sha256:${"c".repeat(64)}`,
        outputHash: `sha256:${"d".repeat(64)}`
      },
      semanticState: "Goal: build Ore hauled VDT. Confirmed: initial brief. Pending: apply the first tool batch."
    });
    const secondPrompt = JSON.parse(secondPayload.userPrompt) as Record<string, unknown>;
    expect(secondPrompt).not.toHaveProperty("initialContext");
    expect(secondPrompt).not.toHaveProperty("project");
    expect(secondPrompt).toMatchObject({
      sessionContinuation: {
        semanticState: "Goal: build Ore hauled VDT. Confirmed: initial brief. Pending: apply the first tool batch."
      }
    });
    expect(secondPayload.userPrompt).not.toContain(marker);
    expect(secondPayload.userPrompt).not.toContain('"initialContext"');
    expect(secondPayload.userPrompt).not.toContain('"project"');
    expect(new TextEncoder().encode(secondPayload.userPrompt).byteLength).toBeLessThan(2_048);
    expect(deriveModelAgentSessionBindingId("binding", "run-a")).not.toBe(
      deriveModelAgentSessionBindingId("binding", "run-b")
    );
  });

  it("resolves a binding-only start on the server and persists its authoritative execution identity", async () => {
    const hash = `sha256:${"b".repeat(64)}`;
    const capability: Extract<AgentCapabilityProfile, { executionProfile: "model_agent" }> = {
      schemaVersion: 1,
      executionProfile: "model_agent",
      engineId: "in-product-model-agent",
      engineAdapterId: "legacy-micro-cli-compat-test-v1",
      backendId: "mock",
      protocolVersion: "structured-turn-v1",
      sessionStrategy: "structured_turn",
      toolCatalogHash: hash,
      toolIsolation: "permission_only",
      qualification: {
        status: "unverified",
        platform: { os: "test", arch: "test", runtimeVersion: "node-test" },
        testedAt: null,
        evidenceHash: null
      },
      supportsNativeSession: false,
      supportsResume: false,
      supportsStructuredEvents: true,
      supportsToolBridge: true,
      supportsQuestions: true,
      supportsCancellation: true,
      supportsUsageMetrics: true,
      cli: null
    };
    const bindingId = `model_agent_route_${Date.now()}`;
    const dispose = agentExecutionBindingRegistry.register({
      bindingId,
      enabled: true,
      modelId: "mock-model-server-owned",
      capability,
      legacyCompatibilityAdapter: {
        providerId: "mock",
        providerConfig: { maxTokens: 1_234, apiKey: "server-secret-must-not-echo" }
      }
    });

    try {
      const response = await startRun(jsonRequest("http://localhost:3000/api/agent/runs", {
        mode: "generate_vdt",
        input: { rootKpi: "Ore hauled" },
        executionBindingId: bindingId
      }));
      const body = await readJson(response);

      expect(response.status).toBe(200);
      expect(body.snapshot?.request).toMatchObject({ executionBindingId: bindingId });
      expect(body.snapshot?.request?.providerConfig).toBeUndefined();
      expect(body.snapshot?.executionSummary).toMatchObject({
        executionProfile: "model_agent",
        engineAdapterId: "legacy-micro-cli-compat-test-v1",
        backendId: "mock",
        modelId: "mock-model-server-owned",
        protocolVersion: "structured-turn-v1",
        cliVersion: null,
        toolIsolation: "permission_only",
        qualificationStatus: "unverified",
        capabilityEvidenceHash: null,
        capabilityProfileHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        toolCatalogHash: hash
      });
      expect(agentRuntime.store.getState(body.runId!).executionSummary).toMatchObject(
        body.snapshot?.executionSummary ?? {}
      );
    } finally {
      dispose();
    }
  });

  it("runs a binding-only Model Agent through one Supervisor session and resumes it with deltas", async () => {
    const toolCatalogHash = currentModelAgentToolCatalogHash();
    const capability: Extract<AgentCapabilityProfile, { executionProfile: "model_agent" }> = {
      schemaVersion: 1,
      executionProfile: "model_agent",
      engineId: "in-product-model-agent",
      engineAdapterId: "http-structured-turn-test-v1",
      backendId: "openai_compatible",
      protocolVersion: "structured-turn-v1",
      sessionStrategy: "structured_turn",
      toolCatalogHash,
      toolIsolation: "permission_only",
      qualification: {
        status: "unverified",
        platform: { os: "test", arch: "test", runtimeVersion: "node-test" },
        testedAt: null,
        evidenceHash: null
      },
      supportsNativeSession: false,
      supportsResume: false,
      supportsStructuredEvents: true,
      supportsToolBridge: true,
      supportsQuestions: true,
      supportsCancellation: true,
      supportsUsageMetrics: false,
      cli: null
    };
    const firstTurn = {
      turnId: "turn-1",
      sessionState: "Goal: build Ore hauled VDT. Pending: confirm reporting period before graph work.",
      assistantMessage: {
        messageId: "message-1",
        text: "I will build the VDT in this bound session."
      },
      action: {
        type: "question",
        messageId: "question-message-1",
        questionSetId: "question-set-1",
        questions: [{
          id: "period",
          question: "Which reporting period should I use?",
          reason: "The root formula needs one time basis.",
          required: true,
          expectedAnswerType: "text"
        }]
      }
    };
    const secondTurn = {
      turnId: "turn-2",
      sessionState: "Goal: build Ore hauled VDT. Reporting period confirmed. Pending: confirm root unit.",
      assistantMessage: {
        messageId: "message-2",
        text: "I kept the same session and received the reporting period."
      },
      action: {
        type: "question",
        messageId: "question-message-2",
        questionSetId: "question-set-2",
        questions: [{
          id: "unit",
          question: "Which root unit should I use?",
          reason: "The calculation must have a consistent unit.",
          required: true,
          expectedAnswerType: "text"
        }]
      }
    };
    const providerFetch = vi.fn()
      .mockResolvedValueOnce(openAiStructuredResponse(firstTurn))
      .mockResolvedValueOnce(openAiStructuredResponse(secondTurn))
      .mockResolvedValueOnce(openAiStructuredResponse(firstTurn));
    vi.stubGlobal("fetch", providerFetch);

    const bindingId = `structured_model_route_${Date.now()}`;
    const dispose = agentExecutionBindingRegistry.register({
      bindingId,
      enabled: true,
      modelId: "server-owned-model",
      capability,
      modelEngineAdapter: {
        providerId: "openai_compatible",
        providerConfig: {
          baseUrl: "https://models.example.test/v1",
          apiKey: "server-secret-must-not-echo",
          model: "server-owned-model"
        },
        maxTokens: 4_000
      }
    });

    try {
      const response = await startRun(jsonRequest("http://localhost:3000/api/agent/runs", {
        mode: "generate_vdt",
        input: { rootKpi: "Ore hauled", prompt: "Build an Ore hauled VDT." },
        executionBindingId: bindingId
      }));
      const body = await readJson(response);
      expect(response.status).toBe(200);
      expect(body.snapshot?.request?.providerConfig).toBeUndefined();

      const waiting = await waitForRunSnapshot(body.runId!, (snapshot) =>
        snapshot.status === "needs_user_input" && snapshot.pendingQuestions?.[0]?.id === "period"
      );
      expect(waiting.executionSummary).toMatchObject({
        executionProfile: "model_agent",
        engineAdapterId: "http-structured-turn-test-v1",
        backendId: "openai_compatible",
        modelId: "server-owned-model",
        sessionEpoch: 1
      });
      expect(providerFetch).toHaveBeenCalledTimes(1);

      const instructionDuringQuestion = await postMessage(jsonRequest(
        `http://localhost:3000/api/agent/runs/${body.runId}/messages`,
        { type: "user_instruction", text: "Skip the active question." }
      ), { params: Promise.resolve({ runId: body.runId! }) });
      expect(instructionDuringQuestion.status).toBe(409);
      expect(await readJson(instructionDuringQuestion)).toMatchObject({
        error: { code: "MODEL_AGENT_INTERACTION_RESPONSE_REQUIRED" }
      });

      const firstProviderBody = JSON.parse(String((providerFetch.mock.calls[0]?.[1] as RequestInit).body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      const firstPrompt = JSON.parse(firstProviderBody.messages.find((message) => message.role === "user")!.content) as {
        delta: { type: string; context?: { tools?: unknown[] } };
      };
      expect(firstPrompt.delta.type).toBe("initial_context");
      expect(firstPrompt.delta.context?.tools?.length).toBeGreaterThan(10);

      const answerResponse = await postMessage(jsonRequest(
        `http://localhost:3000/api/agent/runs/${body.runId}/messages`,
        { type: "user_answer", answers: { period: "year" } }
      ), { params: Promise.resolve({ runId: body.runId! }) });
      expect(answerResponse.status).toBe(200);

      await waitForRunSnapshot(body.runId!, (snapshot) =>
        snapshot.status === "needs_user_input" && snapshot.pendingQuestions?.[0]?.id === "unit"
      );
      expect(providerFetch).toHaveBeenCalledTimes(2);
      const secondProviderBody = JSON.parse(String((providerFetch.mock.calls[1]?.[1] as RequestInit).body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      const secondPrompt = JSON.parse(secondProviderBody.messages.find((message) => message.role === "user")!.content) as {
        delta: { type: string; context?: unknown };
        sessionContinuation: {
          schemaVersion: number;
          contextHash: string;
          confirmedTurnCount: number;
          semanticState: string;
          lastConfirmed: {
            exchangeId: string;
            stableCallKey: string;
            cursor: string;
            inputHash: string;
            outputHash: string;
          };
        };
      };
      expect(secondPrompt.delta).toMatchObject({ type: "human_input" });
      expect(secondPrompt.delta).not.toHaveProperty("context");
      expect(secondPrompt.sessionContinuation).toMatchObject({
        schemaVersion: 1,
        confirmedTurnCount: 1,
        semanticState: firstTurn.sessionState,
        lastConfirmed: {
          exchangeId: "exchange-1-1",
          stableCallKey: "turn-1-1"
        }
      });
      expect(secondPrompt.sessionContinuation.contextHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(secondPrompt.sessionContinuation.lastConfirmed.inputHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(secondPrompt.sessionContinuation.lastConfirmed.outputHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      const secondPromptText = JSON.stringify(secondPrompt);
      expect(secondPromptText).not.toContain('"initialContext"');
      expect(secondPromptText).not.toContain('"project"');
      expect(new TextEncoder().encode(secondPromptText).byteLength).toBeLessThan(8_192);

      const eventsResponse = await getEvents(new Request(
        `http://localhost:3000/api/agent/runs/${body.runId}/events`
      ), { params: Promise.resolve({ runId: body.runId! }) });
      const reader = eventsResponse.body!.getReader();
      const firstChunk = await reader.read();
      reader.releaseLock();
      await eventsResponse.body?.cancel();
      const firstSseChunk = new TextDecoder().decode(firstChunk.value);
      expect(firstSseChunk).toContain("event: agent_event");
      expect(firstSseChunk).toContain('"schemaVersion":2');
      expect(firstSseChunk).toContain('"source":"runtime"');

      const secondRunResponse = await startRun(jsonRequest("http://localhost:3000/api/agent/runs", {
        mode: "generate_vdt",
        input: { rootKpi: "Ore hauled second run" },
        executionBindingId: bindingId
      }));
      const secondRunBody = await readJson(secondRunResponse);
      expect(secondRunResponse.status).toBe(200);
      await waitForRunSnapshot(secondRunBody.runId!, (snapshot) => snapshot.status === "needs_user_input");
      const firstSessionBinding = agentRuntime.store.getState(body.runId!).supervisorPersistenceV2?.binding.bindingId;
      const secondSessionBinding = agentRuntime.store.getState(secondRunBody.runId!).supervisorPersistenceV2?.binding.bindingId;
      expect(firstSessionBinding).toMatch(/^session-binding:[a-f0-9]{40}$/);
      expect(secondSessionBinding).toMatch(/^session-binding:[a-f0-9]{40}$/);
      expect(secondSessionBinding).not.toBe(firstSessionBinding);
      expect(agentRuntime.store.getState(body.runId!).request.executionBindingId).toBe(bindingId);
      expect(agentRuntime.store.getState(secondRunBody.runId!).request.executionBindingId).toBe(bindingId);
      expect(providerFetch).toHaveBeenCalledTimes(3);

      const secondCancelled = await cancelRun(new Request(
        `http://localhost:3000/api/agent/runs/${secondRunBody.runId}/cancel`,
        { method: "POST" }
      ), { params: Promise.resolve({ runId: secondRunBody.runId! }) });
      expect((await readJson(secondCancelled)).status).toBe("cancelled");
      await waitForSupervisorReleased(secondRunBody.runId!);

      const cancelled = await cancelRun(new Request(
        `http://localhost:3000/api/agent/runs/${body.runId}/cancel`,
        { method: "POST" }
      ), { params: Promise.resolve({ runId: body.runId! }) });
      expect(await readJson(cancelled)).toMatchObject({
        ok: true,
        status: "cancelled",
        snapshot: { status: "cancelled" }
      });
      await waitForSupervisorReleased(body.runId!);
      expect(isStructuredModelAgentRunActive(body.runId!)).toBe(false);
      expect(providerFetch).toHaveBeenCalledTimes(3);
    } finally {
      dispose();
    }
  });

  it("rejects a model mutation made stale during inference and sends a reconciliation delta", async () => {
    const toolCatalogHash = currentModelAgentToolCatalogHash();
    const capability: Extract<AgentCapabilityProfile, { executionProfile: "model_agent" }> = {
      schemaVersion: 1,
      executionProfile: "model_agent",
      engineId: "in-product-model-agent",
      engineAdapterId: "http-stale-reconciliation-test-v1",
      backendId: "openai_compatible",
      protocolVersion: "structured-turn-v1",
      sessionStrategy: "structured_turn",
      toolCatalogHash,
      toolIsolation: "permission_only",
      qualification: {
        status: "unverified",
        platform: { os: "test", arch: "test", runtimeVersion: "node-test" },
        testedAt: null,
        evidenceHash: null
      },
      supportsNativeSession: false,
      supportsResume: false,
      supportsStructuredEvents: true,
      supportsToolBridge: true,
      supportsQuestions: true,
      supportsCancellation: true,
      supportsUsageMetrics: false,
      cli: null
    };
    const initialBuilder = new VdtBuilderSession({ now: () => "2026-08-26T10:00:00.000Z" });
    initialBuilder.createDraft({ projectTitle: "Ore hauled", rootKpi: "Ore hauled" });
    const initialProject = initialBuilder.getProject();
    const rootNodeId = initialProject.rootNodeId;
    let resolveInference!: (response: Response) => void;
    const inference = new Promise<Response>((resolve) => {
      resolveInference = resolve;
    });
    const correctedQuestion = {
      turnId: "turn-after-reconciliation",
      sessionState: "Goal: continue the current VDT. Manual root rename confirmed; stale driver discarded.",
      assistantMessage: {
        messageId: "message-after-reconciliation",
        text: "I reconciled the manual project change and discarded the stale mutation."
      },
      action: {
        type: "question",
        messageId: "question-after-reconciliation",
        questionSetId: "question-set-after-reconciliation",
        questions: [{
          id: "continue-after-manual-change",
          question: "Should I continue from the manually updated project head?",
          reason: "The previous mutation was fenced as stale.",
          required: true,
          expectedAnswerType: "text"
        }]
      }
    };
    const providerFetch = vi.fn()
      .mockImplementationOnce(() => inference)
      .mockResolvedValueOnce(openAiStructuredResponse(correctedQuestion));
    vi.stubGlobal("fetch", providerFetch);

    const bindingId = `structured_stale_route_${Date.now()}`;
    const dispose = agentExecutionBindingRegistry.register({
      bindingId,
      enabled: true,
      modelId: "server-owned-model",
      capability,
      modelEngineAdapter: {
        providerId: "openai_compatible",
        providerConfig: {
          baseUrl: "https://models.example.test/v1",
          apiKey: "server-secret-must-not-echo",
          model: "server-owned-model"
        }
      }
    });

    try {
      const response = await startRun(jsonRequest("http://localhost:3000/api/agent/runs", {
        mode: "generate_vdt",
        input: { rootKpi: "Ore hauled", project: initialProject },
        executionBindingId: bindingId
      }));
      const body = await readJson(response);
      expect(response.status).toBe(200);
      await waitForProviderCalls(providerFetch, 1);
      expect(providerFetch).toHaveBeenCalledTimes(1);

      const manualResponse = await postMessage(jsonRequest(
        `http://localhost:3000/api/agent/runs/${body.runId}/messages`,
        {
          type: "manual_project_change",
          projectRevision: initialBuilder.getRevision() + 1,
          change: {
            kind: "node_updated",
            nodeId: rootNodeId,
            patch: { name: "Manually updated Ore hauled" },
            summary: "User renamed the root while inference was active."
          }
        }
      ), { params: Promise.resolve({ runId: body.runId! }) });
      expect(manualResponse.status).toBe(200);

      const queuedInstructionResponse = await postMessage(jsonRequest(
        `http://localhost:3000/api/agent/runs/${body.runId}/messages`,
        {
          type: "user_instruction",
          text: "Keep the manually revised root name in the next checkpoint."
        }
      ), { params: Promise.resolve({ runId: body.runId! }) });
      expect(queuedInstructionResponse.status).toBe(200);

      resolveInference(openAiStructuredResponse({
        turnId: "stale-turn",
        sessionState: "Goal: continue the current VDT. Proposed stale driver from the prior head.",
        assistantMessage: {
          messageId: "stale-message",
          text: "I prepared the next driver from the earlier project head."
        },
        action: {
          type: "action_batch",
          batch: {
            calls: [{
              externalCallId: "stale-add-driver",
              toolName: "vdt.add_driver",
              args: {
                parentNodeId: rootNodeId,
                nodeId: "must_not_be_added",
                name: "Stale driver",
                type: "input",
                relation: "positive",
                baselineValue: 1
              }
            }]
          }
        }
      }));

      await waitForRunSnapshot(body.runId!, (snapshot) =>
        snapshot.status === "needs_user_input"
        && snapshot.pendingQuestions?.[0]?.id === "continue-after-manual-change"
      );
      expect(providerFetch).toHaveBeenCalledTimes(2);
      const secondProviderBody = JSON.parse(String((providerFetch.mock.calls[1]?.[1] as RequestInit).body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      const secondPrompt = JSON.parse(secondProviderBody.messages.find((message) => message.role === "user")!.content) as {
        delta: {
          type: string;
          checkpointDelta?: {
            type?: string;
            reconciliation?: { expectedRevision?: number; currentRevision?: number; manualChanges?: unknown[] };
            results?: Array<{ resultCode?: string }>;
          };
          inputs?: Array<{ type?: string; text?: string }>;
        };
      };
      expect(secondPrompt.delta).toMatchObject({
        type: "checkpoint_inputs",
        checkpointDelta: {
          type: "manual_reconciliation",
          reconciliation: {
            manualChanges: [expect.objectContaining({ kind: "node_updated", nodeId: rootNodeId })]
          },
          results: [expect.objectContaining({ resultCode: "STALE_REVISION" })]
        },
        inputs: [{
          type: "user_instruction",
          text: "Keep the manually revised root name in the next checkpoint."
        }]
      });

      const project = agentRuntime.store.getState(body.runId!).builder!.getProject();
      expect(project.graph.nodes.map((node) => node.id)).not.toContain("must_not_be_added");
      expect(project.graph.nodes.find((node) => node.id === rootNodeId)?.name)
        .toBe("Manually updated Ore hauled");
      expect(agentRuntime.store.getState(body.runId!).supervisorPersistenceV2?.eventOutbox).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "checkpoint",
            payload: expect.objectContaining({ reason: "manual_reconciliation" })
          })
        ])
      );
    } finally {
      dispose();
    }
  });

  it("applies an approved mutation through one durable control receipt and replays the acknowledgement", async () => {
    const toolCatalogHash = currentModelAgentToolCatalogHash();
    const capability: Extract<AgentCapabilityProfile, { executionProfile: "model_agent" }> = {
      schemaVersion: 1,
      executionProfile: "model_agent",
      engineId: "in-product-model-agent",
      engineAdapterId: "http-approved-proposal-test-v1",
      backendId: "openai_compatible",
      protocolVersion: "structured-turn-v1",
      sessionStrategy: "structured_turn",
      toolCatalogHash,
      toolIsolation: "permission_only",
      qualification: {
        status: "unverified",
        platform: { os: "test", arch: "test", runtimeVersion: "node-test" },
        testedAt: null,
        evidenceHash: null
      },
      supportsNativeSession: false,
      supportsResume: false,
      supportsStructuredEvents: true,
      supportsToolBridge: true,
      supportsQuestions: true,
      supportsCancellation: true,
      supportsUsageMetrics: false,
      cli: null
    };
    const initialBuilder = new VdtBuilderSession({ now: () => "2026-08-26T10:00:00.000Z" });
    initialBuilder.createDraft({ projectTitle: "Ore hauled", rootKpi: "Ore hauled" });
    const initialProject = initialBuilder.getProject();
    const rootNodeId = initialProject.rootNodeId;
    const providerFetch = vi.fn()
      .mockResolvedValueOnce(openAiStructuredResponse({
        turnId: "proposal-turn",
        sessionState: "Goal: build Ore hauled VDT. Pending: user approval for the first driver.",
        assistantMessage: {
          messageId: "proposal-message",
          text: "I prepared the first driver for approval."
        },
        action: {
          type: "action_batch",
          batch: {
            calls: [{
              externalCallId: "propose-approved-driver",
              toolName: "vdt.add_driver",
              args: {
                parentNodeId: rootNodeId,
                nodeId: "approved_driver",
                name: "Approved driver",
                type: "input",
                relation: "positive_driver",
                baselineValue: 1
              }
            }]
          }
        }
      }))
      .mockResolvedValueOnce(openAiStructuredResponse({
        turnId: "post-approval-turn",
        sessionState: "Goal: build Ore hauled VDT. First driver applied. Pending: confirm the next layer.",
        assistantMessage: {
          messageId: "post-approval-message",
          text: "The approved driver is now part of the current project."
        },
        action: {
          type: "question",
          messageId: "post-approval-question-message",
          questionSetId: "post-approval-question-set",
          questions: [{
            id: "continue-after-approval",
            question: "Should I add the next driver layer?",
            reason: "The first approved operation is complete.",
            required: true,
            expectedAnswerType: "text"
          }]
        }
      }));
    vi.stubGlobal("fetch", providerFetch);

    const bindingId = `structured_approved_proposal_${Date.now()}`;
    const dispose = agentExecutionBindingRegistry.register({
      bindingId,
      enabled: true,
      modelId: "server-owned-model",
      capability,
      modelEngineAdapter: {
        providerId: "openai_compatible",
        providerConfig: {
          baseUrl: "https://models.example.test/v1",
          apiKey: "server-secret-must-not-echo",
          model: "server-owned-model"
        }
      }
    });

    try {
      const response = await startRun(jsonRequest("http://localhost:3000/api/agent/runs", {
        mode: "generate_vdt",
        input: { rootKpi: "Ore hauled", project: initialProject },
        executionBindingId: bindingId,
        options: { autoApplyPatches: false }
      }));
      const body = await readJson(response);
      expect(response.status).toBe(200);

      await waitForRunSnapshot(body.runId!, (snapshot) => snapshot.status === "waiting_approval");
      const beforeApproval = agentRuntime.store.getState(body.runId!);
      const proposal = beforeApproval.pendingMutationProposal;
      expect(proposal).toBeDefined();
      expect(beforeApproval.builder?.getProject().graph.nodes.map((node) => node.id))
        .not.toContain("approved_driver");
      const baseRevision = beforeApproval.builder!.getRevision();
      const priorCheckpointId = beforeApproval.supervisorPersistenceV2?.checkpoint?.checkpointId;
      const approvalBody = {
        type: "approval",
        approved: true,
        proposalId: proposal!.id,
        selectedChangeIds: proposal!.selectedChangeIds
      };

      const approved = await postMessage(jsonRequest(
        `http://localhost:3000/api/agent/runs/${body.runId}/messages`,
        approvalBody
      ), { params: Promise.resolve({ runId: body.runId! }) });
      expect(approved.status).toBe(200);

      await waitForRunSnapshot(body.runId!, (snapshot) =>
        snapshot.status === "needs_user_input"
        && snapshot.pendingQuestions?.[0]?.id === "continue-after-approval"
      );
      const afterApproval = agentRuntime.store.getState(body.runId!);
      const committedRevision = afterApproval.builder!.getRevision();
      expect(committedRevision).toBeGreaterThan(baseRevision);
      expect(afterApproval.builder!.getProject().graph.nodes.filter((node) => node.id === "approved_driver"))
        .toHaveLength(1);
      expect(afterApproval.supervisorPersistenceV2?.checkpoint?.checkpointId)
        .not.toBe(priorCheckpointId);
      expect(afterApproval.supervisorPersistenceV2?.eventOutbox).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "checkpoint",
          payload: expect.objectContaining({ reason: "human_input_accepted" })
        })
      ]));

      const controlReceipts = afterApproval.supervisorPersistenceV2?.toolOperationReceipts.filter(
        (receipt) => receipt.toolName === "control.apply_approved_proposal"
      ) ?? [];
      expect(controlReceipts.at(-1)).toMatchObject({
        externalCallId: expect.stringMatching(/^approval-apply-[a-f0-9]{40}$/),
        state: "completed",
        expectedRevision: baseRevision,
        committedRevision,
        replayResult: expect.objectContaining({
          status: "succeeded",
          resultCode: "APPROVED_PROPOSAL_APPLIED"
        })
      });

      const secondProviderBody = JSON.parse(String((providerFetch.mock.calls[1]?.[1] as RequestInit).body));
      const secondProviderWire = JSON.stringify(secondProviderBody);
      expect(secondProviderWire).not.toContain("control.apply_approved_proposal");
      expect(secondProviderWire).not.toContain("committedRevision");
      expect(secondProviderWire).not.toContain(proposal!.id);
      const providerCallsBeforeReplay = providerFetch.mock.calls.length;

      const replay = await postMessage(jsonRequest(
        `http://localhost:3000/api/agent/runs/${body.runId}/messages`,
        approvalBody
      ), { params: Promise.resolve({ runId: body.runId! }) });
      expect(replay.status).toBe(200);
      expect(providerFetch).toHaveBeenCalledTimes(providerCallsBeforeReplay);

      const afterReplay = agentRuntime.store.getState(body.runId!);
      expect(afterReplay.builder!.getRevision()).toBe(committedRevision);
      expect(afterReplay.builder!.getProject().graph.nodes.filter((node) => node.id === "approved_driver"))
        .toHaveLength(1);
      expect(afterReplay.status).toBe("needs_user_input");
      expect(afterReplay.pendingQuestions?.[0]?.id).toBe("continue-after-approval");
      expect(afterReplay.supervisorPersistenceV2?.toolOperationReceipts.filter(
        (receipt) => receipt.toolName === "control.apply_approved_proposal" && receipt.state === "completed"
      )).toHaveLength(1);
    } finally {
      dispose();
    }
  });

  it("fails closed for unknown bindings and rejects client-owned target configuration", async () => {
    const missing = await startRun(jsonRequest("http://localhost:3000/api/agent/runs", {
      mode: "generate_vdt",
      input: { rootKpi: "Ore hauled" },
      executionBindingId: "missing_server_binding"
    }));
    expect(missing.status).toBe(409);
    expect(await readJson(missing)).toMatchObject({
      error: { code: "AGENT_EXECUTION_BINDING_UNAVAILABLE" }
    });

    for (const field of ["executionProfile", "engineAdapterId", "executable", "model", "securityConfig"] as const) {
      const response = await startRun(jsonRequest("http://localhost:3000/api/agent/runs", {
        mode: "generate_vdt",
        input: { rootKpi: "Ore hauled" },
        executionBindingId: "missing_server_binding",
        [field]: "client-owned"
      }));
      expect(response.status).toBe(400);
    }
  });

  it("keeps the legacy per-decision provider route disabled in production without explicit opt-in", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VDT_AGENT_LEGACY_COMPATIBILITY_ENABLED", "false");

    const response = await startRun(jsonRequest("http://localhost:3000/api/agent/runs", {
      mode: "generate_vdt",
      input: { rootKpi: "Ore hauled" },
      providerId: "mock"
    }));

    expect(response.status).toBe(409);
    expect(await readJson(response)).toMatchObject({
      error: { code: "AGENT_LEGACY_COMPATIBILITY_DISABLED" }
    });
  });

  it.each([
    ["hosted_web", "desktop"],
    ["invalid", "desktop"],
    [undefined, undefined]
  ] as const)("fails closed in mode %s regardless of loopback URL and Host", async (mode, publicMode) => {
    vi.stubEnv("VDT_APP_MODE", mode);
    vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", publicMode);
    const previousIds = agentRunIds();

    const response = await startRun(jsonRequest("http://127.0.0.1:3000/api/agent/runs", {
      mode: "generate_vdt",
      input: {
        prompt: "Build a production VDT.",
        rootKpi: "Production Volume"
      },
      providerId: "mock"
    }, {
      headers: {
        "content-type": "application/json",
        host: "localhost:3000"
      }
    }));
    const body = await readJson(response);

    expect(response.status).toBe(403);
    expect(body).toMatchObject({
      schemaVersion: "vdt_storage_error_response.v1",
      ok: false,
      error: {
        code: "HOSTED_REVISION_WRITES_DISABLED",
        retryable: false
      }
    });
    expect(agentRunIds()).toEqual(previousIds);
  });

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

  it("preserves workspace.vdtId on stored agent run request", async () => {
    const response = await startRun(jsonRequest("http://localhost:3000/api/agent/runs", {
      mode: "continue_project",
      input: {
        prompt: "Extend the existing model",
        rootKpi: "Production Volume"
      },
      workspace: {
        projectId: "project_production_volume",
        vdtId: "vdt_existing_001"
      },
      providerId: "mock"
    }));
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body.snapshot?.request?.workspace?.vdtId).toBe("vdt_existing_001");
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

  it("maps synchronous persistence errors through the frozen storage envelope", async () => {
    vi.spyOn(agentRuntime, "startRunInBackground").mockImplementation(() => {
      throw new VdtStorageError(
        "MIGRATION_IN_PROGRESS",
        "migration lease is active",
        true
      );
    });

    const response = await startRun(jsonRequest(
      "http://localhost:3000/api/agent/runs",
      {
        mode: "generate_vdt",
        input: {
          prompt: "Build a production VDT.",
          rootKpi: "Production Volume"
        },
        providerId: "mock"
      }
    ));

    expect(response.status).toBe(409);
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(await readJson(response)).toMatchObject({
      schemaVersion: "vdt_storage_error_response.v1",
      ok: false,
      error: {
        code: "MIGRATION_IN_PROGRESS",
        retryable: true
      }
    });
  });

  it("keeps provider initialization failures on the agent request envelope", async () => {
    const response = await startRun(jsonRequest(
      "http://localhost:3000/api/agent/runs",
      {
        mode: "generate_vdt",
        input: {
          prompt: "Build a production VDT.",
          rootKpi: "Production Volume"
        },
        providerId: "local_runner"
      }
    ));
    const body = await readJson(response);

    expect(response.status).toBe(500);
    expect(body.schemaVersion).toBeUndefined();
    expect(body).toMatchObject({
      ok: false,
      error: {
        code: "AGENT_START_FAILED"
      }
    });
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

  it("elevates retry timeout via prepareRetryExecution before handling the message", async () => {
    const startResponse = await startRun(jsonRequest("http://localhost:3000/api/agent/runs", {
      mode: "generate_vdt",
      input: {
        prompt: "Build a haulage model.",
        rootKpi: "Ore haulage",
        unit: "tonnes/year",
        timePeriod: "year"
      },
      providerId: "mock",
      providerConfig: {
        timeoutMs: 60_000
      },
      options: { maxSteps: 3 }
    }));
    const startBody = await readJson(startResponse);
    expect(startResponse.status).toBe(200);
    const runId = startBody.runId!;

    agentRuntime.store.updateRun(runId, {
      status: "needs_user_input",
      phase: "reporting",
      firstResponseCompleted: true,
      retryableError: {
        code: "TIMEOUT",
        message: "Backend timed out.",
        retryCount: 1,
        createdAt: new Date().toISOString()
      }
    });

    const response = await postMessage(jsonRequest(`http://localhost:3000/api/agent/runs/${runId}/messages`, {
      type: "user_answer",
      answers: { retry: "retry_last_step" }
    }), {
      params: Promise.resolve({ runId })
    });

    expect(response.status).toBe(200);
    expect(agentRuntime.store.getState(runId).request.providerConfig?.timeoutMs).toBe(AGENT_DECISION_TIMEOUT_FLOOR_MS);
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

  it("maps lazy SQLite initialization failures through the frozen storage envelope", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vdt-agent-db-open-"));
    const invalidDataDir = path.join(root, "not-a-directory");
    fs.writeFileSync(invalidDataDir, "file", "utf8");
    vi.stubEnv("VDT_DATA_DIR", invalidDataDir);
    delete runtimeGlobal.__vdtAgentRuntime;
    vi.resetModules();

    try {
      const { POST } = await import("./route");
      const response = await POST(jsonRequest(
        "http://localhost:3000/api/agent/runs",
        {
          mode: "generate_vdt",
          input: {
            prompt: "Build a production VDT.",
            rootKpi: "Production Volume"
          },
          providerId: "mock"
        }
      ));
      const body = await readJson(response);

      expect(response.status).toBe(500);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(body).toMatchObject({
        schemaVersion: "vdt_storage_error_response.v1",
        ok: false,
        error: {
          code: "VDT_STORAGE_INTERNAL_ERROR",
          retryable: false
        }
      });
    } finally {
      delete runtimeGlobal.__vdtAgentRuntime;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
