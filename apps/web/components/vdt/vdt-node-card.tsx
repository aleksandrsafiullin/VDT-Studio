"use client";

import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import type { VdtNode } from "@vdt-studio/vdt-core";
import { StatusPill } from "@/components/ui/status-pill";
import { formatNumber } from "@/lib/format";

export interface VdtNodeCardData extends Record<string, unknown> {
  node: VdtNode;
  value?: number | undefined;
  highlighted?: boolean | undefined;
  onSelect?: ((nodeId: string) => void) | undefined;
}

export function VdtNodeCard({ data, selected }: NodeProps) {
  const nodeData = data as unknown as VdtNodeCardData;
  const node = nodeData.node;
  const value = nodeData.value;
  const highlighted = nodeData.highlighted === true;

  return (
    <div
      className={[
        "min-h-[88px] w-[238px] rounded-lg border bg-white px-3 py-2 shadow-node transition",
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
        <div className="min-w-0">
          <p className="truncate text-[10px] font-semibold uppercase tracking-normal text-muted">{node.type}</p>
          <h3 className="mt-0.5 line-clamp-2 text-sm font-semibold leading-5 text-ink">{node.name}</h3>
        </div>
        <StatusPill status={node.status} className="shrink-0" />
      </div>
      <div className="mt-2 flex items-end justify-between gap-3 border-t border-slate-100 pt-1.5">
        <div className="min-w-0">
          <p className="text-[10px] font-medium text-muted">Value</p>
          <p className="truncate text-base font-semibold text-ink">{formatNumber(value)}</p>
        </div>
        <p className="max-w-[76px] truncate text-right text-xs font-medium text-muted">{node.unit ?? "unit n/a"}</p>
      </div>
      {node.formula ? <p className="mt-1.5 truncate font-mono text-[10px] text-slate-500">{node.formula}</p> : null}
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-2 !border-white !bg-accent" />
    </div>
  );
}
