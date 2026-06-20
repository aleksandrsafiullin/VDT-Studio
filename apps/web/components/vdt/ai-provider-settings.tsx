"use client";

import { CheckCircle2, PlugZap, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, SelectInput, TextInput } from "@/components/ui/field";
import {
  LOCAL_RUNNER_PRESETS,
  useVdtStudioStore,
  type LocalRunnerPresetId,
  type ProviderId,
  type ProviderTestStatus
} from "./vdt-store";

export function AiProviderSettings() {
  const providerId = useVdtStudioStore((state) => state.providerId);
  const providerConfig = useVdtStudioStore((state) => state.providerConfig);
  const isTestingProvider = useVdtStudioStore((state) => state.isTestingProvider);
  const providerTestStatus = useVdtStudioStore((state) => state.providerTestStatus);
  const setProviderId = useVdtStudioStore((state) => state.setProviderId);
  const setProviderConfigField = useVdtStudioStore((state) => state.setProviderConfigField);
  const setProviderTestState = useVdtStudioStore((state) => state.setProviderTestState);
  const cloudBaseUrlField = providerId === "anthropic" ? "anthropicBaseUrl" : providerId === "gemini" ? "geminiBaseUrl" : "openAiBaseUrl";
  const cloudModelField = providerId === "anthropic" ? "anthropicModel" : providerId === "gemini" ? "geminiModel" : "openAiModel";

  function applyLocalRunnerPreset(presetId: LocalRunnerPresetId) {
    const preset = LOCAL_RUNNER_PRESETS.find((candidate) => candidate.id === presetId);
    if (!preset) {
      return;
    }

    setProviderConfigField("localRunnerPresetId", preset.id);
    setProviderConfigField("runnerProviderId", preset.runnerProviderId);
    if (preset.baseUrl !== undefined) {
      setProviderConfigField("localBaseUrl", preset.baseUrl);
    }
    if (preset.model !== undefined) {
      setProviderConfigField("localModel", preset.model);
    }
    if (preset.command !== undefined) {
      setProviderConfigField("command", preset.command);
    }
    if (preset.argsText !== undefined) {
      setProviderConfigField("argsText", preset.argsText);
    }
  }

  async function testLocalRunnerProvider() {
    const initialProviderFingerprint = JSON.stringify({ providerId, providerConfig });
    let nextStatus: ProviderTestStatus | undefined;
    setProviderTestState(true);

    const runnerProviderId = providerConfig.runnerProviderId ?? "local_http_stub";
    const timeoutSec = providerConfig.timeoutSec ?? 60;
    const body =
      runnerProviderId === "cli_stub"
        ? {
            providerId: runnerProviderId,
            providerConfig: {
              name: "Local CLI Model",
              command: providerConfig.command ?? "",
              args: providerConfig.argsText?.trim() ? providerConfig.argsText.trim().split(/\s+/) : undefined,
              inputMode: "stdin",
              outputMode: "stdout_json",
              timeoutSec
            },
            timeoutSec
          }
        : {
            providerId: runnerProviderId,
            providerConfig: {
              baseUrl: providerConfig.localBaseUrl ?? "http://127.0.0.1:11434/v1",
              model: providerConfig.localModel ?? "qwen3",
              apiKey: providerConfig.localApiKey || undefined
            },
            timeoutSec
          };

    try {
      const runnerUrl = (providerConfig.runnerUrl ?? "http://127.0.0.1:8765").replace(/\/$/, "");
      const response = await fetch(`${runnerUrl}/test-provider`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        models?: string[];
        error?: { message?: string };
      };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? `Local runner test failed with ${response.status}.`);
      }

      const modelList = payload.models?.length ? ` Models: ${payload.models.slice(0, 3).join(", ")}.` : "";
      nextStatus = { kind: "success", message: `Connection test passed.${modelList}` };
    } catch (error) {
      nextStatus = {
        kind: "error",
        message: error instanceof Error ? error.message : "Local runner test failed."
      };
    } finally {
      const currentState = useVdtStudioStore.getState();
      const currentProviderFingerprint = JSON.stringify({
        providerId: currentState.providerId,
        providerConfig: currentState.providerConfig
      });
      setProviderTestState(
        false,
        currentProviderFingerprint === initialProviderFingerprint ? nextStatus : undefined
      );
    }
  }

  return (
    <div className="space-y-3">
      <Field label="Provider">
        <SelectInput
          value={providerId}
          onChange={(event) => {
            setProviderId(event.target.value as ProviderId);
          }}
        >
          <option value="mock">Built-in mock</option>
          <option value="openai_compatible">OpenAI-compatible</option>
          <option value="anthropic">Anthropic</option>
          <option value="azure_openai">Azure OpenAI</option>
          <option value="gemini">Google Gemini</option>
          <option value="local_runner">Local runner</option>
        </SelectInput>
      </Field>

      {providerId === "openai_compatible" || providerId === "anthropic" || providerId === "gemini" ? (
        <>
          <Field label="Base URL">
            <TextInput
              value={providerConfig[cloudBaseUrlField] ?? ""}
              placeholder={
                providerId === "anthropic"
                  ? "https://api.anthropic.com"
                  : providerId === "gemini"
                    ? "https://generativelanguage.googleapis.com"
                    : "https://api.openai.com/v1"
              }
              onChange={(event) => setProviderConfigField(cloudBaseUrlField, event.target.value)}
            />
          </Field>
          <Field label="Model">
            <TextInput
              value={providerConfig[cloudModelField] ?? ""}
              placeholder={providerId === "anthropic" ? "claude-sonnet-4-5" : providerId === "gemini" ? "gemini-2.5-pro" : "gpt-4.1-mini"}
              onChange={(event) => setProviderConfigField(cloudModelField, event.target.value)}
            />
          </Field>
          <Field label="API key">
            <TextInput
              type="password"
              autoComplete="off"
              value={providerConfig.apiKey ?? ""}
              onChange={(event) => setProviderConfigField("apiKey", event.target.value)}
            />
          </Field>
          {providerId === "anthropic" ? (
            <Field label="API version">
              <TextInput
                value={providerConfig.anthropicVersion ?? "2023-06-01"}
                onChange={(event) => setProviderConfigField("anthropicVersion", event.target.value)}
              />
            </Field>
          ) : null}
        </>
      ) : null}

      {providerId === "azure_openai" ? (
        <>
          <Field label="Endpoint">
            <TextInput
              value={providerConfig.endpoint ?? ""}
              placeholder="https://resource.openai.azure.com"
              onChange={(event) => setProviderConfigField("endpoint", event.target.value)}
            />
          </Field>
          <Field label="Deployment">
            <TextInput
              value={providerConfig.deployment ?? ""}
              onChange={(event) => setProviderConfigField("deployment", event.target.value)}
            />
          </Field>
          <Field label="API version">
            <TextInput
              value={providerConfig.apiVersion ?? "2024-10-21"}
              onChange={(event) => setProviderConfigField("apiVersion", event.target.value)}
            />
          </Field>
          <Field label="API key">
            <TextInput
              type="password"
              autoComplete="off"
              value={providerConfig.apiKey ?? ""}
              onChange={(event) => setProviderConfigField("apiKey", event.target.value)}
            />
          </Field>
        </>
      ) : null}

      {providerId === "local_runner" ? (
        <>
          <Field label="Runner URL">
            <TextInput
              value={providerConfig.runnerUrl ?? "http://127.0.0.1:8765"}
              onChange={(event) => {
                setProviderConfigField("runnerUrl", event.target.value);
              }}
            />
          </Field>
          <Field label="Preset">
            <SelectInput
              value={providerConfig.localRunnerPresetId ?? "ollama_openai"}
              onChange={(event) => applyLocalRunnerPreset(event.target.value as LocalRunnerPresetId)}
            >
              {LOCAL_RUNNER_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Runner adapter">
            <SelectInput
              value={providerConfig.runnerProviderId ?? "local_http_stub"}
              onChange={(event) => {
                setProviderConfigField("runnerProviderId", event.target.value as "local_http_stub" | "cli_stub");
              }}
            >
              <option value="local_http_stub">Local HTTP</option>
              <option value="cli_stub">CLI JSON stdout</option>
            </SelectInput>
          </Field>

          {providerConfig.runnerProviderId === "cli_stub" ? (
            <>
              <Field label="Command">
                <TextInput
                  value={providerConfig.command ?? ""}
                  onChange={(event) => {
                    setProviderConfigField("command", event.target.value);
                  }}
                />
              </Field>
              <Field label="Args">
                <TextInput
                  value={providerConfig.argsText ?? ""}
                  onChange={(event) => {
                    setProviderConfigField("argsText", event.target.value);
                  }}
                />
              </Field>
            </>
          ) : (
            <>
              <Field label="Base URL">
                <TextInput
                  value={providerConfig.localBaseUrl ?? "http://127.0.0.1:11434/v1"}
                  onChange={(event) => {
                    setProviderConfigField("localBaseUrl", event.target.value);
                  }}
                />
              </Field>
              <Field label="Model">
                <TextInput
                  value={providerConfig.localModel ?? "qwen3"}
                  onChange={(event) => {
                    setProviderConfigField("localModel", event.target.value);
                  }}
                />
              </Field>
              <Field label="API key">
                <TextInput
                  type="password"
                  autoComplete="off"
                  value={providerConfig.localApiKey ?? ""}
                  onChange={(event) => setProviderConfigField("localApiKey", event.target.value)}
                />
              </Field>
            </>
          )}

          <Button
            className="w-full"
            size="sm"
            icon={<PlugZap className="h-4 w-4" />}
            disabled={isTestingProvider}
            onClick={() => void testLocalRunnerProvider()}
          >
            {isTestingProvider ? "Testing..." : "Test connection"}
          </Button>
          {providerTestStatus ? (
            <div
              className={
                providerTestStatus.kind === "success"
                  ? "flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-800"
                  : "flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700"
              }
              role="status"
              aria-live="polite"
            >
              {providerTestStatus.kind === "success" ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span>{providerTestStatus.message}</span>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
