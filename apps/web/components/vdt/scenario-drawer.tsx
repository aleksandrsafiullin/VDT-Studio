"use client";

import { Plus, Route, Sigma } from "lucide-react";
import { calculateGraph, calculateScenario, type VdtImpactNode } from "@vdt-studio/vdt-core";
import { Button } from "@/components/ui/button";
import { Metric } from "@/components/ui/metric";
import { SelectInput, TextInput } from "@/components/ui/field";
import { formatChange, formatNumber, formatPercent } from "@/lib/format";
import { useVdtStudioStore } from "./vdt-store";

function parseFiniteInput(value: string) {
  if (value === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sortImpacts(impacts: VdtImpactNode[]) {
  return [...impacts].sort((left, right) => Math.abs(right.absoluteChange ?? 0) - Math.abs(left.absoluteChange ?? 0));
}

function buildScenarioExplanation(rootName: string, impacts: VdtImpactNode[], absoluteChange?: number, percentageChange?: number) {
  if (impacts.length === 0 || absoluteChange === undefined) {
    return "Mock AI summary: add scenario overrides to see the root impact and the main changed drivers.";
  }

  const topDrivers = sortImpacts(impacts)
    .filter((impact) => impact.nodeName !== rootName)
    .slice(0, 2)
    .map((impact) => impact.nodeName);

  const driverText = topDrivers.length > 0 ? topDrivers.join(" and ") : rootName;
  return `Mock AI summary: ${rootName} moves by ${formatChange(absoluteChange)} (${formatPercent(
    percentageChange
  )}), mainly through ${driverText}.`;
}

export function ScenarioDrawer() {
  const project = useVdtStudioStore((state) => state.project);
  const activeScenarioId = useVdtStudioStore((state) => state.activeScenarioId);
  const createScenario = useVdtStudioStore((state) => state.createScenario);
  const setActiveScenarioId = useVdtStudioStore((state) => state.setActiveScenarioId);
  const updateScenarioOverride = useVdtStudioStore((state) => state.updateScenarioOverride);

  const baseline = calculateGraph(project);
  const activeScenario = project.scenarios.find((scenario) => scenario.id === activeScenarioId) ?? project.scenarios[0];
  const scenarioResult = activeScenario ? calculateScenario(project, activeScenario) : undefined;
  const inputNodes = project.graph.nodes.filter((node) => node.type === "input" || node.type === "data_mapped");
  const traceItems = scenarioResult?.calculationTrace ?? baseline.trace;
  const rootNode = project.graph.nodes.find((node) => node.id === project.rootNodeId);
  const impactedNodes = sortImpacts(scenarioResult?.impactedNodes ?? []).slice(0, 5);
  const scenarioExplanation = buildScenarioExplanation(
    rootNode?.name ?? project.rootNodeId,
    scenarioResult?.impactedNodes ?? [],
    scenarioResult?.absoluteChange,
    scenarioResult?.percentageChange
  );

  return (
    <div className="h-[248px] border-t border-line bg-white">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <Route className="h-4 w-4 text-accent" />
            <div>
              <h2 className="text-sm font-semibold text-ink">Scenario Mode</h2>
              <p className="text-xs text-muted">Override inputs and inspect deterministic impact.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <SelectInput
              className="h-8 w-56 py-1 text-xs"
              value={activeScenario?.id ?? ""}
              onChange={(event) => setActiveScenarioId(event.target.value)}
            >
              {project.scenarios.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>
                  {scenario.name}
                </option>
              ))}
            </SelectInput>
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={createScenario}>
              New
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="grid h-full min-w-[900px] grid-cols-[250px_minmax(300px,1fr)_310px] overflow-hidden">
          <div className="min-w-0 overflow-auto border-r border-line px-4 py-3">
            <div className="grid grid-cols-2 gap-4">
              <Metric label="Baseline" value={formatNumber(scenarioResult?.baselineValue ?? baseline.rootValue)} />
              <Metric label="Scenario" value={formatNumber(scenarioResult?.scenarioValue)} tone="positive" />
              <Metric label="Absolute" value={formatChange(scenarioResult?.absoluteChange)} tone="positive" />
              <Metric label="Percent" value={formatPercent(scenarioResult?.percentageChange)} tone="positive" />
            </div>
            <p className="mt-3 text-xs leading-5 text-muted">
              {scenarioExplanation}
            </p>
            <div className="mt-3 border-t border-line pt-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-normal text-muted">Impacted drivers</div>
              <div className="space-y-2">
                {impactedNodes.length === 0 ? (
                  <div className="rounded-md border border-line bg-white px-3 py-2 text-xs text-muted">No changed drivers yet.</div>
                ) : (
                  impactedNodes.map((impact) => (
                    <div key={impact.nodeId} className="rounded-md border border-line bg-white px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-xs font-semibold text-ink">{impact.nodeName}</span>
                        <span className="shrink-0 text-xs font-semibold text-ink">{formatChange(impact.absoluteChange)}</span>
                      </div>
                      <div className="mt-1 truncate text-[11px] text-muted">
                        {formatNumber(impact.baselineValue)} to {formatNumber(impact.scenarioValue)} {impact.unit ?? ""}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="min-w-0 overflow-auto px-4 py-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-normal text-muted">
              <Sigma className="h-4 w-4" />
              Overrides
            </div>
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
              {inputNodes.map((node) => {
                const override = activeScenario?.overrides.find((candidate) => candidate.nodeId === node.id);
                const baselineValue = node.baselineValue ?? node.value;
                return (
                  <label key={node.id} className="grid gap-1 rounded-md border border-line bg-slate-50 px-3 py-2">
                    <span className="truncate text-xs font-semibold text-ink">{node.name}</span>
                    <div className="flex items-center gap-2">
                      <TextInput
                        className="h-8 py-1 text-xs"
                        type="number"
                        placeholder={baselineValue === undefined ? "n/a" : String(baselineValue)}
                        value={override?.value ?? ""}
                        disabled={!activeScenario}
                        onChange={(event) =>
                          activeScenario
                            ? updateScenarioOverride(
                                activeScenario.id,
                                node.id,
                                parseFiniteInput(event.target.value)
                              )
                            : undefined
                        }
                      />
                      <span className="w-16 truncate text-right text-xs text-muted">{node.unit ?? ""}</span>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="min-w-0 overflow-auto border-l border-line px-4 py-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-normal text-muted">Calculation trace</div>
            <div className="space-y-2">
              {traceItems.map((item) => (
                <div key={item.nodeId} className="rounded-md border border-line bg-white px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-xs font-semibold text-ink">{item.nodeName}</span>
                    <span className="shrink-0 text-xs font-semibold text-ink">{formatNumber(item.value)}</span>
                  </div>
                  {item.resolvedFormula ? (
                    <div className="mt-1 truncate font-mono text-[11px] text-muted">{item.resolvedFormula}</div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
