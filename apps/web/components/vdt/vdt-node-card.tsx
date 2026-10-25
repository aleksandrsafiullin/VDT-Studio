"use client";

import { useId, type MouseEvent } from "react";
import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import type { VdtNode } from "@vdt-studio/vdt-core";
import { clsx } from "clsx";
import { FileUp, Lightbulb, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { formatChange, formatNumber, formatPercent } from "@/lib/format";
import { getNodeTypeIcon, getStatusIcon, VdtIcon } from "./vdt-icons";
import styles from "./vdt-canvas.module.css";

const VALUE_EPSILON = 1e-6;

function valuesDiffer(base: number | undefined, candidate: number | undefined) {
  if (base === undefined || candidate === undefined) {
    return false;
  }

  return Math.abs(candidate - base) > VALUE_EPSILON;
}

export interface VdtNodeCardData extends Record<string, unknown> {
  node: VdtNode;
  rootRole?: boolean | undefined;
  referenceGroup?: boolean | undefined;
  value?: number | undefined;
  mainScenarioValue?: number | undefined;
  rootScenarioEffect?: { absoluteChange?: number | undefined; percentageChange?: number | undefined } | undefined;
  highlighted?: boolean | undefined;
  onSelect?: ((nodeId: string) => void) | undefined;
  onAddManualIncomingKpi?: ((nodeId: string, rail: HTMLElement, trigger: HTMLButtonElement) => void) | undefined;
  onAddFileIncomingKpis?: ((nodeId: string) => void) | undefined;
  smartOpen?: boolean | undefined;
  onSmartActivate?: ((nodeId: string, rail: HTMLElement, trigger: HTMLButtonElement, source: "pointer" | "focus" | "touch") => void) | undefined;
  onSmartLeave?: (() => void) | undefined;
  onSmartBlur?: (() => void) | undefined;
}

function ValueRow({
  label,
  amount,
  unit,
  emphasize = false,
  estimated = false,
  valueTestId
}: {
  label: string;
  amount: number | undefined;
  unit?: string | undefined;
  emphasize?: boolean;
  estimated?: boolean;
  valueTestId?: string;
}) {
  return (
    <div className={clsx(styles.value, emphasize && styles.changedValue)}>
      <p className={styles.valueLabel}>{label}</p>
      <p
        className={clsx(styles.amount, emphasize && styles.changed, amount === undefined && styles.unavailable)}
        data-testid={valueTestId}
        title={`${emphasize ? "Changed in main scenario. " : ""}${estimated && amount !== undefined ? "Illustrative estimate, not measured data. " : ""}${formatNumber(amount)} ${unit ?? "unit n/a"}`}
      >
        {estimated && amount !== undefined ? <span className={styles.estimate} aria-label="Estimate">≈ </span> : null}
        {formatNumber(amount)}
      </p>
    </div>
  );
}

export function VdtNodeCard({ data, selected }: NodeProps) {
  const statusId = useId();
  const nodeData = data as unknown as VdtNodeCardData;
  const node = nodeData.node;
  const value = nodeData.value;
  const mainScenarioValue = nodeData.mainScenarioValue;
  const rootScenarioEffect = nodeData.rootScenarioEffect;
  const highlighted = nodeData.highlighted === true;
  const isRootKpi = nodeData.rootRole ?? node.type === "root_kpi";
  const typeIcon = getNodeTypeIcon(isRootKpi ? "root_kpi" : node.type);
  const statusLabel = getStatusIcon(node.status).label;
  const calculatedRoot = isRootKpi && Boolean(node.formula?.trim());
  const estimated = node.valueStatus === "default_assumption" || node.valueSource?.sourceTier === "assumption";
  const potentialDiffers = valuesDiffer(value, mainScenarioValue);
  const scenarioChanged = !nodeData.referenceGroup && potentialDiffers;
  const effectDiffers =
    rootScenarioEffect?.absoluteChange !== undefined &&
    Math.abs(rootScenarioEffect.absoluteChange) > VALUE_EPSILON;
  const stopActionEvent = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };
  const activateSmart = (rail: HTMLElement, source: "pointer" | "focus" | "touch") => {
    const trigger = rail.querySelector<HTMLButtonElement>("[data-smart-trigger]");
    if (trigger) nodeData.onSmartActivate?.(node.id, rail, trigger, source);
  };

  return (
    <div className={styles.node}>
      <div
        className={clsx(styles.card, isRootKpi && styles.root, scenarioChanged && styles.scenarioChanged, selected && styles.selected, highlighted && styles.highlighted, node.status === "rejected" && styles.rejected)}
        data-scenario-changed={scenarioChanged || undefined}
        role="button"
        tabIndex={0}
        aria-label={`Select ${node.name}`}
        aria-describedby={statusId}
        aria-pressed={!!selected}
        onClick={() => nodeData.onSelect?.(node.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            nodeData.onSelect?.(node.id);
          }
        }}
      >
        <Handle type="target" position={Position.Left} className={styles.handle} />
        <span id={statusId} className="sr-only">{statusLabel}{scenarioChanged ? ". Potential differs from Base in the main scenario." : ""}</span>
        <div className={styles.header}>
          <span
            data-testid="node-type-icon"
            role="img"
            aria-label={typeIcon.label}
            title={`${typeIcon.label} · ${statusLabel}`}
            className={styles.typeIcon}
          >
            <VdtIcon display={typeIcon} variant="nodeType" />
          </span>
          <h3 className={styles.title} title={node.name}>{node.name}</h3>
          <span className={styles.unit} data-testid="node-unit" title={node.unit?.trim() || "Unit unavailable"}>{node.unit?.trim() || "unit n/a"}</span>
        </div>
        {isRootKpi ? <p data-testid={calculatedRoot ? "node-calculated-indicator" : undefined} className={styles.kind}>{calculatedRoot ? "Root KPI · Calculated" : "Root KPI"}</p> : null}
        {nodeData.referenceGroup ? <p className={styles.reference}>Reference group</p> : (
          <div className={styles.values}>
            <ValueRow label="Base" amount={value} unit={node.unit} estimated={estimated} />
            {mainScenarioValue !== undefined ? (
              <ValueRow label="Potential" amount={mainScenarioValue} unit={node.unit} emphasize={potentialDiffers} estimated={estimated} valueTestId="node-main-scenario-value" />
            ) : null}
          </div>
        )}
        {isRootKpi && rootScenarioEffect ? (
          <div className={clsx(styles.effect, effectDiffers && ((rootScenarioEffect.absoluteChange ?? 0) > 0 ? styles.positive : styles.negative))} data-testid="root-scenario-effect">
            <p className={styles.effectLabel}>Effect</p>
            <p className={styles.effectAmount} title={`${formatChange(rootScenarioEffect.absoluteChange)} ${node.unit ?? "unit n/a"}`}>{formatChange(rootScenarioEffect.absoluteChange)}</p>
            <p className={styles.effectUnit} title={node.unit}>{node.unit ?? "unit n/a"}</p>
            <p className={styles.effectPercent} title={formatPercent(rootScenarioEffect.percentageChange)}>{formatPercent(rootScenarioEffect.percentageChange)}</p>
          </div>
        ) : null}
        <Handle type="source" position={Position.Right} className={styles.handle} />
      </div>
      <div data-testid="node-incoming-actions" className={clsx("nodrag nopan nowheel", styles.actions, nodeData.smartOpen && styles.actionsOpen)}
        onPointerEnter={event => activateSmart(event.currentTarget, event.pointerType === "touch" ? "touch" : "pointer")}
        onPointerLeave={() => nodeData.onSmartLeave?.()} onFocusCapture={event => { if (event.target instanceof Element && event.target.closest("[data-smart-trigger]")) activateSmart(event.currentTarget, "focus"); }} onBlurCapture={() => nodeData.onSmartBlur?.()}
        onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
        <div className={clsx("nodrag nopan nowheel", styles.actionToolbar)}>
          <Tooltip label="Add incoming KPI manually" className="block">
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className={styles.actionButton}
              icon={<Plus className="h-4 w-4" />}
              aria-label={`Add incoming KPI manually for ${node.name}`}
              data-testid="node-add-manual-incoming-kpi"
              disabled={!nodeData.onAddManualIncomingKpi}
              onMouseDown={stopActionEvent}
              onClick={(event) => {
                stopActionEvent(event);
                const rail = event.currentTarget.closest<HTMLElement>('[data-testid="node-incoming-actions"]');
                if (rail) nodeData.onAddManualIncomingKpi?.(node.id, rail, event.currentTarget);
              }}
            />
          </Tooltip>
          <Tooltip label="Add incoming KPIs from file" className="block">
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className={styles.actionButton}
              icon={<FileUp className="h-4 w-4" />}
              aria-label={`Add incoming KPIs from file for ${node.name}`}
              data-testid="node-add-file-incoming-kpis"
              disabled={!nodeData.onAddFileIncomingKpis}
              onMouseDown={stopActionEvent}
              onClick={(event) => {
                stopActionEvent(event);
                nodeData.onAddFileIncomingKpis?.(node.id);
              }}
            />
          </Tooltip>
          {nodeData.onSmartActivate ? <Tooltip label="Smart KPI suggestions" className="block">
            <Button type="button" size="icon" variant="secondary" className={styles.actionButton} icon={<Lightbulb className="h-4 w-4" />}
              aria-label={`Smart KPI suggestions for ${node.name}`} aria-controls={nodeData.smartOpen ? "smart-kpi-panel" : undefined} aria-expanded={!!nodeData.smartOpen}
              data-testid="node-smart-kpi-suggestions" data-smart-trigger="true" data-node-name={node.name}
              disabled={!nodeData.onSmartActivate} onMouseDown={stopActionEvent}
              onClick={event => { event.stopPropagation(); const rail = event.currentTarget.closest<HTMLElement>('[data-testid="node-incoming-actions"]'); if (rail) activateSmart(rail, "touch"); }}
              onKeyDown={event => {
                event.stopPropagation();
                if (event.key === "Tab" && !event.shiftKey && nodeData.smartOpen) {
                  const first = document.querySelector<HTMLElement>('[data-testid="smart-kpi-panel"] button:not(:disabled), [data-testid="smart-kpi-panel"] input:not(:disabled)');
                  if (first) { event.preventDefault(); first.focus(); }
                }
              }} />
          </Tooltip> : null}
        </div>
      </div>
    </div>
  );
}
