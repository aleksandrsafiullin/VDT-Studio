"use client";

import { Check, GitBranchPlus, Info, Scissors, Sparkles, Trash2, Wand2, X } from "lucide-react";
import { calculateGraph } from "@vdt-studio/vdt-core";
import { Button } from "@/components/ui/button";
import { Field, SelectInput, TextArea, TextInput } from "@/components/ui/field";
import { Panel, PanelCollapseTab, PanelToggleButton, PanelHeader } from "@/components/ui/panel";
import { StatusPill } from "@/components/ui/status-pill";
import { useDesktopLayout } from "@/lib/use-desktop-layout";
import { formatNumber } from "@/lib/format";
import { AdvisoryFindingsPanel } from "./advisory-findings-panel";
import { ChangeSetPreviewPanel } from "./change-set-preview-panel";
import { FormulaEditorField } from "./formula-editor";
import { ExplanationPanel } from "./explanation-panel";
import { isAdvisoryAiTaskType, isExplanationAiTaskType, useVdtStudioStore } from "./vdt-store";

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
  const pendingChangeSet = useVdtStudioStore((state) => state.pendingChangeSet);
  const changeSetSelection = useVdtStudioStore((state) => state.changeSetSelection);
  const pendingAdvisoryResult = useVdtStudioStore((state) => state.pendingAdvisoryResult);
  const pendingAdvisoryTaskType = useVdtStudioStore((state) => state.pendingAdvisoryTaskType);
  const pendingExplanation = useVdtStudioStore((state) => state.pendingExplanation);
  const pendingExplanationTaskType = useVdtStudioStore((state) => state.pendingExplanationTaskType);
  const isRunningAiAction = useVdtStudioStore((state) => state.isRunningAiAction);
  const aiActionError = useVdtStudioStore((state) => state.aiActionError);
  const updateNode = useVdtStudioStore((state) => state.updateNode);
  const updateNodeBaselineValue = useVdtStudioStore((state) => state.updateNodeBaselineValue);
  const acceptNode = useVdtStudioStore((state) => state.acceptNode);
  const rejectNode = useVdtStudioStore((state) => state.rejectNode);
  const deleteNode = useVdtStudioStore((state) => state.deleteNode);
  const runAiAction = useVdtStudioStore((state) => state.runAiAction);
  const selectNode = useVdtStudioStore((state) => state.selectNode);
  const toggleChangeSelection = useVdtStudioStore((state) => state.toggleChangeSelection);
  const applyPendingChangeSet = useVdtStudioStore((state) => state.applyPendingChangeSet);
  const discardPendingChangeSet = useVdtStudioStore((state) => state.discardPendingChangeSet);
  const saveAdvisoryToProject = useVdtStudioStore((state) => state.saveAdvisoryToProject);
  const applyAdvisorySuggestedChanges = useVdtStudioStore((state) => state.applyAdvisorySuggestedChanges);
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
  const canDeepen = node && node.id !== project.rootNodeId;

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
        {["properties", "ai", "warnings"].map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={selectedPanelTab === tab}
            className={[
              "rounded-md px-2.5 py-1.5 text-xs font-semibold capitalize transition",
              selectedPanelTab === tab ? "bg-slate-900 text-white" : "text-muted hover:bg-slate-100"
            ].join(" ")}
            onClick={() => useVdtStudioStore.setState({ selectedPanelTab: tab as "properties" })}
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
                <div className="mt-1 text-lg font-semibold text-ink">{formatNumber(calculation.values[node.id])}</div>
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-normal text-muted">Unit</div>
                <div className="mt-1 truncate text-lg font-semibold text-ink">{node.unit ?? "n/a"}</div>
              </div>
            </div>

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
            <Field label="Baseline value">
              <TextInput
                type="number"
                value={node.baselineValue ?? node.value ?? ""}
                onChange={(event) => updateNodeBaselineValue(node.id, parseFiniteInput(event.target.value))}
              />
            </Field>
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

            <div className="grid grid-cols-2 gap-2">
              <Button icon={<Check className="h-4 w-4" />} onClick={() => acceptNode(node.id)}>
                Accept
              </Button>
              <Button variant="danger" icon={<X className="h-4 w-4" />} onClick={() => rejectNode(node.id)}>
                Reject
              </Button>
              <Button
                icon={<GitBranchPlus className="h-4 w-4" />}
                data-testid="deepen-node-button"
                disabled={isRunningAiAction || !canDeepen}
                onClick={() => void runAiAction("deepen_node", { nodeId: node.id })}
              >
                Deepen with AI
              </Button>
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

        {selectedPanelTab === "ai" ? (
          <div className="space-y-4">
            <div className="rounded-md border border-line bg-slate-50 p-3">
              <div className="flex items-start gap-2">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <div>
                  <h3 className="text-sm font-semibold text-ink">AI rationale</h3>
                  <p className="mt-1 text-sm leading-6 text-muted">{node.aiRationale ?? "No AI rationale is attached."}</p>
                  <p className="mt-2 text-xs text-muted">Confidence: {formatNumber(node.aiConfidence, { style: "percent" })}</p>
                </div>
              </div>
            </div>

            {project.aiReview ? (
              <div className="rounded-md border border-line bg-white p-3">
                <h3 className="text-sm font-semibold text-ink">Saved model review</h3>
                {project.aiReview.assumptions.length > 0 ? (
                  <div className="mt-3">
                    <div className="text-xs font-semibold uppercase tracking-normal text-muted">Assumptions</div>
                    <ul className="mt-2 space-y-1 text-sm leading-5 text-muted">
                      {project.aiReview.assumptions.map((assumption) => (
                        <li key={assumption}>{assumption}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {project.aiReview.questionsForUser.length > 0 ? (
                  <div className="mt-3">
                    <div className="text-xs font-semibold uppercase tracking-normal text-muted">Questions</div>
                    <ul className="mt-2 space-y-1 text-sm leading-5 text-muted">
                      {project.aiReview.questionsForUser.map((question) => (
                        <li key={question}>{question}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {project.aiReview.warnings.length > 0 ? (
                  <div className="mt-3">
                    <div className="text-xs font-semibold uppercase tracking-normal text-muted">Warnings</div>
                    <ul className="mt-2 space-y-1 text-sm leading-5 text-muted">
                      {project.aiReview.warnings.map((warning) => (
                        <li key={warning.id}>{warning.message}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {aiActionError ? (
              <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
                {aiActionError}
              </div>
            ) : null}

            {pendingChangeSet ? (
              <ChangeSetPreviewPanel
                project={project}
                changeSet={pendingChangeSet}
                selection={changeSetSelection}
                isRunning={isRunningAiAction}
                error={aiActionError}
                onToggle={toggleChangeSelection}
                onApply={applyPendingChangeSet}
                onDiscard={discardPendingChangeSet}
              />
            ) : null}

            {pendingAdvisoryResult && pendingAdvisoryTaskType && isAdvisoryAiTaskType(pendingAdvisoryTaskType) ? (
              <AdvisoryFindingsPanel
                taskType={pendingAdvisoryTaskType}
                result={pendingAdvisoryResult}
                isRunning={isRunningAiAction}
                onSaveToProject={saveAdvisoryToProject}
                onApplySuggestedChanges={applyAdvisorySuggestedChanges}
                onSelectNode={selectNode}
              />
            ) : null}

            {pendingExplanation && pendingExplanationTaskType && isExplanationAiTaskType(pendingExplanationTaskType) ? (
              <ExplanationPanel taskType={pendingExplanationTaskType} result={pendingExplanation} />
            ) : null}

            {!pendingChangeSet ? (
              <div className="grid gap-2">
                <Button
                  icon={<GitBranchPlus className="h-4 w-4" />}
                  data-testid="deepen-node-button"
                  disabled={isRunningAiAction || !canDeepen}
                  onClick={() => void runAiAction("deepen_node", { nodeId: node.id })}
                >
                  Deepen with AI
                </Button>
                <Button
                  variant="ghost"
                  icon={<Scissors className="h-4 w-4" />}
                  disabled={isRunningAiAction || !canDeepen}
                  onClick={() => void runAiAction("simplify_branch", { branchRootNodeId: node.id })}
                >
                  Simplify branch
                </Button>
                <Button
                  variant="ghost"
                  icon={<Sparkles className="h-4 w-4" />}
                  disabled={isRunningAiAction}
                  onClick={() => void runAiAction("suggest_alternative", { targetNodeId: node.id })}
                >
                  Suggest alternative
                </Button>
                <Button
                  variant="ghost"
                  icon={<Wand2 className="h-4 w-4" />}
                  disabled={isRunningAiAction}
                  onClick={() => void runAiAction("suggest_formula", { nodeId: node.id })}
                >
                  Suggest formula
                </Button>
                <Button
                  variant="ghost"
                  disabled={isRunningAiAction}
                  data-testid="explain-node-button"
                  onClick={() => void runAiAction("explain_node", { nodeId: node.id })}
                >
                  Explain node
                </Button>
              </div>
            ) : null}
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
