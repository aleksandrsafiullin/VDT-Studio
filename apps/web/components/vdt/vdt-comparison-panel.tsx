"use client";

import { useMemo } from "react";
import { ArrowRight, ArrowUpRight, CircleAlert } from "lucide-react";
import { calculateGraph, type VdtProject } from "@vdt-studio/vdt-core";
import { formatChange, formatNumber } from "@/lib/format";
import { versionNodeChanges } from "./version-presentation";

function valueText(value: number | undefined, unit?: string) {
  return value === undefined || !Number.isFinite(value) ? "Нет значения" : `${formatNumber(value)}${unit ? ` ${unit}` : ""}`;
}

/** Comparison content within Versions; there is no separate toolbar control. */
export function VdtComparisonPanel({ before, current, onSelectNode }: {
  before: VdtProject;
  current: VdtProject;
  onSelectNode?: (nodeId: string) => void;
}) {
  const changes = useMemo(() => versionNodeChanges(before, current), [before, current]);
  const beforeRoot = before.graph.nodes.find((node) => node.id === before.rootNodeId);
  const afterRoot = current.graph.nodes.find((node) => node.id === current.rootNodeId);
  const leftValue = calculateGraph(before).rootValue;
  const rightValue = calculateGraph(current).rootValue;
  const comparable = beforeRoot?.id === afterRoot?.id && beforeRoot?.name === afterRoot?.name &&
    beforeRoot?.unit === afterRoot?.unit && beforeRoot?.formula === afterRoot?.formula;
  const delta = comparable && leftValue !== undefined && rightValue !== undefined ? rightValue - leftValue : undefined;
  const otherChanges = [
    JSON.stringify(before.scenarios) !== JSON.stringify(current.scenarios) ? "Изменены сценарии и их настройки." : "",
    JSON.stringify(before.dataSources) !== JSON.stringify(current.dataSources) ? "Изменены источники данных." : ""
  ].filter(Boolean);
  const counts = changes.reduce((total, row) => ({ ...total, [row.kind]: total[row.kind] + 1 }), { added: 0, removed: 0, changed: 0 });

  return (
    <div className="space-y-5" data-testid="vdt-comparison-panel">
      <div>
        <h3 className="text-sm font-semibold text-ink">Что изменилось</h3>
        <p className="mt-1 text-xs leading-5 text-muted">Сохранённая версия → текущее дерево. Базовые значения, без сценарных допущений.</p>
      </div>
      <div className="rounded-xl border border-line bg-slate-50 p-4" data-testid="comparison-root-delta">
        <div className="mb-3 text-xs font-medium text-muted">Корневой KPI</div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="min-w-0">
            <div className="text-xs text-muted">Было</div>
            <div className="mt-1 break-words text-sm font-semibold text-ink">{valueText(leftValue, beforeRoot?.unit)}</div>
            <div className="mt-1 break-words text-xs text-muted">{beforeRoot?.name}</div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted" aria-hidden="true" />
          <div className="min-w-0">
            <div className="text-xs text-muted">Стало</div>
            <div className="mt-1 break-words text-sm font-semibold text-ink">{valueText(rightValue, afterRoot?.unit)}</div>
            <div className="mt-1 break-words text-xs text-muted">{afterRoot?.name}</div>
          </div>
        </div>
        {delta !== undefined ? <p className="mt-3 border-t border-line pt-3 text-xs text-graphite">Изменение: <strong>{formatChange(delta)} {afterRoot?.unit}</strong></p> : null}
        {!comparable ? <p className="mt-3 flex items-start gap-2 border-t border-line pt-3 text-xs leading-5 text-amber-800"><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />Изменились корневой показатель, его формула или единицы. Прямое сравнение результата ограничено.</p> : null}
      </div>
      <div className="flex flex-wrap gap-2 text-xs" aria-label="Сводка изменений">
        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-800">Добавлено: {counts.added}</span>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-graphite">Изменено: {counts.changed}</span>
        <span className="rounded-full bg-rose-50 px-2.5 py-1 text-rose-800">Удалено: {counts.removed}</span>
      </div>
      {changes.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full table-fixed text-left text-xs" data-testid="version-changes-table">
            <thead className="bg-slate-50 text-muted"><tr><th className="w-[44%] px-3 py-3 font-medium">Показатель</th><th className="w-[28%] px-3 py-3 font-medium">Было</th><th className="w-[28%] px-3 py-3 font-medium">Стало</th></tr></thead>
            <tbody className="divide-y divide-line">
              {changes.map((row) => <tr key={row.nodeId} className="align-top">
                <td className="break-words px-3 py-3">
                  {row.kind !== "removed" && onSelectNode ? <button className="inline-flex items-start gap-1 text-left font-medium text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-accent" onClick={() => onSelectNode(row.nodeId)} title="Показать в дереве">{row.name}<ArrowUpRight className="mt-0.5 h-3 w-3 shrink-0" /></button> : <span className="font-medium text-ink">{row.name}</span>}
                  {row.path ? <div className="mt-1 text-[11px] leading-4 text-muted">{row.path}</div> : null}
                  <div className="mt-1.5 text-[11px] text-muted">{row.kind === "added" ? "Добавлен" : row.kind === "removed" ? "Удалён" : "Изменён"}</div>
                  {row.details.map((detail) => <div key={detail} className="mt-1 text-[11px] leading-4 text-muted">{detail}</div>)}
                </td>
                <td className="break-words px-3 py-3 text-graphite">
                  {row.kind === "added" ? "—" : valueText(row.beforeValue, row.beforeUnit)}
                  {row.formulaChanged ? <div className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-muted">Формула: {row.beforeFormula}</div> : null}
                </td>
                <td className="break-words px-3 py-3 font-medium text-ink">
                  {row.kind === "removed" ? "—" : valueText(row.afterValue, row.afterUnit)}
                  {row.formulaChanged ? <div className="mt-2 whitespace-pre-wrap text-[11px] font-normal leading-5 text-muted">Формула: {row.afterFormula}</div> : null}
                </td>
              </tr>)}
            </tbody>
          </table>
        </div>
      ) : <p className="rounded-xl border border-dashed border-line p-5 text-sm text-muted">В показателях нет изменений.</p>}
      {otherChanges.length > 0 ? <div className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-graphite">{otherChanges.map((text) => <p key={text}>{text}</p>)}</div> : null}
    </div>
  );
}
