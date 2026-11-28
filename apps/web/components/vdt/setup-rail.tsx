"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ArrowUpRight, Check, ChevronDown, CircleAlert, History, Keyboard, LoaderCircle, MessageSquarePlus, Mic, Plus, SlidersHorizontal, Sparkles, Square, X } from "lucide-react";
import { clsx } from "clsx";
import { kpiCanonicalJson, type ChatStarterOutput, type VdtNode } from "@vdt-studio/vdt-core";
import { Button } from "@/components/ui/button";
import { DataImportAttachmentButton } from "@/components/data-import/data-import-attachment-button";
import { Field, SelectInput, TextArea, TextInput } from "@/components/ui/field";
import { Panel, PanelCollapseTab, PanelToggleButton } from "@/components/ui/panel";
import { isAppleAnalyticalChoice } from "@/lib/apple-first-launch";
import { hasByokFieldErrors, validateByokSettings } from "@/lib/byok-validation";
import type { CliRequestReadiness } from "@/lib/cli-readiness";
import { formatExecutionModeSummary } from "@/lib/format-execution-summary";
import { resolveExecutionSettings } from "@/lib/execution-mode-resolver";
import { desktopLayoutMatches, subscribeDesktopLayout, useDesktopLayout } from "@/lib/use-desktop-layout";
import { filterAgentChatHistoryForVdt, hasActiveWorkspaceVdt, selectedCliScanStatus, selectedNodeForAgentChat, shouldContinueOpenVdt, useVdtStudioStore } from "./vdt-store";
import { GenerateActivityPanel } from "./generate-activity-panel";
import { SettingsModal } from "./settings-modal";
import { SkillContextControl } from "./skill-context-control";
import type { SettingsSectionId } from "./settings-nav";
import { selectedAppleVoice, useSpeechSettings, useSpeechStore } from "./speech-store";
import { useScopedComposerDraft, useVoiceDialogue } from "./use-voice-dialogue";
import { useComposerVoiceShortcuts } from "./use-composer-voice-shortcuts";
import { useNativeAppIntents } from "./use-native-app-intents";
import { canUseComposerVoiceShortcut, composerVoiceShortcuts, type ComposerVoiceShortcutScope } from "@/lib/composer-voice-shortcuts";
import { spokenReviewIntent } from "@/lib/voice-confirmation";
import { dialogueDestination, heardQuestion, spokenAnswer, type DialogueDestination } from "@/lib/voice-dialogue";
import { createLocalNotificationSynthesis } from "@/lib/local-notification-synthesis";
import { createOpenAiNotificationSynthesis } from "@/lib/openai-notification-synthesis";
import { openAiSpeechCredentialTarget } from "@/lib/openai-byok-speech-client";
import { resolveVdtAppMode } from "@/lib/app-mode";
import type { VoiceSynthesis } from "@/lib/voice-notification-queue";
import { selectedSpeechAnalytics, speechAnalyticsConnectionKey } from "@/lib/speech-client";
import type { SpeechSelection } from "@vdt-studio/local-runner/speech-catalog";
import { useVoiceDictation } from "./use-voice-dictation";
import { VoiceInputStatus } from "./voice-input-status";
import { useApiKeyStorage } from "./api-key-storage";
import { SpokenUpdateControls, VoiceConversationControls } from "./voice-conversation-controls";
import { WebSearchControl, type ResearchStatus } from "./web-search-control";
import { useCliChatReadiness } from "./use-cli-chat-readiness";
import { ComposerModelPicker } from "./composer-model-picker";
import { useProviderConnectionCheck } from "@/lib/provider-connection-state";
import { FAST_LOCAL_REASONING } from "@vdt-studio/model-bridge/reasoning";
import { adaptiveReasoningPolicy } from "@/app/api/agent/runs/adaptive-reasoning";
import { providerConnectionRequest, requestProviderModelCapabilities } from "@/lib/provider-agent-binding";
import { providerConnectionKey } from "@/lib/provider-connection";
export { ExecutionReadinessDot } from "./composer-model-picker";
import type { AgentChatHistoryEntry } from "./vdt-store";
import type { ResearchMode, VdtAgentStartRequest } from "@/lib/agent-client";
import { StructuralOutcome } from "./structural-outcome";
import styles from "./agent-chat.module.css";

type ChatOutcome = NonNullable<VdtAgentStartRequest["outcome"]>;

function selectMeasurement(nodeId: string) {
  const state = useVdtStudioStore.getState();
  state.selectNode(nodeId);
  useVdtStudioStore.setState({ selectedPanelTab: "properties" });
  if (state.ui.rightPanelCollapsed) state.toggleRightPanel();
}

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

export function describeComposerReadiness(cliReadiness: CliRequestReadiness | undefined, configured: boolean): Pick<CliRequestReadiness, "state" | "label" | "message"> {
  if (cliReadiness) return cliReadiness;
  return configured
    ? { state: "ready", label: "Ready to send", message: "Provider settings are configured. Connection and model access are checked when a request starts." }
    : { state: "warning", label: "Setup needed", message: "Configure a provider before sending requests." };
}

export function SelectedKpiContext({ node, onClear }: { node: Pick<VdtNode, "id" | "name" | "unit"> | undefined; onClear: () => void }) {
  if (!node) return null;
  return (
    <div
      className={styles.selectedKpi}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="agent-selected-kpi"
      data-node-id={node.id}
      title={`${node.name}${node.unit ? ` (${node.unit})` : ""} — included with your message`}
    >
      <span className={styles.selectedKpiLabel}>Selected KPI</span>
      <span className={styles.selectedKpiName}>{node.name}</span>
      {node.unit ? <span className={styles.selectedKpiUnit}>{node.unit}</span> : null}
      <button
        type="button"
        className={styles.selectedKpiClear}
        onClick={onClear}
        aria-label="Remove selected KPI from message"
        title="Remove selected KPI and ask about the whole tree"
        data-testid="agent-clear-selected-kpi"
      ><X size={13} aria-hidden="true" /></button>
    </div>
  );
}

function isComposerWorkspaceVisible() {
  const { ui, workspace } = useVdtStudioStore.getState();
  return !document.hidden && workspace.activePanel === "vdt" && hasActiveWorkspaceVdt(workspace)
    && (!ui.leftPanelCollapsed || !desktopLayoutMatches());
}

function voiceDialogueSelection() {
  const state = useVdtStudioStore.getState();
  const { workspace, executionSettings, generateActivity } = state;
  const { stt, modelId, language } = useSpeechStore.getState();
  const preview = state.appleNativePreview?.settings === executionSettings ? state.appleNativePreview.binding : undefined;
  const run = generateActivity?.runtimeAgentRun;
  const scopeId = JSON.stringify([workspace.activeProjectId ?? null, workspace.activeVdtId ?? null]);
  const analytics = preview ? { mode: "local" as const, providerId: preview.backendId, modelId: preview.modelId }
    : selectedSpeechAnalytics(executionSettings);
  const selectionIdentity = [workspace.activeVdtId ? null : state.project.id, speechAnalyticsConnectionKey(executionSettings), analytics,
    resolveExecutionSettings(executionSettings).providerConfig?.modelReasoning ?? null, preview?.bindingId ?? null, stt, modelId, language];
  const scope = JSON.stringify([scopeId, state.projectRevision, ...selectionIdentity]);
  const observationIdentity = JSON.stringify([scopeId, ...selectionIdentity]);
  const selection: SpeechSelection = {
    version: 1, scopeId, analytics, language,
    stt: stt === "apple_local" ? { providerId: "apple_local", modelId: "system" }
      : stt === "whisper_local" ? { providerId: "whisper_local", modelId } : null,
    tts: null, realtime: null
  };
  const base = workspace.draftRevisionBase;
  const choice = executionSettings.analyticalSourceChoice;
  const bindingId = isAppleAnalyticalChoice(choice) && preview?.backendId === "apple_foundation_models"
    && preview.bindingId.startsWith("apple_native_") && preview.admission?.mode === "local"
    && preview.admission.providerId === preview.backendId && preview.admission.modelId === preview.modelId
    && preview.appleIdentity ? preview.bindingId : undefined;
  const idleApple = resolveVdtAppMode() === "desktop" && workspace.activePanel === "vdt"
    && !workspace.isLoading && !workspace.isMutating && !workspace.pendingRevisionCommit
    && base && base.projectId === workspace.activeProjectId && base.vdtId === workspace.activeVdtId
    && base.expectedHead.activeRevisionId && base.expectedHead.activeContentIdentity
    && (bindingId || (choice === "untouched" && !preview)) ? {
      base, project: state.project, executionSettings, microphoneKey: JSON.stringify([stt, modelId, language]), bindingId,
      verifiedFirstLaunch: state.appleFirstLaunch?.status === "ready" && state.appleFirstLaunch.firstLaunchDefaultEnabled
    } : undefined;
  const runScope = run?.request.workspace;
  const sameWorkspace = (!runScope?.projectId || runScope.projectId === workspace.activeProjectId)
    && (!runScope?.vdtId || runScope.vdtId === workspace.activeVdtId);
  const pending = run?.events.slice().reverse().find(event => event.type === "clarifying_questions");
  const questionSetId = pending?.metadata?.questionSetId;
  const questions = generateActivity?.status === "needs_user_input" ? run?.pendingQuestions : undefined;
  const proposal = run?.pendingMutationProposal;
  const destination = sameWorkspace ? dialogueDestination({
    runId: generateActivity?.runId,
    status: run?.status === "waiting_approval" ? "waiting_approval" : generateActivity?.status,
    questionSetId: typeof questionSetId === "string" ? questionSetId : undefined,
    questionEventId: pending?.id,
    projectId: runScope?.projectId,
    vdtId: runScope?.vdtId,
    proposal: runScope?.projectId && runScope.vdtId && proposal?.status === "proposed"
      ? { runId: proposal.runId, projectId: runScope.projectId, vdtId: runScope.vdtId,
          proposalId: proposal.id, baseRevisionId: proposal.baseRevisionId, baseRevision: proposal.baseRevision }
      : undefined,
    questions
  }) : undefined;
  if (destination?.kind === "answer" && (pending?.questions?.length !== 1 || pending.questions[0]?.id !== questions?.[0]?.id
    || pending.questions[0]?.question !== questions?.[0]?.question)) return { scope, observationIdentity, selection, destination: undefined, idleApple };
  return { scope, observationIdentity, selection, destination, idleApple };
}

export function SetupRail({ starterPrompts, voiceSynthesis = null }: {
  starterPrompts?: ChatStarterOutput["prompts"] | undefined;
  /** Supplied only by an explicitly granted local synthesis owner. */
  voiceSynthesis?: VoiceSynthesis | null;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>("execution");
  const [confirmSpeechDownload, setConfirmSpeechDownload] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const draftScope = useVdtStudioStore(state => JSON.stringify([
    state.workspace.activeProjectId ?? null, state.workspace.activeVdtId ?? state.project.id
  ]));
  const [instructionText, setInstructionText] = useScopedComposerDraft(draftScope);
  const [chatOutcome, setChatOutcome] = useState<ChatOutcome | "">("");
  const instructionInputRef = useRef<HTMLTextAreaElement>(null);
  const briefRef = useRef<HTMLDetailsElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuButtonRef = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const composerIsOpen = useCallback(() => Boolean(composerRef.current?.isConnected) && isComposerWorkspaceVisible(), []);
  const voiceControlsRef = useRef<HTMLDivElement>(null);
  const dictationButtonRef = useRef<HTMLButtonElement>(null);
  const dialoguePrimaryRef = useRef<HTMLButtonElement>(null);
  const startDialogueButtonRef = useRef<HTMLButtonElement>(null);
  const voiceFocusAfterToggle = useRef<"start" | "end" | null>(null);
  const activityScrollRef = useRef<HTMLElement>(null);
  const followConversationRef = useRef(true);
  const [researchMode, setResearchMode] = useState<ResearchMode>("auto");
  const [researchStatus, setResearchStatus] = useState<ResearchStatus | undefined>();
  const brief = useVdtStudioStore((state) => state.brief);
  const executionSettings = useVdtStudioStore((state) => state.executionSettings);
  const cliDetectionAgents = useVdtStudioStore((state) => state.cliDetectionAgents);
  const cliDetectionError = useVdtStudioStore((state) => selectedCliScanStatus(state).detectionError);
  const isRescanningClis = useVdtStudioStore((state) => selectedCliScanStatus(state).isScanning);
  const isGenerating = useVdtStudioStore((state) => state.isGenerating);
  const generateActivity = useVdtStudioStore((state) => state.generateActivity);
  const agentChatHistory = useVdtStudioStore((state) => state.agentChatHistory);
  const activeVdtId = useVdtStudioStore((state) => state.workspace.activeVdtId);
  const activeProjectId = useVdtStudioStore((state) => state.workspace.activeProjectId);
  const [adaptiveReadiness, setAdaptiveReadiness] = useState<"idle" | "checking" | "supported" | "unsupported" | "unavailable">("idle");
  const [adaptiveRequested, setAdaptiveRequested] = useState(false);
  const adaptiveCheckRef = useRef<AbortController | null>(null);
  const project = useVdtStudioStore((state) => state.project);
  const speech = useSpeechSettings();
  const leftPanelCollapsed = useVdtStudioStore((state) => state.ui.leftPanelCollapsed);
  const isDesktop = useDesktopLayout();
  const showCollapsed = isDesktop && leftPanelCollapsed;
  const voice = useVoiceDictation(text => {
    if (composerIsOpen()) setInstructionText(text);
  }, draftScope);
  const scopedAgentChatHistory = useMemo(
    () => {
      const seen = new Set<string>();
      return filterAgentChatHistoryForVdt(agentChatHistory, activeVdtId).filter((entry) => {
        const id = entry.activity.runtimeAgentRun?.request.conversationId ?? entry.runId;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    },
    [agentChatHistory, activeVdtId]
  );
  const pendingChangeSet = useVdtStudioStore((state) => state.pendingChangeSet);
  const changeSetSelection = useVdtStudioStore((state) => state.changeSetSelection);
  const aiError = useVdtStudioStore((state) => state.aiError);
  const aiActionError = useVdtStudioStore((state) => state.aiActionError);
  const selectedNode = useVdtStudioStore((state) => shouldContinueOpenVdt(state)
    ? selectedNodeForAgentChat(state)
    : undefined);
  const clearAgentKpiContext = useVdtStudioStore((state) => state.clearAgentKpiContext);
  const setBriefField = useVdtStudioStore((state) => state.setBriefField);
  const startAgentRun = useVdtStudioStore((state) => state.startAgentRun);
  const startNewAgentChat = useVdtStudioStore((state) => state.startNewAgentChat);
  const openAgentChat = useVdtStudioStore((state) => state.openAgentChat);
  const sendAgentAnswers = useVdtStudioStore((state) => state.sendAgentAnswers);
  const continueAgentRun = useVdtStudioStore((state) => state.continueAgentRun);
  const sendAgentApproval = useVdtStudioStore((state) => state.sendAgentApproval);
  const sendAgentInstruction = useVdtStudioStore((state) => state.sendAgentInstruction);
  const continueFromSavedCopy = useVdtStudioStore((state) => state.continueFromSavedCopy);
  const hasSavedCopySource = useVdtStudioStore((state) => Boolean(state.workspace.draftRevisionBase?.expectedHead.activeRevisionId));
  const cancelGenerate = useVdtStudioStore((state) => state.cancelGenerate);
  const applyPendingChangeSet = useVdtStudioStore((state) => state.applyPendingChangeSet);
  const discardPendingChangeSet = useVdtStudioStore((state) => state.discardPendingChangeSet);
  const toggleLeftPanel = useVdtStudioStore((state) => state.toggleLeftPanel);
  const applePreview = useVdtStudioStore(state => state.appleNativePreview?.settings === state.executionSettings
    ? state.appleNativePreview.binding : undefined);
  const executionSummary = formatExecutionModeSummary(executionSettings);
  const resolvedExecution = resolveExecutionSettings(executionSettings);
  const canRunDeepenAction = resolvedExecution.providerId !== "mock";
  const byokValidationBlocked = executionSettings.executionMode === "byok" &&
    hasByokFieldErrors(validateByokSettings(executionSettings));
  const cliReadiness = useCliChatReadiness(executionSettings, cliDetectionAgents, {
    isScanning: isRescanningClis,
    detectionError: cliDetectionError
  });
  const canUseConfiguredRuntime = Boolean(applePreview) || (
    canRunDeepenAction && !byokValidationBlocked && (cliReadiness?.canExecute ?? true)
  );
  const providerCheck = useProviderConnectionCheck();
  const currentProviderCheck = providerCheck.key === providerConnectionKey(executionSettings) && providerCheck.state ? providerCheck : undefined;
  const { state: executionReadinessState, label: executionReadinessLabel, message: executionReadinessMessage } = !cliReadiness && currentProviderCheck
    ? { state: currentProviderCheck.state!, label: currentProviderCheck.state === "ready" ? "Connected" : currentProviderCheck.state === "checking" ? "Connecting…" : "Connection needs attention", message: currentProviderCheck.message ?? "Checking provider access." }
    : describeComposerReadiness(cliReadiness, canUseConfiguredRuntime);
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
  const canSendTypedInstruction =
    !voice.active &&
    instructionText.trim().length > 0 &&
    canUseConfiguredRuntime &&
    (!isGenerating || Boolean(generateActivity));
  const canStartNewChat = Boolean(generateActivity);
  const hasRetryableError = Boolean(generateActivity?.retryableError);
  const modelLabel = applePreview ? "Apple on-device preview" : executionSummary.secondary ?? executionSummary.primary;
  const canStopResponse = generateActivity?.status === "running" && !instructionText.trim() && !voice.active;
  const activeRun = generateActivity?.runtimeAgentRun;
  const outcomeLocked = canContinueCurrentAgentRun || generateActivity?.status === "recovery_required";
  const canCheckAdaptive = Boolean(activeProjectId && activeVdtId && !applePreview && !outcomeLocked
    && resolvedExecution.providerId === "local_runner" && resolvedExecution.providerConfig?.backendId === "ollama"
    && resolvedExecution.providerConfig.modelReasoning === FAST_LOCAL_REASONING);
  useEffect(() => {
    setAdaptiveReadiness("idle");
    setAdaptiveRequested(false);
    return () => adaptiveCheckRef.current?.abort();
  }, [activeProjectId, activeVdtId, executionSettings, canCheckAdaptive]);

  function adaptiveScopeIsCurrent() {
    const current = useVdtStudioStore.getState();
    return current.executionSettings === executionSettings
      && current.workspace.activeProjectId === activeProjectId && current.workspace.activeVdtId === activeVdtId;
  }

  async function checkAdaptiveReasoning() {
    if (!canCheckAdaptive || !adaptiveScopeIsCurrent()) return;
    const connection = providerConnectionRequest(executionSettings, resolvedExecution.providerId, resolvedExecution.providerConfig, false);
    if (!connection) return;
    adaptiveCheckRef.current?.abort();
    const check = new AbortController();
    adaptiveCheckRef.current = check;
    setAdaptiveReadiness("checking");
    try {
      const capabilities = await requestProviderModelCapabilities(connection, AbortSignal.any([check.signal, AbortSignal.timeout(8_000)]));
      if (!check.signal.aborted && adaptiveScopeIsCurrent()) {
        setAdaptiveReadiness(adaptiveReasoningPolicy(capabilities) ? "supported" : "unsupported");
      }
    } catch {
      if (!check.signal.aborted && adaptiveScopeIsCurrent()) setAdaptiveReadiness("unavailable");
    }
  }

  const conversationId = activeRun?.request.conversationId;
  const verifiedRun = activeRun?.finishOutcome?.outcome === "structural_model"
    ? activeRun
    : conversationId ? agentChatHistory.find(({ vdtId, activity }) =>
      vdtId === activeVdtId && activity.runtimeAgentRun?.request.conversationId === conversationId
      && activity.runtimeAgentRun.finishOutcome?.outcome === "structural_model"
    )?.activity.runtimeAgentRun : undefined;
  const verifiedProject = verifiedRun?.project ?? verifiedRun?.draftProject;
  const structureInCurrentTree = verifiedProject && (verifiedRun?.request.workspace?.vdtId
    ? verifiedRun.request.workspace.vdtId === activeVdtId
    : verifiedProject.id === project.id);
  const latestChatMessage = generateActivity?.agentChatMessages?.at(-1);
  const visualProposal = activeRun?.pendingMutationProposal;
  const visualWorkspace = activeRun?.request.workspace;
  const visualApproval = visualProposal && visualWorkspace?.projectId && visualWorkspace.vdtId
    ? { runId: visualProposal.runId, projectId: visualWorkspace.projectId, vdtId: visualWorkspace.vdtId,
        proposalId: visualProposal.id, baseRevisionId: visualProposal.baseRevisionId, baseRevision: visualProposal.baseRevision }
    : undefined;
  const dialogueSelection = voiceDialogueSelection();
  const { scope: notificationScope, selection: { analytics: { mode, providerId, modelId } } } = dialogueSelection;
  const localSpeakEnabled = speech.tts === "apple_local" && speech.autoSpeak && speech.appleStatus?.supported === true;
  const { voiceId: installedVoiceId, ratePercent, volumePercent } = selectedAppleVoice(speech, true) ?? {};
  const notificationLocale = speech.ttsLocale;
  const notificationRunId = generateActivity?.runId;
  const localSynthesis = useMemo(() => installedVoiceId && ratePercent !== undefined && volumePercent !== undefined ? createLocalNotificationSynthesis({
    scope: notificationScope,
    analytics: { mode, providerId, modelId },
    voice: { voiceId: installedVoiceId, locale: notificationLocale, ratePercent, volumePercent },
    autoSpeak: localSpeakEnabled,
    current: () => {
      const settings = useSpeechStore.getState();
      const currentVoice = selectedAppleVoice(settings, true);
      return resolveVdtAppMode() === "desktop" && composerIsOpen() && settings.autoSpeak && settings.tts === "apple_local"
        && currentVoice?.locale === notificationLocale && currentVoice.voiceId === installedVoiceId
        && currentVoice.ratePercent === ratePercent && currentVoice.volumePercent === volumePercent
        && useVdtStudioStore.getState().generateActivity?.runId === notificationRunId
        && voiceDialogueSelection().scope === notificationScope;
    }
  }) : null, [composerIsOpen, notificationRunId, notificationScope, mode, providerId, modelId, installedVoiceId, notificationLocale, ratePercent, volumePercent, localSpeakEnabled]);
  const vaultStatus = useApiKeyStorage(state => state.status);
  const cloudTargetKey = useVdtStudioStore(state => {
    const target = openAiSpeechCredentialTarget(state);
    return target && target.runId === state.generateActivity?.runId ? JSON.stringify(target) : undefined;
  });
  const cloudAvailable = resolveVdtAppMode() !== "hosted_web"
    && process.env.NEXT_PUBLIC_VDT_OPENAI_SPEECH_BYOK_ENABLED === "true"
    && speech.ready && vaultStatus === "saved" && Boolean(cloudTargetKey) && !voiceSynthesis;
  const cloudLocale = notificationLocale === "ru" ? "ru" : "en";
  const [cloudConsent, setCloudConsent] = useState<{ key: string; scope: string; settings: typeof executionSettings; locale: "en" | "ru" }>();
  const cloudConsentRef = useRef<typeof cloudConsent>(undefined);
  const [cloudUpdateError, setCloudUpdateError] = useState<string>();
  const revokeCloudUpdates = () => {
    cloudConsentRef.current = undefined;
    setCloudConsent(undefined);
    setCloudUpdateError(undefined);
  };
  const cloudEnabled = cloudAvailable && Boolean(cloudConsent && cloudTargetKey === cloudConsent.key
    && notificationScope === cloudConsent.scope && executionSettings === cloudConsent.settings && cloudLocale === cloudConsent.locale);
  useEffect(() => {
    if (cloudConsent && !cloudEnabled) revokeCloudUpdates();
  }, [cloudConsent, cloudEnabled]);
  useEffect(() => {
    const revokeWhenHidden = () => { if (document.hidden) revokeCloudUpdates(); };
    document.addEventListener("visibilitychange", revokeWhenHidden);
    window.addEventListener("pagehide", revokeCloudUpdates);
    return () => {
      cloudConsentRef.current = undefined;
      document.removeEventListener("visibilitychange", revokeWhenHidden);
      window.removeEventListener("pagehide", revokeCloudUpdates);
    };
  }, []);
  const cloudSynthesis = useMemo(() => cloudEnabled && cloudConsent ? createOpenAiNotificationSynthesis({
    consent: JSON.parse(cloudConsent.key),
    locale: cloudLocale,
    current: () => {
      const current = useVdtStudioStore.getState();
      const target = openAiSpeechCredentialTarget(current);
      const voiceSettings = useSpeechStore.getState();
      return cloudConsentRef.current === cloudConsent && composerIsOpen() && !voiceSettings.spokenMuted
        && voiceSettings.stt !== "off" && useApiKeyStorage.getState().status === "saved"
        && current.executionSettings === cloudConsent.settings && target?.runId === current.generateActivity?.runId
        && JSON.stringify(target) === cloudConsent.key && voiceDialogueSelection().scope === cloudConsent.scope
        && (voiceSettings.ttsLocale === "ru" ? "ru" : "en") === cloudLocale;
    },
    snapshot: () => useVdtStudioStore.getState().generateActivity?.runtimeAgentRun,
    onFailure: setCloudUpdateError
  }) : null, [cloudEnabled, cloudConsent, cloudLocale, composerIsOpen]);
  const effectiveSynthesis = voiceSynthesis ?? cloudSynthesis ?? localSynthesis;
  const appleWorkspace = dialogueSelection.idleApple;
  const matchesAppleRun = !activeRun || (activeRun.request.providerId === "model_agent"
    && activeRun.request.executionBindingId === appleWorkspace?.bindingId
    && (!activeRun.executionSummary || activeRun.executionSummary.backendId === "apple_foundation_models"));
  const notificationWorkspace = effectiveSynthesis === localSynthesis && localSynthesis && appleWorkspace?.bindingId && matchesAppleRun
    ? appleWorkspace : undefined;
  const notificationBase = notificationWorkspace?.base;
  const notificationProject = notificationWorkspace?.project;
  const observationScope = useMemo(() => notificationBase && notificationProject
    ? kpiCanonicalJson([dialogueSelection.observationIdentity, notificationBase, notificationProject])
    : undefined, [dialogueSelection.observationIdentity, notificationBase, notificationProject]);
  const [spokenReview, setSpokenReview] = useState<{ scope: string; target: Extract<DialogueDestination, { kind: "review" }>; text: string }>();
  const visibleSpokenReview = spokenReview && spokenReview.scope === dialogueSelection.scope
    && JSON.stringify(spokenReview.target) === JSON.stringify(dialogueSelection.destination) ? spokenReview : undefined;
  const reviewReadbackRef = useRef<(key: string, message: string) => void>(() => undefined);
  const voiceCapturePending = useRef(false);
  const [manualCaptureBusy, setManualCaptureBusy] = useState(false);
  const microphoneIsReleased = () => composerIsOpen() && !voiceCapturePending.current && !voice.hasCapture();
  const dialogue = useVoiceDialogue({
    selected: voiceDialogueSelection,
    canCapture: microphoneIsReleased,
    dispatch: async (destination, text, capture) => {
      if (!composerIsOpen()) return false;
      if (destination.kind === "instruction") return submitAgentInstruction(text, destination.continuing);
      if (destination.kind === "review") {
        const intent = spokenReviewIntent(text);
        const live = voiceDialogueSelection();
        if (!intent || JSON.stringify(live.destination) !== JSON.stringify(destination)) return false;
        const ru = speech.language === "ru";
        const proposed = useVdtStudioStore.getState().generateActivity?.runtimeAgentRun?.pendingMutationProposal;
        const count = proposed?.selectedChangeIds.length ?? 0;
        const readback = intent === "decline"
          ? ru ? "Предложение ожидает решения. Проверьте изменения и нажмите «Отклонить»." : "The proposal is still pending. Review the changes and choose Reject on screen."
          : ru ? `Предложено изменений: ${count}. Проверьте предложение на экране.`
            : `Proposed changes: ${count}. Review them on screen before approving.`;
        setSpokenReview({ scope: live.scope, target: destination, text: readback });
        reviewReadbackRef.current(`${destination.runId}:${destination.proposal.proposalId}:${destination.proposal.baseRevision}:${capture.turnId}`, readback);
        return true;
      }
      if (destination.kind !== "answer" || !capture.recognitionProof) return false;
      await useVdtStudioStore.getState().sendAgentAnswers([spokenAnswer(destination, text)], {
        runId: destination.runId, checkpoint: heardQuestion(destination, { ...capture, recognitionProof: capture.recognitionProof })
      });
      return !useVdtStudioStore.getState().agentError;
    },
    preserve: text => setInstructionText(previous => previous ? `${previous}
${text}` : text),
    speakNotifications: !showCollapsed && Boolean(localSynthesis || cloudSynthesis),
    notifications: {
      scope: dialogueSelection.scope,
      canPlay: () => composerIsOpen() && voiceDialogueSelection().scope === notificationScope
        && useVdtStudioStore.getState().generateActivity?.runId === notificationRunId,
      observationScope,
      runId: generateActivity?.runId,
      snapshot: activeRun,
      canonicalQuestionsOnly: !activeRun || Boolean(activeRun.request.executionBindingId
        && (activeRun.request.providerId === "model_agent" || activeRun.request.providerId === "external_cli_agent")),
      locale: cloudSynthesis ? cloudLocale : localSynthesis && !voiceSynthesis ? notificationLocale : speech.language,
      currentReadbackOnly: cloudSynthesis !== null,
      synthesis: effectiveSynthesis
    }
  });
  const manualMicrophoneIsReady = () => microphoneIsReleased() && !dialogue.hasCapture();
  const { resume: resumeNotifications } = dialogue.notifications;
  const finishManualCapture = () => {
    if (!voiceCapturePending.current || voice.hasCapture()) return;
    const release = voice.waitForRelease();
    void Promise.resolve(release).then(() => {
      if (!voiceCapturePending.current || voice.hasCapture()) return;
      if (release !== voice.waitForRelease()) { finishManualCapture(); return; }
      voiceCapturePending.current = false;
      resumeNotifications();
      setManualCaptureBusy(false);
    });
  };
  useEffect(() => {
    if (!voice.active) finishManualCapture();
  });
  reviewReadbackRef.current = dialogue.notifications.reviewReadback;
  function abandonSpokenDraft() {
    dialogue.onManualEdit();
    dialogue.notifications.interrupt();
    setSpokenReview(undefined);
  }
  const voiceBoundary = useRef({ close: () => {}, scope: notificationScope, interrupt: dialogue.notifications.interrupt });
  voiceBoundary.current = {
    scope: notificationScope,
    interrupt: dialogue.notifications.interrupt,
    close: () => {
      voice.onManualEdit();
      dialogue.deactivate();
      setSpokenReview(undefined);
    }
  };
  useEffect(() => {
    const check = () => {
      const owner = voiceBoundary.current;
      if (!composerIsOpen()) owner.close();
      else if (voiceDialogueSelection().scope !== owner.scope) owner.interrupt();
    };
    const workspace = useVdtStudioStore.subscribe((state, previous) => {
      if (state.ui.leftPanelCollapsed !== previous.ui.leftPanelCollapsed || state.workspace !== previous.workspace
        || state.executionSettings !== previous.executionSettings || state.appleNativePreview !== previous.appleNativePreview) check();
    });
    const layout = subscribeDesktopLayout(check);
    const speech = useSpeechStore.subscribe(check);
    document.addEventListener("visibilitychange", check);
    return () => {
      workspace();
      layout();
      speech();
      document.removeEventListener("visibilitychange", check);
    };
  }, [composerIsOpen]);

  const canSendInstruction = canSendTypedInstruction && !dialogue.active;
  const canStartDialogue = speech.ready && canUseConfiguredRuntime && !voice.active && !manualCaptureBusy && Boolean(dialogueSelection.destination)
    && (dialogueSelection.destination?.kind !== "answer" || activeRun?.status === "needs_user_input");
  const showDialogue = dialogue.enabled || speech.ready;
  const voiceAnswer = dialogue.enabled && activeRun?.status === "needs_user_input" && dialogueSelection.destination?.kind === "answer"
    ? dialogueSelection.destination : undefined;
  useEffect(() => {
    const transition = voiceFocusAfterToggle.current;
    if (transition === "start" && dialogue.enabled) {
      voiceFocusAfterToggle.current = null;
      const primary = dialoguePrimaryRef.current;
      (primary && !primary.disabled ? primary : voiceControlsRef.current)?.focus();
    } else if (transition === "end" && !dialogue.enabled) {
      voiceFocusAfterToggle.current = null;
      const start = startDialogueButtonRef.current;
      const dictation = dictationButtonRef.current;
      (start && !start.disabled ? start : dictation && !dictation.disabled ? dictation : instructionInputRef.current)?.focus();
    }
  }, [dialogue.enabled]);
  const recordVisibleTurn = () => {
    if (!microphoneIsReleased()) return;
    const current = voiceDialogueSelection();
    if (current.scope === dialogueSelection.scope && JSON.stringify(current.destination) === JSON.stringify(dialogueSelection.destination)) {
      void dialogue.record();
    }
  };
  const dialogueControls = dialogue.enabled ? <VoiceConversationControls dialogue={dialogue} ready={speech.ready}
    canSpeak={canStartDialogue} hasSynthesis={Boolean(effectiveSynthesis)} question={Boolean(voiceAnswer)}
    controlsRef={voiceControlsRef} primaryRef={dialoguePrimaryRef} onSpeak={recordVisibleTurn} onEnd={() => {
      voiceFocusAfterToggle.current = "end";
      dialogue.deactivate();
    }} /> : null;
  const dictationControlDisabled = dialogue.enabled || dialogue.captureBusy || dialogue.notifications.playback === "speaking"
    || voice.state === "starting" || voice.state === "finishing"
    || (!voice.active && (manualCaptureBusy || speech.installing || speech.status?.supported === false));
  function voiceShortcutScope(selection: ReturnType<typeof voiceDialogueSelection>, working: boolean): ComposerVoiceShortcutScope {
    const review = selection.destination?.kind === "review" ? selection.destination.proposal : undefined;
    const answer = selection.destination?.kind === "answer" ? selection.destination : undefined;
    const reviewKey = review && JSON.stringify([review.projectId, review.vdtId, review.runId, review.proposalId, review.baseRevisionId, review.baseRevision]);
    const stopControl = dialogue.enabled && dialogue.phase === "listening" ? "dialogue"
      : !dialogue.enabled && voice.state === "listening" && voice.hasCapture() ? "dictation" : undefined;
    return {
      scope: answer ? JSON.stringify([selection.scope, answer.runId, answer.questionSetId, answer.questionEventId, answer.questionId]) : selection.scope,
      hasVoiceControls: showDialogue || !dictationControlDisabled, reviewKey, stopControl,
      status: stopControl ? "listening" : reviewKey ? "review-available" : working ? "working" : "ready"
    };
  }
  const renderedVoiceShortcutScope = voiceShortcutScope(dialogueSelection, generateActivity?.status === "running");
  const readVoiceShortcutScope = () => voiceShortcutScope(voiceDialogueSelection(), useVdtStudioStore.getState().generateActivity?.status === "running");
  const voiceShortcutTargets = {
    showControls: () => voiceControlsRef.current ?? dictationButtonRef.current,
    stop: (control: NonNullable<ComposerVoiceShortcutScope["stopControl"]>) => control === "dialogue"
      ? dialoguePrimaryRef.current : composerRef.current?.querySelector<HTMLElement>(
        '[data-testid="voice-input-status"][data-voice-state="listening"] button[aria-label="Finish recording"]'
      ) ?? null,
    review: () => activityScrollRef.current?.querySelector<HTMLElement>('[data-testid="mutation-preview"]') ?? null
  };
  const voiceShortcuts = useComposerVoiceShortcuts(renderedVoiceShortcutScope, readVoiceShortcutScope, voiceShortcutTargets);
  const focusShortcut = (target: HTMLElement | null, review = false) => {
    const owner = review ? activityScrollRef.current : composerRef.current;
    if (!target?.isConnected || !owner?.contains(target)
      || target.matches(":disabled,[aria-disabled=true]") || target.closest("[hidden], [inert]")) return false;
    if (review) target.tabIndex = -1;
    target.focus();
    return document.activeElement === target;
  };
  const nativeIntents = useNativeAppIntents(() => {
    const { workspace } = useVdtStudioStore.getState();
    if (!composerRef.current?.isConnected || workspace.activePanel !== "vdt"
      || !workspace.activeProjectId || !workspace.activeVdtId || workspace.isLoading || workspace.isMutating
      || workspace.pendingRevisionCommit) return { status: "ready" };
    const current = readVoiceShortcutScope();
    if (current.scope !== renderedVoiceShortcutScope.scope || current.reviewKey !== renderedVoiceShortcutScope.reviewKey
      || current.stopControl !== renderedVoiceShortcutScope.stopControl) return { status: "ready" };
    const captureKey = current.stopControl === "dialogue" ? dialogue.captureToken()
      : current.stopControl === "dictation" ? voice.captureToken() : undefined;
    return {
      scopeKey: current.scope,
      ...(captureKey && { captureKey }),
      ...(current.reviewKey && { reviewKey: current.reviewKey }),
      status: captureKey ? "listening" : current.reviewKey ? "reviewAvailable" : current.status === "working" ? "working" : "ready"
    };
  }, {
    focusComposer: () => focusShortcut(instructionInputRef.current),
    focusVoiceControls: () => readVoiceShortcutScope().hasVoiceControls && focusShortcut(voiceShortcutTargets.showControls()),
    focusStopListening: () => {
      const control = readVoiceShortcutScope().stopControl;
      return Boolean(control && focusShortcut(voiceShortcutTargets.stop(control)));
    },
    focusPendingReview: () => {
      const destination = voiceDialogueSelection().destination;
      if (destination?.kind !== "review") return false;
      const { proposal } = destination;
      const card = voiceShortcutTargets.review();
      return Boolean(card && card.dataset.proposalId === proposal.proposalId && card.dataset.proposalRun === proposal.runId
        && card.dataset.proposalRevision === proposal.baseRevisionId && focusShortcut(card, true));
    }
  });


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
  }, [generateActivity?.runId, latestChatMessage?.id, latestChatMessage?.text, generateActivity?.publicStatus?.message, verifiedProject, historyOpen, voiceAnswer?.questionEventId]);

  useEffect(() => {
    const el = instructionInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [instructionText]);

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

  async function submitAgentInstruction(spoken?: string, spokenContinuation?: boolean): Promise<boolean> {
    const text = (spoken ?? instructionText).trim();
    if (spoken === undefined ? !canSendInstruction : !text || !canUseConfiguredRuntime || voice.active) return false;
    followConversationRef.current = true;
    if (!(spokenContinuation ?? canContinueCurrentAgentRun)) {
      if (spoken === undefined && adaptiveRequested && (!canCheckAdaptive || !adaptiveScopeIsCurrent())) return false;
      const shouldContinue = shouldContinueOpenVdt(useVdtStudioStore.getState());
      const accepted = await startAgentRun(text, {
        researchMode: applePreview ? "off" : researchMode,
        ...(spoken === undefined && adaptiveRequested ? { adaptiveReasoning: true } : {}),
        ...(chatOutcome ? { outcome: chatOutcome } : { outcomeSelection: "automatic" }),
        ...(shouldContinue ? { mode: "continue_project", includeCurrentProject: true } : {}),
        ...(shouldContinue ? { selectedNodeId: selectedNode?.id ?? null } : {})
      });
      if (accepted) {
        if (spoken === undefined) setInstructionText(previous => previous.trim() === text ? "" : previous);
        setChatOutcome("");
        setAdaptiveRequested(false);
      }
      return accepted;
    }
    const accepted = await sendAgentInstruction(text, selectedNode?.id ?? null, applePreview ? "off" : researchMode);
    if (accepted && spoken === undefined) setInstructionText(previous => previous.trim() === text ? "" : previous);
    return accepted;
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
              onToggle={() => {
                if (desktopLayoutMatches()) voiceBoundary.current.close();
                toggleLeftPanel();
              }}
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
          <SkillContextControl onManage={() => { setSettingsSection("skills"); setSettingsOpen(true); }} />
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

            {!generateActivity && !historyOpen && starterPrompts ? (
              <div className={styles.emptyState} data-testid="agent-chat-empty">
                <span className={styles.welcomeMark}><Sparkles size={22} strokeWidth={1.5} aria-hidden="true" /></span>
                <p className={styles.emptyEyebrow}>A little clarity goes a long way</p>
                <h3>What would you like<br />to explore?</h3>
                <p className={styles.emptyDescription}>Turn your questions and data into<br />a clearer picture of what drives results.</p>
                <div className={styles.suggestions} aria-live="polite" data-testid="agent-chat-starters">
                  {starterPrompts.map((prompt) => (
                    <button type="button" key={prompt} onClick={() => {
                      voice.onManualEdit();
                      abandonSpokenDraft();
                      setInstructionText(prompt.trim());
                      instructionInputRef.current?.focus();
                    }}>
                      <span>{prompt.trim()}</span><ArrowUpRight size={14} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {visibleSpokenReview ? <p role="status" data-testid="voice-review-readback" className="text-xs text-muted">{visibleSpokenReview.text}</p> : null}
            {generateActivity ? (
              <GenerateActivityPanel
                activity={generateActivity}
                onCancel={cancelGenerate}
                cancelInToolbar={canStopResponse}
                questionVoice={voiceAnswer ? { target: voiceAnswer, control: dialogueControls, onManualAnswer: abandonSpokenDraft } : undefined}
                onSavedCopy={hasSavedCopySource ? () => void continueFromSavedCopy() : undefined}
                onAnswer={(answers) => void sendAgentAnswers(answers)}
                onContinueRun={() => void continueAgentRun()}
                onApproval={(approved, selectedChangeIds, proposalId) => void sendAgentApproval(
                  approved,
                  selectedChangeIds,
                  proposalId,
                  visualApproval?.proposalId === proposalId ? visualApproval : undefined
                )}
              />
            ) : null}

            {!historyOpen && structureInCurrentTree && (
              <StructuralOutcome verifiedProject={verifiedProject} currentProject={project} onSelectNode={selectMeasurement} />
            )}

            {pendingChangeSet ? (
              <div className={clsx("mt-3 border border-neutral-200 bg-white p-3", styles.actionCard)} data-testid="agent-patch-ready">
                <div className="text-xs font-semibold uppercase tracking-normal text-neutral-700">Patch ready</div>
                <p className="mt-1 text-sm leading-5 text-ink">
                  {pendingChangeCount} graph change{pendingChangeCount === 1 ? "" : "s"} ready for review.
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
          ref={composerRef}
          className={styles.composer}
          data-testid="agent-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void submitAgentInstruction();
          }}
        >
          <SelectedKpiContext node={selectedNode} onClear={() => {
            clearAgentKpiContext();
            instructionInputRef.current?.focus();
          }} />
          <VoiceInputStatus state={voice.state} error={voice.error} audio={voice.audio} recognizing={voice.recognizing} openAi={voice.openAi} onStop={() => { void voice.stop(); }} onCancel={voice.cancel} onDismiss={voice.clearError} />
          {!dialogue.enabled && (localSynthesis || cloudSynthesis) ? <div className={clsx(styles.dialogueUtilities, "px-2")} role="group" aria-label="Spoken updates">
            <SpokenUpdateControls dialogue={dialogue} showError={!cloudSynthesis} />
          </div> : null}
          {cloudAvailable ? <details className="px-2 text-xs leading-5 text-muted">
            <summary className="cursor-pointer font-medium text-ink">OpenAI spoken questions and approvals{cloudEnabled ? " · On for this run" : ""}</summary>
            <p className="mt-1">OpenAI receives the current question or approval notice as text and returns an AI-generated voice. This uses your OpenAI API organization’s credits or paid balance. Recognition stays on this computer.</p>
            {cloudEnabled ? <Button type="button" size="sm" variant="secondary" onClick={() => {
              revokeCloudUpdates();
              dialogue.notifications.interrupt();
            }}>Turn off OpenAI spoken updates</Button> : <Button type="button" size="sm" variant="secondary"
              disabled={voice.active || dialogue.active || dialogue.notifications.playback === "speaking" || dialogue.spokenMuted}
              onClick={() => {
                if (!cloudTargetKey || document.hidden) return;
                const consent: NonNullable<typeof cloudConsent> = { key: cloudTargetKey, scope: notificationScope, settings: executionSettings, locale: cloudLocale };
                cloudConsentRef.current = consent;
                setCloudConsent(consent);
              }}>Enable for this run · API usage</Button>}
          </details> : null}
          {cloudEnabled && cloudUpdateError ? <p className="px-2 text-xs text-red-700" role="alert">{cloudUpdateError}</p> : null}
          {!dialogue.enabled && showDialogue ? <div ref={voiceControlsRef} tabIndex={-1} role="group" aria-label="Voice conversation" className="px-2 py-1" data-testid="agent-voice-dialogue">
            <Button ref={startDialogueButtonRef} type="button" size="sm" variant="ghost" disabled={!canStartDialogue} onClick={() => {
              if (!microphoneIsReleased()) return;
              voiceFocusAfterToggle.current = "start";
              dialogue.enable();
            }}>
              Start voice conversation
            </Button>
          </div> : !voiceAnswer ? dialogueControls : null}
          <TextArea
            ref={instructionInputRef}
            rows={3}
            className={clsx("max-h-[min(40vh,20rem)]", styles.input)}
            value={instructionText}
            onChange={(event) => { voice.onManualEdit(); abandonSpokenDraft(); setInstructionText(event.target.value); }}
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
          <label className="flex items-center gap-2 px-2 pb-1 text-xs text-muted">
            <span className="shrink-0">Chat outcome</span>
            <SelectInput className="h-7 max-w-40 py-0 text-xs"
              disabled={outcomeLocked || isGenerating}
              value={outcomeLocked ? activeRun?.request.outcome ?? "" : chatOutcome}
              onChange={(event) => setChatOutcome(event.target.value as ChatOutcome | "")}
              data-testid="agent-chat-outcome">
              <option value="">Automatic</option>
              <option value="answer">Answer</option>
              <option value="structural_model">Build structure</option>
              <option value="calculated_baseline">Calculate baseline</option>
            </SelectInput>
          </label>
          {canCheckAdaptive && (
            adaptiveReadiness === "supported" ? (
              <label className="flex items-center gap-2 px-2 pb-1 text-xs text-muted">
                <input type="checkbox" checked={adaptiveRequested} disabled={isGenerating}
                  onChange={(event) => setAdaptiveRequested(event.target.checked)} />
                Adaptive reasoning for this run
              </label>
            ) : (
              <div className="flex items-center gap-2 px-2 pb-1 text-xs text-muted">
                <button type="button" className="underline" onClick={() => void checkAdaptiveReasoning()}
                  disabled={isGenerating || adaptiveReadiness === "checking"}>
                  Check adaptive reasoning
                </button>
                <span role="status">{adaptiveReadiness === "checking" ? "Checking Ollama…"
                  : adaptiveReadiness === "unsupported" ? "Ollama did not report ordered reasoning levels for this model."
                    : adaptiveReadiness === "unavailable" ? "Could not verify Ollama reasoning levels." : ""}</span>
              </div>
            )
          )}
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
              {!dialogue.enabled ? <Button
                ref={dictationButtonRef}
                type="button"
                size="icon"
                variant="ghost"
                className={clsx(styles.toolButton, voice.state === "listening" && styles.recordingButton)}
                disabled={dictationControlDisabled}
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
                  if (!manualMicrophoneIsReady() || !dialogue.notifications.pauseForCapture()) return;
                  voiceCapturePending.current = true;
                  setManualCaptureBusy(true);
                  void voice.start(instructionText, input?.selectionStart ?? instructionText.length, input?.selectionEnd ?? instructionText.length, speech.modelId, speech.language)
                    .then(finishManualCapture);
                }}
                icon={voice.state === "starting" || voice.state === "finishing" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : voice.state === "listening" ? <Square className="h-3.5 w-3.5 fill-current" /> : <Mic className="h-4 w-4" />}
              /> : null}
              {!dialogue.enabled && cloudTargetKey && vaultStatus === "saved" && !cloudEnabled && !voiceSynthesis
                && resolveVdtAppMode() !== "hosted_web" && process.env.NEXT_PUBLIC_VDT_OPENAI_SPEECH_BYOK_ENABLED === "true"
                && (speech.language === "en" || speech.language === "ru" || speech.language === "auto") ? (
                  <details className={styles.contextMenu}>
                    <summary className={clsx(styles.toolButton, "cursor-pointer gap-1 px-2 text-xs")} aria-label="OpenAI dictation" title="OpenAI dictation">
                      <Mic size={16} aria-hidden="true" />
                      <span>OpenAI</span>
                    </summary>
                    <div className={styles.contextPopover}>
                      <p className="px-2 py-1 text-xs leading-5 text-muted">Send one microphone recording to OpenAI for transcription using your API credits or paid balance. Review the text in the draft before sending.</p>
                      <Button type="button" size="sm" variant="secondary" disabled={voice.active || manualCaptureBusy || dialogue.captureBusy || dialogue.notifications.playback === "speaking"} onClick={event => {
                        const target = openAiSpeechCredentialTarget(useVdtStudioStore.getState());
                        const { language, tts, ttsLocale } = useSpeechStore.getState();
                        if (!target || JSON.stringify(target) !== cloudTargetKey || cloudConsentRef.current || !manualMicrophoneIsReady()
                          || (language !== "en" && language !== "ru" && language !== "auto") || !dialogue.notifications.pauseForCapture()) return;
                        const input = instructionInputRef.current;
                        const popup = event.currentTarget.closest("details");
                        if (popup) popup.open = false;
                        voiceCapturePending.current = true;
                        setManualCaptureBusy(true);
                        void voice.startOpenAi(instructionText, input?.selectionStart ?? instructionText.length, input?.selectionEnd ?? instructionText.length, {
                          target, selection: { recognitionLanguage: language, localSynthesis: tts, synthesisLanguage: ttsLocale === "ru" ? "ru" : "en" },
                          isCurrent: () => {
                            const current = useSpeechStore.getState();
                            return useApiKeyStorage.getState().status === "saved" && !cloudConsentRef.current
                              && useVdtStudioStore.getState().executionSettings === executionSettings
                              && current.language === language && current.tts === tts && current.ttsLocale === ttsLocale;
                          }
                        }).then(finishManualCapture);
                      }}>Record with OpenAI</Button>
                    </div>
                  </details>
                ) : null}
              {resolveVdtAppMode() === "desktop" ? (
                <details className={styles.contextMenu} data-testid="composer-voice-shortcuts" onToggle={(event) => {
                  if (!event.currentTarget.open) voiceShortcuts.dismissStatus();
                }}>
                  <summary className={clsx(styles.toolButton, "cursor-pointer list-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent")}
                    aria-label="Voice shortcuts" title="Voice shortcuts" aria-keyshortcuts="V S X R" onKeyDown={(event) => {
                      if (event.currentTarget.closest("details")?.open) voiceShortcuts.handleSummaryKey(event);
                    }}>
                    <Keyboard size={16} aria-hidden="true" />
                  </summary>
                  <div className={styles.contextPopover} role="group" aria-label="Voice shortcuts">
                    {composerVoiceShortcuts.map(({ action, key, label }) => (
                      <button key={action} type="button" className={clsx(styles.menuItem, "disabled:opacity-50")}
                        disabled={!canUseComposerVoiceShortcut(action, renderedVoiceShortcutScope)}
                        onClick={(event) => { voiceShortcuts.activate(action, event.nativeEvent.isTrusted); }}>
                        {label}<kbd className="ml-auto" aria-hidden="true">{key}</kbd>
                      </button>
                    ))}
                    {voiceShortcuts.status ? <p role="status" className="text-xs text-muted">{voiceShortcuts.status}</p> : null}
                    {nativeIntents.available ? <label className="flex items-center gap-2 px-2 py-1 text-xs text-ink">
                      <input type="checkbox" checked={nativeIntents.enabled}
                        onChange={event => nativeIntents.toggle(event.nativeEvent.isTrusted)} />
                      Allow macOS Shortcuts for this window
                    </label> : null}
                  </div>
                </details>
              ) : null}
            </div>
            <div className={styles.composerActions}>
              <ComposerModelPicker modelLabel={modelLabel} providerLabel={applePreview ? "Apple Foundation Models" : executionSummary.primary}
                readiness={applePreview ? { state: "ready", label: "Preview", message: `On-device · ${applePreview.appleIdentity?.locale ?? ""}` }
                  : { state: executionReadinessState, label: executionReadinessLabel, message: executionReadinessMessage }}
                locked={canContinueCurrentAgentRun}
                onOpenSettings={() => { setSettingsSection("execution"); setConfirmSpeechDownload(false); setSettingsOpen(true); }} />
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
