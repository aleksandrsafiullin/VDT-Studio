"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, LoaderCircle, RotateCcw, SlidersHorizontal } from "lucide-react";
import type { ReasoningEffort } from "@vdt-studio/model-bridge";
import { modelReasoningKey, type ModelReasoningValue } from "@vdt-studio/ai-harness/browser";
import { useCliConnectionCheck } from "@/lib/cli-connection-state";
import type { CliRequestReadiness, CliRequestReadinessState } from "@/lib/cli-readiness";
import { composerModelOptions, reasoningSliderSteps, REASONING_LABELS } from "@/lib/composer-model-options";
import { loadProviderModelCatalog, providerModelSource, type ProviderModelSource } from "@/lib/provider-model-catalog";
import { providerConnectionKey } from "@/lib/provider-connection";
import { useProviderConnectionCheck } from "@/lib/provider-connection-state";
import { resolveExecutionSettings } from "@/lib/execution-mode-resolver";
import { useVdtStudioStore } from "./vdt-store";
import styles from "./agent-chat.module.css";

export function ExecutionReadinessDot({ state }: { state: CliRequestReadinessState }) {
  const statusClass = { checking: "bg-slate-400", ready: "bg-emerald-500", warning: "bg-amber-500", not_installed: "bg-red-500" }[state];
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusClass}`} data-testid="execution-mode-status-dot" data-readiness={state} aria-hidden="true" />;
}

export function ComposerModelPicker({ modelLabel, providerLabel, readiness, locked, onOpenSettings }: {
  modelLabel: string;
  providerLabel: string;
  readiness: Pick<CliRequestReadiness, "state" | "label" | "message">;
  locked: boolean;
  onOpenSettings: () => void;
}) {
  const [view, setView] = useState<"summary" | "models" | null>(null);
  const open = view !== null;
  const showModels = view === "models";
  const [manualModel, setManualModel] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const [loaded, setLoaded] = useState<{
    identity: object; models?: string[];
    loading: boolean; error?: string | undefined;
  }>();
  const container = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const modelTrigger = useRef<HTMLButtonElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const id = useId();
  const settings = useVdtStudioStore((state) => state.executionSettings);
  const discovered = useVdtStudioStore((state) => state.cliDiscoveredModelsByAgent);
  const setCliModel = useVdtStudioStore((state) => state.setCliModelForAgent);
  const setField = useVdtStudioStore((state) => state.setExecutionSettingsField);
  const shared = useCliConnectionCheck();
  const providerCheck = useProviderConnectionCheck();
  const providerConnection = providerCheck.key === providerConnectionKey(settings) ? providerCheck : undefined;
  const source = providerModelSource(settings);
  const sourceKey = JSON.stringify(source.source);
  const apiKey = source.apiKey;
  const request = useMemo(() => ({ sourceKey, apiKey, identity: {} }), [sourceKey, apiKey]);
  const isCli = source.source.category === "cli_subscriptions";
  const current = !isCli && loaded?.identity === request.identity ? loaded : undefined;
  const catalog = shared.catalog ?? shared.bindings;
  const cliModels = settings.selectedCliAgentId ? discovered[settings.selectedCliAgentId] : [];
  const hasCliCatalog = catalog?.bindings.some((binding) => binding.backendId === source.source.backendId);
  const checkingCliCatalog = isCli && !hasCliCatalog && shared.checking;
  const options = composerModelOptions(settings, catalog, cliModels, current?.models);
  const visibleModels = options.models.length > 10 ? options.models.filter((model) => model.label.toLowerCase().includes(modelQuery.trim().toLowerCase())) : options.models;
  const execution = resolveExecutionSettings(settings);
  const steps: Array<ModelReasoningValue | undefined> = options.category === "cli_subscriptions"
    ? reasoningSliderSteps(options.reasoningEfforts) : [undefined, ...(providerConnection?.capabilities?.values ?? [])];
  const hasReasoning = steps.length > 1;
  const selectedEffort = options.category === "cli_subscriptions" ? settings.cliModelSelection?.reasoningEffort
    : typeof execution.providerConfig?.modelReasoning === "boolean" || typeof execution.providerConfig?.modelReasoning === "string" || typeof execution.providerConfig?.modelReasoning === "number" ? execution.providerConfig.modelReasoning : undefined;
  const sliderValue = Math.max(0, steps.indexOf(selectedEffort));
  const reasoningLabel = (value: ModelReasoningValue | undefined) => value === undefined ? "Default" : value === false ? "Off" : value === true ? "On" : typeof value === "number" ? value === 0 ? "Off (0 tokens)" : `${value.toLocaleString()} tokens`
    : REASONING_LABELS[value as ReasoningEffort] ?? value.charAt(0).toUpperCase() + value.slice(1);
  const selectedEffortLabel = reasoningLabel(selectedEffort);
  const effortLabel = selectedEffort === undefined ? "Default reasoning" : selectedEffortLabel;

  useEffect(() => {
    if (!showModels || isCli) return;
    const controller = new AbortController();
    const { identity } = request;
    setLoaded((previous) => ({ ...(previous?.identity === identity ? previous : {}), identity, loading: true, error: undefined }));
    const requestSource = JSON.parse(request.sourceKey) as ProviderModelSource;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]);
    void loadProviderModelCatalog(requestSource, request.apiKey, { signal }).then((models) => {
      if (!controller.signal.aborted) setLoaded({ identity, loading: false, models });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setLoaded((previous) => ({
        ...(previous?.identity === identity ? previous : {}),
        identity, loading: false,
        error: signal.aborted ? "Model discovery timed out. Reopen to try again."
          : error instanceof Error ? error.message : "Could not load models. Reopen to try again."
      }));
    });
    return () => controller.abort();
  }, [request, showModels, isCli]);

  useEffect(() => {
    if (view === "summary") {
      modelTrigger.current?.focus();
    } else if (view === "models") {
      const selected = panel.current?.querySelector<HTMLInputElement>(`input[name="${id}-model"]:checked:not(:disabled)`);
      (selected ?? back.current)?.focus();
    }
  }, [id, view]);

  useEffect(() => {
    if (!open) return;
    function pointerDown(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setView(null);
    }
    function keyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (showModels) setView("summary");
      else { setView(null); button.current?.focus(); }
    }
    document.addEventListener("pointerdown", pointerDown);
    document.addEventListener("keydown", keyDown);
    return () => {
      document.removeEventListener("pointerdown", pointerDown);
      document.removeEventListener("keydown", keyDown);
    };
  }, [open, showModels]);

  function selectModel(model: string) {
    if (locked) return;
    if (options.category === "cli_subscriptions" && settings.selectedCliAgentId) {
      setCliModel(settings.selectedCliAgentId, model === "auto" ? { source: "agent_default" } : { source: "custom", customModel: model });
    } else setField(options.category === "local_models" ? "localModel" : source.source.providerId === "azure_openai" ? "deployment" : "model", model);
    setView("summary");
  }

  function selectEffort(value?: ModelReasoningValue) {
    if (locked) return;
    if (options.category === "cli_subscriptions") {
      if (!settings.selectedCliAgentId || (value !== undefined && (typeof value !== "string" || !(value in REASONING_LABELS)))) return;
      setCliModel(settings.selectedCliAgentId, { ...(settings.cliModelSelection ?? { source: "agent_default" }), reasoningEffort: value as ReasoningEffort | undefined });
      return;
    }
    const key = modelReasoningKey(execution.providerId, execution.providerConfig);
    const selections = Object.fromEntries(Object.entries(settings.modelReasoningBySource ?? {}).filter(([entry]) => entry !== key).slice(-127));
    if (value !== undefined) selections[key] = value;
    setField("modelReasoningBySource", selections);
  }

  return (
    <div ref={container} className={styles.modelPicker}>
      <button ref={button} type="button" className={styles.modelButton}
        onClick={() => setView(open ? null : "summary")} data-testid="execution-mode-configure"
        aria-label={`Choose model. ${modelLabel}. ${providerLabel}: ${readiness.label}`}
        title={`${[providerLabel, effortLabel, readiness.label].filter(Boolean).join(" · ")}. ${readiness.message}`}
        aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}>
        <ExecutionReadinessDot state={readiness.state} />
        <span className={styles.modelName} data-testid="execution-mode-summary">{modelLabel}</span>
        <ChevronDown size={12} className="shrink-0" aria-hidden="true" />
      </button>
      {open ? (
        <div ref={panel} id={id} role="dialog" aria-label={showModels ? "Select model" : "Model and reasoning"} className={styles.modelPopover} data-testid="composer-model-picker">
          {showModels ? <>
            <div className={styles.modelPickerHeading}>
              <button ref={back} type="button" className={styles.modelPickerBack} aria-label="Back to model and reasoning"
                onClick={() => setView("summary")}><ChevronLeft size={16} aria-hidden="true" /></button>
              Select model <span>{providerLabel}</span>
            </div>
            {options.models.length > 10 ? <input className={styles.modelSearch} aria-label="Search models" placeholder="Search models…" value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} /> : null}
            <fieldset className={styles.modelOptions} disabled={locked}>
              <legend className="sr-only">Model</legend>
              {visibleModels.map((model) => (
                <label key={model.id} className={styles.modelOption}>
                  <input type="radio" className="sr-only" name={`${id}-model`} value={model.id}
                    checked={options.selectedModel === model.id} disabled={!model.available}
                    onClick={() => { if (options.selectedModel === model.id) setView("summary"); }}
                    onChange={() => selectModel(model.id)} />
                  <span>{model.label}{!model.available ? <small>Unavailable for chat</small> : null}</span>
                  {options.selectedModel === model.id ? <Check size={15} aria-hidden="true" /> : null}
                </label>
              ))}
            </fieldset>
            {!visibleModels.length && !current?.loading ? <p className={styles.modelPickerNotice}>No matching models.</p> : null}
            {options.category !== "cli_subscriptions" ? <details className={styles.manualModel}>
              <summary>Enter {source.source.providerId === "azure_openai" ? "deployment" : "model"} manually</summary>
              <label htmlFor={`${id}-manual`} className="sr-only">{source.source.providerId === "azure_openai" ? "Deployment name" : "Model ID"}</label>
              <div><input id={`${id}-manual`} value={manualModel} maxLength={160} disabled={locked}
                onChange={(event) => setManualModel(event.target.value)} onKeyDown={(event) => {
                  if (event.key === "Enter") { event.preventDefault(); if (manualModel.trim()) selectModel(manualModel.trim()); }
                }} placeholder={source.source.providerId === "azure_openai" ? "Deployment name" : "Model ID"} />
                <button type="button" disabled={locked || !manualModel.trim()} onClick={() => selectModel(manualModel.trim())}>Use</button></div>
            </details> : null}
            {current?.loading ? <p className={styles.modelPickerNotice} role="status"><LoaderCircle size={13} className="animate-spin" aria-hidden="true" />Loading models…</p> : null}
            {current && !current.loading && !current.error && !current.models?.length ? <p className={styles.modelPickerNotice}>No fresh model catalog is available. Showing configured and previously discovered models.</p> : null}
            {current?.error ? <p className={styles.modelPickerNotice} role="status">{current.error}</p> : null}
          </> : <>
            <button ref={modelTrigger} type="button" className={styles.modelDetailsTrigger} data-testid="composer-model-list-trigger"
              aria-label={`Select model. Current model ${modelLabel}`}
              onClick={() => { setModelQuery(""); setView("models"); }}>
              <span><small>Model</small><strong>{modelLabel}</strong></span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
            <fieldset className={styles.reasoningOptions} disabled={locked}>
              <legend>Reasoning</legend>
              {hasReasoning ? <>
                <div className={styles.reasoningHeader}>
                  <output htmlFor={`${id}-reasoning`} data-testid="composer-reasoning-value">{selectedEffortLabel}</output>
                  <button type="button" aria-label="Reset reasoning to provider default" title="Reset to provider default"
                    disabled={locked || selectedEffort === undefined} onClick={() => selectEffort()}><RotateCcw size={14} aria-hidden="true" /></button>
                </div>
                <div className={styles.reasoningControl} style={{ "--reasoning-fill": `${sliderValue / (steps.length - 1) * 100}%` } as CSSProperties}>
                  <input id={`${id}-reasoning`} type="range" min={0} max={steps.length - 1} step={1} value={sliderValue}
                    aria-label="Reasoning effort" aria-valuetext={selectedEffortLabel} data-testid="composer-reasoning-slider"
                    onChange={(event) => selectEffort(steps[Number(event.target.value)])} />
                  <div className={styles.reasoningTicks} aria-hidden="true">{steps.map((effort, index) => (
                    <span key={effort === undefined ? "provider_default" : JSON.stringify([typeof effort, effort])} style={{ left: `${index / (steps.length - 1) * 100}%` }} />
                  ))}</div>
                </div>
                <div className={styles.reasoningEnds} aria-hidden="true"><span>Default</span><span>{reasoningLabel(steps[steps.length - 1])}</span></div>
              </> : <p className={styles.modelPickerNotice}>{(isCli ? checkingCliCatalog : providerConnection?.state === "checking") ? "Checking reasoning options…" : "Reasoning controls are unavailable for this provider/model."}</p>}
              {!hasReasoning && selectedEffort !== undefined ? <button type="button" className={styles.modelSettingsLink} onClick={() => selectEffort()}>Reset reasoning to default</button> : null}
            </fieldset>
            {hasReasoning ? <p className={styles.modelPickerNotice}>Applies to new chat runs.</p> : null}
            {options.category !== "cli_subscriptions" && providerConnection?.state === "warning" ? <p className={styles.modelPickerNotice} role="status">{providerConnection.message}</p> : null}
            {locked ? <p className={styles.modelPickerNotice}>Finish this run or start a new chat to change the model or reasoning.</p> : null}
            {isCli && !hasCliCatalog && !checkingCliCatalog && readiness.state === "warning"
              ? <p className={styles.modelPickerNotice} role="status">{readiness.message}</p> : null}
            <button type="button" className={styles.modelSettingsLink} onClick={() => {
              setView(null); onOpenSettings();
            }}><SlidersHorizontal size={14} aria-hidden="true" />Provider settings</button>
          </>}
        </div>
      ) : null}
    </div>
  );
}
