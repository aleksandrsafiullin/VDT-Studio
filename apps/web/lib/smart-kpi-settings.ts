import { isModelReasoningValue, modelReasoningKey, type ModelReasoningValue } from "@vdt-studio/ai-harness/browser";
import type { ExecutionSettings, SmartKpiModelPreferences } from "./execution-mode-catalog";
import { resolveExecutionCategory } from "./execution-category";
import { resolveExecutionSettings } from "./execution-mode-resolver";

const validModel = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0
  && value === value.trim() && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value);

/** No model, credential or catalog timestamp can make another connection's
 * preferences authoritative. Local runner destinations remain independent. */
export function smartKpiSourceKey(settings: ExecutionSettings): string {
  const { providerId, providerConfig: config = {} } = resolveExecutionSettings(settings);
  return JSON.stringify([providerId, config.backendId ?? "", config.endpoint ?? config.baseUrl ?? "", config.runnerUrl ?? "",
    config.apiVersion ?? "", config.anthropicVersion ?? ""]);
}

export function smartKpiPreferences(settings: ExecutionSettings): SmartKpiModelPreferences {
  const value = settings.smartKpiBySource?.[smartKpiSourceKey(settings)];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return {
    ...(validModel(value.model) ? { model: value.model } : {}),
    ...(value.reasoningByModel && typeof value.reasoningByModel === "object" && !Array.isArray(value.reasoningByModel)
      ? { reasoningByModel: Object.fromEntries(Object.entries(value.reasoningByModel).filter(([key, reasoning]) => validModel(key) && (reasoning === null || isModelReasoningValue(reasoning))).slice(-128)) } : {})
  };
}

/** Settings-only projection. The caller still admits the exact selected model
 * through the current host, and the source settings stay untouched. */
export function resolveSmartKpiSettings(settings: ExecutionSettings): ExecutionSettings {
  const preference = smartKpiPreferences(settings);
  const category = resolveExecutionCategory(settings);
  const cliSelection = { ...(settings.cliModelSelection ?? { source: "agent_default" as const }) };
  delete cliSelection.reasoningEffort;
  const effective: ExecutionSettings = {
    ...settings,
    cliModelSelection: { ...cliSelection },
    modelReasoningBySource: undefined
  };
  if (preference.model) {
    if (category === "cli_subscriptions") effective.cliModelSelection = { source: "custom", customModel: preference.model };
    else if (category === "local_models") effective.localModel = preference.model;
    else if (settings.byokProtocol === "azure") { effective.deployment = preference.model; effective.model = preference.model; }
    else effective.model = preference.model;
  }
  const { providerId, providerConfig: config = {} } = resolveExecutionSettings(effective);
  const model = String(config.model ?? "auto");
  const reasoning = preference.reasoningByModel?.[model];
  effective.modelReasoningBySource = reasoning === null ? {} : { [modelReasoningKey(providerId, config)]: isModelReasoningValue(reasoning) ? reasoning : false };
  return effective;
}

export function smartKpiReasoning(settings: ExecutionSettings): ModelReasoningValue | undefined {
  return resolveExecutionSettings(resolveSmartKpiSettings(settings)).providerConfig?.modelReasoning as ModelReasoningValue | undefined;
}

export function updateSmartKpiPreferences(settings: ExecutionSettings, patch: { model?: string | null; reasoning?: ModelReasoningValue | null }): Record<string, SmartKpiModelPreferences> {
  const key = smartKpiSourceKey(settings), current = smartKpiPreferences(settings);
  const next: SmartKpiModelPreferences = { ...current };
  if (patch.model !== undefined) {
    if (patch.model === null) delete next.model;
    else if (validModel(patch.model)) next.model = patch.model;
  }
  if (patch.reasoning === null || isModelReasoningValue(patch.reasoning)) {
    const effective = resolveExecutionSettings(resolveSmartKpiSettings(settings));
    next.reasoningByModel = { ...Object.fromEntries(Object.entries(current.reasoningByModel ?? {}).slice(-127)), [String(effective.providerConfig?.model ?? "auto")]: patch.reasoning };
  }
  return { ...Object.fromEntries(Object.entries(settings.smartKpiBySource ?? {}).filter(([entry]) => entry !== key).slice(-127)), [key]: next };
}
