"use client";

import { useEffect, useMemo, useState } from "react";
import type { ModelReasoningValue } from "@vdt-studio/ai-harness/browser";
import { Field, SelectInput, TextInput } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { providerModelSource } from "@/lib/provider-model-catalog";
import { resolveExecutionSettings } from "@/lib/execution-mode-resolver";
import { resolveSmartKpiSettings, smartKpiPreferences, smartKpiReasoning, smartKpiSourceKey, updateSmartKpiPreferences } from "@/lib/smart-kpi-settings";
import { isReasoningOffValue, loadSmartKpiModelCatalog, loadSmartKpiReasoningValues, smartReasoningLabel } from "@/lib/smart-kpi-settings-client";
import { useVdtStudioStore } from "./vdt-store";

export function SmartKpiSettings() {
  const settings = useVdtStudioStore(state => state.executionSettings);
  const setField = useVdtStudioStore(state => state.setExecutionSettingsField);
  const discovered = useVdtStudioStore(state => state.cliDiscoveredModelsByAgent);
  const pairingToken = useVdtStudioStore(state => state.runnerPairingToken);
  const [manualModel, setManualModel] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loaded, setLoaded] = useState<{ identity: object; loading: boolean; models?: string[]; reasoning?: ModelReasoningValue[] | undefined; modelError?: string; reasoningError?: string }>();
  const preferences = smartKpiPreferences(settings), effective = resolveSmartKpiSettings(settings);
  const execution = resolveExecutionSettings(effective), chat = resolveExecutionSettings(settings);
  const source = providerModelSource(effective), sourceKey = smartKpiSourceKey(effective);
  const modelId = String(execution.providerConfig?.model ?? "auto"), apiKey = source.apiKey;
  const needsKey = source.source.category === "byok" && source.source.providerId !== "mock" && !apiKey?.trim();
  const request = useMemo(() => ({ identity: {}, sourceKey, apiKey, modelId, pairingToken, refresh }), [sourceKey, apiKey, modelId, pairingToken, refresh]);
  const current = loaded?.identity === request.identity ? loaded : undefined;
  const rememberedModels = !pairingToken && source.source.category === "cli_subscriptions" && settings.selectedCliAgentId ? discovered[settings.selectedCliAgentId] ?? [] : [];
  const models = [...new Set([...(current?.models ?? rememberedModels), ...(preferences.model ? [preferences.model] : [])])];
  const selectedReasoning = smartKpiReasoning(settings), values = current?.reasoning;
  const supportsOff = values?.some(isReasoningOffValue), offUnsupported = values !== undefined && !supportsOff;
  const levels = [...new Set(values?.filter(value => !isReasoningOffValue(value)).map(value => JSON.stringify(value)) ?? [])].map(value => JSON.parse(value) as ModelReasoningValue);
  const selectedKey = JSON.stringify(selectedReasoning ?? null);
  const missingLevel = selectedReasoning !== undefined && selectedReasoning !== false && !levels.includes(selectedReasoning);

  useEffect(() => { setManualModel(""); }, [sourceKey]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController(), identity = request.identity;
    if (needsKey) {
      setLoaded({ identity, loading: false, models: [] });
      return () => { active = false; controller.abort(); };
    }
    setLoaded({ identity, loading: true });
    void Promise.allSettled([
      loadSmartKpiModelCatalog(effective, controller.signal, { pairingToken: request.pairingToken }),
      loadSmartKpiReasoningValues(effective, controller.signal, { pairingToken: request.pairingToken })
    ]).then(([catalog, reasoning]) => {
      if (!active) return;
      setLoaded({ identity, loading: false,
        ...(catalog.status === "fulfilled" ? { models: catalog.value } : { modelError: "Could not load models. You can enter the model ID below." }),
        ...(reasoning.status === "fulfilled" ? { reasoning: reasoning.value } : { reasoningError: "Could not verify reasoning options for this model." })
      });
    });
    return () => { active = false; controller.abort(); };
    // The request identity includes the destination, credential, selected model
    // and explicit refresh. A late response cannot replace a new selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const setPreference = (patch: Parameters<typeof updateSmartKpiPreferences>[1]) =>
    setField("smartKpiBySource", updateSmartKpiPreferences(useVdtStudioStore.getState().executionSettings, patch));

  return <section className="space-y-3 rounded-xl border border-line p-4" data-testid="smart-kpi-settings" aria-label="Suggested KPI settings">
    <div className="flex items-start justify-between gap-3">
      <div><h3>Suggested KPI</h3><p className="mt-1 text-xs leading-5 text-muted">Uses the selected connection. Model and reasoning are separate from chat.</p></div>
      <Button size="sm" variant="ghost" onClick={() => setRefresh(value => value + 1)} disabled={current?.loading} aria-label="Refresh Suggested KPI model options">Refresh</Button>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Model">
        <SelectInput aria-label="Suggested KPI model" data-testid="smart-kpi-model" value={preferences.model ?? ""} onChange={event => setPreference({ model: event.target.value || null })}>
          <option value="">Same as chat · {String(chat.providerConfig?.model ?? "Provider default")}</option>
          {models.map(model => <option key={model} value={model}>{model}</option>)}
        </SelectInput>
      </Field>
      <Field label="Reasoning">
        <SelectInput aria-label="Suggested KPI reasoning" data-testid="smart-kpi-reasoning" value={selectedKey}
          onChange={event => setPreference({ reasoning: JSON.parse(event.target.value) as ModelReasoningValue | null })}>
          <option value="false" disabled={offUnsupported}>Off{offUnsupported ? " — unsupported" : values === undefined ? " (requested)" : ""}</option>
          <option value="null">Provider default</option>
          {levels.map(level => <option key={JSON.stringify(level)} value={JSON.stringify(level)}>{smartReasoningLabel(level)}</option>)}
          {missingLevel ? <option value={selectedKey} disabled>{smartReasoningLabel(selectedReasoning)} — recheck availability</option> : null}
        </SelectInput>
      </Field>
    </div>
    <p className="text-xs leading-5 text-muted">Reasoning is requested off by default for faster suggestions. Changes apply to new preparations.</p>
    {selectedReasoning === false && offUnsupported ? <p className="text-xs leading-5 text-amber-700" role="status">This model does not advertise a way to disable reasoning. Choose another model or explicitly select Provider default.</p> : null}
    {current?.loading ? <p className="text-xs text-muted" role="status">Checking model options…</p> : null}
    {needsKey ? <p className="text-xs text-muted" role="status">Add an API key in provider settings above to load models and reasoning options.</p> : null}
    {!needsKey && (current?.modelError || current?.reasoningError) ? <p className="text-xs text-muted" role="status">{[current?.modelError, current?.reasoningError].filter(Boolean).join(" ")}</p> : null}
    <details className="text-xs text-muted"><summary className="cursor-pointer">Enter model ID manually</summary>
      <div className="mt-2 flex items-end gap-2"><Field label="Model ID"><TextInput aria-label="Suggested KPI model ID" value={manualModel} maxLength={160} onChange={event => setManualModel(event.target.value)} /></Field>
        <Button size="sm" variant="secondary" disabled={!manualModel.trim()} onClick={() => { setPreference({ model: manualModel.trim() }); setManualModel(""); }}>Use model</Button></div>
    </details>
  </section>;
}
