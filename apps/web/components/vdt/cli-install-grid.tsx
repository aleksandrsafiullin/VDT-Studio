"use client";

import { clsx } from "clsx";
import { Copy, Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CliAgentId, CliCatalogEntry } from "@/lib/execution-mode-catalog";

interface CliInstallGridProps {
  agents: readonly CliCatalogEntry[];
  isRescanningId?: CliAgentId | undefined;
  toastMessage?: string | undefined;
  onInstall: (entry: CliCatalogEntry) => void;
  onCopyCommand: (entry: CliCatalogEntry) => void;
  onRescanAgent: (agentId: CliAgentId) => void;
}

export function CliInstallGrid({
  agents,
  isRescanningId,
  toastMessage,
  onInstall,
  onCopyCommand,
  onRescanAgent
}: CliInstallGridProps) {
  return (
    <div className="space-y-3">
      {toastMessage ? (
        <p
          role="status"
          data-testid="local-cli-install-toast"
          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
        >
          {toastMessage}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2" data-testid="cli-install-grid">
        {agents.map((entry) => (
          <article
            key={entry.id}
            data-testid={`cli-install-card-${entry.id}`}
            className="rounded-lg border border-line bg-white p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{entry.displayName}</p>
                <p className="mt-1 text-xs leading-5 text-muted">
                  {entry.displayName} (&apos;{entry.primaryCommand}&apos;) was not found on your PATH.
                </p>
                <p className="mt-2 rounded-md bg-slate-50 px-2 py-1.5 font-mono text-[11px] text-slate-600">
                  {entry.installHint}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Copy ${entry.primaryCommand} command`}
                  data-testid={`cli-install-copy-${entry.id}`}
                  icon={<Copy className="h-3.5 w-3.5" />}
                  onClick={() => onCopyCommand(entry)}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Rescan ${entry.displayName}`}
                  data-testid={`cli-install-rescan-${entry.id}`}
                  disabled={isRescanningId === entry.id}
                  icon={
                    <RefreshCw
                      className={clsx("h-3.5 w-3.5", isRescanningId === entry.id && "animate-spin")}
                    />
                  }
                  onClick={() => onRescanAgent(entry.id)}
                />
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                data-testid={`cli-install-action-${entry.id}`}
                icon={<Download className="h-3.5 w-3.5" />}
                onClick={() => onInstall(entry)}
              >
                Install
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => window.open(entry.docsUrl, "_blank", "noopener,noreferrer")}
              >
                Docs
              </Button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
