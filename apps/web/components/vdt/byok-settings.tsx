"use client";

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

  const protocol = executionSettings.byokProtocol ?? "openai";
  const gateway = executionSettings.byokGateway ?? "none";
  const presetId = executionSettings.gatewayPresetId ?? "openai-default";
  const preset = getGatewayPreset(presetId);
  const showPresetSelect = gateway === "none" && presetId !== "mock";

  async function testConnection() {
    const fingerprint = JSON.stringify(executionSettings);
    let nextStatus: ProviderTestStatus | undefined;
    setProviderTestState(true);

    try {
      if (executionSettings.useMockProvider || executionSettings.gatewayPresetId === "mock") {
        nextStatus = { kind: "success", message: "Mock provider is ready for offline generation." };
      } else if (executionSettings.gatewayPresetId === "custom") {
        const validationErrors = validateByokSettings(executionSettings, preset);
        if (hasByokFieldErrors(validationErrors)) {
          throw new Error(Object.values(validationErrors)[0] ?? "Configuration is invalid.");
        }
        nextStatus = { kind: "success", message: "Configuration looks valid. Ready to generate." };
      } else {
        const resolved = resolveExecutionSettings(executionSettings);
        if (resolved.providerId === "mock") {
          nextStatus = { kind: "success", message: "Mock provider is ready for offline generation." };
        } else {
          const validationErrors = validateByokSettings(executionSettings, preset);
          if (hasByokFieldErrors(validationErrors)) {
            throw new Error(Object.values(validationErrors)[0] ?? "Configuration is invalid.");
          }
          nextStatus = {
            kind: "success",
            message: `Configuration looks valid for ${resolved.providerId.replace(/_/g, " ")}.`
          };
        }
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

      <ByokPresetForm
        executionSettings={executionSettings}
        preset={preset}
        protocol={protocol}
        showPresetSelect={showPresetSelect}
        isTesting={isTestingProvider}
        testStatus={providerTestStatus}
        onPresetChange={(nextPresetId: GatewayPresetId) => setGatewayPreset(nextPresetId)}
        onFieldChange={(field, value) => setExecutionSettingsField(field, value)}
        fieldErrors={byokFieldErrors}
        onFieldErrorsChange={setByokFieldErrors}
        onTest={() => void testConnection()}
        onUseMock={() => setGatewayPreset("mock")}
      />
    </div>
  );
}
