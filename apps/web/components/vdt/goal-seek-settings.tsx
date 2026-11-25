"use client";

import { useEffect, useState, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { inspectBackCalculation, prepareBackCalculationPatch, type GraphCalculationResult, type VdtGoalSeek, type VdtNode, type VdtNodePatch, type VdtProject } from "@vdt-studio/vdt-core";
import { Field, SelectInput, TextInput } from "@/components/ui/field";
import { formatNumber } from "@/lib/format";
import styles from "./workspace-shell.module.css";

export function GoalSeekSettings({ project, node, calculation, onChange, children }: {
  project: VdtProject;
  node: VdtNode;
  calculation: GraphCalculationResult;
  onChange: (patch: VdtNodePatch) => void;
  children?: ReactNode;
}) {
  const config = node.goalSeek;
  const [draft, setDraft] = useState(String(config?.targetValue ?? ""));
  useEffect(() => setDraft(String(config?.targetValue ?? "")), [node.id, config?.targetValue]);
  const state = inspectBackCalculation(project, node.id, calculation);
  if (state.status === "error") return null;
  const { blockingKpi: other, targets, target, issues, eligible, value } = state;
  const update = (setting: VdtGoalSeek | null) => {
    const result = prepareBackCalculationPatch(project, { nodeId: node.id, setting });
    if (result.status === "ok" && result.changed) onChange(result.patch);
  };
  const invalidDraft = draft.trim() === "" || !Number.isFinite(Number(draft));

  return <section className={`${styles.inspectorSection} ${styles.sectionDivider}`} aria-label="Back-calculation" data-testid="goal-seek-settings">
    <div className={styles.scenarioLock}>
      <label>
        <input type="checkbox" className="h-3.5 w-3.5 shrink-0 rounded" data-testid="node-goal-seek-toggle"
          checked={!!config} disabled={!config && (!!other || !eligible)}
          onChange={event => {
            if (!event.target.checked) { update(null); return; }
            const initialTarget = targets.find(candidate => candidate.id === project.rootNodeId) ?? targets[0];
            if (initialTarget) update({ targetNodeId: initialTarget.id, targetValue: calculation.values[initialTarget.id] ?? initialTarget.baselineValue ?? initialTarget.value ?? 0 });
          }} />
        <span className={styles.goalSeekLabel}><RotateCcw size={13} aria-hidden="true" />Back-calculated</span>
      </label>
      <p>{!config && other ? `“${other.name}” already uses back-calculation. Disable it there to choose this KPI.`
        : !config && !eligible ? "Choose an incoming KPI used in an output formula. One KPI per VDT can be back-calculated."
        : "Automatically balances Baseline to an actual output. Scenarios start from the solved Base and show the effect of changes."}</p>
    </div>
    {config ? <>
      {children}
      <Field label="Output KPI">
        <SelectInput value={config.targetNodeId} data-testid="goal-seek-target"
          onChange={event => update({ targetNodeId: event.target.value, targetValue: config.targetValue })}>
          {!targets.some(candidate => candidate.id === config.targetNodeId) ? <option value={config.targetNodeId}>{target?.name ?? "Target deleted"} · unavailable</option> : null}
          {targets.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}{candidate.unit ? ` · ${candidate.unit}` : ""}</option>)}
        </SelectInput>
      </Field>
      <Field label={`Actual output${target?.unit ? ` (${target.unit})` : ""}`}>
        <TextInput type="number" step="any" value={draft} data-testid="goal-seek-target-value" aria-invalid={invalidDraft}
          onChange={event => {
            const raw = event.target.value;
            setDraft(raw);
            if (raw.trim() !== "" && Number.isFinite(Number(raw))) update({ ...config, targetValue: Number(raw) });
          }} />
      </Field>
      {invalidDraft ? <p className={styles.goalSeekIssue} role="alert">Enter a finite actual value. The saved target is still {formatNumber(config.targetValue)}.</p> : null}
      <div className={styles.goalSeekResult} data-testid="goal-seek-result" role="status">
        <span>Back-calculated Base</span><strong>{formatNumber(value)}{node.unit ? ` ${node.unit}` : ""}</strong>
      </div>
      {issues.map(issue => <p key={issue.id} className={styles.goalSeekIssue} role={issue.severity === "error" ? "alert" : "status"}>{issue.message}</p>)}
      <p className={styles.goalSeekHint}>This is a balancing value, not a measurement. The stored source value{node.formula?.trim() ? " and formula are retained and resume" : " is retained and resumes"} when back-calculation is disabled.</p>
    </> : null}
  </section>;
}
