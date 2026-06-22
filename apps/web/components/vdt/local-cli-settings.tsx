"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { clsx } from "clsx";
import { Button } from "@/components/ui/button";
import { Field, SelectInput, TextInput } from "@/components/ui/field";
import {
  CLI_CATALOG,
  getCliCatalogEntry,
  type CliAgentId,
  type CliCatalogEntry,
  type CliModelSelection
} from "@/lib/execution-mode-catalog";
import { CliAgentCard, type CliAgentDetectionView } from "./cli-agent-card";
import { CliInstallGrid } from "./cli-install-grid";
import { ProviderTestStatusBanner } from "./provider-diagnostics";
import { useVdtStudioStore } from "./vdt-store";

function buildDetectionFallback(): CliAgentDetectionView[] {
  return CLI_CATALOG.map((entry) => ({
    id: entry.id,
    installed: false,
    executable: null,
    alias: null,
    version: null
  }));
}

function AccordionSection({
  title,
  defaultOpen = true,
  children,
  testId
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
  testId?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="rounded-lg border border-line bg-white" data-testid={testId}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="text-sm font-semibold text-ink">{title}</span>
        <ChevronDown className={clsx("h-4 w-4 text-muted transition", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open ? <div className="border-t border-line px-4 py-4">{children}</div> : null}
    </section>
  );
}

export function LocalCliSettings() {
  const executionSettings = useVdtStudioStore((state) => state.executionSettings);
  const cliDetectionAgents = useVdtStudioStore((state) => state.cliDetectionAgents);
  const cliDetectionError = useVdtStudioStore((state) => state.cliDetectionError);
  const isRescanningClis = useVdtStudioStore((state) => state.isRescanningClis);
  const rescanningCliId = useVdtStudioStore((state) => state.rescanningCliId);
  const cliModelByAgent = useVdtStudioStore((state) => state.cliModelByAgent);
  const cliDiscoveredModelsByAgent = useVdtStudioStore((state) => state.cliDiscoveredModelsByAgent);
  const cliTestStatusByAgent = useVdtStudioStore((state) => state.cliTestStatusByAgent);
  const isTestingCliByAgent = useVdtStudioStore((state) => state.isTestingCliByAgent);
  const setSelectedCliAgentId = useVdtStudioStore((state) => state.setSelectedCliAgentId);
  const setCliModelForAgent = useVdtStudioStore((state) => state.setCliModelForAgent);
  const setMemoryModelMode = useVdtStudioStore((state) => state.setMemoryModelMode);
  const rescanClis = useVdtStudioStore((state) => state.rescanClis);
  const testCli = useVdtStudioStore((state) => state.testCli);
  const runnerPairingToken = useVdtStudioStore((state) => state.runnerPairingToken);
  const runnerPairingStatus = useVdtStudioStore((state) => state.runnerPairingStatus);
  const isPairingRunner = useVdtStudioStore((state) => state.isPairingRunner);
  const pairRunner = useVdtStudioStore((state) => state.pairRunner);
  const unpairRunner = useVdtStudioStore((state) => state.unpairRunner);

  const [installToast, setInstallToast] = useState<string | undefined>();
  const [pairingCode, setPairingCode] = useState("");
  const hasAttemptedInitialScan = useRef(false);
  const selectedCliAgentId = executionSettings.selectedCliAgentId;
  const memoryModelMode = executionSettings.memoryModelMode ?? "same_as_chat";
  const memoryCliAgentId = executionSettings.memoryCliAgentId;

  const detectionById = new Map(
    buildDetectionFallback().map((fallback) => {
      const scanned = cliDetectionAgents?.find((agent) => agent.id === fallback.id);
      return [fallback.id, scanned ?? fallback] as const;
    })
  );

  const installedAgents = CLI_CATALOG.filter((entry) => detectionById.get(entry.id)?.installed);
  const notInstalledAgents = CLI_CATALOG.filter((entry) => !detectionById.get(entry.id)?.installed);
  const canUseExplicitMemoryCli = installedAgents.length > 0;

  const selectedCatalog = selectedCliAgentId ? getCliCatalogEntry(selectedCliAgentId) : undefined;

  const runInitialScan = useCallback(() => {
    void rescanClis();
  }, [rescanClis]);

  useEffect(() => {
    if (hasAttemptedInitialScan.current || cliDetectionAgents !== undefined || isRescanningClis) {
      return;
    }

    hasAttemptedInitialScan.current = true;
    runInitialScan();
  }, [cliDetectionAgents, isRescanningClis, runInitialScan]);

  useEffect(() => {
    if (memoryModelMode === "selected_cli" && !canUseExplicitMemoryCli) {
      setMemoryModelMode("same_as_chat");
    }
  }, [memoryModelMode, canUseExplicitMemoryCli, setMemoryModelMode]);

  useEffect(() => {
    if (!installToast) {
      return;
    }

    const timer = window.setTimeout(() => setInstallToast(undefined), 3_000);
    return () => window.clearTimeout(timer);
  }, [installToast]);

  function resolveModelSelection(agentId: CliAgentId): CliModelSelection {
    return (
      cliModelByAgent[agentId] ??
      (selectedCliAgentId === agentId ? executionSettings.cliModelSelection : undefined) ?? {
        source: "agent_default"
      }
    );
  }

  function handleInstall(entry: CliCatalogEntry) {
    void navigator.clipboard.writeText(entry.installHint).catch(() => undefined);
    window.open(entry.docsUrl, "_blank", "noopener,noreferrer");
    setInstallToast("Copied install command");
  }

  function handleCopyCommand(entry: CliCatalogEntry) {
    void navigator.clipboard.writeText(entry.primaryCommand).catch(() => undefined);
    setInstallToast(`Copied ${entry.primaryCommand}`);
  }

  return (
    <div className="space-y-4" data-testid="local-cli-settings">
      <section className="rounded-lg border border-line bg-white px-4 py-4" data-testid="local-runner-pairing">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">Local runner</h3>
            <p className="mt-1 text-xs leading-5 text-muted">
              Start <code>vdt runner start</code>, then enter its short-lived pairing code. The session token stays in memory only.
            </p>
          </div>
          {runnerPairingToken ? (
            <Button size="sm" variant="secondary" data-testid="local-runner-unpair" onClick={() => void unpairRunner()}>
              Unpair
            </Button>
          ) : null}
        </div>
        {!runnerPairingToken ? (
          <div className="mt-3 flex items-end gap-2">
            <Field label="Pairing code">
              <TextInput
                data-testid="local-runner-pairing-code"
                value={pairingCode}
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                onChange={(event) => setPairingCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </Field>
            <Button
              data-testid="local-runner-pair"
              disabled={pairingCode.length !== 6 || isPairingRunner}
              onClick={() => void pairRunner(pairingCode)}
            >
              {isPairingRunner ? "Pairing…" : "Pair"}
            </Button>
          </div>
        ) : null}
        {runnerPairingStatus ? (
          <ProviderTestStatusBanner
            className="mt-3"
            status={runnerPairingStatus}
            testId="local-runner-pairing-status"
          />
        ) : null}
      </section>

      {cliDetectionError ? (
        <div
          role="alert"
          data-testid="local-cli-detection-error"
          className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">Could not scan installed CLIs</p>
            <p className="mt-0.5 text-xs leading-5">{cliDetectionError}</p>
            <p className="mt-1 text-xs leading-5 text-amber-800">
              You can still configure agents below. Rescan when the detection service is available.
            </p>
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-ink">Your CLIs ({installedAgents.length})</h3>
          <Button
            size="sm"
            variant="secondary"
            data-testid="local-cli-rescan"
            disabled={isRescanningClis}
            icon={
              isRescanningClis ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              )
            }
            onClick={() => void rescanClis()}
          >
            Rescan
          </Button>
        </div>

        {installedAgents.length === 0 ? (
          <div
            data-testid="local-cli-empty-installed"
            className="rounded-md border border-dashed border-line bg-slate-50/80 px-4 py-6 text-center text-sm text-muted"
          >
            No installed CLIs detected on PATH yet. Use the install grid below or rescan after installing an agent.
          </div>
        ) : (
          <div className="space-y-3">
            {installedAgents.map((entry) => {
              const detection = detectionById.get(entry.id)!;
              return (
                <CliAgentCard
                  key={entry.id}
                  catalog={entry}
                  detection={detection}
                  selected={selectedCliAgentId === entry.id}
                  modelSelection={resolveModelSelection(entry.id)}
                  discoveredModels={cliDiscoveredModelsByAgent[entry.id] ?? []}
                  testStatus={cliTestStatusByAgent[entry.id]}
                  isTesting={Boolean(isTestingCliByAgent[entry.id])}
                  onSelect={() => setSelectedCliAgentId(entry.id)}
                  onTest={() => void testCli(entry.id)}
                  onModelSelectionChange={(selection) => setCliModelForAgent(entry.id, selection)}
                />
              );
            })}
          </div>
        )}

      </div>

      <AccordionSection
        title={`Available to install (${notInstalledAgents.length})`}
        defaultOpen={installedAgents.length === 0}
        testId="local-cli-install-accordion"
      >
        <CliInstallGrid
          agents={notInstalledAgents}
          isRescanningId={rescanningCliId}
          toastMessage={installToast}
          onInstall={handleInstall}
          onCopyCommand={handleCopyCommand}
          onRescanAgent={(agentId) => void rescanClis(agentId)}
        />
      </AccordionSection>

      <AccordionSection title="Memory model" testId="local-cli-memory-accordion">
        <div className="space-y-3">
          <Field label="Memory source">
            <SelectInput
              data-testid="local-cli-memory-mode"
              value={canUseExplicitMemoryCli ? memoryModelMode : "same_as_chat"}
              onChange={(event) => {
                const mode = event.target.value as "same_as_chat" | "selected_cli";
                if (mode === "same_as_chat") {
                  setMemoryModelMode("same_as_chat");
                  return;
                }
                if (!canUseExplicitMemoryCli) {
                  return;
                }
                setMemoryModelMode("selected_cli", selectedCliAgentId ?? installedAgents[0]!.id);
              }}
            >
              <option value="same_as_chat">
                Same as chat ({selectedCatalog?.displayName ?? "selected CLI"})
              </option>
              <option value="selected_cli" disabled={!canUseExplicitMemoryCli}>
                Explicit CLI override
              </option>
            </SelectInput>
          </Field>

          {memoryModelMode === "selected_cli" && canUseExplicitMemoryCli ? (
            <Field label="Memory CLI">
              <SelectInput
                data-testid="local-cli-memory-agent"
                value={memoryCliAgentId ?? selectedCliAgentId ?? ""}
                onChange={(event) =>
                  setMemoryModelMode("selected_cli", event.target.value as CliAgentId)
                }
              >
                {installedAgents.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.displayName}
                  </option>
                ))}
              </SelectInput>
            </Field>
          ) : null}
        </div>
      </AccordionSection>
    </div>
  );
}
