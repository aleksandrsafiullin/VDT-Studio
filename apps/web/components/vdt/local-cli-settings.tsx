"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Loader2, Plus, RefreshCw, TriangleAlert } from "lucide-react";
import { clsx } from "clsx";
import { Button } from "@/components/ui/button";
import { Field, SelectInput, TextInput } from "@/components/ui/field";
import { createAiExecutionClient } from "@/lib/ai-execution-client";
import { hasStandaloneRunnerUi, resolveVdtAppMode, type VdtAppMode } from "@/lib/app-mode";
import { isConfirmedNotInstalled } from "@/lib/cli-readiness";
import { runCliSignIn } from "@/lib/cli-sign-in";
import {
  CLI_CATALOG,
  getCliCatalogEntry,
  type CliAgentId,
  type CliCatalogEntry,
  type CliModelSelection
} from "@/lib/execution-mode-catalog";
import { CliAgentCard, type CliAgentDetectionView } from "./cli-agent-card";
import { CliInstallGrid } from "./cli-install-grid";
import { ProviderTestStatusBanner } from "./provider-diagnostics";
import { useVdtStudioStore, type ProviderTestStatus } from "./vdt-store";

function AccordionSection({
  title,
  defaultOpen = false,
  children,
  testId,
  onOpenChange
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
  testId?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <section className="rounded-lg border border-line bg-white" data-testid={testId}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => { setOpen(!open); onOpenChange?.(!open); }}
      >
        <span className="text-sm font-semibold text-ink">{title}</span>
        <ChevronDown className={clsx("h-4 w-4 text-muted transition", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open ? <div id={contentId} className="border-t border-line px-4 py-4">{children}</div> : null}
    </section>
  );
}

function backendIdForCliAgent(agentId: CliAgentId): string {
  if (agentId === "cursor-agent") return "cursor_subscription";
  return `${agentId}_subscription`;
}

export function resolveCliSettingsDetectionState(
  detections: readonly CliAgentDetectionView[] | undefined,
  isScanning: boolean,
  detectionError?: string | undefined,
  removedAgentIds: readonly CliAgentId[] = []
) {
  const detectionById = new Map((detections ?? []).map((detection) => [detection.id, detection] as const));
  const scanPending = isScanning || detections === undefined;
  const installedAgents = CLI_CATALOG.filter((entry) => !removedAgentIds.includes(entry.id) && detectionById.get(entry.id)?.installed === true);
  const removedAgents = CLI_CATALOG.filter((entry) => removedAgentIds.includes(entry.id));
  const notInstalledAgents = CLI_CATALOG.filter((entry) => !removedAgentIds.includes(entry.id) && isConfirmedNotInstalled(detectionById.get(entry.id)));

  return {
    detectionById,
    scanPending,
    installedAgents,
    removedAgents,
    notInstalledAgents,
    showInstallOptions: !scanPending && !detectionError && notInstalledAgents.length > 0
  };
}

export function LocalAiRuntimeErrorBanner({
  message,
  appMode
}: {
  message: string;
  appMode: VdtAppMode;
}) {
  const desktopMode = appMode === "desktop";
  return (
    <div
      role="alert"
      data-testid="local-cli-detection-error"
      className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
    >
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>
        <p className="font-medium">{desktopMode ? "Desktop runtime unavailable" : "Could not scan installed CLIs"}</p>
        <p className="mt-0.5 text-xs leading-5">{message}</p>
        <p className="mt-1 text-xs leading-5 text-amber-800">
          {desktopMode
            ? "CLI subscriptions are temporarily unavailable. API key providers remain available while the desktop runtime recovers."
            : "You can still configure agents below. Rescan when the detection service is available."}
        </p>
      </div>
    </div>
  );
}

export { LocalModelCards } from "./local-model-settings";

export function LocalCliSettings() {
  const executionSettings = useVdtStudioStore((state) => state.executionSettings);
  const removedCliAgentIds = useVdtStudioStore((state) => state.removedCliAgentIds);
  const removeCliAgent = useVdtStudioStore((state) => state.removeCliAgent);
  const restoreCliAgent = useVdtStudioStore((state) => state.restoreCliAgent);
  const cliDetectionAgents = useVdtStudioStore((state) => state.cliDetectionAgents);
  const cliDetectionError = useVdtStudioStore((state) => state.cliDetectionError);
  const isRescanningClis = useVdtStudioStore((state) => state.isRescanningClis);
  const rescanningCliId = useVdtStudioStore((state) => state.rescanningCliId);
  const cliModelByAgent = useVdtStudioStore((state) => state.cliModelByAgent);
  const cliDiscoveredModelsByAgent = useVdtStudioStore((state) => state.cliDiscoveredModelsByAgent);
  const cliTestStatusByAgent = useVdtStudioStore((state) => state.cliTestStatusByAgent);
  const isTestingCliByAgent = useVdtStudioStore((state) => state.isTestingCliByAgent);
  const setSelectedCliAgentId = useVdtStudioStore((state) => state.setSelectedCliAgentId);
  const setCliModelForAgent = useVdtStudioStore((state) => state.setCliModelForAgent);
  const rescanClis = useVdtStudioStore((state) => state.rescanClis);
  const testCli = useVdtStudioStore((state) => state.testCli);
  const clearCliTestStatus = useVdtStudioStore((state) => state.clearCliTestStatus);

  const [installToast, setInstallToast] = useState<string | undefined>();
  const [authenticatingByAgent, setAuthenticatingByAgent] = useState<Partial<Record<CliAgentId, boolean>>>({});
  const authenticatingRef = useRef(new Set<CliAgentId>());
  const [authStatusByAgent, setAuthStatusByAgent] = useState<Partial<Record<CliAgentId, ProviderTestStatus>>>({});
  const [removedNotice, setRemovedNotice] = useState<{ id: CliAgentId; message: string }>();
  const undoButtonRef = useRef<HTMLButtonElement>(null);
  const [showAddProviders, setShowAddProviders] = useState(false);
  const hasAttemptedInitialScan = useRef(false);
  const selectedCliAgentId = executionSettings.selectedCliAgentId;
  const appMode = resolveVdtAppMode();

  const {
    detectionById,
    scanPending: cliScanPending,
    installedAgents,
    removedAgents,
    notInstalledAgents,
    showInstallOptions
  } = resolveCliSettingsDetectionState(cliDetectionAgents, isRescanningClis, cliDetectionError, removedCliAgentIds);

  const selectedCatalog = selectedCliAgentId ? getCliCatalogEntry(selectedCliAgentId) : undefined;
  const isSubscriptionCliActive = true;
  const activeModel = executionSettings.cliModelSelection?.source === "custom"
    ? executionSettings.cliModelSelection.customModel || "Enter a model" : "Provider default";

  const runInitialScan = useCallback(() => {
    void rescanClis();
  }, [rescanClis]);

  useEffect(() => {
    if (removedNotice) undoButtonRef.current?.focus();
  }, [removedNotice]);

  useEffect(() => {
    if (hasAttemptedInitialScan.current || cliDetectionAgents !== undefined || isRescanningClis) {
      return;
    }

    hasAttemptedInitialScan.current = true;
    runInitialScan();
  }, [cliDetectionAgents, isRescanningClis, runInitialScan]);

  useEffect(() => {
    if (!installToast) {
      return;
    }

    const timer = window.setTimeout(() => setInstallToast(undefined), 3_000);
    return () => window.clearTimeout(timer);
  }, [installToast]);

  function resolveModelSelection(agentId: CliAgentId): CliModelSelection {
    return (
      cliModelByAgent[agentId] ??
      (selectedCliAgentId === agentId ? executionSettings.cliModelSelection : undefined) ?? {
        source: "agent_default"
      }
    );
  }

  function handleInstall(entry: CliCatalogEntry) {
    void navigator.clipboard.writeText(entry.installHint).catch(() => undefined);
    window.open(entry.docsUrl, "_blank", "noopener,noreferrer");
    setInstallToast("Copied install command");
  }

  function handleCopyCommand(entry: CliCatalogEntry) {
    void navigator.clipboard.writeText(entry.primaryCommand).catch(() => undefined);
    setInstallToast(`Copied ${entry.primaryCommand}`);
  }

  async function handleAuthenticate(entry: CliCatalogEntry) {
    const state = useVdtStudioStore.getState();
    if (authenticatingRef.current.has(entry.id) || state.isTestingCliByAgent[entry.id] || state.removedCliAgentIds.includes(entry.id)) return;
    clearCliTestStatus(entry.id);
    authenticatingRef.current.add(entry.id);
    setAuthenticatingByAgent((current) => ({ ...current, [entry.id]: true }));
    try {
      await runCliSignIn({
        entry,
        openGuidance: (url) => { window.open(url, "_blank", "noopener,noreferrer"); },
        authenticate: () => createAiExecutionClient().openProviderAuth(backendIdForCliAgent(entry.id)),
        rescan: () => rescanClis(entry.id, { fresh: true }),
        getVerification: () => {
          const current = useVdtStudioStore.getState();
          return { agents: current.cliDetectionAgents, error: current.cliDetectionError, scanning: current.isRescanningClis };
        },
        onStatus: (status) => {
          if (!useVdtStudioStore.getState().removedCliAgentIds.includes(entry.id)) {
            setAuthStatusByAgent((current) => ({ ...current, [entry.id]: status }));
          }
        }
      });
    } finally {
      authenticatingRef.current.delete(entry.id);
      setAuthenticatingByAgent((current) => ({ ...current, [entry.id]: false }));
    }
  }

  function handleRemove(entry: CliCatalogEntry) {
    const state = useVdtStudioStore.getState();
    if (state.isTestingCliByAgent[entry.id] || authenticatingRef.current.has(entry.id)) return;
    const before = state.executionSettings;
    removeCliAgent(entry.id);
    const after = useVdtStudioStore.getState().executionSettings;
    const routing = before.selectedCliAgentId === entry.id
      ? after.selectedCliAgentId ? ` Chat now uses ${getCliCatalogEntry(after.selectedCliAgentId).displayName}.` : " Choose another provider before sending a request."
      : "";
    const memory = before.memoryCliAgentId === entry.id ? " Memory now follows chat." : "";
    setRemovedNotice({ id: entry.id, message: `${entry.displayName} removed from Your subscriptions.${routing}${memory}` });
    setAuthStatusByAgent((current) => ({ ...current, [entry.id]: undefined }));
  }

  return (
    <div className="space-y-5" data-testid="local-cli-settings">
      <section aria-labelledby="subscriptions-title" className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 id="subscriptions-title" className="text-sm font-semibold text-ink">Your subscriptions</h3>
            <p className="mt-1 max-w-xl text-xs leading-5 text-muted">
              The provider CLI runs on this computer and uses your provider account and cloud service. Choose one for chat, then verify access.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {removedAgents.length > 0 || showInstallOptions ? (
              <Button type="button" size="sm" variant="secondary" data-testid="local-cli-add-provider"
                aria-expanded={showAddProviders} aria-controls="local-cli-add-providers" icon={<Plus className="h-3.5 w-3.5" aria-hidden="true" />}
                onClick={() => setShowAddProviders((current) => !current)}>Add provider</Button>
            ) : null}
            <Button type="button" size="sm" variant="ghost" data-testid="local-cli-rescan" disabled={isRescanningClis}
              icon={isRescanningClis ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={() => void rescanClis()}>{isRescanningClis ? "Scanning…" : "Rescan"}</Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 rounded-lg bg-slate-50 px-4 py-3" data-testid="local-cli-active-selection">
          <div><span className="mr-2 text-[11px] font-medium text-muted">Chat</span><span className="text-xs font-semibold text-ink">{selectedCatalog?.displayName ?? "Choose a provider"}</span></div>
          <span className="text-xs text-slate-600">{isSubscriptionCliActive && !selectedCliAgentId ? "No provider selected" : activeModel}</span>
        </div>

        {removedNotice ? (
          <div role="status" aria-live="polite" data-testid="local-cli-removed-notice" className="flex items-center justify-between gap-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-900">
            <span>{removedNotice.message}</span>
            <Button ref={undoButtonRef} type="button" size="sm" variant="ghost" className="shrink-0 text-blue-700" data-testid="local-cli-undo-remove" onClick={() => {
              const restoredId = removedNotice.id;
              restoreCliAgent(restoredId); setRemovedNotice(undefined);
              requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-testid="cli-agent-select-${restoredId}"]`)?.focus());
            }}>Undo</Button>
          </div>
        ) : null}
        {cliDetectionError ? <LocalAiRuntimeErrorBanner message={cliDetectionError} appMode={appMode} /> : null}

        {cliScanPending ? (
          <div role="status" aria-live="polite" data-testid="local-cli-scan-status" className="flex items-center gap-2 rounded-lg border border-line px-4 py-4 text-xs text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Checking installed providers…
          </div>
        ) : cliDetectionError && installedAgents.length === 0 ? null : installedAgents.length === 0 ? (
          <div data-testid="local-cli-empty-installed" className="rounded-xl border border-dashed border-line bg-slate-50/60 px-5 py-8 text-center">
            <p className="text-sm font-medium text-ink">{removedAgents.length > 0 ? "No subscriptions added" : "No installed providers found"}</p>
            <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-muted">{removedAgents.length > 0 ? "Add a provider back whenever you need it. Your CLI installations and provider accounts stay on this Mac." : "Install a supported CLI, sign in with your provider, and rescan."}</p>
            {removedAgents.length > 0 || showInstallOptions ? <Button type="button" size="sm" className="mt-4" onClick={() => setShowAddProviders(true)}>Add provider</Button> : null}
          </div>
        ) : (
          <div className="space-y-3">
            {installedAgents.map((entry) => (
              <CliAgentCard key={entry.id} catalog={entry} detection={detectionById.get(entry.id)!}
                selected={isSubscriptionCliActive && selectedCliAgentId === entry.id}
                modelSelection={resolveModelSelection(entry.id)} discoveredModels={cliDiscoveredModelsByAgent[entry.id] ?? []}
                testStatus={cliTestStatusByAgent[entry.id]} authActionStatus={authStatusByAgent[entry.id]}
                isTesting={Boolean(isTestingCliByAgent[entry.id])} isAuthenticating={Boolean(authenticatingByAgent[entry.id])}
                onSelect={() => setSelectedCliAgentId(entry.id)} onTest={() => {
                  if (authenticatingRef.current.has(entry.id)) return;
                  setAuthStatusByAgent((current) => ({ ...current, [entry.id]: undefined }));
                  void testCli(entry.id);
                }} onAuthenticate={() => void handleAuthenticate(entry)} onRemove={() => handleRemove(entry)}
                onModelSelectionChange={(selection) => setCliModelForAgent(entry.id, selection)} />
            ))}
          </div>
        )}

        {showAddProviders ? (
          <section id="local-cli-add-providers" data-testid="local-cli-add-providers" className="space-y-4 rounded-xl border border-line bg-slate-50/50 p-4">
            <div className="flex items-center justify-between gap-3"><h4 className="text-xs font-semibold text-ink">Add a provider</h4><Button type="button" size="sm" variant="ghost" onClick={() => setShowAddProviders(false)}>Done</Button></div>
            {removedAgents.length > 0 ? <div className="space-y-2">
              <p className="text-xs leading-5 text-muted">Removed from this browser. Add back without changing your provider account.</p>
              {removedAgents.map((entry) => <div key={entry.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-white px-3 py-2">
                <div><p className="text-xs font-medium text-ink">{entry.displayName}</p><p className="mt-0.5 text-[11px] text-muted">{detectionById.get(entry.id)?.installed ? "Installed on this Mac" : "Rescan to check installation"}</p></div>
                <Button type="button" size="sm" data-testid={`cli-agent-restore-${entry.id}`} onClick={() => { restoreCliAgent(entry.id); setRemovedNotice(undefined); }}>Add back</Button>
              </div>)}
            </div> : null}
            {showInstallOptions ? <div data-testid="local-cli-install-accordion" className="space-y-3">
              <p className="text-xs font-medium text-ink">Available to install</p>
              <CliInstallGrid agents={notInstalledAgents} isRescanningId={rescanningCliId} toastMessage={installToast}
                onInstall={handleInstall} onCopyCommand={handleCopyCommand} onRescanAgent={(agentId) => void rescanClis(agentId)} />
            </div> : null}
          </section>
        ) : null}
        <p className="px-1 text-[11px] leading-5 text-muted">Removing a provider only hides it here. It does not uninstall its CLI or sign out of your account.</p>
      </section>

    </div>
  );
}

export function LocalExecutionOptions() {
  const executionSettings = useVdtStudioStore((state) => state.executionSettings);
  const cliDetectionAgents = useVdtStudioStore((state) => state.cliDetectionAgents);
  const removedCliAgentIds = useVdtStudioStore((state) => state.removedCliAgentIds);
  const setMemoryModelMode = useVdtStudioStore((state) => state.setMemoryModelMode);
  const runnerPairingToken = useVdtStudioStore((state) => state.runnerPairingToken);
  const runnerPairingStatus = useVdtStudioStore((state) => state.runnerPairingStatus);
  const isPairingRunner = useVdtStudioStore((state) => state.isPairingRunner);
  const pairRunner = useVdtStudioStore((state) => state.pairRunner);
  const unpairRunner = useVdtStudioStore((state) => state.unpairRunner);
  const [pairingCode, setPairingCode] = useState("");
  const installedAgents = CLI_CATALOG.filter((entry) => !removedCliAgentIds.includes(entry.id) &&
    cliDetectionAgents?.some((agent) => agent.id === entry.id && agent.installed));
  const memoryModelMode = executionSettings.memoryModelMode ?? "same_as_chat";
  const memoryCliAgentId = executionSettings.memoryCliAgentId;
  const canChooseCli = installedAgents.length > 0;
  const savedMemoryIsUnavailable = memoryCliAgentId && !installedAgents.some((entry) => entry.id === memoryCliAgentId);
  const showStandaloneRunner = hasStandaloneRunnerUi(resolveVdtAppMode());

  return (
    <div className="space-y-2 border-t border-line pt-5" data-testid="local-execution-options">
      <AccordionSection title="Memory model" testId="local-cli-memory-accordion">
        <div className="space-y-3">
          <p className="text-xs leading-5 text-muted">Memory follows chat by default. A separate CLI override is kept when you switch execution tabs.</p>
          <Field label="Memory source">
            <SelectInput data-testid="local-cli-memory-mode" value={memoryModelMode} onChange={(event) => {
              if (event.target.value === "same_as_chat") setMemoryModelMode("same_as_chat");
              else if (canChooseCli) setMemoryModelMode("selected_cli", installedAgents.find((entry) => entry.id === executionSettings.selectedCliAgentId)?.id ?? installedAgents[0]!.id);
            }}>
              <option value="same_as_chat">Same as chat</option>
              <option value="selected_cli" disabled={!canChooseCli}>Choose a separate CLI</option>
            </SelectInput>
          </Field>
          {memoryModelMode === "selected_cli" ? (
            <Field label="Memory CLI" {...(savedMemoryIsUnavailable ? { hint: "Saved override retained. Open CLI to verify its installation and access." } : {})}>
              <SelectInput data-testid="local-cli-memory-agent" value={memoryCliAgentId ?? ""} onChange={(event) => setMemoryModelMode("selected_cli", event.target.value as CliAgentId)}>
                {!memoryCliAgentId ? <option value="" disabled>Choose a CLI in CLI settings</option> : null}
                {savedMemoryIsUnavailable ? <option value={memoryCliAgentId}>{getCliCatalogEntry(memoryCliAgentId).displayName} (saved override)</option> : null}
                {installedAgents.map((entry) => <option key={entry.id} value={entry.id}>{entry.displayName}</option>)}
              </SelectInput>
            </Field>
          ) : null}
          {!canChooseCli ? <p className="text-xs leading-5 text-muted">Open CLI to discover providers for a new override.</p> : null}
        </div>
      </AccordionSection>
      {showStandaloneRunner ? (
        <AccordionSection title="Developer runner" testId="local-runner-accordion">
          <section data-testid="local-runner-pairing">
            <div className="flex items-start justify-between gap-4">
              <p className="text-xs leading-5 text-muted">Development fallback for local web testing. Start <code>vdt runner start</code>, then enter its code.</p>
              {runnerPairingToken ? <Button type="button" size="sm" data-testid="local-runner-unpair" onClick={() => void unpairRunner()}>Unpair</Button> : null}
            </div>
            {!runnerPairingToken ? <div className="mt-3 flex items-end gap-2">
              <Field label="Pairing code"><TextInput data-testid="local-runner-pairing-code" value={pairingCode} inputMode="numeric" maxLength={6} placeholder="000000" onChange={(event) => setPairingCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></Field>
              <Button type="button" data-testid="local-runner-pair" disabled={pairingCode.length !== 6 || isPairingRunner} onClick={() => void pairRunner(pairingCode)}>{isPairingRunner ? "Pairing…" : "Pair"}</Button>
            </div> : null}
            {runnerPairingStatus ? <ProviderTestStatusBanner className="mt-3" status={runnerPairingStatus} testId="local-runner-pairing-status" /> : null}
          </section>
        </AccordionSection>
      ) : null}
    </div>
  );
}
