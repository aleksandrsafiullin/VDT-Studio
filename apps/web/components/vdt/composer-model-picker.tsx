"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { Check, ChevronDown, LoaderCircle, RotateCcw, SlidersHorizontal } from "lucide-react";
import type { ReasoningEffort } from "@vdt-studio/model-bridge";
import { modelReasoningKey, type ModelReasoningValue } from "@vdt-studio/ai-harness/browser";
import { createAgentClient, type AgentExecutionBindingSelection } from "@/lib/agent-client";
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
  const [open, setOpen] = useState(false);
  const [manualModel, setManualModel] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const [loaded, setLoaded] = useState<{
    identity: object; models?: string[]; bindings?: AgentExecutionBindingSelection;
    loading: boolean; error?: string | undefined;
  }>();
  const container = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
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
  const current = loaded?.identity === request.identity ? loaded : undefined;
  const catalog = current?.bindings ?? shared.catalog ?? shared.bindings;
  const cliModels = current?.models ?? (settings.selectedCliAgentId ? discovered[settings.selectedCliAgentId] : []);
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
    if (!open) return;
    let cancelled = false;
    const controller = new AbortController();
    const identity = request.identity;
    setLoaded((previous) => ({ ...(previous?.identity === identity ? previous : {}), identity, loading: true, error: undefined }));
    const requestSource = JSON.parse(request.sourceKey) as ProviderModelSource;
    void Promise.allSettled([
      loadProviderModelCatalog(requestSource, request.apiKey, { signal: controller.signal }),
      requestSource.category === "cli_subscriptions" ? createAgentClient().getExecutionBindings() : Promise.resolve(undefined)
    ]).then(([models, bindings]) => {
      if (cancelled) return;
      setLoaded({ identity, loading: false,
        ...(models.status === "fulfilled" ? { models: models.value } : { error: models.reason instanceof Error ? models.reason.message : "Could not load models. Reopen to try again." }),
        ...(bindings.status === "fulfilled" && bindings.value ? { bindings: bindings.value } : requestSource.category === "cli_subscriptions" && models.status === "fulfilled"
          ? { error: "Could not check model availability. Reopen to try again." } : {})
      });
    });
    return () => { cancelled = true; controller.abort(); };
  }, [request, open]);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLInputElement>('input[name="' + id + '-model"]:checked')?.focus();
    function pointerDown(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function keyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation(); setOpen(false); button.current?.focus();
    }
    document.addEventListener("pointerdown", pointerDown);
    document.addEventListener("keydown", keyDown);
    return () => {
      document.removeEventListener("pointerdown", pointerDown);
      document.removeEventListener("keydown", keyDown);
    };
  }, [id, open]);

  function selectModel(model: string) {
    if (locked) return;
    if (options.category === "cli_subscriptions" && settings.selectedCliAgentId) {
      setCliModel(settings.selectedCliAgentId, model === "auto" ? { source: "agent_default" } : { source: "custom", customModel: model });
    } else setField(options.category === "local_models" ? "localModel" : source.source.providerId === "azure_openai" ? "deployment" : "model", model);
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
        onClick={() => { if (!open) setModelQuery(""); setOpen((value) => !value); }} data-testid="execution-mode-configure"
        aria-label={`Choose model. ${modelLabel}. ${providerLabel}: ${readiness.label}`}
        title={`${[providerLabel, effortLabel, readiness.label].filter(Boolean).join(" · ")}. ${readiness.message}`}
        aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}>
        <ExecutionReadinessDot state={readiness.state} />
        <span className={styles.modelName} data-testid="execution-mode-summary">{modelLabel}</span>
        <ChevronDown size={12} className="shrink-0" aria-hidden="true" />
      </button>
      {open ? (
        <div ref={panel} id={id} role="dialog" aria-label="Model and reasoning" className={styles.modelPopover} data-testid="composer-model-picker">
          <p className={styles.modelPickerHeading}>Model <span>{providerLabel}</span></p>
          {options.models.length > 10 ? <input className={styles.modelSearch} aria-label="Search models" placeholder="Search models…" value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} /> : null}
          <fieldset className={styles.modelOptions} disabled={locked}>
            <legend className="sr-only">Model</legend>
            {visibleModels.map((model) => (
              <label key={model.id} className={styles.modelOption}>
                <input type="radio" className="sr-only" name={`${id}-model`} value={model.id}
                  checked={options.selectedModel === model.id} disabled={!model.available}
                  onChange={() => selectModel(model.id)} />
                <span>{model.label}{!model.available ? <small>Unavailable for chat</small> : null}</span>
                {options.selectedModel === model.id ? <Check size={15} aria-hidden="true" /> : null}
              </label>
            ))}
          </fieldset>
          {!visibleModels.length ? <p className={styles.modelPickerNotice}>No matching models.</p> : null}
          {options.category !== "cli_subscriptions" ? <details className={styles.manualModel}>
            <summary>Enter {source.source.providerId === "azure_openai" ? "deployment" : "model"} manually</summary>
            <label htmlFor={`${id}-manual`} className="sr-only">{source.source.providerId === "azure_openai" ? "Deployment name" : "Model ID"}</label>
            <div><input id={`${id}-manual`} value={manualModel} maxLength={160} disabled={locked}
              onChange={(event) => setManualModel(event.target.value)} onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); if (manualModel.trim()) selectModel(manualModel.trim()); }
              }} placeholder={source.source.providerId === "azure_openai" ? "Deployment name" : "Model ID"} />
              <button type="button" disabled={locked || !manualModel.trim()} onClick={() => selectModel(manualModel.trim())}>Use</button></div>
          </details> : null}
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
            </> : <p className={styles.modelPickerNotice}>{(options.category === "cli_subscriptions" ? current?.loading : providerConnection?.state === "checking") ? "Checking reasoning options…" : "Reasoning controls are unavailable for this provider/model."}</p>}
            {!hasReasoning && selectedEffort !== undefined ? <button type="button" className={styles.modelSettingsLink} onClick={() => selectEffort()}>Reset reasoning to default</button> : null}
          </fieldset>
          {hasReasoning ? <p className={styles.modelPickerNotice}>Applies to new chat runs.</p> : null}
          {options.category !== "cli_subscriptions" && providerConnection?.state === "warning" ? <p className={styles.modelPickerNotice} role="status">{providerConnection.message}</p> : null}
          {locked ? <p className={styles.modelPickerNotice}>Finish this run or start a new chat to change the model or reasoning.</p> : null}
          {current?.loading ? <p className={styles.modelPickerNotice} role="status"><LoaderCircle size={13} className="animate-spin" aria-hidden="true" />Loading models…</p> : null}
          {current && !current.loading && !current.error && !current.models?.length ? <p className={styles.modelPickerNotice}>No fresh model catalog is available. Showing configured and previously discovered models.</p> : null}
          {current?.error ? <p className={styles.modelPickerNotice} role="status">{current.error}</p> : null}
          <button type="button" className={styles.modelSettingsLink} onClick={() => {
            setOpen(false); onOpenSettings();
          }}><SlidersHorizontal size={14} aria-hidden="true" />Provider settings</button>
        </div>
      ) : null}
    </div>
  );
}
