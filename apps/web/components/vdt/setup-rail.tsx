"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ArrowUpRight, Check, ChevronDown, CircleAlert, GitBranch, History, LoaderCircle, MessageSquarePlus, Mic, Plus, SlidersHorizontal, Sparkles, Square, X } from "lucide-react";
import { clsx } from "clsx";
import { Button } from "@/components/ui/button";
import { DataImportAttachmentButton } from "@/components/data-import/data-import-attachment-button";
import { Field, TextArea, TextInput } from "@/components/ui/field";
import { Panel, PanelCollapseTab, PanelToggleButton } from "@/components/ui/panel";
import { hasByokFieldErrors, validateByokSettings } from "@/lib/byok-validation";
import type { CliRequestReadiness, CliRequestReadinessState } from "@/lib/cli-readiness";
import { formatExecutionModeSummary } from "@/lib/format-execution-summary";
import { resolveExecutionSettings } from "@/lib/execution-mode-resolver";
import { useDesktopLayout } from "@/lib/use-desktop-layout";
import { filterAgentChatHistoryForVdt, shouldContinueOpenVdt, useVdtStudioStore } from "./vdt-store";
import { GenerateActivityPanel } from "./generate-activity-panel";
import { SettingsModal } from "./settings-modal";
import type { SettingsSectionId } from "./settings-nav";
import { useSpeechSettings } from "./speech-store";
import { useVoiceDictation } from "./use-voice-dictation";
import { VoiceInputStatus } from "./voice-input-status";
import { WebSearchControl, type ResearchStatus } from "./web-search-control";
import { useCliChatReadiness } from "./use-cli-chat-readiness";
import type { AgentChatHistoryEntry } from "./vdt-store";
import type { ResearchMode } from "@/lib/agent-client";
import styles from "./agent-chat.module.css";

function chatStatusLabel(status: AgentChatHistoryEntry["status"]) {
  switch (status) {
    case "needs_user_input":
      return "Waiting";
    case "recovery_required":
      return "Recoverable";
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

export function agentActivityScrollClassName(hasRetryableError: boolean): string {
  return clsx(
    "min-h-0 flex-1 overflow-auto px-4 py-4",
    hasRetryableError && "pb-48"
  );
}

export function ExecutionReadinessDot({ state }: { state: CliRequestReadinessState }) {
  const statusClass = {
    checking: "bg-slate-400",
    ready: "bg-emerald-500",
    warning: "bg-amber-500",
    not_installed: "bg-red-500"
  }[state];

  return (
    <span
      className={["h-1.5 w-1.5 shrink-0 rounded-full", statusClass].join(" ")}
      data-testid="execution-mode-status-dot"
      data-readiness={state}
      aria-hidden="true"
    />
  );
}

export function describeComposerReadiness(cliReadiness: CliRequestReadiness | undefined, configured: boolean): Pick<CliRequestReadiness, "state" | "label" | "message"> {
  if (cliReadiness) return cliReadiness;
  return configured
    ? { state: "ready", label: "Ready to send", message: "Provider settings are configured. Connection and model access are checked when a request starts." }
    : { state: "warning", label: "Setup needed", message: "Configure a provider before sending requests." };
}

export function SetupRail() {
  const hasRequestedCliScan = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>("execution");
  const [confirmSpeechDownload, setConfirmSpeechDownload] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [instructionText, setInstructionText] = useState("");
  const instructionInputRef = useRef<HTMLTextAreaElement>(null);
  const briefRef = useRef<HTMLDetailsElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuButtonRef = useRef<HTMLButtonElement>(null);
  const activityScrollRef = useRef<HTMLElement>(null);
  const followConversationRef = useRef(true);
  const [researchMode, setResearchMode] = useState<ResearchMode>("auto");
  const [researchStatus, setResearchStatus] = useState<ResearchStatus | undefined>();
  const brief = useVdtStudioStore((state) => state.brief);
  const executionSettings = useVdtStudioStore((state) => state.executionSettings);
  const cliDetectionAgents = useVdtStudioStore((state) => state.cliDetectionAgents);
  const cliDetectionError = useVdtStudioStore((state) => state.cliDetectionError);
  const isRescanningClis = useVdtStudioStore((state) => state.isRescanningClis);
  const isGenerating = useVdtStudioStore((state) => state.isGenerating);
  const generateActivity = useVdtStudioStore((state) => state.generateActivity);
  const agentChatHistory = useVdtStudioStore((state) => state.agentChatHistory);
  const activeVdtId = useVdtStudioStore((state) => state.workspace.activeVdtId);
  const speech = useSpeechSettings();
  const voice = useVoiceDictation(setInstructionText, activeVdtId);
  const scopedAgentChatHistory = useMemo(
    () => filterAgentChatHistoryForVdt(agentChatHistory, activeVdtId),
    [agentChatHistory, activeVdtId]
  );
  const pendingChangeSet = useVdtStudioStore((state) => state.pendingChangeSet);
  const changeSetSelection = useVdtStudioStore((state) => state.changeSetSelection);
  const aiError = useVdtStudioStore((state) => state.aiError);
  const aiActionError = useVdtStudioStore((state) => state.aiActionError);
  const leftPanelCollapsed = useVdtStudioStore((state) => state.ui.leftPanelCollapsed);
  const isDesktop = useDesktopLayout();
  const showCollapsed = isDesktop && leftPanelCollapsed;
  const selectedNodeId = useVdtStudioStore((state) => state.selectedNodeId);
  const setBriefField = useVdtStudioStore((state) => state.setBriefField);
  const rescanClis = useVdtStudioStore((state) => state.rescanClis);
  const startAgentRun = useVdtStudioStore((state) => state.startAgentRun);
  const startNewAgentChat = useVdtStudioStore((state) => state.startNewAgentChat);
  const openAgentChat = useVdtStudioStore((state) => state.openAgentChat);
  const sendAgentAnswers = useVdtStudioStore((state) => state.sendAgentAnswers);
  const continueAgentRun = useVdtStudioStore((state) => state.continueAgentRun);
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
  const cliReadiness = useCliChatReadiness(executionSettings, cliDetectionAgents, {
    isScanning: isRescanningClis,
    detectionError: cliDetectionError
  });
  const canUseConfiguredRuntime =
    canRunDeepenAction &&
    !byokValidationBlocked &&
    (cliReadiness?.canExecute ?? true);
  const { state: executionReadinessState, label: executionReadinessLabel, message: executionReadinessMessage } = describeComposerReadiness(cliReadiness, canUseConfiguredRuntime);
  const pendingChangeCount = pendingChangeSet
    ? pendingChangeSet.additions.length +
      pendingChangeSet.updates.length +
      pendingChangeSet.deletions.length +
      pendingChangeSet.edgeChanges.length +
      (pendingChangeSet.dataSourceChanges?.length ?? 0) +
      (pendingChangeSet.dataMappingChanges?.length ?? 0) +
      (pendingChangeSet.taxonomyChanges?.length ?? 0)
    : 0;
  const canContinueCurrentAgentRun = generateActivity?.status === "running" ||
    generateActivity?.status === "needs_user_input";
  const canSendInstruction =
    !voice.active &&
    instructionText.trim().length > 0 &&
    canUseConfiguredRuntime &&
    (!isGenerating || Boolean(generateActivity));
  const canStartNewChat = Boolean(generateActivity);
  const hasRetryableError = Boolean(generateActivity?.retryableError);
  const modelLabel = executionSummary.secondary ?? executionSummary.primary;
  const canStopResponse = generateActivity?.status === "running" && !instructionText.trim() && !voice.active;
  const latestChatMessage = generateActivity?.agentChatMessages?.at(-1);

  useEffect(() => {
    if (!contextMenuOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!contextMenuRef.current?.contains(event.target as Node)) setContextMenuOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setContextMenuOpen(false);
      contextMenuButtonRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenuOpen]);

  useEffect(() => {
    followConversationRef.current = true;
  }, [generateActivity?.runId]);

  useEffect(() => {
    const scroll = activityScrollRef.current;
    if (scroll && followConversationRef.current && !historyOpen) scroll.scrollTop = scroll.scrollHeight;
  }, [generateActivity?.runId, latestChatMessage?.id, latestChatMessage?.text, generateActivity?.publicStatus?.message, historyOpen]);

  useEffect(() => {
    const el = instructionInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [instructionText]);

  useEffect(() => {
    if (
      cliReadiness &&
      cliDetectionAgents === undefined &&
      !isRescanningClis &&
      !cliDetectionError &&
      !hasRequestedCliScan.current
    ) {
      hasRequestedCliScan.current = true;
      void rescanClis();
    }
  }, [cliDetectionAgents, cliDetectionError, cliReadiness, isRescanningClis, rescanClis]);

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
        if (!cancelled) setResearchStatus({ providerConfigured: false, providerId: "noop", checkFailed: true });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submitAgentInstruction() {
    const text = instructionText.trim();
    if (!canSendInstruction) return;
    followConversationRef.current = true;
    if (!canContinueCurrentAgentRun) {
      const shouldContinue = shouldContinueOpenVdt(useVdtStudioStore.getState());
      const accepted = await startAgentRun(text, {
        researchMode,
        ...(shouldContinue ? { mode: "continue_project", includeCurrentProject: true } : {})
      });
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
    <Panel className={clsx("flex h-full min-h-0 flex-col border-r", styles.panel)} data-testid="agent-chat-panel" aria-label="VDT Agent chat">
      <header className={styles.header}>
        <div className={styles.title}>
          <span className={styles.agentMark}><GitBranch size={15} aria-hidden="true" /></span>
          <h2>VDT Agent</h2>
        </div>
          <div className={styles.headerActions}>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={styles.iconButton}
              icon={<MessageSquarePlus className="h-4 w-4" />}
              disabled={!canStartNewChat}
              onClick={() => {
                voice.onManualEdit();
                const accepted = startNewAgentChat();
                if (accepted) { setHistoryOpen(false); instructionInputRef.current?.focus(); }
              }}
              data-testid="agent-new-chat"
              title="Start new chat"
              aria-label="Start new chat"
            />
            <Button
              type="button"
              size="icon"
              variant={historyOpen ? "secondary" : "ghost"}
              className={clsx(styles.iconButton, historyOpen && styles.iconButtonActive)}
              icon={<History className="h-4 w-4" />}
              onClick={() => setHistoryOpen((open) => !open)}
              data-testid="agent-chat-history-toggle"
              title="Chat history"
              aria-label="Chat history"
              aria-expanded={historyOpen}
            />
            <PanelToggleButton
              panel="left"
              testId="collapse-left-panel"
              onToggle={toggleLeftPanel}
              className={styles.iconButton}
            />
          </div>
      </header>
      <details ref={briefRef} className={styles.brief} data-testid="agent-model-context">
        <summary className={styles.briefSummary}>
          <SlidersHorizontal size={13} aria-hidden="true" />
          <span className={styles.contextLabel}>Context</span>
          <span className={styles.contextKpi}>{brief.rootKpi || "Untitled VDT"}</span>
          <ChevronDown size={13} className={styles.disclosureChevron} aria-hidden="true" />
        </summary>
        <div className={styles.briefFields}>
          <div className={styles.briefRow}>
            <Field label="Root KPI">
              <TextInput
                className="!py-1.5"
                value={brief.rootKpi}
                onChange={(event) => setBriefField("rootKpi", event.target.value)}
              />
            </Field>
            <Field label="Unit">
              <TextInput
                className="!py-1.5"
                value={brief.unit ?? ""}
                onChange={(event) => setBriefField("unit", event.target.value)}
              />
            </Field>
          </div>
        </div>
      </details>

      <div className="flex min-h-0 flex-1 flex-col">
        <section
          ref={activityScrollRef}
          className={clsx(agentActivityScrollClassName(hasRetryableError), styles.scroll, hasRetryableError && styles.retryScroll)}
          data-testid="agent-activity-scroll"
          onScroll={(event) => {
            const scroll = event.currentTarget;
            followConversationRef.current = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80;
          }}
        >
          <div className={styles.conversation}>
            {historyOpen ? (
              <section className={styles.history} data-testid="agent-chat-history">
                <div className="flex items-center justify-between gap-3">
                  <h3 className={styles.sectionLabel}>Recent conversations <span className="ml-1 font-normal">{scopedAgentChatHistory.length}</span></h3>
                  <button type="button" className={styles.iconButton} aria-label="Close chat history" onClick={() => setHistoryOpen(false)}><X size={14} /></button>
                </div>
                {scopedAgentChatHistory.length > 0 ? (
                  <div className="space-y-2">
                    {scopedAgentChatHistory.map((entry) => {
                      const active = entry.runId === generateActivity?.runId;
                      return (
                        <button
                          type="button"
                          key={entry.runId}
                          className={clsx(styles.historyItem, active && styles.historyItemActive)}
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

            {!generateActivity && !historyOpen ? (
              <div className={styles.emptyState} data-testid="agent-chat-empty">
                <span className={styles.welcomeMark}><Sparkles size={22} strokeWidth={1.5} aria-hidden="true" /></span>
                <p className={styles.emptyEyebrow}>A little clarity goes a long way</p>
                <h3>What would you like<br />to explore?</h3>
                <p className={styles.emptyDescription}>Turn your questions and data into<br />a clearer picture of what drives results.</p>
                <div className={styles.suggestions}>
                  {[
                    { label: "Break down this KPI", text: "Help me break down the current KPI into its main drivers." },
                    { label: "Explore my project data", text: "Help me understand which project data can support this model." },
                    { label: "Review the model", text: "Review the current model and suggest improvements." }
                  ].map((suggestion) => (
                    <button type="button" key={suggestion.label} onClick={() => {
                      voice.onManualEdit();
                      setInstructionText(suggestion.text);
                      instructionInputRef.current?.focus();
                    }}>
                      <span>{suggestion.label}</span><ArrowUpRight size={14} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {generateActivity ? (
              <GenerateActivityPanel
                activity={generateActivity}
                onCancel={cancelGenerate}
                onAnswer={(answers) => void sendAgentAnswers(answers)}
                onContinueRun={() => void continueAgentRun()}
                onApproval={(approved, selectedChangeIds, proposalId) => void sendAgentApproval(
                  approved,
                  selectedChangeIds,
                  proposalId
                )}
              />
            ) : null}

            {pendingChangeSet ? (
              <div className={clsx("mt-3 border border-neutral-200 bg-white p-3", styles.actionCard)} data-testid="agent-patch-ready">
                <div className="text-xs font-semibold uppercase tracking-normal text-neutral-700">Patch ready</div>
                <p className="mt-1 text-sm leading-5 text-ink">
                  AI prepared {pendingChangeCount} graph change{pendingChangeCount === 1 ? "" : "s"}. Review or apply them.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Check className="h-4 w-4" />}
                    disabled={changeSetSelection.size === 0}
                    onClick={applyPendingChangeSet}
                  >
                    Apply
                  </Button>
                  <Button
                    size="sm"
                    icon={<X className="h-4 w-4" />}
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
            {aiActionError ? (
              <div role="alert" className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm leading-5 text-red-700">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{aiActionError}</span>
              </div>
            ) : null}
          </div>
        </section>

        <div className={styles.composerDock}>
        <form
          className={styles.composer}
          data-testid="agent-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void submitAgentInstruction();
          }}
        >
          <VoiceInputStatus state={voice.state} error={voice.error} audio={voice.audio} recognizing={voice.recognizing} onStop={() => { void voice.stop(); }} onCancel={voice.cancel} onDismiss={voice.clearError} />
          <TextArea
            ref={instructionInputRef}
            rows={3}
            className={clsx("max-h-[min(40vh,20rem)]", styles.input)}
            value={instructionText}
            onChange={(event) => { voice.onManualEdit(); setInstructionText(event.target.value); }}
            placeholder="Ask anything about your model…"
            aria-label="Message VDT Agent"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submitAgentInstruction();
              }
            }}
            data-testid="agent-instruction-input"
          />
          <div className={styles.composerToolbar}>
            <div className={styles.composerTools}>
              <div ref={contextMenuRef} className={styles.contextMenu}>
                <button
                  ref={contextMenuButtonRef}
                  type="button"
                  className={clsx(styles.toolButton, contextMenuOpen && styles.toolButtonActive)}
                  aria-label="Add context"
                  title="Add context"
                  aria-expanded={contextMenuOpen}
                  aria-controls="agent-context-menu"
                  onClick={() => setContextMenuOpen((open) => !open)}
                  data-testid="agent-context-menu-toggle"
                ><Plus size={18} strokeWidth={1.7} aria-hidden="true" /></button>
                {contextMenuOpen ? (
                  <div id="agent-context-menu" className={styles.contextPopover} role="group" aria-label="Add context">
                    <p className={styles.sectionLabel}>Add to your conversation</p>
                    <DataImportAttachmentButton className={clsx(styles.menuItem)} label="Attach a file" onAttach={() => {
                      setContextMenuOpen(false);
                      contextMenuButtonRef.current?.focus();
                    }} />
                    <button type="button" className={styles.menuItem} onClick={() => {
                      setContextMenuOpen(false);
                      if (briefRef.current) {
                        briefRef.current.open = true;
                        briefRef.current.querySelector("input")?.focus();
                      }
                    }}><SlidersHorizontal size={16} aria-hidden="true" />Edit model context</button>
                  </div>
                ) : null}
              </div>
              <WebSearchControl mode={researchMode} status={researchStatus} onChange={setResearchMode} />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className={clsx(styles.toolButton, voice.state === "listening" && styles.recordingButton)}
                disabled={voice.state === "starting" || voice.state === "finishing" || (!voice.active && (speech.installing || speech.status?.supported === false))}
                aria-label={voice.active ? "Stop dictation" : speech.ready ? "Start local dictation" : "Set up voice input"}
                aria-pressed={voice.active}
                title={speech.installing ? "Downloading the speech model…" : voice.active ? "Stop dictation and review the text" : speech.ready ? "Dictate locally into the chat draft" : "Download a model to enable local voice input"}
                data-testid="agent-voice-input"
                data-voice-ready={speech.ready}
                data-voice-state={voice.state}
                onClick={() => {
                  if (voice.active) { void voice.stop(); return; }
                  if (!speech.ready) {
                    setSettingsSection("voice"); setConfirmSpeechDownload(true); setSettingsOpen(true); return;
                  }
                  const input = instructionInputRef.current;
                  void voice.start(instructionText, input?.selectionStart ?? instructionText.length, input?.selectionEnd ?? instructionText.length, speech.modelId, speech.language);
                }}
                icon={voice.state === "starting" || voice.state === "finishing" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : voice.state === "listening" ? <Square className="h-3.5 w-3.5 fill-current" /> : <Mic className="h-4 w-4" />}
              />
            </div>
            <div className={styles.composerActions}>
              <button
                type="button"
                className={styles.modelButton}
                onClick={() => { setSettingsSection("execution"); setConfirmSpeechDownload(false); setSettingsOpen(true); }}
                data-testid="execution-mode-configure"
                aria-label={`Configure execution mode. ${executionSummary.primary}: ${executionReadinessLabel}`}
                title={`${executionSummary.primary} · ${executionReadinessLabel}. ${executionReadinessMessage}`}
              >
                <ExecutionReadinessDot state={executionReadinessState} />
                <span className={styles.modelCopy}><span className={styles.modelName} data-testid="execution-mode-summary">{modelLabel}</span><span className={styles.modelState}>{executionReadinessLabel}</span></span>
                <ChevronDown size={12} className="shrink-0" aria-hidden="true" />
              </button>
              {canStopResponse ? (
                <button type="button" className={styles.sendButton} aria-label="Stop response" title="Stop response" disabled={!generateActivity.canCancel || generateActivity.cancelRequested} onClick={cancelGenerate} data-testid="agent-stop-response">
                  {generateActivity.cancelRequested ? <LoaderCircle size={16} className="animate-spin" /> : <Square size={12} fill="currentColor" />}
                </button>
              ) : (
              <Button
                type="submit"
                className={styles.sendButton}
                size="icon"
                variant="ghost"
                icon={<ArrowUp size={19} strokeWidth={2} />}
                disabled={!canSendInstruction}
                aria-label="Send message"
                title="Send message"
                data-testid="agent-send-instruction"
              />
              )}
            </div>
          </div>
        </form>
        <p className={styles.composerHint}>Enter to send <span>·</span> Shift + Enter for a new line</p>
        </div>
      </div>
      <SettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initialSection={settingsSection}
        confirmSpeechDownload={confirmSpeechDownload}
        hideTrigger
      />
    </Panel>
  );
}
