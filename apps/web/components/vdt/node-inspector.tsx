"use client";

import { useEffect, useRef } from "react";
import { CircleAlert, Info, Link2, ShieldCheck, SlidersHorizontal, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import { calculateGraph, getDecompositionContextGroupIds } from "@vdt-studio/vdt-core";
import { Button } from "@/components/ui/button";
import { Field, SelectInput, TextArea, TextInput } from "@/components/ui/field";
import { Panel, PanelCollapseTab, PanelToggleButton } from "@/components/ui/panel";
import { useDesktopLayout } from "@/lib/use-desktop-layout";
import { formatNumber } from "@/lib/format";
import { FormulaEditorField } from "./formula-editor";
import { useVdtStudioStore } from "./vdt-store";
import styles from "./workspace-shell.module.css";

function InspectorHeader({ name, onCollapse }: {
  name: string;
  onCollapse: () => void;
}) {
  return (
    <header className={styles.inspectorHeader}>
      <div className={styles.inspectorIdentity}>
        <span className={styles.inspectorMark}><SlidersHorizontal size={14} aria-hidden="true" /></span>
        <div className="min-w-0">
          <h2>Node Inspector</h2>
          <p title={name}>{name}</p>
        </div>
      </div>
      <div className={styles.inspectorActions}>
        <PanelToggleButton panel="right" testId="collapse-right-panel" onToggle={onCollapse} />
      </div>
    </header>
  );
}

function parseFiniteInput(value: string) {
  if (value === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function NodeInspector() {
  const scrollRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [node?.id, selectedPanelTab, showCollapsed]);

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
      <Panel className={styles.inspector} data-testid="right-panel">
        <InspectorHeader name="Select a node on the canvas" onCollapse={toggleRightPanel} />
        <p className={styles.inspectorEmpty}>Select a KPI to explore its value, drivers and properties.</p>
      </Panel>
    );
  }

  const sourceNote = node.valueSource?.note?.trim();
  const derived = Boolean(node.formula?.trim());
  const referenceGroup = getDecompositionContextGroupIds(project.graph, project.rootNodeId).has(node.id);
  const assumptionNotes = [...new Set((node.assumptions ?? [])
    .map((note) => note.trim())
    .filter((note) => note && !sourceNote?.includes(note)))];
  const reference = node.valueSource?.catalogRef;
  const sourceUrl = reference && /^https?:\/\/\S+$/.test(reference) ? reference : undefined;

  return (
    <Panel className={styles.inspector} data-testid="right-panel" aria-label="Node inspector">
      <InspectorHeader name={node.name} onCollapse={toggleRightPanel} />
      <div className={styles.inspectorTabs} role="tablist" aria-label="Node inspector tabs">
        {(["properties", "warnings"] as const).map((tab) => (
          <button
            key={tab}
            role="tab"
            id={`node-inspector-${tab}-tab`}
            aria-controls={`node-inspector-${tab}-panel`}
            aria-selected={selectedPanelTab === tab}
            className={styles.inspectorTab}
            onClick={() => useVdtStudioStore.setState({ selectedPanelTab: tab })}
          >
            {tab}
            {tab === "warnings" && nodeErrors.length > 0 ? <span className={styles.warningDot} aria-hidden="true" /> : null}
          </button>
        ))}
      </div>
      <div
        ref={scrollRef}
        className={styles.inspectorScroll}
        id={`node-inspector-${selectedPanelTab}-panel`}
        role="tabpanel"
        aria-labelledby={`node-inspector-${selectedPanelTab}-tab`}
        tabIndex={0}
      >
        {selectedPanelTab === "properties" ? (
          <div className={styles.inspectorContent}>
            <section className={styles.valueHero} aria-label="Current KPI value">
              <p className={styles.valueLabel}>Value</p>
              <div className={styles.valueRow}>
                <div className={clsx(styles.valueNumber, referenceGroup && styles.referenceValue)}>{!referenceGroup && calculation.values[node.id] !== undefined && (node.valueStatus === "default_assumption" || node.valueSource?.sourceTier === "assumption")
                  ? <span className="text-amber-800" title="Illustrative estimate, not measured data." aria-label="Estimate">≈ </span> : null}{referenceGroup ? "Reference group" : formatNumber(calculation.values[node.id])}</div>
                {!referenceGroup ? <span className={styles.valueUnit} title={node.unit ?? "Unit not set"}>{node.unit ?? "n/a"}</span> : null}
              </div>
            </section>

            {(sourceNote || assumptionNotes.length > 0 || reference) && (
              <section className={styles.valueNotes} aria-label="Value notes">
                <div className={styles.notesHeading}><Info size={12} aria-hidden="true" />Value notes</div>
                {sourceNote && <p>{sourceNote}</p>}
                {assumptionNotes.map((note) => <p key={note}>{note}</p>)}
                {sourceUrl ? (
                  <a href={sourceUrl} target="_blank" rel="noopener noreferrer">Source reference<Link2 size={11} aria-hidden="true" /></a>
                ) : reference ? <p className="break-words">{reference}</p> : null}
              </section>
            )}

            <section className={styles.inspectorSection} aria-label="KPI definition">
              <Field label="Name">
                <TextInput value={node.name} onChange={(event) => updateNode(node.id, { name: event.target.value })} />
              </Field>
              <div className={styles.propertyGrid}>
                <Field label="Type">
                  <SelectInput value={node.type} onChange={(event) => updateNode(node.id, { type: event.target.value as typeof node.type })}>
                    <option value="root_kpi">{node.id === project.rootNodeId && derived ? "Root KPI · Calculated" : "Root KPI"}</option>
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
              </div>
            </section>
            {(node.type === "root_kpi" || node.type === "calculated") && (
              <section className={clsx(styles.formulaSection, styles.sectionDivider)} aria-label="KPI formula">
                <FormulaEditorField
                  key={node.id}
                  formula={node.formula}
                  currentNodeId={node.id}
                  nodes={project.graph.nodes}
                  edges={project.graph.edges}
                  onChange={(value) => updateNode(node.id, { formula: value || undefined })}
                  errors={formulaInlineErrors}
                />
              </section>
            )}
            <section className={clsx(styles.inspectorSection, styles.sectionDivider)} aria-label="KPI details">
              {!referenceGroup && <Field label={derived ? "Source value" : "Baseline value"}>
                <TextInput
                  type="number"
                  value={node.baselineValue ?? node.value ?? ""}
                  data-testid={derived ? "node-source-value" : "node-baseline-value"}
                  readOnly={derived}
                  onChange={(event) => { if (!derived) updateNodeBaselineValue(node.id, parseFiniteInput(event.target.value)); }}
                />
              </Field>}
              <Field label="Description">
                <TextArea
                  value={node.description ?? ""}
                  onChange={(event) => updateNode(node.id, { description: event.target.value })}
                />
              </Field>
              {node.type === "input" || node.type === "data_mapped" ? (
                <div className={styles.scenarioLock}>
                  <label>
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 shrink-0 rounded"
                      data-testid="node-fixed-in-scenario-toggle"
                      checked={node.fixedInScenario === true}
                      onChange={(event) =>
                        updateNode(node.id, { fixedInScenario: event.target.checked ? true : undefined })
                      }
                    />
                    <span>Not changeable</span>
                  </label>
                  <p>Does not participate in the performance improvement scenarios</p>
                </div>
              ) : null}
            </section>

            <div className={styles.inspectorFooter}>
              <Button
                variant="ghost"
                icon={<Trash2 className="h-4 w-4" />}
                disabled={node.id === project.rootNodeId}
                title={node.id === project.rootNodeId ? "The root KPI cannot be deleted" : "Delete this KPI"}
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
              <div className={styles.warningEmpty}>
                <ShieldCheck size={28} strokeWidth={1.3} aria-hidden="true" />
                <h3>Nothing to review</h3>
                <p>No formula errors for this node.</p>
              </div>
            ) : (
              nodeErrors.map((error) => (
                <div key={error.id} className={styles.warningCard}>
                  <CircleAlert size={15} aria-hidden="true" />
                  <p>{error.message}</p>
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
