"use client";

import { useId, useMemo, useState } from "react";
import { probeFactor, type VdtInputSensitivity, type VdtProject } from "@vdt-studio/vdt-core";
import { Button } from "@/components/ui/button";
import { Field, SelectInput, TextInput } from "@/components/ui/field";
import { Metric } from "@/components/ui/metric";
import { formatChange, formatNumber } from "@/lib/format";
import { parseScenarioNumberInput } from "@/lib/scenario-number-input";

export function FactorProbePanel({ project, inputs }: { project: VdtProject; inputs: VdtInputSensitivity[] }) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [nodeId, setNodeId] = useState("");
  const [rawValue, setRawValue] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const selected = inputs.find((input) => input.nodeId === nodeId) ?? inputs[0];
  const value = parseScenarioNumberInput(rawValue);
  const outcome = useMemo(() => open && submitted && selected && value !== undefined
    ? probeFactor(project, { nodeId: selected.nodeId, value })
    : undefined,
  [open, project, submitted, selected, value]);
  if (!selected) return null;

  const result = outcome?.status === "ok" ? outcome.result : undefined;

  return (
    <section className="mb-5 rounded-xl border border-line bg-slate-50 p-3">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        Probe one factor
      </Button>
      <div id={panelId} hidden={!open}>
        <p className="mt-2 text-xs text-muted">Compare one absolute input value against the current baseline.</p>
        <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
        }}>
          <div className="min-w-44 flex-1">
            <Field label="Factor">
              <SelectInput
                value={selected.nodeId}
                onChange={(event) => {
                  setNodeId(event.target.value);
                  setRawValue("");
                  setSubmitted(false);
                }}
              >
                {inputs.map((input) => <option key={input.nodeId} value={input.nodeId}>{input.nodeName}</option>)}
              </SelectInput>
            </Field>
          </div>
          <div className="w-40">
            <Field label={selected.unit ? `New value (${selected.unit})` : "New value"}>
              <TextInput inputMode="decimal" required value={rawValue} onChange={(event) => {
                setRawValue(event.target.value);
                setSubmitted(false);
              }} />
            </Field>
          </div>
          <Button type="submit" size="sm" variant="secondary">Run probe</Button>
        </form>
        {submitted && value === undefined ? <p role="alert" className="mt-2 text-xs text-red-700">Enter a finite number.</p> : null}
        {outcome?.status === "error" ? <p role="alert" className="mt-2 text-xs text-red-700">{outcome.message}</p> : null}
        {result ? (
          <div className="mt-3 space-y-2 border-t border-line pt-3" aria-live="polite" data-testid="factor-probe-result">
            <p className="text-xs font-semibold">Modeled sensitivity</p>
            <p className="text-xs text-muted">
              {result.input.name} {displayValue(result.input.baselineValue, result.input.unit)} → {displayValue(result.input.simulatedValue, result.input.unit)}
            </p>
            <p className="text-xs font-medium">{result.root.name}</p>
            <div className="grid grid-cols-3 gap-3">
              <Metric label="Baseline" value={displayValue(result.root.baselineValue, result.root.unit)} />
              <Metric label="Simulated" value={displayValue(result.root.simulatedValue, result.root.unit)} />
              <Metric label="Change" value={result.root.absoluteChange === null
                ? "Unavailable"
                : withUnit(formatChange(result.root.absoluteChange), result.root.unit)} />
            </div>
            {result.root.absoluteChange === null ? (
              <p className="text-xs text-muted">A comparison requires a calculable baseline and simulated result.</p>
            ) : null}
            {result.assumptions.length ? (
              <ul className="space-y-2 text-xs text-muted">
                {result.assumptions.map((assumption) => (
                  <li key={JSON.stringify(assumption)}>
                    <p className="text-ink">{assumption.nodeName} · {assumption.statement}</p>
                    <p>{assumption.evidence.kind === "user_confirmed"
                      ? `User confirmed: “${assumption.evidence.quote}”`
                      : "Provisional assumption"}</p>
                    <p>Reconsider if {assumption.changesConclusionWhen}</p>
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-muted">No relevant decomposition assumption is recorded.</p>}
            <p className="text-xs text-muted">Operational achievability requires separate evidence.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function withUnit(value: string, unit: string | null): string {
  return unit ? `${value} ${unit}` : value;
}

function displayValue(value: number | null, unit: string | null): string {
  return value === null ? "Unavailable" : withUnit(formatNumber(value), unit);
}
