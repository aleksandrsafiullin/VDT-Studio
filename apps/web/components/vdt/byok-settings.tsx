"use client";

import { useEffect, useRef, useState } from "react";
import {
  getGatewayPreset,
  type ByokGateway,
  type ByokProtocol,
  type GatewayPresetId
} from "@/lib/execution-mode-catalog";
import { resolveExecutionSettings } from "@/lib/execution-mode-resolver";
import { hasByokFieldErrors, validateByokSettings } from "@/lib/byok-validation";
import { SettingsChipRow } from "./settings-chips";
import { ByokPresetForm } from "./byok-preset-form";
import { useVdtStudioStore, type ProviderTestStatus } from "./vdt-store";

const PROTOCOL_CHIPS: { id: ByokProtocol; label: string }[] = [
  { id: "anthropic", label: "Anthropic" },
  { id: "openai", label: "OpenAI" },
  { id: "azure", label: "Azure OpenAI" },
  { id: "gemini", label: "Google Gemini" }
];

const GATEWAY_CHIPS: { id: ByokGateway; label: string }[] = [
  { id: "none", label: "Direct" },
  { id: "ollama", label: "Ollama Cloud" },
  { id: "senseaudio", label: "SenseAudio" },
  { id: "aihubmix", label: "AIHubMix" }
];

export function ByokSettings() {
  const executionSettings = useVdtStudioStore((state) => state.executionSettings);
  const isTestingProvider = useVdtStudioStore((state) => state.isTestingProvider);
  const providerTestStatus = useVdtStudioStore((state) => state.providerTestStatus);
  const setByokProtocol = useVdtStudioStore((state) => state.setByokProtocol);
  const setByokGateway = useVdtStudioStore((state) => state.setByokGateway);
  const setGatewayPreset = useVdtStudioStore((state) => state.setGatewayPreset);
  const setExecutionSettingsField = useVdtStudioStore((state) => state.setExecutionSettingsField);
  const setProviderTestState = useVdtStudioStore((state) => state.setProviderTestState);
  const byokFieldErrors = useVdtStudioStore((state) => state.byokFieldErrors);
  const setByokFieldErrors = useVdtStudioStore((state) => state.setByokFieldErrors);
  const [discoveredModels, setDiscoveredModels] = useState<readonly string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelListLoaded, setModelListLoaded] = useState(false);
  const [modelListError, setModelListError] = useState<string | undefined>();
  const modelRequestId = useRef(0);

  const protocol = executionSettings.byokProtocol ?? "openai";
  const gateway = executionSettings.byokGateway ?? "none";
  const presetId = executionSettings.gatewayPresetId ?? "openai-default";
  const preset = getGatewayPreset(presetId);
  const showPresetSelect = gateway === "none" && presetId !== "mock";

  useEffect(() => {
    modelRequestId.current += 1;
    setDiscoveredModels([]);
    setIsLoadingModels(false);
    setModelListLoaded(false);
    setModelListError(undefined);
  }, [
    executionSettings.apiKey,
    executionSettings.anthropicVersion,
    executionSettings.apiVersion,
    executionSettings.baseUrl,
    executionSettings.byokGateway,
    executionSettings.byokProtocol,
    executionSettings.customizeBaseUrl,
    executionSettings.endpoint,
    executionSettings.gatewayPresetId
  ]);

  async function loadModels() {
    if (!executionSettings.apiKey?.trim()) {
      setModelListError("Enter an API key before loading models.");
      return;
    }

    const requestId = ++modelRequestId.current;
    setIsLoadingModels(true);
    setModelListLoaded(false);
    setModelListError(undefined);

    try {
      const resolved = resolveExecutionSettings(executionSettings);
      const response = await fetch("/api/ai/generate-vdt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "list_models", ...resolved })
      });
      const payload = await response.json() as { ok?: boolean; models?: unknown; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Could not load models from the provider.");
      }

      const seen = new Set<string>();
      const models = Array.isArray(payload.models)
        ? payload.models.flatMap((value) => {
            if (typeof value !== "string") return [];
            const model = value.trim();
            if (!model || seen.has(model)) return [];
            seen.add(model);
            return [model];
          })
        : [];
      if (requestId !== modelRequestId.current) return;
      setDiscoveredModels(models);
      setModelListLoaded(true);
    } catch (error) {
      if (requestId !== modelRequestId.current) return;
      setDiscoveredModels([]);
      setModelListLoaded(false);
      setModelListError(error instanceof Error ? error.message : "Could not load models from the provider.");
    } finally {
      if (requestId === modelRequestId.current) {
        setIsLoadingModels(false);
      }
    }
  }

  async function testConnection() {
    const fingerprint = JSON.stringify(executionSettings);
    let nextStatus: ProviderTestStatus | undefined;
    setProviderTestState(true);

    try {
      if (executionSettings.gatewayPresetId === "custom") {
        const validationErrors = validateByokSettings(executionSettings, preset);
        if (hasByokFieldErrors(validationErrors)) {
          throw new Error(Object.values(validationErrors)[0] ?? "Configuration is invalid.");
        }
        const resolved = resolveExecutionSettings(executionSettings);
        const response = await fetch("/api/ai/generate-vdt", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ operation: "connection_test", ...resolved })
        });
        const payload = await response.json() as { ok?: boolean; error?: string };
        if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Connection test failed.");
        nextStatus = { kind: "success", message: "Connection test passed." };
      } else {
        const resolved = resolveExecutionSettings(executionSettings);
        const validationErrors = validateByokSettings(executionSettings, preset);
        if (hasByokFieldErrors(validationErrors)) {
          throw new Error(Object.values(validationErrors)[0] ?? "Configuration is invalid.");
        }
        const response = await fetch("/api/ai/generate-vdt", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ operation: "connection_test", ...resolved })
        });
        const payload = await response.json() as { ok?: boolean; error?: string };
        if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Connection test failed.");
        nextStatus = { kind: "success", message: "Connection test passed." };
      }
    } catch (error) {
      nextStatus = {
        kind: "error",
        message: error instanceof Error ? error.message : "Connection test failed."
      };
    } finally {
      const currentFingerprint = JSON.stringify(useVdtStudioStore.getState().executionSettings);
      setProviderTestState(false, currentFingerprint === fingerprint ? nextStatus : undefined);
    }
  }

  return (
    <div className="space-y-4" data-testid="byok-settings">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-ink">Provider routing</h3>
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <SettingsChipRow
            label="Protocol"
            options={PROTOCOL_CHIPS}
            value={protocol}
            testIdPrefix="byok-protocol"
            onChange={(nextProtocol) => setByokProtocol(nextProtocol)}
          />

          <SettingsChipRow
            label="Gateway"
            options={GATEWAY_CHIPS}
            value={gateway}
            testIdPrefix="byok-gateway"
            onChange={(nextGateway) => setByokGateway(nextGateway)}
          />
        </div>
      </section>

      <ByokPresetForm
        executionSettings={executionSettings}
        preset={preset}
        protocol={protocol}
        showPresetSelect={showPresetSelect}
        showPresetLabel={!showPresetSelect}
        isTesting={isTestingProvider}
        testStatus={providerTestStatus}
        discoveredModels={discoveredModels}
        isLoadingModels={isLoadingModels}
        modelListLoaded={modelListLoaded}
        modelListError={modelListError}
        onPresetChange={(nextPresetId: GatewayPresetId) => setGatewayPreset(nextPresetId)}
        onFieldChange={(field, value) => setExecutionSettingsField(field, value)}
        fieldErrors={byokFieldErrors}
        onFieldErrorsChange={setByokFieldErrors}
        onLoadModels={() => void loadModels()}
        onTest={() => void testConnection()}
      />
    </div>
  );
}
