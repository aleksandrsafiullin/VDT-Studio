"use client";

import { useEffect, useRef, useState } from "react";
import type { VdtComparisonResult } from "@vdt-studio/vdt-core";
import type { VdtComparisonRecord } from "@vdt-studio/storage";
import { Button } from "@/components/ui/button";
import { Field, SelectInput } from "@/components/ui/field";
import { formatChange, formatNumber, formatPercent } from "@/lib/format";
import { compareSavedVdts, listProjectComparisons, openProjectComparison } from "./project-comparison-client";

type SavedVdt = { id: string; name: string };

export function ProjectComparisonsPanel({ projectId, vdts }: { projectId: string; vdts: SavedVdt[] }) {
  return <ScopedComparisons key={projectId} projectId={projectId} vdts={vdts} />;
}

function ScopedComparisons({ projectId, vdts }: { projectId: string; vdts: SavedVdt[] }) {
  const [leftId, setLeftId] = useState("");
  const [rightId, setRightId] = useState("");
  const [history, setHistory] = useState<VdtComparisonRecord[]>();
  const [opened, setOpened] = useState<VdtComparisonRecord>();
  const [loading, setLoading] = useState<"comparing" | "opening">();
  const [historyError, setHistoryError] = useState<string>();
  const [error, setError] = useState<string>();
  const operation = useRef<AbortController | null>(null);
  const canCompare = leftId !== rightId && vdts.some(({ id }) => id === leftId) && vdts.some(({ id }) => id === rightId);
  const labelFor = (id: string) => vdts.find((vdt) => vdt.id === id)?.name ?? id;

  useEffect(() => {
    const controller = new AbortController();
    void listProjectComparisons(projectId, controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted) setHistory((current) =>
          current ? [...current, ...rows.filter((row) => !current.some(({ id }) => id === row.id))] : rows
        );
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setHistoryError(errorMessage(caught));
      });
    return () => {
      controller.abort();
      operation.current?.abort();
    };
  }, [projectId]);

  async function showResult(kind: NonNullable<typeof loading>, request: (signal: AbortSignal) => Promise<VdtComparisonRecord>) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setLoading(kind);
    setError(undefined);
    try {
      const comparison = await request(controller.signal);
      if (controller.signal.aborted) return;
      setOpened(comparison);
      setHistory((current) => current?.some(({ id }) => id === comparison.id) ? current : [comparison, ...(current ?? [])]);
    } catch (caught) {
      if (!controller.signal.aborted) setError(errorMessage(caught));
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        if (!controller.signal.aborted) setLoading(undefined);
      }
    }
  }

  function cancel() {
    operation.current?.abort();
    operation.current = null;
    setLoading(undefined);
    setError(undefined);
    setLeftId("");
    setRightId("");
  }

  return (
    <section className="space-y-5" aria-label="Saved VDT comparisons" data-testid="project-comparisons-panel">
      <form className="space-y-3 rounded-xl border border-line bg-white p-4" onSubmit={(event) => {
        event.preventDefault();
        if (canCompare) void showResult("comparing", (signal) => compareSavedVdts(projectId, leftId, rightId, signal));
      }}>
        <p className="text-sm text-muted">{vdts.length < 2 ? "Save at least two VDTs in this project to compare them." : "Compare the latest saved revisions of two VDTs."}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Left VDT">
            <SelectInput value={leftId} disabled={Boolean(loading)} onChange={(event) => setLeftId(event.target.value)}>
              <option value="">Choose a VDT</option>
              {vdts.map(({ id, name }) => <option key={id} value={id} disabled={id === rightId}>{name}</option>)}
            </SelectInput>
          </Field>
          <Field label="Right VDT">
            <SelectInput value={rightId} disabled={Boolean(loading)} onChange={(event) => setRightId(event.target.value)}>
              <option value="">Choose a VDT</option>
              {vdts.map(({ id, name }) => <option key={id} value={id} disabled={id === leftId}>{name}</option>)}
            </SelectInput>
          </Field>
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={!canCompare || Boolean(loading)}>
            {loading === "comparing" ? "Comparing…" : "Compare and save"}
          </Button>
          {leftId || rightId || loading ? <Button type="button" size="sm" variant="secondary" onClick={cancel}>Cancel</Button> : null}
        </div>
      </form>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      {opened ? <ComparisonResult comparison={opened} labelFor={labelFor} /> : null}
      <div className="rounded-xl border border-line bg-white p-4">
        <h3 className="text-sm font-semibold text-ink">Saved comparisons</h3>
        {historyError ? <p role="alert" className="mt-2 text-sm text-red-700">{historyError}</p> : null}
        {history?.length ? (
          <ul className="mt-2 space-y-2">
            {history.map((row) => (
              <li key={row.id}>
                <Button type="button" variant="secondary" size="sm" disabled={Boolean(loading)} aria-pressed={opened?.id === row.id}
                  onClick={() => void showResult("opening", (signal) => openProjectComparison(projectId, row.id, signal))}>
                  {labelFor(row.leftVdtId)} → {labelFor(row.rightVdtId)} · {new Date(row.createdAt).toLocaleString()}
                </Button>
              </li>
            ))}
          </ul>
        ) : !historyError ? <p role="status" className="mt-2 text-sm text-muted">{history ? "No saved comparisons." : "Loading comparisons…"}</p> : null}
      </div>
    </section>
  );
}

export function ComparisonResult({ comparison, labelFor }: { comparison: VdtComparisonRecord; labelFor: (id: string) => string }) {
  const result = comparison.result as VdtComparisonResult | null;
  const delta = result?.rootDelta;
  const diff = result?.structuralDiff;
  const changes = diff ? [
    { label: "Added drivers", nodes: diff.addedDrivers },
    { label: "Removed drivers", nodes: diff.removedDrivers },
    { label: "Changed formulas", nodes: diff.changedFormulas },
    { label: "Changed values", nodes: diff.changedValues }
  ] : [];
  return (
    <section className="space-y-3 rounded-xl border border-line bg-white p-4" aria-label="Comparison result" data-testid="project-comparison-result">
      <h3 className="text-base font-semibold text-ink">{labelFor(comparison.leftVdtId)} → {labelFor(comparison.rightVdtId)}</h3>
      <p className="break-all text-xs text-muted">Saved revisions {comparison.leftRevisionId} and {comparison.rightRevisionId}</p>
      {comparison.summary ? <p className="text-sm text-muted">{comparison.summary}</p> : null}
      {delta ? <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><dt>Left root</dt><dd>{formatNumber(delta.leftValue)}</dd></div>
        <div><dt>Right root</dt><dd>{formatNumber(delta.rightValue)}</dd></div>
        <div><dt>Absolute change</dt><dd>{formatChange(delta.absoluteDelta)}</dd></div>
        <div><dt>Percent change</dt><dd>{formatPercent(delta.percentDelta)}</dd></div>
      </dl> : null}
      {changes.map(({ label, nodes }) => (
        <p key={label} className="break-words text-sm"><span className="font-medium">{label}</span> {nodes?.join(", ") || "None"}</p>
      ))}
      {result?.bottleneckCandidates?.length ? <div className="text-sm">
        <h4 className="font-medium">Bottleneck candidates</h4>
        <ul className="list-disc space-y-1 pl-5">
          {result.bottleneckCandidates.map(({ nodeId, nodeName, evidence, severity, reason }) => (
            <li key={`${nodeId}:${evidence}`}><strong>{nodeName}</strong> ({severity}). {reason}</li>
          ))}
        </ul>
      </div> : null}
    </section>
  );
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : "Could not load the comparison.";
}
