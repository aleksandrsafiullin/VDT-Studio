"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GitBranch, History } from "lucide-react";
import {
  compareVdtProjects,
  listVersions,
  type VdtBottleneckCandidate,
  type VdtComparisonResult,
  type VdtProject
} from "@vdt-studio/vdt-core";
import { Button } from "@/components/ui/button";
import { formatChange, formatNumber, formatPercent } from "@/lib/format";

interface VdtComparisonPanelProps {
  project: VdtProject;
  defaultOpen?: boolean | undefined;
  defaultVersionId?: string | undefined;
}

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

function RootDeltaSummary({ result }: { result: VdtComparisonResult }) {
  const rootDelta = result.rootDelta;

  return (
    <div className="grid grid-cols-3 gap-2" data-testid="comparison-root-delta">
      <Metric label="Baseline" value={formatNumber(rootDelta?.leftValue)} />
      <Metric label="Current" value={formatNumber(rootDelta?.rightValue)} />
      <Metric
        label="Delta"
        value={formatChange(rootDelta?.absoluteDelta)}
        detail={rootDelta?.percentDelta !== undefined ? formatPercent(rootDelta.percentDelta) : undefined}
      />
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string | undefined }) {
  return (
    <div className="min-w-0 rounded-md border border-line bg-slate-50 px-3 py-2">
      <div className="truncate text-[11px] font-semibold uppercase tracking-normal text-muted">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-ink">{value}</div>
      {detail ? <div className="mt-0.5 truncate text-[11px] text-muted">{detail}</div> : null}
    </div>
  );
}

function DiffList({
  title,
  items,
  empty
}: {
  title: string;
  items: string[];
  empty: string;
}) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-normal text-muted">{title}</div>
      {items.length > 0 ? (
        <ul className="mt-2 max-h-24 space-y-1 overflow-auto text-sm leading-5 text-ink">
          {items.map((item) => (
            <li key={item} className="truncate rounded-md bg-slate-50 px-2 py-1">
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 rounded-md border border-dashed border-line bg-white px-2 py-2 text-sm text-muted">
          {empty}
        </p>
      )}
    </div>
  );
}

function CandidateRow({ candidate }: { candidate: VdtBottleneckCandidate }) {
  const tone =
    candidate.severity === "high"
      ? "border-orange-200 bg-orange-50 text-orange-900"
      : candidate.severity === "medium"
        ? "border-blue-200 bg-blue-50 text-blue-900"
        : "border-slate-200 bg-slate-50 text-slate-900";

  return (
    <li className={["rounded-md border px-3 py-2", tone].join(" ")}>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{candidate.nodeName}</div>
          <div className="mt-0.5 text-xs leading-5 opacity-85">{candidate.reason}</div>
        </div>
        <span className="shrink-0 rounded bg-white/75 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-normal">
          {candidate.severity}
        </span>
      </div>
    </li>
  );
}

export function VdtComparisonPanel({
  project,
  defaultOpen = false,
  defaultVersionId
}: VdtComparisonPanelProps) {
  const versions = useMemo(() => listVersions(project), [project]);
  const initialVersionId = defaultVersionId ?? versions[0]?.id;
  const [open, setOpen] = useState(defaultOpen);
  const [selectedVersionId, setSelectedVersionId] = useState<string | undefined>(initialVersionId);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (versions.length === 0) {
      setSelectedVersionId(undefined);
      return;
    }
    if (!selectedVersionId || !versions.some((version) => version.id === selectedVersionId)) {
      setSelectedVersionId(versions[0]?.id);
    }
  }, [selectedVersionId, versions]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  const selectedVersion = versions.find((version) => version.id === selectedVersionId);
  const comparison = selectedVersion
    ? compareVdtProjects(selectedVersion.projectSnapshot, project, { maxBottleneckCandidates: 6 })
    : undefined;

  return (
    <div ref={containerRef} className="relative" data-testid="vdt-comparison-control">
      <Button
        size="sm"
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="vdt-comparison-button"
        icon={<GitBranch className="h-4 w-4" />}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="hidden sm:inline">Compare</span>
      </Button>

      {open ? (
        <div
          className="absolute right-0 top-full z-30 mt-2 w-[min(31rem,calc(100vw-2rem))] rounded-md border border-line bg-white p-3 shadow-lg"
          data-testid="vdt-comparison-panel"
          role="dialog"
          aria-label="VDT comparison"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-ink">Compare VDT snapshots</h2>
              <p className="mt-1 truncate text-xs text-muted">Baseline snapshot against current canvas</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>

          {versions.length === 0 || !comparison || !selectedVersion ? (
            <div className="mt-3 rounded-md border border-dashed border-line bg-slate-50 px-3 py-4 text-sm leading-5 text-muted">
              Apply an agent change-set preview to create a snapshot, then compare that baseline with the active VDT.
            </div>
          ) : (
            <div className="mt-3 space-y-4">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-normal text-muted">Baseline</span>
                <select
                  className="mt-1 w-full rounded-md border border-line bg-white px-2 py-2 text-sm text-ink"
                  value={selectedVersion.id}
                  data-testid="vdt-comparison-baseline-select"
                  onChange={(event) => setSelectedVersionId(event.target.value)}
                >
                  {versions.map((version) => (
                    <option key={version.id} value={version.id}>
                      {version.name} · {formatCreatedAt(version.createdAt)}
                    </option>
                  ))}
                </select>
              </label>

              <RootDeltaSummary result={comparison} />

              <div className="grid gap-3 md:grid-cols-2">
                <DiffList
                  title="Added drivers"
                  items={comparison.structuralDiff.addedDrivers}
                  empty="No added drivers"
                />
                <DiffList
                  title="Removed drivers"
                  items={comparison.structuralDiff.removedDrivers}
                  empty="No removed drivers"
                />
                <DiffList
                  title="Changed formulas"
                  items={comparison.structuralDiff.changedFormulas}
                  empty="No formula changes"
                />
                <DiffList
                  title="Changed values"
                  items={comparison.structuralDiff.changedValues}
                  empty="No value changes"
                />
              </div>

              <div>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-normal text-muted">
                  <History className="h-3.5 w-3.5" aria-hidden="true" />
                  Bottleneck candidates
                </div>
                {comparison.bottleneckCandidates.length > 0 ? (
                  <ul className="mt-2 max-h-52 space-y-2 overflow-auto" data-testid="vdt-comparison-candidates">
                    {comparison.bottleneckCandidates.map((candidate) => (
                      <CandidateRow
                        key={`${candidate.nodeId}:${candidate.evidence}`}
                        candidate={candidate}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 rounded-md border border-dashed border-line bg-white px-2 py-2 text-sm text-muted">
                    No deterministic candidates in this comparison.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
