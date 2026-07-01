"use client";

import { useEffect, useState } from "react";
import { Check, CircleAlert, History, MessageSquarePlus, Search, Send, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, TextArea, TextInput } from "@/components/ui/field";
import { Panel, PanelCollapseTab, PanelToggleButton, PanelHeader } from "@/components/ui/panel";
import { hasByokFieldErrors, validateByokSettings } from "@/lib/byok-validation";
import { formatExecutionModeSummary } from "@/lib/format-execution-summary";
import { resolveExecutionSettings } from "@/lib/execution-mode-resolver";
import { useDesktopLayout } from "@/lib/use-desktop-layout";
import { useVdtStudioStore } from "./vdt-store";
import { GenerateActivityPanel } from "./generate-activity-panel";
import { SettingsModal } from "./settings-modal";
import type { AgentChatHistoryEntry } from "./vdt-store";
import type { ResearchMode } from "@/lib/agent-client";

interface ResearchStatus {
  providerConfigured: boolean;
  providerId: "brave" | "tavily" | "noop" | string;
}

const RESEARCH_MODES: ResearchMode[] = ["auto", "on", "off"];

const RESEARCH_MODE_TOOLTIP: Record<ResearchMode, string> = {
  auto: "Agent may search when local skills are not enough.",
  on: "Agent should use research for unknown/current process context.",
  off: "Agent will not use web research."
};

function nextResearchMode(mode: ResearchMode): ResearchMode {
  return RESEARCH_MODES[(RESEARCH_MODES.indexOf(mode) + 1) % RESEARCH_MODES.length] ?? "auto";
}

function researchModeTooltip(mode: ResearchMode, status: ResearchStatus | undefined): string {
  const base = RESEARCH_MODE_TOOLTIP[mode];
  if (mode !== "off" && status?.providerConfigured === false) {
    return `${base} Research provider is not configured.`;
  }
  return base;
}

function chatStatusLabel(status: AgentChatHistoryEntry["status"]) {
  switch (status) {
    case "needs_user_input":
      return "Waiting";
    case "ready":
      return "Ready";
    case "error":
      return "Error";
    case "cancelled":
      return "Cancelled";
    case "running":
      return "Running";
  }
}

function formatChatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function SetupRail() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [instructionText, setInstructionText] = useState("");
  const [researchMode, setResearchMode] = useState<ResearchMode>("auto");
  const [researchStatus, setResearchStatus] = useState<ResearchStatus | undefined>();
  const brief = useVdtStudioStore((state) => state.brief);
  const executionSettings = useVdtStudioStore((state) => state.executionSettings);
  const isGenerating = useVdtStudioStore((state) => state.isGenerating);
  const isRunningAiAction = useVdtStudioStore((state) => state.isRunningAiAction);
  const generateActivity = useVdtStudioStore((state) => state.generateActivity);
  const agentChatHistory = useVdtStudioStore((state) => state.agentChatHistory);
  const pendingChangeSet = useVdtStudioStore((state) => state.pendingChangeSet);
  const changeSetSelection = useVdtStudioStore((state) => state.changeSetSelection);
  const aiError = useVdtStudioStore((state) => state.aiError);
  const leftPanelCollapsed = useVdtStudioStore((state) => state.ui.leftPanelCollapsed);
  const isDesktop = useDesktopLayout();
  const showCollapsed = isDesktop && leftPanelCollapsed;
  const selectedNodeId = useVdtStudioStore((state) => state.selectedNodeId);
  const setBriefField = useVdtStudioStore((state) => state.setBriefField);
  const startAgentRun = useVdtStudioStore((state) => state.startAgentRun);
  const startNewAgentChat = useVdtStudioStore((state) => state.startNewAgentChat);
  const openAgentChat = useVdtStudioStore((state) => state.openAgentChat);
  const sendAgentAnswers = useVdtStudioStore((state) => state.sendAgentAnswers);
  const sendAgentApproval = useVdtStudioStore((state) => state.sendAgentApproval);
  const sendAgentInstruction = useVdtStudioStore((state) => state.sendAgentInstruction);
  const cancelGenerate = useVdtStudioStore((state) => state.cancelGenerate);
  const applyPendingChangeSet = useVdtStudioStore((state) => state.applyPendingChangeSet);
  const discardPendingChangeSet = useVdtStudioStore((state) => state.discardPendingChangeSet);
  const toggleLeftPanel = useVdtStudioStore((state) => state.toggleLeftPanel);
  const executionSummary = formatExecutionModeSummary(executionSettings);
  const resolvedExecution = resolveExecutionSettings(executionSettings);
  const canRunDeepenAction = resolvedExecution.providerId !== "mock";
  const byokValidationBlocked = executionSettings.executionMode === "byok" &&
    hasByokFieldErrors(validateByokSettings(executionSettings));
  const canUseConfiguredRuntime = canRunDeepenAction && !byokValidationBlocked;
  const pendingChangeCount = pendingChangeSet
    ? pendingChangeSet.additions.length +
      pendingChangeSet.updates.length +
      pendingChangeSet.deletions.length +
      pendingChangeSet.edgeChanges.length
    : 0;
  const canContinueCurrentAgentRun = generateActivity?.status === "running" ||
    generateActivity?.status === "needs_user_input";
  const canSendInstruction =
    instructionText.trim().length > 0 &&
    !isRunningAiAction &&
    canUseConfiguredRuntime &&
    (!isGenerating || Boolean(generateActivity));
  const canStartNewChat = Boolean(generateActivity);
  const researchUnavailable = researchMode !== "off" && researchStatus?.providerConfigured === false;
  const researchTooltip = researchModeTooltip(researchMode, researchStatus);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/agent/research/status")
      .then(async (response) => {
        if (!response.ok) throw new Error("Research status could not be loaded.");
        return await response.json() as ResearchStatus;
      })
      .then((status) => {
        if (!cancelled) setResearchStatus(status);
      })
      .catch(() => {
        if (!cancelled) setResearchStatus({ providerConfigured: false, providerId: "noop" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submitAgentInstruction() {
    const text = instructionText.trim();
    if (!text || isRunningAiAction) return;
    if (!canUseConfiguredRuntime) return;
    if (!canContinueCurrentAgentRun) {
      const accepted = await startAgentRun(text, { researchMode });
      if (accepted) setInstructionText("");
      return;
    }
    const accepted = await sendAgentInstruction(text, selectedNodeId, researchMode);
    if (!accepted) return;
    setInstructionText("");
  }

  if (showCollapsed) {
    return (
      <PanelCollapseTab
        label="Setup"
        panel="left"
        testId="collapse-left-panel"
        expandTestId="expand-left-panel"
        onToggle={toggleLeftPanel}
      />
    );
  }

  return (
    <Panel className="flex h-full min-h-0 flex-col border-r">
      <PanelHeader
        title="VDT Agent"
        action={
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              icon={<MessageSquarePlus className="h-3.5 w-3.5" />}
              disabled={!canStartNewChat}
              onClick={() => {
                const accepted = startNewAgentChat();
                if (accepted) setHistoryOpen(false);
              }}
              data-testid="agent-new-chat"
              title="Start new chat"
            >
              New
            </Button>
            <Button
              type="button"
              size="icon"
              variant={historyOpen ? "secondary" : "ghost"}
              icon={<History className="h-4 w-4" />}
              onClick={() => setHistoryOpen((open) => !open)}
              data-testid="agent-chat-history-toggle"
              title="Chat history"
              aria-label="Chat history"
            />
            <PanelToggleButton
              panel="left"
              testId="collapse-left-panel"
              onToggle={toggleLeftPanel}
            />
          </div>
        }
      />
      <section className="space-y-3 border-b border-line px-4 py-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-normal text-muted">Current brief</p>
          <p className="mt-1 truncate text-sm font-semibold text-ink">{brief.rootKpi || "Untitled VDT"}</p>
        </div>

        <div className="space-y-2">
          <Field label="Root KPI">
            <TextInput
              className="py-2"
              value={brief.rootKpi}
              onChange={(event) => setBriefField("rootKpi", event.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Unit">
              <TextInput
                className="py-2"
                value={brief.unit ?? ""}
                onChange={(event) => setBriefField("unit", event.target.value)}
              />
            </Field>
            <Field label="Period">
              <TextInput
                className="py-2"
                value={brief.timePeriod ?? ""}
                onChange={(event) => setBriefField("timePeriod", event.target.value)}
              />
            </Field>
          </div>
        </div>
      </section>

      <div className="flex min-h-0 flex-1 flex-col">
        <section className="min-h-0 flex-1 overflow-auto px-4 py-4">
          <div className="space-y-3">
            {historyOpen ? (
              <section className="space-y-2" data-testid="agent-chat-history">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-xs font-semibold uppercase tracking-normal text-muted">Chat history</h3>
                  <span className="text-xs text-muted">{agentChatHistory.length}</span>
                </div>
                {agentChatHistory.length > 0 ? (
                  <div className="space-y-2">
                    {agentChatHistory.map((entry) => {
                      const active = entry.runId === generateActivity?.runId;
                      return (
                        <button
                          type="button"
                          key={entry.runId}
                          className={[
                            "w-full rounded-md border px-3 py-2 text-left transition",
                            active ? "border-accent bg-blue-50" : "border-line bg-white hover:bg-slate-50"
                          ].join(" ")}
                          onClick={() => {
                            const opened = openAgentChat(entry.runId);
                            if (opened) setHistoryOpen(false);
                          }}
                          data-testid={`agent-chat-history-item-${entry.runId}`}
                        >
                          <div className="truncate text-sm font-semibold text-ink">{entry.title}</div>
                          <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
                            <span>{chatStatusLabel(entry.status)} - {entry.messageCount} messages</span>
                            <span className="shrink-0">{formatChatTime(entry.updatedAt)}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-md border border-line bg-slate-50 px-3 py-3 text-sm text-muted">
                    No previous chats yet.
                  </div>
                )}
              </section>
            ) : null}

            {generateActivity ? (
              <GenerateActivityPanel
                activity={generateActivity}
                onCancel={cancelGenerate}
                onAnswer={(answers) => void sendAgentAnswers(answers)}
                onApproval={(approved, selectedChangeIds) => void sendAgentApproval(approved, selectedChangeIds)}
              />
            ) : null}

            {pendingChangeSet ? (
              <div className="mt-3 rounded-md border border-emerald-200 bg-white p-3" data-testid="agent-patch-ready">
                <div className="text-xs font-semibold uppercase tracking-normal text-emerald-700">Patch ready</div>
                <p className="mt-1 text-sm leading-5 text-ink">
                  AI prepared {pendingChangeCount} graph change{pendingChangeCount === 1 ? "" : "s"}. Review or apply them.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Check className="h-4 w-4" />}
                    disabled={isRunningAiAction || changeSetSelection.size === 0}
                    onClick={applyPendingChangeSet}
                  >
                    Apply
                  </Button>
                  <Button
                    size="sm"
                    icon={<X className="h-4 w-4" />}
                    disabled={isRunningAiAction}
                    onClick={discardPendingChangeSet}
                  >
                    Discard
                  </Button>
                </div>
              </div>
            ) : null}

            {aiError ? (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm leading-5 text-red-700">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{aiError}</span>
              </div>
            ) : null}
          </div>
        </section>

        <form
          className="border-t border-line bg-white px-4 py-3"
          data-testid="agent-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void submitAgentInstruction();
          }}
        >
          <TextArea
            className="min-h-24 resize-none rounded-md border-line bg-white p-3 text-sm leading-6 shadow-none focus:bg-white"
            value={instructionText}
            onChange={(event) => setInstructionText(event.target.value)}
            placeholder="Describe the situation, data, constraints, and what to do next..."
            data-testid="agent-instruction-input"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              className={[
                "flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-slate-50 px-2.5 text-left transition",
                "hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              ].join(" ")}
              onClick={() => setSettingsOpen(true)}
              data-testid="execution-mode-configure"
              aria-label="Configure execution mode"
            >
              <span
                className={[
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  canUseConfiguredRuntime ? "bg-emerald-500" : "bg-amber-500"
                ].join(" ")}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate" data-testid="execution-mode-summary">
                <span className="truncate text-xs font-semibold text-ink">{executionSummary.primary}</span>
                <span className="ml-1 truncate text-[11px] text-muted">
                  {executionSummary.secondary ?? executionSummary.modeLabel}
                </span>
              </span>
              <Settings2 className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
            </button>
            <Button
              type="button"
              className={[
                "h-9 w-9 shrink-0",
                researchMode === "on" ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "",
                researchMode === "off" ? "border-slate-200 bg-slate-50 text-slate-400 hover:bg-slate-100" : "",
                researchUnavailable ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100" : ""
              ].filter(Boolean).join(" ")}
              size="icon"
              variant="secondary"
              icon={<Search className="h-4 w-4" />}
              onClick={() => setResearchMode((mode) => nextResearchMode(mode))}
              title={researchTooltip}
              aria-label={`Search ${researchMode}`}
              data-testid="agent-research-mode-toggle"
              data-research-mode={researchMode}
              data-provider-configured={researchStatus?.providerConfigured ?? "unknown"}
            />
            <Button
              type="submit"
              className="h-9 shrink-0 px-3"
              size="sm"
              variant="primary"
              icon={<Send className="h-4 w-4" />}
              disabled={!canSendInstruction}
              data-testid="agent-send-instruction"
            >
              Send
            </Button>
          </div>
        </form>
      </div>
      <SettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initialSection="execution"
        hideTrigger
      />
    </Panel>
  );
}
