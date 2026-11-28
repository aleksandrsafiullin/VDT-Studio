"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { clsx } from "clsx";
import { Button } from "@/components/ui/button";
import { Field, SelectInput } from "@/components/ui/field";
import { appleIsExpected, appleRecoveryMessage, isAppleAnalyticalChoice } from "@/lib/apple-first-launch";
import { readAppleLaunchAvailability, runAppleInferenceDiagnostic, type AppleDiagnosticReceipt } from "@/lib/apple-native-client";
import type { PublicAgentExecutionBindingSummary } from "@/lib/agent-client";
import { resolveVdtAppMode } from "@/lib/app-mode";
import { createAiExecutionClient } from "@/lib/ai-execution-client";
import { getLocalRunnerPreset, LOCAL_RUNNER_PRESET_CATALOG, type LocalHttpModelBackendId, type LocalModelPresetId, type LocalRunnerPresetCatalogEntry } from "@/lib/execution-mode-catalog";
import { useVdtStudioStore } from "./vdt-store";

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
      data-settings-card
      data-selected={selected}
      className={clsx(
        "flex flex-col gap-3 rounded-lg border bg-white p-3 transition",
        selected ? "border-accent ring-2 ring-blue-100" : "border-line hover:border-slate-300"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold text-ink">{preset.label}</p>
        <Button
          size="sm"
          variant={selected ? "primary" : "secondary"}
          className="shrink-0"
          data-testid={`local-model-select-${preset.id}`}
          onClick={onSelect}
        >
          {selected ? "Selected" : "Select"}
        </Button>
      </div>

      <div className="space-y-2">
        <p className="text-xs leading-5 text-muted">{preset.description}</p>
        <p className="truncate rounded-md bg-slate-50 px-2 py-1.5 font-mono text-[11px] text-slate-600">
          {preset.baseUrl}
        </p>
      </div>

      {selected ? (
        <div className="space-y-2">
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
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
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="shrink-0"
              aria-label={`Refresh ${preset.label} models`}
              title={`Refresh ${preset.label} models`}
              data-testid={`local-model-refresh-${preset.id}`}
              disabled={isLoadingModels}
              onClick={onRefreshModels}
            >
              <RefreshCw className={clsx("h-3.5 w-3.5", isLoadingModels && "animate-spin")} aria-hidden="true" />
            </Button>
          </div>
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
      ) : preset.model ? (
        <p className="text-xs text-slate-500">Default model: {preset.model}</p>
      ) : null}
    </article>
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

type AppleDiagnosticStatus =
  | { kind: "running" }
  | { kind: "finished"; receipt: AppleDiagnosticReceipt }
  | { kind: "message"; message: string };

function AppleInferenceDiagnostic({ binding }: { binding: PublicAgentExecutionBindingSummary }) {
  const currentRequest = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<AppleDiagnosticStatus>();
  useEffect(() => {
    const abort = () => {
      currentRequest.current?.abort();
      currentRequest.current = null;
    };
    const resetForLanguageChange = () => {
      abort();
      setStatus(undefined);
    };
    window.addEventListener("languagechange", resetForLanguageChange);
    return () => {
      window.removeEventListener("languagechange", resetForLanguageChange);
      abort();
    };
  }, []);

  async function run() {
    if (currentRequest.current) return;
    const locale = navigator.language;
    const isCurrentBinding = () => {
      const state = useVdtStudioStore.getState();
      return navigator.language === locale && state.appleFirstLaunch?.status === "ready"
        && isAppleAnalyticalChoice(state.executionSettings.analyticalSourceChoice)
        && state.appleNativePreview?.settings === state.executionSettings
        && state.appleNativePreview.binding.bindingId === binding.bindingId;
    };
    if (!isCurrentBinding() || binding.appleIdentity?.locale !== locale) {
      setStatus({ kind: "message", message: "The selected Apple model could not be verified for this language. Reopen VDT Studio and retry." });
      return;
    }
    const controller = new AbortController();
    currentRequest.current = controller;
    const deadline = AbortSignal.timeout(22_000);
    setStatus({ kind: "running" });
    try {
      const receipt = await runAppleInferenceDiagnostic(binding, locale, AbortSignal.any([controller.signal, deadline]));
      if (currentRequest.current !== controller) return;
      if (isCurrentBinding() && !deadline.aborted) setStatus({ kind: "finished", receipt });
      else setStatus({ kind: "message", message: "The Apple inference result expired. Run the test again." });
    } catch (error) {
      if (currentRequest.current !== controller) return;
      const message = deadline.aborted ? "The Apple inference test timed out. Try again."
        : error instanceof Error ? error.message : "The Apple inference test could not be completed.";
      setStatus(isCurrentBinding() ? { kind: "message", message } : undefined);
    } finally {
      if (currentRequest.current === controller) currentRequest.current = null;
    }
  }

  function cancel() {
    currentRequest.current?.abort();
    currentRequest.current = null;
    setStatus({ kind: "message", message: "The Apple inference test was cancelled." });
  }

  return (
    <div className="space-y-2 border-t border-line pt-2">
      <p className="text-xs text-muted">Run a small on-device calculation using sample data.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => void run()} disabled={status?.kind === "running"}>
          Run inference test
        </Button>
        {status?.kind === "running" && <Button size="sm" variant="secondary" onClick={cancel}>Cancel inference test</Button>}
      </div>
      <div role="status" aria-live="polite" className="break-words text-xs text-muted">
        {status?.kind === "running" && "Running the Apple inference test…"}
        {status?.kind === "message" && status.message}
        {status?.kind === "finished" && (
          <>
            <p>Apple inference verified. {status.receipt.result.value.toLocaleString(status.receipt.locale)} {status.receipt.result.unit}.</p>
            <p>{status.receipt.identity.model} · {status.receipt.identity.profile} · macOS build {status.receipt.identity.osBuild} · {status.receipt.locale}</p>
          </>
        )}
      </div>
    </div>
  );
}

export function LocalModelSettings() {
  const executionSettings = useVdtStudioStore((state) => state.executionSettings);
  const setLocalRunnerPreset = useVdtStudioStore((state) => state.setLocalRunnerPreset);
  const setExecutionSettingsField = useVdtStudioStore((state) => state.setExecutionSettingsField);
  const appleFirstLaunch = useVdtStudioStore(state => state.appleFirstLaunch);
  const appleNativePreview = useVdtStudioStore(state => state.appleNativePreview);
  const refreshApple = useVdtStudioStore(state => state.refreshAppleAnalyticalDefault);
  const appleExpected = appleIsExpected(executionSettings.analyticalSourceChoice, appleFirstLaunch);
  const appleChosen = isAppleAnalyticalChoice(executionSettings.analyticalSourceChoice);
  const appleSelectionPending = appleFirstLaunch?.status === "checking" && appleFirstLaunch.selectManually === true;
  const [appleAvailable, setAppleAvailable] = useState(false);
  useEffect(() => {
    if (resolveVdtAppMode() !== "desktop") return;
    const controller = new AbortController();
    void readAppleLaunchAvailability(controller.signal)
      .then(result => { if (!controller.signal.aborted) setAppleAvailable(result.enabled); })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  const explicitlyRestoreApple = appleAvailable && executionSettings.analyticalSourceChoice === "apple_default"
    && appleFirstLaunch?.status === "unavailable" && !appleFirstLaunch.firstLaunchDefaultEnabled;
  const [modelsByBackend, setModelsByBackend] = useState<Partial<Record<LocalHttpModelBackendId, string[]>>>({});
  const [loadingByBackend, setLoadingByBackend] = useState<Partial<Record<LocalHttpModelBackendId, boolean>>>({});
  const [errorsByBackend, setErrorsByBackend] = useState<Partial<Record<LocalHttpModelBackendId, string | undefined>>>({});
  const selectedPreset = LOCAL_RUNNER_PRESET_CATALOG.find((preset) => preset.id === executionSettings.localRunnerPresetId && preset.runnerProviderId === "local_http_stub") ?? getLocalRunnerPreset("ollama_openai");
  const backendId = selectedPreset?.modelBackendId;

  const refreshModels = useCallback(async (id: LocalHttpModelBackendId) => {
    setLoadingByBackend((current) => ({ ...current, [id]: true }));
    setErrorsByBackend((current) => ({ ...current, [id]: undefined }));
    try {
      const models = await createAiExecutionClient().listModels(id);
      setModelsByBackend((current) => ({ ...current, [id]: models.map((model) => model.id) }));
    } catch (error) {
      setErrorsByBackend((current) => ({ ...current, [id]: error instanceof Error ? error.message : "Model list unavailable." }));
    } finally {
      setLoadingByBackend((current) => ({ ...current, [id]: false }));
    }
  }, []);

  useEffect(() => {
    if (appleExpected || !backendId || !selectedPreset) return;
    if (modelsByBackend[backendId] === undefined && !loadingByBackend[backendId] && errorsByBackend[backendId] === undefined) {
      void refreshModels(backendId);
    }
    if (appleSelectionPending) return;
    const models = modelsByBackend[backendId] ?? [];
    const model = executionSettings.localModel?.trim();
    if (models[0] && (!model || (model === selectedPreset.model && !models.includes(model)))) {
      setExecutionSettingsField("localModel", models[0]);
    }
  }, [appleExpected, appleSelectionPending, backendId, selectedPreset, modelsByBackend, loadingByBackend, errorsByBackend, executionSettings.localModel, refreshModels, setExecutionSettingsField]);

  return (
    <section className="space-y-4" data-testid="local-model-settings" aria-labelledby="local-model-settings-title">
      <div>
        <h3 id="local-model-settings-title" className="text-sm font-semibold text-ink">Local models</h3>
        <p className="mt-1 text-xs leading-5 text-muted">Use Apple on-device analytics when available, or connect to Ollama, LM Studio or vLLM on this computer.</p>
      </div>
      {(appleAvailable || appleExpected) && (
        <article data-testid="apple-local-model" className="space-y-2 rounded-lg border border-line p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">Apple on-device</span>
            <Button size="sm" variant={appleChosen ? "primary" : "secondary"} onClick={() => void refreshApple({ selectManually: !appleChosen || explicitlyRestoreApple })}
              disabled={appleFirstLaunch?.status === "checking" || appleChosen && appleFirstLaunch?.status === "ready"
                || !appleAvailable && !appleChosen}>
              {explicitlyRestoreApple ? "Select explicitly" : appleChosen
                ? appleFirstLaunch?.status === "ready" ? "Selected" : "Check availability"
                : "Select"}
            </Button>
          </div>
          {appleFirstLaunch?.status === "checking" ? <p role="status" className="text-xs text-muted">Checking Apple model availability…</p>
            : appleFirstLaunch?.status === "unavailable" ? <p role="status" className="text-xs text-amber-800">{appleRecoveryMessage(appleFirstLaunch)}</p>
            : appleChosen ? <p className="text-xs text-muted">Uses the model verified by this desktop for new requests.</p> : null}
          {appleAvailable && appleChosen && appleFirstLaunch?.status === "ready" && appleNativePreview?.settings === executionSettings
            && <AppleInferenceDiagnostic key={appleNativePreview.binding.bindingId} binding={appleNativePreview.binding} />}
        </article>
      )}
      {!appleExpected && <div className="flex flex-wrap justify-between gap-2 rounded-lg bg-slate-50 px-4 py-3 text-xs" data-testid="local-model-active-selection">
        <span className="font-semibold text-ink">{selectedPreset?.label ?? "Choose a model server"}</span>
        <span className="break-all text-muted">{executionSettings.localModel || "Choose a model"}</span>
      </div>}
      <LocalModelCards selectedPresetId={appleExpected ? undefined : selectedPreset?.id} selectedModel={executionSettings.localModel}
        modelsByBackend={modelsByBackend} isLoadingModelsByBackend={loadingByBackend} modelListErrorByBackend={errorsByBackend}
        onSelectPreset={(id) => setLocalRunnerPreset(id as LocalModelPresetId)}
        onSelectModel={(model) => setExecutionSettingsField("localModel", model)} onRefreshModels={refreshModels} />
    </section>
  );
}
