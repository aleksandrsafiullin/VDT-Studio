"use client";

import { Trash2 } from "lucide-react";
import { calculateGraph, getDecompositionContextGroupIds } from "@vdt-studio/vdt-core";
import { Button } from "@/components/ui/button";
import { Field, SelectInput, TextArea, TextInput } from "@/components/ui/field";
import { Panel, PanelCollapseTab, PanelToggleButton, PanelHeader } from "@/components/ui/panel";
import { StatusPill } from "@/components/ui/status-pill";
import { useDesktopLayout } from "@/lib/use-desktop-layout";
import { formatNumber } from "@/lib/format";
import { FormulaEditorField } from "./formula-editor";
import { useVdtStudioStore } from "./vdt-store";

function parseFiniteInput(value: string) {
  if (value === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function NodeInspector() {
  const project = useVdtStudioStore((state) => state.project);
  const selectedNodeId = useVdtStudioStore((state) => state.selectedNodeId);
  const selectedPanelTab = useVdtStudioStore((state) => state.selectedPanelTab);
  const updateNode = useVdtStudioStore((state) => state.updateNode);
  const updateNodeBaselineValue = useVdtStudioStore((state) => state.updateNodeBaselineValue);
  const deleteNode = useVdtStudioStore((state) => state.deleteNode);
  const rightPanelCollapsed = useVdtStudioStore((state) => state.ui.rightPanelCollapsed);
  const isDesktop = useDesktopLayout();
  const showCollapsed = isDesktop && rightPanelCollapsed;
  const toggleRightPanel = useVdtStudioStore((state) => state.toggleRightPanel);

  const node = project.graph.nodes.find((candidate) => candidate.id === selectedNodeId) ?? project.graph.nodes[0];
  const calculation = calculateGraph(project);
  const nodeErrors = calculation.errors.filter((error) => error.nodeId === node?.id);
  const formulaInlineErrors = nodeErrors.filter(
    (error) =>
      error.type === "formula_parse_error" ||
      error.type === "unknown_reference" ||
      error.type === "circular_dependency"
  );

  if (showCollapsed) {
    return (
      <PanelCollapseTab
        label="Inspector"
        panel="right"
        testId="collapse-right-panel"
        expandTestId="expand-right-panel"
        onToggle={toggleRightPanel}
      />
    );
  }

  if (!node) {
    return (
      <Panel className="flex h-full min-h-0 flex-col border-l" data-testid="right-panel">
        <PanelHeader
          title="Inspector"
          subtitle="Select a node on the canvas"
          action={
            <PanelToggleButton
              panel="right"
              testId="collapse-right-panel"
              onToggle={toggleRightPanel}
            />
          }
        />
      </Panel>
    );
  }

  const sourceNote = node.valueSource?.note?.trim();
  const referenceGroup = getDecompositionContextGroupIds(project.graph, project.rootNodeId).has(node.id);
  const assumptionNotes = [...new Set((node.assumptions ?? [])
    .map((note) => note.trim())
    .filter((note) => note && !sourceNote?.includes(note)))];
  const reference = node.valueSource?.catalogRef;
  const sourceUrl = reference && /^https?:\/\/\S+$/.test(reference) ? reference : undefined;

  return (
    <Panel className="flex h-full min-h-0 flex-col border-l" data-testid="right-panel">
      <PanelHeader
        title="Node Inspector"
        subtitle={node.name}
        action={
          <div className="flex items-center gap-1">
            <StatusPill status={node.status} />
            <PanelToggleButton
              panel="right"
              testId="collapse-right-panel"
              onToggle={toggleRightPanel}
            />
          </div>
        }
      />
      <div className="flex gap-1 border-b border-line px-4 py-2" role="tablist" aria-label="Node inspector tabs">
        {(["properties", "warnings"] as const).map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={selectedPanelTab === tab}
            className={[
              "rounded-md px-2.5 py-1.5 text-xs font-semibold capitalize transition",
              selectedPanelTab === tab ? "bg-slate-900 text-white" : "text-muted hover:bg-slate-100"
            ].join(" ")}
            onClick={() => useVdtStudioStore.setState({ selectedPanelTab: tab })}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto px-4 py-4">
        {selectedPanelTab === "properties" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 rounded-md border border-line bg-slate-50 p-3">
              <div>
                <div className="text-xs font-medium uppercase tracking-normal text-muted">Value</div>
                <div className="mt-1 text-lg font-semibold text-ink">{referenceGroup ? "Reference group" : formatNumber(calculation.values[node.id])}</div>
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-normal text-muted">Unit</div>
                <div className="mt-1 truncate text-lg font-semibold text-ink">{node.unit ?? "n/a"}</div>
              </div>
            </div>

            {(sourceNote || assumptionNotes.length > 0 || reference) && (
              <section className="space-y-2 rounded-md border border-line bg-slate-50 p-3 text-sm leading-5" aria-label="Value notes">
                <div className="text-xs font-medium uppercase tracking-normal text-muted">Value notes</div>
                {sourceNote && <p>{sourceNote}</p>}
                {assumptionNotes.map((note) => <p key={note}>{note}</p>)}
                {sourceUrl ? (
                  <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">Source reference</a>
                ) : reference ? <p className="break-words text-xs text-muted">{reference}</p> : null}
              </section>
            )}

            <Field label="Name">
              <TextInput value={node.name} onChange={(event) => updateNode(node.id, { name: event.target.value })} />
            </Field>
            <Field label="Type">
              <SelectInput value={node.type} onChange={(event) => updateNode(node.id, { type: event.target.value as typeof node.type })}>
                <option value="root_kpi">Root KPI</option>
                <option value="calculated">Calculated</option>
                <option value="input">Input</option>
                <option value="assumption">Assumption</option>
                <option value="external_factor">External factor</option>
                <option value="data_mapped">Data mapped</option>
              </SelectInput>
            </Field>
            <Field label="Unit">
              <TextInput value={node.unit ?? ""} onChange={(event) => updateNode(node.id, { unit: event.target.value })} />
            </Field>
            {(node.type === "root_kpi" || node.type === "calculated") && (
              <FormulaEditorField
                key={node.id}
                formula={node.formula}
                currentNodeId={node.id}
                nodes={project.graph.nodes}
                edges={project.graph.edges}
                onChange={(value) => updateNode(node.id, { formula: value || undefined })}
                errors={formulaInlineErrors}
              />
            )}
            {!referenceGroup && <Field label="Baseline value">
              <TextInput
                type="number"
                value={node.baselineValue ?? node.value ?? ""}
                onChange={(event) => updateNodeBaselineValue(node.id, parseFiniteInput(event.target.value))}
              />
            </Field>}
            <Field label="Description">
              <TextArea
                value={node.description ?? ""}
                onChange={(event) => updateNode(node.id, { description: event.target.value })}
              />
            </Field>
            {node.type === "input" || node.type === "data_mapped" ? (
              <div className="grid gap-1.5">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 rounded border-slate-300"
                    data-testid="node-fixed-in-scenario-toggle"
                    checked={node.fixedInScenario === true}
                    onChange={(event) =>
                      updateNode(node.id, { fixedInScenario: event.target.checked ? true : undefined })
                    }
                  />
                  <span className="text-sm font-medium text-ink">Not changeable</span>
                </label>
                <span className="text-xs leading-4 text-muted">
                  Does not participate in the performance improvement scenarios
                </span>
              </div>
            ) : null}

            <div>
              <Button
                variant="ghost"
                icon={<Trash2 className="h-4 w-4" />}
                disabled={node.id === project.rootNodeId}
                onClick={() => deleteNode(node.id)}
              >
                Delete
              </Button>
            </div>
          </div>
        ) : null}

        {selectedPanelTab === "warnings" ? (
          <div className="space-y-3">
            {nodeErrors.length === 0 ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                No formula errors for this node.
              </div>
            ) : (
              nodeErrors.map((error) => (
                <div key={error.id} className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
                  {error.message}
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
