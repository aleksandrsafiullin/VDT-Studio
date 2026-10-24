"use client";

import { clsx } from "clsx";
import { Check, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, SelectInput, TextInput } from "@/components/ui/field";
import { describeCliDetection } from "@/lib/cli-readiness";
import {
  type CliAgentId,
  type CliCatalogEntry,
  type CliModelSelection
} from "@/lib/execution-mode-catalog";
import { ProviderTestStatusBanner, ProviderUsageNote } from "./provider-diagnostics";
import type { ProviderTestStatus } from "./vdt-store";

export type CliAgentBackendStatus =
  | "not_installed"
  | "installed"
  | "authentication_required"
  | "ready"
  | "rate_limited"
  | "unsupported_version"
  | "unsafe_configuration"
  | "unavailable"
  | "error";

export interface CliAgentDetectionView {
  id: CliAgentId;
  installed: boolean;
  executable: string | null;
  alias: string | null;
  version: string | null;
  error?: string | undefined;
  status?: CliAgentBackendStatus | undefined;
  authSummary?: string | undefined;
  diagnostics?: string[] | undefined;
}

function agentInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function isTestDisabled(detection: CliAgentDetectionView, isTesting: boolean): boolean {
  if (isTesting) return true;
  if (!detection.installed) return true;
  if (detection.status === "not_installed" || detection.status === "unsupported_version") return true;
  if (detection.status === "unsafe_configuration") return true;
  return false;
}

function versionCompatibilityLabel(detection: CliAgentDetectionView): "compatible" | "incompatible" | "unknown" | null {
  if (!detection.version) return null;
  if (detection.status === "unsupported_version") return "incompatible";
  if (detection.status === "not_installed") return null;
  if (detection.status === "ready" || detection.status === "installed" || detection.status === "authentication_required") {
    return "compatible";
  }
  return "unknown";
}

interface CliAgentCardProps {
  catalog: CliCatalogEntry;
  detection: CliAgentDetectionView;
  selected: boolean;
  modelSelection: CliModelSelection;
  discoveredModels: readonly string[];
  testStatus?: ProviderTestStatus | undefined;
  authActionStatus?: ProviderTestStatus | undefined;
  isTesting: boolean;
  isAuthenticating?: boolean | undefined;
  onSelect: () => void;
  onTest: () => void;
  onAuthenticate?: (() => void) | undefined;
  onRemove?: (() => void) | undefined;
  onModelSelectionChange: (selection: CliModelSelection) => void;
}

export function CliAgentCard({
  catalog,
  detection,
  selected,
  modelSelection,
  discoveredModels,
  testStatus,
  authActionStatus,
  isTesting,
  isAuthenticating = false,
  onSelect,
  onTest,
  onAuthenticate,
  onRemove,
  onModelSelectionChange
}: CliAgentCardProps) {
  const modelValue =
    modelSelection.source === "custom" && modelSelection.customModel
      ? modelSelection.customModel
      : modelSelection.source === "agent_default"
        ? "auto"
        : modelSelection.customModel ?? "auto";

  const dropdownModels = Array.from(
    new Set(discoveredModels.map((model) => model.trim()).filter((model) => model && model !== "auto"))
  );
  const hasLiveModels = discoveredModels.length > 0;
  const modelDiscoveryLabel = hasLiveModels
    ? "Live from CLI"
    : detection.status === "authentication_required"
      ? "Sign in to load models"
      : "CLI list unavailable";
  const showManualEntry = modelSelection.source === "custom" && (!modelSelection.customModel || !dropdownModels.includes(modelValue));
  const versionLabel = versionCompatibilityLabel(detection);
  const testDisabled = isTestDisabled(detection, isTesting) || isAuthenticating;
  const requestReadiness = describeCliDetection(catalog.id, detection);
  const requestReadinessClass = {
    checking: "bg-slate-100 text-slate-600",
    ready: "bg-emerald-50 text-emerald-700",
    warning: "bg-amber-50 text-amber-800",
    not_installed: "bg-red-50 text-red-700"
  }[requestReadiness.state];
  const visibleTestStatus = testStatus?.kind === "success" && requestReadiness.state !== "ready" ? undefined : testStatus;
  const visibleAuthStatus = authActionStatus?.kind === "success" && requestReadiness.state !== "ready" ? undefined : authActionStatus;
  const showAuthGuidance = detection.status === "authentication_required" && !visibleTestStatus && !visibleAuthStatus;
  const showSignIn = detection.installed && detection.status !== "ready" &&
    detection.status !== "unsupported_version" && detection.status !== "unsafe_configuration" && onAuthenticate;

  return (
    <article
      data-testid={`cli-agent-card-${catalog.id}`}
      data-settings-card
      data-selected={selected}
      className={clsx(
        "overflow-hidden rounded-xl border bg-white transition",
        selected ? "border-blue-300 ring-1 ring-blue-100" : "border-line hover:border-slate-300"
      )}
    >
      <div className="flex items-start gap-3 px-4 pb-3 pt-4">
        <button
          type="button"
          data-testid={`cli-agent-select-${catalog.id}`}
          className="flex min-w-0 flex-1 items-start gap-3 rounded-md text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          aria-pressed={selected}
          aria-label={`Select ${catalog.displayName}`}
          onClick={onSelect}
        >
          <span
            aria-hidden="true"
            className={clsx(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold",
              selected ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-graphite"
            )}
          >
            {agentInitial(catalog.displayName)}
          </span>

          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-ink">{catalog.displayName}</span>
              <span
                data-testid={`cli-agent-readiness-${catalog.id}`}
                data-readiness={requestReadiness.state}
                title={requestReadiness.message}
                className={clsx(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium",
                  requestReadinessClass
                )}
              >
                {requestReadiness.label}
              </span>
            </span>
            <span className="mt-1 block text-xs leading-5 text-muted">
              {modelSelection.source === "custom" && modelSelection.customModel ? modelSelection.customModel : "Provider default model"}
            </span>
            {showAuthGuidance ? (
              <span data-testid={`cli-agent-auth-guidance-${catalog.id}`} className="mt-1 block text-xs text-amber-800">
                Sign in with your provider to verify CLI access.
              </span>
            ) : null}
          </span>
        </button>

        {selected ? <span className="flex shrink-0 items-center gap-1 pt-1 text-[11px] font-medium text-blue-700"><Check className="h-3.5 w-3.5" aria-hidden="true" />For chat</span> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
        {!selected ? (
          <Button type="button" size="sm" variant="secondary" onClick={onSelect} aria-label={`Use ${catalog.displayName} for chat`}>Use for chat</Button>
        ) : null}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-testid={`cli-agent-test-${catalog.id}`}
            disabled={testDisabled}
            onClick={onTest}
          >
            {isTesting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Testing
              </>
            ) : (
              testStatus?.kind === "error" ? "Retry test" : "Test"
            )}
          </Button>
          {showSignIn ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              data-testid={`cli-agent-authenticate-${catalog.id}`}
              disabled={isAuthenticating || isTesting}
              onClick={onAuthenticate}
            >
              {isAuthenticating ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  Waiting for browser
                </>
              ) : catalog.id === "cursor-agent" ? (
                "Sign in"
              ) : (
                "Sign-in help"
              )}
            </Button>
          ) : null}
        {onRemove ? (
          <Button type="button" size="icon" variant="ghost" className="ml-auto text-slate-400 hover:text-red-700"
            data-testid={`cli-agent-remove-${catalog.id}`} aria-label={`Remove ${catalog.displayName} from Your subscriptions`}
            title="Remove from Your subscriptions" disabled={isTesting || isAuthenticating} onClick={onRemove}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      {visibleTestStatus ? (
        <div className="border-t border-line px-3 py-2">
          <ProviderTestStatusBanner status={visibleTestStatus} testId={`provider-test-status-${catalog.id}`} />
        </div>
      ) : null}

      {visibleAuthStatus ? (
        <div className="border-t border-line px-3 py-2">
          <ProviderTestStatusBanner status={visibleAuthStatus} testId={`provider-auth-status-${catalog.id}`} />
          {catalog.id !== "cursor-agent" ? <a data-testid={`cli-agent-sign-in-guide-${catalog.id}`} className="mt-2 inline-block text-xs text-accent underline underline-offset-2" href={catalog.docsUrl} target="_blank" rel="noopener noreferrer">Open sign-in guide ↗</a> : null}
        </div>
      ) : null}

      {selected ? (
        <div className="border-t border-line px-3 py-3">
          <Field label="Model">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={clsx(
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  hasLiveModels
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-slate-100 text-muted"
                )}
              >
                {modelDiscoveryLabel}
              </span>
              <SelectInput
                data-testid={`cli-agent-model-${catalog.id}`}
                value={showManualEntry ? "__custom__" : modelValue}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  if (nextValue === "auto") {
                    onModelSelectionChange({ source: "agent_default" });
                    return;
                  }
                  if (nextValue === "__custom__") {
                    onModelSelectionChange({
                      source: "custom",
                      customModel: modelSelection.customModel ?? ""
                    });
                    return;
                  }
                  onModelSelectionChange({ source: "custom", customModel: nextValue });
                }}
              >
                <option value="auto">Provider default (auto)</option>
                {dropdownModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
                <option value="__custom__">Enter manually…</option>
              </SelectInput>
            </div>
          </Field>
          {showManualEntry || modelSelection.source === "custom" ? (
            <div className="mt-2">
              <TextInput
                data-testid={`cli-agent-model-custom-${catalog.id}`}
                placeholder="Model name"
                value={modelSelection.customModel ?? ""}
                onChange={(event) =>
                  onModelSelectionChange({ source: "custom", customModel: event.target.value })
                }
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <details className="border-t border-line px-4 py-2 text-xs text-muted" data-testid={`cli-agent-details-${catalog.id}`}>
        <summary className="w-fit cursor-pointer py-1 text-[11px] font-medium hover:text-ink">Provider details</summary>
        <div className="space-y-2 py-2">
          <p>{catalog.subtitle}</p>
          <ProviderUsageNote testId={`provider-usage-note-${catalog.id}`} message={catalog.usageNote} />
          {detection.version ? <p className="flex items-center gap-2"><span className="font-mono">{detection.version}</span>
            {versionLabel ? <span data-testid={`cli-agent-version-chip-${catalog.id}`}>{versionLabel === "compatible" ? "Compatible" : versionLabel === "incompatible" ? "Incompatible" : "Unknown"}</span> : null}</p> : null}
          {detection.authSummary ? <p className="break-words" data-testid={`cli-agent-auth-summary-${catalog.id}`}>{detection.authSummary}</p> : null}
          {detection.error || detection.diagnostics?.length ? <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-2 text-[11px]">{[detection.error, ...(detection.diagnostics ?? [])].filter(Boolean).join("\n")}</pre> : null}
          <a className="inline-block text-accent underline underline-offset-2" href={catalog.docsUrl} target="_blank" rel="noopener noreferrer">{catalog.id === "cursor-agent" ? "Provider documentation" : "Open sign-in guide"} ↗</a>
        </div>
      </details>
    </article>
  );
}
