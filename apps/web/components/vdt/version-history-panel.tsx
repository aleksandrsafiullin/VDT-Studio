"use client";

import { useRef, useState } from "react";
import { History } from "lucide-react";
import { listVersions, type VdtAiTaskType, type VdtVersion } from "@vdt-studio/vdt-core";
import { Button } from "@/components/ui/button";
import { useVdtStudioStore } from "./vdt-store";

const TASK_LABELS: Partial<Record<VdtAiTaskType, string>> = {
  deepen_node: "Deepen node",
  simplify_branch: "Simplify branch",
  suggest_alternative: "Suggest alternative",
  suggest_formula: "Suggest formula",
  review_model: "Review model",
  check_units: "Check units",
  identify_missing_drivers: "Missing drivers",
  identify_duplicate_drivers: "Duplicate drivers",
  explain_node: "Explain node",
  explain_scenario: "Explain scenario",
  generate_executive_summary: "Executive summary",
  generate_tree: "Generate tree"
};

function formatCreatedAt(createdAt: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(createdAt));
  } catch {
    return createdAt;
  }
}

function VersionRow({
  version,
  onRestore
}: {
  version: VdtVersion;
  onRestore: (versionId: string) => void;
}) {
  const taskLabel = version.taskType ? TASK_LABELS[version.taskType] ?? version.taskType : undefined;

  return (
    <li
      className="flex items-start justify-between gap-3 rounded-md border border-line bg-white px-3 py-2"
      data-testid={`version-history-row-${version.id}`}
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-ink">{version.name}</div>
        <div className="mt-0.5 text-xs text-muted">{formatCreatedAt(version.createdAt)}</div>
        {taskLabel ? <div className="mt-1 text-xs text-muted">{taskLabel}</div> : null}
      </div>
      <Button
        size="sm"
        data-testid={`version-restore-${version.id}`}
        onClick={() => onRestore(version.id)}
      >
        Restore
      </Button>
    </li>
  );
}

export function VersionHistoryPanel() {
  const project = useVdtStudioStore((state) => state.project);
  const restoreVersion = useVdtStudioStore((state) => state.restoreVersionSnapshot);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const versions = listVersions(project);

  function handleRestore(versionId: string) {
    const version = versions.find((entry) => entry.id === versionId);
    if (!version) {
      return;
    }

    const confirmed = window.confirm(
      `Restore "${version.name}"? Unsaved AI preview changes will be discarded and the graph will revert to that snapshot.`
    );
    if (!confirmed) {
      return;
    }

    restoreVersion(versionId);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <Button
        size="sm"
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="version-history-button"
        icon={<History className="h-4 w-4" />}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="hidden sm:inline">History</span>
        {versions.length > 0 ? (
          <span
            className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white"
            data-testid="version-history-count"
          >
            {versions.length}
          </span>
        ) : null}
      </Button>

      {open ? (
        <div
          className="absolute right-0 top-full z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-md border border-line bg-white p-3 shadow-lg"
          data-testid="version-history-panel"
          role="dialog"
          aria-label="Version history"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">Version history</h2>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted">
            Snapshots are created when you apply AI change-set previews.
          </p>

          {versions.length === 0 ? (
            <p className="mt-3 rounded-md border border-dashed border-line bg-slate-50 px-3 py-4 text-sm text-muted">
              No snapshots yet. Apply a deepen or other graph change to create one.
            </p>
          ) : (
            <ul className="mt-3 max-h-72 space-y-2 overflow-auto">
              {versions.map((version) => (
                <VersionRow key={version.id} version={version} onRestore={handleRestore} />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
