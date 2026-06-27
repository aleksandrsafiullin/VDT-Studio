"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { clsx } from "clsx";
import { Button } from "@/components/ui/button";
import { Field, SelectInput, TextInput } from "@/components/ui/field";
import { createAiExecutionClient } from "@/lib/ai-execution-client";
import { hasStandaloneRunnerUi, resolveVdtAppMode, type VdtAppMode } from "@/lib/app-mode";
import {
  CLI_CATALOG,
  LOCAL_RUNNER_PRESET_CATALOG,
  getCliCatalogEntry,
  type CliAgentId,
  type CliCatalogEntry,
  type CliModelSelection,
  type LocalHttpModelBackendId,
  type LocalRunnerPresetCatalogEntry
} from "@/lib/execution-mode-catalog";
import { CliAgentCard, type CliAgentDetectionView } from "./cli-agent-card";
import { CliInstallGrid } from "./cli-install-grid";
import { ProviderTestStatusBanner } from "./provider-diagnostics";
import { useVdtStudioStore } from "./vdt-store";

function buildDetectionFallback(): CliAgentDetectionView[] {
  return CLI_CATALOG.map((entry) => ({
    id: entry.id,
    installed: false,
    executable: null,
    alias: null,
    version: null
  }));
}

function AccordionSection({
  title,
  defaultOpen = true,
  children,
  testId
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
  testId?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="rounded-lg border border-line bg-white" data-testid={testId}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="text-sm font-semibold text-ink">{title}</span>
        <ChevronDown className={clsx("h-4 w-4 text-muted transition", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open ? <div className="border-t border-line px-4 py-4">{children}</div> : null}
    </section>
  );
}

function LocalModelCard({
  preset,
  selected,
  selectedModel,
  discoveredModels,
  isLoadingModels,
  modelListError,
  onSelect,
  onSelectModel,
  onRefreshModels
}: {
  preset: LocalRunnerPresetCatalogEntry;
  selected: boolean;
  selectedModel?: string | undefined;
  discoveredModels: readonly string[];
  isLoadingModels: boolean;
  modelListError?: string | undefined;
  onSelect: () => void;
  onSelectModel: (model: string) => void;
  onRefreshModels: () => void;
}) {
  const modelOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: string[] = [];
    const add = (model: string | undefined) => {
      const trimmed = model?.trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      options.push(trimmed);
    };
    add(selectedModel);
    for (const model of discoveredModels) add(model);
    add(preset.model);
    return options;
  }, [discoveredModels, preset.model, selectedModel]);
  const currentModel = selectedModel?.trim() || modelOptions[0] || preset.model || "";

  return (
    <article
      data-testid={`local-model-card-${preset.id}`}
      className={clsx(
        "rounded-lg border bg-white p-3 transition",
        selected ? "border-accent ring-2 ring-blue-100" : "border-line hover:border-slate-300"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">{preset.label}</p>
          <p className="mt-1 text-xs leading-5 text-muted">Local model server managed by the desktop runtime.</p>
          <p className="mt-2 truncate rounded-md bg-slate-50 px-2 py-1.5 font-mono text-[11px] text-slate-600">
            {preset.baseUrl}
          </p>
          {!selected && preset.model ? <p className="mt-1 text-xs text-slate-500">Default model: {preset.model}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Refresh ${preset.label} models`}
            title={`Refresh ${preset.label} models`}
            data-testid={`local-model-refresh-${preset.id}`}
            disabled={isLoadingModels}
            onClick={onRefreshModels}
          >
            <RefreshCw className={clsx("h-3.5 w-3.5", isLoadingModels && "animate-spin")} aria-hidden="true" />
          </Button>
          <Button
            size="sm"
            variant={selected ? "primary" : "secondary"}
            data-testid={`local-model-select-${preset.id}`}
            onClick={onSelect}
          >
            {selected ? "Selected" : "Select"}
          </Button>
        </div>
      </div>
      {selected ? (
        <div className="mt-3 space-y-2">
          <Field label="Model">
            <SelectInput
              data-testid={`local-model-model-${preset.id}`}
              value={currentModel}
              disabled={isLoadingModels || modelOptions.length === 0}
              onChange={(event) => onSelectModel(event.target.value)}
            >
              {modelOptions.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </SelectInput>
          </Field>
          {isLoadingModels ? (
            <p className="text-xs leading-5 text-muted">Loading available models...</p>
          ) : modelListError ? (
            <p className="text-xs leading-5 text-red-700">{modelListError}</p>
          ) : discoveredModels.length > 0 ? (
            <p className="text-xs leading-5 text-slate-500">
              {discoveredModels.length} model{discoveredModels.length === 1 ? "" : "s"} detected.
            </p>
          ) : (
            <p className="text-xs leading-5 text-slate-500">Using preset default until the runtime reports models.</p>
          )}
        </div>
      ) : null}
    </article>
  );
}

function backendIdForCliAgent(agentId: CliAgentId): string {
  if (agentId === "cursor-agent") return "cursor_subscription";
  return `${agentId}_subscription`;
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
            ? "Local AI is temporarily unavailable. API key providers remain available while the desktop runtime recovers."
            : "You can still configure agents below. Rescan when the detection service is available."}
        </p>
      </div>
    </div>
  );
}

export function LocalModelCards({
  selectedPresetId,
  selectedModel,
  modelsByBackend = {},
  isLoadingModelsByBackend = {},
  modelListErrorByBackend = {},
  onSelectPreset,
  onSelectModel,
  onRefreshModels
}: {
  selectedPresetId?: string | undefined;
  selectedModel?: string | undefined;
  modelsByBackend?: Partial<Record<LocalHttpModelBackendId, readonly string[]>>;
  isLoadingModelsByBackend?: Partial<Record<LocalHttpModelBackendId, boolean>>;
  modelListErrorByBackend?: Partial<Record<LocalHttpModelBackendId, string | undefined>>;
  onSelectPreset: (presetId: LocalRunnerPresetCatalogEntry["id"]) => void;
  onSelectModel?: (model: string) => void;
  onRefreshModels?: (backendId: LocalHttpModelBackendId) => void;
}) {
  const localModelPresets = LOCAL_RUNNER_PRESET_CATALOG.filter((preset) => preset.runnerProviderId === "local_http_stub");

  return (
    <div className="grid gap-3 sm:grid-cols-3" data-testid="local-model-cards">
      {localModelPresets.map((preset) => {
        const backendId = preset.modelBackendId;
        return (
          <LocalModelCard
            key={preset.id}
            preset={preset}
            selected={selectedPresetId === preset.id}
            selectedModel={selectedPresetId === preset.id ? selectedModel : undefined}
            discoveredModels={backendId ? modelsByBackend[backendId] ?? [] : []}
            isLoadingModels={backendId ? Boolean(isLoadingModelsByBackend[backendId]) : false}
            modelListError={backendId ? modelListErrorByBackend[backendId] : undefined}
            onSelect={() => onSelectPreset(preset.id)}
            onSelectModel={(model) => onSelectModel?.(model)}
            onRefreshModels={() => {
              if (backendId) onRefreshModels?.(backendId);
            }}
          />
        );
      })}
    </div>
  );
}

export function LocalCliSettings() {
  const executionSettings = useVdtStudioStore((state) => state.executionSettings);
  const cliDetectionAgents = useVdtStudioStore((state) => state.cliDetectionAgents);
  const cliDetectionError = useVdtStudioStore((state) => state.cliDetectionError);
  const isRescanningClis = useVdtStudioStore((state) => state.isRescanningClis);
  const rescanningCliId = useVdtStudioStore((state) => state.rescanningCliId);
  const cliModelByAgent = useVdtStudioStore((state) => state.cliModelByAgent);
  const cliDiscoveredModelsByAgent = useVdtStudioStore((state) => state.cliDiscoveredModelsByAgent);
  const cliTestStatusByAgent = useVdtStudioStore((state) => state.cliTestStatusByAgent);
  const isTestingCliByAgent = useVdtStudioStore((state) => state.isTestingCliByAgent);
  const setSelectedCliAgentId = useVdtStudioStore((state) => state.setSelectedCliAgentId);
  const setLocalRunnerPreset = useVdtStudioStore((state) => state.setLocalRunnerPreset);
  const setExecutionSettingsField = useVdtStudioStore((state) => state.setExecutionSettingsField);
  const setCliModelForAgent = useVdtStudioStore((state) => state.setCliModelForAgent);
  const setMemoryModelMode = useVdtStudioStore((state) => state.setMemoryModelMode);
  const rescanClis = useVdtStudioStore((state) => state.rescanClis);
  const testCli = useVdtStudioStore((state) => state.testCli);
  const runnerPairingToken = useVdtStudioStore((state) => state.runnerPairingToken);
  const runnerPairingStatus = useVdtStudioStore((state) => state.runnerPairingStatus);
  const isPairingRunner = useVdtStudioStore((state) => state.isPairingRunner);
  const pairRunner = useVdtStudioStore((state) => state.pairRunner);
  const unpairRunner = useVdtStudioStore((state) => state.unpairRunner);

  const [installToast, setInstallToast] = useState<string | undefined>();
  const [pairingCode, setPairingCode] = useState("");
  const [localModelsByBackend, setLocalModelsByBackend] = useState<Partial<Record<LocalHttpModelBackendId, string[]>>>({});
  const [localModelLoadingByBackend, setLocalModelLoadingByBackend] = useState<Partial<Record<LocalHttpModelBackendId, boolean>>>({});
  const [localModelErrorByBackend, setLocalModelErrorByBackend] = useState<Partial<Record<LocalHttpModelBackendId, string | undefined>>>({});
  const hasAttemptedInitialScan = useRef(false);
  const selectedCliAgentId = executionSettings.selectedCliAgentId;
  const memoryModelMode = executionSettings.memoryModelMode ?? "same_as_chat";
  const memoryCliAgentId = executionSettings.memoryCliAgentId;
  const appMode = resolveVdtAppMode();
  const showStandaloneRunner = hasStandaloneRunnerUi(appMode);

  const detectionById = new Map(
    buildDetectionFallback().map((fallback) => {
      const scanned = cliDetectionAgents?.find((agent) => agent.id === fallback.id);
      return [fallback.id, scanned ?? fallback] as const;
    })
  );

  const installedAgents = CLI_CATALOG.filter((entry) => detectionById.get(entry.id)?.installed);
  const notInstalledAgents = CLI_CATALOG.filter((entry) => !detectionById.get(entry.id)?.installed);
  const canUseExplicitMemoryCli = installedAgents.length > 0;

  const selectedCatalog = selectedCliAgentId ? getCliCatalogEntry(selectedCliAgentId) : undefined;
  const selectedLocalPreset = LOCAL_RUNNER_PRESET_CATALOG.find((preset) => preset.id === executionSettings.localRunnerPresetId);
  const selectedLocalBackendId =
    selectedLocalPreset?.runnerProviderId === "local_http_stub" ? selectedLocalPreset.modelBackendId : undefined;
  let activeRunnerProviderId = executionSettings.runnerProviderId ?? selectedLocalPreset?.runnerProviderId;
  if (activeRunnerProviderId === "cli_stub" && selectedLocalPreset?.runnerProviderId === "local_http_stub") {
    activeRunnerProviderId = "local_http_stub";
  }
  const isSubscriptionCliActive =
    executionSettings.executionMode === "local_cli" && activeRunnerProviderId === "cli_stub";
  const sameAsChatLabel = isSubscriptionCliActive
    ? selectedCatalog?.displayName ?? "selected CLI"
    : selectedLocalPreset?.label ?? "selected local model";

  const refreshLocalModels = useCallback(async (backendId: LocalHttpModelBackendId) => {
    setLocalModelLoadingByBackend((current) => ({ ...current, [backendId]: true }));
    setLocalModelErrorByBackend((current) => ({ ...current, [backendId]: undefined }));
    try {
      const models = await createAiExecutionClient().listModels(backendId);
      setLocalModelsByBackend((current) => ({
        ...current,
        [backendId]: models.map((model) => model.id)
      }));
    } catch (error) {
      setLocalModelErrorByBackend((current) => ({
        ...current,
        [backendId]: error instanceof Error ? error.message : "Model list unavailable."
      }));
    } finally {
      setLocalModelLoadingByBackend((current) => ({ ...current, [backendId]: false }));
    }
  }, []);

  const runInitialScan = useCallback(() => {
    void rescanClis();
  }, [rescanClis]);

  useEffect(() => {
    if (hasAttemptedInitialScan.current || cliDetectionAgents !== undefined || isRescanningClis) {
      return;
    }

    hasAttemptedInitialScan.current = true;
    runInitialScan();
  }, [cliDetectionAgents, isRescanningClis, runInitialScan]);

  useEffect(() => {
    if (!selectedLocalBackendId || selectedLocalPreset?.runnerProviderId !== "local_http_stub") {
      return;
    }

    if (
      localModelsByBackend[selectedLocalBackendId] === undefined &&
      !localModelLoadingByBackend[selectedLocalBackendId] &&
      localModelErrorByBackend[selectedLocalBackendId] === undefined
    ) {
      void refreshLocalModels(selectedLocalBackendId);
    }

    const models = localModelsByBackend[selectedLocalBackendId] ?? [];
    if (models.length === 0) {
      return;
    }

    const currentModel = executionSettings.localModel?.trim();
    const presetModel = selectedLocalPreset.model?.trim();
    if (!currentModel || (currentModel === presetModel && !models.includes(currentModel))) {
      setExecutionSettingsField("localModel", models[0]);
    }
  }, [
    executionSettings.localModel,
    localModelErrorByBackend,
    localModelLoadingByBackend,
    localModelsByBackend,
    refreshLocalModels,
    selectedLocalBackendId,
    selectedLocalPreset,
    setExecutionSettingsField
  ]);

  useEffect(() => {
    if (memoryModelMode === "selected_cli" && !canUseExplicitMemoryCli) {
      setMemoryModelMode("same_as_chat");
    }
  }, [memoryModelMode, canUseExplicitMemoryCli, setMemoryModelMode]);

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

  function handleSelectLocalPreset(presetId: LocalRunnerPresetCatalogEntry["id"]) {
    const preset = LOCAL_RUNNER_PRESET_CATALOG.find((entry) => entry.id === presetId);
    setLocalRunnerPreset(presetId);
    if (preset?.runnerProviderId === "local_http_stub") {
      const discoveredModel = preset.modelBackendId ? localModelsByBackend[preset.modelBackendId]?.[0] : undefined;
      const model = discoveredModel ?? preset.model;
      if (model) setExecutionSettingsField("localModel", model);
    }
  }

  async function handleAuthenticate(entry: CliCatalogEntry) {
    try {
      const action = await createAiExecutionClient().openProviderAuth(backendIdForCliAgent(entry.id));
      window.open(action.docsUrl ?? entry.docsUrl, "_blank", "noopener,noreferrer");
      setInstallToast(action.label ?? `Opened ${entry.displayName} authentication help`);
    } catch {
      window.open(entry.docsUrl, "_blank", "noopener,noreferrer");
      setInstallToast(`Opened ${entry.displayName} authentication help`);
    }
  }

  return (
    <div className="space-y-4" data-testid="local-cli-settings">
      <section className="rounded-lg border border-line bg-slate-50 px-4 py-3" data-testid="desktop-local-ai-managed">
        <h3 className="text-sm font-semibold text-ink">Your subscriptions</h3>
        <p className="mt-1 text-xs leading-5 text-muted">
          Local AI is managed automatically by VDT Studio Desktop. Provider sign-in remains provider-owned.
        </p>
      </section>

      <AccordionSection title="Local model servers" testId="local-model-servers-accordion">
        <LocalModelCards
          selectedPresetId={executionSettings.localRunnerPresetId}
          selectedModel={executionSettings.localModel}
          modelsByBackend={localModelsByBackend}
          isLoadingModelsByBackend={localModelLoadingByBackend}
          modelListErrorByBackend={localModelErrorByBackend}
          onSelectPreset={handleSelectLocalPreset}
          onSelectModel={(model) => setExecutionSettingsField("localModel", model)}
          onRefreshModels={refreshLocalModels}
        />
      </AccordionSection>

      {showStandaloneRunner ? (
        <section className="rounded-lg border border-line bg-white px-4 py-4" data-testid="local-runner-pairing">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-ink">Standalone runner</h3>
              <p className="mt-1 text-xs leading-5 text-muted">
                Development fallback for local web testing. Start <code>vdt runner start</code>, then enter its code.
              </p>
            </div>
            {runnerPairingToken ? (
              <Button size="sm" variant="secondary" data-testid="local-runner-unpair" onClick={() => void unpairRunner()}>
                Unpair
              </Button>
            ) : null}
          </div>
          {!runnerPairingToken ? (
            <div className="mt-3 flex items-end gap-2">
              <Field label="Pairing code">
                <TextInput
                  data-testid="local-runner-pairing-code"
                  value={pairingCode}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  onChange={(event) => setPairingCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                />
              </Field>
              <Button
                data-testid="local-runner-pair"
                disabled={pairingCode.length !== 6 || isPairingRunner}
                onClick={() => void pairRunner(pairingCode)}
              >
                {isPairingRunner ? "Pairing..." : "Pair"}
              </Button>
            </div>
          ) : null}
          {runnerPairingStatus ? (
            <ProviderTestStatusBanner
              className="mt-3"
              status={runnerPairingStatus}
              testId="local-runner-pairing-status"
            />
          ) : null}
        </section>
      ) : null}

      {cliDetectionError ? <LocalAiRuntimeErrorBanner message={cliDetectionError} appMode={appMode} /> : null}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-ink">Your subscriptions ({installedAgents.length})</h3>
          <Button
            size="sm"
            variant="secondary"
            data-testid="local-cli-rescan"
            disabled={isRescanningClis}
            icon={
              isRescanningClis ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              )
            }
            onClick={() => void rescanClis()}
          >
            Rescan
          </Button>
        </div>

        {installedAgents.length === 0 ? (
          <div
            data-testid="local-cli-empty-installed"
            className="rounded-md border border-dashed border-line bg-slate-50/80 px-4 py-6 text-center text-sm text-muted"
          >
            No installed CLIs detected on PATH yet. Use the install grid below or rescan after installing an agent.
          </div>
        ) : (
          <div className="space-y-3">
            {installedAgents.map((entry) => {
              const detection = detectionById.get(entry.id)!;
              return (
                <CliAgentCard
                  key={entry.id}
                  catalog={entry}
                  detection={detection}
                  selected={isSubscriptionCliActive && selectedCliAgentId === entry.id}
                  modelSelection={resolveModelSelection(entry.id)}
                  discoveredModels={cliDiscoveredModelsByAgent[entry.id] ?? []}
                  testStatus={cliTestStatusByAgent[entry.id]}
                  isTesting={Boolean(isTestingCliByAgent[entry.id])}
                  onSelect={() => setSelectedCliAgentId(entry.id)}
                  onTest={() => void testCli(entry.id)}
                  onAuthenticate={() => void handleAuthenticate(entry)}
                  onModelSelectionChange={(selection) => setCliModelForAgent(entry.id, selection)}
                />
              );
            })}
          </div>
        )}

      </div>

      <AccordionSection
        title={`Available to install (${notInstalledAgents.length})`}
        defaultOpen={installedAgents.length === 0}
        testId="local-cli-install-accordion"
      >
        <CliInstallGrid
          agents={notInstalledAgents}
          isRescanningId={rescanningCliId}
          toastMessage={installToast}
          onInstall={handleInstall}
          onCopyCommand={handleCopyCommand}
          onRescanAgent={(agentId) => void rescanClis(agentId)}
        />
      </AccordionSection>

      <AccordionSection title="Memory model" testId="local-cli-memory-accordion">
        <div className="space-y-3">
          <Field label="Memory source">
            <SelectInput
              data-testid="local-cli-memory-mode"
              value={canUseExplicitMemoryCli ? memoryModelMode : "same_as_chat"}
              onChange={(event) => {
                const mode = event.target.value as "same_as_chat" | "selected_cli";
                if (mode === "same_as_chat") {
                  setMemoryModelMode("same_as_chat");
                  return;
                }
                if (!canUseExplicitMemoryCli) {
                  return;
                }
                setMemoryModelMode("selected_cli", selectedCliAgentId ?? installedAgents[0]!.id);
              }}
            >
              <option value="same_as_chat">
                Same as chat ({sameAsChatLabel})
              </option>
              <option value="selected_cli" disabled={!canUseExplicitMemoryCli}>
                Explicit CLI override
              </option>
            </SelectInput>
          </Field>

          {memoryModelMode === "selected_cli" && canUseExplicitMemoryCli ? (
            <Field label="Memory CLI">
              <SelectInput
                data-testid="local-cli-memory-agent"
                value={memoryCliAgentId ?? selectedCliAgentId ?? ""}
                onChange={(event) =>
                  setMemoryModelMode("selected_cli", event.target.value as CliAgentId)
                }
              >
                {installedAgents.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.displayName}
                  </option>
                ))}
              </SelectInput>
            </Field>
          ) : null}
        </div>
      </AccordionSection>
    </div>
  );
}
