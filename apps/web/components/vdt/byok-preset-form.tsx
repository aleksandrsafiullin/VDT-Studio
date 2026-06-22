"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Eye, EyeOff, Info, PlugZap } from "lucide-react";
import { clsx } from "clsx";
import { Button } from "@/components/ui/button";
import { Field, SelectInput, TextInput } from "@/components/ui/field";
import {
  type ByokFieldErrors,
  clearByokFieldError,
  hasByokFieldErrors,
  validateByokSettings
} from "@/lib/byok-validation";
import {
  getGatewayPreset,
  listPresetsForProtocol,
  PROTOCOL_SECTION_LABELS,
  type ByokGatewayPreset,
  type ByokProtocol,
  type ByokReleaseStatus,
  type ExecutionSettings,
  type GatewayPresetId
} from "@/lib/execution-mode-catalog";
import { ProviderTestStatusBanner, ProviderUsageNote } from "./provider-diagnostics";
import type { ProviderTestStatus } from "./vdt-store";

export function ByokReleaseStatusBadge({ status }: { status?: ByokReleaseStatus | undefined }) {
  if (status !== "beta") {
    return null;
  }

  return (
    <span
      data-testid="byok-release-status-badge"
      className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800"
    >
      Beta
    </span>
  );
}

interface ByokPresetFormProps {
  executionSettings: ExecutionSettings;
  preset: ByokGatewayPreset;
  protocol: ByokProtocol;
  showPresetSelect: boolean;
  showPresetLabel?: boolean;
  isTesting: boolean;
  testStatus?: ProviderTestStatus | undefined;
  fieldErrors?: ByokFieldErrors | undefined;
  onPresetChange: (presetId: GatewayPresetId) => void;
  onFieldChange: <K extends keyof ExecutionSettings>(field: K, value: ExecutionSettings[K]) => void;
  onFieldErrorsChange?: (errors: ByokFieldErrors | undefined) => void;
  onTest: () => void;
}

function SectionTitle({ protocol }: { protocol: ByokProtocol }) {
  const meta = PROTOCOL_SECTION_LABELS[protocol];

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-ink">{meta.title}</h3>
        <span title={meta.hint} className="text-muted">
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">{meta.hint}</span>
        </span>
      </div>
    </div>
  );
}

function ModelField({
  preset,
  model,
  error,
  onChange
}: {
  preset: ByokGatewayPreset;
  model: string;
  error?: string | undefined;
  onChange: (value: string) => void;
}) {
  const [customMode, setCustomMode] = useState(() => !preset.models.includes(model) && model.length > 0);
  const options = useMemo(() => {
    const models = [...preset.models];
    if (model && !models.includes(model)) {
      models.push(model);
    }
    return models;
  }, [preset.models, model]);

  return (
    <Field label="Model" {...(error ? { hint: error } : {})}>
      {customMode ? (
        <TextInput
          data-testid="byok-model-custom"
          value={model}
          placeholder={preset.model}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <SelectInput
          data-testid="byok-model-select"
          value={model || preset.model}
          onChange={(event) => {
            const next = event.target.value;
            if (next === "__custom__") {
              setCustomMode(true);
              return;
            }
            onChange(next);
          }}
        >
          {options.map((candidate) => (
            <option key={candidate} value={candidate}>
              {candidate}
            </option>
          ))}
          <option value="__custom__">Custom model…</option>
        </SelectInput>
      )}
      {customMode ? (
        <button
          type="button"
          className="mt-1 text-xs text-accent hover:underline"
          onClick={() => setCustomMode(false)}
        >
          Choose from preset list
        </button>
      ) : null}
    </Field>
  );
}

export function ByokPresetForm({
  executionSettings,
  preset,
  protocol,
  showPresetSelect,
  showPresetLabel = false,
  isTesting,
  testStatus,
  onPresetChange,
  onFieldChange,
  onFieldErrorsChange,
  onTest,
  fieldErrors = {}
}: ByokPresetFormProps) {
  const [showApiKey, setShowApiKey] = useState(false);
  const customizeBaseUrl = executionSettings.customizeBaseUrl ?? false;
  const maxTokensPlaceholder =
    preset.maxTokens?.toString() ?? getGatewayPreset(executionSettings.gatewayPresetId ?? "openai-default").maxTokens?.toString() ?? "64000";

  const presetOptions = listPresetsForProtocol(protocol);

  function clearExecutionFieldError(field: keyof ExecutionSettings) {
    onFieldErrorsChange?.(clearByokFieldError(fieldErrors, field));
  }

  function handleTest() {
    const errors = validateByokSettings(executionSettings, preset);
    onFieldErrorsChange?.(hasByokFieldErrors(errors) ? errors : undefined);
    if (hasByokFieldErrors(errors)) {
      return;
    }

    onTest();
  }

  return (
    <div className="space-y-4 rounded-lg border border-line bg-white p-4" data-testid="byok-preset-form">
      <SectionTitle protocol={protocol} />

      {showPresetSelect ? (
        <Field label="Gateway preset">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <SelectInput
                data-testid="byok-gateway-preset"
                className="min-w-0 flex-1"
                value={executionSettings.gatewayPresetId ?? preset.id}
                onChange={(event) => onPresetChange(event.target.value as GatewayPresetId)}
              >
                {presetOptions.map((candidate) => (
                  <option
                    key={candidate.id}
                    value={candidate.id}
                    data-testid={candidate.id === "alibaba-coding-plan" ? "byok-preset-alibaba-coding-plan" : undefined}
                  >
                    {candidate.label}
                    {candidate.releaseStatus === "beta" ? " (Beta)" : ""}
                  </option>
                ))}
              </SelectInput>
              <ByokReleaseStatusBadge status={preset.releaseStatus} />
            </div>
          </div>
        </Field>
      ) : showPresetLabel && preset.releaseStatus === "beta" ? (
        <div
          className="flex flex-wrap items-center gap-2"
          data-testid="byok-preset-beta-banner"
        >
          <span className="text-sm font-medium text-ink">{preset.label}</span>
          <ByokReleaseStatusBadge status={preset.releaseStatus} />
        </div>
      ) : null}

      <Field
        label="API key"
        {...(fieldErrors.apiKey
          ? { hint: fieldErrors.apiKey }
          : {
              hint:
                preset.credentialMode === "session_only"
                  ? "Session only — cleared on reload and never saved to localStorage."
                  : "Session only — not included in project export."
            })}
      >
        <div className="flex gap-2">
          <TextInput
            data-testid="byok-api-key"
            type={showApiKey ? "text" : "password"}
            autoComplete="off"
            value={executionSettings.apiKey ?? ""}
            aria-invalid={Boolean(fieldErrors.apiKey)}
            onChange={(event) => {
              clearExecutionFieldError("apiKey");
              onFieldChange("apiKey", event.target.value);
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            type="button"
            aria-label={showApiKey ? "Hide API key" : "Show API key"}
            data-testid="byok-api-key-toggle"
            icon={showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            onClick={() => setShowApiKey((current) => !current)}
          />
        </div>
        {preset.apiKeyUrl ? (
          <a
            href={preset.apiKeyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
            data-testid="byok-get-key-link"
          >
            Get key
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        ) : null}
      </Field>

      {protocol === "azure" ? (
        <>
          <Field label="Endpoint" {...(fieldErrors.endpoint ? { hint: fieldErrors.endpoint } : {})}>
            <TextInput
              data-testid="byok-endpoint"
              value={executionSettings.endpoint ?? ""}
              placeholder="https://your-resource.openai.azure.com"
              aria-invalid={Boolean(fieldErrors.endpoint)}
              onChange={(event) => {
                clearExecutionFieldError("endpoint");
                onFieldChange("endpoint", event.target.value);
              }}
            />
          </Field>
          <Field label="Deployment" {...(fieldErrors.deployment ? { hint: fieldErrors.deployment } : {})}>
            <TextInput
              data-testid="byok-deployment"
              value={executionSettings.deployment ?? ""}
              aria-invalid={Boolean(fieldErrors.deployment)}
              onChange={(event) => {
                clearExecutionFieldError("deployment");
                onFieldChange("deployment", event.target.value);
                onFieldChange("model", event.target.value);
              }}
            />
          </Field>
          <Field label="API version">
            <TextInput
              data-testid="byok-api-version"
              value={executionSettings.apiVersion ?? preset.apiVersion ?? "2024-10-21"}
              onChange={(event) => onFieldChange("apiVersion", event.target.value)}
            />
          </Field>
        </>
      ) : (
        <Field
          label="Base URL"
          {...(fieldErrors.baseUrl
            ? { hint: fieldErrors.baseUrl }
            : {
                hint: customizeBaseUrl
                  ? "Custom endpoint for this provider."
                  : `Default: ${preset.baseUrl || "provider default"}`
              })}
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted">Customize</span>
              <button
                type="button"
                role="switch"
                aria-checked={customizeBaseUrl}
                data-testid="byok-customize-base-url"
                className={clsx(
                  "relative inline-flex h-5 w-9 shrink-0 rounded-full border transition",
                  customizeBaseUrl ? "border-accent bg-accent" : "border-line bg-slate-200"
                )}
                onClick={() => {
                  const next = !customizeBaseUrl;
                  onFieldChange("customizeBaseUrl", next);
                  if (!next) {
                    onFieldChange("baseUrl", preset.baseUrl ?? "");
                    clearExecutionFieldError("baseUrl");
                  }
                }}
              >
                <span
                  className={clsx(
                    "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition",
                    customizeBaseUrl ? "left-[18px]" : "left-0.5"
                  )}
                />
              </button>
            </div>
            <TextInput
              data-testid="byok-base-url"
              value={executionSettings.baseUrl ?? preset.baseUrl ?? ""}
              readOnly={!customizeBaseUrl}
              aria-invalid={Boolean(fieldErrors.baseUrl)}
              className={!customizeBaseUrl ? "bg-slate-50 text-muted" : undefined}
              onChange={(event) => {
                clearExecutionFieldError("baseUrl");
                onFieldChange("baseUrl", event.target.value);
              }}
            />
          </div>
        </Field>
      )}

      {protocol === "anthropic" ? (
        <Field label="API version (optional)">
          <TextInput
            data-testid="byok-anthropic-version"
            value={executionSettings.anthropicVersion ?? preset.anthropicVersion ?? "2023-06-01"}
            onChange={(event) => onFieldChange("anthropicVersion", event.target.value)}
          />
        </Field>
      ) : null}

      <Field label="Max tokens (optional)">
        <TextInput
          data-testid="byok-max-tokens"
          type="number"
          min={1}
          inputMode="numeric"
          placeholder={maxTokensPlaceholder}
          value={executionSettings.maxTokens ?? ""}
          onChange={(event) => {
            const raw = event.target.value.trim();
            onFieldChange("maxTokens", raw ? Number(raw) : undefined);
          }}
        />
      </Field>

      <ModelField
        key={`${executionSettings.gatewayPresetId ?? preset.id}-${executionSettings.model ?? preset.model}`}
        preset={preset}
        model={executionSettings.model ?? preset.model}
        error={fieldErrors.model}
        onChange={(value) => {
          clearExecutionFieldError("model");
          onFieldChange("model", value);
        }}
      />

      <Button
        className="w-full"
        size="sm"
        data-testid="byok-test-connection"
        disabled={isTesting}
        icon={<PlugZap className="h-4 w-4" />}
        onClick={handleTest}
      >
        {isTesting ? "Testing..." : "Test connection"}
      </Button>

      <ProviderUsageNote className="mt-1" />

      {testStatus ? <ProviderTestStatusBanner status={testStatus} /> : null}
    </div>
  );
}
