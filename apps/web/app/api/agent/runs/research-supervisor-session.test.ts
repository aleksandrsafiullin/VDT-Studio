import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AgentCapabilityProfile,
  AgentEngineEvent,
  AgentEngineHost,
  AgentEngineStart,
  AgentExecutionEngine,
  AgentHumanInput,
  AgentRunSession,
  AgentSessionBinding,
  VdtGatewayToolResult
} from "@vdt-studio/vdt-agent-runtime";
import type { ExternalCliExecutionBindingDefinition } from "./execution-bindings";

const detectSubscriptionCli = vi.fn();

vi.mock("@vdt-studio/model-bridge/node", async (importOriginal) => {
  const original = await importOriginal<typeof import("@vdt-studio/model-bridge/node")>();
  return {
    ...original,
    detectSubscriptionCli
  };
});

const runtimeGlobal = globalThis as typeof globalThis & {
  __vdtAgentRuntime?: unknown;
  __vdtAgentExecutionBindingRegistry?: unknown;
  __vdtExternalAgentEngines?: unknown;
  __vdtCursorSessionBindingProbe?: unknown;
  __vdtCliSessionRegistrationOutcomes?: unknown;
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  detectSubscriptionCli.mockReset();
  delete runtimeGlobal.__vdtAgentRuntime;
  delete runtimeGlobal.__vdtAgentExecutionBindingRegistry;
  delete runtimeGlobal.__vdtExternalAgentEngines;
  delete runtimeGlobal.__vdtCursorSessionBindingProbe;
  delete runtimeGlobal.__vdtCliSessionRegistrationOutcomes;
});

function mockCodexInstalled() {
  detectSubscriptionCli.mockImplementation(async (id: string) => {
    if (id === "codex") {
      return {
        id,
        backendId: "codex_subscription",
        alias: "codex",
        installed: true,
        executable: "/opt/vdt-test/bin/codex",
        version: "0.146.0"
      };
    }
    return { id, backendId: id, installed: false, executable: null, version: null, alias: id };
  });
}

function shouldStopResearchRetry(result: VdtGatewayToolResult): boolean {
  if (result.resultCode !== "RESEARCH_PROVIDER_NOT_CONFIGURED") return true;
  const payload = result.payload && typeof result.payload === "object"
    ? result.payload as Record<string, unknown>
    : {};
  const feedback = payload.feedback && typeof payload.feedback === "object"
    ? payload.feedback as Record<string, unknown>
    : {};
  const suggested = Array.isArray(feedback.suggestedNextTools) ? feedback.suggestedNextTools : [];
  return suggested.includes("user.ask") || feedback.kind === "research_required";
}

class ScriptedExternalEngine implements AgentExecutionEngine {
  session?: FakeExternalSession;
  constructor(
    readonly capability: AgentCapabilityProfile,
    private readonly eventFactory: (host: AgentEngineHost) => AsyncGenerator<AgentEngineEvent>
  ) {}

  async openSession(start: AgentEngineStart, host: AgentEngineHost): Promise<AgentRunSession> {
    const binding = {
      ...start.binding,
      externalSessionId: "opaque-research-session"
    };
    this.session = new FakeExternalSession(binding, host, this.eventFactory);
    return this.session;
  }

  async resumeSession(): Promise<AgentRunSession> {
    throw new Error("resumeSession is unused in the research unhappy-path test.");
  }
}

class FakeExternalSession implements AgentRunSession {
  constructor(
    readonly binding: AgentSessionBinding,
    private readonly host: AgentEngineHost,
    private readonly eventFactory: (host: AgentEngineHost) => AsyncGenerator<AgentEngineEvent>
  ) {}

  events(): AsyncIterable<AgentEngineEvent> {
    return this.eventFactory(this.host);
  }

  async submit(_input: AgentHumanInput): Promise<void> {}
  async checkpoint() {
    return {
      schemaVersion: 2 as const,
      checkpointId: "checkpoint-research",
      bindingId: this.binding.bindingId,
      runId: this.binding.runId,
      sessionEpoch: this.binding.sessionEpoch,
      externalSessionId: this.binding.externalSessionId,
      lastConfirmedInput: null,
      lastConfirmedOutput: null,
      activeExchange: null,
      activeToolCall: null,
      finishReceipt: null,
      createdAt: "2026-08-26T10:00:00.000Z"
    };
  }
  async cancel(): Promise<void> {}
  async close(): Promise<void> {}
}

async function waitForRunStatus(runId: string, status: string) {
  const { agentRuntime } = await import("./runtime");
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const state = agentRuntime.store.getState(runId);
    if (state.status === status) return state;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const state = (await import("./runtime")).agentRuntime.store.getState(runId);
  throw new Error(`Timed out waiting for status "${status}": ${JSON.stringify({
    status: state.status,
    error: state.error,
    lastToolResult: state.lastToolResult,
    pendingQuestions: state.pendingQuestions
  })}`);
}

describe("Supervisor external research unhappy path", { timeout: 45_000 }, () => {
  it("refuses research.search_web when unconfigured and continues with user.ask instead of retrying", async () => {
    vi.stubEnv("VDT_APP_MODE", "development_web");
    vi.stubEnv("VDT_CLI_SESSION_CANARY_ENABLED", "true");
    vi.stubEnv("VDT_RESEARCH_PROVIDER", "");
    vi.stubEnv("BRAVE_API_KEY", "");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "");
    vi.stubEnv("TAVILY_API_KEY", "");
    mockCodexInstalled();

    const runtime = await import("./runtime");
    const supervisor = await import("./supervisor-runtime");
    await runtime.ensureServerManagedExecutionBindings();
    const bindingDefinition = runtime.agentExecutionBindingRegistry.resolve(
      runtime.CODEX_SESSION_EXECUTION_BINDING_ID
    ) as ExternalCliExecutionBindingDefinition;

    const researchResults: VdtGatewayToolResult[] = [];
    const engine = new ScriptedExternalEngine(bindingDefinition.capability, async function* (host) {
      yield {
        type: "assistant_message",
        messageId: "message-research",
        text: "I will search for haulage process drivers, then ask if research is unavailable."
      };
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const result = await host.executeTool({
          externalCallId: `research-${attempt + 1}`,
          toolName: "research.search_web",
          args: {
            query: "ore haulage process drivers",
            purpose: "process_components"
          }
        });
        researchResults.push(result);
        if (!shouldStopResearchRetry(result)) continue;
        const ask = await host.executeTool({
          externalCallId: "ask-process",
          toolName: "user.ask",
          args: {
            questions: [{
              id: "process_components",
              question: "What are the main process components and formula boundary for ore haulage?",
              reason: "Research provider is not configured.",
              required: true,
              expectedAnswerType: "text"
            }]
          }
        });
        expect(ask.status).toBe("waiting_user");
        yield {
          type: "question",
          messageId: "question-research",
          questionSetId: "questions-research",
          questions: [{
            id: "process_components",
            question: "What are the main process components and formula boundary for ore haulage?",
            reason: "Research provider is not configured.",
            required: true,
            expectedAnswerType: "text"
          }]
        };
        return;
      }
      throw new Error("research.search_web retried without a bound refusal.");
    });

    const started = await supervisor.startExternalCliAgentRun({
      request: {
        mode: "generate_vdt",
        input: {
          prompt: "Build a haulage VDT",
          rootKpi: "Ore hauled"
        },
        executionBindingId: runtime.CODEX_SESSION_EXECUTION_BINDING_ID,
        providerId: "external_cli_agent",
        workspace: { projectId: "project_research_unconfigured" },
        options: { researchMode: "on", maxSteps: 8 }
      },
      bindingDefinition,
      engine,
      allowUnqualifiedExternalCanary: true
    });

    const state = await waitForRunStatus(started.runId!, "needs_user_input");
    expect(researchResults).toHaveLength(1);
    expect(researchResults[0]).toMatchObject({
      status: "failed",
      resultCode: "RESEARCH_PROVIDER_NOT_CONFIGURED",
      payload: {
        error: { code: "RESEARCH_PROVIDER_NOT_CONFIGURED" },
        feedback: {
          kind: "research_required",
          suggestedNextTools: ["user.ask"],
          retryable: false
        }
      }
    });
    expect(state.pendingQuestions).toEqual([
      expect.objectContaining({ id: "process_components" })
    ]);
    expect(state.status).toBe("needs_user_input");
    supervisor.resetActiveSupervisorRunsForTests();
  });
});
