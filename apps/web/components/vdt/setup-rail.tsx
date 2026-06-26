"use client";

import { useState } from "react";
import { Bot, ClipboardList, Database, FileText, RotateCcw, Scale, Search, Sparkles } from "lucide-react";
import { calculateGraph } from "@vdt-studio/vdt-core";
import { Button } from "@/components/ui/button";
import { Field, SelectInput, TextArea, TextInput } from "@/components/ui/field";
import { Panel, PanelCollapseTab, PanelToggleButton, PanelHeader } from "@/components/ui/panel";
import { useDesktopLayout } from "@/lib/use-desktop-layout";
import { AdvisoryFindingsPanel } from "./advisory-findings-panel";
import { ExplanationPanel } from "./explanation-panel";
import {
  EXAMPLE_PROJECT_OPTIONS,
  useVdtStudioStore,
  type ExampleProjectId
} from "./vdt-store";
import { ExecutionModeSummaryCard } from "./execution-mode-summary";
import { GenerateActivityPanel } from "./generate-activity-panel";
import { SettingsModal } from "./settings-modal";

export function SetupRail() {
  const [selectedExampleId, setSelectedExampleId] = useState<ExampleProjectId>("production_volume");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const brief = useVdtStudioStore((state) => state.brief);
  const isGenerating = useVdtStudioStore((state) => state.isGenerating);
  const generateActivity = useVdtStudioStore((state) => state.generateActivity);
  const aiError = useVdtStudioStore((state) => state.aiError);
  const leftPanelCollapsed = useVdtStudioStore((state) => state.ui.leftPanelCollapsed);
  const isDesktop = useDesktopLayout();
  const showCollapsed = isDesktop && leftPanelCollapsed;
  const setBriefField = useVdtStudioStore((state) => state.setBriefField);
  const startAgentRun = useVdtStudioStore((state) => state.startAgentRun);
  const sendAgentAnswers = useVdtStudioStore((state) => state.sendAgentAnswers);
  const generateWithAi = useVdtStudioStore((state) => state.generateWithAi);
  const cancelGenerate = useVdtStudioStore((state) => state.cancelGenerate);
  const loadExample = useVdtStudioStore((state) => state.loadExample);
  const toggleLeftPanel = useVdtStudioStore((state) => state.toggleLeftPanel);
  const runAiAction = useVdtStudioStore((state) => state.runAiAction);
  const isRunningAiAction = useVdtStudioStore((state) => state.isRunningAiAction);
  const pendingAdvisoryResult = useVdtStudioStore((state) => state.pendingAdvisoryResult);
  const pendingAdvisoryTaskType = useVdtStudioStore((state) => state.pendingAdvisoryTaskType);
  const pendingExplanation = useVdtStudioStore((state) => state.pendingExplanation);
  const pendingExplanationTaskType = useVdtStudioStore((state) => state.pendingExplanationTaskType);
  const saveAdvisoryToProject = useVdtStudioStore((state) => state.saveAdvisoryToProject);
  const applyAdvisorySuggestedChanges = useVdtStudioStore((state) => state.applyAdvisorySuggestedChanges);
  const selectNode = useVdtStudioStore((state) => state.selectNode);
  const project = useVdtStudioStore((state) => state.project);

  const setupAdvisoryTasks = new Set(["check_units", "identify_missing_drivers", "identify_duplicate_drivers"]);
  const showSetupAdvisory =
    pendingAdvisoryResult &&
    pendingAdvisoryTaskType &&
    setupAdvisoryTasks.has(pendingAdvisoryTaskType);
  const showExecutiveSummary =
    pendingExplanation &&
    pendingExplanationTaskType === "generate_executive_summary";

  function runExecutiveSummary() {
    const calculation = calculateGraph(project);
    const topDrivers = project.graph.nodes
      .filter((node) => node.id !== project.rootNodeId)
      .slice(0, 5)
      .map((node) => ({
        nodeId: node.id,
        name: node.name,
        contributionSummary: node.description
      }));

    void runAiAction("generate_executive_summary", {
      rootValue: calculation.rootValue,
      topDrivers
    });
  }

  if (showCollapsed) {
    return (
      <PanelCollapseTab
        label="Setup"
        panel="left"
        testId="collapse-left-panel"
        expandTestId="expand-left-panel"
        onToggle={toggleLeftPanel}
      />
    );
  }

  return (
    <Panel className="flex h-full min-h-0 flex-col border-r">
      <PanelHeader
        title="New VDT"
        subtitle="Project brief and execution mode"
        action={
          <PanelToggleButton
            panel="left"
            testId="collapse-left-panel"
            onToggle={toggleLeftPanel}
          />
        }
      />
      <div className="flex-1 space-y-4 overflow-auto px-4 py-4">
        <div className="space-y-3">
          <Field label="Root KPI">
            <TextInput value={brief.rootKpi} onChange={(event) => setBriefField("rootKpi", event.target.value)} />
          </Field>
          <Field label="Industry">
            <TextInput value={brief.industry ?? ""} onChange={(event) => setBriefField("industry", event.target.value)} />
          </Field>
          <Field label="Unit">
            <TextInput value={brief.unit ?? ""} onChange={(event) => setBriefField("unit", event.target.value)} />
          </Field>
          <Field label="Time period">
            <TextInput
              value={brief.timePeriod ?? ""}
              onChange={(event) => setBriefField("timePeriod", event.target.value)}
            />
          </Field>
          <Field label="Business goal">
            <TextArea value={brief.goal ?? ""} onChange={(event) => setBriefField("goal", event.target.value)} />
          </Field>
          <Field label="Business context">
            <TextArea
              value={brief.businessContext ?? ""}
              onChange={(event) => setBriefField("businessContext", event.target.value)}
            />
          </Field>
          <Field label="Detail">
            <SelectInput
              value={brief.levelOfDetail ?? "medium"}
              onChange={(event) => setBriefField("levelOfDetail", event.target.value)}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </SelectInput>
          </Field>
        </div>

        <div className="border-t border-line pt-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
            <ClipboardList className="h-4 w-4 text-accent" />
            AI analysis
          </div>
          <div className="grid gap-2">
            <Button
              size="sm"
              icon={<Scale className="h-4 w-4" />}
              disabled={isRunningAiAction || isGenerating}
              onClick={() => void runAiAction("check_units", {})}
            >
              Check units
            </Button>
            <Button
              size="sm"
              icon={<Search className="h-4 w-4" />}
              disabled={isRunningAiAction || isGenerating}
              onClick={() => void runAiAction("identify_missing_drivers", {})}
            >
              Find missing drivers
            </Button>
            <Button
              size="sm"
              icon={<Search className="h-4 w-4" />}
              disabled={isRunningAiAction || isGenerating}
              onClick={() => void runAiAction("identify_duplicate_drivers", {})}
            >
              Find duplicates
            </Button>
            <Button
              size="sm"
              icon={<FileText className="h-4 w-4" />}
              disabled={isRunningAiAction || isGenerating}
              onClick={runExecutiveSummary}
            >
              Executive summary
            </Button>
          </div>

          {showSetupAdvisory && pendingAdvisoryTaskType ? (
            <div className="mt-3">
              <AdvisoryFindingsPanel
                taskType={pendingAdvisoryTaskType}
                result={pendingAdvisoryResult}
                isRunning={isRunningAiAction}
                onSaveToProject={saveAdvisoryToProject}
                onApplySuggestedChanges={applyAdvisorySuggestedChanges}
                onSelectNode={selectNode}
              />
            </div>
          ) : null}

          {showExecutiveSummary && pendingExplanationTaskType ? (
            <div className="mt-3">
              <ExplanationPanel taskType={pendingExplanationTaskType} result={pendingExplanation} />
            </div>
          ) : null}
        </div>

        <div className="border-t border-line pt-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
            <Bot className="h-4 w-4 text-accent" />
            Execution mode
          </div>
          <ExecutionModeSummaryCard onConfigure={() => setSettingsOpen(true)} />
        </div>

        {aiError ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm leading-5 text-red-700">{aiError}</div>
        ) : null}
      </div>
      <div className="space-y-2 border-t border-line px-4 py-4">
        {generateActivity ? (
          <GenerateActivityPanel activity={generateActivity} onCancel={cancelGenerate} onAnswer={(answers) => void sendAgentAnswers(answers)} />
        ) : null}
        <Button
          className="w-full"
          variant="primary"
          icon={<Bot className="h-4 w-4" />}
          disabled={isGenerating}
          onClick={() => void startAgentRun()}
          data-testid="start-vdt-agent"
        >
          {isGenerating ? "Agent running..." : "Start VDT Agent"}
        </Button>
        <Button
          className="w-full"
          icon={<Sparkles className="h-4 w-4" />}
          disabled={isGenerating}
          onClick={() => void generateWithAi()}
        >
          {isGenerating ? "Generating..." : "Generate VDT with AI"}
        </Button>
        <Field label="Example model">
          <SelectInput
            value={selectedExampleId}
            onChange={(event) => setSelectedExampleId(event.target.value as ExampleProjectId)}
          >
            {EXAMPLE_PROJECT_OPTIONS.map((example) => (
              <option key={example.id} value={example.id}>
                {example.label}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Button
          className="w-full"
          icon={<RotateCcw className="h-4 w-4" />}
          disabled={isGenerating}
          onClick={() => loadExample(selectedExampleId)}
        >
          Open example
        </Button>
        <div className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs leading-5 text-muted">
          <Database className="h-4 w-4 shrink-0" />
          Browser-local state is saved automatically.
        </div>
      </div>
      <SettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initialSection="execution"
        hideTrigger
      />
    </Panel>
  );
}
