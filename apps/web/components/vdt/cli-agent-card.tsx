"use client";

import { clsx } from "clsx";
import { CheckCircle2, Info, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, SelectInput, TextInput } from "@/components/ui/field";
import {
  mergeCliModelOptions,
  type CliAgentBadge,
  type CliAgentId,
  type CliCatalogEntry,
  type CliModelSelection
} from "@/lib/execution-mode-catalog";
import type { ProviderTestStatus } from "./vdt-store";

export interface CliAgentDetectionView {
  id: CliAgentId;
  installed: boolean;
  executable: string | null;
  alias: string | null;
  version: string | null;
  error?: string | undefined;
}

const BADGE_LABELS: Record<CliAgentBadge, string> = {
  official: "Official",
  "lower-cost": "Lower cost",
  "many-models": "Many models"
};

function agentInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "?";
}

interface CliAgentCardProps {
  catalog: CliCatalogEntry;
  detection: CliAgentDetectionView;
  selected: boolean;
  modelSelection: CliModelSelection;
  discoveredModels: readonly string[];
  testStatus?: ProviderTestStatus | undefined;
  isTesting: boolean;
  onSelect: () => void;
  onTest: () => void;
  onModelSelectionChange: (selection: CliModelSelection) => void;
}

export function CliAgentCard({
  catalog,
  detection,
  selected,
  modelSelection,
  discoveredModels,
  testStatus,
  isTesting,
  onSelect,
  onTest,
  onModelSelectionChange
}: CliAgentCardProps) {
  const modelValue =
    modelSelection.source === "custom" && modelSelection.customModel
      ? modelSelection.customModel
      : modelSelection.source === "agent_default"
        ? "auto"
        : modelSelection.customModel ?? "auto";

  const dropdownModels = mergeCliModelOptions(catalog.suggestedModels, discoveredModels);
  const hasLiveModels = discoveredModels.length > 0;
  const showManualEntry = modelValue !== "auto" && !dropdownModels.includes(modelValue);

  return (
    <article
      data-testid={`cli-agent-card-${catalog.id}`}
      className={clsx(
        "rounded-lg border bg-white transition",
        selected ? "border-accent ring-2 ring-blue-100" : "border-line hover:border-slate-300"
      )}
    >
      <div className="flex items-start gap-3 p-3">
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
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-sm font-semibold",
              selected ? "bg-accent text-white" : "bg-slate-100 text-graphite"
            )}
          >
            {agentInitial(catalog.displayName)}
          </span>

          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-ink">{catalog.displayName}</span>
              {catalog.badges.map((badge) => (
                <span
                  key={badge}
                  className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted"
                >
                  {BADGE_LABELS[badge]}
                </span>
              ))}
            </span>
            <span className="mt-0.5 block text-xs leading-5 text-muted">{catalog.subtitle}</span>
            {detection.version ? (
              <span className="mt-1 block font-mono text-[11px] text-slate-500">{detection.version}</span>
            ) : null}
            {detection.error ? (
              <span className="mt-1 block text-xs text-amber-700">{detection.error}</span>
            ) : null}
          </span>
        </button>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            data-testid={`cli-agent-test-${catalog.id}`}
            disabled={isTesting}
            onClick={onTest}
          >
            {isTesting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Testing
              </>
            ) : (
              "Test"
            )}
          </Button>
          {testStatus ? (
            <span
              role="status"
              aria-live="polite"
              className={clsx(
                "flex max-w-[180px] items-start gap-1 rounded border px-2 py-1 text-[11px] leading-4",
                testStatus.kind === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : testStatus.kind === "info"
                    ? "border-slate-200 bg-slate-50 text-slate-700"
                    : "border-red-200 bg-red-50 text-red-700"
              )}
            >
              {testStatus.kind === "success" ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              ) : testStatus.kind === "info" ? (
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              )}
              <span>{testStatus.message}</span>
            </span>
          ) : null}
        </div>
      </div>

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
                {hasLiveModels ? "Live from CLI" : "Catalog suggestions"}
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
                <option value="auto">auto</option>
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
    </article>
  );
}
