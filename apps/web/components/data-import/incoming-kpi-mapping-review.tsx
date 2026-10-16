"use client";

import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import type { DataDiscoveryRunSnapshot, IncomingKpiOptions } from "@vdt-studio/data-harness";
import { Button } from "@/components/ui/button";

const INPUT = "mt-1 w-full min-w-0 rounded-md border border-line bg-white px-2 py-1.5 text-xs text-ink";

interface Props {
  snapshot: DataDiscoveryRunSnapshot;
  options: IncomingKpiOptions;
  running: boolean;
  mappingChanged: boolean;
  onOptionsChange: (options: IncomingKpiOptions) => void;
  onCalculate: () => void;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block min-w-0 text-xs font-semibold text-ink">{label}{children}</label>;
}

function ColumnSelect({ label, value, columns, disabled, onChange }: {
  label: string; value?: string | undefined; columns: string[]; disabled: boolean; onChange: (column: string) => void;
}) {
  return <Field label={label}><select aria-label={label} className={INPUT} value={value ?? ""} disabled={disabled} onChange={(event) => onChange(event.target.value)}><option value="">Select a column</option>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></Field>;
}

export function IncomingKpiMappingReview({ snapshot, options, running, mappingChanged, onOptionsChange, onCalculate }: Props) {
  const review = snapshot.incomingKpi;
  const table = snapshot.tables.find((entry) => entry.tableId === options.tableId);
  const columns = table?.columns ?? [];
  const categoryColumns = options.categoryColumns ?? [];
  const duration = options.duration;
  const normalization = options.normalization;
  const perDay = normalization?.mode === "per_day" ? normalization : undefined;
  const clarificationQuestions = review?.questions.filter((question) => question.field.startsWith("clarificationAnswers.")) ?? [];
  function patch(next: Partial<IncomingKpiOptions>) { onOptionsChange({ ...options, ...next, confirmed: false }); }
  function moveCategory(index: number, direction: -1 | 1) {
    const next = [...categoryColumns];
    [next[index], next[index + direction]] = [next[index + direction]!, next[index]!];
    patch({ categoryColumns: next });
  }
  if (!review) return <p role="alert" className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">This analysis has no incoming KPI mapping. Analyze the source again.</p>;
  const messages = [...review.blockingReasons, ...review.questions.map((question) => question.message)];
  const validation = snapshot.validationResults.filter((item) => item.status !== "ok");
  const occurrences = new Map<string, number>();
  const notices = [
    ...validation.map((item) => ({ identity: ["validation", item.status, item.message], message: item.message })),
    ...snapshot.warnings.map((item) => ({ identity: ["warning", item.severity, item.type, item.message], message: item.message }))
  ].map(({ identity, message }) => {
    // Persisted legacy warning IDs can collide. Keep every occurrence without relying on those IDs.
    const semanticKey = JSON.stringify(identity);
    const occurrence = occurrences.get(semanticKey) ?? 0;
    occurrences.set(semanticKey, occurrence + 1);
    return { key: JSON.stringify([identity, occurrence]), message };
  });
  return (
    <div className="mt-5 space-y-4" data-testid="data-import-result">
      <section className="rounded-md border border-line bg-slate-50 p-3">
        <h3 className="text-sm font-semibold text-ink">Source and mapping</h3>
        <p className="mt-1 break-all text-xs leading-5 text-muted">{snapshot.file.fileName} · {snapshot.file.sizeBytes.toLocaleString()} bytes · {snapshot.file.contentHash}</p>
        {review.calculation?.includes("Excel duration encoding:") ? <p className="mt-2 rounded-md border border-blue-200 bg-blue-50 p-2 text-xs leading-5 text-blue-950">Excel stores formatted durations as fractions of a day. The Days unit follows the original cell encoding, before conversion to the KPI unit.</p> : null}
        <Field label="Source table"><select aria-label="Source table" className={INPUT} value={options.tableId ?? ""} disabled={running} onChange={(event) => patch({ tableId: event.target.value, categoryColumns: [], duration: undefined })}><option value="">Select a source table</option>{snapshot.tables.map((entry) => <option key={entry.tableId} value={entry.tableId}>{entry.name} · {entry.rowCount} rows · {entry.columnCount} columns{entry.truncated ? " · TRUNCATED" : ""}</option>)}</select></Field>
        <div className="mt-3">
          <div className="text-xs font-semibold text-ink">Category levels, from parent to child</div>
          <p className="mt-1 text-xs leading-5 text-muted">Choose up to four columns. Every distinct category will be included; more than 200 resulting KPIs requires a smaller or simpler extract.</p>
          <div className="mt-2 space-y-2">
            {categoryColumns.map((column, index) => (
              <div key={index} className="flex items-end gap-1.5">
                <div className="min-w-0 flex-1"><ColumnSelect label={`Category level ${index + 1}`} value={column} columns={columns} disabled={running} onChange={(value) => patch({ categoryColumns: categoryColumns.map((entry, position) => position === index ? value : entry) })} /></div>
                <Button type="button" size="icon" className="h-7 w-7 shrink-0" icon={<ArrowUp className="h-3.5 w-3.5" />} disabled={running || index === 0} aria-label={`Move category level ${index + 1} up`} onClick={() => moveCategory(index, -1)} />
                <Button type="button" size="icon" className="h-7 w-7 shrink-0" icon={<ArrowDown className="h-3.5 w-3.5" />} disabled={running || index === categoryColumns.length - 1} aria-label={`Move category level ${index + 1} down`} onClick={() => moveCategory(index, 1)} />
                <Button type="button" size="icon" className="h-7 w-7 shrink-0" icon={<Trash2 className="h-3.5 w-3.5" />} disabled={running} aria-label={`Remove category level ${index + 1}`} onClick={() => patch({ categoryColumns: categoryColumns.filter((_entry, position) => position !== index) })} />
              </div>
            ))}
          </div>
          <Button type="button" size="sm" className="mt-2" icon={<Plus className="h-3.5 w-3.5" />} disabled={running || !table || categoryColumns.length >= 4} onClick={() => patch({ categoryColumns: [...categoryColumns, ""] })}>Add category level</Button>
        </div>
        <div className="mt-4">
          <Field label="How is the value recorded?"><select aria-label="How is the value recorded?" className={INPUT} value={duration?.mode ?? ""} disabled={running} onChange={(event) => patch({ duration: event.target.value === "column" ? { mode: "column", column: "", unit: "target" } : event.target.value === "timestamps" ? { mode: "timestamps", startColumn: "", endColumn: "" } : undefined })}><option value="">Choose the value calculation</option><option value="column">Numeric value / duration column</option><option value="timestamps">End minus start timestamps (duration)</option></select></Field>
          {duration?.mode === "column" ? <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <ColumnSelect label="Value / duration column" value={duration.column} columns={columns} disabled={running} onChange={(column) => patch({ duration: { ...duration, column } })} />
            <Field label="Value / duration unit"><select aria-label="Value / duration unit" className={INPUT} value={duration.unit} disabled={running} onChange={(event) => patch({ duration: { ...duration, unit: event.target.value as typeof duration.unit } })}><option value="target">KPI base unit (no conversion)</option>{["seconds", "minutes", "hours", "days"].map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></Field>
            <Field label="Number format"><select aria-label="Number format" className={INPUT} value={options.numberFormat ?? ""} disabled={running} onChange={(event) => patch({ numberFormat: event.target.value ? event.target.value as "decimal_dot" | "decimal_comma" : undefined })}><option value="">Auto, ask if ambiguous</option><option value="decimal_dot">Decimal dot (1234.56)</option><option value="decimal_comma">Decimal comma (1234,56)</option></select></Field>
          </div> : null}
          {duration?.mode === "timestamps" ? <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <ColumnSelect label="Start timestamp column" value={duration.startColumn} columns={columns} disabled={running} onChange={(startColumn) => patch({ duration: { ...duration, startColumn } })} />
            <ColumnSelect label="End timestamp column" value={duration.endColumn} columns={columns} disabled={running} onChange={(endColumn) => patch({ duration: { ...duration, endColumn } })} />
            <Field label="Timestamp format"><select aria-label="Timestamp format" className={INPUT} value={duration.format ?? ""} disabled={running} onChange={(event) => patch({ duration: { ...duration, format: event.target.value ? event.target.value as NonNullable<typeof duration.format> : undefined } })}><option value="">Confirm timestamp format</option><option value="iso">ISO (YYYY-MM-DD)</option><option value="excel_serial">Excel serial date</option><option value="dmy">Day / month / year</option><option value="mdy">Month / day / year</option></select></Field>
            <Field label="Timezone UTC offset, minutes"><input aria-label="Timezone UTC offset, minutes" type="number" min={-840} max={840} step={1} className={INPUT} value={duration.timezoneOffsetMinutes ?? ""} placeholder="For timestamps without a timezone" disabled={running} onChange={(event) => patch({ duration: { ...duration, timezoneOffsetMinutes: optionalNumber(event.target.value) } })} /></Field>
          </div> : null}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Reporting value"><select aria-label="Reporting value" className={INPUT} value={normalization?.mode ?? ""} disabled={running} onChange={(event) => patch({ normalization: event.target.value === "period_total" ? { mode: "period_total" } : event.target.value === "per_day" ? { mode: "per_day", basis: "calendar_days" } : undefined })}><option value="">Confirm reporting calculation</option><option value="period_total">Total value for the period</option><option value="per_day">Average value per day</option></select></Field>
          {perDay ? <Field label="Denominator basis"><select aria-label="Denominator basis" className={INPUT} value={perDay.basis} disabled={running} onChange={(event) => patch({ normalization: { ...perDay, basis: event.target.value as typeof perDay.basis } })}><option value="calendar_days">Calendar days, including zero-event days</option><option value="operating_days">Operating days</option><option value="entity_days">Entity-days (entities × days)</option></select></Field> : null}
          <Field label="Inclusive period start"><input aria-label="Inclusive period start" type="date" className={INPUT} value={options.period?.start ?? ""} disabled={running} onChange={(event) => patch({ period: event.target.value || options.period?.end ? { start: event.target.value, end: options.period?.end ?? "" } : undefined })} /></Field>
          <Field label="Inclusive period end"><input aria-label="Inclusive period end" type="date" className={INPUT} value={options.period?.end ?? ""} disabled={running} onChange={(event) => patch({ period: event.target.value || options.period?.start ? { start: options.period?.start ?? "", end: event.target.value } : undefined })} /></Field>
          {perDay ? <Field label="Denominator, including zero-event days"><input aria-label="Denominator, including zero-event days" type="number" min="0.000001" step="any" className={INPUT} value={perDay.denominator ?? ""} disabled={running} onChange={(event) => patch({ normalization: { ...perDay, denominator: optionalNumber(event.target.value) } })} /></Field> : null}
        </div>
        <label className="mt-3 flex items-start gap-2 text-xs leading-5 text-ink"><input type="checkbox" className="mt-1" checked={options.missingCategoryPolicy === "include_unknown"} disabled={running} onChange={(event) => patch({ missingCategoryPolicy: event.target.checked ? "include_unknown" : undefined })} />Include rows with empty categories in an explicit Unspecified category.</label>
      </section>

      {messages.length ? <section className="rounded-md border border-amber-200 bg-amber-50 p-3" data-testid="data-import-questions"><h3 className="text-sm font-semibold text-amber-900">Decisions required</h3><ul className="mt-2 space-y-1 text-xs leading-5 text-amber-950">{messages.map((text, index) => <li key={index}>{text}</li>)}</ul></section> : null}
      {clarificationQuestions.length ? <section className="space-y-3 rounded-md border border-line p-3"><p className="text-xs leading-5 text-muted">Record your decisions below. Update the mapping controls above if an answer changes the calculation.</p>{clarificationQuestions.map((question) => { const key = question.field.slice("clarificationAnswers.".length); return <Field key={question.id} label={question.message}><textarea aria-label={question.message} className={INPUT} rows={2} value={options.clarificationAnswers?.[key] ?? ""} disabled={running} onChange={(event) => patch({ clarificationAnswers: { ...options.clarificationAnswers, [key]: event.target.value } })} /></Field>; })}</section> : null}

      <div className="rounded-md border border-line p-3">
        <label className="flex items-start gap-2 text-xs font-semibold leading-5 text-ink"><input type="checkbox" className="mt-1" checked={options.confirmed === true} disabled={running} data-testid="data-import-confirm-mapping" onChange={(event) => onOptionsChange({ ...options, confirmed: event.target.checked })} />I confirm the category order, value / duration calculation, units and reporting period / denominator.</label>
        <Button type="button" size="sm" variant="primary" className="mt-3" icon={running ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined} disabled={running || !options.confirmed} data-testid="data-import-calculate-preview" onClick={onCalculate}>{running ? "Calculating…" : "Calculate preview"}</Button>
        {mappingChanged ? <p className="mt-2 text-xs text-amber-800" data-testid="data-import-mapping-dirty">Mapping changed. Calculate the preview before staging.</p> : null}
      </div>

      <section className="rounded-md border border-line p-3">
        <div className="flex items-baseline justify-between gap-3"><h3 className="text-sm font-semibold text-ink">Complete hierarchy preview</h3><span className="text-xs text-muted">{review.hierarchy.length} KPIs</span></div>
        {mappingChanged || !review.options.confirmed ? <p className="mt-2 text-xs font-semibold text-amber-800">Values below are unconfirmed. Confirm the mapping and calculate the preview before staging.</p> : null}
        <p className="mt-2 text-xs leading-5 text-muted" data-testid="data-import-coverage">{review.coverage.includedRows} of {review.coverage.totalRows} rows included · {review.coverage.excludedRows} excluded · {review.coverage.categoryCount} categories · {review.coverage.complete ? "complete source coverage" : "coverage not confirmed"}</p>
        {review.calculation ? <p className="mt-1 text-xs leading-5 text-muted">{review.calculation}</p> : null}
        {review.hierarchy.length ? <div className="mt-3 space-y-1.5" data-testid="data-import-hierarchy">{review.hierarchy.map((node) => <div key={node.nodeId} className="rounded-md border border-line bg-slate-50 px-3 py-2" style={{ marginLeft: Math.max(0, node.depth - 1) * 16 }} data-testid="data-import-hierarchy-row"><div className="flex items-start justify-between gap-3 text-xs"><span className="font-semibold text-ink">{node.name}</span><span className="shrink-0 font-semibold text-ink">{node.baselineValue === undefined ? "Uncalculated" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(node.baselineValue)} {node.unit}</span></div><p className="mt-1 break-words text-xs text-muted">{node.path.map((part) => `${part.column}: ${part.value}`).join(" → ")}</p><details className="mt-1 text-xs leading-5 text-muted"><summary className="cursor-pointer font-medium text-accent">Source and calculation</summary><p className="mt-1 whitespace-pre-wrap break-words">{node.description}</p></details></div>)}</div> : <p className="mt-2 text-xs text-muted">A complete confirmed mapping is required before KPI values can be staged.</p>}
      </section>
      {notices.length ? <section className="rounded-md border border-amber-200 bg-amber-50 p-3" data-testid="data-import-warnings"><h3 className="text-xs font-semibold text-amber-900">Validation and warnings</h3><ul className="mt-2 space-y-1 text-xs leading-5 text-amber-950">{notices.map((item) => <li key={item.key}>{item.message}</li>)}</ul></section> : null}
    </div>
  );
}

function optionalNumber(value: string): number | undefined { return value === "" ? undefined : Number(value); }
