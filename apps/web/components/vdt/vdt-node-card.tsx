"use client";

import type { MouseEvent } from "react";
import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import type { VdtNode } from "@vdt-studio/vdt-core";
import { clsx } from "clsx";
import { GitBranchPlus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { Tooltip } from "@/components/ui/tooltip";
import { formatChange, formatNumber, formatPercent } from "@/lib/format";
import { getNodeTypeIcon, VdtIcon } from "./vdt-icons";

const VALUE_EPSILON = 1e-6;

function valuesDiffer(base: number | undefined, candidate: number | undefined) {
  if (base === undefined || candidate === undefined) {
    return false;
  }

  return Math.abs(candidate - base) > VALUE_EPSILON;
}

export interface VdtNodeCardData extends Record<string, unknown> {
  node: VdtNode;
  value?: number | undefined;
  mainScenarioValue?: number | undefined;
  rootScenarioEffect?: { absoluteChange?: number | undefined; percentageChange?: number | undefined } | undefined;
  highlighted?: boolean | undefined;
  onSelect?: ((nodeId: string) => void) | undefined;
  onAddManualIncomingKpi?: ((nodeId: string) => void) | undefined;
  onAddAiIncomingKpis?: ((nodeId: string) => void) | undefined;
}

function ValueRow({
  label,
  amount,
  unit,
  emphasize = false,
  valueTestId
}: {
  label: string;
  amount: number | undefined;
  unit?: string | undefined;
  emphasize?: boolean;
  valueTestId?: string;
}) {
  return (
    <div className="mt-1.5 flex items-end justify-between gap-3 border-t border-slate-100 pt-1.5 first:mt-2">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium text-muted">{label}</p>
        <p
          className={clsx("truncate text-base font-semibold", emphasize ? "text-accent" : "text-ink")}
          data-testid={valueTestId}
        >
          {formatNumber(amount)}
        </p>
      </div>
      <p className="shrink-0 self-end text-right text-xs font-medium text-muted">{unit ?? "unit n/a"}</p>
    </div>
  );
}

export function VdtNodeCard({ data, selected }: NodeProps) {
  const nodeData = data as unknown as VdtNodeCardData;
  const node = nodeData.node;
  const value = nodeData.value;
  const mainScenarioValue = nodeData.mainScenarioValue;
  const rootScenarioEffect = nodeData.rootScenarioEffect;
  const highlighted = nodeData.highlighted === true;
  const typeIcon = getNodeTypeIcon(node.type);
  const isRootKpi = node.type === "root_kpi";
  const potentialDiffers = valuesDiffer(value, mainScenarioValue);
  const effectDiffers =
    rootScenarioEffect?.absoluteChange !== undefined &&
    Math.abs(rootScenarioEffect.absoluteChange) > VALUE_EPSILON;
  const stopActionEvent = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  return (
    <div className="relative flex w-[238px] flex-col gap-2">
      <div
        className={[
          "min-h-[80px] rounded-lg border bg-white px-3 py-2 shadow-node transition",
          selected ? "border-accent ring-4 ring-blue-100" : highlighted ? "border-amber-400 ring-4 ring-amber-100" : "border-line",
          node.status === "rejected" ? "opacity-55" : ""
        ].join(" ")}
        role="button"
        tabIndex={0}
        aria-label={`Select ${node.name}`}
        onClick={() => nodeData.onSelect?.(node.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            nodeData.onSelect?.(node.id);
          }
        }}
      >
        <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-2 !border-white !bg-slate-400" />
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-start gap-1.5">
            <span
              data-testid="node-type-icon"
              role="img"
              aria-label={typeIcon.label}
              title={typeIcon.label}
              className="mt-0.5 shrink-0 text-muted"
            >
              <VdtIcon display={typeIcon} variant="nodeType" />
            </span>
            <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-ink">{node.name}</h3>
          </div>
          <StatusPill status={node.status} className="shrink-0" />
        </div>
        <ValueRow label="Base" amount={value} unit={node.unit} />
        {mainScenarioValue !== undefined ? (
          <ValueRow
            label="Potential"
            amount={mainScenarioValue}
            unit={node.unit}
            emphasize={potentialDiffers}
            valueTestId="node-main-scenario-value"
          />
        ) : null}
        <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-2 !border-white !bg-accent" />
      </div>
      <div className="absolute -right-14 top-1/2 z-30 flex h-24 w-14 -translate-y-1/2 items-center justify-end opacity-0 transition-opacity duration-150 hover:opacity-100 focus-within:opacity-100">
        <div className="nodrag nopan flex flex-col gap-1 rounded-md border border-line bg-white p-1 shadow-lg">
          <Tooltip label="Add incoming KPI manually" className="block">
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="h-8 w-8"
              icon={<GitBranchPlus className="h-4 w-4" />}
              aria-label={`Add incoming KPI manually for ${node.name}`}
              data-testid="node-add-manual-incoming-kpi"
              disabled={!nodeData.onAddManualIncomingKpi}
              onMouseDown={stopActionEvent}
              onClick={(event) => {
                stopActionEvent(event);
                nodeData.onAddManualIncomingKpi?.(node.id);
              }}
            />
          </Tooltip>
          <Tooltip label="Add incoming KPIs with AI" className="block">
            <Button
              type="button"
              size="icon"
              variant="primary"
              className="h-8 w-8"
              icon={<Sparkles className="h-4 w-4" />}
              aria-label={`Add incoming KPIs with AI for ${node.name}`}
              data-testid="node-add-ai-incoming-kpis"
              disabled={!nodeData.onAddAiIncomingKpis}
              onMouseDown={stopActionEvent}
              onClick={(event) => {
                stopActionEvent(event);
                nodeData.onAddAiIncomingKpis?.(node.id);
              }}
            />
          </Tooltip>
        </div>
      </div>
      {isRootKpi && rootScenarioEffect ? (
        <div
          className="rounded-lg border border-line bg-white px-3 py-2 shadow-node"
          data-testid="root-scenario-effect"
        >
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-medium uppercase tracking-normal text-muted">Effect</p>
              <p
                className={clsx("truncate text-sm font-semibold leading-tight", {
                  "text-accent": effectDiffers && (rootScenarioEffect.absoluteChange ?? 0) > 0,
                  "text-red-600": effectDiffers && (rootScenarioEffect.absoluteChange ?? 0) < 0,
                  "text-ink": !effectDiffers
                })}
              >
                {formatChange(rootScenarioEffect.absoluteChange)}
              </p>
            </div>
            <p className="shrink-0 self-end text-right text-xs font-medium text-muted">{node.unit ?? "unit n/a"}</p>
          </div>
          <p
            className={clsx("mt-0.5 text-xs font-medium", {
              "text-accent": effectDiffers && (rootScenarioEffect.absoluteChange ?? 0) > 0,
              "text-red-600": effectDiffers && (rootScenarioEffect.absoluteChange ?? 0) < 0,
              "text-muted": !effectDiffers
            })}
          >
            {formatPercent(rootScenarioEffect.percentageChange)}
          </p>
        </div>
      ) : null}
    </div>
  );
}
