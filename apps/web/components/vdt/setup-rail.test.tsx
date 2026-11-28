import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRunStore } from "@vdt-studio/vdt-agent-runtime";
import { productionVolumeProject, type VdtNode } from "@vdt-studio/vdt-core";
import { DEFAULT_EXECUTION_SETTINGS } from "@/lib/execution-mode-catalog";
import { GenerateActivityPanel } from "./generate-activity-panel";
import { StructuralOutcome } from "./structural-outcome";
import { WebSearchControl, researchModeTooltip } from "./web-search-control";
import type { VdtStudioState } from "./vdt-store";

const dialogueFixture = vi.hoisted(() => ({ phase: undefined as "idle" | "listening" | undefined, savedKey: false }));
vi.mock("./api-key-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api-key-storage")>();
  const store = actual.useApiKeyStorage;
  return { ...actual, useApiKeyStorage: Object.assign(
    (select: (state: ReturnType<typeof store.getState>) => unknown) =>
      dialogueFixture.savedKey ? select({ ...store.getState(), status: "saved" }) : store(select), store) };
});
vi.mock("./vdt-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./vdt-store")>();
  const useStore = actual.useVdtStudioStore;
  return { ...actual, useVdtStudioStore: Object.assign((select: (state: VdtStudioState) => unknown) =>
    dialogueFixture.phase ? select(useStore.getState()) : useStore(select), useStore) };
});
vi.mock("./use-voice-dialogue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./use-voice-dialogue")>();
  return { ...actual, useVoiceDialogue: (...args: Parameters<typeof actual.useVoiceDialogue>) => {
    const dialogue = actual.useVoiceDialogue(...args);
    return dialogueFixture.phase ? { ...dialogue, enabled: true, phase: dialogueFixture.phase, active: dialogueFixture.phase !== "idle" } : dialogue;
  } };
});
vi.mock("./speech-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./speech-store")>();
  return { ...actual, useSpeechSettings: () => {
    const settings = actual.useSpeechSettings();
    return dialogueFixture.phase ? { ...settings, ready: true } : settings;
  } };
});

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    }
  };
})();

vi.stubGlobal("localStorage", localStorageMock);

const { ExecutionReadinessDot, SelectedKpiContext, SetupRail, agentActivityScrollClassName, describeComposerReadiness } = await import("./setup-rail");
const { ComposerModelPicker } = await import("./composer-model-picker");
const { useVdtStudioStore } = await import("./vdt-store");

describe("SetupRail agent composer", () => {
  beforeEach(() => {
    dialogueFixture.phase = undefined;
    dialogueFixture.savedKey = false;
    localStorageMock.clear();
    useVdtStudioStore.setState(useVdtStudioStore.getInitialState(), true);
    useVdtStudioStore.setState({
      isGenerating: false,
      generateActivity: undefined,
      aiError: undefined,
      aiActionError: undefined,
      executionSettings: {
        ...DEFAULT_EXECUTION_SETTINGS,
        executionMode: "byok",
        gatewayPresetId: "openai-default",
        byokProtocol: "openai",
        useMockProvider: false,
        apiKey: "test-key",
        model: "gpt-test"
      },
      cliDetectionAgents: undefined,
      cliDetectionError: undefined,
      isRescanningClis: false
    });
  });

  it("leaves the chat area blank until starter prompts are ready", () => {
    const html = renderToStaticMarkup(<SetupRail />);

    expect(html).not.toContain('data-testid="agent-chat-empty"');
    expect(html).not.toContain('data-testid="agent-chat-starters"');
    expect(html).toContain('data-testid="agent-instruction-input"');
  });

  it("offers paid readback only for an eligible saved run and leaves it off until explicit consent", () => {
    dialogueFixture.phase = "idle";
    dialogueFixture.savedKey = true;
    const head = { projectId: "project", vdtId: "tree", activeRevisionId: "revision", commitGeneration: 1, pendingRevisionId: null };
    const runId = "run-readback";
    const run = {
      runId, status: "running", events: [], chatMessages: [], selectedSkills: [], request: { workspace: head, executionBindingId: "binding" },
      workspaceRevision: { head }, executionSummary: { executionMode: "api_keys", backendId: "openai_compatible", modelId: "gpt-test" }
    } as unknown as NonNullable<VdtStudioState["agentRun"]>;
    const time = "2026-11-26T00:00:00.000Z";
    useVdtStudioStore.setState(state => ({
      activeAgentRunId: runId, agentRun: run,
      workspace: { ...state.workspace, ...({
        activeProjectId: head.projectId, activeVdtId: head.vdtId,
        draftRevisionBase: { projectId: head.projectId, vdtId: head.vdtId, expectedHead: head },
        projectSummaries: [{ project: { id: head.projectId }, vdts: [{ vdt: { id: head.vdtId }, head }] }]
      } as unknown as Pick<VdtStudioState["workspace"], "activeProjectId" | "activeVdtId" | "draftRevisionBase" | "projectSummaries">) },
      generateActivity: { runId, requestId: runId, status: "running", phase: "waiting_provider", phaseStartedAt: time, startedAt: time,
        updatedAt: time, providerId: "openai_compatible", providerLabel: "OpenAI", appMode: "development_web", canCancel: true,
        cancelRequested: false, runtimeAgentRun: run }
    }));
    const disclosure = "OpenAI spoken questions and approvals";
    vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "development_web");
    vi.stubEnv("NEXT_PUBLIC_VDT_OPENAI_SPEECH_BYOK_ENABLED", "");
    try {
      expect(renderToStaticMarkup(<SetupRail />)).not.toContain(disclosure);
      vi.stubEnv("NEXT_PUBLIC_VDT_OPENAI_SPEECH_BYOK_ENABLED", "true");
      const markup = renderToStaticMarkup(<SetupRail />);
      expect(markup).toContain(disclosure);
      expect(markup).toContain("Enable for this run · API usage");
      expect(markup).toContain("Recognition stays on this computer.");
      expect(markup).not.toContain("Turn off OpenAI spoken updates");
      useVdtStudioStore.setState({ activeAgentRunId: "different-run" });
      expect(renderToStaticMarkup(<SetupRail />)).not.toContain(disclosure);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("places one Speak or Finish action inside the active question and keeps its manual answer and one run cancel", () => {
    const time = "2026-11-25T12:00:00.000Z";
    const workspace = { projectId: "workspace", vdtId: "tree" };
    const question = { id: "basis", question: "How do the stages operate?", reason: "Choose the correct capacity rule.",
      required: true, answerKind: "text" as const };
    const runs = new AgentRunStore();
    const { runId } = runs.createRun({ providerId: "openai", mode: "continue_project", input: {}, workspace });
    runs.updateRun(runId, { status: "needs_user_input", pendingQuestions: [question] });
    runs.appendChatMessage(runId, { role: "assistant", kind: "question", questions: [{ ...question, question: "Earlier version?" }] });
    runs.appendChatMessage(runId, { role: "assistant", kind: "question", questions: [question] });
    runs.appendEvent(runId, { type: "clarifying_questions", title: "Clarifying questions", message: question.question, questions: [question],
      metadata: { questionSetId: "current-set" } });
    const runtimeAgentRun = runs.getSnapshot(runId);
    useVdtStudioStore.setState(state => ({ workspace: { ...state.workspace, activeProjectId: workspace.projectId, activeVdtId: workspace.vdtId },
      generateActivity: { runId, requestId: runId, status: "needs_user_input", phase: "waiting_provider", phaseStartedAt: time, startedAt: time,
        updatedAt: time, providerId: "openai_compatible", providerLabel: "OpenAI", appMode: "development_web", canCancel: true,
        cancelRequested: false, agentChatMessages: runtimeAgentRun.chatMessages, runtimeAgentRun } }));

    dialogueFixture.phase = "idle";
    const markup = renderToStaticMarkup(<SetupRail />);
    const cards = [...markup.matchAll(/<form[^>]*data-testid="generate-questions"[^>]*>(.*?)<\/form>/g)].map(match => match[1]);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toContain("Earlier version?");
    expect(cards[0]).not.toContain('data-testid="agent-question-voice"');
    expect(cards[1]).toContain("How do the stages operate?");
    expect(cards[1]).toContain(">Speak your answer</button>");
    expect(cards[1]).toContain('data-testid="agent-answer-field-basis-answer"');
    expect(cards[1]).toContain(">Send answer</button>");
    expect(cards[1]).not.toMatch(/autofocus/i);
    expect(markup.match(/data-testid="agent-dialogue-primary"/g)).toHaveLength(1);
    expect(markup.match(/data-testid="cancel-generate"/g)).toHaveLength(1);
    expect(markup).not.toContain('data-testid="agent-voice-input"');
    expect(markup).not.toContain(">Cancel response</button>");

    dialogueFixture.phase = "listening";
    const listening = renderToStaticMarkup(<SetupRail />);
    expect(listening).toContain(">Finish answer</button>");
    expect(listening).toContain("Listening.");
    expect(listening).not.toContain(">Speak your answer</button>");
  });

  it("keeps a single active-run Stop control separate from the non-question Speak button", () => {
    const time = "2026-11-25T12:00:00.000Z";
    dialogueFixture.phase = "idle";
    useVdtStudioStore.setState({ generateActivity: { runId: "run", requestId: "run", status: "running", phase: "waiting_provider",
      phaseStartedAt: time, startedAt: time, updatedAt: time, providerId: "openai_compatible", providerLabel: "OpenAI", appMode: "development_web",
      canCancel: true, cancelRequested: false } });
    const html = renderToStaticMarkup(<SetupRail />);
    expect(html.match(/data-testid="agent-stop-response"/g)).toHaveLength(1);
    expect(html.match(/data-testid="agent-dialogue-primary"/g)).toHaveLength(1);
    expect(html).toContain(">Speak</button>");
    expect(html).not.toContain('data-testid="cancel-generate"');
  });

  it("offers each chat outcome with Automatic selected by default", () => {
    const html = renderToStaticMarkup(<SetupRail />);
    const select = html.match(/<select[^>]*data-testid="agent-chat-outcome"[^>]*>([\s\S]*?)<\/select>/)?.[1];
    expect(select).toContain('<option value="" selected="">Automatic</option>');
    expect(select).toContain('<option value="answer">Answer</option>');
    expect(select).toContain('<option value="structural_model">Build structure</option>');
    expect(select).toContain('<option value="calculated_baseline">Calculate baseline</option>');
  });

  it("reopens a verified structure and updates its checklist from the current tree after editing an input", () => {
    const date = "2026-11-24T10:00:00.000Z";
    const node = (id: string, name: string, fields: Partial<VdtNode> = {}): VdtNode => ({
      id, name, type: "input", unit: "t/h", status: "accepted", aiGenerated: true,
      createdAt: date, updatedAt: date, ...fields
    });
    const verifiedProject = {
      ...structuredClone(productionVolumeProject), id: "project", rootNodeId: "throughput",
      graph: { nodes: [
        node("throughput", "Throughput", { type: "root_kpi", formula: "min(stage_a, stage_b) - loss", assumptions: ["Decomposition assumption: The stages operate in series.\nReconsider if: Either stage can operate independently.\nEvidence: Provisional"] }),
        node("stage_a", "Stage A rate", { valueStatus: "unknown", baselineValue: 88, controllability: "high" }),
        node("stage_b", "Stage B rate", { type: "external_factor", valueStatus: "default_assumption", baselineValue: 90 }),
        node("loss", "Transfer loss", { valueStatus: "user_provided_value", baselineValue: 0 })
      ], edges: [] }
    };
    const runs = new AgentRunStore();
    const { runId } = runs.createRun({
      providerId: "openai", mode: "continue_project", outcome: "structural_model", input: {},
      workspace: { projectId: "workspace", vdtId: "saved_tree" }
    });
    const snapshot = {
      ...runs.getSnapshot(runId), status: "succeeded" as const, project: verifiedProject,
      finishOutcome: {
        state: "final_persisted" as const, outcome: "structural_model" as const, policyVersion: "workspace-v1",
        projectRevision: 1, projectHash: `sha256:${"a".repeat(64)}`,
        missingInputCount: 1, missingInputs: [{ nodeId: "stage_a", nodeName: "Stage A rate", explicit: true, requiredForRoot: true }]
      }
    };
    const state = useVdtStudioStore.getState();
    useVdtStudioStore.setState({
      project: structuredClone(verifiedProject),
      workspace: { ...state.workspace, activeVdtId: "saved_tree", activeProjectId: "workspace" },
      generateActivity: {
        runId, requestId: runId, status: "ready", phase: "ready", phaseStartedAt: date, startedAt: date,
        updatedAt: date, providerId: "openai_compatible", providerLabel: "OpenAI", appMode: "development_web",
        canCancel: false, cancelRequested: false, runtimeAgentRun: snapshot
      }
    });

    const renderReopenedStructure = () => {
      const reopened = useVdtStudioStore.getState();
      const snapshot = reopened.generateActivity?.runtimeAgentRun;
      expect(snapshot?.finishOutcome?.outcome).toBe("structural_model");
      return renderToStaticMarkup(<StructuralOutcome verifiedProject={snapshot!.project!}
        currentProject={reopened.project} onSelectNode={reopened.selectNode} />);
    };
    expect(state.startNewAgentChat()).toBe(true);
    expect(useVdtStudioStore.getState().generateActivity).toBeUndefined();
    expect(state.openAgentChat(runId)).toBe(true);
    let html = renderReopenedStructure();
    expect(html).toContain("min(Stage A rate, Stage B rate) - Transfer loss");
    expect(html).toContain("The stages operate in series.");
    expect(html).toContain("Provisional · Reconsider if Either stage can operate independently.");
    expect(html).toContain("Actionable · high control · Missing measurement · needed for root");
    expect(html).toContain("External factor");
    expect(html).toContain("Illustrative estimate · 90");
    expect(html).toContain('tabular-nums">0</p>');
    expect(html).not.toContain('tabular-nums">88</p>');

    state.selectNode("stage_a");
    state.updateNodeBaselineValue("stage_a", 70);
    expect(state.startNewAgentChat()).toBe(true);
    expect(state.openAgentChat(runId)).toBe(true);
    html = renderReopenedStructure();
    expect(html).toContain('tabular-nums">70</p>');
    expect(html).not.toContain("Missing measurement · needed for root");
    expect(useVdtStudioStore.getState().generateActivity?.runtimeAgentRun?.finishOutcome).toEqual(snapshot.finishOutcome);
  });

  it("shows the welcome panel and the prepared prompts together", () => {
    const prompts = ["Explain the output formula", "Check the missing inputs", "Compare the main drivers"] as const;
    const html = renderToStaticMarkup(<SetupRail starterPrompts={[...prompts]} />);

    expect(html).toContain('data-testid="agent-chat-empty"');
    expect(html).toContain('data-testid="agent-chat-starters"');
    expect(html).toContain("What would you like");
    for (const prompt of prompts) expect(html).toContain(prompt);
  });

  it("names the selected KPI and supports missing units", () => {
    const html = renderToStaticMarkup(<SelectedKpiContext node={{ id: "calendar_time", name: "Calendar Time", unit: "hours/month" }} onClear={() => undefined} />);
    expect(html).toContain('data-testid="agent-selected-kpi"');
    expect(html).toContain('data-node-id="calendar_time"');
    expect(html).toContain("Selected KPI</span>");
    expect(html).toContain("Calendar Time</span>");
    expect(html).toContain("hours/month</span>");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('data-testid="agent-clear-selected-kpi"');
    expect(html).toContain('aria-label="Remove selected KPI from message"');
    expect(html).toContain('type="button"');
    const changed = renderToStaticMarkup(<SelectedKpiContext node={{ id: "unplanned_downtime", name: "Unplanned Downtime", unit: undefined }} onClear={() => undefined} />);
    expect(changed).toContain('data-node-id="unplanned_downtime"');
    expect(changed).toContain("Unplanned Downtime</span>");
    expect(changed).not.toContain('data-node-id="calendar_time"');
  });

  it("omits the context indicator when there is no selected node", () => {
    expect(renderToStaticMarkup(<SelectedKpiContext node={undefined} onClear={() => undefined} />)).toBe("");
  });

  it("names the default web-search mode and makes unconfigured model setup explicit", () => {
    const html = renderToStaticMarkup(<SetupRail />);

    expect(html).toContain('data-testid="agent-context-menu-toggle"');
    expect(html).toContain('aria-label="Add context"');
    expect(html).not.toContain('data-testid="data-import-attachment-button"');
    expect(html).not.toContain('data-testid="data-import-wizard"');
    expect(html).toContain('data-testid="agent-research-mode-toggle"');
    expect(html).toContain('data-research-mode="auto"');
    expect(html).toContain("Let the agent search when it needs more context.");
    expect(html).toContain("<span>Auto</span>");
    expect(html).toContain("Setup needed");
    expect(html).toContain("max-h-[min(40vh,20rem)]");
    expect(html).toContain('data-testid="agent-instruction-input"');
    expect(html).toContain('aria-label="Message VDT Agent"');
    expect(html).not.toContain('label="Period"');
    expect(html).not.toContain(">Period<");
  });

  it("distinguishes configured API settings from live CLI checks without claiming a tested API connection", () => {
    expect(describeComposerReadiness(undefined, true)).toEqual({
      state: "ready", label: "Ready to send", message: "Provider settings are configured. Connection and model access are checked when a request starts."
    });
    expect(describeComposerReadiness(undefined, false)).toMatchObject({ state: "warning", label: "Setup needed" });
    const checking = { state: "checking" as const, canExecute: false, label: "Connecting…", message: "Checking chat availability for the selected model." };
    expect(describeComposerReadiness(checking, false)).toBe(checking);
  });

  it("shows only the model and colored status dot on the model button", () => {
    const html = renderToStaticMarkup(<ComposerModelPicker modelLabel="gpt-test" providerLabel="Codex CLI"
      readiness={{ state: "ready", label: "Chat ready", message: "Connected" }} locked={false} onOpenSettings={() => undefined} />);
    const button = html.match(/<button[^>]*data-testid="execution-mode-configure"[^>]*>([\s\S]*?)<\/button>/)?.[1];
    expect(button).toContain('data-testid="execution-mode-status-dot"');
    expect(button).toContain("gpt-test");
    expect(button).not.toContain("Ready to send");
    expect(button).not.toContain("Chat ready");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-label="Choose model.');
  });

  it.each([
    { state: "checking" as const, expectedClass: "bg-slate-400" },
    { state: "ready" as const, expectedClass: "bg-emerald-500" },
    { state: "warning" as const, expectedClass: "bg-amber-500" },
    { state: "not_installed" as const, expectedClass: "bg-red-500" }
  ])("renders the $state readiness color", ({ state, expectedClass }) => {
    const html = renderToStaticMarkup(<ExecutionReadinessDot state={state} />);

    expect(html).toContain(`data-readiness="${state}"`);
    expect(html).toContain(expectedClass);
  });

  it("adds scroll padding for retryable errors in the activity scroll region", () => {
    expect(agentActivityScrollClassName(false)).toBe("min-h-0 flex-1 overflow-auto px-4 py-4");
    expect(agentActivityScrollClassName(true)).toContain("pb-48");
    expect(agentActivityScrollClassName(true)).toContain("overflow-auto");
  });

  it("separates the selected web mode from missing provider setup, and never marks Off as unavailable", () => {
    const status = { providerConfigured: false as const, providerId: "noop" };
    expect(researchModeTooltip("on", status)).toBe(
      "Use web search for missing or current information. Search provider is not configured."
    );
    expect(researchModeTooltip("auto", status)).toContain("Search provider is not configured.");
    expect(researchModeTooltip("off", status)).toBe("Web search is off. Do not search the web.");
    const off = renderToStaticMarkup(<WebSearchControl mode="off" status={status} onChange={() => undefined} />);
    const on = renderToStaticMarkup(<WebSearchControl mode="on" status={status} onChange={() => undefined} />);
    expect(off).toContain('aria-label="Web search: Off"');
    expect(off).not.toContain("needs setup");
    expect(on).toContain('aria-label="Web search: On — needs setup"');
    expect(on).toContain("<span>On</span>");
    expect(researchModeTooltip("on", { ...status, checkFailed: true })).toContain("availability could not be checked");
  });

  it("keeps retry controls inside the scroll region when activity has a retryable error", () => {
    const html = renderToStaticMarkup(
      <section className={agentActivityScrollClassName(true)} data-testid="agent-activity-scroll">
        <GenerateActivityPanel
          activity={{
            runId: "agent-run-retryable",
            requestId: "backend-request-retryable",
            status: "needs_user_input",
            phase: "waiting_provider",
            phaseStartedAt: "2026-06-24T10:00:00.000Z",
            startedAt: "2026-06-24T10:00:00.000Z",
            updatedAt: "2026-06-24T10:00:05.000Z",
            providerId: "local_runner",
            providerLabel: "Cursor Agent",
            appMode: "development_web",
            canCancel: true,
            cancelRequested: false,
            retryableError: {
              code: "TIMEOUT",
              message: "The agent step timed out before finishing.",
              retryCount: 1,
              createdAt: "2026-06-24T10:00:05.000Z"
            }
          }}
          onCancel={() => undefined}
          onAnswer={() => undefined}
        />
      </section>
    );

    expect(html).toContain('data-testid="agent-activity-scroll"');
    expect(html).toContain("pb-48");
    expect(html).toContain('data-testid="agent-retryable-error"');
    expect(html).toContain('data-testid="continue-agent-smaller-step"');
  });
});
